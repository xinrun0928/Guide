# Leader 调度：数据热点的终结者

你的 TiDB 集群跑了半年，最近发现不对劲：

- 监控显示 CPU 使用率 30%，但某几个节点 90%
- 写入 QPS 10 万，大部分打在 3 个节点上
- 其他节点空闲得很，资源严重浪费

这不是硬件问题，是 **Leader 分布不均** 导致的热点。

TiDB 的 PD 调度器会持续监控和调整 Leader 位置，让数据均匀分布。但为什么会出现热点？PD 又是怎么处理的？

## Leader 热点的成因

### 场景一：时序数据的写入热点

最典型的场景——自增主键：

```sql
-- 自增主键的写入分布
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ...
);

-- 插入数据：
INSERT INTO orders VALUES (1, ...);  -- Key: table:orders:r:1
INSERT INTO orders VALUES (2, ...);  -- Key: table:orders:r:2
INSERT INTO orders VALUES (3, ...);  -- Key: table:orders:r:3
...
INSERT INTO orders VALUES (10000000, ...);  -- Key: table:orders:r:10000000
```

新数据总是追加到 Key 范围的最大端，所有写入都会落到最后一个 Region。这个 Region 的 Leader 就是热点。

### 场景二：热点数据访问不均

比如电商的秒杀商品：

```sql
-- 99% 的用户都在访问这个商品
SELECT * FROM products WHERE id = 1001;
```

热门商品数据所在的 Region 会被高频访问，即使数据不大，Leader 也会成为瓶颈。

## PD 的调度策略

PD（Placement Driver）是 TiKV 的调度中心，它有一套完整的调度规则来解决热点问题。

```java
// PD 调度器的核心组件
public class Scheduler {
    // 1. Leader 数量均衡器
    // 目标：每个 TiKV 节点的 Leader 数量大致相等
    public class LeaderBalanceScheduler {
        public boolean shouldMove(Peer peer, Store from, Store to) {
            // from 节点的 Leader 太多
            // to 节点的 Leader 太少
            // 且差值超过阈值
            return from.leaderCount() > to.leaderCount() + 10;
        }
    }

    // 2. Region 数量均衡器
    // 目标：每个 TiKV 节点的 Region 数量大致相等
    public class RegionBalanceScheduler {
        // 考虑因素：节点容量、Label（机架、机房）
    }

    // 3. 热点 Region 调度器
    // 目标：分散热点 Region 的 Leader
    public class HotRegionScheduler {
        // 统计每个 Region 的读写 QPS
        // 如果某个 Region QPS 超过阈值
        // 触发 Leader 迁移
    }
}
```

### 调度流程

```
PD 监控循环：
┌─────────────────────────────────────────────────┐
│                                                 │
│  1. 收集信息 ←── TiKV 心跳上报                   │
│         │                                      │
│         ▼                                      │
│  2. 计算调度 ──► 是否需要迁移 Leader？            │
│         │                                      │
│         │ Yes                                   │ No
│         ▼                                      │
│  3. 生成调度 operator                           │
│         │                                      │
│         ▼                                      │
│  4. 下发到 TiKV 执行                            │
│         │                                      │
│         ▼                                      │
│  5. 等待确认，重复                              │
│                                                 │
└─────────────────────────────────────────────────┘
```

## 解决写入热点

### 方案一：AUTO_RANDOM 主键

这是 TiDB 推荐的方案，用随机 ID 替代自增 ID，让写入分散到多个 Region。

```sql
-- 使用 AUTO_RANDOM
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_RANDOM,  -- 随机分配
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2)
);

-- 插入数据后，ID 不再连续
INSERT INTO orders (user_id, amount) VALUES (1, 100);
-- 返回：1, AUTO_RANDOM=58230948123456789

INSERT INTO orders (user_id, amount) VALUES (1, 200);
-- 返回：2, AUTO_RANDOM=19283746501928374

INSERT INTO orders (user_id, amount) VALUES (1, 300);
-- 返回：3, AUTO_RANDOM=72345678901234567
```

```java
// AUTO_RANDOM 的 ID 生成逻辑
public class AutoRandomIdGenerator {
    // TiDB 6.0+: AUTO_RANDOM 分为 3 部分
    // | 保留位 (5bit) | 随机高位 (max - 逻辑时间戳的高位) | 随机低位 (auto_random_bits) |

    public long generate(int autoRandomBits) {
        long timestamp = System.currentTimeMillis();
        // 保留 5 位供业务使用
        long reservedBits = 0;
        // 随机高位取时间戳的一部分
        long highRandom = (timestamp >> 16) & ((1L << (autoRandomBits - 5)) - 1);
        // 随机低位取随机数
        long lowRandom = ThreadLocalRandom.current().nextLong(1L << (autoRandomBits - 5));
        return reservedBits | (highRandom << (32 - autoRandomBits)) | lowRandom;
    }
}
```

