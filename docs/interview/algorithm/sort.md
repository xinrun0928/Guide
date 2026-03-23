# 排序算法高频题：快速排序、归并排序、TopK

> 排序是算法基础中的基础，但面试不会只考「写一个快排」。真正的高频题是：**如何在已排序的基础上高效解决问题**。

## 排序算法横向对比

| 算法 | 时间复杂度（平均）| 空间复杂度 | 稳定性 | 适用场景 |
|------|-------------------|------------|--------|----------|
| 冒泡排序 | O(n²) | O(1) | 稳定 | 教学、n 很小时 |
| 插入排序 | O(n²) | O(1) | 稳定 | 近乎有序数据 |
| 选择排序 | O(n²) | O(1) | 不稳定 | 同上 |
| 归并排序 | O(n log n) | O(n) | 稳定 | 需要稳定排序、外部排序 |
| 堆排序 | O(n log n) | O(1) | 不稳定 | TopK、优先级队列 |
| 快速排序 | O(n log n) | O(log n) | 不稳定 | 通用排序（实际最快）|
| 计数排序 | O(n + k) | O(k) | 稳定 | 整数范围小时 |
| 基数排序 | O(nk) | O(n) | 稳定 | 整数范围大但位数少 |

---

## 高频题一：手写快速排序

> 面试中出现频率最高的排序题，不是让你实现一个完整的快排，而是**手写 partition（分区函数）**，因为它是很多题目的核心。

```java
public void quicksort(int[] arr, int left, int right) {
    if (left >= right) return;
    int pivotIndex = partition(arr, left, right);
    quicksort(arr, left, pivotIndex - 1);
    quicksort(arr, pivotIndex + 1, right);
}

public int partition(int[] arr, int left, int right) {
    int pivot = arr[right]; // 选择最后一个元素作为基准
    int i = left - 1;       // i 是小于 pivot 元素的最后位置
    for (int j = left; j < right; j++) {
        if (arr[j] <= pivot) {
            i++;
            swap(arr, i, j);
        }
    }
    // 把基准放到中间位置（左边都 <= pivot，右边都 > pivot）
    swap(arr, i + 1, right);
    return i + 1;
}

private void swap(int[] arr, int i, int j) {
    int tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
}
```

**partition 的本质**：把数组分成两部分，左边 <= pivot，右边 > pivot，返回 pivot 的最终位置。

**时间复杂度**：平均 O(n log n)，最坏 O(n²)（数组已经有序且选最右元素为基准）。**优化**：随机选择基准。

---

## 高频题二：手写归并排序

归并排序的核心是**分治 + 合并**。

```java
public int[] mergeSort(int[] arr) {
    if (arr.length <= 1) return arr;
    int mid = arr.length / 2;
    int[] left = mergeSort(Arrays.copyOfRange(arr, 0, mid));
    int[] right = mergeSort(Arrays.copyOfRange(arr, mid, arr.length));
    return merge(left, right);
}

private int[] merge(int[] left, int[] right) {
    int[] result = new int[left.length + right.length];
    int i = 0, j = 0, k = 0;
    while (i < left.length && j < right.length) {
        // <= 保证稳定性（相等时先放左边）
        result[k++] = left[i] <= right[j] ? left[i++] : right[j++];
    }
    // 拷贝剩余部分
    while (i < left.length) result[k++] = left[i++];
    while (j < right.length) result[k++] = right[j++];
    return result;
}
```

**归并排序的特点**：稳定排序，需要 O(n) 额外空间，适合外部排序。

---

## 高频题三：数组中的第 K 个最大元素

> 题目：给定整数数组 nums 和整数 k，返回第 k 个最大的元素。

**方法一：排序** — O(n log n)，最简单但不够快。

```java
public int findKthLargestSort(int[] nums, int k) {
    Arrays.sort(nums);
    return nums[nums.length - k];
}
```

**方法二：堆排序** — O(n log k)，更优。

```java
public int findKthLargestHeap(int[] nums, int k) {
    PriorityQueue<Integer> minHeap = new PriorityQueue<>();
    for (int num : nums) {
        minHeap.offer(num);
        if (minHeap.size() > k) minHeap.poll(); // 维护大小为 k 的小顶堆
    }
    return minHeap.peek(); // 堆顶就是第 k 大的元素
}
```

