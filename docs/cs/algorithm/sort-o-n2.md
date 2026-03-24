# O(n²) 排序：冒泡、选择、插入排序


## 为什么还要学 O(n²) 的排序？

有人会说：「既然有 O(n log n) 的排序，为什么要学 O(n²) 的？」

因为：

1. **面试常问**：快速排序的 partition、归并排序的分治，你得先理解 O(n²) 的排序是怎么工作的
2. **小数据最优**：n ≤ 50 时，插入排序通常比快速排序快
3. **实际工程**：某些嵌入式系统，内存紧张，O(1) 空间是刚需

更重要的是，理解 O(n²) 排序是理解更高效排序的基础。


## 一、冒泡排序

### 算法思想

**像气泡一样，大的元素逐渐上浮到数组末端**。

每趟排序，把最大的元素「冒泡」到最后。

```
第1趟: [3, 1, 4, 1, 5] → [1, 3, 1, 4, 5] → [1, 1, 3, 4, 5] → [1, 1, 3, 4, 5] → [1, 1, 3, 4, 5]
第2趟: [1, 1, 3, 4, 5] → [1, 1, 3, 4, 5] → ...
```

### Java 实现

```java
public void bubbleSort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n - 1; i++) {
        boolean swapped = false;
        for (int j = 0; j < n - 1 - i; j++) {
            if (arr[j] > arr[j + 1]) {
                swap(arr, j, j + 1);
                swapped = true;
            }
        }
        // 优化：没有交换说明已经有序
        if (!swapped) break;
    }
}

private void swap(int[] arr, int i, int j) {
    int temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
}
```

### 优化：提前终止 + 记录边界

```java
public void bubbleSortOptimized(int[] arr) {
    int n = arr.length;
    int right = n - 1;  // 右侧边界
    
    while (right > 0) {
        int lastSwap = 0;
        for (int j = 0; j < right; j++) {
            if (arr[j] > arr[j + 1]) {
                swap(arr, j, j + 1);
                lastSwap = j;  // 记录最后交换位置
            }
        }
        // lastSwap 之后的已经有序
        right = lastSwap;
    }
}
```

### 复杂度分析

- **时间复杂度**：最好 O(n)，最坏 O(n²)，平均 O(n²)
- **空间复杂度**：O(1)
- **稳定性**：稳定（相等元素不交换）


## 二、选择排序

### 算法思想

**每次从未排序的部分选择最小（或最大）的元素，放到已排序的末尾**。

```
初始: [64, 25, 12, 22, 11]
第1步: 选择最小 11，与 64 交换 → [11, 25, 12, 22, 64]
第2步: 选择最小 12，与 25 交换 → [11, 12, 25, 22, 64]
第3步: 选择最小 22，与 25 交换 → [11, 12, 22, 25, 64]
第4步: 选择最小 25，无需交换 → [11, 12, 22, 25, 64]
```

### Java 实现

```java
public void selectionSort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n - 1; i++) {
        int minIndex = i;
        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIndex]) {
                minIndex = j;
            }
        }
        if (minIndex != i) {
            swap(arr, i, minIndex);
        }
    }
}
```

### 复杂度分析

- **时间复杂度**：最好 O(n²)，最坏 O(n²)，平均 O(n²)
- **空间复杂度**：O(1)
- **稳定性**：不稳定

**为什么不稳定？**

```java
[5₁, 3, 5₂, 1]
// 选择最小 1，与 5₁ 交换
[1, 3, 5₂, 5₁]
// 两个 5 的相对顺序变了！不稳定。
```


## 三、插入排序

### 算法思想

**把数组分成「已排序」和「未排序」两部分，每次把未排序的第一个元素插入到已排序部分的正确位置**。

就像打扑克牌时整理手牌一样。

```
初始: [5, 2, 4, 6, 1, 3]
        ↑
       第一个元素视为已排序

第1步: 插入 2 → [2, 5, 4, 6, 1, 3]
第2步: 插入 4 → [2, 4, 5, 6, 1, 3]
第3步: 插入 6 → [2, 4, 5, 6, 1, 3]（无需移动）
第4步: 插入 1 → [1, 2, 4, 5, 6, 3]
第5步: 插入 3 → [1, 2, 3, 4, 5, 6]
```

