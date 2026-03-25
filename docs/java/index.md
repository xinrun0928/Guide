# Java

Java 诞生于 1995 年，最初的目标是为消费电子设备编程。

谁能想到，这个为微波炉设计的语言，后来统治了企业级开发、手机 Android、后端服务、大数据生态——直到今天，依然是全球最受欢迎的编程语言之一。

但 Java 的魅力不只是「流行」。

它有一套精密的运行时系统（JVM），有一套历经二十年打磨的类库，有一套严谨的内存模型和并发机制。理解这些，你不仅能用 Java，更能「驾驭」Java。

---

## 模块总览

### [📝 Java 基础](/java/basic/index)

数据类型、面向对象、String 源码、异常体系、枚举与注解、泛型、序列化——这是 Java 的语法根基。

从 `new String("abc")` 到底创建了几个对象，到 Integer 缓存池的秘密，再到 BigDecimal 的正确打开方式——这些看似「基础」的问题，撑起了无数面试现场。

### [📚 集合框架](/java/collection/index)

ArrayList 为什么查询快、LinkedList 为什么插入快？HashMap 凭什么做到 O(1) 的查找效率？

这一模块从 Collection 体系出发，深入 HashMap 的 JDK 7 头插法死循环、JDK 8 红黑树引入、扰动函数、负载因子的数学证明——把集合框架讲透。

### [⚡ Java 并发编程](/java/concurrent/index)

synchronized 的锁升级机制、volatile 的内存屏障、CAS 的 ABA 问题、AQS 的独占与共享模式、CompletableFuture 的异步编排——并发是 Java 最复杂的领域，也是面试最深的水。

这一模块覆盖从线程基础到 JUC 全套工具，从 JMM 八大 happens-before 规则到死锁的排查与预防。

### [🖥️ JVM](/java/jvm/index)

JVM 是 Java「一次编译，到处运行」的核心。从类加载的双亲委派，到堆内存的分代布局，到垃圾回收的七大收集器，再到字节码与 JIT 编译优化——理解 JVM，才能真正掌握 Java。

这里有 JDK 7 PermGen 与 JDK 8 Metaspace 的本质区别，有 CMS/G1/ZGC 的演进关系，有 Arthas 火焰图的实战指南。

### [🌐 Java I/O 与网络](/java/io/index)

select/poll/epoll 的本质差异、BIO/NIO/AIO 的编程模型演进、Netty 的零拷贝与 ByteBuf、Tomcat 的线程模型——这一模块从操作系统层面理解 Java 的 I/O 机制。

### [✨ Java 17+ 新特性](/java/new-features/index)

JDK 17 是目前最推荐的 LTS 版本，JDK 21 带来了革命性的虚拟线程（Virtual Thread）。

这一模块记录了从 JDK 9 到 JDK 21 的每一个重要特性：Switch 表达式、Record 类型、Sealed Class、Pattern Matching for instanceof、Pattern Matching for switch——Java 正在变得越来越现代。

---

## 学习路线

```
新手入门
  ↓
Java 基础（数据类型 → 面向对象 → String → 异常 → 泛型）
  ↓
集合框架（List → Map → 并发容器）
  ↓
Java 并发（线程 → synchronized → JUC → AQS → CompletableFuture）
  ↓
JVM（类加载 → 运行时数据区 → GC → 性能调优 → 字节码）
  ↓
Java 新特性（选择性学习，JDK 17+ 为主）
```

## 面试核心体系

| 核心领域 | 代表性面试题 |
|---|---|
| **String** | String 为什么不可变？new String() 创建几个对象？intern() 原理？ |
| **集合** | HashMap 死循环？JDK 7 vs JDK 8 区别？红黑树为什么是 8？ |
| **并发** | synchronized 锁升级过程？volatile 内存屏障？线程池拒绝策略？ |
| **JVM** | PermGen vs Metaspace？CMS 和 G1 的区别？Full GC 如何排查？ |

> 如果你是在准备面试，建议从 **Java 基础** 开始，一路打到 **JVM**，每一条链路都不要跳过。面试官最喜欢追问的地方，往往就在这些「你以为懂了但没完全懂」的交界处。
