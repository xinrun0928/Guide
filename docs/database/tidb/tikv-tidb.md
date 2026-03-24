# TiKV 与 TiDB 的关系：存储与计算的协作

很多人对 TiKV 和 TiDB 的关系感到困惑：

- TiDB 是数据库，我知道
- TiKV 是什么？也是一个数据库吗？
- 它们之间是什么关系？可以单独用吗？

这是一个很好的问题。理解 TiKV 和 TiDB 的关系，是理解 TiDB 架构的关键。

## TiDB = TiDB Server + TiKV + PD

TiDB 是一个完整的分布式数据库，而 TiKV 是它的存储引擎。

```
┌─────────────────────────────────────────────────────┐
│                     TiDB 数据库                      │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │              TiDB Server（SQL 层）              │ │
│  │                                                │ │
│  │  - SQL 解析                                     │ │
│  │  - 查询优化                                      │ │
│  │  - 执行计划                                       │ │
│  │  - 分布式查询协调                                  │ │
│  └────────────────────────────────────────────────┘ │
│                         ↕                           │
│  ┌────────────────────────────────────────────────┐ │
│  │            TiKV（分布式存储引擎）                 │ │
│  │                                                │ │
│  │  - 数据持久化                                     │ │
│  │  - 分布式事务（MVCC + Raft）                       │ │
│  │  - Region 管理                                    │ │
│  │  - 自动扩缩容                                      │ │
│  └────────────────────────────────────────────────┘ │
│                         ▲                           │
│  ┌────────────────────────────────────────────────┐ │
│  │           PD（调度 + 元信息 + TSO）               │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

类比一下：

```
TiDB = MySQL（计算） + InnoDB（存储） + MySQL 运维工具（调度）

更准确的类比：
TiDB = TiDB Server（计算） + TiKV（存储） + PD（调度）

或者用编程语言来类比：
TiDB = Java 编译器 + JVM + GC
TiKV = JVM + GC
PD = 类加载器 + JIT 编译器配置
```

## TiKV 是什么？

TiKV 是一个 **分布式 Key-Value 存储引擎**，用 Rust 语言开发。

它的核心能力：
- **强一致性**：通过 Raft 协议保证
- **高可用**：多数派复制，自动故障转移
- **水平扩展**：通过 Region 分片，支持 PB 级数据
- **MVCC**：多版本并发控制，支持分布式事务

```java
// TiKV 本质上是一个 KV 数据库
// 它的 API 是这样的：

public class TiKVClient {
    // 写入：key -> value
    public void put(byte[] key, byte[] value);

    // 读取：获取 key 对应的 value
    public byte[] get(byte[] key);

    // 删除
    public void delete(byte[] key);

    // 范围扫描
    public List&lt;byte[]&gt; scan(byte[] startKey, byte[] endKey);

    // 事务：类似于 KV 版本的 BEGIN/COMMIT
    public void begin();
    public void commit();
    public void rollback();
}
```

**TiKV 本身不支持 SQL**，只支持 Key-Value 操作。

## TiDB Server 做了什么？

TiDB Server 负责把 SQL 转换为 KV 操作：

```java
// TiDB Server 的核心职责
public class TiDBServer {
    private TiKVClient kvClient;

