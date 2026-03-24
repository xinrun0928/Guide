# 高并发场景下的对象创建优化：对象复用与对象头压缩

你有没有想过：一个 `new Object()` 在 JVM 眼里到底花了多少钱？

在低并发场景下，对象创建的开销可以忽略不计。但到了高并发场景，每秒创建和销毁成千上万个对象，GC 的压力就会急剧上升。

今天，我们来聊聊对象创建的优化策略：**对象复用**和**对象头压缩**。

## 对象的创建成本

在 JVM 中，创建一个对象不仅仅是分配内存这么简单：

```java
// 这行代码背后发生了什么？
Object obj = new Object();
```

1. **检查类加载**：第一次遇到这个类时，需要加载、验证、准备、解析
2. **分配内存**：在堆上找到一块连续空间
3. **零值初始化**：将对象头以外的内存初始化为零值
4. **设置对象头**：Mark Word、类元数据指针
5. **执行构造函数**：调用 `<init>` 方法

其中，最耗时的是**垃圾回收**。大量对象创建意味着大量对象死亡，而死亡对象的清理需要 GC 完成。

## 策略一：对象复用

### 1. 享元模式（Flyweight Pattern）

最经典的对象复用模式。相同的对象只创建一份，需要时共享使用。

```java
// 模拟 BigDecimal 的享元优化
public class FlyweightDemo {
    // 小整数缓存 [-128, 127]
    private static final BigInteger[] CACHE = new BigInteger[256];

    static {
        for (int i = -128; i <= 127; i++) {
            CACHE[i + 128] = BigInteger.valueOf(i);
        }
    }

    public static BigInteger valueOf(int value) {
        if (value >= -128 &amp;&amp; value <= 127) {
            return CACHE[value + 128];  // 直接返回缓存
        }
        return new BigInteger(value);
    }
}
```

JDK 中大量使用了享元模式：
- `Integer.valueOf(int)`：缓存 -128 到 127
- `Long.valueOf(long)`：缓存 -128 到 127
- `String.intern()`：字符串常量池
- `Integer.bitCount` 等：静态方法复用工具类

### 2. 对象池（Object Pool）

对于创建成本极高的对象（如数据库连接、线程、Socket），使用对象池复用：

```java
// 简单的对象池实现
public class ObjectPool&lt;T&gt; {
    private final Queue&lt;T&gt; pool;
    private final ObjectFactory&lt;T&gt; factory;
    private final int maxSize;

    public ObjectPool(ObjectFactory&lt;T&gt; factory, int maxSize) {
        this.factory = factory;
        this.maxSize = maxSize;
        this.pool = new ConcurrentLinkedQueue&lt;&gt;();
    }

    public T borrow() {
        // 先尝试从池中获取
        T obj = pool.poll();
        if (obj == null) {
            obj = factory.create();  // 池空，创建新的
        }
        return obj;
    }

    public void release(T obj) {
        // 用完归还池中
        if (pool.size() &lt; maxSize) {
            pool.offer(obj);
        }
    }

    @FunctionalInterface
    public interface ObjectFactory&lt;T&gt; {
        T create();
    }
}

// 使用示例
ObjectPool&lt;Connection&gt; connectionPool = new ObjectPool&lt;&gt;(
    () -&gt; DriverManager.getConnection(url, user, password),
    100  // 最大连接数
);

Connection conn = connectionPool.borrow();
try {
    conn.execute("SELECT * FROM users");
} finally {
    connectionPool.release(conn);
}
```

### 3. ThreadLocal 对象复用

`ThreadLocal` 本质上也是一种对象复用的手段——每个线程持有一份独立的对象实例。

```java
// 利用 ThreadLocal 复用大对象
public class ThreadLocal复用 {
    private static final ThreadLocal&lt;SimpleDateFormat&gt; dateFormat =
        ThreadLocal.withInitial(() -&gt; new SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));

    public String formatDate(Date date) {
        // 每个线程复用同一个 SimpleDateFormat
        return dateFormat.get().format(date);
    }
}
```

## 策略二：对象头压缩

### 对象头的结构

在 64 位 JVM 中，一个普通对象的内存布局如下：

```
┌──────────────────────────────────────┐
│           对象头 (Object Header)      │
├──────────────┬───────────────────────┤
│  Mark Word   │    类元数据指针         │
│   8 字节      │   (压缩后 4 字节)       │
└──────────────┴───────────────────────┘
                    │
              ┌─────┴─────┐
              │  实例数据   │
              │  (字段)     │
              └───────────┘
                    │
              ┬─────┴─────┐
              │  对齐填充   │
              │  (到 8 的倍数) │
              └───────────┘
```

**Mark Word**（8 字节）包含：
- 对象的哈希码（25 位）
- GC 分代年龄（4 位）
- 偏向锁标志（1 位）
- 锁标志位（2 位）
- ...

**类元数据指针**（4 字节，开启指针压缩时）：指向方法区中的类元数据。

### 指针压缩（CompressedOops）

JDK 6+ 默认开启指针压缩（`-XX:+UseCompressedOops`），将对象引用从 8 字节压缩到 4 字节。

```bash
# 查看是否开启指针压缩
java -XX:+PrintCommandLineFlags -version

# 典型输出
-XX:+UseCompressedOops (compressed oops)
-XX:+UseCompressedClassPointers
```

