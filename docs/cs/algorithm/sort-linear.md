# 计数排序、桶排序、基数排序（线性排序）


## 为什么「比较排序」无法突破 O(n log n)？

这是由信息论决定的。

n 个元素有 n! 种可能的排列，排序的本质是在这 n! 种排列中搜索正确的那一种。

而一次比较最多排除一半的可能，所以至少需要 log₂(n!) = Θ(n log n) 次比较。

**那么，有没有不需要比较的排序？**

有！这就是**线性排序**——通过分析数据的特征，突破比较排序的下限。


## 一、计数排序

### 算法思想

**适用于范围较小的整数排序。统计每个值出现的次数，然后根据累计次数放置元素**。

```
原始数组: [2, 5, 3, 1, 4, 2, 3]

1. 统计计数
   0: 0
   1: 1
   2: 2
   3: 2
   4: 1
   5: 1

2. 累计计数
   0: 0
   1: 1
   2: 3
   3: 5
   4: 6
   5: 7

3. 放置元素（从后往前，保持稳定性）
   输出: [1, 2, 2, 3, 3, 4, 5]
```

### Java 实现

```java
public int[] countingSort(int[] arr) {
    if (arr.length == 0) return arr;
    
    // 1. 找到最大值和最小值
    int min = arr[0], max = arr[0];
    for (int num : arr) {
        min = Math.min(min, num);
        max = Math.max(max, num);
    }
    
    // 2. 统计计数
    int range = max - min + 1;
    int[] count = new int[range];
    for (int num : arr) {
        count[num - min]++;
    }
    
    // 3. 累计计数
    for (int i = 1; i < range; i++) {
        count[i] += count[i - 1];
    }
    
    // 4. 放置元素（从后往前，保持稳定）
    int[] output = new int[arr.length];
    for (int i = arr.length - 1; i >= 0; i--) {
        output[count[arr[i] - min] - 1] = arr[i];
        count[arr[i] - min]--;
    }
    
    return output;
}
```

### 优化：原地计数排序

```java
public void countingSortInPlace(int[] arr) {
    int min = arr[0], max = arr[0];
    for (int num : arr) {
        min = Math.min(min, num);
        max = Math.max(max, num);
    }
    
    int range = max - min + 1;
    int[] count = new int[range];
    for (int num : arr) {
        count[num - min]++;
    }
    
    // 用累计和直接在原数组上覆盖
    int index = 0;
    for (int i = 0; i < range; i++) {
        while (count[i]-- > 0) {
            arr[index++] = i + min;
        }
    }
}
```

### 复杂度分析

- **时间复杂度**：O(n + k)，k 为数据范围
- **空间复杂度**：O(k)
- **稳定性**：稳定
- **适用场景**：整数排序，范围不太大


## 二、桶排序

### 算法思想

**将数据分到有限数量的桶里，对每个桶内部进行排序，然后按顺序合并**。

```
原始数组: [0.42, 0.65, 0.32, 0.78, 0.19, 0.93]

分桶（假设 10 个桶）:
桶0 [0.19]      桶3 [0.32]      桶6 [0.65]      桶9 [0.78, 0.93]
桶1 []          桶4 []          桶7 []          桶10 []
...

对每个桶内部排序后合并: [0.19, 0.32, 0.42, 0.65, 0.78, 0.93]
```

### Java 实现

```java
public void bucketSort(float[] arr, int bucketCount) {
    if (arr.length == 0) return;
    
    // 1. 创建桶
    List&lt;Float&gt;[] buckets = new ArrayList[bucketCount];
    for (int i = 0; i < bucketCount; i++) {
        buckets[i] = new ArrayList&lt;&gt;();
    }
    
    // 2. 分桶
    float min = arr[0], max = arr[0];
    for (float num : arr) {
        min = Math.min(min, num);
        max = Math.max(max, num);
    }
    
    float range = max - min;
    for (float num : arr) {
        int bucketIndex = (int) ((num - min) / range * (bucketCount - 1));
        buckets[bucketIndex].add(num);
    }
    
    // 3. 对每个桶排序
    for (List&lt;Float&gt; bucket : buckets) {
        Collections.sort(bucket);
    }
    
    // 4. 合并
    int index = 0;
    for (List&lt;Float&gt; bucket : buckets) {
        for (float num : bucket) {
            arr[index++] = num;
        }
    }
}
```

### 复杂度分析

- **时间复杂度**：平均 O(n + k)，最坏 O(n²)（所有元素都在一个桶里）
- **空间复杂度**：O(n + k)
- **稳定性**：取决于桶内排序算法
- **适用场景**：数据均匀分布的浮点数


