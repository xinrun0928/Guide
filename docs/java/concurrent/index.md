# Java 并发编程

并发编程是 Java 体系中最高阶也是最复杂的部分。

当多个线程同时访问共享资源，当 CPU 的每一个核心都被压榨到极限，当死锁、活锁、饥饿轮番出现——你需要的正是这一模块的知识。

从最基础的线程概念，到 synchronized 的锁升级，到 JUC 并发工具，到 AQS 底层原理，再到 CompletableFuture 异步编程——这条路，每一步都踩在面试的高频考点上。

---

## 模块内容

### 线程与进程

理解并发的第一步，是搞清楚线程和进程的区别。

- [进程与线程的区别与关系](/java/concurrent/process-thread)：资源分配 vs CPU 调度、线程共享与独立区域
- [创建线程的 3 种方式](/java/concurrent/create-thread)：Thread / Runnable / Callable+FutureTask
- [Thread 生命周期与状态转换](/java/concurrent/thread-state)：NEW → RUNNABLE → BLOCKED/WAITING/TIMED_WAITING → TERMINATED
- [start() vs run()：为什么必须调用 start()](/java/concurrent/start-vs-run)：start0() 本地方法、线程唯一性
- [sleep() vs wait() vs yield()](/java/concurrent/sleep-wait-yield)：三大暂停方法的本质区别
- [join() 与线程等待](/java/concurrent/join)：线程汇合、底层调用 wait()
- [守护线程与用户线程](/java/concurrent/daemon-thread)：GC 线程是守护线程、JVM 退出时机

### synchronized 关键字

synchronized 是 Java 最基础的同步机制，JDK 6 之后它脱胎换骨。

- [synchronized 锁的是什么？对象头结构](/java/concurrent/synchronized-object)：锁的是对象不是代码、Mark Word 布局
- [synchronized 修饰方法 vs 代码块](/java/concurrent/synchronized-method-block)：this 锁 vs Class 锁 vs 任意对象锁
- [JDK 6 之后锁升级机制](/java/concurrent/lock-escalation)：偏向锁 → 轻量级锁 → 重量级锁，不可逆的过程
- [偏向锁的获取、撤销与批量重偏向](/java/concurrent/biased-lock)：Bulk Rebiasing、Biased Locking 的代价
- [轻量级锁：CAS + 自旋](/java/concurrent/lightweight-lock)：Lock Record、CAS 自旋优化
- [重量级锁：Monitor 机制与等待队列](/java/concurrent/heavyweight-lock)：Owner/EntryList/WaitSet、用户态与内核态切换
- [锁消除与锁粗化优化](/java/concurrent/lock-coarsening)：JIT 编译器的优化手段

### JUC 并发工具

Doug Lea 为我们打造了一套强大的并发工具箱。

- [ReentrantLock：可重入锁与公平/非公平策略](/java/concurrent/reentrant-lock)：tryLock()、公平锁 vs 非公平锁
- [ReentrantLock vs synchronized 对比](/java/concurrent/lock-vs-synchronized)：特性对比表、选型建议
- [ReadWriteLock：读写锁原理](/java/concurrent/read-write-lock)：读读不互斥、读写互斥、缓存实现
- [StampedLock：乐观读 vs 悲观读](/java/concurrent/stamped-lock)：tryOptimisticRead、读锁降级
- [Semaphore：信号量控制并发数](/java/concurrent/semaphore)：acquire/release、限流与令牌桶
- [CountDownLatch：线程倒计时协调](/java/concurrent/countdown-latch)：一次性门栓、多线程汇总
- [CyclicBarrier：循环栅栏](/java/concurrent/cyclic-barrier)：可循环使用、与 CountDownLatch 的区别
- [Condition：精准等待与唤醒](/java/concurrent/condition)：多个条件变量、生产者-消费者队列

### 线程池

线程池是现代服务端开发的核心组件。

