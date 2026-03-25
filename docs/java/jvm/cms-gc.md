# CMS：并发标记-清除，JDK 8 的低延迟首选

在 Parallel Scavenge 统治吞吐量战场的年代，CMS 开辟了另一条路：

**让 GC 与用户线程并发执行，把停顿时间从「秒级」降到「毫秒级」**。

这个设计理念影响深远，至今仍是 G1、ZGC 的基础。

---

## CMS 的四步走

### 收集过程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CMS 收集过程                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  1. 初始标记（STW）  ─────────────────────────── 0.5ms         │ │
│  │                                                              │ │
│  │     GC Roots ──直接引用──► [老年代对象]                        │ │
│  │                              ↑                                 │ │
│  │                        仅标记这一层                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  2. 并发标记（并发执行）  ─────────────────────── 10-100ms     │ │
│  │                                                              │ │
│  │     [老年代对象] ──遍历──► [引用链]                           │ │
│  │     用户线程 ◄──同时运行──► ████████████                    │ │
│  │     ↑                                                           │ │
│  │  不 Stop The World！                                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  3. 重新标记（STW）  ─────────────────────────── 1-5ms         │ │
│  │                                                              │ │
│  │     并发标记期间产生的新对象                                  │ │
│  │     ░░░░░░░░ ──修正──► ████████████                           │ │
│  │                                                              │ │
│  │     漏标的对象被补上                                          │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  4. 并发清除（并发执行）  ─────────────────────── 100ms+       │ │
│  │                                                              │ │
│  │     回收死亡对象                                              │ │
│  │     用户线程 ◄──同时运行──► ████████████                    │ │
│  │     [死亡对象] 被标记为可用空间                               │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  总 STW 时间 ≈ 初始标记 + 重新标记                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Java 实现示意

```java
public class CMSCollector {

    public void collect() {
        // 1. 初始标记：只标记 GC Roots 直接引用的对象（STW）
        initialMark();

        // 2. 并发标记：遍历对象图（并发）
        concurrentMark();

        // 3. 重新标记：修正并发期间的变动（STW）
        remark();

        // 4. 并发清除：回收死亡对象（并发）
        concurrentSweep();
    }

    private void initialMark() {
        // STW，标记 GC Roots 直接引用的老年代对象
        // 时间很短
        for (Object root : gcRoots) {
            mark(root);
        }
    }

    private void concurrentMark() {
        // 并发，不 STW
        // 从初始标记的对象开始，遍历整个对象图
        // 用户线程同时运行，可能产生新的对象
        while (hasUnvisited()) {
            Object obj = nextUnvisited();
            markReferences(obj);
        }
    }

    private void remark() {
        // STW，修正并发标记期间的变化
        // 需要扫描：
        // 1. 并发标记期间新晋升的对象
        // 2. 并发标记期间新创建的对象
        // 3. 引用变化的对象
        update遗漏的对象();
    }

    private void concurrentSweep() {
        // 并发，回收死亡对象
        // 不整理，会产生内存碎片
        for (Object obj : deadObjects) {
            free(obj);
        }
    }
}
```

---

## CMS 的致命问题

### 问题 1：内存碎片

```
CMS 使用标记-清除，不整理！

┌─────────────────────────────────────────────────────────────┐
│  内存碎片积累                                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  初始状态：                                                  │
│  [██][██][██][██][██][██][██][██][██][██]                   │
│                                                              │
│  几次 GC 后：                                                │
│  [██][  ][██][    ][██][  ][██][    ][██][██]               │
│           ↑                                           ↑     │
│           └──────── 碎片（无法分配大对象） ─────────────────┘ │
│                                                              │
│  后果：Promotion Failed 或 Full GC                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 问题 2：Concurrent Mode Failure

```java
// 场景：并发标记期间，老年代满了
public class ConcurrentModeFailure {

    public void run() {
        // CMS 并发标记中...
        // 用户线程创建大对象
        // Old 区无法容纳

        // 触发条件检查
        if (oldGen.used >= cmsInitiatingOccupancyThreshold) {
            // CMS 还在并发阶段，无法处理
            // → 触发 Full GC（Serial Old 单线程）
            fullGC();
        }
    }
}
```

### 问题 3：浮动垃圾

```
┌─────────────────────────────────────────────────────────────┐
│  浮动垃圾（Floating Garbage）                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  并发标记阶段：                                              │
│  1. 对象 A 被标记为存活                                      │
│  2. 用户线程使 A 变成不可达（解除引用）                      │
│  3. A 已经标记过了，不会被回收                               │
│  4. A 变成「浮动垃圾」，只能等下次 GC                       │
│                                                              │
│  容忍度：CMS 设计时假设浮动垃圾 < 20%                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心参数配置