    public void executeQuery(String sql) {
        // 1. SQL 解析：生成 AST
        AST ast = parser.parse(sql);

        // 2. 语义分析：解析表名、字段名、类型
        ResolvedAST resolved = analyzer.resolve(ast);

        // 3. 查询优化：生成执行计划
        Plan plan = optimizer.optimize(resolved);

        // 4. 分布式执行：转换为 KV 操作
        List&lt;KvRequest&gt; requests = plan.toKvRequests();

        // 5. 并行发送到 TiKV
        List&lt;KvResult&gt; results = parallelExecute(requests);

        // 6. 聚合结果
        return aggregator.aggregate(results);
    }
}
```

举个例子：

```sql
SELECT name, SUM(amount) FROM orders
WHERE created_at > '2024-01-01'
GROUP BY name;
```

TiDB Server 会把这个 SQL 转换成：

```
1. 扫描 Region：找到所有 created_at > '2024-01-01' 的数据
2. 过滤：只保留 name 和 amount 字段
3. 聚合：相同 name 的 amount 求和
4. 返回结果
```

## TiKV 的独立使用

TiKV 不仅服务于 TiDB，它也可以**作为独立的 KV 存储**使用。

```java
// 使用 TiKV Java 客户端直接操作 KV
public class TiKVExample {
    public static void main(String[] args) {
        // 创建 TiKV 客户端
        TiConfiguration config = new TiConfiguration(
            pdAddrs: "127.0.0.1:2379"
        );
        TiKVEndpoint kvClient = TiKV.createTiKV(config);

        // 基本操作
        kvClient.put("user:1001".getBytes(), "{\"name\": \"Alice\"}".getBytes());
        byte[] value = kvClient.get("user:1001".getBytes());
        kvClient.delete("user:1001".getBytes());

        // 范围扫描
        List&lt;byte[]&gt; users = kvClient.scan(
            "user:".getBytes(),  // start
            "user:\xff".getBytes()  // end
        );

        // 事务（乐观锁）
        Transaction txn = kvClient.begin();
        txn.put("balance:1001".getBytes(), "1000".getBytes());
        txn.commit();
    }
}
```

### TiKV 的应用场景

| 场景 | 说明 | 优势 |
|-----|------|------|
| 分布式锁 | 用 TiKV 实现 Redis 类似的分布式锁 | 比 Redis 更强的一致性保证 |
| 配置中心 | 存储配置数据，支持监听变更 | 强一致，容量大 |
| 消息队列 | 存储消息偏移量、消费位点 | 高可靠，持久化 |
| 服务发现 | 存储服务注册信息 | 强一致，支持 TTL |
| 元数据存储 | 存储数据库元信息 | 高可用，强一致 |

### TiKV vs etcd

很多人把 TiKV 和 etcd 做对比。确实，它们有很多相似之处：

| 特性 | TiKV | etcd |
|-----|------|------|
| 数据模型 | KV | KV |
| 一致性 | Raft（多数派） | Raft（多数派） |
| 事务 | MVCC 两阶段提交 | 不支持 |
| 容量 | PB 级 | GB 级 |
| 场景 | 通用存储 | 服务发现、配置中心 |
| 生态 | TiDB | Kubernetes |

**简单来说：etcd 是为元数据设计的（数据量小，强一致），TiKV 是为业务数据设计的（数据量大，支持事务）。**

## TiDB Server 与 TiKV 的通信

TiDB Server 和 TiKV 之间通过 gRPC 通信，使用 Google Protocol Buffers 定义接口。

```protobuf
// TiKV 的 KV 接口（简化版）
message KvGetRequest {
    bytes key = 1;
    int64 version = 2;  // start_ts
}

message KvGetResponse {
    bytes value = 1;
    int64 version = 2;
}

message KvPrewriteRequest {
    bytes key = 1;
    bytes value = 1;
    int64 start_ts = 2;
    bytes primary_key = 3;
}

message KvCommitRequest {
    bytes key = 1;
    int64 start_ts = 2;
    int64 commit_ts = 3;
}
```

TiDB Server 会缓存 Region 的位置信息，避免每次都问 PD：

```
TiDB Server 本地缓存：
┌─────────────────────────────────┐
│ Region 1: [0, 500000)  →  TiKV-A │
│ Region 2: [500000, 1000000) → TiKV-B │
│ Region 3: [1000000, +∞)  →  TiKV-C │
└─────────────────────────────────┘
```

当 Region 分裂或迁移时，TiKV 会返回「Key 不在本 Region」的错误，TiDB Server 会重新问 PD 更新缓存。

## 面试追问

**Q: 可以用 TiKV 替代 Redis 吗？**

可以，但不推荐。TiKV 的延迟比 Redis 高（毫秒 vs 微秒级），适合对一致性要求高的场景。Redis 适合缓存、限流、session 存储等对延迟敏感的场景。

**Q: TiKV 的数据可靠性如何？**

TiKV 使用 Raft 多数派复制，默认 3 副本。只要多数派节点存活，数据就不会丢失。相比传统主从复制，TiKV 的 Raft 复制更可靠（不会因异步复制丢数据）。

**Q: TiDB Server 宕机会影响数据吗？**

不会。TiDB Server 是无状态的，宕机后客户端连接其他 TiDB Server 即可。数据存在 TiKV，不受 TiDB Server 影响。

**Q: TiKV 可以跑在 Kubernetes 上吗？**

可以。TiKV Operator 让 TiKV 集群可以跑在 K8s 上，实现自动扩缩容、自愈、滚动升级。生产环境中推荐使用 TiDB Operator 管理集群。

---

## 总结

TiKV 是 TiDB 的存储引擎，两者关系密切但职责分明：

- **TiDB Server**：SQL 层，负责解析、优化、执行分布式查询
- **TiKV**：存储层，负责数据持久化、一致性保证、水平扩展
- **PD**：调度层，负责元信息管理、Leader 调度、TSO 分配

理解这个分层架构，就理解了 TiDB 的设计哲学：**用专业组件做专业事，组合成一个强大的分布式数据库。**
