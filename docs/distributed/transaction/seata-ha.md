# Seata 高可用与 session 管理

Seata TC 是整个分布式事务的「大脑」。

**如果大脑宕机了，整个事务系统就瘫痪了吗？**

当然不会。Seata 的高可用设计，就是为了保证「大脑」永不停机。

## Session：TC 的记忆

Session（会话）是 TC 管理全局事务的核心数据结构。

```
Session 的内容：

GlobalSession（全局会话）
├── xid                    // 全局事务 ID
├── transactionName        // 事务名称
├── status                  // 状态：活跃/提交/回滚
├── beginTime              // 开始时间
├── timeout                // 超时时间
├── branchSessions         // 分支会话列表
│   ├── branchId           // 分支 ID
│   ├── resourceId         // 资源 ID（数据源）
│   ├── status            // 分支状态
│   ├── applicationData   // 应用数据
│   └── globalLockKeys    // 全局锁的 key
└── lockKeys              // 持有的全局锁
```

```java
/**
 * GlobalSession：全局会话
 */
public class GlobalSession {
    
    private String xid;
    private String transactionName;
    private GlobalStatus status;
    private long beginTime;
    private int timeout;
    private final List<BranchSession> branchSessions = new CopyOnWriteArrayList<>();
    private final Set<String> globalLockKeys = new ConcurrentHashMap<>().newKeySet();
    
    /**
     * 添加分支
     */
    public void addBranch(BranchSession branch) {
        branchSessions.add(branch);
    }
    
    /**
     * 改变状态
     */
    public boolean changeStatus(GlobalStatus status) {
        this.status = status;
        return true;
    }
    
    /**
     * 判断是否超时
     */
    public boolean isTimeout() {
        return System.currentTimeMillis() - beginTime > timeout;
    }
}
```

## Session 的存储

Session 存储在哪里？

```
存储模式：

1. File 模式（单机）：存储在本地文件
   - 优点：简单
   - 缺点：不能跨进程共享，不能高可用

2. DB 模式（推荐）：存储在数据库
   - 优点：支持高可用
   - 缺点：需要维护数据库

3. Redis 模式：存储在 Redis
   - 优点：性能高
   - 缺点：Redis 挂了则 TC 不可用
```

### DB 模式存储

```sql
-- 全局会话表
CREATE TABLE global_table (
    xid VARCHAR(128) PRIMARY KEY,
    transaction_id BIGINT,
    status INT,
    application_id VARCHAR(64),
    transaction_service_group VARCHAR(64),
    transaction_name VARCHAR(64),
    timeout INT,
    begin_time BIGINT,
    application_data TEXT,
    gmt_create DATETIME,
    gmt_modified DATETIME
);

-- 分支会话表
CREATE TABLE branch_table (
    branch_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    xid VARCHAR(128) NOT NULL,
    transaction_id BIGINT,
    resource_group_id VARCHAR(32),
    resource_id VARCHAR(256),
    branch_type VARCHAR(8),
    status INT,
    client_id VARCHAR(64),
    application_data TEXT,
    gmt_create DATETIME,
    gmt_modified DATETIME,
    INDEX idx_xid (xid)
);

-- 全局锁表
CREATE TABLE lock_table (
    row_key VARCHAR(128) PRIMARY KEY,
    xid VARCHAR(128),
    transaction_id BIGINT,
    branch_id BIGINT,
    resource_id VARCHAR(256),
    table_name VARCHAR(64),
    pk VARCHAR(128),
    status INT,
    gmt_create DATETIME,
    gmt_modified DATETIME,
    INDEX idx_xid_branch (xid, branch_id)
);
```

