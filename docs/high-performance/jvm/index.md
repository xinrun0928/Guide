# JVM 性能调优

凌晨 3 点，你被一阵急促的告警惊醒。

监控系统显示：服务器 CPU 100%，响应时间暴涨 10 倍。用户无法下单，订单量归零。

你登录服务器，执行 `jstack` 查看线程堆栈——满屏的 GC 线程在疯狂运行。GC 日志显示：每 30 秒触发一次 Full GC，每次 GC 后内存迅速耗尽。

你慌了：这是内存泄漏？还是 GC 参数配错了？

你查了半天，发现问题根源是一个 `static Map` 持有了一百万个用户会话，导致内存持续增长，最终触发 OOM。

**Java 应用的性能问题，有一半和 JVM 脱不了关系。**

本模块从 JVM 参数体系讲起，涵盖 GC 调优实战、内存优化与 OOM 排查，助你成为 JVM 调优专家。

---

## 模块速览

### JVM 基础与参数

| 文档 | 简介 |
|-----|-----|
| [JVM 参数类型与选择](/high-performance/jvm/param-type) | 标准参数、非标准参数、高级参数 |
| [堆内存参数配置](/high-performance/jvm/heap-param) | 堆大小、分代比例 |
| [元空间参数配置](/high-performance/jvm/metaspace-param) | 元空间大小与溢出排查 |
| [GC 参数配置](/high-performance/jvm/gc-param) | 垃圾收集器选择与参数 |
| [调试与诊断参数](/high-performance/jvm/debug-param) | -XX 参数实战 |

### GC 调优实战

| 文档 | 简介 |
|-----|-----|
| [GC 日志分析](/high-performance/jvm/gc-log) | GC 日志配置与解读 |
| [GC 日志可视化](/high-performance/jvm/gc-visualize) | GCeasy、GCViewer 工具使用 |
| [Minor GC 分析](/high-performance/jvm/minor-gc) | 年轻代GC原理与优化 |
| [Full GC 分析与排查](/high-performance/jvm/full-gc) | Full GC 原因与解决 |
| [G1 收集器参数](/high-performance/jvm/g1-param) | G1调优核心参数 |
| [G1 调优实战](/high-performance/jvm/g1-tuning) | G1最佳实践 |
| [CMS 收集器调优](/high-performance/jvm/cms-tuning) | CMS调优与问题排查 |
| [GC 推荐配置](/high-performance/jvm/gc-recommend) | 不同场景的推荐配置 |

### 内存问题与 OOM 排查

| 文档 | 简介 |
|-----|-----|
| [堆内存溢出（OOM）排查](/high-performance/jvm/heap-oom) | MAT、Java VisualVM 使用 |
| [直接内存溢出排查](/high-performance/jvm/direct-memory-oom) | DirectByteBuffer 泄漏 |
| [元空间溢出排查](/high-performance/jvm/metaspace-oom) | 动态类加载问题 |
| [内存泄漏分析](/high-performance/jvm/memory-leak) | 常见泄漏场景与定位 |
| [CPU 飙高排查](/high-performance/jvm/cpu-high) | 定位 CPU 热点代码 |

### 工具与实战

| 文档 | 简介 |
|-----|-----|
| [Arthas 诊断工具](/high-performance/jvm/arthas) | 热修复、火焰图、方法追踪 |
| [JVM 调优工具](/high-performance/jvm/memory-tools) | jmap、jstat、jinfo 使用 |
| [JVM 调优总结](/high-performance/jvm/tuning-summary) | 调优方法论与案例 |

---

## JVM 调优的核心问题

### 问题一：GC 频繁导致停顿

GC 停顿是 Java 应用最大的性能杀手之一。

表现：

- 用户请求响应时间忽高忽低
- GC 日志显示频繁的 Full GC
- 停顿时间长达几秒

解决方案：

- 增大堆内存，减少 GC 频率
- 选择更合适的垃圾收集器（G1、ZGC）
- 优化对象分配（对象池化、减少大对象）

### 问题二：内存泄漏导致 OOM

内存泄漏是生产环境的常见问题。

常见泄漏场景：

| 泄漏场景 | 典型案例 | 排查方法 |
|---------|---------|---------|
| 集合类泄漏 | static Map 持续增长 | MAT dump 分析 |
| 资源未关闭 | 数据库连接未释放 | 代码审查 |
| 监听器未注销 | 事件监听器堆积 | 堆快照对比 |
| ThreadLocal 泄漏 | 线程池中 ThreadLocal 未清理 | jstack 线程分析 |

### 问题三：GC 参数配置不当

JVM 参数有几百个，配置不当可能导致性能下降。

常见误区：

- 堆内存设置过大：GC 停顿时间变长
- 堆内存设置过小：频繁 GC，吞吐量下降
- 年轻代设置过大：老年代空间不足，频繁 Full GC
- 年轻代设置过小：对象过早晋升，触发 Full GC

---

## 垃圾收集器的演进

### 经典收集器

| 收集器 | 算法 | 停顿时间 | 适用场景 |
|-------|-----|---------|---------|
| Serial | 单线程标记-复制 | 长（Stop The World） | 单核、低内存 |
| Parallel | 多线程标记-复制 | 长 | 多核、批处理 |
| CMS | 并发标记-清除 | 短 | 互联网应用 |
| G1 | 分区+标记-整理 | 可控 | 替代 CMS |

### 现代收集器（JDK 11+）

| 收集器 | 算法 | 停顿时间 | 特点 |
|-------|-----|---------|-----|
| ZGC | 着色指针+读屏障 | <1ms | 低延迟、大堆 |
| Shenandoah | 转发指针 | <1ms | OpenJDK 专用 |
| Epsilon | 无操作 | 无 | 短命程序 |

**JDK 17+ 推荐**：追求低延迟用 ZGC，追求高吞吐用 G1。

---

## 学习路径建议

### 入门：理解 JVM 内存模型

建议先学习**堆内存参数**和**GC 基础**。

理解 JVM 内存如何划分，对象如何在堆中分配和回收。这些是调优的基础。

### 进阶：掌握 GC 调优

深入学习**GC 日志分析**和**G1 调优**。

G1 是 JDK 9+ 的默认收集器，也是目前最通用的选择。掌握 G1 的参数配置和问题排查，是 JVM 调优的必备技能。

### 高级：解决 OOM 问题

学习**内存泄漏分析**和**Arthas 诊断工具**。

OOM 是生产环境最紧急的问题。能够在高压下快速定位问题，是高级工程师的核心能力。

---

## 延伸思考

JVM 调优有个「三七法则」：

**70% 的 JVM 问题，可以通过合理的内存配置解决。**

**20% 的问题，需要调整 GC 参数。**

**10% 的问题，需要修改代码。**

所以，调优的顺序是：

1. 先用默认配置，观察 GC 行为
2. 调整内存大小，让 GC 频率合理
3. 选择合适的垃圾收集器
4. 调整 GC 参数，优化停顿时间
5. 如果还不行，从代码层面优化对象分配

**记住：JVM 调优是最后的手段，不是第一选择。先优化代码，再考虑调优 JVM。**

下一模块，我们将探讨高可用架构——让系统在故障中依然稳定运行。
