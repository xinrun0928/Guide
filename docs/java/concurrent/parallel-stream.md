# 并行流 ParallelStream 原理

Java 8 引入了 Stream API，配合 `parallelStream()` 可以轻松实现并行计算。

但你知道它是怎么工作的吗？

---

## 快速上手

```java
import java.util.stream.*;

public class ParallelStreamDemo {
    public static void main(String[] args) {
        List<Integer> numbers = IntStream.rangeClosed(1, 1000000)
            .boxed()
            .collect(Collectors.toList());
        
        // 串行流
        long start = System.currentTimeMillis();
        long sum1 = numbers.stream()
            .mapToLong(Integer::longValue)
            .sum();
        long time1 = System.currentTimeMillis() - start;
        
        // 并行流
        long start2 = System.currentTimeMillis();
        long sum2 = numbers.parallelStream()
            .mapToLong(Integer::longValue)
            .sum();
        long time2 = System.currentTimeMillis() - start2;
        
        System.out.println("串行: " + time1 + "ms, sum=" + sum1);
        System.out.println("并行: " + time2 + "ms, sum=" + sum2);
    }
}
```

**结果**：并行流通常比串行流快几倍（取决于 CPU 核心数）。

---

## ParallelStream 的原理

### 底层：Fork/Join 框架

`parallelStream()` 底层使用 **Fork/Join 框架**，它是一种分治算法的并行实现。

```
┌─────────────────────────────────────────────────────────────┐
│                   Fork/Join 工作原理                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  任务：计算 1+2+3+...+1000                                 │
│                                                             │
│  ┌─────────────────┐                                       │
│  │   Fork          │  分解任务                             │
│  │  [1..1000]      │                                       │
│  └────────┬────────┘                                       │
│           │                                                │
│     ┌─────┴─────┐                                          │
│     ↓           ↓                                          │
│  ┌───────┐   ┌───────┐                                     │
│  │Fork   │   │Fork   │  继续分解                           │
│  │[1..500]│   │[501..1000]│                                │
│  └───┬───┘   └───┬───┘                                    │
│      ↓           ↓                                          │
│  ┌───────┐   ┌───────┐                                     │
│  │[1..250]│   │[251..500]│  ...                            │
│  └───────┘   └───────┘                                     │
│                                                             │
│           ...继续分解直到粒度足够小...                        │
│                                                             │
│  ┌─────────────────────────────────────────────────┐      │
│  │              Join 合并结果                         │      │
│  │  500500 ← 250250 + 250250 ← ... ← 1 + 2 + 3...  │      │
│  └─────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 源码分析

```java
// parallelStream() 实际上是
public interface Collection<E> {
    default Stream<E> parallelStream() {
        return StreamSupport.stream(spliterator(), true);
        //                                                         ↑
        //                                                  parallel = true
    }
}

// Spliterator 是「可分迭代器」
// 它负责将数据源分成多个小任务
public interface Spliterator<T> {
    // 尝试遍历一部分元素
    boolean tryAdvance(Consumer<? super T> action);
    
    // 将剩余元素分成两部分
    Spliterator<T> trySplit();
    
    // 估计剩余元素数量
    long estimateSize();
}
```

---

## 默认并行度

`parallelStream()` 默认使用 **ForkJoinPool.commonPool()**：

```java
// 获取默认并行度（通常等于 CPU 核心数）
System.out.println(ForkJoinPool.commonPool().getParallelism());  // 4（4 核 CPU）
```

### 自定义并行度

```java
// 方法 1：系统属性
// java -Djava.util.concurrent.ForkJoinPool.common.parallelism=8

// 方法 2：使用指定线程池
ForkJoinPool pool = new ForkJoinPool(8);
pool.submit(() -> 
    list.parallelStream().forEach(System.out::println)
);
pool.shutdown();
```

---

## Spliterator 分片策略

### ArrayList 的分片

```java
// Arrays.spliterator() 的分片逻辑
public Spliterator<T> spliterator() {
    return new ArraySpliterator<>(this, 0, size, expectedModCount);
}

