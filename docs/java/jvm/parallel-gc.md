# Parallel Scavenge：吞吐量优先，后台批处理的最佳选择

ParNew 追求的是停顿时间短，而 Parallel Scavenge 追求的是**吞吐量**。

这两个目标有时是矛盾的——停顿越短，意味着 GC 越频繁，吞吐量反而下降。

今天，我们来看看 Parallel Scavenge 是如何在这个 trade-off 中找到平衡的。

---

## 吞吐量：GC 的核心指标

### 什么是吞吐量？

```
┌─────────────────────────────────────────────────────────────┐
│                      吞吐量定义                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  吞吐量 = CPU 运行用户代码的时间 / (用户代码时间 + GC 时间)   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │
│  │  ↑                     ↑                              │  │
│  │  运行用户代码          GC 停顿                         │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  吞吐量 99% = 100 秒内，99 秒运行用户代码，1 秒 GC 停顿      │
│  吞吐量 90% = 100 秒内，90 秒运行用户代码，10 秒 GC 停顿      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 吞吐量 vs 停顿时间

| 目标 | 特点 | 适用场景 |
|-----|------|---------|
| 高吞吐量 | GC 总时间短，但可能长时间停顿 | 后台批处理、离线计算 |
| 低停顿 | 停顿时间短，但 GC 可能更频繁 | 响应式服务、在线系统 |

---

## Parallel Scavenge 的核心参数

### 吞吐量调优三剑客

```bash
# 1. 最大 GC 停顿时间（目标）
-XX:MaxGCPauseMillis=200    # 希望停顿不超过 200ms

# 2. GC 时间占比（吞吐量）
-XX:GCTimeRatio=19          # 吞吐量 = 19/(19+1) = 95%

# 3. 自适应调整（JDK 默认开启）
-XX:+UseAdaptiveSizePolicy  # 自动调整各区大小
```

### 参数详解

```java
// MaxGCPauseMillis 的实际含义
public class PauseTimeDemo {

    // MaxGCPauseMillis 只是一个「目标」，JVM 会尽量达成
    // 但不是硬性保证！

    // 如果设置 -XX:MaxGCPauseMillis=100
    // JVM 可能：
    // - 增大年轻代 → GC 次数少，但单次时间长
    // - 减小年轻代 → GC 次数多，但单次时间短

    // 注意：设置过小可能导致 GC 频繁，反而降低吞吐量
}

// GCTimeRatio 的计算
public class ThroughputCalculation {

    // -XX:GCTimeRatio=19
    // 吞吐量 = target = 19 / (19 + 1) = 95%

    // 即：100 分钟内，允许 5 分钟的 GC 时间
    // 如果 GC 时间超过 5 分钟，JVM 会调整策略
}
```

---

## 自适应调整策略

### UseAdaptiveSizePolicy 的魔法

```bash
# JDK 默认开启
java -XX:+UseAdaptiveSizePolicy your.App

# JDK 会自动调整：
# 1. Eden / Survivor 区比例
# 2. 晋升年龄阈值
# 3. 各区大小

# 示例调整过程：
初始配置：
  -Xmx=1024m -Xmn=512m -XX:SurvivorRatio=8

GC 后发现停顿超过目标：
  → 减小年轻代？或者调整 SurvivorRatio？

GC 后发现晋升到老年代的对象太多：
  → 增大 Survivor 区？或者提高晋升年龄？
```

### 自适应 vs 手动配置

```
┌─────────────────────────────────────────────────────────────┐
│                  自适应 vs 手动配置                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  自适应（UseAdaptiveSizePolicy）                            │
│  ✓ 省心，JVM 自动优化                                       │
│  ✓ 适应动态负载                                             │
│  ✗ 不确定性，难以预测                                       │
│  ✗ 某些场景下可能不是最优                                   │
│                                                              │
│  手动配置                                                    │
│  ✓ 确定性，可预测                                           │
│  ✓ 针对特定场景优化                                         │
│  ✗ 需要经验，配置复杂                                       │
│  ✗ 无法适应负载变化                                         │
│                                                              │
│  建议：                                                      │
│  - 生产环境：先手动配置，找到最优后固定                     │
│  - 测试环境：开启自适应，观察最优配置                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Parallel Scavenge + Parallel Old 组合

### 吞吐量优先的最佳拍档

