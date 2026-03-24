# MongoDB 高可用故障转移与选举原理

MongoDB 副本集的高可用核心是**故障转移（Failover）**——当主节点宕机时，从节点能够自动选举出新的主节点，保证服务不中断。

这一篇，我来详细讲解故障转移的完整过程。

## 故障转移场景

```javascript
// 场景：3 节点副本集
// Primary: mongo1
// Secondary: mongo2, mongo3

// 故障发生
// mongo1 突然宕机（网络断开、进程崩溃、机器宕机等）

// 期望结果
// mongo2 或 mongo3 选举成为新主节点
// 应用自动连接到新主节点
// 服务继续可用
```

## 故障检测机制

### 心跳机制

副本集成员之间通过心跳检测彼此的状态：

| 参数 | 默认值 | 说明 |
|-----|-------|------|
| `heartbeatTimeoutSecs` | 10 秒 | 心跳超时时间 |
| `heartbeatInterval` | 2 秒 | 心跳间隔 |

```javascript
// 查看心跳配置
rs.conf().settings

// 修改心跳超时
var cfg = rs.conf()
cfg.settings.heartbeatTimeoutSecs = 15
rs.reconfig(cfg)
```

### 状态检测

```javascript
// 查看副本集状态
rs.status()

// 状态说明：
// PRIMARY     - 主节点
// SECONDARY   - 从节点
// RECOVERING  - 恢复中
// STARTUP2    - 初始同步中
// ARBITER     - 仲裁节点
// DOWN        - 不可达
// UNKNOWN     - 状态未知
```

## 选举机制

### 触发选举的条件

| 条件 | 说明 |
|-----|------|
| 主节点不可达 | 心跳超时（默认 10 秒） |
| 从节点发现需要选举 | 选举超时触发 |
| 管理员手动触发 | `replSetStepDown` |
| 副本集配置变更 | 添加/移除节点 |

### 选举流程

```
1. 心跳超时检测
   ↓
2. 从节点发起选举（满足条件）
   ↓
3. 所有节点投票
   ↓
4. 得票超过半数 → 成为新主节点
   ↓
5. 通知应用层
```

### 投票规则

```javascript
// 成为主节点的条件
// 1. 得票超过副本集成员总数的半数
// 2. 数据最新（optime 最接近主节点）
// 3. 优先级 > 0

// 投票权重
// votes: 1 - 普通成员，投 1 票
// votes: 0 - Non-Voting 成员，不投票
// arbiterOnly: true - 仲裁节点，不存储数据

// 示例：5 节点副本集
// 得票超过 2.5（即至少 3 票）才能成为主节点
```

### 优先级与选举

```javascript
// 副本集配置
{
  _id: "rs0",
  members: [
    {_id: 0, host: "mongo1:27017", priority: 3},  // 最优先成为主节点
    {_id: 1, host: "mongo2:27017", priority: 2},
    {_id: 2, host: "mongo3:27017", priority: 1}
  ]
}

// mongo1 故障后
// mongo2 得票最多，成为主节点
```

## 故障转移详细过程

### 步骤 1：检测主节点不可达

```javascript
// mongo2 检测到无法连接 mongo1
// 心跳超时（默认 10 秒）
// mongo2 认为 mongo1 不可达
```

### 步骤 2：发起选举

```javascript
// mongo2 作为候选节点发起选举
// 发送选举请求到所有节点

{
  electionTerm: 5,           // 选举代数
  candidateId: 1,             // mongo2 的 ID
  lastOptime: Timestamp(...), // mongo2 最新的操作时间
  priority: 2                 // mongo2 的优先级
}
```

### 步骤 3：投票

```javascript
// 所有节点收到选举请求后，判断是否投票

// 投票条件：
// 1. 节点可达
// 2. 候选节点数据足够新
// 3. 候选节点优先级 >= 自己的优先级（可选）

// mongo2 获得 mongo3 的投票
// mongo2 得票 2 票，超过半数（3 节点需 2 票）
```

### 步骤 4：成为主节点

```javascript
// mongo2 赢得选举，成为新主节点
// 1. 更新本地状态为 PRIMARY
// 2. 通知其他节点
// 3. 准备接收写操作

// mongo3 收到通知，更新状态为 SECONDARY
```

### 步骤 5：应用层感知

```javascript
// MongoDB Driver 自动处理
// 1. 捕获连接错误
// 2. 重新扫描副本集拓扑
// 3. 连接到新主节点
// 4. 重试失败的操作（如果配置了重试）

// Java Driver 自动重连
try {
  collection.insertOne(document);
} catch (MongoException e) {
  if (e.hasErrorLabel("NotWritablePrimaryError")) {
    // 自动重试，等待新主节点
    Thread.sleep(1000);
    collection.insertOne(document);
  }
}
```

## 选举优先级

### 优先级配置

```javascript
// 优先级范围：0-1000
// priority: 0 - 永不成为主节点
// priority: 1+ - 可以成为主节点

// 普通配置
{_id: 0, host: "mongo1:27017", priority: 2}
{_id: 1, host: "mongo2:27017", priority: 1}
{_id: 2, host: "mongo3:27017", priority: 1}

// 灾难恢复节点（永不成为主节点）
{_id: 3, host: "mongo-dr:27017", priority: 0, hidden: true}
```

### 隐藏节点