```java
/**
 * Session 的数据库持久化
 */
public class DbSessionRepository implements SessionRepository {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;
    
    @Override
    public void addGlobalSession(GlobalSession session) {
        String sql = """
            INSERT INTO global_table 
            (xid, transaction_id, status, transaction_name, 
             timeout, begin_time, gmt_create, gmt_modified)
            VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
            """;
        
        jdbcTemplate.update(sql,
            session.getXid(),
            session.getTransactionId(),
            session.getStatus().getCode(),
            session.getTransactionName(),
            session.getTimeout(),
            session.getBeginTime()
        );
    }
    
    @Override
    public void addBranchSession(String xid, BranchSession branch) {
        String sql = """
            INSERT INTO branch_table
            (xid, branch_id, resource_id, status, gmt_create, gmt_modified)
            VALUES (?, ?, ?, ?, NOW(), NOW())
            """;
        
        jdbcTemplate.update(sql,
            xid,
            branch.getBranchId(),
            branch.getResourceId(),
            branch.getStatus().getCode()
        );
    }
    
    @Override
    public void lockGlobalLockKeys(String xid, Set<String> lockKeys) {
        for (String lockKey : lockKeys) {
            // 乐观锁：如果 key 已存在且状态正常，则更新失败
            String sql = """
                INSERT INTO lock_table 
                (row_key, xid, branch_id, status, gmt_create, gmt_modified)
                VALUES (?, ?, ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                xid = VALUES(xid),
                status = VALUES(status)
                """;
            
            jdbcTemplate.update(sql, lockKey, xid, 0, 1);
        }
    }
}
```

## TC 高可用：主节点选举

多个 TC 实例如何协同工作？

```
高可用架构：

┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│             │    │             │    │             │
│   TC 1      │    │   TC 2      │    │   TC 3      │
│  (主节点)    │◀──▶│  (从节点)    │◀──▶│  (从节点)    │
│             │    │             │    │             │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │                       │
              │    Session Store      │
              │    (DB/Redis)         │
              │                       │
              └───────────────────────┘
```

### 抢主机制

```java
/**
 * TC 主节点选举
 * 
 * 使用数据库行锁实现抢主
 */
public class LeaderElection {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;
    
    private static final String ELECTION_LOCK_SQL = """
        UPDATE tc_server 
        SET leader = ?, leader_port = ?, last_heartbeat = ?
        WHERE id = ? 
        AND (leader IS NULL OR leader_expire_time < ?)
        """;
    
    /**
     * 尝试成为主节点
     */
    public boolean tryBecomeLeader() {
        // 1. 尝试获取行锁
        int rows = jdbcTemplate.update(ELECTION_LOCK_SQL,
            currentServerId,   // 成为主
            currentPort,
            System.currentTimeMillis(),
            serverId,
            System.currentTimeMillis() + HEARTBEAT_TIMEOUT
        );
        
        return rows > 0;
    }
    
    /**
     * 发送心跳
     */
    public void heartbeat() {
        // 更新心跳时间
        jdbcTemplate.update(
            "UPDATE tc_server SET last_heartbeat = ? WHERE id = ?",
            System.currentTimeMillis(),
            currentServerId
        );
        
        // 如果心跳超时，主节点失效
        checkAndRelelect();
    }
    
    /**
     * 检查并重新选举
     */
    private void checkAndRelelect() {
        // 检查主节点是否超时
        Long lastHeartbeat = jdbcTemplate.queryForObject(
            "SELECT last_heartbeat FROM tc_server WHERE leader = ?",
            Long.class,
            currentServerId
        );
        
        if (lastHeartbeat == null) {
            return;
        }
        
        if (System.currentTimeMillis() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
            // 主节点超时，尝试抢主
            if (tryBecomeLeader()) {
                log.info("成功成为主节点: {}", currentServerId);
            }
        }
    }
}
```

## 故障转移

当主 TC 崩溃时，从 TC 如何接管？

```
故障转移流程：

1. 从 TC 检测到主节点超时
      ↓
2. 尝试抢主（获取行锁）
      ↓
   抢主成功 → 成为新主节点
   抢主失败 → 其他节点抢主成功
      ↓
3. 新主节点恢复未完成的事务
      ↓
4. RM 重新连接新主节点
      ↓
5. 继续处理
```

