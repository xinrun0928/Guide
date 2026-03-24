# GC 参数配置：垃圾收集器选择与参数组合

你有没有被面试官问过这种问题：「你用过哪些垃圾收集器？ParNew 和 CMS 有什么区别？」

或者线上报警「Full GC 频繁」，你却不知道该换哪个收集器？

今天，我们就来彻底搞清楚 GC 参数的配置方法。

---

## 一、垃圾收集器发展史与选择策略

### 1.1 经典收集器一览

```
Serial（串行）→ Parallel（并行）→ CMS → G1 → ZGC/Shenandoah
```

| 收集器 | 线程模型 | 工作模式 | 适用场景 |
|-------|---------|---------|---------|
| **Serial** | 单线程 | STW | 客户端、小内存、单核机器 |
| **ParNew** | 多线程 | STW | 多核服务器，配合 CMS |
| **Parallel Scavenge** | 多线程 | STW | 吞吐量优先，后台任务 |
| **Serial Old** | 单线程 | STW | 客户端、老年代配合 Serial |
| **Parallel Old** | 多线程 | STW | 吞吐量优先，配合 Parallel Scavenge |
| **CMS** | 并发 | 并发标记、低停顿 | 低延迟需求的 Web 应用 |
| **G1** | 并发 | 区域化、低延迟 | JDK 9+ 默认，替代 CMS |
| **ZGC** | 并发 | 着色指针、低延迟 | 大内存（TB 级）、超低延迟 |
| **Shenandoah** | 并发 | 着色指针、低延迟 | OpenJDK，Redis 默认优化 |

### 1.2 选择原则

选择垃圾收集器不是「最新的就是最好的」，而是要匹配业务场景：

1. **吞吐量优先**：后台批处理、数据分析 → Parallel + Parallel Old
2. **低延迟优先**：Web 应用、API 服务 → G1 / CMS / ZGC
3. **超大内存**：内存 > 32GB → ZGC / Shenandoah
4. **小内存**：堆 < 4GB → G1（JDK 9+ 默认）

---

## 二、年轻代收集器参数

### 2.1 Serial GC：最朴素的收集器

```bash
# 启用 Serial 年轻代收集器
-XX:+UseSerialGC

# 实际等效于
# -XX:+UseSerialGC -XX:+UseSerialOldGC
```

参数配置：

```bash
-Xms256m -Xmx256m -Xmn128m -XX:+UseSerialGC
```

**特点**：单线程执行，对年轻代的回收采用**复制算法**，简单但效率低。

### 2.2 ParNew GC：多线程版 Serial

```bash
# 启用 ParNew 年轻代收集器（通常配合 CMS 使用）
-XX:+UseParNewGC
```

```bash
# 典型配置
-Xms4g -Xmx4g -Xmn2g -XX:+UseParNewGC -XX:+UseConcMarkSweepGC
```

**参数**：

```bash
# ParNew 的线程数，默认等于 CPU 核心数
-XX:ParallelGCThreads=N
```

> 注意：JDK 9 开始，ParNew + CMS 的组合被标记为废弃；JDK 14 完全移除 CMS。如果使用 JDK 8 或 11，可以继续使用这个组合。

### 2.3 Parallel Scavenge：吞吐量优先

```bash
# 启用 Parallel Scavenge 收集器
-XX:+UseParallelGC

# 配合老年代 Parallel Old
-XX:+UseParallelOldGC
```

```bash
# 高吞吐量配置示例
-Xms8g -Xmx8g \
-XX:+UseParallelGC \
-XX:+UseParallelOldGC \
-XX:ParallelGCThreads=8 \
-XX:+UseAdaptiveSizePolicy
```

**核心参数**：

```bash
# 目标吞吐量（0-100），默认 99
-XX:GCTimeRatio=99

# 最大 GC 停顿时间目标（毫秒）
-XX:MaxGCPauseMillis=500
```

> GCTimeRatio=99 表示目标 GC 时间占总时间不超过 1%，即吞吐量 = 99%

---

## 三、老年代收集器参数

### 3.1 Serial Old：老年代的串行收集器

```bash
# 通常与其他年轻代收集器配合
-XX:+UseSerialGC  # 同时启用 Serial Old
```

### 3.2 Parallel Old：并行版 Serial Old

```bash
# 配合 Parallel Scavenge 使用
-XX:+UseParallelOldGC
```

### 3.3 CMS：并发标记清除

CMS（Concurrent Mark Sweep）是最早的低停顿收集器，目标是**最小化 GC 停顿时间**。

```bash
# 启用 CMS
-XX:+UseConcMarkSweepGC
```

**工作阶段**：

1. **初始标记（Initial Mark）**：STW，只标记 GC Roots 直接引用的对象
2. **并发标记（Concurrent Mark）**：与应用线程并发，遍历对象图
3. **重新标记（Remark）**：STW，修正并发标记期间的变动
4. **并发清除（Concurrent Sweep）**：与应用线程并发，清除垃圾

**参数配置**：

