# 局部性原理：程序运行的隐藏规律

你有没有注意到一个现象：
打开一个大型程序时，第一次访问某个功能会卡一下，但之后访问同样的功能就很快了。
这是什么原因？

答案是**局部性原理**——程序运行的隐藏规律。


## 什么是局部性原理？

**程序在任意一小段时间内，往往只访问所有数据中的一小部分。**

```
你正在写代码：
- 80%的时间在看同一个文件
- 10%的时间在看include的头文件
- 5%的时间在看makefile
- 5%的时间在浏览其他文件

你不会同时阅读整个代码库！
```

### 两种局部性

| 类型 | 说明 | 例子 |
|-----|------|-----|
| **时间局部性** | 刚访问的数据/代码，近期可能再次访问 | 循环中的变量、循环体 |
| **空间局部性** | 刚访问的地址附近的数据，可能很快访问 | 数组遍历、顺序代码 |

```java
// 时间局部性好的例子
public class TimeLocality {
    public static void main(String[] args) {
        int sum = 0;
        for (int i = 0; i < 1000000000; i++) {
            sum += i;  // 反复访问sum，同一变量
        }
    }
}

// 空间局部性好的例子
public class SpatialLocality {
    public static void main(String[] args) {
        int[] arr = new int[1000000];
        int sum = 0;
        for (int i = 0; i < arr.length; i++) {
            sum += arr[i];  // 顺序访问，CPU prefetcher会预取
        }
    }
}

// 空间局部性差的例子
public class PoorSpatialLocality {
    // 跳跃式访问，隔8个元素访问一次
    public static void main(String[] args) {
        long[][] matrix = new long[1000][1000];
        long sum = 0;
        for (int i = 0; i < 1000; i++) {
            for (int j = 0; j < 1000; j++) {
                sum += matrix[i][j];  // 按行访问，局部性好
            }
        }
    }

    // 但如果这样访问：
    public static long badAccess(long[][] matrix) {
        long sum = 0;
        for (int i = 0; i < 1000; i++) {
            for (int j = 0; j < 1000; j++) {
                sum += matrix[j][i];  // 按列访问，局部性差！
                // matrix[j]和matrix[j+1]可能不在同一缓存行
            }
        }
        return sum;
    }
}
```


## 局部性在缓存中的应用

**所有现代计算机系统都利用局部性原理设计了多级缓存。**

```
┌─────────────────────────────────────────────────────────────┐
│                     存储层次结构                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  CPU寄存器   ←──  0个周期   ←──  几百字节                      │
│       │                                                        │
│       ▼                                                        │
│  L1缓存     ←──  4个周期   ←── 几十KB（每核）                   │
│       │                                                        │
│       ▼                                                        │
│  L2缓存     ←──  12个周期  ←── 几百KB（每核或共享）              │
│       │                                                        │
│       ▼                                                        │
│  L3缓存     ←──  30-50周期←── 几十MB（共享）                    │
│       │                                                        │
│       ▼                                                        │
│  内存       ←──  200个周期 ←── 几十GB                           │
│       │                                                        │
│       ▼                                                        │
│  SSD        ←──  几十万周期 ←── 几百GB                          │
│       │                                                        │
│       ▼                                                        │
│  磁盘       ←──  上千万周期 ←── 几TB                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘

缓存命中的关键：工作集大小 < 缓存容量
```


## 抖动：局部性失效的后果

**当物理内存太小，无法容纳程序的工作集时，会发生「抖动」。**

```
正常情况：
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  工作集 = 100MB                                          │
│  物理内存 = 4GB                                           │
│  → 所有页都在内存中                                       │
│  → 缺页率极低                                            │
│                                                          │
└─────────────────────────────────────────────────────────┘

发生抖动：
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  工作集 = 100MB                                          │
│  物理内存 = 64MB                                         │
│  → 只能装下64%的页                                       │
│  → 程序频繁访问被换出的页                                 │
│  → 每次访问都触发缺页                                    │
│  → 系统花大量时间在换页上，而不是执行程序                  │
│  → CPU利用率极低                                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

```java
// 模拟抖动的程序
public class ThrashingDemo {
    public static void main(String[] args) {
        // 模拟一个远大于物理内存的数据集
        int size = 100_000_000;  // 假设每个int 4字节 = 400MB
        int[] data = new int[size];

        // 顺序遍历（局部性好，缓存命中率高）
        long start = System.nanoTime();
        for (int i = 0; i < size; i++) {
            data[i] = i;
        }
        long sequentialTime = System.nanoTime() - start;

        // 随机访问（局部性差，缓存命中率低）
        Random rand = new Random();
        for (int i = 0; i < size; i++) {
            int idx = rand.nextInt(size);
            data[idx] = idx;
        }
        long randomTime = System.nanoTime() - start - sequentialTime;

        System.out.println("顺序访问时间: " + sequentialTime / 1_000_000 + " ms");
        System.out.println("随机访问时间: " + randomTime / 1_000_000 + " ms");
        System.out.println("随机访问慢了 " + (randomTime / (sequentialTime + 1)) + " 倍");
    }
}
```


## 抖动的原因与解决方案

### 原因

```
┌──────────────────────────────────────────────────────────┐
│                    抖动的根本原因                         │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  1. 工作集 > 物理内存（程序本身需求太大）                   │
│                                                           │
│  2. 多进程竞争（物理内存被多个进程瓜分）                     │
│                                                           │
│  3. 置换算法不当（换出了活跃的页）                          │
│                                                           │
│  4. 程序的局部性差（大量随机访问）                          │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 解决方案

