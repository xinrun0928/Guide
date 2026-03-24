# 二分查找及其变体


## 为什么二分查找如此重要？

你一定用过 Google 搜索。

输入关键词，按下回车——几毫秒内，Google 从几十亿个网页中找到了你需要的结果。

它是怎么做到的？

答案就是**二分查找**（Binary Search）——每次把搜索范围缩小一半。

这就是算法的力量：**让 O(n) 变成 O(log n)**。


## 二分查找基础

### 算法思想

**在有序数组中，每次把搜索范围缩小一半**。

```
有序数组: [1, 3, 5, 7, 9, 11, 13, 15]
查找目标: 7

第1步: left=0, right=7, mid=3
       arr[3]=7 == 7, 找到！返回 3

查找目标: 6

第1步: left=0, right=7, mid=3
       arr[3]=7 > 6, 目标在左半部分
第2步: left=0, right=2, mid=1
       arr[1]=3 < 6, 目标在右半部分
第3步: left=2, right=2, mid=2
       arr[2]=5 < 6, 目标在右半部分
第4步: left=3 > right=2, 结束，未找到
```

### Java 实现

```java
public int binarySearch(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    
    while (left <= right) {
        int mid = left + (right - left) / 2;  // 防止溢出
        
        if (arr[mid] == target) {
            return mid;
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    
    return -1;  // 未找到
}
```

### 复杂度分析

- **时间复杂度**：O(log n)
- **空间复杂度**：O(1)


## 二分查找的四大变体

### 变体一：查找第一个等于目标的位置

```java
public int findFirst(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    int result = -1;
    
    while (left <= right) {
        int mid = left + (right - left) / 2;
        
        if (arr[mid] == target) {
            result = mid;
            right = mid - 1;  // 继续向左找
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    
    return result;
}
```

### 变体二：查找最后一个等于目标的位置

```java
public int findLast(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    int result = -1;
    
    while (left <= right) {
        int mid = left + (right - left) / 2;
        
        if (arr[mid] == target) {
            result = mid;
            left = mid + 1;  // 继续向右找
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    
    return result;
}
```

### 变体三：查找第一个大于等于目标的位置

```java
public int findFirstGreaterOrEqual(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    int result = -1;
    
    while (left <= right) {
        int mid = left + (right - left) / 2;
        
        if (arr[mid] >= target) {
            result = mid;
            right = mid - 1;  // 继续向左找
        } else {
            left = mid + 1;
        }
    }
    
    return result;
}
```

### 变体四：查找最后一个小于等于目标的位置

```java
public int findLastLessOrEqual(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    int result = -1;
    
    while (left <= right) {
        int mid = left + (right - left) / 2;
        
        if (arr[mid] <= target) {
            result = mid;
            left = mid + 1;  // 继续向右找
        } else {
            right = mid - 1;
        }
    }
    
    return result;
}
```


## 变体对比

| 变体 | 条件 | 找到目标后 |
|------|------|-----------|
| 普通二分 | arr[mid] == target | 返回 mid |
| 第一个等于 | arr[mid] == target | result=mid, right=mid-1 |
| 最后一个等于 | arr[mid] == target | result=mid, left=mid+1 |
| 第一个大于等于 | arr[mid] >= target | result=mid, right=mid-1 |
| 最后一个小于等于 | arr[mid] <= target | result=mid, left=mid+1 |


## 经典应用

### 1. 旋转数组查找

LeetCode 33：搜索旋转排序数组

```java
public int searchRotated(int[] nums, int target) {
    int left = 0, right = nums.length - 1;
    
    while (left <= right) {
        int mid = left + (right - left) / 2;
        
        if (nums[mid] == target) {
            return mid;
        }
        
        // 左半部分有序
        if (nums[left] <= nums[mid]) {
            if (nums[left] <= target && target < nums[mid]) {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        // 右半部分有序
        else {
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

### 2. 寻找峰值

LeetCode 162：寻找峰值

```java
public int findPeakElement(int[] nums) {
    int left = 0, right = nums.length - 1;
    
    while (left < right) {
        int mid = left + (right - left) / 2;
        
        if (nums[mid] > nums[mid + 1]) {
            // 峰值在左半部分
            right = mid;
        } else {
            // 峰值在右半部分
            left = mid + 1;
        }
    }
    
    return left;
}
```

### 3. 寻找旋转数组的最小值

```java
public int findMin(int[] nums) {
    int left = 0, right = nums.length - 1;
    
    while (left < right) {
        int mid = left + (right - left) / 2;
        
        if (nums[mid] > nums[right]) {
            // 最小值在右半部分
            left = mid + 1;
        } else {
            // 最小值在左半部分（包括 mid）
            right = mid;
        }
    }
    
    return nums[left];
}
```


## 二分答案

**二分答案**是二分查找的高级应用：当答案在一个范围内，且可以用单调性函数判断时使用。

### 典型问题：分割数组的最大值

LeetCode 410：给定 m 个子数组，找到最大子数组和的最小值。

```java
public int splitArray(int[] nums, int m) {
    long left = 0, right = 0;
    for (int num : nums) {
        left = Math.max(left, num);  // 至少是最大元素
        right += num;  // 最多是所有元素的和
    }
    
    while (left < right) {
        long mid = left + (right - left) / 2;
        
        // 判断：能否分成不超过 m 个子数组，且每个子数组和 <= mid
        if (canSplit(nums, m, mid)) {
            right = mid;
        } else {
            left = mid + 1;
        }
    }
    
    return (int) left;
}

private boolean canSplit(int[] nums, int m, long maxSum) {
    int count = 1;
    long sum = 0;
    
    for (int num : nums) {
        sum += num;
        if (sum > maxSum) {
            count++;
            sum = num;
            if (count > m) return false;
        }
    }
    
    return true;
}
```


## 总结

二分查找的核心是**利用有序性，每次排除一半的错误答案**。

四大变体的关键区别：

1. **找第一个**：找到后继续向左找
2. **找最后一个**：找到后继续向右找
3. **找第一个大于等于**：用 `>=` 条件，找后继续向左
4. **找最后一个小于等于**：用 `<=` 条件，找后继续向右

**二分答案**是一种强大的技巧，当答案具有单调性时，可以把「最优值查找」转化为「可行性判断」。

## 面试追问方向

- 二分查找为什么用 `left + (right - left) / 2` 而不是 `(left + right) / 2`？（防止整数溢出）
- 二分查找的循环条件是 `left <= right` 还是 `left < right`？（取决于具体变体）
- 如果数组中有重复元素，如何找到第一个等于目标的位置？
- 什么是二分答案？什么时候用？（答案在某个范围内，且可以用单调函数判断）
- 旋转数组查找的思路是什么？（判断哪半部分有序）