- [为什么要用线程池？](/java/concurrent/threadpool-why)：降低资源消耗、提高响应速度、可管理性
- [ThreadPoolExecutor 七大参数详解](/java/concurrent/threadpool-params)：corePoolSize / maximumPoolSize / workQueue / ...
- [线程池拒绝策略对比](/java/concurrent/reject-policy)：AbortPolicy / CallerRunsPolicy / DiscardPolicy / DiscardOldestPolicy
- [4 种常用线程池](/java/concurrent/threadpool-types)：Fixed / Cached / Single / Scheduled、OOM 陷阱
- [线程池参数配置与调优](/java/concurrent/threadpool-tuning)：CPU 密集型 vs IO 密集型配置
- [线程池执行流程与状态转换](/java/concurrent/threadpool-execute)：五步流程图、五种状态
- [ScheduledThreadPoolExecutor 定时任务原理](/java/concurrent/scheduled-threadpool)：DelayedWorkQueue、时间调度
- [Fork/Join 框架与工作窃取算法](/java/concurrent/fork-join)：WorkQueue、双端队列、RecursiveTask

### JMM 与 volatile

Java 内存模型定义了线程间通信的规则。

- [Java 内存模型：主内存与工作内存](/java/concurrent/jmm)：线程间通信的两步走
- [JMM 八大 Happens-Before 规则](/java/concurrent/happens-before)：程序顺序、监视器锁、volatile 变量、线程启动...
- [volatile 可见性原理：内存屏障](/java/concurrent/volatile-visible)：Store Barrier / Load Barrier
- [volatile 有序性原理：禁止指令重排序](/java/concurrent/volatile-order)：四种内存屏障、StoreLoad
- [volatile 能保证原子性吗？](/java/concurrent/volatile-atomic)：i++ 不是原子操作、volatile 的局限
- [DCL 单例模式与 volatile](/java/concurrent/dcl-singleton)：new Singleton() 的三步、为什么要 volatile

### CAS 与原子类

无锁编程的核心——CAS 是高性能并发的基础。

- [CAS 原理与三大问题](/java/concurrent/cas)：ABA 问题、循环开销、范围限制
- [AtomicInteger/AtomicLong 源码解析](/java/concurrent/atomic-integer)：Unsafe、CAS + 自旋、lazySet
- [AtomicReference 与 ABA 问题](/java/concurrent/atomic-reference)：引用级别的原子操作
- [AtomicStampedReference：解决 ABA 问题](/java/concurrent/atomic-stamped)：版本号机制
- [LongAdder vs AtomicLong 高并发性能对比](/java/concurrent/long-adder)：Cell[] 分散计数、空间换时间

### 并发安全与死锁

线程安全是并发编程的终极目标，死锁是它最大的敌人。

- [线程安全三大特性](/java/concurrent/thread-safety)：原子性、可见性、有序性
- [死锁产生的 4 个必要条件](/java/concurrent/deadlock-condition)：互斥、占有并等待、不可抢占、循环等待
- [死锁定位与排查方法](/java/concurrent/deadlock-debug)：jstack 定位、VisualVM 分析
- [如何避免死锁：破坏四大条件](/java/concurrent/deadlock-prevent)：资源有序分配、一次性申请所有资源
- [活锁与饥饿](/java/concurrent/livelock-starvation)：活锁的随机退避策略
- [生产者-消费者问题](/java/concurrent/producer-consumer)：wait()/notify() 实现、BlockingQueue 实现
- [哲学家就餐问题](/java/concurrent/dining-philosophers)：死锁的经典模型、解决方案

### AQS 原理

AQS 是 JUC 中几乎所有同步器的底层框架。

- [AQS 核心思想：state + FIFO 队列](/java/concurrent/aqs)：volatile state、CLH 队列变体
- [AQS 两种模式：独占锁与共享锁](/java/concurrent/aqs-mode)：ReentrantLock vs CountDownLatch
- [AQS 实现 ReentrantLock 源码解析](/java/concurrent/aqs-reentrantlock)：公平锁 vs 非公平锁
- [AQS 实现 CountDownLatch 源码解析](/java/concurrent/aqs-countdownlatch)：state 递减、共享模式

### Future 与异步编程

从同步到异步，Java 走过了漫长的路。

