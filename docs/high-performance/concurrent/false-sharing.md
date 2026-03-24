# 伪共享（False Sharing）与 @Contended 注解

你可能遇到过这种情况：代码明明加了锁，线程数也够多，但并发性能就是上不去。

Profiler 显示 CPU 使用率不高，锁竞争也不严重，但总感觉有什么东西在「拖后腿」。

这很可能就是 **伪共享（False Sharing）** 在作祟。

## 什么是伪共享？

要理解伪共享，先要理解 CPU 缓存的组织方式。

CPU 的缓存是以「缓存行（Cache Line）」为单位进行读写的。现代 CPU 的缓存行大小通常是 **64 字节**。

```
内存 → L3 Cache → L2 Cache → L1 Cache
         ↓
    [Cache Line 64B]
    [Cache Line 64B]
    [Cache Line 64B]
    ...
```

当 CPU 读取一个变量时，它会把该变量所在的整个缓存行（64 字节）都加载到 L1 Cache。

**问题来了**：如果两个线程分别修改**同一个缓存行**中的两个**不同变量**，会发生什么？

```java
public class FalseSharingDemo {
    public static void main(String[] args) throws InterruptedException {
        // 两个线程分别修改不同的变量
        Thread t1 = new Thread(() -&gt; {
            for (int i = 0; i &lt; 100_000_000; i++) {
                counter1.value = i;  // 修改 counter1
            }
        });

        Thread t2 = new Thread(() -&gt; {
            for (int i = 0; i &lt; 100_000_000; i++) {
                counter2.value = i;  // 修改 counter2
            }
        });

        long start = System.nanoTime();
        t1.start();
        t2.start();
        t1.join();
        t2.join();
        long end = System.nanoTime();

        System.out.println("耗时: " + (end - start) / 1_000_000 + " ms");
    }

    // counter1 和 counter2 在内存中可能位于同一个缓存行
    static class Counter {
        volatile long value = 0;
    }

    static Counter counter1 = new Counter();
    static Counter counter2 = new Counter();
}
```

在这个例子中，`counter1.value` 和 `counter2.value` 可能是相邻的变量，位于同一个 64 字节缓存行。

线程 1 修改 `counter1.value`：
1. CPU 把整个缓存行加载到 L1 Cache
2. 修改 `value`
3. **缓存行被标记为「脏」**

线程 2 修改 `counter2.value`：
1. 发现 `counter2.value` 所在的缓存行在其他 CPU 核心的 L1/L2 Cache 中被修改了
2. 必须等待缓存行同步完成
3. **被迫等待数百个 CPU 周期**

这就是伪共享——两个线程实际上访问的是不同的变量，但因为它们在同一个缓存行，产生了不必要的缓存同步开销。

## 伪共享 vs 真共享

| 类型 | 说明 | 例子 |
|------|------|------|
| 真共享 | 多个线程访问同一个变量，确实需要同步 | 两个线程同时修改 `counter.value` |
| 伪共享 | 多个线程访问不同变量，但因为在同一缓存行而产生冲突 | 两个线程分别修改 `counter1.value` 和 `counter2.value` |

真共享是不可避免的，但伪共享是可以消除的。

## 如何解决伪共享？

### 方法一：缓存行填充（Cache Line Padding）

最简单的方法是用无用的字段把变量「撑开」，让它们分散到不同的缓存行：

```java
public class CacheLinePadding {
    // 使用 8 个 long（64 字节）来填充一个缓存行
    private volatile long p1, p2, p3, p4, p5, p6, p7;
    private volatile long value = 0;
    // 后面的填充保证不与下一个变量共享缓存行
    private volatile long q1, q2, q3, q4, q5, q6, q7;
}
```

这样 `value` 独占一个缓存行，其他线程修改 `q1-q7` 不会影响这个缓存行。

### 方法二：JDK 8 的 @Contended 注解

JDK 8 引入了 `@sun.misc.Contended` 注解，让 JVM 自动处理缓存行填充：

```java
@sun.misc.Contended
public class ContendedCounter {
    private volatile long value = 0;
}
```

`@Contended` 会自动在 `value` 前后各填充 128 字节（注意：HotSpot JVM 默认填充 128 字节，但可以通过 `-XX:ContendedPaddingWidth` 配置）。

