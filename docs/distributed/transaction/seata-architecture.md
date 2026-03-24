# Seata 整体架构：TC、TM、RM 角色

Seata 是蚂蚁金服开源的分布式事务解决方案。

它的架构设计非常精妙：**一个协调中心 + 多个参与者的经典模式。**

## Seata 的三大角色

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                      TC (Transaction Coordinator)          │
│                      事务协调中心（独立部署）                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │                                      │
         │                                      │
         ▼                                      ▼
┌─────────────────┐                    ┌─────────────────┐
│                 │                    │                 │
│  TM (Transaction Manager)            │  RM (Resource Manager)
│  事务管理器（嵌入应用）                 │  资源管理器（嵌入应用）
│                 │                    │                 │
│  @GlobalTransac │                    │  数据库连接      │
│  tional         │                    │  TCC 接口        │
│                 │                    │                 │
└─────────────────┘                    └─────────────────┘
         │
         ▼
┌─────────────────┐
│                 │
│  业务数据库       │
│                 │
│  undo_log 表    │
│                 │
└─────────────────┘
```

## TC：事务协调中心

TC 是 Seata 的核心，负责：
1. **全局事务管理**：创建、提交、回滚全局事务
2. **分支事务注册**：接收 RM 注册的分支事务
3. **全局锁管理**：维护跨全局事务的行锁
4. **会话管理**：管理 TC、TM、RM 之间的通信会话

```java
/**
 * TC（Transaction Coordinator）职责
 */
public class TransactionCoordinator {
    
    /**
     * 创建全局事务
     * 
     * @return XID（全局事务 ID）
     */
    public String begin() {
        // 1. 生成全局唯一的 XID
        String xid = UUID.randomUUID().toString();
        
        // 2. 创建全局会话
        GlobalSession session = new GlobalSession(xid);
        
        // 3. 持久化会话（数据库/Redis）
        sessionStore.save(session);
        
        return xid;
    }
    
    /**
     * 注册分支事务
     */
    public void registerBranch(String xid, BranchSession branch) {
        // 1. 获取全局会话
        GlobalSession session = sessionStore.get(xid);
        
        // 2. 添加分支会话
        session.addBranch(branch);
        
        // 3. 申请全局锁（如果需要）
        if (branch.needsGlobalLock()) {
            boolean locked = globalLockManager.lock(
                branch.getResourceId(),
                branch.getPrimaryKeys()
            );
            
            if (!locked) {
                throw new LockConflictException("获取全局锁失败");
            }
        }
        
        // 4. 持久化分支会话
        sessionStore.update(session);
    }
    
    /**
     * 全局事务提交
     */
    public void commit(String xid) {
        // 1. 获取全局会话
        GlobalSession session = sessionStore.get(xid);
        
        // 2. 通知所有分支提交
        for (BranchSession branch : session.getBranches()) {
            branch.commit();
        }
        
        // 3. 删除会话
        sessionStore.remove(xid);
    }
    
    /**
     * 全局事务回滚
     */
    public void rollback(String xid) {
        // 1. 获取全局会话
        GlobalSession session = sessionStore.get(xid);
        
        // 2. 通知所有分支回滚
        for (BranchSession branch : session.getBranches()) {
            branch.rollback();
        }
        
        // 3. 释放全局锁
        globalLockManager.unlock(session.getBranchSessions());
        
        // 4. 删除会话
        sessionStore.remove(xid);
    }
}
```

## TM：事务管理器

TM 嵌入业务应用，负责：
1. **发起全局事务**：通过 `@GlobalTransactional` 注解发起
2. **管理事务边界**：标记全局事务的开始和结束
3. **与 TC 通信**：注册分支、提交/回滚

```java
/**
 * TM（Transaction Manager）职责
 */
@GlobalTransactional
public class OrderService {
    