// trySplit() 按中间位置切分
public Spliterator<T> trySplit() {
    int hi = getFence(), lo = index, mid = (lo + hi) >>> 1;
    return (lo >= mid) ? null :
        new ArraySpliterator<>(obs, lo, index = mid, expectedModCount);
}
```

```
分片示例：[1, 2, 3, 4, 5, 6, 7, 8]
              ↓ trySplit()
         [1, 2, 3, 4]    [5, 6, 7, 8]
              ↓ trySplit()         ↓ trySplit()
         [1, 2]  [3, 4]      [5, 6]  [7, 8]
              ↓                   ↓
         继续细分直到粒度合适
```

### LinkedList 的分片

```java
// LinkedList.spliterator() 的分片效率低
// 因为需要遍历才能分割
public Spliterator<T> trySplit() {
    Node<T> first = head;
    int size = 0;
    // 遍历一半的元素
    // 每次 trySplit 都需要 O(n) 遍历！
}
```

---

## 性能陷阱

### 陷阱一：装箱成本

```java
// 错误：装箱/拆箱开销巨大
list.parallelStream()
    .map(Integer::parseInt)  // 每次都拆箱
    .sum();

// 正确：使用基本类型
list.parallelStream()
    .mapToInt(Integer::parseInt)  // 避免装箱
    .sum();
```

### 陷阱二：小数据量

```java
// 数据量太小，并行开销反而更大
List<Integer> smallList = Arrays.asList(1, 2, 3);
smallList.parallelStream().sum();  // 串行可能更快

// 数据量大才适合并行
List<Integer> bigList = IntStream.rangeClosed(1, 10_000_000).boxed().toList();
bigList.parallelStream().sum();  // 并行明显更快
```

### 陷阱三：数据源影响

| 数据源 | 特性 |
|-------|------|
| ArrayList | 随机访问，分片效率高 ✅ |
| LinkedList | 顺序访问，分片需要遍历 ❌ |
| IntStream.range | 专为并行设计 ✅ |
| HashSet | 分片效率一般 |
| Stream.of() | 小数据量友好 |

### 陷阱四：顺序依赖

```java
// 错误：并行会导致结果不确定
List<Integer> list = Arrays.asList(1, 2, 3, 4, 5);
list.parallelStream()
    .map(x -> x * 2)  // 2, 4, 6, 8, 10（顺序不确定）
    .collect(Collectors.toList());

// 正确：结果与顺序无关
list.parallelStream()
    .filter(x -> x > 2)  // 结果顺序不确定，但元素正确
    .collect(Collectors.toSet());  // Set 无序
```

### 陷阱五：线程安全问题

```java
// 错误：并发修改共享变量
List<Integer> result = new ArrayList<>();
list.parallelStream()
    .forEach(result::add);  // 线程不安全！

// 正确：使用线程安全容器
List<Integer> result = Collections.synchronizedList(new ArrayList<>());
// 或使用 collect()
List<Integer> result = list.parallelStream()
    .collect(Collectors.toList());
```

---

## 并行 vs 串行

### 什么时候用并行流？

| 场景 | 推荐 |
|-----|------|
| 大数据量 | ✅ 并行 |
| CPU 密集型 | ✅ 并行 |
| 无状态、无顺序依赖 | ✅ 并行 |
| 小数据量 | ❌ 串行 |
| I/O 密集型 | ❌ 串行（考虑异步） |
| 有顺序要求 | ❌ 串行 |
| 非 ArrayList 数据源 | ⚠️ 谨慎测试 |

### 性能对比

```java
public class PerformanceTest {
    public static void main(String[] args) {
        // 生成 1000 万个随机数
        Random random = new Random(42);
        List<Integer> list = random.ints(10_000_000)
            .boxed()
            .collect(Collectors.toList());
        
        // 测试不同场景
        test("求和-串行", () -> 
            list.stream().mapToLong(Integer::longValue).sum()
        );
        
        test("求和-并行", () -> 
            list.parallelStream().mapToLong(Integer::longValue).sum()
        );
        
        test("过滤-串行", () -> 
            list.stream().filter(x -> x > 1000).count()
        );
        
        test("过滤-并行", () -> 
            list.parallelStream().filter(x -> x > 1000).count()
        );
        
        test("排序-串行", () -> 
            list.stream().sorted().collect(Collectors.toList())
        );
        
        test("排序-并行", () -> 
            list.parallelStream().sorted().collect(Collectors.toList())
        );
    }
    