### Java 实现

```java
public void insertionSort(int[] arr) {
    int n = arr.length;
    for (int i = 1; i < n; i++) {
        int key = arr[i];  // 待插入的元素
        int j = i - 1;
        
        // 移动比 key 大的元素
        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = key;  // 插入
    }
}
```

### 优化：二分插入

```java
public void insertionSortBinary(int[] arr) {
    int n = arr.length;
    for (int i = 1; i < n; i++) {
        int key = arr[i];
        // 二分查找插入位置
        int pos = Arrays.binarySearch(arr, 0, i, key);
        if (pos < 0) pos = -(pos + 1);
        
        // 移动元素
        System.arraycopy(arr, pos, arr, pos + 1, i - pos);
        arr[pos] = key;
    }
}
```

### 复杂度分析

- **时间复杂度**：最好 O(n)，最坏 O(n²)，平均 O(n²)
- **空间复杂度**：O(1)
- **稳定性**：稳定

### 为什么插入排序「基本有序」时很快？

当数组基本有序时，内层 while 循环几乎不执行，接近 O(n)。


## 希尔排序：插入排序的改进

### 算法思想

插入排序每次只移动一位，希尔排序通过「跳跃式」移动，大幅减少比较次数。

**核心**：设置一个递减的「增量序列」，按增量分组进行插入排序。

```java
public void shellSort(int[] arr) {
    int n = arr.length;
    
    // 初始增量 n/2，每次减半
    for (int gap = n / 2; gap > 0; gap /= 2) {
        // 对每组进行插入排序
        for (int i = gap; i < n; i++) {
            int key = arr[i];
            int j = i;
            
            while (j >= gap && arr[j - gap] > key) {
                arr[j] = arr[j - gap];
                j -= gap;
            }
            arr[j] = key;
        }
    }
}
```

### 复杂度分析

- **时间复杂度**：平均 O(n^1.3)，最坏 O(n²)
- **空间复杂度**：O(1)
- **稳定性**：不稳定


## 三种 O(n²) 排序的对比

| 特性 | 冒泡排序 | 选择排序 | 插入排序 |
|------|----------|----------|----------|
| 时间（最好） | O(n) | O(n²) | O(n) |
| 时间（最坏） | O(n²) | O(n²) | O(n²) |
| 空间 | O(1) | O(1) | O(1) |
| 稳定性 | 稳定 | 不稳定 | 稳定 |
| 特点 | 简单，但慢 | 交换少 | 基本有序时很快 |


## 实战：判断插入排序的交换次数

```java
public int numInsertionSwaps(int[] arr) {
    int count = 0;
    int n = arr.length;
    for (int i = 1; i < n; i++) {
        int j = i;
        while (j > 0 && arr[j - 1] > arr[j]) {
            swap(arr, j - 1, j);
            count++;
            j--;
        }
    }
    return count;
}
```


## 总结

三种 O(n²) 排序各有特点：

1. **冒泡排序**：最简单，但效率最低，适合教学
2. **选择排序**：交换次数少（最多 n 次），适合交换成本高的场景
3. **插入排序**：小数据量和基本有序时效率高，是许多优化算法的组成部分

**面试常问的点**：
- 冒泡排序的优化（提前终止、记录边界）
- 选择排序为什么不稳定？
- 插入排序在什么情况下最快？（基本有序）
- 希尔排序的原理和复杂度

## 面试追问方向

- 三种 O(n²) 排序的稳定性？（冒泡和插入稳定，选择不稳定）
- 选择排序为什么不稳定？举例说明
- 插入排序的最好时间复杂度是什么情况？（已经有序）
- 希尔排序的增量序列有什么讲究？（常用 Knuth 序列）
- 为什么插入排序比冒泡排序更常用？（交换次数少，更适合实际问题）