    public void createOrder(Order order) {
        // TM 在这里开始了全局事务
        
        // 1. 扣库存（RM）
        inventoryService.decreaseStock(order.getProductId(), order.getCount());
        
        // 2. 创建订单（RM）
        orderDao.insert(order);
        
        // 3. 扣余额（RM）
        accountService.decreaseBalance(order.getUserId(), order.getAmount());
        
        // TM 在方法结束时结束全局事务
        // - 如果方法正常返回：TC 通知所有分支提交
        // - 如果方法抛出异常：TC 通知所有分支回滚
    }
}
```

```java
/**
 * @GlobalTransactional 注解的工作原理
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface GlobalTransactional {
    String name() default "";           // 事务名称
    int timeout() default 30000;       // 超时时间
    String transactionManagerGroup()     // 事务管理器组
        default "default";
}
```

## RM：资源管理器

RM 嵌入数据库连接/TCC 接口，负责：
1. **注册分支事务**：向 TC 注册本地事务
2. **执行本地事务**：执行业务 SQL 或 TCC Try
3. **上报事务状态**：向 TC 上报成功/失败
4. **响应 TC 指令**：执行 TC 的提交/回滚指令

### AT 模式 RM

```java
/**
 * AT 模式 RM
 */
public class ATResourceManager {
    
    /**
     * 执行分支事务（一阶段）
     */
    public BranchStatus executeBranch(
        String xid,
        BranchSession branchSession,
        String[] args
    ) {
        // 1. 开启数据库连接
        Connection conn = getConnection(branchSession.getResourceId());
        
        // 2. 解析 SQL
        SqlRecognizer recognizer = SqlRecognizerFactory.get(
            branchSession.getSqlType(),
            branchSession.getSql()
        );
        
        // 3. 记录前镜像
        TableRecords beforeImage = recognizer.getBeforeImage(conn, args);
        
        // 4. 执行 SQL
        int affectedRows = recognizer.execute(conn, args);
        
        // 5. 记录后镜像
        TableRecords afterImage = recognizer.getAfterImage(conn, args);
        
        // 6. 生成 undo log
        BranchUndoLog undoLog = new BranchUndoLog();
        undoLog.setXid(xid);
        undoLog.setBranchId(branchSession.getBranchId());
        undoLog.setBeforeImage(beforeImage);
        undoLog.setAfterImage(afterImage);
        
        // 7. 保存 undo log
        saveUndoLog(undoLog);
        
        // 8. 上报 TC
        tcServer.reportBranchStatus(
            xid,
            branchSession.getBranchId(),
            BranchStatus.PhaseOne_Finished
        );
        
        return BranchStatus.PhaseOne_Finished;
    }
    
    /**
     * 回滚分支事务
     */
    public void rollbackBranch(String xid, long branchId) {
        // 1. 读取 undo log
        BranchUndoLog undoLog = loadUndoLog(xid, branchId);
        
        // 2. 获取连接
        Connection conn = getConnection(undoLog.getResourceId());
        
        // 3. 使用前镜像还原数据
        for (Record record : undoLog.getBeforeImage().getRecords()) {
            String sql = buildReverseSql(record);
            conn.createStatement().executeUpdate(sql);
        }
        
        // 4. 删除 undo log
        deleteUndoLog(xid, branchId);
        
        // 5. 释放全局锁
        tcServer.releaseLock(xid, branchId);
    }
}
```

### TCC 模式 RM

```java
/**
 * TCC 模式 RM
 */
public class TCCResourceManager {
    
    /**
     * 执行 Try 阶段
     */
    public BranchStatus executeTCC(
        String xid,
        String actionName,
        TCCBusinessAction businessAction,
        Object[] args
    ) {
        try {
            // 1. 执行 Try 方法
            boolean success = businessAction.tryInvoke(args);
            
            if (success) {
                // 2. 上报 TC：Try 成功
                tcServer.reportBranchStatus(
                    xid,
                    businessAction.getBranchId(),
                    BranchStatus.PhaseOne_Finished
                );
                return BranchStatus.PhaseOne_Finished;
            } else {
                // 3. 上报 TC：Try 失败
                tcServer.reportBranchStatus(
                    xid,
                    businessAction.getBranchId(),
                    BranchStatus.PhaseOne_Failed
                );
                return BranchStatus.PhaseOne_Failed;
            }
            
        } catch (Exception e) {
            // 4. Try 异常
            tcServer.reportBranchStatus(
                xid,
                businessAction.getBranchId(),
                BranchStatus.PhaseOne_Failed
            );
            return BranchStatus.PhaseOne_Failed;
        }
    }
}
```

## TC 的部署模式

### 单机模式（开发/测试）

```
┌─────────────────────┐
│                     │
│   TC Server         │
│   (单节点)          │
│                     │
└─────────────────────┘
         │
         ▼
    Session Store：File/Redis
