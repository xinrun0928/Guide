# JVM

JVM（Java Virtual Machine）是 Java 能实现「一次编译，到处运行」的核心，也是深入理解 Java 语言的必经之路。

从 .class 文件的加载，到堆内存的分配，到垃圾的回收，到字节码的执行——每一步都藏着大量知识点。这一模块，把 JVM 的全貌展现在你面前。

---

## 模块内容

### JVM 体系结构

先从全局看 JVM，了解它的组成部分。

- [JVM 整体架构图解](/java/jvm/architecture)：类加载子系统、运行时数据区、执行引擎、本地接口
- [类加载子系统与类加载器分类](/java/jvm/classloader)：Bootstrap / Ext / App ClassLoader 三层结构
- [双亲委派模型与打破方式](/java/jvm/parent-delegation)：parent.loadClass() 递归委托、JDBC 的例外
- [ClassLoader 源码解析与自定义类加载器](/java/jvm/classloader-source)：findClass()、热部署原理
- [类的主动加载与被动加载](/java/jvm/class-loading)：new vs 静态字段 vs 常量池的加载时机差异

### 运行时数据区

JVM 的内存布局，是排查 OOM 和性能问题的地图。

- [运行时数据区总览与各区域作用](/java/jvm/runtime-area)：线程私有 vs 共享、直接内存
- [程序计数器：线程私有与分支跳转](/java/jvm/program-counter)：唯一没有 OOM 的区域
- [虚拟机栈：栈帧结构与操作数栈](/java/jvm/vm-stack)：局部变量表 / 操作数栈 / 动态链接 / 返回地址
- [本地方法栈](/java/jvm/native-method-stack)：JNI 调用栈
- [堆内存：年轻代、老年代、TLAB](/java/jvm/heap)：Eden / Survivor / Old、对象分配流程、TLAB 机制
- [方法区：JDK 7 PermGen vs JDK 8 Metaspace](/java/jvm/method-area)：★ 面试高频：永久代与元空间的本质区别
- [运行时常量池与字符串常量池](/java/jvm/constant-pool)：两种常量池的关系与区别
- [直接内存（堆外内存）与 NIO](/java/jvm/direct-memory)：DirectByteBuffer、零拷贝、MaxDirectMemorySize

### 垃圾回收

GC 是 JVM 中知识点最密集的部分，也是面试的重灾区。

- [GC 判断对象存活算法](/java/jvm/gc-algorithm)：引用计数 vs 可达性分析（GC Roots）
- [四种引用：强引用、软引用、弱引用、虚引用](/java/jvm/reference)：WeakReference / SoftReference / PhantomReference
- [分代收集理论](/java/jvm/gc-generation)：弱分代假说 / 强分代假说、空间分配担保
- [Minor GC vs Major GC vs Full GC](/java/jvm/gc-types)：G1 打破了传统的分类、Full GC 触发条件
- [垃圾收集算法](/java/jvm/gc-algorithm-type)：标记-清除（碎片化）/ 复制（内存减半）/ 标记-整理（移动开销）
- [垃圾收集器分类与组合关系图](/java/jvm/gc-collector)：年轻代 vs 老年代收集器一览
- [Serial / Serial Old](/java/jvm/serial-gc)：单线程王者、STW
- [ParNew：多线程年轻代收集器](/java/jvm/parnew-gc)：CMS 的默认搭档
- [Parallel Scavenge / Parallel Old](/java/jvm/parallel-gc)：吞吐量优先、自适应调节
- [CMS：并发标记-清除收集器](/java/jvm/cms-gc)：★ JDK 8 常用、四步过程、concurrent mode failure
- [G1：Region 化分代收集器](/java/jvm/g1-gc)：★ JDK 9+ 默认、Humongous 区、Mixed GC
- [ZGC / Shenandoah：低延迟收集器](/java/jvm/low-latency-gc)：&lt; 1ms 停顿、染色指针、STW 问题终结者
- [GC 日志分析实战](/java/jvm/gc-log)：GCViewer / GCEasy 工具
- [Full GC 问题排查与调优](/java/jvm/full-gc-tuning)：频繁 Full GC 的根因分析与调优策略