指针压缩的原理：JVM 假设堆内存不超过 32GB（因为 4 字节可以寻址 2^34 = 16GB，所以需要一些技巧）。在 32GB 以内，可以用 4 字节表示原本需要 8 字节的指针。

### 对象头压缩的实战

对于大量存在的小对象，可以通过调整数据结构来减少对象头开销：

```java
// 优化前：每个 Value 对象都有对象头
Map&lt;String, Value&gt; map = new HashMap&lt;&gt;();

// 优化后：用数组 + 压缩数据结构
public class CompressedValueArray {
    private final long[] keys;
    private final long[] values;
    private final int size;

    public CompressedValueArray(int capacity) {
        this.keys = new long[capacity];
        this.values = new long[capacity];
        this.size = 0;
    }

    public void put(long key, long value) {
        // 线性探测
        int index = (int) (key % keys.length);
        while (keys[index] != 0 &amp;&amp; keys[index] != key) {
            index = (index + 1) % keys.length;
        }
        keys[index] = key;
        values[index] = value;
        size++;
    }

    public long get(long key) {
        int index = (int) (key % keys.length);
        while (keys[index] != 0) {
            if (keys[index] == key) {
                return values[index];
            }
            index = (index + 1) % keys.length;
        }
        return -1;
    }
}
```

### 包装类型 vs 基本类型

在大量数据的场景下，包装类型 vs 基本类型的选择影响巨大：

```java
// 优化前：使用包装类型
List&lt;Integer&gt; list = new ArrayList&lt;&gt;();
for (int i = 0; i &lt; 1000000; i++) {
    list.add(i);  // 1M 个 Integer 对象！
}

// 优化后：使用基本类型数组
int[] array = new int[1000000];
for (int i = 0; i &lt; 1000000; i++) {
    array[i] = i;  // 无额外对象开销
}
```

内存对比（1M 个元素）：
- `List&lt;Integer&gt;`：约 20MB（1M 个 Integer 对象，每个约 16 字节 + List 数组 8MB）
- `int[]`：约 4MB（1M × 4 字节）

## 策略三：减少对象创建

### String 优化

```java
// 优化前：频繁拼接创建大量中间 String 对象
String result = "";
for (int i = 0; i &lt; 1000; i++) {
    result += "item" + i + ",";  // 每次拼接都创建新 String
}

// 优化后：使用 StringBuilder
StringBuilder sb = new StringBuilder(10000);
for (int i = 0; i &lt; 1000; i++) {
    sb.append("item").append(i).append(",");
}
String result = sb.toString();

// JDK 9+ 的 String concat 优化
// 编译器自动使用 StringConcatFactory，减少中间对象
```

### 避免自动装箱

```java
// 优化前：自动装箱产生大量 Integer 对象
Map&lt;String, Integer&gt; map = new HashMap&lt;&gt;();
for (int i = 0; i &lt; 100000; i++) {
    map.put("key" + i, i);  // i 是 int，但 map.put 需要 Integer
}

// 优化后：使用基本类型集合（如 trove4j 或 HPPC）
TIntIntMap map = new TIntIntHashMap();
for (int i = 0; i &lt; 100000; i++) {
    map.put(i, i);
}
```

## 综合实战：高并发计数器优化

```java
// 原始版本：每次 increment 都创建新对象
public class SlowCounter {
    private Long count = 0L;  // 包装类型

    public synchronized void increment() {
        count = count + 1;  // 自动装箱 + 解包
    }
}

// 优化版本 1：使用基本类型 + volatile
public class FastCounter {
    private volatile long count = 0;  // 基本类型

    public void increment() {
        count++;  // 单条 CPU 指令
    }

    public long get() {
        return count;
    }
}

// 优化版本 2：使用 LongAdder
public class LongAdderCounter {
    private final LongAdder counter = new LongAdder();

    public void increment() {
        counter.increment();
    }

    public long get() {
        return counter.sum();
    }
}
```

性能对比（JMH，16 线程）：

| 版本 | 吞吐量 (ops/ms) | 说明 |
|------|----------------|------|
| SlowCounter | ~100 | 锁 + 装箱 |
| FastCounter | ~5000 | 无锁，但 CAS 竞争 |
| LongAdderCounter | ~30000 | 分段，无竞争 |

## 总结

对象优化三板斧：

| 策略 | 方法 | 适用场景 |
|------|------|---------|
| 对象复用 | 享元模式、对象池、ThreadLocal | 创建成本高的对象 |
| 对象头压缩 | 指针压缩、基本类型数组 | 大量小对象 |
| 减少创建 | 避免装箱、StringBuilder | 频繁创建中间对象 |

但要注意：**过度优化是万恶之源**。只有在 profiling 确定瓶颈后，才值得做这些优化。大多数场景下，写出清晰易懂的代码比极致性能更重要。

---

## 留给你的问题

JDK 17 引入了 **Records**（记录类）和 **Value Objects**（值对象）的概念。它们的对象头和普通类有什么不同？能否利用这个特性进一步减少对象开销？

提示：Records 在 JVM 层面被实现为一个「透明载体」，不存储与生俱来的冗余信息。