```bash
# 老年代使用率到达此比例时触发 CMS
-XX:CMSInitiatingOccupancyFraction=68

# 启用动态调整（使用 JVM 计算的触发比例）
-XX:+UseCMSInitiatingOccupancyOnly

# 并发模式失败后使用 Serial Old 作为备用
-XX:+UseCMSCompactAtFullCollection

# 多少次 Full GC 后进行压缩整理
-XX:CMSFullGCsBeforeCompaction=0
```

### 3.4 G1：区域化垃圾收集器

G1（Garbage First）是 JDK 9+ 的默认收集器，将堆划分为多个大小相等的 Region。

```bash
# 启用 G1
-XX:+UseG1GC
```

典型配置：

```bash
-Xms8g -Xmx8g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=200 \
-XX:G1HeapRegionSize=4m \
-XX:InitiatingHeapOccupancyPercent=45
```

### 3.5 ZGC：超低延迟收集器

ZGC（Z Garbage Collector）目标是**亚毫秒级停顿**，支持 TB 级堆内存。

```bash
# 启用 ZGC
-XX:+UseZGC
```

```bash
# 大内存 ZGC 配置
-Xms64g -Xmx64g \
-XX:+UseZGC \
-XX:MaxGCPauseMillis=10 \
-XX:+ZGenerational
```

> JDK 15 引入了分代 ZGC（ZGenerational），进一步优化了内存效率。

### 3.6 Shenandoah：低延迟开源收集器

Shenandoah 由 Red Hat 开发，现为 OpenJDK 的一部分。

```bash
# 启用 Shenandoah
-XX:+UseShenandoahGC
```

---

## 四、收集器组合规则

JVM 对年轻代和老年代收集器有严格的组合限制：

| 年轻代 | 老年代 | 是否有效 |
|-------|-------|---------|
| Serial | Serial Old | ✅ |
| ParNew | CMS | ✅ |
| Parallel Scavenge | Serial Old | ✅ |
| Parallel Scavenge | Parallel Old | ✅（吞吐量组合）|
| G1 | G1 | ✅ |
| ZGC | ZGC | ✅ |
| ParNew | Serial Old | ❌（JDK 8 会自动降级为 Serial）|
| Serial | CMS | ❌（不支持）|

> CMS 的老年代需要 ParNew 作为年轻代收集器，ParNew 不能与其他老年代收集器配合。

---

## 五、典型配置场景

### 5.1 吞吐量优先场景

适用于后台批处理、科学计算等

```bash
-Xms8g -Xmx8g \
-XX:+UseParallelGC \
-XX:+UseParallelOldGC \
-XX:ParallelGCThreads=8 \
-XX:GCTimeRatio=99 \
-XX:+UseAdaptiveSizePolicy
```

### 5.2 延迟优先场景（CMS 版本）

适用于低延迟 Web 应用（JDK 8）

```bash
-Xms4g -Xmx4g -Xmn2g \
-XX:+UseParNewGC \
-XX:+UseConcMarkSweepGC \
-XX:CMSInitiatingOccupancyFraction=68 \
-XX:+UseCMSCompactAtFullCollection \
-XX:CMSFullGCsBeforeCompaction=0 \
-XX:+PrintGCDetails -XX:+PrintGCDateStamps
```

### 5.3 延迟优先场景（G1 版本）

JDK 9+ 推荐

```bash
-Xms8g -Xmx8g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=200 \
-XX:G1HeapRegionSize=8m \
-XX:InitiatingHeapOccupancyPercent=45 \
-XX:G1ReservePercent=10
```

### 5.4 超大内存场景

堆内存超过 32GB 或需要亚毫秒级停顿

```bash
-Xms64g -Xmx64g \
-XX:+UseZGC \
-XX:MaxGCPauseMillis=10 \
-XX:+ZGenerational
```

### 5.5 极低延迟场景（低版本 JDK）

JDK 8 但需要极低延迟

```bash
-Xms4g -Xmx4g -Xmn2g \
-XX:+UseParNewGC \
-XX:+UseConcMarkSweepGC \
-XX:MaxGCPauseMillis=100 \
-XX:CMSInitiatingOccupancyFraction=60
```

---

## 六、JDK 版本与默认收集器

| JDK 版本 | 年轻代默认 | 老年代默认 |
|---------|-----------|-----------|
| JDK 7/8 | Parallel Scavenge | Serial Old |
| JDK 9+ | G1 | G1 |
| JDK 11+ | G1 | G1 |
| JDK 15+ | G1 | G1 |
| JDK 21+ | G1 | G1 |

> JDK 8 及之前默认使用 Parallel（吞吐量优先），JDK 9+ 默认使用 G1（延迟优先）。

---

## 总结

垃圾收集器的选择要点：

1. **理解业务目标**：吞吐量优先还是延迟优先？
2. **了解版本默认**：JDK 8 用 Parallel，JDK 9+ 用 G1
3. **正确组合**：年轻代和老年代收集器必须兼容
4. **参数调优**：根据 GC 日志调整具体参数

下一节，我们来深入了解 G1 的详细参数配置。

---

## 思考题

CMS 收集器有一个臭名昭著的问题：**并发模式失败（Concurrent Mode Failure）**。你知道这个问题是怎么产生的吗？

提示：考虑并发标记期间，老年代剩余空间和对象晋升速度的关系。
