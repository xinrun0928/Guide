# Fork/Join 框架与工作窃取算法

传统的线程池，所有线程共享一个任务队列。

问题是：**如果有些任务特别大，有些任务特别小，会怎样？**

```
线程A：任务1（很大，10秒）
线程B：任务2（小，1秒）→ 空闲等待
线程C：任务3（小，1秒）→ 空闲等待
```

线程B 和 C 只能干等着，资源浪费！

**Fork/Join** 就是来解决这个问题的——**工作窃取**。

---

## Fork/Join 的核心思想

### 传统线程池 vs Fork/Join

```
传统线程池：
          任务队列
             │
    ┌────────┼────────┐
    ▼        ▼        ▼
  线程A   线程B    线程C

Fork/Join：
    线程A的队列 ← 窃取 → 线程B的队列
         ↓
    任务1（大）
         │
    ┌────┴────┐
    ▼         ▼
  子任务1   子任务2
```

### 工作窃取算法

```
时间线：

T0: 线程A有任务，线程B、C空闲
T1: 线程B、C从A的队列尾部窃取子任务
T2: 线程A继续分解大任务
T3: B、C窃取更多任务
...
```

每个线程有自己的双端队列：
- **头部**：自己执行（从头部取）
- **尾部**：其他线程窃取（从尾部偷）

---

## 基本用法

### ForkJoinPool

```java
public class ForkJoinDemo {
    public static void main(String[] args) throws Exception {
        ForkJoinPool pool = new ForkJoinPool();

        // 创建任务
        CountTask task = new CountTask(1, 1000000);

        // 提交并获取结果
        Integer result = pool.invoke(task);

        System.out.println("计算结果: " + result);

        pool.shutdown();
    }
}

// 继承 RecursiveTask（有返回值）
class CountTask extends RecursiveTask&lt;Integer&gt; {
    private static final int THRESHOLD = 10000; // 阈值
    private int start, end;

    public CountTask(int start, int end) {
        this.start = start;
        this.end = end;
    }

    @Override
    protected Integer compute() {
        // 如果任务足够小，直接计算
        if (end - start &lt;= THRESHOLD) {
            long sum = 0;
            for (int i = start; i &lt;= end; i++) {
                sum += i;
            }
            return (int) sum;
        }

        // 否则分解为小任务
        int middle = (start + end) / 2;
        CountTask leftTask = new CountTask(start, middle);
        CountTask rightTask = new CountTask(middle + 1, end);

        // 分叉：异步执行子任务
        leftTask.fork();
        rightTask.fork();

        // 合并：等待子任务完成并获取结果
        int leftResult = leftTask.join();
        int rightResult = rightTask.join();

        return leftResult + rightResult;
    }
}
```

### RecursiveAction（无返回值）

```java
// 无返回值的任务
class PrintTask extends RecursiveAction {
    private static final int THRESHOLD = 100;
    private int start, end;

    public PrintTask(int start, int end) {
        this.start = start;
        this.end = end;
    }

    @Override
    protected void compute() {
        if (end - start &lt;= THRESHOLD) {
            for (int i = start; i &lt;= end; i++) {
                System.out.println(i);
            }
        } else {
            int middle = (start + end) / 2;
            PrintTask left = new PrintTask(start, middle);
            PrintTask right = new PrintTask(middle + 1, end);
            left.fork();
            right.fork();
            left.join();
            right.join();
        }
    }
}

// 使用
ForkJoinPool pool = new ForkJoinPool();
pool.invoke(new PrintTask(1, 1000));
```

---

## ForkJoinPool 的工作原理

### 双端队列

```java
// 线程本地的队列结构
public class WorkQueue {
    // 任务数组
    private final ForkJoinTask&lt;?&gt;[] array;
    // 头部索引
    private volatile int top;
    // 尾部索引
    private volatile int bottom;
    // 所属线程
    private final ForkJoinWorkerThread owner;

    // 本地线程：从头部取任务（LIFO）
    final ForkJoinTask&lt;?&gt; pop() {
        return array[--top];
    }

    // 窃取线程：从尾部取任务（FIFO）
    final ForkJoinTask&lt;?&gt; popcc() {
        int b = bottom;
        int i = --top;
        if (top &lt; b) {
            return array[i];
        }
        return null;
    }
}
```

### 窃取流程

```java
// 线程B窃取线程A的任务
public final ForkJoinTask&lt;?&gt; poll() {
    // 从队列尾部窃取（FIFO，减少竞争）
    return array[--bottom];
}

// 为什么从尾部窃取？
// 线程A从头部取（最新的），尾部是最老的（其他线程不太需要）
```