```javascript
// 隐藏节点不参与读写，但对应用不可见
// 常用于备份、灾难恢复

{
  _id: 3,
  host: "mongo-backup:27017",
  priority: 0,
  hidden: true
}

// 隐藏节点可以参与选举投票
// votes: 1（参与投票）
// votes: 0（不参与投票）
```

### 延迟节点

```javascript
// 延迟节点：数据比主节点延迟一段时间
// 常用于误删除恢复

{
  _id: 4,
  host: "mongo-delayed:27017",
  priority: 0,
  hidden: true,
  slaveDelay: 3600  // 延迟 1 小时
}

// 注意：延迟节点必须 priority=0, hidden=true
```

## 故障转移时间

### 时间线

```javascript
// 故障检测：10 秒（心跳超时）
// + 选举准备：1-2 秒
// + 选举执行：1-2 秒
// + 状态切换：< 1 秒
// = 总计约 12-15 秒

// 这段时间内：
// - 写入失败（抛出 NotWritablePrimaryError）
// - 读取可能正常（从节点可读）
```

### 优化配置

```javascript
// 减少故障检测时间（谨慎使用）
var cfg = rs.conf()
cfg.settings.heartbeatTimeoutSecs = 5  // 改为 5 秒
rs.reconfig(cfg)

// 注意：设置过短可能导致误判
```

## 常见问题

### 问题 1：网络分区导致脑裂

```javascript
// 场景：网络分区
// Shard 1: mongo1(Primary) 无法连接其他节点
// Shard 2: mongo2, mongo3 可以互相连接

// mongo2 和 mongo3 认为 mongo1 挂了
// mongo2 发起选举，成为新主节点
// 现在有两个「主节点」！

// MongoDB 如何解决：
// 1. 网络分区期间，mongo1 降级为从节点
// 2. 新写入只能在 mongo2 上进行
// 3. 网络恢复后，mongo1 重新同步数据
```

### 问题 2：仲裁节点问题

```javascript
// 场景：2 节点 + 1 仲裁
// mongo1(Primary), mongo2(Secondary), mongo3(Arbiter)

// mongo1 挂了
// mongo2 + mongo3 发起选举
// mongo2 成为主节点

// 问题：mongo2 挂了
// 只有 mongo3（仲裁节点）能投票
// 无法达成多数，无法选举新主节点！

// 解决方案：至少 3 个数据节点
```

### 问题 3：选举代数问题

```javascript
// 选举代数（election term）用于防止脑裂
// 每次选举代数 +1

// 检查选举代数
rs.status().members.forEach(m => {
  print(m.name + ": term=" + m.electionTime)
})
```

## Java 故障转移处理

```java
import com.mongodb.MongoClientSettings;
import com.mongodb.MongoException;
import com.mongodb.ReadPreference;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;

public class FailoverExample {
    public static void main(String[] args) {
        String connectionString = "mongodb://mongo1:27017,mongo2:27017,mongo3:27017"
            + "/?replicaSet=rs0"
            + "&connectTimeoutMS=5000"
            + "&serverSelectionTimeoutMS=5000"
            + "&retryWrites=true"        // 自动重试写入
            + "&retryReads=true";         // 自动重试读取

        try (MongoClient client = MongoClients.create(connectionString)) {
            var collection = client
                .getDatabase("myapp")
                .getCollection("orders");

            // 写入操作会自动处理故障转移
            try {
                collection.insertOne(new Document("orderId", "123"));
            } catch (MongoException e) {
                if (e.hasErrorLabel("NotWritablePrimaryError")) {
                    System.out.println("主节点故障，等待重新选举...");
                    // Driver 会自动重试
                }
            }
        }
    }
}
```

## 监控与告警

### 监控指标

```javascript
// 查看副本集健康状态
rs.status().members.forEach(m => {
  print(m.name + ": " + m.stateStr +
        ", 延迟: " + (Date() - m.optimeDate) + "ms")
})

// 查看选举次数
db.getSiblingDB("admin").runCommand({replSetGetStatus: 1})
  .members.filter(m => m.electionTime)
```

### 告警规则

| 条件 | 说明 |
|-----|------|
| 主节点切换 | 正常情况下不应频繁切换 |
| 从节点延迟 > 1 分钟 | 同步可能有问题 |
| 节点不可达 | 网络或节点故障 |
| 选举频繁 | 可能是网络问题或配置错误 |

## 总结

故障转移完整流程：

| 步骤 | 耗时 | 说明 |
|-----|------|------|
| 心跳超时 | 10 秒 | 检测主节点不可达 |
| 选举发起 | 1-2 秒 | 候选节点发起选举 |
| 投票确认 | 1-2 秒 | 多数投票 |
| 状态切换 | < 1 秒 | 成为新主节点 |
| **总计** | **12-15 秒** | 期间写入不可用 |

**高可用设计原则**：
1. 至少 3 个数据节点
2. 合理配置优先级
3. 监控主节点切换
4. 使用合适的读取偏好

**故障转移对应用的影响**：
- 写入失败约 12-15 秒
- 读取可能读取到旧数据（从节点延迟）
- Driver 自动重连和重试

---

**下一步，你可以：**

- 学习 [MongoDB WiredTiger 存储引擎原理](/database/mongodb/wiredtiger)
- 了解 [MongoDB 内存管理](/database/mongodb/memory)
- 掌握 [MongoDB 性能监控](/database/mongodb/monitor)
