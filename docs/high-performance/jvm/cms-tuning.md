# CMS GC 调优：cmsInitiatingOccupancyFraction 与并发模式失败

CMS（Concurrent Mark Sweep）是 JDK 8 及之前最流行的低延迟垃圾收集器。

但 CMS 的配置复杂，参数众多，稍有不慎就会踩坑。今天我们深入讲解 CMS 的调优方法。

---

## 一、CMS 的工作原理回顾

### 1.1 CMS 的四个阶段

CMS 的工作分为四个阶段：

1. **初始标记（Initial Mark）**：STW，标记 GC Roots 直接引用的对象
2. **并发标记（Concurrent Mark）**：与应用并发，遍历对象图
3. **重新标记（Remark）**：STW，修正并发标记期间的变动
4. **并发清除（Concurrent Sweep）**：与应用并发，清除垃圾

### 1.2 CMS 的优势与问题

**优势**：
- 并发收集，停顿时间短
- 适合低延迟应用

**问题**：
- CPU 消耗高（需要与业务线程并发）
- 浮动垃圾（并发期间产生的垃圾）
- 无法处理浮动垃圾导致的 Full GC
- 内存碎片化

---

## 二、核心参数详解

### 2.1 -XX:CMSInitiatingOccupancyFraction

```bash
# 老年代使用率达到此比例时，触发 CMS
# 默认 68（%）
-XX:CMSInitiatingOccupancyFraction=68
```

**理解这个参数**：
- 当老年代空间使用率达到 68% 时，开始 CMS 回收周期
- 值越小，越早开始回收，但可能浪费空间
- 值越大，回收越晚，但可能来不及完成并发标记

### 2.2 -XX:+UseCMSInitiatingOccupancyOnly

```bash
# 只使用 CMSInitiatingOccupancyFraction 作为触发阈值
# 默认关闭（JVM 会动态调整）
-XX:+UseCMSInitiatingOccupancyOnly
```

**何时使用**：
- 需要精确控制 CMS 触发时机时开启
- 日常建议开启，保证行为可预测

### 2.3 -XX:+UseCMSCompactAtFullCollection

```bash
# Full GC 后进行内存压缩
# 默认开启
-XX:+UseCMSCompactAtFullCollection
```

**为什么需要**：
- CMS 使用标记-清除算法，会产生内存碎片
- Full GC 后压缩整理，减少碎片

### 2.4 -XX:CMSFullGCsBeforeCompaction

```bash
# 多少次 Full GC 后进行一次压缩
# 默认 0（每次 Full GC 都压缩）
-XX:CMSFullGCsBeforeCompaction=5
```

**调整建议**：
- 设为 0：每次 Full GC 都压缩，停顿时间长但无碎片
- 设为 > 0：减少压缩次数，停顿时间短但可能有碎片

---

## 三、并发模式失败（Concurrent Mode Failure）

### 3.1 什么是并发模式失败？

CMS 在并发标记期间，应用线程持续分配对象到老年代。如果老年代空间在并发标记完成前耗尽，就会触发并发模式失败，JVM 会调用 Serial Old 收集器进行 Full GC。

### 3.2 日志表现

```
[GC (CMS Initial Mark)[CMS-concurrent-mark-start]
[GC (CMS Initial Mark) (S0): 1234K->1024K(9216K), 0.0123456 secs]
...
[GC (Concurrent Mode Failure)   # 并发模式失败
  [CMS: 524288K->524288K(524288K), 4.567 secs]
```

### 3.3 原因分析

1. **老年代空间不足**：CMS 触发太晚，来不及完成并发标记
2. **对象晋升速度太快**：Minor GC 期间大量对象晋升到老年代
3. **浮动垃圾过多**：并发标记期间产生大量新对象

### 3.4 解决方案

**方案 1：降低触发阈值**

```bash
# 降低到 50-60%，提前开始 CMS
-XX:CMSInitiatingOccupancyFraction=50
-XX:+UseCMSInitiatingOccupancyOnly
```

**方案 2：增大堆内存**

