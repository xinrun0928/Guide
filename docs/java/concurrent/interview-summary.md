# Java 并发面试高频问题汇总

Java 并发是面试中的重灾区，问题又多又深。

这里汇总了最常见的高频问题，附上回答思路。

---

## 一、synchronized 相关

### 问题 1：synchronized 和 Lock 的区别？

| 特性 | synchronized | Lock |
|-----|-------------|------|
| 获得锁失败 | 阻塞等待 | 可选择超时/放弃 |
| 释放锁 | 自动释放 | 必须手动释放 |
| 公平锁 | 否 | 可配置 |
| 条件变量 | 只有一个 | 可创建多个 |
| 中断支持 | 不可中断 | tryLock() 可中断 |

**参考回答**：
> synchronized 是 JVM 内置关键字，自动获取/释放锁，使用简单但功能有限。
>
> Lock 是接口实现，功能更丰富：支持公平/非公平、tryLock 超时、多个条件变量。
>
> JDK 6 之后 synchronized 做了大量优化，两者性能差异不大。

### 问题 2：synchronized 的锁升级过程？

**答案**：无锁 → 偏向锁 → 轻量级锁 → 重量级锁

```
┌─────────────────────────────────────────────────────────────┐
│                   锁升级过程（不可逆）                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  无锁 → 偏向锁 → 轻量级锁 → 重量级锁                        │
│                                                             │
│  阶段 1：偏向锁                                              │
│  ├─ 对象头记录线程 ID                                        │
│  ├─ 同一线程重入无需任何操作                                 │
│  └─ 其他线程竞争时，撤销偏向锁                               │
│                                                             │
│  阶段 2：轻量级锁                                            │
│  ├─ 线程栈帧创建 Lock Record                                │
│  ├─ CAS 替换 Mark Word                                      │
│  └─ 自旋获取锁，适合短时间等待                               │
│                                                             │
│  阶段 3：重量级锁                                           │
│  ├─ 互斥量，未抢到的线程阻塞                                 │
│  └─ 需要 OS 介入，有用户态到内核态切换                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 问题 3：synchronized 锁的是什么？

**参考回答**：
> synchronized 锁的是**对象**，不是代码。
>
> - 修饰代码块：锁括号里的对象
> - 修饰实例方法：锁 this 对象
> - 修饰静态方法：锁 Class 对象

---

## 二、volatile 相关

### 问题 4：volatile 的作用和原理？

**参考回答**：
> volatile 保证**可见性**和**有序性**，不保证原子性。
>
> **可见性原理**：volatile 写会强制刷新到主内存并发送 invalidate 信号；volatile 读会强制从主内存读取并 invalid 本地缓存。
>
> **有序性原理**：通过内存屏障禁止重排序。

### 问题 5：volatile 能保证原子性吗？

**答案**：不能！

```java
// 错误示例
volatile int count = 0;

// 线程 A
count++;  // 非原子操作！

// 线程 B
count++;  // 可能覆盖 A 的结果
```

**原因**：`count++` 分解成读取→修改→写入三步，volatile 只保证每一步的结果对其他线程可见，不保证这三步的原子性。

---

## 三、JMM 与 happens-before

### 问题 6：什么是 happens-before？

**参考回答**：
> happens-before 是 JMM 定义的偏序关系，表示前一个操作的结果对后一个操作可见。
>
> 核心规则：
> 1. 程序顺序规则：同一线程中，前面的 happens-before 后面的
> 2. 监视器锁规则：unlock happens-before lock
> 3. volatile 规则：volatile 写 happens-before 读
> 4. 线程启动规则：start() happens-before 线程内操作
> 5. 线程终止规则：线程内操作 happens-before join() 返回

### 问题 7：DCL 单例为什么要加 volatile？

```java
// 错误：DCL 可能失效
instance = new Singleton();
// 可能重排序：分配内存 → 赋值引用 → 构造函数

// 正确：加 volatile
private static volatile Singleton instance;
```

**原因**：volatile 写会在前面插入 StoreStore 屏障，后面插入 StoreLoad 屏障，保证构造函数在赋值引用之前完成。

---

## 四、CAS 与原子类

### 问题 8：CAS 是什么？有什么问题？

**答案**：Compare-And-Swap，硬件支持的原子指令。

**三大问题**：
1. **ABA 问题**：A→B→A，线程认为没变过。解决：AtomicStampedReference
2. **循环开销**：高并发下自旋消耗 CPU。解决：LongAdder
3. **范围限制**：只能操作单个变量。解决：AtomicReference 封装多变量

### 问题 9：AtomicInteger 和 LongAdder 怎么选？

| 场景 | 推荐 |
|-----|------|
| 低并发、需强一致性 | AtomicLong |
| 高并发、统计类 | LongAdder |
| 需要立即获取精确值 | AtomicLong |

**注意**：LongAdder 的 `sum()` 不是精确快照。

---

## 五、线程池相关

### 问题 10：线程池参数有哪些？

**答案**：
1. `corePoolSize`：核心线程数
2. `maximumPoolSize`：最大线程数
3. `keepAliveTime`：非核心线程空闲存活时间
4. `unit`：时间单位
5. `workQueue`：任务队列
6. `threadFactory`：线程工厂
7. `handler`：拒绝策略

### 问题 11：线程池拒绝策略有哪些？

| 策略 | 行为 |
|-----|------|
| AbortPolicy | 抛出 RejectedExecutionException |
| CallerRunsPolicy | 调用者线程执行任务 |
| DiscardPolicy | 丢弃任务，不抛异常 |
| DiscardOldestPolicy | 丢弃队列最老的任务 |

### 问题 12：线程池工作流程？

```
任务到达
    ↓
