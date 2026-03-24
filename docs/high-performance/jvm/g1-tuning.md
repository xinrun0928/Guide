# G1 GC 调优：SATB、并发标记、Humongous 区域

G1 是 JDK 9+ 的默认垃圾收集器，也是目前最流行的服务器端 GC 方案之一。

但 G1 的调优比 CMS 更复杂，涉及 SATB、并发标记、Humongous 区域等多个概念。今天我们深入讲解 G1 的调优方法。

---

## 一、G1 的核心概念

### 1.1 Region 化内存管理

G1 将堆划分为大小相等的 Region，每个 Region 大小默认 1MB-32MB（必须是 2 的幂）：

```
┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
│  E    │   S   │   O   │   H   │   E   │   S   │   O   │   O   │
│ (Eden)│(Survivor)│ (Old) │(Humongous)│ (Eden)│(Survivor)│ (Old) │ (Old) │
│  1MB  │   1MB │   1MB │   32MB │   1MB │   1MB │   1MB │   1MB │
└────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘
```

### 1.2 G1 的工作流程

G1 的工作分为以下几个阶段：

1. **年轻代回收（Young GC）**：回收年轻代的 Eden 和 Survivor 区
2. **并发标记周期（Concurrent Marking）**：标记存活对象
3. **混合回收（Mixed GC）**：回收年轻代 + 部分老年代
4. **Full GC**（必要时）：G1 无法处理时触发

---

## 二、SATB 标记（Snapshot-At-The-Beginning）

### 2.1 什么是 SATB？

SATB 是 G1 使用的并发标记算法，核心思想是**在标记开始时创建一个「快照」**，之后创建的对象被视为已死亡（不需要标记）。

### 2.2 SATB 的工作原理

```
标记开始 ────────────────────────────── 标记结束
    │                                     │
    ▼                                     ▼
Snapshot ────────────────────────────── Current
    │                                     │
    │    新创建的对象（SATB 视为死亡）      │
    │    删除的引用（SATB 视为仍存在）      │
    │                                     │
    ▼                                     ▼
  标记存活                         实际存活对象
```

### 2.3 SATB 的优缺点

**优点**：
- 标记期间不需要冻结应用线程
- 减少了重新标记的复杂度

**缺点**：
- 会产生浮动垃圾（被标记但实际已死亡的对象）
- 需要额外的内存记录快照

### 2.4 相关的 GC 参数

```bash
# SATB 相关的堆废物比例
# 默认 5
# 当回收的笑脸区域中，死对象比例超过此值时，不回收
-XX:G1HeapWastePercent=5

# 启用/禁用 SATB
-XX:+UseG1GC  # 默认启用 SATB
```

---

## 三、并发标记周期

### 3.1 四个阶段

G1 的并发标记周期分为四个阶段：

1. **初始标记（Initial Mark）**：STW，标记从 GC Roots 直接可达的对象
2. **根区域扫描（Root Region Scan）**：扫描 Survivor 区中指向老年代的引用
3. **并发标记（Concurrent Mark）**：与应用并发，遍历对象图
4. **重新标记（Remark）**：STW，修正并发期间的变动，使用 SATB
5. **清理（Cleanup）**：STW，统计存活对象，更新 RSet

### 3.2 触发时机

```bash
# 堆占用率达到此比例时，启动并发标记
# 默认 45
-XX:InitiatingHeapOccupancyPercent=45
```

### 3.3 调优参数

```bash
# 并发标记线程数
# 默认由 G1 自动计算
-XX:G1ConcMarkingThreads=4

# 重新标记前进行年轻代 GC
# 减少需要扫描的对象数量
-XX:+G1SummarizeRSetStatsBeforeGC
-XX:+G1SummarizeRSetStatsAfterGC
```

---

## 四、Humongous 区域

### 4.1 什么是 Humongous 对象？

Humongous（巨大的）对象是**超过 Region 大小 50%** 的对象。这些对象会直接分配到 Humongous 区域。

```bash
# 判断标准：对象大小 > RegionSize * 50%
-XX:G1HeapRegionSize=4m  # Humongous 阈值 = 2MB
```

### 4.2 Humongous 区域的特殊性

1. **分配**：Humongous 对象独占一个或多个连续的 Region
2. **回收**：只有 Full GC 或并发标记周期结束时才回收
3. **碎片化**：大量 Humongous 对象可能导致 Region 碎片

### 4.3 Humongous 对象的坑

**坑 1：过早触发 Full GC**

如果 Humongous 对象很快变成垃圾，G1 无法及时回收，可能导致频繁 Full GC。

**坑 2：Region 碎片化**

Humongous 对象释放后，Region 可能无法被充分利用。

### 4.4 调优建议