| 方案 | 说明 |
|-----|-----|
| 增加物理内存 | 最直接的办法 |
| 减少并发进程数 | 降低内存竞争 |
| 优化程序局部性 | 代码层面改进 |
| 调整交换策略 | 操作系统层面优化 |
| 使用内存映射文件 | 延迟加载，按需访问 |

### 操作系统的应对

```java
// 操作系统如何检测和处理抖动
public class ThrashingDetection {
    // 方法1：监控缺页率
    public double getPageFaultRate() {
        // 缺页数 / 总内存访问数
        // 持续观察：如果超过阈值，认为发生抖动
        return缺页数 / (缺页数 + 命中数);
    }

    // 方法2：监控工作集大小
    public Set<Integer> getCurrentWorkingSet() {
        // 扫描页表，找出最近Δ时间被访问过的页
        return currentWorkingSet;
    }

    // 方法3：调整进程优先级
    public void handleThrashing() {
        // 1. 找出内存使用过多的进程
        List<Process> heavyProcesses = findHeavyProcesses();

        // 2. 降低其优先级（让它少分配内存）
        for (Process p : heavyProcesses) {
            p.setMemoryPriority(MemoryPriority.LOW);
        }

        // 3. 或者暂停一些进程
        // 4. 或者换出整个进程到磁盘
    }
}
```


## 实际案例：JVM的本地性优化

JVM在GC和内存分配上做了大量本地性优化：

```java
public class JVMLocalityOptimization {
    public static void main(String[] args) {
        // JVM的逃逸分析
        // 如果对象只在方法内部使用，不逃逸到堆
        // 可以在栈上分配，节省GC开销，提高缓存命中率

        for (int i = 0; i < 1_000_000; i++) {
            // 这个对象可能栈上分配
            int[] local = new int[100];  // 不逃逸
            for (int j = 0; j < 100; j++) {
                local[j] = j;
            }
        }

        // JVM的TLAB（Thread Local Allocation Buffer）
        // 每个线程预分配一块区域用于对象分配
        // 减少多线程竞争，提高分配速度
        // 间接提高本地性：同一线程的对象分配在一起

        // JVM的对象头布局优化
        // HotSpot使用压缩指针（CompressedOops）
        // 减少对象引用的大小，提高缓存利用率

        // 数组局部性
        // Java中的基本类型数组连续存储
        // int[] 比 List&lt;Integer&gt; 有更好的局部性

        // 循环优化
        // 将外层循环改为内层循环，减少数据访问的跨度
    }
}
```


## 如何写出局部性友好的代码

### 1. 数组遍历：按行 vs 按列

```java
// 差：按列访问（缓存不友好）
public long badMatrixSum(long[][] matrix, int n) {
    long sum = 0;
    for (int col = 0; col < n; col++) {
        for (int row = 0; row < n; row++) {
            sum += matrix[row][col];  // 跳着访问内存
        }
    }
    return sum;
}

// 好：按行访问（缓存友好）
public long goodMatrixSum(long[][] matrix, int n) {
    long sum = 0;
    for (int row = 0; row < n; row++) {
        for (int col = 0; col < n; col++) {
            sum += matrix[row][col];  // 顺序访问内存
        }
    }
    return sum;
}
```

### 2. 结构体布局

```java
// 差：结构体数组（Array of Structs）
class PointBad {
    long x;
    long y;
    long z;
    long color;
}
PointBad[] points1 = new PointBad[1000000];

// 好：数组结构体（Struct of Arrays）
class PointsGood {
    long[] x;
    long[] y;
    long[] z;
    long[] color;
}
PointsGood points2 = new PointsGood();
// 访问所有x时，内存连续命中
```

### 3. 分块处理

```java
// 处理大数组时，使用分块提高缓存命中率
public void blockMatrixMultiply(double[][] a, double[][] b, double[][] c, int n, int blockSize) {
    for (int ii = 0; ii < n; ii += blockSize) {
        for (int jj = 0; jj < n; jj += blockSize) {
            for (int kk = 0; kk < n; kk += blockSize) {
                // 处理小块
                for (int i = ii; i < Math.min(ii + blockSize, n); i++) {
                    for (int j = jj; j < Math.min(jj + blockSize, n); j++) {
                        for (int k = kk; k < Math.min(kk + blockSize, n); k++) {
                            c[i][j] += a[i][k] * b[k][j];
                        }
                    }
                }
            }
        }
    }
}
```


## 面试追问方向

- **什么是时间局部性和空间局部性？各举一个例子。**
  提示：循环中的变量 vs 数组遍历。
- **抖动的根本原因是什么？如何检测和解决抖动？**
  提示：工作集 > 物理内存，监控缺页率。
- **为什么C语言中的数组遍历按行比按列快？**
  提示：二维数组在内存中是行优先存储的。
- **如何从代码层面优化程序的局部性？**
  提示：结构体布局、分块、避免随机访问。