**方法三：快速选择（基于快排思想）** — 平均 O(n)，最坏 O(n²)。

```java
public int findKthLargest(int[] nums, int k) {
    int target = nums.length - k; // 转换为找第 target 小的元素
    return quickSelect(nums, 0, nums.length - 1, target);
}

private int quickSelect(int[] nums, int left, int right, int target) {
    int pivotIndex = partition(nums, left, right);
    if (pivotIndex == target) {
        return nums[pivotIndex];
    } else if (pivotIndex < target) {
        return quickSelect(nums, pivotIndex + 1, right, target);
    } else {
        return quickSelect(nums, left, pivotIndex - 1, target);
    }
}
```

**快速选择 vs 快排**：快排递归两边，快速选择只递归一边。

---

## 高频题四：合并区间

> 题目：给出一个无重叠的区间列表，合并所有重叠的区间。

```java
public int[][] merge(int[][] intervals) {
    if (intervals == null || intervals.length == 0) return new int[0][];
    // 按起点升序排序
    Arrays.sort(intervals, Comparator.comparingInt(a -> a[0]));
    List<int[]> merged = new ArrayList<>();
    int[] cur = intervals[0];
    for (int i = 1; i < intervals.length; i++) {
        if (cur[1] >= intervals[i][0]) {
            // 有重叠，合并（取最大的右边界）
            cur[1] = Math.max(cur[1], intervals[i][1]);
        } else {
            // 不重叠，当前区间加入结果
            merged.add(cur);
            cur = intervals[i];
        }
    }
    merged.add(cur);
    return merged.toArray(new int[0][]);
}
```

**时间复杂度 O(n log n)**（排序主导），空间复杂度 O(1)（原地合并）。

---

## 高频题五：颜色分类（荷兰国旗问题）

> 题目：给定一个包含红色（0）、白色（1）和蓝色（2）的数组，原地对它们进行排序。要求单趟遍历完成（O(n) 时间，O(1) 空间）。

```java
public void sortColors(int[] nums) {
    int left = 0, right = nums.length - 1, cur = 0;
    while (cur <= right) {
        if (nums[cur] == 0) {
            swap(nums, left, cur);
            left++;
            cur++; // left 换过来的要么是 1 要么是 0（因为 right 那边都是 2）
        } else if (nums[cur] == 2) {
            swap(nums, cur, right);
            right--; // cur 不动，因为换过来的可能是 0，需要重新判断
        } else {
            cur++;
        }
    }
}
```

**三指针**：left 左边全是 0，right 右边全是 2，cur 负责遍历。cur 不动时表示已经确认过，需要 cur++。

---

## 排序算法应用总结

面试中的排序题，往往不是单纯考排序，而是**利用排序的特性解决问题**：

| 题目特征 | 利用的排序特性 |
|----------|----------------|
| 合并重叠区间 | 按起点排序后线性扫描 |
| 颜色分类 | 已知范围用三路 partition |
| TopK | 堆或快速选择 |
| 第 K 大/小 | 快速选择 / 堆 |
| 有序矩阵搜索 | 行列各自有序 |
| 两数之和 | 排序后双指针 |

---

## 面试延伸问题

**Q：为什么快排比归并排序在实际中更常用？**

快排是原地排序（O(log n) 递归栈），而归并排序需要 O(n) 额外空间。虽然快排最坏 O(n²)，但通过随机化 pivot 可以避免。

**Q：什么情况下应该选择归并而不是快排？**

需要**稳定性**时（相等元素的相对顺序不能变），只能用归并。另外外部排序（数据量大无法一次性读入内存）只能用归并的分治思想。

---

## 总结

排序算法面试的核心要点：

1. **快速排序**：核心是 partition，理解「基准归位」的过程
2. **归并排序**：核心是 merge，理解「分治合并」的过程
3. **堆排序**：适合 TopK 问题，O(n log k) 最优
4. **快速选择**：找第 K 大/小，一次递归 O(n)
5. **三路划分**：颜色分类、荷兰国旗问题的经典模板

排序题的关键是**识别题目中隐藏的有序性**，然后选择合适的排序策略。
