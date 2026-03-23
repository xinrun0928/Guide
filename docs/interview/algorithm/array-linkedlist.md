# 数组与链表高频题：双指针、滑动窗口

> 数组和链表是最基础的数据结构，却撑起了面试算法题的半壁江山。真正的高手，用「双指针」和「滑动窗口」就能秒杀大部分这类题目。

## 为什么面试总考数组和链表

原因很简单：**它们足够简单，却又足够灵活**。

简单在于结构好理解，灵活在于解题思路多。双指针和滑动窗口，就是两种最通用的解题范式。


## 双指针：从两端向中间逼近

### 经典问题：两数之和 II（有序数组）

> 题目：输入一个升序数组和一个目标值，找出两个数使它们的和等于目标值。假设有且仅有唯一解。

**双指针解法：**

```java
public int[] twoSum(int[] numbers, int target) {
    int left = 0, right = numbers.length - 1;
    while (left < right) {
        int current = numbers[left] + numbers[right];
        if (current == target) {
            return new int[]{left + 1, right + 1}; // 1-indexed 返回
        } else if (current < target) {
            left++;  // 和太小，左指针右移，排除左边的数
        } else {
            right--; // 和太大，右指针左移，排除右边的数
        }
    }
    return new int[]{-1, -1};
}
```

**思路：** left 从小往大，right 从大往小。如果和太小，left 右移；如果和太大，right 左移。每次移动都跳过了一大批不可能的组合。时间复杂度 O(n)，空间复杂度 O(1)。

**追问：如果数组无序呢？** 用哈希表，时间复杂度同样是 O(n)，但空间复杂度变成 O(n)。


### 经典问题：移除元素

> 题目：给你一个数组 nums 和一个值 val，要求原地移除所有值等于 val 的元素，返回新长度。

**快慢指针：**

```java
public int removeElement(int[] nums, int val) {
    int slow = 0;
    for (int fast = 0; fast < nums.length; fast++) {
        if (nums[fast] != val) {
            nums[slow] = nums[fast]; // 不等于 val 的元素写到前面
            slow++;
        }
    }
    return slow; // slow 即为新长度
}
```

快指针负责遍历，慢指针负责写入。不等于 val 的元素被保留并前移，等于 val 的元素被跳过。


### 对撞指针：验证回文串

> 题目：判断一个字符串是否是回文串（忽略非字母数字字符，大小写不敏感）。

```java
public boolean isPalindrome(String s) {
    int left = 0, right = s.length() - 1;
    while (left < right) {
        // 跳过非字母数字
        while (left < right && !Character.isLetterOrDigit(s.charAt(left))) left++;
        while (left < right && !Character.isLetterOrDigit(s.charAt(right))) right--;
        // 不匹配则直接返回 false
        if (Character.toLowerCase(s.charAt(left)) != Character.toLowerCase(s.charAt(right))) {
            return false;
        }
        left++;
        right--;
    }
    return true;
}
```


## 滑动窗口：变长窗口的艺术

滑动窗口是双指针的进阶版。窗口大小是「可变」的——左边界和右边界分别移动，像一扇推拉的窗户。

### 经典问题：最大子序和

> 题目：给定一个整数数组，找出连续子数组的最大和。

```java
public int maxSubArray(int[] nums) {
    int maxSum = nums[0];
    int curSum = nums[0];
    for (int i = 1; i < nums.length; i++) {
        // 当前累加和如果是负数，只会拖累后面的和，重置起点
        curSum = Math.max(nums[i], curSum + nums[i]);
        maxSum = Math.max(maxSum, curSum);
    }
    return maxSum;
}
```

**当累积和变成负数时，重新从当前位置开始计数**，因为负数只会拖累后面的和。


### 经典问题：长度最小的子数组

> 题目：给定一个数组和一个目标值，找出最短的连续子数组，使得其和 >= 目标值。

```java
public int minSubArrayLen(int target, int[] nums) {
    int left = 0, curSum = 0, result = Integer.MAX_VALUE;
    for (int right = 0; right < nums.length; right++) {
        curSum += nums[right];
        // 收缩窗口：一直减到不满足条件为止
        while (curSum >= target) {
            result = Math.min(result, right - left + 1);
            curSum -= nums[left];
            left++;
        }
    }
    return result == Integer.MAX_VALUE ? 0 : result;
}
```

**窗口扩大（右移 right）** → **窗口收缩（左移 left）** → 循环往复。每次收缩时更新最小长度。


## 链表中的双指针

链表没有下标，只能靠指针遍历。双指针在链表里玩出了更多花样。

### 快慢指针找链表中点

```java
public ListNode middleNode(ListNode head) {
    ListNode slow = head, fast = head;
    // fast 走两步，slow 走一步，fast 到头时 slow 正好在中点
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
    }
    return slow;
}
```

如果链表有奇数个节点，slow 正好是中点；如果有偶数个，返回下中位点（靠右的那个）。

**进阶：找链表中点的前一个节点？**

让 fast 先走一步：`fast = head.next`，这样 slow 就是中点前一个。


### 判断环形链表

> 题目：判断链表是否有环。

快指针每次走两步，慢指针每次走一步。如果有环，它们一定会相遇。

```java
public boolean hasCycle(ListNode head) {
    ListNode slow = head, fast = head;
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) return true; // 相遇，说明有环
    }
    return false;
}
```

**为什么一定会相遇？** 想象两个人在环形跑道上跑，一个快一个慢——相对速度是 1，在有限的环上必定追上。


### 环形链表入口：进阶问题

> 题目：返回链表环的入口节点。如果没有环，返回 null。

```java
public ListNode detectCycle(ListNode head) {
    ListNode slow = head, fast = head;
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) {
            // 相遇后，从头节点重新出发，相遇点就是入口
            ListNode ptr = head;
            while (ptr != slow) {
                ptr = ptr.next;
                slow = slow.next;
            }
            return ptr;
        }
    }
    return null;
}
```

**数学推导：** 设从头到入口距离为 F，环长为 C，相遇时慢指针走了 F + a，快指针走了 F + a + nC。两倍关系：`2(F + a) = F + a + nC`，所以 `F = nC - a`。即从相遇点走到入口的距离，等于从头走到入口的距离——所以两指针分别从相遇点和头节点出发，一定在入口相遇。


## 双指针小结

| 题型 | 双指针类型 | 核心思想 |
|------|------------|----------|
| 两数之和 II | 对撞指针 | 两端逼近，逐步收敛 |
| 移除元素 | 快慢指针 | 遍历写入，跳过目标 |
| 验证回文串 | 对撞指针 | 两端对比，向中间靠拢 |
| 最大子序和 | 贪心双指针 | 负数和拖累，重置起点 |
| 最短子数组 | 滑动窗口 | 扩大右边界，收缩左边界 |
| 链表中点 | 快慢指针 | 快走两步，慢走一步 |
| 环形链表 | 快慢指针 | 同向追逐，必定相遇 |


## 练习建议

双指针的核心是**「减少不必要的遍历」**。每次移动指针时，问自己：这一步能跳过什么？

推荐刷题顺序：

1. **熟练阶段**：两数之和 II → 移除元素 → 链表中点 → 环形链表
2. **进阶阶段**：环形链表入口 → 最短子数组 → 最大子序和
3. **挑战阶段**：三数之和（去重优化）→ 接雨水（双指针 + 单调栈）

双指针真正掌握之后，你会发现大多数数组和链表题目，都在你的射程之内。
