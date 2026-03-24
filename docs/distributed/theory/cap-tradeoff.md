# CAP 权衡：CP 与 AP 的选择

你负责设计一个秒杀系统，库存只有 100 件，瞬间涌入 10 万人。

你选择 CP：每次下单前先确认库存一致，10 万人排队，最终只有 100 人成功，公平公正。

你选择 AP：先到先得，后下单的人可能发现库存已经卖完但系统没及时更新。

**哪种选择是对的？**

没有标准答案。选 CP 还是 AP，本质上是回答一个问题：**你的业务能容忍什么？**

## 场景驱动的选择方法论

做 CAP 选择时，不要背答案，要分析业务场景。问自己三个问题：

**问题 1：数据不一致会带来什么后果？**

| 不一致后果 | 严重程度 | 建议选择 |
|---------|--------|---------|
| 用户余额出错 | 灾难性，可能涉及金钱 | CP |
| 订单状态错误 | 严重，用户体验差 | CP |
| 库存数量偏差 | 中等，可通过补偿解决 | AP |
| 页面访问量 | 低，不影响核心业务 | AP |

**问题 2：服务不可用会带来什么后果？**

| 不可用后果 | 严重程度 | 建议选择 |
|---------|--------|---------|
| 支付无法进行 | 灾难性，直接损失 | AP（保证可用） |
| 搜索结果延迟 | 可接受 | AP |
| 配置无法更新 | 中等，可能影响功能 | CP |
| 订单创建失败 | 严重 | AP |

**问题 3：你能接受的恢复时间是多少？**

如果业务要求 7x24 小时零中断，那 CP 系统在网络分区时的「停止服务」可能是你无法承受的。

## CP 系统的典型场景

### 金融交易系统

银行转账、证券交易、支付系统——这些场景下，数据不一致可能导致金钱损失，这是绝对不可接受的。

```
典型代表：ZooKeeper、etcd、HBase

特点：
- 强一致性保证
- 分区时拒绝服务
- 适合对数据准确性要求极高的场景
```

### 配置管理

分布式系统中的配置变更，必须保证所有节点看到的是同一份配置，否则可能出现「一半节点用新配置、一半用旧配置」的混乱。

```java
/**
 * CP 配置中心示例：配置变更必须原子性地应用到所有节点
 * ZooKeeper 的 watch 机制保证了配置的强一致性
 */
public class ConfigManagement {
    /**
     * 配置变更流程：
     * 1. 写入配置到 ZooKeeper（需要 Leader 处理）
     * 2. 等待所有 Follower 确认
     * 3. 配置生效
     * 
     * 如果在写入过程中发生分区，操作失败，配置保持原样
     */
    public void updateConfig(String key, String value) {
        // ZooKeeper Write Path
    }
}
```

### 分布式锁

```java
/**
 * 分布式锁必须满足 CP 特性
 * 否则可能出现：两个节点同时获取锁，导致数据被破坏
 */
public class DistributedLock {
    /**
     * ZooKeeper 实现：创建临时顺序节点
     * 获取锁 = 创建节点成功
     * 释放锁 = 删除节点
     * 
     * 如果 Leader 崩溃，需要重新选举，期间无法获取锁
     * 这是 CP 的代价
     */
    public boolean tryLock(String lockPath) {
        return false; // ZooKeeper 实现
    }
}
```

## AP 系统的典型场景

### 社交媒体 feed 流

你发了一条朋友圈，5 秒后你朋友看到了——这个「5 秒延迟」完全可以接受。但如果因为分区导致你的朋友看不到任何内容，这才是真正的灾难。

```
典型代表：Cassandra、DynamoDB、Redis Cluster

特点：
- 高可用性保证
- 允许读取过期数据
- 适合对可用性要求极高的场景
```

### 内容分发网络（CDN）

CDN 的核心是「让用户就近访问」，每个边缘节点维护自己的缓存。更新一个资源时，不可能同时更新全球所有节点——最终所有节点都会同步，但中间会有不一致的窗口。

```java
/**
 * AP 内容分发示例：最终一致性
 */
public class CDNContentDistribution {
    /**
     * 写入流程：
     * 1. 写入源站（强一致）
     * 2. 异步推送到边缘节点（可能延迟）
     * 3. 用户就近读取（可能读取到旧数据）
     * 
     * 用户体验：几乎总是能获取内容，只是可能不是最新的
     */
    public void publishContent(String contentId, byte[] content) {
        // 写入源站
        writeToOrigin(contentId, content);
        // 异步推送到 CDN
        asyncPushToCDN(contentId, content);
    }
}
```

