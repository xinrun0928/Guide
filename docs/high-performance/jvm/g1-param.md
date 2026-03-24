# G1 GC 参数调优：-XX:MaxGCPauseMillis、-XX:G1HeapRegionSize

JDK 8 开始，G1 收集器逐渐成为主流；到了 JDK 9+，G1 更是成为了默认的垃圾收集器。

但很多人用 G1 要么「躺平」接受默认配置，要么胡乱调参效果适得其反。

今天，我们就来深入了解 G1 的核心参数配置。

---

## 一、G1 的核心理念

### 1.1 什么是 G1？

G1（Garbage First）是一款面向服务器端的垃圾收集器，主要目标是：

1. **高吞吐**：在提供足够高吞吐量的同时
2. **低停顿**：将停顿时间控制在目标范围内
3. **可预测**：提供可预测的停顿时间分布

### 1.2 G1 的区域化设计

G1 将堆划分为多个大小相等的**Region**，每个 Region 大小为 1MB-32MB（必须是 2 的幂）：

```
┌──────────┬──────────┬──────────┬──────────┐
│  Eden    │  Eden    │ Survivor │  Old     │
│  2M      │  3M      │  1M      │  8M      │
├──────────┴──────────┴──────────┴──────────┤
│               Humongous                   │
│                64M                        │
└───────────────────────────────────────────┘
```

关键概念：

- **Eden Region**：新对象分配区域
- **Survivor Region**：年轻代幸存者区域
- **Old Region**：老年代 Region
- **Humongous Region**：大对象（超过 Region 大小 50%）的专属区域

### 1.3 G1 的工作原理

G1 的工作流程分为几个阶段：

1. **年轻代回收（Young GC）**：收集年轻代的 Eden 和 Survivor 区
2. **混合回收（Mixed GC）**：同时收集年轻代和部分老年代
3. **并发标记周期（Concurrent Marking Cycle）**：在后台并发标记存活对象

---

## 二、核心参数详解

### 2.1 -XX:MaxGCPauseMillis：最大停顿时间目标

```bash
# 目标最大停顿时间（毫秒），默认 200ms
-XX:MaxGCPauseMillis=200
```

**关键理解**：

1. 这是一个**软目标**，JVM 会尽力达成，但不保证
2. 设置得过小会导致频繁 GC，反而降低吞吐量
3. 设置得过大可能让 GC 不够激进，导致堆内存占用过高

### 2.2 -XX:G1HeapRegionSize：Region 大小

```bash
# Region 大小，默认根据堆大小自动计算
# 最小 1MB，最大 32MB，必须是 2 的幂
-XX:G1HeapRegionSize=4m
```

**选择建议**：

| 堆大小 | 推荐 Region 大小 |
|-------|-----------------|
| < 4GB | 1MB 或 2MB |
| 4GB-8GB | 4MB |
| 8GB-16GB | 8MB |
| > 16GB | 16MB 或 32MB |

### 2.3 -XX:InitiatingHeapOccupancyPercent：触发并发标记的堆占用率

```bash
# 堆占用率达到此比例时，启动并发标记周期
# 默认 45
-XX:InitiatingHeapOccupancyPercent=45
```

**理解这个参数**：

- 当老年代占用率达到 45% 时，G1 开始并发标记
- 设置过低：过早触发并发标记，增加 CPU 开销
- 设置过高：可能还没完成标记就开始 Full GC

### 2.4 -XX:G1NewSizePercent 和 -XX:G1MaxNewSizePercent：年轻代比例

```bash
# 年轻代最小占比（堆的百分比）
-XX:G1NewSizePercent=5

# 年轻代最大占比（堆的百分比）
-XX:G1MaxNewSizePercent=60
```

G1 会在这个范围内动态调整年轻代大小。

### 2.5 -XX:G1ReservePercent：预留内存比例

```bash
# 预留空间比例，默认 10
-XX:G1ReservePercent=10
```

用于 To-space-to-space 复制，防止对象晋升失败。

---

## 三、进阶参数配置

### 3.1 并发标记参数

```bash
# SATB（Snapshot-At-The-Beginning）标记的堆废物比例
# 默认 5
-XX:G1HeapWastePercent=5

# 触发 Mixed GC 的年轻代上限
-XX:InitiatingHeapOccupancyPercent=45

# 每次 Mixed GC 收集的 Old Region 数量上限
-XX:G1OldCSetRegionThresholdPercent=10
```

### 3.2 Humongous 对象参数

```bash
# Humongous 区域回收阈值
# 默认 8
-XX:G1HeapRegionSize=8m

# 大对象直接进入 Humongous 区域的条件
# 对象大小 > RegionSize * 50%
```

**Humongous 对象的坑**：

1. 分配在 Humongous 区域的独享区域
2. 回收时机：只有 Full GC 或并发标记周期结束时
3. 如果大量大对象，可能导致 Region 碎片化

### 3.3 并发 Refinement 线程

```bash
# 增量更新refinement线程数，默认由CPU决定
-XX:G1ConcRefinementThreads=13

# Yellow/Red/Green 三色卡片对应的线程数
-XX:G1SummarizeRSetStatsPeriod=0
```