```bash
# 完整吞吐量优先组合
java -XX:+UseParallelGC \           # 年轻代 Parallel Scavenge
     -XX:+UseParallelOldGC \         # 老年代 Parallel Old
     -XX:ParallelGCThreads=8 \       # 并行线程数
     -XX:GCTimeRatio=19 \            # 吞吐量目标 95%
     -XX:MaxGCPauseMillis=200 \     # 最大停顿 200ms
     -XX:+UseAdaptiveSizePolicy \   # 自适应调整
     -Xmx4g -Xms4g \
     your.Application
```

### 组合特点

```
┌─────────────────────────────────────────────────────────────┐
│            Parallel Scavenge + Parallel Old                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   年轻代                              老年代                 │
│   ┌─────────────────┐              ┌─────────────────┐     │
│   │ Parallel        │              │ Parallel        │     │
│   │ Scavenge        │ ──晋升─────► │ Old             │     │
│   │ (复制算法)       │              │ (标记-整理)      │     │
│   │ 多线程并行       │              │ 多线程并行        │     │
│   │ 吞吐量优先       │              │ 吞吐量优先        │     │
│   └─────────────────┘              └─────────────────┘     │
│                                                              │
│   特点：                                                     │
│   - 都是多线程并行                                           │
│   - 都是吞吐量优先                                           │
│   - Stop The World，但并行加速                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 实战调优案例

### 案例 1：后台报表系统

```bash
# 场景：每天凌晨跑一次报表，延迟要求不高，但吞吐量要高
# 配置：
java -XX:+UseParallelGC \
     -XX:+UseParallelOldGC \
     -XX:ParallelGCThreads=4 \
     -XX:GCTimeRatio=9 \         # 吞吐量 90%（宽松）
     -XX:MaxGCPauseMillis=1000 \ # 停顿容忍 1 秒
     -Xmx2g -Xms2g -Xmn1g \
     your.ReportApp
```

### 案例 2：实时数据处理

```bash
# 场景：Kafka 消费者，吞吐量要求极高
# 配置：
java -XX:+UseParallelGC \
     -XX:+UseParallelOldGC \
     -XX:ParallelGCThreads=16 \
     -XX:GCTimeRatio=19 \       # 吞吐量 95%（严格）
     -XX:+UseAdaptiveSizePolicy \
     -Xmx8g -Xms8g -Xmn4g \
     your.StreamProcessor
```

### 案例 3：Hadoop MapReduce

```bash
# Hadoop 默认使用 Parallel Scavenge + Parallel Old
# 因为 MapReduce 是吞吐量优先场景
# 配置：
-D mapreduce.jobtracker.completeuserjobs.maximum-applied-job=true
-XX:+UseParallelOldGC
```

---

## Parallel Scavenge vs ParNew

| 对比项 | Parallel Scavenge | ParNew |
|-------|------------------|--------|
| 设计目标 | 吞吐量优先 | 停顿时间优先 |
| 自适应调整 | 支持（默认开启）| 不支持 |
| 线程数控制 | 可配置 | 固定 |
| 搭档 | Parallel Old | CMS |
| JDK 版本 | 一直支持 | JDK 9 移除 |
| 吞吐量 | 更高 | 较低 |

---

## 监控与诊断

### GC 日志分析

```bash
java -XX:+UseParallelGC \
     -XX:+UseParallelOldGC \
     -XX:+PrintGCDetails \
     -XX:+PrintGCTimeStamps \
     -Xloggc:gc.log \
     your.Application
```

```text
# Parallel Scavenge 日志示例
2024-01-15T10:00:00.123: [GC
    Before GC:
      par new generation   total 229376K, used 180000K
    After GC:
      par new generation   total 229376K, used 30000K
    [Times: user=0.50 sys=0.02, real=0.12 secs]
    # user=0.50: 多线程 CPU 时间之和（0.5 秒 × 4 线程 ≈ 0.12 秒实际）
```

### jstat 监控吞吐量

```bash
# 监控 GC 时间和吞吐量
jstat -gc <pid> 1000

# 计算吞吐量
# 假设：YGCT = 10.5s, YGC = 100
# 平均 Young GC 时间 = 10.5 / 100 = 105ms
```

---

## 面试追问方向

- `MaxGCPauseMillis` 设置得越小越好吗？为什么？
- Parallel Scavenge 的自适应调整会调整哪些参数？会调整老年代吗？
- Parallel Scavenge 和 ParNew 都能用多线程，它们的核心区别是什么？
- 为什么 Hadoop、Spark 这些大数据框架默认使用 Parallel Scavenge？
- 如果想同时兼顾吞吐量和停顿时间，应该选择哪个收集器？配置上有什么建议？
