# Sentinel 系统自适应限流：全局视角的系统保护

一个残酷的事实：流量控制管的是"点"，熔断降级管的是"线"。

但系统崩溃，往往不是因为某一个点或某一条线，而是整个**面**都在承受压力。

比如：
- CPU 使用率飙到 98%，所有请求都在排队
- 内存即将耗尽，GC 频繁 Full GC
- 线程池被打满，新请求进不来
- 响应延迟急剧上升，用户体验崩溃

这些情况下，单独的流量控制规则和熔断规则已经不够用了。你需要**从系统全局视角**做保护。

这就是 Sentinel 的**系统自适应限流**。

---

## 系统自适应限流的原理

Sentinel 的系统自适应限流，会从系统维度采集以下指标：

| 指标 | 说明 | 获取方式 |
|---|---|---|
| **CPU 使用率** | 系统 CPU 负载 | `OperatingSystemMXBean` |
| **平均 RT** | 所有请求的平均响应时间 | 实时统计 |
| **并发线程数** | 当前活跃的线程数 | 线程池统计 |
| **入口 QPS** | 每秒进入系统的请求数 | 实时统计 |

当这些指标超过预设阈值时，Sentinel 会**拒绝所有新进入的请求**，直到系统负载下降到安全水平。

```java
SystemRule rule = new SystemRule()
    .setHighestCpuUsage(0.8)     // CPU 使用率不超过 80%
    .setHighestSystemLoad(10.0) // 系统负载不超过 10
    .setMaxAvgRt(1000)          // 平均 RT 不超过 1000ms
    .setMaxThread(100);         // 并发线程数不超过 100

SystemRuleManager.loadRules(Collections.singletonList(rule));
```

**注意**：这些指标是"与"的关系，任意一个超标都会触发限流。

---

## 什么是系统负载（System Load）？

`setHighestSystemLoad` 里的"系统负载"是什么？

在 Linux 中，系统负载（Load Average）表示**正在运行和等待 CPU 的进程数**。

- Load = 1（单核满载）
- Load = 4（四核满载）
- Load = 0.5（四核有一半空闲）

```bash
# 查看系统负载
$ uptime
 14:32:01 up 45 days,  3:22,  1 user,  load average: 2.45, 1.87, 1.62
```

**Sentinel 里的 Load 阈值怎么设？**

一个经验公式：

```
Load 阈值 = CPU 核心数 × 0.6 ~ 0.8
```

比如 8 核 CPU，阈值设为 5~6 比较合适。

太低会过于保守（系统还有余量就开始限流），太高则保护效果不明显。

---

## CPU 自适应限流

这是最直接的系统保护策略。

```java
// 当 CPU 使用率超过 70% 时，开启自适应限流
SystemRule rule = new SystemRule()
    .setHighestCpuUsage(0.7);

SystemRuleManager.loadRules(Collections.singletonList(rule));
```

**工作原理**：

1. Sentinel 每秒采样一次 CPU 使用率
2. 如果 CPU 使用率超过 70%，开始拒绝请求
3. 拒绝的比例与 CPU 使用率成正比——CPU 越高，拒绝越多
4. 当 CPU 使用率下降到安全区间，恢复正常

**适用场景**：

- 系统面临突发流量
- 存在 CPU 密集型操作（复杂计算、加解密等）
- 需要快速降载保护系统

---

## 入口 QPS 自适应

当系统入口 QPS 过高时，即使单个请求不慢，整体负载也会飙升。

```java
// 当入口 QPS 超过 10000 时，开始限流
SystemRule rule = new SystemRule()
    .setQps(10000);

SystemRuleManager.loadRules(Collections.singletonList(rule));
```

**这个策略的独特之处**：

入口 QPS 自适应是 Sentinel 根据**当前系统 RT** 自动计算的。

- 系统 RT 正常（10ms）：可以承受更高的 QPS
- 系统 RT 变慢（500ms）：同样的 QPS 意味着更大的并发压力