```bash
-Xms8g -Xmx8g -Xmn2g
```

**方案 3：增大年轻代**

```bash
# 减少对象晋升到老年代的速度
-Xmn3g
```

**方案 4：使用 G1 替代**

```bash
# JDK 8u40+ 或 JDK 9+，使用 G1
-XX:+UseG1GC -XX:MaxGCPauseMillis=200
```

---

## 四、CMS 调优实战

### 4.1 典型配置

```bash
# JDK 8 CMS 标准配置
-Xms4g -Xmx4g -Xmn1.5g \
-XX:+UseConcMarkSweepGC \
-XX:+UseParNewGC \
-XX:CMSInitiatingOccupancyFraction=68 \
-XX:+UseCMSInitiatingOccupancyOnly \
-XX:+UseCMSCompactAtFullCollection \
-XX:CMSFullGCsBeforeCompaction=0 \
-XX:+PrintGCDetails -XX:+PrintGCDateStamps \
-Xloggc:/var/log/myapp-gc.log
```

### 4.2 低延迟优化配置

```bash
# 追求更低延迟的配置
-Xms8g -Xmx8g -Xmn3g \
-XX:+UseConcMarkSweepGC \
-XX:+UseParNewGC \
-XX:CMSInitiatingOccupancyFraction=50 \
-XX:+UseCMSInitiatingOccupancyOnly \
-XX:MaxGCPauseMillis=100 \
-XX:+UseCMSCompactAtFullCollection \
-XX:CMSFullGCsBeforeCompaction=0
```

### 4.3 内存优化配置

```bash
# 减少 Full GC 频率的配置
-Xms8g -Xmx8g -Xmn2g \
-XX:+UseConcMarkSweepGC \
-XX:+UseParNewGC \
-XX:CMSInitiatingOccupancyFraction=75 \
-XX:+UseCMSInitiatingOccupancyOnly \
-XX:CMSFullGCsBeforeCompaction=3
```

---

## 五、CMS 的常见问题

### 5.1 初始标记停顿时间长

**问题**：CMS 初始标记停顿时间较长

**解决**：这是正常的，初始标记需要扫描栈和常量池

### 5.2 重新标记停顿时间长

**问题**：重新标记停顿时间可能较长

**原因**：并发标记期间对象变化较多

**解决**：可以配合 `-XX:+CMSScavengeBeforeRemark`，在重新标记前先进行一次年轻代 GC

```bash
# JDK 8u4+ 支持
-XX:+CMSScavengeBeforeRemark
```

### 5.3 内存碎片化

**问题**：长期使用 CMS 后，内存碎片严重

**症状**：老年代空间足够，但无法分配大对象

**解决**：
1. 确保 Full GC 后进行压缩
2. 调整 `-XX:CMSFullGCsBeforeCompaction`
3. 考虑切换到 G1

---

## 六、CMS vs G1 选择

### 6.1 对比表

| 特性 | CMS | G1 |
|-----|-----|-----|
| 适用版本 | JDK 8 及之前 | JDK 9+ 默认 |
| 停顿时间 | 部分阶段 STW | 可控停顿目标 |
| 内存管理 | 传统分代 | Region 化 |
| 碎片化 | 严重 | 较轻 |
| 配置复杂度 | 高 | 中 |
| 推荐程度 | JDK 8 低延迟场景 | JDK 9+ 默认选择 |

### 6.2 选择建议

- **JDK 8**：低延迟需求用 CMS，JDK 8u40+ 可考虑 G1
- **JDK 9+**：直接使用 G1
- **JDK 11+**：G1 或 ZGC

---

## 总结

CMS 调优的核心要点：

1. **CMSInitiatingOccupancyFraction**：控制触发时机，建议 50-68
2. **UseCMSInitiatingOccupancyOnly**：保证行为可预测
3. **并发模式失败**：降低触发阈值或增大内存
4. **内存碎片**：调整压缩频率
5. **版本选择**：JDK 9+ 推荐使用 G1

---

## 思考题

CMS 的并发模式失败和传统 Full GC 有什么区别？各自的特点是什么？
