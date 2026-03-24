# O(n log n) 排序：归并、快速、堆排序


## 为什么 O(n log n) 是比较排序的下限？

任何基于比较的排序，在最坏情况下至少需要 O(n log n) 次比较。

为什么？

因为 n 个元素的排序问题等价于在 n! 种排列中搜索，而 log(n!) = Θ(n log n)。

这是**信息论**给出的理论下限。

所以，O(n log n) 是比较排序的「极限」——而我们今天要讲的三种算法，正好达到了这个极限。


## 一、快速排序

### 算法思想

**分治思想：选一个基准（pivot），把数组分成两部分，左边都小于 pivot，右边都大于等于 pivot，然后递归排序两部分**。

```
初始: [3, 7, 8, 1, 5, 9, 2]
选 pivot = 5
分区: [3, 1, 2] | 5 | [7, 8, 9]
递归左: [1, 2, 3]
递归右: [7, 8, 9]
合并: [1, 2, 3, 5, 7, 8, 9]
```

### Java 实现

```java
public void quickSort(int[] arr) {
    quickSort(arr, 0, arr.length - 1);
}

private void quickSort(int[] arr, int left, int right) {
    if (left >= right) return;
    
    int pivotIndex = partition(arr, left, right);
    quickSort(arr, left, pivotIndex - 1);
    quickSort(arr, pivotIndex + 1, right);
}

// Lomuto 分区方案
private int partition(int[] arr, int left, int right) {
    int pivot = arr[right];  // 选择最右边的元素作为 pivot
    int i = left;  // i 左边（不含 i）都小于 pivot
    
    for (int j = left; j < right; j++) {
        if (arr[j] < pivot) {
            swap(arr, i, j);
            i++;
        }
    }
    swap(arr, i, right);  // 把 pivot 放到中间
    return i;
}
```

### 优化：随机 pivot + 三数取中

```java
private int partition(int[] arr, int left, int right) {
    // 三数取中：减少最坏情况发生概率
    int mid = left + (right - left) / 2;
    int pivotIndex = medianOfThree(arr, left, mid, right);
    swap(arr, pivotIndex, right);
    
    int pivot = arr[right];
    int i = left;
    for (int j = left; j < right; j++) {
        if (arr[j] < pivot) {
            swap(arr, i++, j);
        }
    }
    swap(arr, i, right);
    return i;
}

private int medianOfThree(int[] arr, int a, int b, int c) {
    if (arr[a] > arr[b] != arr[a] > arr[c]) return a;
    else if (arr[b] > arr[a] != arr[b] > arr[c]) return b;
    else return c;
}
```

### 优化：小数据量切换到插入排序

```java
private static final int CUTOFF = 10;

private void quickSort(int[] arr, int left, int right) {
    if (left + CUTOFF <= right) {
        int pivotIndex = partition(arr, left, right);
        quickSort(arr, left, pivotIndex - 1);
        quickSort(arr, pivotIndex + 1, right);
    } else {
        // 小数据量用插入排序
        insertionSort(arr, left, right);
    }
}

private void insertionSort(int[] arr, int left, int right) {
    for (int i = left + 1; i <= right; i++) {
        int temp = arr[i];
        int j = i;
        while (j > left && arr[j - 1] > temp) {
            arr[j] = arr[j - 1];
            j--;
        }
        arr[j] = temp;
    }
}
```

### 复杂度分析

- **时间复杂度**：最好 O(n log n)，最坏 O(n²)，平均 O(n log n)
- **空间复杂度**：O(log n)（递归栈）
- **稳定性**：不稳定


## 二、归并排序

### 算法思想

**分治思想：把数组分成两半，分别排序，然后合并两个有序数组**。

```
[8, 3, 7, 1, 5, 9, 2]
    ↓ 分
[8, 3, 7, 1]  [5, 9, 2]
    ↓ 分
[8, 3] [7, 1]  [5, 9] [2]
    ↓ 分
[8] [3] [7] [1]  [5] [9] [2]
    ↓ 合
[3, 8] [1, 7]  [5, 9] [2]
    ↓ 合
[1, 3, 7, 8]  [2, 5, 9]
    ↓ 合
[1, 2, 3, 5, 7, 8, 9]
```

### Java 实现

```java
public void mergeSort(int[] arr) {
    int[] temp = new int[arr.length];
    mergeSort(arr, temp, 0, arr.length - 1);
}

private void mergeSort(int[] arr, int[] temp, int left, int right) {
    if (left >= right) return;
    
    int mid = left + (right - left) / 2;
    mergeSort(arr, temp, left, mid);
    mergeSort(arr, temp, mid + 1, right);
    
    // 优化：如果已经有序，直接合并
    if (arr[mid] <= arr[mid + 1]) return;
    
    merge(arr, temp, left, mid, right);
}

private void merge(int[] arr, int[] temp, int left, int mid, int right) {
    int i = left, j = mid + 1, k = left;
    
    // 合并两个有序数组
    while (i <= mid && j <= right) {
        if (arr[i] <= arr[j]) {
            temp[k++] = arr[i++];
        } else {
            temp[k++] = arr[j++];
        }
    }
    
    // 处理剩余元素
    while (i <= mid) temp[k++] = arr[i++];
    while (j <= right) temp[k++] = arr[j++];
    
    // 复制回原数组
    System.arraycopy(temp, left, arr, left, right - left + 1);
}
```