### 性能监控与调优

OOM 问题定位和性能调优，是每个高级 Java 工程师的必备技能。

- [OutOfMemoryError 各类型与原因分析](/java/jvm/oom)：Heap Space / Metaspace / Direct Buffer / StackOverflow / Unable to create new native thread
- [堆内存溢出（Heap Space OOM）排查](/java/jvm/heap-oom)：jmap + MAT、Dominator Tree
- [虚拟机栈溢出（StackOverflowError）排查](/java/jvm/stackoverflow)：递归深度、-Xss 参数
- [Metaspace 溢出排查](/java/jvm/metaspace-oom)：类加载过多、CGLIB 动态代理
- [jstat、jmap、jstack、jhat 工具使用](/java/jvm/jvm-tools)：JVM 诊断工具全家桶
- [MAT 内存分析工具实战](/java/jvm/mat)：Histogram / Dominator Tree / Leak Suspects
- [Arthas 诊断工具使用](/java/jvm/arthas)：dashboard / trace / watch / jad / thread
- [JVM 参数配置与调优经验](/java/jvm/jvm-tuning)：吞吐量优先 vs 延迟优先配置方案
- [CPU 高占用分析：Arthas trace 与火焰图](/java/jvm/cpu-high)：四步定位法、profiler 生成火焰图

### 字节码与编译优化

理解字节码，才能真正读懂 JVM 在做什么。

- [字节码入门：常用字节码指令](/java/jvm/bytecode)：aload/astore / invokevirtual / monitorenter / ...
- [反编译工具](/java/jvm/decompile)：javap -c -v / jclasslib / IDEA 插件
- [JIT 即时编译](/java/jvm/jit)：解释器 vs JIT、分层编译、热点探测
- [逃逸分析：标量替换与栈上分配](/java/jvm/escape-analysis)：-XX:+DoEscapeAnalysis、同步消除
- [方法内联与热点代码探测](/java/jvm/inlining)：虚方法内联、morphic / bimorphic / megamorphic

---

## 学习路线建议

```
第一阶段：JVM 架构 → 类加载 → 双亲委派（全局认知）
         ↓
第二阶段：运行时数据区 → 方法区 vs Metaspace ★（理解内存布局）
         ↓
第三阶段：GC 算法 → 各收集器 → CMS vs G1 vs ZGC ★（GC 全貌）
         ↓
第四阶段：OOM 排查 → JVM 工具 → 性能调优（工程实践）
         ↓
第五阶段：字节码 → JIT → 逃逸分析（深度理解执行过程）
```

## 面试核心考点

| 高频考点 | 关联文档 |
|---|---|
| JDK 7 PermGen vs JDK 8 Metaspace | [方法区](/java/jvm/method-area) |
| 垃圾收集器组合 | [CMS](/java/jvm/cms-gc)、[G1](/java/jvm/g1-gc)、[ZGC](/java/jvm/low-latency-gc)、[组合关系](/java/jvm/gc-collector) |
| 三大 GC 算法 | [GC 算法](/java/jvm/gc-algorithm-type) |
| Full GC 触发条件 | [Minor/Major/Full GC](/java/jvm/gc-types) |
| OOM 类型与排查 | [OOM 总览](/java/jvm/oom)、[Heap OOM](/java/jvm/heap-oom)、[Metaspace OOM](/java/jvm/metaspace-oom) |
| 双亲委派模型 | [双亲委派](/java/jvm/parent-delegation) |
| JVM 内存区域 | [运行时数据区](/java/jvm/runtime-area) |
| JIT 编译优化 | [逃逸分析](/java/jvm/escape-analysis)、[方法内联](/java/jvm/inlining)、[JIT](/java/jvm/jit) |
| JVM 调优工具 | [Arthas](/java/jvm/arthas)、[JVM 工具](/java/jvm/jvm-tools)、[MAT](/java/jvm/mat) |
