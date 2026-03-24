# Prometheus 存储：本地存储的真相

Prometheus 默认使用本地存储，很多人因此觉得它「不够专业」。

但实际上，Prometheus 的本地存储设计得相当精妙。

今天我们来看看它是怎么工作的。

---

## 存储架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Prometheus Server                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    In-Memory Database                 │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │ Head Block (最新数据，< 2h)                     │ │  │
│  │  │ 写入 → Memory → WAL → Backfill                 │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │ Mmap Blocks (历史数据)                          │ │  │
│  │  │ 2h → 2h → 2h → ... → N (压缩)                │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              TSDB Files (磁盘)                       │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │  │
│  │  │block-1 │ │block-2 │ │block-3 │ │block-N │      │  │
│  │  │(2h)   │ │(2h)   │ │(2h)   │ │(压缩)  │      │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘      │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## TSDB 文件结构

```
data/
├──wal/                        # Write-Ahead Log
│   ├── 00000000
│   └── checkpoint.00000001
├──queries/                    # 临时查询文件
└──01HGB7QXYZ.../             # Block 目录
    ├── index                  # 索引文件
    ├── meta.json              # 元数据
    ├── tombststones           # 删除标记
    ├── chunks/                # 数据块
    │   ├── 000001
    │   └── 000002
    └── tombststones
```

---

## 写入流程

```java
// 写入流程（伪代码）
public class TSDBWrite {
    private final HeadBlock headBlock;
    private final WAL wal;

    public void write(Sample sample) {
        // 1. 先写入 WAL（保证持久化）
        wal.append(sample);

        // 2. 写入内存
        headBlock.append(sample);

        // 3. 检查是否需要刷新到磁盘
        if (headBlock.shouldCutBlock()) {
            // 4. 切出新的 Block
            Block block = headBlock.cutBlock();

            // 5. 压缩 Block（可选）
            block = compactor.compact(block);

            // 6. 持久化到磁盘
            block.persist();
        }
    }
}
```

---

## Block 结构

每个 Block 包含一个时间段的数据：

```
Block: 01HGB7QXYZ... (2h 数据)
│
├── index
│   ├── Postings: {metric1 → [chunk1, chunk2]}
│   ├── Series: {metric1 → series_id}
│   └── Label Index: {label_value → posting}
│
├── chunks/
│   ├── 000001 (压缩后的数据块)
│   └── 000002
│
└── meta.json
```

---

## 查询流程

```java
public class TSDBQuery {
    private final HeadBlock headBlock;
    private final List&lt;Block&gt; persistedBlocks;

    // 查询某个时间范围的数据
    public List&lt;Series&gt; query(long minTime, long maxTime) {
        List&lt;Series&gt; results = new ArrayList&lt;&gt;();

        // 1. 查询 Head Block（内存中）
        results.addAll(headBlock.query(minTime, maxTime));

        // 2. 查询已持久化的 Blocks
        for (Block block : persistedBlocks) {
            // 跳过不包含目标时间范围的 Block
            if (!block.overlaps(minTime, maxTime)) {
                continue;
            }
            // 用索引快速定位
            results.addAll(block.query(minTime, maxTime));
        }

        // 3. 合并结果并去重
        return mergeAndDeduplicate(results);
    }
}
```

---

## 压缩（Compaction）

TSDB 会定期压缩历史数据：

| 阶段 | Block 大小 | 说明 |
|-----|-----------|------|
| Head | < 2h | 内存中，未压缩 |
| Block | 2h | 初始持久化 |
| 压缩后 | 2h × 2 = 4h | 合并两个 Block |
| 压缩后 | 4h × 2 = 8h | 继续合并 |
| ... | ... | 最大 21 天 |

```
时间线： ──────── 2h ──────── 2h ──────── 2h ──────── 2h ──────── 2h ────────

Level 0: [2h][2h][2h][2h][2h][2h]...  (原始 Block)
Level 1:        [4h]      [4h]      [4h]...   (合并)
Level 2:              [8h]            [8h]...  (继续合并)
Level 3:                        [16h]...
Level 4:                              [21d]    (最大 Block)
```

---

## 本地存储的局限

| 局限 | 说明 |
|-----|------|
| **容量有限** | 单机磁盘决定上限 |
| **不支持集群** | 无法横向扩展 |
| **高可用** | 单点故障 |
| **长期存储** | 不适合 > 1 年的数据 |

---

## 远程存储：解决长期存储问题

Prometheus 支持**远程存储**，将数据转发到外部系统：

```yaml
# prometheus.yml
remote_write:
  - url: http://thanos-receiver:19291/api/v1/receive
    queue_config:
      capacity: 10000
      max_shards: 5

remote_read:
  - url: http://thanos-query:10902
    read_recent: true
```

### 常用远程存储方案

| 方案 | 说明 |
|-----|------|
| **Thanos** | Prometheus 原生扩展，支持全局视图 |
| **Cortex** | CNCF 项目，多租户支持 |
| **M3** | Uber 开源，分布式 TSDB |
| **InfluxDB** | 原生支持 Prometheus 远程读写 |

---

## Thanos：Prometheus 的长期存储方案

```
┌─────────────────────────────────────────────────────────────┐
│                     Thanos Architecture                        │
│                                                             │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐│
│  │Prometheus-1 │      │Prometheus-2 │      │Prometheus-3 ││
│  │  :9090      │      │  :9090      │      │  :9090      ││
│  └──────┬──────┘      └──────┬──────┘      └──────┬──────┘│
│         │                    │                    │         │
│         ↓                    ↓                    ↓         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Object Storage                     │   │
│  │                 (S3/MinIO/GCS)                        │   │
│  │  ┌─────────────────────────────────────────────────┐ │   │
│  │  │  远程 Block 文件                                │ │   │
│  │  │  thanos/blocks/01HGB7QXYZ...                  │ │   │
│  │  └─────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                            ↑                                │
│         ┌─────────────────┼─────────────────┐              │
│         ↓                 ↓                 ↓              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Store      │  │  Query      │  │  Compact    │     │
│  │  Gateway    │  │  Frontend   │  │  (压缩)     │     │
│  │  (读取)     │  │  (查询)     │  │             │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Thanos 组件

| 组件 | 作用 |
|-----|------|
| Sidecar | 部署在 Prometheus 旁，上传 Block 到对象存储 |
| Store Gateway | 从对象存储读取数据，提供查询接口 |
| Query Frontend | 查询前端，缓存和分片 |
| Query | 聚合多个 Store 和 Prometheus 的数据 |
| Compact | 压缩和降采样历史数据 |
| Receive | 接收远程写入（Push 模式）|

---

## 面试追问方向

- Prometheus 的 TSDB 和普通数据库的索引有什么区别？
- Thanos 和原生 Prometheus 存储相比有什么优势？

下一节，我们来了解 PromQL 查询语言。