### 工作流程

```
线程A                          线程B
   │                               │
   ▼                               ▼
处理任务A1                     空闲，开始窃取
   │                               │
   ├─ fork() → A1.1 入队           │
   ├─ fork() → A1.2 入队           │
   │                               │
   ▼                               ▼
执行A1.1                     窃取 A1.2（尾部）
   │                               │
   ├─ fork() → A1.2.1 入队         │
   ├─ fork() → A1.2.2 入队         │
   │                               │
   ▼                               ▼
执行A1.2.1                    执行 A1.2.2
   │                               │
   ▼                               ▼
join() 等待完成                  join() 等待完成
   │                               │
   └───────────────┬───────────────┘
                   ▼
              合并结果
```

---

## 实战：并行归并排序

```java
public class MergeSortTask extends RecursiveTask&lt;int[]&gt; {
    private static final int THRESHOLD = 4096;
    private final int[] array;

    public MergeSortTask(int[] array) {
        this.array = array;
    }

    @Override
    protected int[] compute() {
        if (array.length &lt;= THRESHOLD) {
            // 小数组直接排序
            Arrays.sort(array);
            return array;
        }

        // 分解
        int middle = array.length / 2;
        int[] left = Arrays.copyOfRange(array, 0, middle);
        int[] right = Arrays.copyOfRange(array, middle, array.length);

        // 分叉执行
        MergeSortTask leftTask = new MergeSortTask(left);
        MergeSortTask rightTask = new MergeSortTask(right);
        leftTask.fork();
        rightTask.fork();

        // 合并结果
        int[] leftResult = leftTask.join();
        int[] rightResult = rightTask.join();

        return merge(leftResult, rightResult);
    }

    private int[] merge(int[] left, int[] right) {
        int[] result = new int[left.length + right.length];
        int i = 0, j = 0, k = 0;
        while (i &lt; left.length &amp;&amp; j &lt; right.length) {
            if (left[i] &lt;= right[j]) {
                result[k++] = left[i++];
            } else {
                result[k++] = right[j++];
            }
        }
        while (i &lt; left.length) result[k++] = left[i++];
        while (j &lt; right.length) result[k++] = right[j++];
        return result;
    }
}

// 使用
ForkJoinPool pool = new ForkJoinPool();
int[] result = pool.invoke(new MergeSortTask(array));
```

---

## 适用场景

### 适合

- **分治任务**：大问题分解为小问题
- **递归计算**：树形结构的遍历、归并排序等
- **CPU 密集型**：充分利用多核
- **任务大小不均**：工作窃取自动负载均衡

### 不适合

- **任务有依赖**：分解后不能并行
- **IO 密集型**：工作窃取的开销可能大于收益
- **任务太小**：fork/join 开销大于任务本身

---

## vs 普通线程池

| 特性 | ThreadPoolExecutor | ForkJoinPool |
|------|-------------------|--------------|
| 队列 | 共享队列 | 每线程本地队列 |
| 负载均衡 | 无 | 工作窃取自动平衡 |
| 适用场景 | 任务大小均匀 | 任务大小不均 |
| 任务提交 | execute/submit | invoke/quietlyJoin |
| 线程利用率 | 可能不均衡 | 自动均衡 |

---

## 面试追问方向

1. **为什么工作窃取从队列尾部取？**
   因为队列头部的任务可能是其他线程正在分解的子任务。从尾部取的是已经稳定的大任务，减少冲突。

2. **ForkJoinPool 和普通线程池的本质区别？**
   ForkJoinPool 每个线程有自己的任务队列，通过窃取平衡负载；普通线程池共享一个队列，存在竞争。

3. **RecursiveTask 和 RecursiveAction 的区别？**
   RecursiveTask 有返回值，RecursiveAction 无返回值。

4. **fork() 和 join() 有什么区别？**
   fork() 异步提交子任务，返回 Future；join() 阻塞等待子任务完成并获取结果。

5. **什么时候用 ForkJoinPool 而不是 ThreadPoolExecutor？**
   任务可以递归分解，且分解后可以并行执行。如归并排序、快速排序、文件统计等。

6. **为什么 JDK 8 的并行流用 ForkJoinPool？**
   `Arrays.parallelSort()`、`Stream.parallel()` 底层都用 ForkJoinPool，因为分治任务天然适合工作窃取。