```java
/**
 * 故障转移处理
 */
public class FailoverHandler {
    
    /**
     * 恢复未完成的事务
     */
    public void recoverIncompleteTransactions() {
        // 1. 查询活跃的事务（超时的）
        List<GlobalSession> activeSessions = 
            sessionRepository.getActiveSessions();
        
        for (GlobalSession session : activeSessions) {
            if (session.isTimeout()) {
                // 2. 超时事务，根据状态决定回滚或提交
                switch (session.getStatus()) {
                    case BEGIN:
                        // 超时未完成，回滚
                        rollbackSession(session);
                        break;
                    case COMMITTING:
                        // 正在提交，可能提交了一半
                        // 需要检查每个分支的状态
                        checkAndRecoverBranches(session);
                        break;
                }
            }
        }
    }
}
```

## RM 的高可用

RM 如何应对 TC 不可用的情况？

```
RM 的高可用策略：

1. 连接池：维护多个 TC 连接
2. 重试机制：TC 不可用时，自动重试
3. 本地缓冲：事务状态先记录在本地
```

```java
/**
 * RM 的 TC 连接管理
 */
public class TCConnectionManager {
    
    /**
     * 获取 TC 连接（支持重试）
     */
    public TCConnection getConnection() {
        for (String serverAddr : serverList) {
            try {
                TCConnection conn = connectionPool.get(serverAddr);
                
                if (conn.isActive()) {
                    return conn;
                }
            } catch (Exception e) {
                log.warn("连接 TC 失败: {}", serverAddr);
            }
        }
        
        // 所有 TC 都不可用，抛出异常
        throw new TCUnavailableException("所有 TC 都不可用");
    }
    
    /**
     * 重连机制
     */
    public void reconnect() {
        // 1. 从注册中心获取最新 TC 列表
        List<String> newServerList = discoveryService.getServers();
        
        // 2. 更新连接池
        for (String addr : newServerList) {
            if (!connectionPool.containsKey(addr)) {
                connectionPool.put(addr, createConnection(addr));
            }
        }
    }
}
```

## Seata 的性能瓶颈

Seata TC 的性能瓶颈在哪里？

```
瓶颈分析：

1. Session 存储：每次操作都要持久化到 DB
      → 优化：使用 Redis 或异步写入

2. 全局锁竞争：高并发下，多个事务竞争同一行锁
      → 优化：热点 key 分离、锁分段

3. TC 处理能力：单节点处理能力有限
      → 优化：TC 集群 + 负载均衡
```

```java
/**
 * 全局锁优化：热点 key 分离
 */
public class HotKeyLockManager {
    
    /**
     * 将热点 key 分散到不同的锁分区
     */
    private static final int LOCK_BUCKET_COUNT = 16;
    
    public String getLockKey(String table, String pk) {
        // 对 pk 做 hash，分散到不同分区
        int bucket = Math.abs(pk.hashCode() % LOCK_BUCKET_COUNT);
        return String.format("%s:%s:%d", table, pk, bucket);
    }
}
```

## 面试追问方向

**追问 1：TC 挂了，RM 侧的分支事务会怎样？**

分析：
1. **分支已提交**：不受影响
2. **分支执行中**：RM 会超时，标记失败
3. **分支未注册**：不受影响

TC 恢复后：
- RM 重新连接
- 如果分支状态未知，需要人工确认

**追问 2：Seata 的全局锁和数据库行锁会双重加锁吗？**

不会：
- **全局锁**：Seata TC 维护，跨全局事务
- **数据库行锁**：InnoDB 维护，跨事务

两者配合：
1. RM 先申请全局锁（Seata）
2. RM 再执行 SQL（InnoDB 行锁）
3. InnoDB 行锁在事务提交后释放
4. Seata 全局锁在二阶段后释放

**追问 3：Seata TC 如何保证高并发下的性能？**

1. **异步处理**：二阶段提交/回滚是异步的
2. **批量操作**：批量注册分支、批量提交
3. **缓存优化**：热点 Session 缓存到内存
4. **锁分离**：热点 key 的锁分段

## 总结

Seata 高可用的核心设计：

1. **Session 外置**：存储在 DB/Redis，支持多 TC 共享
2. **主节点选举**：使用 DB 行锁实现抢主
3. **故障转移**：主节点挂了，从节点自动接管
4. **RM 重连**：RM 自动重连到新的主节点

Seata 的性能优化方向：
1. 减少 Session 持久化开销
2. 优化全局锁竞争
3. TC 集群水平扩展
