# 海量数据处理：Top K、位图、布隆过滤器


## 面试官问：「10 亿个整数中找出最大的 1000 个，你怎么实现？」

你的第一反应可能是排序后取前 1000 个。

但 10 亿个整数如果全部加载到内存需要 4GB 空间（每个 int 4 字节），很多机器扛不住。

更重要的是：排序需要 O(n log n)，而我们有更聪明的方法。

这就是**海量数据处理**的核心思想：**分而治之 + 巧妙数据结构**。


## 一、Top K 问题

### 解法一：小顶堆

**思路**：维护一个大小为 K 的小顶堆，遍历数据时不断调整，最后堆中就是最大的 K 个。

```java
public int[] topK(int[] nums, int k) {
    if (k > nums.length) return nums;
    
    // 创建小顶堆
    PriorityQueue&lt;Integer&gt; minHeap = new PriorityQueue&lt;&gt;();
    
    for (int num : nums) {
        if (minHeap.size() < k) {
            minHeap.offer(num);
        } else if (num > minHeap.peek()) {
            minHeap.poll();
            minHeap.offer(num);
        }
    }
    
    int[] result = new int[k];
    for (int i = 0; i < k; i++) {
        result[i] = minHeap.poll();
    }
    return result;
}
```

**复杂度**：
- 时间：O(n log k)
- 空间：O(k)
- 适合场景：单机，内存有限

### 解法二：分治 + 归并

**思路**：
1. 将大数据分成小文件
2. 每个小文件内部排序并取 Top K
3. 归并所有小文件的 Top K

```
10 亿条数据
    ↓ 分成 1000 个文件，每个 100 万条
每个文件内部排序，取 Top 1000
    ↓
归并 1000 × 1000 = 100 万条数据
    ↓
取最终的 Top 1000
```

### 解法三：MapReduce

在分布式环境下，可以用 MapReduce 框架：

```java
// Map: 每个文件输出局部 Top K
// Reduce: 合并所有局部 Top K，取全局 Top K
```


## 二、位图（BitMap）

### 什么是位图？

用 bit（位）来表示数字的存在与否。

假设要存储 0-7 的数字：
```
传统数组: int[8] = {1, 0, 1, 0, 0, 1, 0, 0}  → 8 × 4 = 32 字节
位图:     01010010                           → 1 字节
```

### 位图的基本操作

```java
public class BitMap {
    private long[] bits;
    private int max;
    
    public BitMap(int max) {
        this.max = max;
        this.bits = new long[(max + 63) / 64];
    }
    
    // 设置第 i 位为 1
    public void set(int i) {
        if (i < 0 || i >= max) return;
        bits[i / 64] |= (1L << (i % 64));
    }
    
    // 设置第 i 位为 0
    public void clear(int i) {
        if (i < 0 || i >= max) return;
        bits[i / 64] &= ~(1L << (i % 64));
    }
    
    // 判断第 i 位是否为 1
    public boolean get(int i) {
        if (i < 0 || i >= max) return false;
        return (bits[i / 64] & (1L << (i % 64))) != 0;
    }
}
```

### 位图的应用

**1. 去重**

```java
public boolean[] deduplicate(int[] nums, int max) {
    BitMap bitMap = new BitMap(max);
    for (int num : nums) {
        bitMap.set(num);
    }
    // bitMap 中为 1 的位置就是出现过的数字
}
```

**2. 找出缺失的整数**

```java
public int findMissing(int[] nums, int max) {
    BitMap bitMap = new BitMap(max);
    for (int num : nums) {
        bitMap.set(num);
    }
    for (int i = 0; i < max; i++) {
        if (!bitMap.get(i)) return i;
    }
    return -1;
}
```

### 位图的空间计算

假设有 40 亿个整数需要去重：
- 每个数需要 1 bit
- 总 bit 数 = 4,000,000,000 bit = 500,000,000 byte ≈ 500 MB

比传统数组（16 GB）节省了 99.99% 的空间。


## 三、布隆过滤器（Bloom Filter）

### 位图的问题

位图只能处理**取值范围有限**的数据。但如果数据是字符串、URL 等任意类型呢？

**布隆过滤器**登场了。

### 布隆过滤器的原理

布隆过滤器由一个位图和多个哈希函数组成：
1. 用 k 个哈希函数计算数据，得到 k 个位置
2. 把这 k 个位置都设为 1
3. 查询时，如果这 k 个位置都为 1，说明数据**可能存在**；如果有一个为 0，说明数据**一定不存在**

