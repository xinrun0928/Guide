# 单调栈：Next Greater Element 系列

> 你有没有遇到过这种场景：给一个数组，要找每个元素右边第一个比它大的数。暴力 O(n²) 能做，但面试官会问——有没有更优雅的解法？

单调栈，就是这个「更优雅的解法」。它看起来平平无奇，却是算法题中的隐藏Boss。

---

## 为什么单调栈能「降维打击」

先思考一个问题：遍历数组时，每个元素只需要知道「右边第一个比它大的」，这个信息怎么利用？

想象一下：你从左到右看数组，维护一个「单调递增」的栈。当遇到一个新元素时：

- 如果它比栈顶大，说明栈顶元素的「右边第一个比它大的」找到了——就是这个新元素
- 如果它比栈顶小，说明栈顶还得继续等，把新元素压进去

这样一次遍历，所有元素的答案都出来了。

---

## 经典问题：Next Greater Element

> 题目：给定一个数组，返回一个新数组，其中每个位置的元素是原数组中该位置右边第一个比它大的元素，如果不存在则输出 -1。

```java
public int[] nextGreaterElement(int[] nums) {
    int n = nums.length;
    int[] result = new int[n];
    Arrays.fill(result, -1); // 默认-1，找不到就保持-1

    // 单调递增栈，存的是元素的下标
    Deque<Integer> stack = new LinkedList<>();

    for (int i = 0; i < n; i++) {
        // 栈不为空，且当前元素比栈顶大——栈顶的答案找到了
        while (!stack.isEmpty() && nums[i] > nums[stack.peek()]) {
            int index = stack.pop();
            result[index] = nums[i];
        }
        // 当前下标入栈
        stack.push(i);
    }
    return result;
}
```

**为什么这样设计？**

栈里存的是「等待答案」的元素下标。当前元素比栈顶大，说明栈顶等到了它的 Next Greater Element；如果当前元素比栈顶小，说明栈顶还得继续等——因为右边的元素更小，更不可能成为答案。

时间复杂度 O(n)，每个元素最多入栈出栈各一次。

---

## 进阶：循环数组的 Next Greater Element

> 题目：数组是环形的，即最后一个元素的右边是第一个元素。求每个元素的下一个更大元素。

这题的巧妙在于：**把数组复制一遍拼接在后面**。

```java
public int[] nextGreaterElements(int[] nums) {
    int n = nums.length;
    int[] result = new int[n];
    Arrays.fill(result, -1);

    Deque<Integer> stack = new LinkedList<>();
    // 遍历两遍：索引 i 从 0 到 2n-1，对 n 取模还原
    for (int i = 0; i < 2 * n; i++) {
        int num = nums[i % n];
        while (!stack.isEmpty() && nums[stack.peek()] < num) {
            int index = stack.pop();
            result[index] = num;
        }
        // 只在前 n 个元素入栈，防止重复入栈
        if (i < n) {
            stack.push(i);
        }
    }
    return result;
}
```

**为什么只让前 n 个元素入栈？**

第二遍遍历是为了「绕过环形」找到真正的下一个更大元素。如果第二遍也让元素入栈，会导致无限循环——元素永远等不到比它更大的元素（因为没有更大的了）。

---

## 更多变形：接雨水

> 题目：给定 n 个非负整数表示的高度，计算下雨后能接多少雨水。

这道题的双指针解法大家都熟悉，但单调栈提供了一个新视角：**按行/按列处理**。

```java
public int trap(int[] heights) {
    int n = heights.length;
    int result = 0;
    Deque<Integer> stack = new LinkedList<>();

    for (int i = 0; i < n; i++) {
        // 注意这里是 > 而不是 >=，保证同高时不凹进去
        while (!stack.isEmpty() && heights[i] > heights[stack.peek()]) {
            int h = heights[stack.pop()]; // 凹底高度
            if (stack.isEmpty()) break; // 左边没有墙了
            int left = stack.peek(); // 左墙下标
            int width = i - left - 1; // 两墙之间的距离
            int height = Math.min(heights[i], heights[left]) - h;
            result += width * height;
        }
        stack.push(i);
    }
    return result;
}
```

**按列算水的核心**：遇到一个凹槽（低-高-高），计算能存多少水 = 两墙距离 × (两边较低墙 - 凹底高度)。

---

## 变形图谱

| 题目 | 核心思想 |
|------|----------|
| 每日温度 | 单调栈存索引，答案是「距离」 |
| 柱状图中最大的矩形 | 单调栈找左右边界，枚举高度 |
| 下一个更大元素 I/II | 标准 Next Greater Element |
| 行星碰撞 | 单调栈模拟消除过程 |
| 去除重复字母 | 单调栈 + 计数，保证字典序最小 |

---

## 面试追问预判

1. **单调栈和单调队列有什么区别？**
   - 单调栈：求「下一个更大/更小元素」
   - 单调队列：求「滑动窗口最大值/最小值」
   - 两者都是维护单调性，但应用场景不同

2. **单调栈能解决「左边第一个更大」吗？**
   - 能。从右往左遍历即可，原理完全一样

3. **柱状图中最大矩形，怎么用单调栈优化？**
   - 以每个柱子的高度为基准，找它能向左向右扩展到多远
   - 单调递增栈保证栈顶高度始终是「当前遇到的最低高度」

---

## 记忆口诀

> **单调栈，排队等。**
> **比我大的来了，我就出栈找到家。**
> **比我小的来了，我就进栈继续等。**

掌握这个口诀，Next Greater Element 系列题，见招拆招。

---

## 练习建议

1. **入门**：每日温度 → 下一个更大元素 I
2. **进阶**：下一个更大元素 II → 接雨水
3. **挑战**：柱状图中最大的矩形 → 去除重复字母

单调栈的核心就两个字——**等**和**找**。等一个更大的元素出现，找自己的位置。