    static void test(String name, Runnable task) {
        // warmup
        for (int i = 0; i < 3; i++) task.run();
        
        long start = System.nanoTime();
        task.run();
        long time = (System.nanoTime() - start) / 1_000_000;
        System.out.println(name + ": " + time + "ms");
    }
}
```

---

## 常用并行流操作

### 并行 collect

```java
// 并行收集到 List
List<String> list = data.parallelStream()
    .map(Object::toString)
    .collect(Collectors.toList());

// 并行收集到 Set
Set<String> set = data.parallelStream()
    .map(Object::toString)
    .collect(Collectors.toSet());

// 并行收集到 Map
Map<String, Integer> map = data.parallelStream()
    .collect(Collectors.toMap(
        Object::toString,
        Object::hashCode
    ));

// 并行 groupingBy
Map<String, List<Item>> grouped = items.parallelStream()
    .collect(Collectors.groupingBy(Item::getCategory));
```

### 并行 reduce

```java
// 并行归约
int sum = IntStream.rangeClosed(1, 100)
    .parallel()
    .reduce(0, Integer::sum);  // 5050
```

### 并行 find

```java
// 并行查找（找到第一个，可能不是「第一个」）
Optional<Integer> first = list.parallelStream()
    .filter(x -> x > 100)
    .findFirst();  // 保证顺序

Optional<Integer> any = list.parallelStream()
    .filter(x -> x > 100)
    .findAny();  // 任意一个，可能更快
```

---

## 面试实战

**面试官问**：「parallelStream() 的原理是什么？」

**参考回答**：
> parallelStream() 底层使用 Fork/Join 框架。它会将任务分解成多个子任务，在不同线程中并行执行，最后合并结果。
>
> 具体流程：
> 1. 调用 `parallelStream()` 时，实际创建了一个 `ForkJoinPool`
> 2. Stream 操作使用 Spliterator 分片数据源
> 3. 每个子任务在 fork 时创建新线程执行
> 4. 子任务完成后 join 合并结果
>
> 默认使用 `ForkJoinPool.commonPool()`，并行度等于 CPU 核心数减 1。

**追问**：「什么场景下不适合用并行流？」

**参考回答**：
> 几种不适合的场景：
>
> **第一，小数据量**。并行有额外开销，数据量小时串行可能更快。
>
> **第二，非 ArrayList 数据源**。比如 LinkedList 分片效率很低。
>
> **第三，有顺序依赖的操作**。并行会导致结果顺序不确定。
>
> **第四，I/O 密集型**。瓶颈在 I/O，不在 CPU，并行没有意义。
>
> **第五，有线程安全问题**。并行流不能修改共享变量。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                 ParallelStream 要点                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  底层实现：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ForkJoinPool.commonPool()                          │   │
│  │  ForkJoinTask.invokeAll()                           │   │
│  │  Spliterator.trySplit() 分片                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  性能陷阱：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ⚠️ 装箱/拆箱开销                                    │   │
│  │  ⚠️ 小数据量（并行开销 > 计算收益）                   │   │
│  │  ⚠️ LinkedList 等低效分片                           │   │
│  │  ⚠️ 有顺序依赖                                       │   │
│  │  ⚠️ 线程安全问题                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  适用场景：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ✅ 大数据量                                         │   │
│  │  ✅ CPU 密集型                                       │   │
│  │  ✅ 无状态、无顺序依赖                                │   │
│  │  ✅ ArrayList / IntStream.range                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

分析以下代码的性能问题：

```java
public class PerformanceQuestion {
    public static void main(String[] args) {
        // 场景 1
        List<Integer> list = Arrays.asList(1, 2, 3);
        long sum1 = list.parallelStream()
            .mapToLong(Integer::longValue)
            .sum();
        
        // 场景 2
        List<Integer> linked = new LinkedList<>();
        for (int i = 0; i < 1_000_000; i++) linked.add(i);
        long sum2 = linked.parallelStream()
            .mapToLong(Integer::longValue)
            .sum();
        
        // 场景 3
        List<String> strings = IntStream.rangeClosed(1, 100_000)
            .boxed()
            .map(String::valueOf)
            .collect(Collectors.toList());
        String result = strings.parallelStream()
            .reduce("", (a, b) -> a + b);
    }
}
```

1. 场景 1 的并行流是否有意义？为什么？
2. 场景 2 有什么性能问题？
3. 场景 3 有什么线程安全问题？
4. 如果要优化，你会怎么做？
