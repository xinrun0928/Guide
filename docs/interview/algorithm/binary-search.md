# 二分查找高频题：旋转数组、搜索区间

> 二分查找是面试中最容易拿满分的题目之一。代码短、思路清晰、边界条件多是它的特点。很多人觉得简单，但真正写对的人不到一半。

## 二分查找的本质

二分查找的前提：**有序数组 + 单一目标**。

核心思想：每次将搜索范围缩小一半，O(log n) 级别。

**最容易出错的地方**：边界条件——`left < right` 还是 `left <= right`？`mid = (left + right) >>> 1`？

---

## 标准二分查找

```java
public int binarySearch(int[] nums, int target) {
    int left = 0, right = nums.length - 1;
    while (left <= right) {
        int mid = left + ((right - left) >>> 1);
        if (nums[mid] == target) {
            return mid;
        } else if (nums[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    return -1;
}
```

**三个关键点**：
- `left <= right`（等于时也要比较）
- `mid = left + ((right - left) >>> 1)`（右移 1 位等于除以 2，逻辑右移防溢出）
- `left = mid + 1` / `right = mid - 1`（避免死循环）

---

## 高频题一：搜索旋转排序数组

> 题目：假设按照升序排序的数组在某个点上进行了旋转（例如 [0,1,2,4,5,6,7] 变成 [4,5,6,7,0,1,2]）。在 O(log n) 时间复杂度内找到目标。

**关键发现**：旋转数组总有一半是严格升序的。

```java
public int search(int[] nums, int target) {
    int left = 0, right = nums.length - 1;
    while (left <= right) {
        int mid = left + ((right - left) >>> 1);
        if (nums[mid] == target) return mid;
        // 左半边是升序的（[left, mid] 单调递增）
        if (nums[left] <= nums[mid]) {
            // target 在左半边范围内
            if (nums[left] <= target && target < nums[mid]) {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        } else {
            // 右半边是升序的
            if (nums[mid] < target && target <= nums[right]) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
    }
    return -1;
}
```

**判断哪半边有序**：只需看 `nums[left]` 和 `nums[mid]` 的关系。

---

## 高频题二：寻找旋转排序数组的最小值

> 题目：假设一个按升序旋转的数组（无重复元素），找到数组的最小元素。

```java
public int findMin(int[] nums) {
    int left = 0, right = nums.length - 1;
    while (left < right) { // 注意：不是 <=，因为 left==right 时就是答案
        int mid = left + ((right - left) >>> 1);
        if (nums[mid] > nums[right]) {
            // 最小值在右半边
            left = mid + 1;
        } else {
            // nums[mid] <= nums[right]，最小值在左半边（含 mid）
            right = mid;
        }
    }
    return nums[left];
}
```

**关键判断**：`nums[mid] > nums[right]` 说明最小值在右边，`nums[mid] <= nums[right]` 说明最小值在左边或就是 mid。

---

## 高频题三：寻找峰值

> 题目：峰值指一个大于其邻居的元素。假设 nums[-1] = nums[n] = -∞。找到任意一个峰值并返回其索引。

```java
public int findPeakElement(int[] nums) {
    int left = 0, right = nums.length - 1;
    while (left < right) {
        int mid = left + ((right - left) >>> 1);
        // 如果中间值大于右侧，说明峰值在左边（含中间）
        if (nums[mid] > nums[mid + 1]) {
            right = mid;
        } else {
            // 上升趋势，峰值在右边
            left = mid + 1;
        }
    }
    return left;
}
```

---

## 高频题四：在排序数组中查找元素的第一个和最后一个位置

> 题目：给定一个升序数组，找出目标值在数组中的开始位置和结束位置。如果不存在，返回 [-1, -1]。要求 O(log n)。

**思路：分别找左边界和右边界**

```java
public int[] searchRange(int[] nums, int target) {
    return new int[]{findBound(nums, target, true),
                     findBound(nums, target, false)};
}

private int findBound(int[] nums, int target, boolean findFirst) {
    int left = 0, right = nums.length - 1;
    int bound = -1;
    while (left <= right) {
        int mid = left + ((right - left) >>> 1);
        if (nums[mid] == target) {
            bound = mid;
            if (findFirst) {
                right = mid - 1; // 找左边界：继续往左找
            } else {
                left = mid + 1;  // 找右边界：继续往右找
            }
        } else if (nums[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    return bound;
}
```

---

## 二分查找的边界问题总结

| 条件 | 退出条件 | 收缩方向 | 适用场景 |
|------|----------|----------|----------|
| `left <= right` | `left > right` | `left = mid + 1` / `right = mid - 1` | 标准二分 |
| `left < right` | `left == right` | `left = mid + 1` / `right = mid` | 极值问题 |
| `left + 1 < right` | 相邻时退出 | 逐步缩小 | 最近邻居 |

---

## 面试延伸问题

**Q：二分查找最怕什么？**

整数溢出。特别是在 Java/C++ 中，如果用 `mid = (left + right) / 2`，left + right 可能超过 int 范围。正确的写法是 `mid = left + ((right - left) >>> 1)`。

**Q：如何判断一道题能不能用二分？**

两个条件：
1. **有序或半有序**：数组本身有序，或者可以通过变换（如旋转）变成有序
2. **单调性**：存在一个判断条件，使得一半满足、一半不满足

**Q：二分查找的变体有哪些？**

| 变体 | 特点 |
|------|------|
| 标准二分 | 找任意一个等于 target 的位置 |
| 左边界 | 找第一个 >= target 的位置 |
| 右边界 | 找最后一个 <= target 的位置 |
| 旋转数组 | 判断哪一半有序 |
| 二维矩阵 | 从角落出发 |

---

## 总结

二分查找的套路很固定，但细节决定成败：

```java
while (left < right) { // 还是 <= ?
    mid = left + ((right - left) >>> 1); // 防溢出
    if (isCondition(mid)) {
        right = mid;    // 还是 mid - 1 ?
    } else {
        left = mid + 1;
    }
}
return left; // 返回哪个？
```

记住三个原则：
1. **等于就返回**：找到目标立刻返回
2. **半段有序**：旋转数组每次有一半是升序的
3. **收缩要正确**：`mid ± 1` 而不是 `mid`，避免死循环

写完代码后，用 `[3,4,5,1,2]` 和 `[4,5,6,1,2]` 两组数据手工跑一遍，基本就能验证正确性。