### 自底向上的归并排序

```java
public void mergeSortBU(int[] arr) {
    int n = arr.length;
    int[] temp = new int[n];
    
    // 1, 2, 4, 8... 依次合并
    for (int sz = 1; sz < n; sz *= 2) {
        for (int left = 0; left < n - sz; left += 2 * sz) {
            int mid = left + sz - 1;
            int right = Math.min(left + 2 * sz - 1, n - 1);
            merge(arr, temp, left, mid, right);
        }
    }
}
```

### 复杂度分析

- **时间复杂度**：最好 O(n log n)，最坏 O(n log n)，平均 O(n log n)
- **空间复杂度**：O(n)
- **稳定性**：稳定


## 三、堆排序

### 算法思想

**利用堆这种数据结构，先建堆，然后依次取出堆顶元素**。

堆排序分两步：
1. **建堆**：把数组调整成大顶堆（或小顶堆）
2. **排序**：依次取出堆顶，与堆尾交换，然后调整堆

```java
public void heapSort(int[] arr) {
    int n = arr.length;
    
    // 1. 建堆：从最后一个非叶子节点开始下沉
    for (int i = n / 2 - 1; i >= 0; i--) {
        sink(arr, i, n);
    }
    
    // 2. 排序：依次取出堆顶
    for (int i = n - 1; i > 0; i--) {
        swap(arr, 0, i);  // 堆顶移到末尾
        sink(arr, 0, i);  // 调整堆
    }
}

// 下沉操作
private void sink(int[] arr, int i, int n) {
    while (2 * i + 1 < n) {
        int j = 2 * i + 1;
        if (j + 1 < n && arr[j] < arr[j + 1]) {
            j++;  // 找较大的孩子
        }
        if (arr[i] >= arr[j]) break;
        swap(arr, i, j);
        i = j;
    }
}
```

### 为什么从 n/2 - 1 开始下沉？

因为 n/2 - 1 是最后一个非叶子节点。

对于 n 个节点的完全二叉树：
- 节点 i 的左孩子：2i + 1
- 节点 i 的右孩子：2i + 2
- 节点 i 的父节点：(i - 1) / 2

最后一个节点的索引是 n-1，它的父节点是 `(n-1-1)/2 = n/2 - 1`。

### 复杂度分析

- **时间复杂度**：最好 O(n log n)，最坏 O(n log n)，平均 O(n log n)
- **空间复杂度**：O(1)
- **稳定性**：不稳定


## 三种 O(n log n) 排序的对比

| 特性 | 快速排序 | 归并排序 | 堆排序 |
|------|----------|----------|--------|
| 平均时间 | O(n log n) | O(n log n) | O(n log n) |
| 最坏时间 | O(n²) | O(n log n) | O(n log n) |
| 空间 | O(log n) | O(n) | O(1) |
| 稳定性 | 不稳定 | 稳定 | 不稳定 |
| 缓存友好性 | 高 | 中 | 低 |
| 实现复杂度 | 中 | 中 | 中 |

### 为什么快速排序实际最快？

1. **缓存友好**：分区操作是顺序访问，缓存命中率高
2. **常数因子小**：操作简单（比较、交换）
3. **原地排序**：不需要额外的大数组

### 为什么归并排序适合外部排序？

当数据存在磁盘上时，无法随机访问。

归并排序只需要顺序读写，适合外部排序的场景。


## 实战：求数组中第 K 大的元素

利用快速排序的 partition 思想：

```java
public int findKthLargest(int[] arr, int k) {
    int target = arr.length - k;  // 第 k 大 = 第 target 小
    int left = 0, right = arr.length - 1;
    
    while (left <= right) {
        int pivotIndex = partition(arr, left, right);
        if (pivotIndex == target) {
            return arr[pivotIndex];
        } else if (pivotIndex < target) {
            left = pivotIndex + 1;
        } else {
            right = pivotIndex - 1;
        }
    }
    return -1;
}
```


## 总结

三种 O(n log n) 排序各有优劣：

1. **快速排序**：实际最快，但最坏情况需要优化
2. **归并排序**：稳定，适合外部排序，但需要额外空间
3. **堆排序**：最坏情况也是 O(n log n)，且原地排序，但缓存不友好

**面试核心**：
- 快速排序的 partition 实现
- 快速排序的优化（随机 pivot、三数取中、小数据量用插入排序）
- 归并排序的合并过程
- 堆排序的建堆和下沉操作

## 面试追问方向

- 快速排序的 partition 有哪两种实现？（Lomuto 和 Hoare）
- 快速排序最坏情况是什么？什么时候会发生？（有序数组 + 固定 pivot）
- 归并排序为什么需要额外的 O(n) 空间？（合并操作需要临时数组）
- 堆排序的 sink 操作的时间复杂度是多少？（最坏深度次 = O(log n)）
- 如何用堆实现优先级队列？