所以 Sentinel 会动态调整允许的 QPS 阈值，公式大致是：

```
允许 QPS = 当前系统 RT × 目标 Load / 平均 RT
```

---

## 平均 RT 自适应

如果系统响应变慢，即使 QPS 不高，堆积的请求也会耗尽线程资源。

```java
// 当平均 RT 超过 1000ms 时，开始限流
SystemRule rule = new SystemRule()
    .setMaxAvgRt(1000);

SystemRuleManager.loadRules(Collections.singletonList(rule));
```

**为什么限制平均 RT 而不是最大 RT？**

最大 RT 容易被个别极端值影响（比如一次 Full GC 导致 10 秒延迟）。平均 RT 更能反映系统的整体表现。

---

## 并发线程数自适应

线程是系统最宝贵的资源之一。当活跃线程数过多时，上下文切换会成为新的瓶颈。

```java
// 当并发线程数超过 200 时，开始限流
SystemRule rule = new SystemRule()
    .setMaxThread(200);

SystemRuleManager.loadRules(Collections.singletonList(rule));
```

**注意**：这里的"并发线程数"指的是 Sentinel 统计到的活跃线程数，不是 Tomcat 的最大线程数。

---

## 多维度配合使用

实际生产中，通常会组合多个维度：

```java
List<SystemRule> rules = Arrays.asList(
    // CPU 保护
    new SystemRule().setHighestCpuUsage(0.8),
    // 系统负载保护
    new SystemRule().setHighestSystemLoad(10.0),
    // RT 保护
    new SystemRule().setMaxAvgRt(2000),
    // 并发线程保护
    new SystemRule().setMaxThread(200)
);

SystemRuleManager.loadRules(rules);
```

**策略解读**：

- CPU 80% 以上 → 系统过载，开始限流
- 系统负载 10 以上 → 等待队列过长，开始限流
- 平均 RT 超过 2 秒 → 响应太慢，开始限流
- 并发线程超过 200 → 资源耗尽，开始限流

任意一个条件触发，都会开启保护。

---

## 自适应限流 vs 规则限流

| 维度 | 规则限流 | 系统自适应限流 |
|---|---|---|
| **粒度** | 资源级别 | 系统级别 |
| **触发条件** | 单个资源的 QPS/并发数 | CPU、Load、RT、线程数 |
| **配置方式** | 静态配置 | 静态阈值 + 动态计算 |
| **适用场景** | 保护单个接口 | 保护整个系统 |
| **优先级** | 低于系统规则 | 最高优先级 |

**优先级顺序**：

```
系统规则 > 熔断规则 > 流控规则
```

当系统规则生效时，即使流控规则允许，请求也可能被拒绝。

---

## 面试加分点

面试中可以展示对系统保护的理解：

> 流量控制是"精确打击"，针对单个资源做保护。系统自适应限流是"地毯式轰炸"，从全局视角保护整个系统。两者的结合，才能构建完整的保护体系。

如果面试官追问自适应限流的实现：

> Sentinel 通过 JMX 或 JOL（Java Object Layout）获取系统指标。CPU 使用率通过 `OperatingSystemMXBean.getSystemCpuLoad()` 获取，Load Average 通过 `OperatingSystemMXBean.getSystemLoadAverage()` 获取。这些指标会被 Sentinel 的 SystemSlot 实时采样，作为限流的依据。

---

## 总结

系统自适应限流的核心是**从全局视角保护系统**：

- **CPU 使用率**：防止处理器过载
- **系统负载**：防止等待队列过长
- **平均 RT**：防止响应堆积
- **并发线程数**：防止资源耗尽

系统自适应限流是 Sentinel 的最后一道防线。当它生效时，说明系统已经面临压力，需要立即降载保护。

但无论限流做得多好，都无法完全避免故障。下一节，我们来聊聊 Sentinel 的**注解支持与 Dubbo 集成**，看看如何更优雅地使用 Sentinel。