为什么是 128 字节？因为缓存行是 64 字节，填充 128 字节可以保证在两个方向上都不会产生伪共享。

### 方法三：数组 + 原子操作的经典模式

在高并发计数器场景，可以使用数组来分散热点：

```java
public class StripedCounter {
    // 分段计数器，避免伪共享
    private static final int STRIPE = 8;
    private final AtomicLong[] counters = new AtomicLong[STRIPE];

    public StripedCounter() {
        for (int i = 0; i &lt; STRIPE; i++) {
            counters[i] = new AtomicLong();
        }
    }

    public void increment() {
        int index = (int) (Thread.currentThread().getId() % STRIPE);
        counters[index].incrementAndGet();
    }

    public long sum() {
        return Arrays.stream(counters).mapToLong(AtomicLong::get).sum();
    }
}
```

每个 `AtomicLong` 在数组中分散存储，天然分布在不同的缓存行。

## LongAdder 的 @Contended 应用

`LongAdder` 高性能的秘密之一，就是内部使用了 `@Contended` 注解来避免伪共享：

```java
// JDK 8+ LongAdder 源码
@sun.misc.Contended
static final class Cell {
    volatile long value;

    Cell(long x) {
        value = x;
    }

    final boolean cas(long cmp, long val) {
        return UNSAFE.compareAndSwapLong(this, valueOffset, cmp, val);
    }
}
```

每个 `Cell` 实例独占一个缓存行，多个线程累加不同的 `Cell` 时不会产生伪共享。

## 实战：测试伪共享的影响

可以用 JMH 来验证伪共享的影响：

```java
@State(Scope.Group)
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
public class FalseSharingBenchmark {

    // 方案 1：未填充（可能有伪共享）
    static class SimpleLong {
        volatile long value = 0;
    }

    // 方案 2：手动填充
    static class PaddedLong {
        long p1, p2, p3, p4, p5, p6, p7;  // 填充
        volatile long value = 0;
        long q1, q2, q3, q4, q5, q6, q7;  // 填充
    }

    SimpleLong simple = new SimpleLong();
    PaddedLong padded = new PaddedLong();

    @Benchmark
    @Group("simple")
    public void simpleIncrement() {
        simple.value++;
    }

    @Benchmark
    @Benchmark
    @Group("padded")
    public void paddedIncrement() {
        padded.value++;
    }
}
```

典型测试结果（16 线程）：
- 未填充版本：约 500 万 ops/秒
- 填充版本：约 3000 万 ops/秒

性能差距可达 **6 倍**。

## 注意事项

### @Contended 的局限性

1. **只对同一类中的字段生效**：跨对象引用不保证缓存行隔离
2. **JDK 9+ 需要额外开启**：默认只对 JDK 内部类生效，用户类需要加 `--add-opens` 参数
3. **额外的内存开销**：每个 `@Contended` 字段会多占用约 256 字节

### 什么时候需要考虑伪共享？

| 场景 | 是否需要考虑 |
|------|-------------|
| 高并发计数器 | 是，LongAdder 已经帮你做了 |
| 低并发业务代码 | 否，伪共享的影响可以忽略 |
| 高性能队列 | 是，Disruptor 等框架专门处理了这个问题 |
| 数据库连接池 | 否，业务逻辑性能瓶颈不在这里 |

## 总结

伪共享是 CPU 缓存架构带来的性能陷阱：

| 解决方案 | 优点 | 缺点 |
|---------|------|------|
| 手动填充 | 兼容性好，JDK 8 以前可用 | 代码丑，维护成本高 |
| @Contended | JVM 自动处理，语义清晰 | JDK 8 用户类需特殊配置 |
| 分段数组 | 天然避免，简单有效 | sum() 需要额外聚合 |

现代 Java 高性能库（ConcurrentHashMap、LongAdder、Disruptor）都在内部处理了伪共享问题。如果你在写高性能代码，需要考虑这个因素；但对于普通业务代码，不必过度优化。

---

## 留给你的问题

`LongAdder` 的 `Cell` 用 `@Contended` 注解来避免伪共享，但 `base` 字段没有用 `@Contended`。为什么？

提示：考虑 `base` 的访问模式和 `Cell` 的访问模式有什么区别。