```bash
# 方案 1：增大 Region 大小
# 减少 Humongous 对象的数量
-XX:G1HeapRegionSize=16m

# 方案 2：调整 Humongous 阈值
# 只有更大的对象才进入 Humongous 区域
-XX:G1HeapRegionSize=4m -XX:G1NewSizePercent=10

# 方案 3：优化代码
# 避免创建过大的对象
```

---

## 五、G1 调优实战

### 5.1 停顿时间调优

```bash
# 目标最大停顿时间（软目标）
-XX:MaxGCPauseMillis=200

# 停顿时间调优策略
# 1. 如果停顿时间过长：
#    - 减小年轻代大小（G1NewSizePercent）
#    - 减小 Mixed GC 收集的 Old Region 数量
# 2. 如果停顿时间过短但吞吐量下降：
#    - 增大年轻代大小
```

### 5.2 混合回收调优

```bash
# 每次 Mixed GC 收集的 Old Region 数量上限
# 默认 10% 的堆
-XX:G1OldCSetRegionThresholdPercent=10

# 触发混合回收的年轻代上限
# 默认 5
-XX:G1MixedGCLiveThresholdPercent=85

# 增大以提高效率
-XX:G1OldCSetRegionThresholdPercent=20
```

### 5.3 完整配置示例

```bash
# 通用配置
-Xms8g -Xmx8g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=200 \
-XX:G1HeapRegionSize=8m \
-XX:InitiatingHeapOccupancyPercent=45 \
-XX:G1NewSizePercent=10 \
-XX:G1MaxNewSizePercent=60 \
-XX:G1ReservePercent=15 \
-XX:G1HeapWastePercent=5 \
-XX:G1MixedGCLiveThresholdPercent=85 \
-XX:G1OldCSetRegionThresholdPercent=10
```

### 5.4 低延迟配置

```bash
# 追求更低延迟
-Xms16g -Xmx16g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=100 \
-XX:G1HeapRegionSize=16m \
-XX:InitiatingHeapOccupancyPercent=40 \
-XX:G1NewSizePercent=15 \
-XX:G1MaxNewSizePercent=50
```

### 5.5 大内存配置

```bash
# 堆内存 > 32GB
-Xms64g -Xmx64g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=200 \
-XX:G1HeapRegionSize=32m \
-XX:InitiatingHeapOccupancyPercent=50 \
-XX:G1ReservePercent=20
```

---

## 六、常见问题与解决方案

### 6.1 停顿时间超过目标

**原因**：Mixed GC 收集了太多 Old Region

**解决**：

```bash
# 减小每次 Mixed GC 收集的 Old Region 数量
-XX:G1OldCSetRegionThresholdPercent=5

# 增大年轻代，让 Young GC 更频繁
-XX:G1MaxNewSizePercent=70
```

### 6.2 频繁 Young GC

**原因**：年轻代太小

**解决**：

```bash
# 增大年轻代比例范围
-XX:G1NewSizePercent=15
-XX:G1MaxNewSizePercent=70
```

### 6.3 内存使用率过高

**原因**：G1 的空间回收不够激进

**解决**：

```bash
# 降低并发标记触发阈值
-XX:InitiatingHeapOccupancyPercent=35

# 增大混合回收的比例
-XX:G1OldCSetRegionThresholdPercent=15
```

### 6.4 Humongous 对象过多

**原因**：分配了大量大对象

**解决**：

```bash
# 增大 Region 大小
-XX:G1HeapRegionSize=16m

# 优化代码，避免创建大对象
```

---

## 七、监控与诊断

### 7.1 GC 日志分析

```bash
# 使用 -Xlog 分析 G1 日志
-Xlog:gc*=debug:file=gc.log:time,uptime,level,tags
```

### 7.2 jstat 监控

```bash
# JDK 8
jstat -gcutil <pid> 1000

# JDK 11+
jcmd <pid> GC.heap_info
```

### 7.3 JDK Mission Control

使用 JDK Mission Control 分析 G1 的详细行为：

1. 查看 GC 时间线
2. 分析停顿时间分布
3. 查看 Region 使用情况

---

## 总结

G1 调优的核心要点：

1. **MaxGCPauseMillis**：软目标，根据实际效果调整
2. **Region 大小**：匹配堆大小，大堆用大 Region
3. **InitiatingHeapOccupancyPercent**：控制并发标记时机
4. **Humongous 对象**：尽量避免大对象，或增大 Region
5. **Mixed GC**：调整 Old Region 收集数量平衡停顿和效率

---

## 思考题

G1 使用 SATB 标记算法，相比 CMS 的增量更新算法，有什么优点和缺点？

提示：考虑并发标记期间的复杂度、内存开销、以及浮动垃圾的处理。