- [Callable、Future、FutureTask 三者关系](/java/concurrent/callable-future)：FutureTask 是桥梁
- [Future 局限性：get() 阻塞与无法链式调用](/java/concurrent/future-limitation)：回调地狱的起源
- [JDK Future 接口方法详解](/java/concurrent/future-method)：get() / cancel() / isDone()
- [CompletableFuture 优势：异步 + 链式编排](/java/concurrent/completable-future)：JDK 8 的异步革命
- [CompletableFuture 创建方式](/java/concurrent/cf-create)：supplyAsync / runAsync / completedFuture
- [CompletableFuture 默认线程池](/java/concurrent/cf-default-executor)：ForkJoinPool.commonPool()
- [CompletableFuture 常用方法速查表](/java/concurrent/cf-method-cheatsheet)：17 个方法一表打尽
- [thenApply / thenApplyAsync](/java/concurrent/cf-then-apply)：同步与异步转换
- [thenAccept / thenRun](/java/concurrent/cf-then-accept)：消费结果与最终动作
- [thenCompose：扁平化链式调用](/java/concurrent/cf-then-compose)：解决回调地狱的核心方法
- [thenCombine / thenAcceptBoth](/java/concurrent/cf-then-combine)：合并两个 CompletableFuture
- [allOf / anyOf：批量等待与最先完成](/java/concurrent/cf-allof-anyof)：多任务聚合
- [exceptionally / whenComplete / handle](/java/concurrent/cf-exceptionally)：三种异常处理方式
- [CompletableFuture vs ParallelStream vs 响应式编程](/java/concurrent/cf-vs-parallel-stream)：选型指南
- [CompletableFuture 性能调优](/java/concurrent/cf-performance)：自定义线程池、最佳实践
- [并行流 ParallelStream 原理](/java/concurrent/parallel-stream)：Spliterator、ForkJoinPool
- [Java 异步编程模式总结](/java/concurrent/async-pattern)：Callback → Future → CompletableFuture → 响应式

### 其他重要主题

- [ThreadLocal 原理与内存泄漏](/java/concurrent/threadlocal)：ThreadLocalMap、弱引用、remove() 的必要性
- [Java 并发面试高频问题汇总](/java/concurrent/interview-summary)：十大高频题完整解答

---

## 学习路线建议

```
第一阶段：线程基础 → synchronized → volatile → JMM（Happens-Before）
         ↓
第二阶段：CAS → 原子类 → ReentrantLock → AQS 原理（深度理解底层）
         ↓
第三阶段：线程池 → JUC 工具 → CompletableFuture（工程实践）
         ↓
第四阶段：死锁 → 生产者消费者 → 面试汇总（查漏补缺）
```

## 面试核心考点

| 高频考点 | 关联文档 |
|---|---|
| synchronized 锁升级 | [锁升级机制](/java/concurrent/lock-escalation)、[偏向锁](/java/concurrent/biased-lock)、[轻量级锁](/java/concurrent/lightweight-lock)、[重量级锁](/java/concurrent/heavyweight-lock) |
| volatile 原理 | [可见性](/java/concurrent/volatile-visible)、[有序性](/java/concurrent/volatile-order)、[DCL 单例](/java/concurrent/dcl-singleton) |
| HashMap vs ConcurrentHashMap | [JDK 7 分段锁](/java/collection/concurrent-hashmap-jdk7)、[JDK 8 CAS+synchronized](/java/collection/concurrent-hashmap-jdk8) |
| 线程池参数与拒绝策略 | [七大参数](/java/concurrent/threadpool-params)、[拒绝策略](/java/concurrent/reject-policy)、[四种线程池](/java/concurrent/threadpool-types) |
| 死锁条件与排查 | [死锁四个条件](/java/concurrent/deadlock-condition)、[排查方法](/java/concurrent/deadlock-debug)、[预防策略](/java/concurrent/deadlock-prevent) |
| JMM 与 happens-before | [JMM](/java/concurrent/jmm)、[八大规则](/java/concurrent/happens-before) |
| CAS 的 ABA 问题 | [CAS 原理](/java/concurrent/cas)、[AtomicStampedReference](/java/concurrent/atomic-stamped) |
| ThreadLocal 内存泄漏 | [ThreadLocal](/java/concurrent/threadlocal) |