## 三、基数排序

### 算法思想

**按位数进行排序，从低位到高位（或从高位到低位），每一位都使用稳定的排序算法**。

```
原始数组: [170, 45, 75, 90, 802, 24, 2, 66]

按个位排序（稳定）: [170, 90, 802, 2, 24, 45, 75, 66]
按十位排序（稳定）: [802, 2, 24, 45, 66, 170, 75, 90]
按百位排序（稳定）: [2, 24, 45, 66, 75, 90, 170, 802]
```

### Java 实现

```java
public void radixSort(int[] arr) {
    if (arr.length == 0) return;
    
    // 找到最大值
    int max = arr[0];
    for (int num : arr) {
        max = Math.max(max, num);
    }
    
    // 按每一位排序
    for (int exp = 1; max / exp > 0; exp *= 10) {
        countingSortByDigit(arr, exp);
    }
}

// 按指定位数进行计数排序
private void countingSortByDigit(int[] arr, int exp) {
    int n = arr.length;
    int[] output = new int[n];
    int[] count = new int[10];  // 数字 0-9
    
    // 统计每个数字出现的次数
    for (int num : arr) {
        int digit = (num / exp) % 10;
        count[digit]++;
    }
    
    // 累计计数
    for (int i = 1; i < 10; i++) {
        count[i] += count[i - 1];
    }
    
    // 从后往前遍历，保持稳定性
    for (int i = n - 1; i >= 0; i--) {
        int digit = (arr[i] / exp) % 10;
        output[count[digit] - 1] = arr[i];
        count[digit]--;
    }
    
    System.arraycopy(output, 0, arr, 0, n);
}
```

### 复杂度分析

- **时间复杂度**：O(nk)，k 为位数
- **空间复杂度**：O(n + k)
- **稳定性**：稳定（使用稳定的计数排序作为子过程）
- **适用场景**：整数或字符串排序


## 三种线性排序的对比

| 特性 | 计数排序 | 桶排序 | 基数排序 |
|------|----------|--------|----------|
| 时间复杂度 | O(n + k) | O(n + k) | O(nk) |
| 空间复杂度 | O(k) | O(n + k) | O(n + k) |
| 稳定性 | 稳定 | 稳定 | 稳定 |
| 数据类型 | 整数 | 浮点数/整数 | 整数/字符串 |
| 数据范围 | 范围较小 | 均匀分布 | 无限制 |
| 最坏情况 | O(n + k) | O(n²) | O(nk) |


## 实战：按出现频率排序

```java
public int[] sortByFrequency(int[] arr) {
    // 统计频率
    Map&lt;Integer, Integer&gt; freq = new HashMap&lt;&gt;();
    for (int num : arr) {
        freq.put(num, freq.getOrDefault(num, 0) + 1);
    }
    
    // 用频率作为桶的索引
    int maxFreq = Collections.max(freq.values());
    List&lt;Integer&gt;[] buckets = new ArrayList[maxFreq + 1];
    for (int i = 0; i <= maxFreq; i++) {
        buckets[i] = new ArrayList&lt;&gt;();
    }
    
    for (int num : arr) {
        buckets[freq.get(num)].add(num);
    }
    
    // 从高频到低频收集
    int index = 0;
    for (int f = maxFreq; f >= 0; f--) {
        for (int num : buckets[f]) {
            arr[index++] = num;
        }
    }
    
    return arr;
}
```


## 总结

线性排序通过**分析数据特征**突破比较排序的下限：

1. **计数排序**：适用于范围较小的整数，空间换时间
2. **桶排序**：适用于数据均匀分布的浮点数
3. **基数排序**：适用于整数或字符串，按位稳定排序

**使用原则**：
- 数据范围小 → 计数排序
- 数据均匀分布 → 桶排序
- 多位数整数 → 基数排序

## 面试追问方向

- 计数排序为什么需要 O(k) 的额外空间？（k 是数据范围）
- 桶排序的时间复杂度是多少？什么情况下会退化为 O(n²)？（所有元素在一个桶里）
- 基数排序为什么从低位开始排序？可以从高位开始吗？（低位开始更稳定，可以从高位开始但需要更复杂的过程）
- 计数排序和基数排序的子过程为什么用计数排序而不是其他？（因为每一位都是 0-9，用计数排序 O(n) 即可）
- 什么情况下线性排序比 O(n log n) 排序更快？（数据满足线性排序的前提条件时）