### 3.4 Remembered Set 操作

```bash
# RSet 扫描的线程数
-XX:G1RSetUpdatingPauseTimePercent=10

# 卡片更新频率
-XX:G1UpdateBufferSize=1
```

---

## 四、典型配置场景

### 4.1 低延迟 Web 应用（停顿目标 100ms）

```bash
-Xms8g -Xmx8g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=100 \
-XX:G1HeapRegionSize=8m \
-XX:InitiatingHeapOccupancyPercent=45 \
-XX:G1NewSizePercent=10 \
-XX:G1MaxNewSizePercent=40 \
-XX:G1ReservePercent=15 \
-XX:+PrintGCDetails -XX:+PrintGCDateStamps \
-Xlog:gc*:file=gc.log
```

### 4.2 吞吐量优先（G1 模式）

```bash
-Xms16g -Xmx16g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=500 \
-XX:G1HeapRegionSize=16m \
-XX:InitiatingHeapOccupancyPercent=70 \
-XX:G1MixedGCLiveThresholdPercent=85
```

### 4.3 大内存应用（32GB+）

```bash
-Xms64g -Xmx64g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=200 \
-XX:G1HeapRegionSize=32m \
-XX:InitiatingHeapOccupancyPercent=50 \
-XX:G1ReservePercent=20
```

---

## 五、调优实战建议

### 5.1 调优的基本步骤

1. **第一步**：设置合理的停顿时间目标（不要过小）
2. **第二步**：观察 GC 日志，评估效果
3. **第三步**：微调 Region 大小和年轻代比例
4. **第四步**：调整并发标记触发阈值
5. **第五步**：优化 Humongous 对象管理

### 5.2 常见问题与解决方案

| 问题 | 原因 | 解决方案 |
|-----|-----|---------|
| 停顿时间过长 | 混合 GC 收集了太多 Old Region | 减小 G1OldCSetRegionThresholdPercent |
| 频繁 Young GC | 年轻代太小 | 增大 G1MaxNewSizePercent |
| 并发标记周期过长 | 堆太大或 Region 数过多 | 增大 G1HeapRegionSize |
| Humongous 对象过多 | 大对象分配频繁 | 增大 Region 大小，优化对象分配策略 |
| Full GC 频繁 | Old 区空间不足 | 减小 InitiatingHeapOccupancyPercent，提前触发并发标记 |

### 5.3 G1 vs ZGC vs Shenandoah

| 特性 | G1 | ZGC | Shenandoah |
|-----|-----|-----|------------|
| 停顿时间 | < 200ms（可配置）| < 10ms | < 20ms |
| 堆内存支持 | 最大 64GB | TB 级 | TB 级 |
| 吞吐量 | 高 | 中 | 中 |
| JDK 默认 | JDK 9+ | JDK 11+（JDK 15+ 稳定）| JDK 12+ |
| 算法 | 追踪 + 复制 | 着色指针 + 读屏障 | 着色指针 + 读屏障 |

### 5.4 JDK 版本推荐

| JDK 版本 | 推荐收集器 | 说明 |
|---------|-----------|------|
| JDK 8 | G1（JDK 8u40+）或 CMS | G1 在 JDK 8 中已成熟 |
| JDK 11 | G1 或 ZGC | ZGC 已稳定 |
| JDK 17+ | G1 或 ZGC | 两者都已非常成熟 |
| JDK 21+ | G1（默认）或 ZGC | 分代 ZGC 进一步优化 |

---

## 六、G1 的注意事项

### 6.1 G1 不是银弹

G1 并不适合所有场景：

1. **小内存（< 4GB）**：Serial GC 可能更好
2. **超低延迟（亚毫秒）**：考虑 ZGC
3. **吞吐量优先的批处理**：考虑 Parallel GC

### 6.2 G1 的局限性

1. **内存碎片**：Mixed GC 后仍有碎片，可能需要 Full GC 整理
2. **Region 分配**：Humongous 对象可能导致 Region 碎片
3. **停顿时间不确定**：取决于回收集合的大小

### 6.3 监控指标

使用 jstat 或 Arthas 观察：

```bash
# JDK 8
jstat -gcutil <pid> 1000

# JDK 11+
jcmd <pid> GC.heap_info
```

关注指标：

- **G1 Eden Region(s)**：年轻代使用情况
- **G1 Survivor Region(s)**：幸存区使用情况
- **G1 Old Region(s)**：老年代使用情况
- **G1 Humongous Region(s)**：大对象区使用情况

---

## 总结

G1 参数调优的核心要点：

1. **MaxGCPauseMillis 是软目标**：不要设得过小
2. **Region 大小要匹配堆大小**：大堆用大 Region
3. **InitiatingHeapOccupancyPercent 控制标记时机**：太小过早，太大可能来不及
4. **Humongous 对象是性能陷阱**：尽量避免创建过大的对象
5. **观察日志持续优化**：GC 调优是迭代过程

---

## 思考题

G1 的 Mixed GC 收集了太多 Old Region 导致停顿时间过长。你会如何调整参数来解决这个问题？

提示：考虑哪些参数控制每次 Mixed GC 收集的 Old Region 数量，以及如何平衡停顿时间和回收效果。