```
数据 "google.com"
    ↓
哈希函数 1: hash1("google.com") = 5  → set bit 5
哈希函数 2: hash2("google.com") = 9  → set bit 9
哈希函数 3: hash3("google.com") = 3  → set bit 3

查询 "google.com"
    → 检查 bit 5, 9, 3 是否都为 1
    → 是 → 可能存在（可能有误判）
    → 否 → 一定不存在
```

### Java 实现

```java
public class BloomFilter {
    private BitArray bits;
    private int size;  // 位数组大小
    private int hashCount;  // 哈希函数数量
    
    public BloomFilter(int expectedInsertions, double falsePositiveRate) {
        // 计算位数组大小和哈希函数数量
        double ln2 = Math.log(2);
        size = (int) (-expectedInsertions * Math.log(falsePositiveRate) / (ln2 * ln2));
        hashCount = (int) (ln2 * size / expectedInsertions);
        bits = new BitArray(size);
    }
    
    public void add(String value) {
        for (int i = 0; i < hashCount; i++) {
            int index = hash(value, i);
            bits.set(index);
        }
    }
    
    public boolean mightContain(String value) {
        for (int i = 0; i < hashCount; i++) {
            int index = hash(value, i);
            if (!bits.get(index)) {
                return false;  // 一定不存在
            }
        }
        return true;  // 可能存在
    }
    
    // 双哈希生成 k 个哈希值
    private int hash(String value, int seed) {
        int h1 = value.hashCode();
        int h2 = value.hashCode() >>> 16;
        return (h1 + seed * h2) % size;
    }
}
```

### 布隆过滤器的特性

**优点**：
- 空间效率极高
- 查询时间 O(k)，k 是哈希函数数量

**缺点**：
- 有误判率（不存在的数据可能判断为存在）
- 不能删除（删除会影响其他数据）

**适合场景**：
- 缓存穿透防护
- 垃圾邮件过滤
- URL 去重
- 爬虫 URL 过滤


## 四、海量数据处理技巧

### 1. 哈希分桶

把数据按哈希值分到不同的文件或机器，保证相同的数据在同一个桶里。

```java
public int getBucket(String key, int bucketCount) {
    return Math.abs(key.hashCode() % bucketCount);
}
```

### 2. 外部排序

当数据无法全部加载到内存时：
1. 分段读取，内存内排序
2. 写入临时文件
3. 归并所有临时文件

### 3. bitmap + 分段

对于范围更大的数据（如 0-10 亿），可以用分段位图。

### 4. 堆的妙用

- Top K：维护大小为 K 的小顶堆
- 中位数：维护两个堆（大顶堆存小的一半，小顶堆存大的一半）


## 实战：40 亿个整数中找出重复的数字

```java
public List&lt;Integer&gt; findDuplicates(long[] nums, long range) {
    BitArray bits = new BitArray((int) range);
    List&lt;Integer&gt; duplicates = new ArrayList&lt;&gt;();
    
    for (long num : nums) {
        int index = (int) num;
        if (bits.get(index)) {
            duplicates.add(index);
        } else {
            bits.set(index);
        }
    }
    
    return duplicates;
}
```


## 总结

海量数据处理的核心思想：

1. **分而治之**：大化小，分治处理
2. **空间换时间**：位图、布隆过滤器
3. **巧用数据结构**：堆（Top K）、bitmap（去重）
4. **哈希分桶**：相同数据分到同一桶

根据问题特点选择合适的方法：
- 数据量大、内存有限 → 分治
- 需要去重 → 位图或布隆过滤器
- 找 Top K → 堆
- 范围有限 → 位图

## 面试追问方向

- Top K 问题有哪些解法？各自优缺点？（堆：O(n log k)，排序：O(n log n)，分治：适合分布式）
- 位图的空间复杂度是多少？如何扩展到字符串？（bit 位 = 数据范围，需要多个位图）
- 布隆过滤器的误判率如何计算？如何降低？（误判率 = (1 - e^(-kn/m))^k，可增加位数组大小或哈希函数数量）
- 布隆过滤器如何删除数据？（不能直接删除，可以用计数布隆过滤器或 Cuckoo Filter）
- 如何在大数据中找中位数？（维护两个堆，或者分治 + 外部排序）