```

### 集群模式（生产）

```
┌─────────────────────┐
│                     │
│   TC Server 1       │
│   (主节点)          │
│                     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│                     │
│   TC Server 2       │
│   (从节点)          │
│                     │
└─────────────────────┘
           │
           ▼
    Session Store：DB/Redis
    (多节点共享)
```

```java
/**
 * TC 高可用：主节点选举
 */
public class TCLeaderElection {
    
    /**
     * 抢主逻辑
     * 
     * 使用数据库行锁实现抢主
     */
    public boolean tryBecomeLeader() {
        // UPDATE tc_server SET leader = ? WHERE id = ? AND leader IS NULL
        int affectedRows = jdbcTemplate.update(
            "UPDATE tc_server SET leader = ? WHERE id = ? AND leader IS NULL",
            currentServerId,
            serverId
        );
        
        return affectedRows > 0;
    }
    
    /**
     * 心跳保活
     */
    public void heartbeat() {
        // UPDATE tc_server SET last_heartbeat = ? WHERE id = ?
        jdbcTemplate.update(
            "UPDATE tc_server SET last_heartbeat = ? WHERE id = ?",
            System.currentTimeMillis(),
            currentServerId
        );
    }
}
```

## Seata 与 Spring Cloud 集成

```xml
<!-- Seata 依赖 -->
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-seata</artifactId>
</dependency>
```

```java
@EnableDiscoveryClient
@SpringBootApplication
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

```yaml
# application.yml
seata:
  tx-service-group: my_tx_group        # 事务分组
  registry:
    type: nacos                         # 注册中心
    nacos:
      server-addr: 127.0.0.1:8848
  config:
    type: nacos                         # 配置中心
    nacos:
      server-addr: 127.0.0.1:8848
```

```java
/**
 * 使用 @GlobalTransactional
 */
@Service
public class OrderService {
    
    @GlobalTransactional(name = "create-order", rollbackFor = Exception.class)
    public void createOrder(OrderDTO orderDTO) {
        // TM 自动向 TC 注册全局事务
        // XID 自动在调用链中传递
        
        // 1. 扣库存
        inventoryService.decreaseStock(orderDTO.getProductId(), orderDTO.getCount());
        
        // 2. 创建订单
        orderDao.insert(orderDTO.toOrder());
        
        // 3. 扣余额
        accountService.decreaseBalance(orderDTO.getUserId(), orderDTO.getAmount());
    }
}
```

## 面试追问方向

**追问 1：TC 挂了怎么办？**

Seata TC 高可用：
1. **多 TC 节点集群**：通过 DB/Redis 共享状态
2. **主节点选举**：使用 DB 行锁抢主
3. **故障转移**：主节点挂了，从节点自动接管

分支事务的恢复：
- RM 侧会保存分支会话信息
- TC 恢复后，主动通知 RM 继续处理

**追问 2：Seata AT 模式的全局锁和数据库锁会冲突吗？**

不会冲突：
- **数据库锁**：防止并发事务之间的脏写（InnoDB 行锁）
- **全局锁**：防止跨全局事务的脏写（Seata TC 维护）

两者配合，共同保证隔离性。

**追问 3：Seata 如何保证高性能？**

1. **异步处理**：二阶段（Commit/Rollback）是异步的
2. **连接复用**：同一线程复用同一个数据库连接
3. **批量处理**：批量注册分支、批量上报状态
4. **热点优化**：热点 key 的锁分离

## 总结

Seata 架构的核心设计：

1. **TC 独立部署**：事务协调中心，高可用集群
2. **TM 嵌入应用**：通过注解发起全局事务
3. **RM 嵌入资源**：数据库/TCC 接口参与事务
4. **XID 串联调用链**：全局事务 ID 在整个调用链中传递

Seata 的优势：
1. **零侵入**：AT 模式对业务代码无侵入
2. **高性能**：二阶段异步处理，减少锁持有时间
3. **高可用**：TC 集群部署，无单点问题