核心线程数未满？ ─── 是 ──→ 创建核心线程执行
    ↓ 否
队列未满？ ─── 是 ──→ 加入队列等待
    ↓ 否
最大线程数未满？ ─── 是 ──→ 创建临时线程执行
    ↓ 否
执行拒绝策略
```

---

## 六、死锁相关

### 问题 13：死锁的四个必要条件？

1. **互斥条件**：资源一次只能被一个线程占用
2. **占有并等待**：持有资源的同时等待其他资源
3. **不可抢占**：资源不能被强制释放
4. **循环等待**：形成循环等待链

### 问题 14：怎么排查死锁？

```bash
# 1. jstack 定位
jstack <pid>

# 2. 查找死锁关键字
Found one Java-level deadlock

# 3. 分析等待关系
waiting for monitor entry / locked
```

### 问题 15：怎么避免死锁？

| 方案 | 破坏的条件 |
|-----|-----------|
| 资源有序编号 | 循环等待 |
| 一次性获取所有资源 | 占有并等待 |
| 设置超时 | 不可抢占 |

---

## 七、并发安全

### 问题 16：线程安全要保证哪些特性？

1. **原子性**：操作不可分割
2. **可见性**：修改对其他线程可见
3. **有序性**：执行顺序与代码顺序一致

| 保证方式 | 原子性 | 可见性 | 有序性 |
|---------|--------|--------|--------|
| synchronized | ✅ | ✅ | ✅ |
| volatile | ❌ | ✅ | ✅ |
| Lock | ✅ | ✅ | ✅ |

### 问题 17：synchronized 和 volatile 的区别？

| 特性 | synchronized | volatile |
|-----|-------------|----------|
| 原子性 | ✅ | ❌ |
| 可见性 | ✅ | ✅ |
| 有序性 | ✅ | ✅ |
| 性能 | 较重 | 轻量 |
| 场景 | 复合操作 | 状态标志 |

---

## 八、AQS 相关

### 问题 18：AQS 的核心思想？

**答案**：state + FIFO 队列

- `state`：表示同步状态
- `FIFO 队列`：存储等待获取资源的线程

### 问题 19：独占模式和共享模式的区别？

| 模式 | 同一时刻持有者 | 代表工具 |
|-----|--------------|---------|
| 独占模式 | 1 个线程 | ReentrantLock |
| 共享模式 | 多个线程 | Semaphore、CountDownLatch |

---

## 九、常见陷阱

### 问题 20：以下代码有什么问题？

```java
public class Trap {
    private static boolean flag = false;
    
    public static void main(String[] args) {
        // 线程 A
        new Thread(() -> {
            while (!flag) { }  // 可能死循环！
            System.out.println("线程 A 退出");
        }).start();
        
        // 线程 B
        new Thread(() -> {
            flag = true;
        }).start();
    }
}
```

**答案**：`flag` 不是 volatile，线程 A 可能永远看不到线程 B 的修改（CPU 缓存问题）。

---

## 十、综合应用

### 问题 21：实现一个线程安全的计数器？

```java
// 方案 1：synchronized
class Counter1 {
    private int count = 0;
    public synchronized void increment() { count++; }
}

// 方案 2：AtomicLong
class Counter2 {
    private AtomicLong count = new AtomicLong(0);
    public void increment() { count.incrementAndGet(); }
}

// 方案 3：LongAdder
class Counter3 {
    private LongAdder count = new LongAdder();
    public void increment() { count.increment(); }
}

// 怎么选？
// - 低并发：随便选
// - 高并发 + 精确值：AtomicLong
// - 高并发 + 统计：LongAdder
```

### 问题 22：实现一个并发安全的单例模式？

```java
// 推荐：双重检查 + volatile
class Singleton {
    private static volatile Singleton instance;
    
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}

// 更简洁：静态内部类
class Singleton2 {
    private Singleton2() {}
    
    private static class Holder {
        static final Singleton2 INSTANCE = new Singleton2();
    }
    
    public static Singleton2 getInstance() {
        return Holder.INSTANCE;
    }
}
```

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                 Java 并发高频考点                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  基础概念：                                                  │
│  ├─ JMM 模型（主内存 vs 工作内存）                          │
│  ├─ happens-before 规则                                     │
│  └─ 三大特性（原子性、可见性、有序性）                       │
│                                                             │
│  同步工具：                                                  │
│  ├─ synchronized（可重入锁、锁升级）                        │
│  ├─ volatile（可见性、有序性）                              │
│  ├─ Lock（ReentrantLock、Condition）                        │
│  └─ AQS（state + FIFO 队列）                               │
│                                                             │
│  并发工具：                                                  │
│  ├─ Atomic*（CAS）                                          │
│  ├─ LongAdder（高并发计数器）                                │
│  ├─ ThreadLocal（线程本地变量）                              │
│  └─ 线程池（ThreadPoolExecutor）                            │
│                                                             │
│  并发问题：                                                  │
│  ├─ 死锁（条件 + 排查 + 避免）                              │
│  ├─ 活锁 vs 饥饿                                           │
│  └─ 内存泄漏（ThreadLocal）                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

设计一个高并发场景下的「限时抢购」功能：

```java
// 要求：
// 1. 库存有限，不能超卖
// 2. 每个用户只能抢购一次
// 3. 支持分布式部署
// 4. 性能要足够高

// 你会怎么设计？
```

（提示：考虑用 Redis 做库存扣减，用 Set 做用户去重，考虑乐观锁 CAS vs 悲观锁）