```bash
# 启用 CMS
java -XX:+UseConcMarkSweepGC your.Application

# 关键参数
-XX:CMSInitiatingOccupancyFraction=70    # 老年代使用率 70% 时开始回收
-XX:+UseCMSInitiatingOccupancyOnly       # 只用上述阈值，不动态调整
-XX:CMSFullGCsBeforeCompaction=5         # 5 次 Full GC 后整理一次
-XX:ParallelCMSThreads=4                 # CMS 线程数（默认 = CPU 核心数）

# JDK 8 经典配置
java -XX:+UseConcMarkSweepGC \
     -XX:CMSInitiatingOccupancyFraction=70 \
     -XX:+UseCMSCompactAtFullCollection \
     -XX:CMSFullGCsBeforeCompaction=5 \
     -XX:+PrintGCDetails \
     -Xmx4g -Xms4g \
     your.Application
```

---

## CMS 的调优策略

### 策略 1：提前启动 CMS

```bash
# 问题：CMS 并发阶段耗时长，容易触发 Concurrent Mode Failure
# 解决：早点开始 CMS

# 默认 70%，可以调低到 60% 或 50%
-XX:CMSInitiatingOccupancyFraction=60
```

### 策略 2：预清理减少 STW

```bash
# 预清理（Precleaning）
# 在重新标记前，先做一些准备工作
-XX:+UseCMSCompactAtFullCollection    # Full GC 时整理
```

### 策略 3：增量模式（已被废弃）

```bash
# JDK 8 及之前
# 增量 CMS：让 CMS 和用户线程交替执行，减少 CPU 占用
-XX:+UseCMSIncrementalMode

# JDK 9+ 已移除，因为效果不佳
```

---

## CMS 日志分析

```text
# CMS 收集日志
2024-01-15T10:30:00.123: [GC (CMS Initial Mark)
    [CMS-initial-mark: 102400K(204800K)] 102400K(204800K), 0.0012345 secs]
    # 初始标记：老年代使用 100MB / 200MB，停顿 1.2ms

2024-01-15T10:30:00.124: [CMS-concurrent-mark-start]
2024-01-15T10:30:00.234: [CMS-concurrent-mark: 0.110/0.110 secs]
    # 并发标记：0.11 秒

2024-01-15T10:30:00.234: [CMS-concurrent-preclean-start]
2024-01-15T10:30:00.244: [CMS-concurrent-preclean: 0.010/0.010 secs]
    # 预清理

2024-01-15T10:30:00.244: [CMS-concurrent-sweep-start]
2024-01-15T10:30:00.354: [CMS-concurrent-sweep: 0.110/0.110 secs]
    # 并发清除

2024-01-15T10:30:00.354: [CMS-concurrent-reset-start]
2024-01-15T10:30:00.364: [CMS-concurrent-reset: 0.010/0.010 secs]
    # 并发重置

# 并发模式失败
2024-01-15T10:35:00.000: [Full GC (Concurrent Mode Failure)
    [CMS: 204800K->150000K(204800K), 2.5000000 secs]
    # Concurrent Mode Failure，触发 Serial Old Full GC
```

---

## CMS 的演进与消亡

### JDK 版本变化

| JDK 版本 | CMS 状态 |
|---------|---------|
| JDK 4-8 | 支持 |
| JDK 9 | 标记为废弃（@Deprecated）|
| JDK 14 | 移除 |

### 替代方案

```
CMS ──────► G1 (JDK 9+) ──────► ZGC / Shenandoah (JDK 11+)

CMS 的问题：                      G1 的改进：
- 内存碎片                       - Region 化，减少碎片
- 单线程 Full GC                 - 并行整理
- 被逐步移除                      - 可预测停顿

ZGC 的优势：
- 停顿时间 < 1ms
- 并发整理
- 不分代设计
```

---

## 面试追问方向

- CMS 的四步中，哪些步骤需要 Stop The World？各自停顿多长时间？
- CMS 为什么使用标记-清除而不是标记-整理？有什么后果？
- 什么是「并发模式失败」（Concurrent Mode Failure）？如何避免？
- CMS 的预清理（Precleaning）是为了解决什么问题？
- JDK 9+ 不再支持 ParNew + CMS 组合，你认为原因是什么？
- CMS 的浮动垃圾最多能有多少？如何控制？
