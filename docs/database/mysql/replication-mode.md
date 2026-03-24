# 主从复制模式：异步、半同步、全同步

你知道 MySQL 的主从复制有几种模式吗？

异步、半同步、全同步——三种模式，性能和安全性各不相同。

选错了模式，可能导致数据丢失或性能下降。

---

## 三种模式对比

| 模式 | 性能 | 安全性 | 适用场景 |
|------|------|--------|----------|
| 异步复制 | 最高 | 最低 | 对数据一致性要求不高的场景 |
| 半同步复制 | 中等 | 中等 | 大多数生产环境 |
| 全同步复制 | 最低 | 最高 | 金融等强一致性场景 |

---

## 异步复制（Asynchronous Replication）

### 工作原理

主库提交事务后，立即返回成功，不等待从库确认。

```
┌────────────────────────────────────────────────────────────┐
│                     异步复制                               │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 事务 T：                                                    │
│ 1. 客户端提交事务                                          │
│ 2. 主库写入 Binlog                                         │
│ 3. 主库提交事务                                            │
│ 4. 返回客户端「执行成功」← 立即返回                        │
│                                                            │
│ 此时从库可能还没收到 Binlog...                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 配置

```ini
[mysqld]
binlog-format = ROW
# 默认就是异步复制，无需特殊配置
```

### 优点

- 主库性能最好
- 无等待延迟

### 缺点

- 数据可能丢失：主库提交后，从库还没同步，主库挂了
- 主从不一致：读从库可能读到旧数据

---

## 半同步复制（Semi-synchronous Replication）

### 工作原理

主库提交事务后，等待至少一个从库确认收到 Binlog 才返回。

```
┌────────────────────────────────────────────────────────────┐
│                     半同步复制                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 事务 T：                                                    │
│ 1. 客户端提交事务                                          │
│ 2. 主库写入 Binlog                                         │
│ 3. 等待从库确认收到 Binlog（至少 1 个）                    │
│ 4. 主库提交事务                                            │
│ 5. 返回客户端「执行成功」                                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 配置

```sql
-- 主库：安装半同步插件
INSTALL PLUGIN rpl_semi_sync_master SONAME 'semisync_master.so';
SET GLOBAL rpl_semi_sync_master_enabled = ON;
SET GLOBAL rpl_semi_sync_master_timeout = 1000;  -- 超时时间（毫秒）

-- 从库：安装半同步插件
INSTALL PLUGIN rpl_semi_sync_slave SONAME 'semisync_slave.so';
SET GLOBAL rpl_semi_sync_slave_enabled = ON;
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `rpl_semi_sync_master_timeout` | 等待从库确认的超时时间 | 10000ms |
| `rpl_semi_sync_master_wait_for_slave_count` | 需要等待的从库数量 | 1 |

### 优点

- 数据安全性提高：至少一个从库收到了 Binlog
- 性能适中：只需要等待一个从库

### 缺点

- 有等待时间：主库需要等待从库确认
- 超时后自动降级为异步复制

### 超时降级

```sql
-- 如果从库确认超时（超过 rpl_semi_sync_master_timeout）
-- 主库自动降级为异步复制，继续处理请求
-- 从库恢复后，自动恢复为半同步复制
```

---

## 全同步复制（Synchronous Replication）

### 工作原理

主库提交事务后，等待**所有**从库都执行完成才返回。

```
┌────────────────────────────────────────────────────────────┐
│                     全同步复制                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 事务 T（2 个从库）：                                        │
│ 1. 客户端提交事务                                          │
│ 2. 主库写入 Binlog                                         │
│ 3. 等待从库 1 确认收到并执行                               │
│ 4. 等待从库 2 确认收到并执行                               │
│ 5. 主库提交事务                                            │
│ 6. 返回客户端「执行成功」                                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 实际使用情况

全同步复制在实际生产中很少使用，因为：
- 性能太差：需要等待所有从库
- 一个从库慢，全部都要等

MySQL Cluster（NDB）支持全同步复制，但普通 InnoDB 不支持。

---

## 组复制（Group Replication）

MySQL 5.7.17 引入了 Group Replication，提供了一种新的复制模式。

### 工作原理

多个 MySQL 节点组成一个组，事务在组内广播，只有大多数节点确认后事务才提交。

```
┌────────────────────────────────────────────────────────────┐
│                     组复制                                │
├────────────────────────────────────────────────────────────┤
│                                                            │
│              ┌─────────────────────────┐                  │
│              │      MySQL Group        │                  │
│              │   (3 个节点，多数派)    │                  │
│              └─────────┬───────────────┘                  │
│           ┌───────────┼───────────────┐                   │
│           ↓           ↓               ↓                  │
│      ┌─────────┐ ┌─────────┐ ┌─────────┐                  │
│      │ Node 1  │ │ Node 2  │ │ Node 3  │                  │
│      │ Primary │ │ Primary │ │ Primary │                  │
│      └─────────┘ └─────────┘ └─────────┘                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 特点

- 多主模式：所有节点都可以接受写请求
- 自动选主：故障时自动选举新主节点
- 强一致性：基于 Paxos 协议

---

## 模式选择建议

### 选择异步复制

- 数据一致性要求不高
- 追求最高性能
- 可以容忍少量数据丢失

### 选择半同步复制

- 大多数生产环境
- 需要数据安全性和性能的平衡
- 金融、电商等场景

### 选择组复制

- 需要多主架构
- 需要自动故障切换
- 愿意使用 MySQL 8.0+

---

## Java 代码：检测复制状态

```java
@Service
public class ReplicationMonitor {
    @Autowired
    private DataSource dataSource;

    /**
     * 检查主从复制状态
     */
    public ReplicationStatus checkStatus() {
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            ResultSet rs = stmt.executeQuery("SHOW SLAVE STATUS");
            if (rs.next()) {
                ReplicationStatus status = new ReplicationStatus();
                status.setSlaveIORunning(rs.getString("Slave_IO_Running"));
                status.setSlaveSQLRunning(rs.getString("Slave_SQL_Running"));
                status.setSecondsBehindMaster(rs.getInt("Seconds_Behind_Master"));
                status.setRelayLogPos(rs.getLong("Relay_Log_Pos"));

                // 检查是否有延迟
                if (status.getSecondsBehindMaster() > 60) {
                    log.warn("从库延迟 {} 秒", status.getSecondsBehindMaster());
                }

                return status;
            }
            return null;
        }
    }

    /**
     * 检查半同步状态
     */
    public SemiSyncStatus checkSemiSync() {
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            ResultSet rs = stmt.executeQuery(
                "SHOW STATUS LIKE 'Rpl_semi_sync%'");

            SemiSyncStatus status = new SemiSyncStatus();
            while (rs.next()) {
                String variable = rs.getString("Variable_name");
                if ("Rpl_semi_sync_master_status".equals(variable)) {
                    status.setMasterEnabled("ON".equals(rs.getString("Value")));
                }
                if ("Rpl_semi_sync_slave_status".equals(variable)) {
                    status.setSlaveEnabled("ON".equals(rs.getString("Value")));
                }
            }
            return status;
        }
    }
}
```

---

## 一句话总结

三种复制模式代表三种权衡：**异步**最快但最不安全，**半同步**平衡了安全性和性能，**全同步**最安全但性能差。生产环境推荐半同步复制。
