# volatile 能保证原子性吗？

看看下面这个计数器：

```java
public class Counter {
    private volatile int count = 0;
    
    public void increment() {
        count++;
    }
    
    public int getCount() {
        return count;
    }
}
```

启动了 10 个线程，每个线程执行 1000 次 `increment()`。

**最终 `getCount()` 的值一定是 10000 吗？**

答案是：**不一定**。

---

## 什么是原子性？

**原子性**：一个操作要么全部执行，要么全部不执行，中间不会有任何其他操作穿插。

```
原子操作：              非原子操作：
┌──────────┐           ┌──────────┬──────────┬──────────┐
│  全或无   │           │  读取    │   修改    │   写入    │
│          │           │  count   │  count+1  │  count   │
└──────────┘           └──────────┴──────────┴──────────┘
                        ↑                                   ↑
                    可能被打断                              ↑
                                                      可能被打断
```

---

## count++ 不是原子操作

`count++` 表面是一行代码，实际上分解成三个 CPU 指令：

```java
count++;  // 这一行 = 三步操作

// JVM 层面分解：
1. getstatic count    // 从主内存读取 count 到操作栈
2. iconst_1          // 常量 1 入栈
3. iadd              // 栈顶两个值相加
4. putstatic count   // 把结果写回主内存
```

---

## volatile 为什么不保证原子性？

**volatile 只保证可见性和有序性，不保证原子性！**

```
线程 A                         线程 B
─────────────────────────────────────────
getstatic count (=0)
iconst_1
iadd (=1)
               getstatic count (=0)  ← A 还没写回，B 就读了！
               iconst_1
               iadd (=1)
putstatic count (=1)           ← A 写回 1
               putstatic count (=1)  ← B 也写回 1

结果：两次 increment，但 count 只增加了 1！
```

**volatile 读/写屏障只能保证**：
- 写屏障：线程 A 写完后，其他线程**能看到**新值
- 读屏障：线程 B 读取时，**会从主内存读**

但这**不能保证 `count++` 这个复合操作的原子性**。

---

## 形象理解

想象你去超市买东西：

```
volatile 保证的是：
  - 你买的商品结账后，货架上的库存会更新（可见性）
  - 收银员不会把你的账单和别人混在一起（有序性）

volatile 不能保证的是：
  - 你买可乐 + 薯片，总价计算不会出错（原子性）
  - 如果你付钱时被打断，另一个人可能在你之前拿走打折商品
```

---

## 解决方案：锁或原子类

### 方案一：synchronized

```java
public class SafeCounter1 {
    private int count = 0;
    
    public synchronized void increment() {
        count++;
    }
    
    public synchronized int getCount() {
        return count;
    }
}
```

`synchronized` 保证原子性（同一时刻只有一个线程能执行 `count++`），同时保证可见性和有序性。

### 方案二：AtomicInteger

```java
import java.util.concurrent.atomic.AtomicInteger;

public class SafeCounter2 {
    private AtomicInteger count = new AtomicInteger(0);
    
    public void increment() {
        count.incrementAndGet();  // 原子递增
    }
    
    public int getCount() {
        return count.get();
    }
}
```

`AtomicInteger` 用 CAS 实现原子操作，性能比 synchronized 更好。

---

## 对比总结

| 特性 | volatile | synchronized | AtomicInteger |
|-----|----------|--------------|---------------|
| 可见性 | ✅ | ✅ | ✅ |
| 有序性 | ✅ | ✅ | ✅ |
| 原子性 | ❌ | ✅ | ✅ |

---

## 常见误区

### 误区一：volatile 能替代锁

```java
// 错误：volatile 不能保证 count++ 的原子性
volatile int count = 0;
count++;

// 正确：synchronized 能保证
synchronized(this) {
    count++;
}

// 正确：原子类能保证
atomicCount.incrementAndGet();
```

### 误区二：long/double 的 volatile 读写是原子操作

这是一个经典面试题：

```java
volatile long value = 0;

// 线程 A
value = 0x12345678L;

// 线程 B
System.out.println(value);  // 可能读到 0x12345600 或其他乱值！
```

**在 32 位 JVM 中**，对 `volatile long/double` 的读写不是原子操作（因为 64 位需要两次内存访问）。

但在**现代 64 位 JVM 中**，这已经不是问题了。

### 误区三：boolean flag 的读写不需要 volatile

```java
// 可能的问题：线程 A 修改了 flag，线程 B 看不到
boolean running = true;
while (running) {
    // 线程 B 可能永远看不到 running=false
}

// 加上 volatile 就安全了
volatile boolean running = true;
```

---

## 什么情况下 volatile 是够用的？

volatile 适用于**只会被一个线程修改，其他线程只读取**的场景：

```java
// 场景 1：状态标志
volatile boolean shutdown = false;

// 场景 2：一次性写入的配置
volatile String config = null;

// 场景 3：单 writer 多 reader 的场景
volatile long lastUpdateTime = 0;

public void update() {
    lastUpdateTime = System.currentTimeMillis();  // 单线程写
}

public boolean isStale() {
    return System.currentTimeMillis() - lastUpdateTime > 1000;  // 多线程读
}
```

---

## 面试实战

**面试官问**：「volatile 能保证原子性吗？」

**参考回答**：
> volatile **不能**保证原子性。
>
> 以 `count++` 为例，它分解成三个 CPU 指令：读取、修改、写入。volatile 只能保证写入主内存后其他线程能看见，但无法保证读取-修改-写入这个过程不被其他线程插入。
>
> 解决方案有两种：
>
> 1. **synchronized**：给操作加锁，同一时刻只有一个线程能执行
> 2. **原子类**（AtomicInteger 等）：用 CAS 实现原子操作，性能更好
>
> volatile 只适合「一个线程写、多个线程读」的场景，不适合复合操作。

---

## 总结

```
┌────────────────────────────────────────────────────────────────┐
│                     volatile 能力边界                          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ✅ 可见性：写之后，其他线程一定能看到                             │
│  ✅ 有序性：禁止指令重排序                                       │
│  ❌ 原子性：复合操作（如 i++）无法保证                             │
│                                                                │
│  适用场景：状态标志、配置、单写多读                               │
│  不适用场景：计数器、累加器、需要原子性的复合操作                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

下面代码有什么问题？如何修复？

```java
public class StopFlagDemo {
    private volatile boolean stopped = false;
    
    public void start() {
        new Thread(() -> {
            while (!stopped) {
                // 业务逻辑
                doSomething();
            }
        }).start();
    }
    
    public void stop() {
        stopped = true;
    }
    
    private void doSomething() {
        // 如果 doSomething() 执行时间很长，
        // 加了 volatile 就能保证可见性吗？
        // 还有其他问题吗？
    }
}
```

（提示：考虑 CPU 缓存、编译器优化、以及多核架构下的可见性问题）