### 方案二：SHARD_ROW_ID_BITS

对于已有表，可以通过 SHARD_ROW_ID_BITS 强制将数据分散到多个 Region。

```sql
-- 已有大表，改成分片
ALTER TABLE orders SHARD_ROW_ID_BITS = 4;
-- 2^4 = 16 个分片，写入分散到 16 个 Region

-- 查看分片情况
SHOW TABLE orders REGIONS;
```

### 方案三：业务层打散写入

在应用层将写入分散到不同的「虚拟分片」：

```java
// 业务层写入打散
public class ShardedWriter {
    // 假设有 10 个 TiKV 节点

    public void writeOrder(Order order) {
        // 根据 user_id 哈希选择「写入口」
        int shard = Math.abs(order.getUserId().hashCode()) % 10;
        String writeEndpoint = endpoints.get(shard);

        // 写入对应的 TiDB Server
        // 实际数据会路由到对应的 Region
        jdbcTemplate.setUrl(writeEndpoint);
        jdbcTemplate.update(sql, order.toValues());
    }
}
```

## 解决读取热点

读取热点的解决方案是将 Leader 迁移到冷节点：

```bash
# 查看热点 Region
pd-ctl region --hot

# 手动迁移 Leader 到指定节点
pd-ctl operator add transfer-leader region 1234 to store 5
```

```java
// PD 自动处理热点的逻辑
public class HotRegionHandler {
    // 统计维度：读 QPS、写 QPS、流量
    public void detectHotRegions() {
        for (HotRegion region : hotRegions) {
            // 如果 Region 的 Leader 和 Follower 分布不均
            // 将 Leader 迁移到流量小的节点
            if (region.leaderDistributionUnbalanced()) {
                Store target = findStoreWithMinRead流量();
                operator.add(new TransferLeaderOp(region, target));
            }

            // 如果 Region 整体过热，考虑分裂
            if (region.size() > 96MB && region.isHot()) {
                operator.add(new SplitOp(region));
            }
        }
    }
}
```

## 调度参数调优

PD 的调度行为可以通过参数控制：

```bash
# 查看当前调度配置
pd-ctl config show

# 调整 Leader 调度速度（默认 4 个/分钟）
pd-ctl config set leader-schedule-limit 8

# 调整 Region 调度速度
pd-ctl config set region-schedule-limit 4

# 调整热点调度速度
pd-ctl config set hot-region-schedule-limit 4

# 关闭某些调度器
pd-ctl config set enable-tombstone-recovery false
pd-ctl config set enable-remove-down-replica false
```

| 参数 | 默认值 | 说明 | 调大场景 | 调小场景 |
|-----|-------|------|---------|---------|
| leader-schedule-limit | 4 | Leader 调度并发数 | 热点严重 | 业务延迟敏感 |
| region-schedule-limit | 2048 | Region 调度并发数 | 扩容后均衡慢 | 不想频繁迁移 |
| hot-region-schedule-limit | 4 | 热点调度并发数 | 热点明显 | 不想 Leader 频繁迁移 |

## 监控与排查

遇到热点问题时，先看监控：

```bash
# PD Control 查看调度状态
pd-ctl store                                    # 查看各节点 Region 数量
pd-ctl region --order-by-region-size desc 10    # 查看最大的 Region
pd-ctl region --order-by-region-write流量 desc 10  # 查看写入热的 Region

# Grafana TiKV 面板
# - Store Leader/Region count：各节点分布
# - Hot Region：热点 Region 详情
```

## 面试追问

**Q: Leader 调度会影响数据可用性吗？**

Leader 迁移时，原 Leader 需要先撤销日志追赶，再应用新 Leader 的日志。期间该 Region 可能有短暂不可用（约百毫秒级别）。但调度器会尽量选择低峰期执行，影响可控。

**Q: 为什么 TiKV 关注 Leader 而不是 Region 数量？**

因为写入必须经过 Leader。如果 Leader 集中，所有写入都会打向少数节点，即使 Region 数量均衡也无法解决热点。分散 Leader 才能分散写入压力。

**Q: 如何判断热点是写入热点还是读取热点？**

看 Grafana 的 Hot Region 面板：
- 读热点：Leader 的 read流量 高，Follower 低
- 写热点：Leader 的 write流量 高，Follower 低
- 均衡热点：所有副本流量都高（真实的大查询）

---

## 总结

Leader 调度是 TiKV 负载均衡的核心手段。PD 通过持续监控 Leader 分布、Region 大小、热点状态，自动生成调度操作，让数据均匀分布。

遇到热点问题时，思路是：
1. 查监控确认是写入热点还是读取热点
2. 写入热点用 AUTO_RANDOM 或 SHARD_ROW_ID_BITS
3. 读取热点让 PD 自动迁移 Leader
4. 必要时手动干预调度

热点是分布式数据库的永恒话题，理解调度的原理，才能在生产环境中快速定位和解决问题。