### 物联网传感器数据

传感器每秒上报大量数据，偶尔丢失几条数据不影响整体分析。但如果因为网络分区导致所有传感器都停止上报，那才是问题。

## 如何混合使用 CP/AP

### 策略一：数据分级

不同数据采用不同策略：

```java
/**
 * 电商系统的数据分级策略
 */
public class ECommerceDataStrategy {
    /**
     * 强一致性数据：核心业务，用户必须看到正确数据
     */
    public static final int CONSISTENCY_LEVEL_STRONG = 0;
    
    /**
     * 弱一致性数据：辅助信息，允许短暂不一致
     */
    public static final int CONSISTENCY_LEVEL_WEAK = 1;
    
    /**
     * 最终一致性数据：统计、缓存，允许较长时间不一致
     */
    public static final int CONSISTENCY_LEVEL_EVENTUAL = 2;
    
    /**
     * 根据数据类型选择一致性策略
     */
    public void handleOrder(Order order) {
        // 订单核心状态：同步强一致（调用 ZooKeeper/etcd）
        syncWrite(order.getId(), order.getStatus(), CONSISTENCY_LEVEL_STRONG);
        
        // 订单详情页浏览量：异步最终一致（写入本地后批量同步）
        asyncIncrement(order.getId(), "view_count", CONSISTENCY_LEVEL_EVENTUAL);
        
        // 用户个性化推荐：完全异步（定期批量更新）
        batchUpdateRecommendations(order.getUserId());
    }
}
```

### 策略二：读写分离

```java
/**
 * 读写分离：不同操作使用不同一致性级别
 */
public class ReadWriteSeparationStrategy {
    /**
     * 写入操作：需要强一致性
     * 同步写入多个副本，多数派确认后才返回成功
     */
    public void strongWrite(String key, String value) {
        // 同步写入 N/2+1 个节点
        // 任何一个节点失败，写入失败
    }
    
    /**
     * 读取操作：可以选择最终一致
     * 读取一个副本即可，快速返回
     */
    public String eventualRead(String key) {
        // 读取最近的节点
        return readFromNearestReplica(key);
    }
    
    /**
     * 读取操作：也可以选择强一致
     * 读取多个副本，仲裁确认
     */
    public String strongRead(String key) {
        // 读取 N/2+1 个节点，取最新版本
        return quorumRead(key);
    }
}
```

## 实际工程中的权衡案例

### 案例一：Dubbo 的负载均衡策略

Dubbo 支持多种负载均衡策略，其中「一致性哈希」算法体现了对 AP 的偏好：

```
一致性哈希 + 虚拟节点 = AP 优先
某个节点宕机，请求自动路由到其他节点，用户无感知
```

### 案例二：HBase 的 CAP 选择

HBase 是一个「写 CP、读可选」的系统：

```
写操作：必须通过 RegionServer 的主节点，强一致
读操作：可以配置读取本地副本（低延迟但可能过期）或读取主副本（强一致但高延迟）
```

### 案例三：RocketMQ 的消息存储

```
同步刷盘：CP，保证消息不丢失，但吞吐低
异步刷盘：AP，吞吐高，但断电可能丢失少量消息
```

## 选择检查清单

在做 CAP 选择前，用这个清单过一遍：

| 检查项 | 如果选 CP | 如果选 AP |
|-----|---------|---------|
| 网络分区时 | 服务不可用 | 数据可能不一致 |
| 数据准确性 | 高 | 中低 |
| 响应延迟 | 可能较高 | 通常较低 |
| 吞吐量 | 受限于强一致协议 | 较高 |
| 故障恢复 | 需要重新同步 | 自动恢复 |

## 总结

CP vs AP 不是考试题，而是设计哲学的选择：

1. **CP 系统**：数据准确性 > 服务可用性（金融、配置、锁）
2. **AP 系统**：服务可用性 > 数据准确性（社交、CDN、IoT）
3. **混合策略**：不同数据用不同策略（大多数成熟系统的选择）

> "没有最好的架构，只有最合适的架构。理解 CAP 权衡，你就能为每种业务场景找到最优解。"
