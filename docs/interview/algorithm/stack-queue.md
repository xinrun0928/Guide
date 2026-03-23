# 栈与队列高频题：有效括号、单调栈

> 栈和队列，一个后进先出（LIFO），一个先进先出（FIFO）。它们是最简单、最直觉的数据结构，却能解决很多看似复杂的问题。

## 栈的本质：撤销与回溯

栈的核心场景是**「需要知道上一个状态」**的操作。比如：

- 编辑器的撤销（Ctrl+Z）→ 用栈记录操作历史
- 函数调用栈 → 记录调用层级
- 浏览器的前进 / 后退 → 用两个栈实现


## 高频题一：有效的括号

> 题目：给定一个只包含 `(`, `)`, `{`, `}`, `[`, `]` 的字符串，判断括号是否有效。

**栈解法：遍历字符串，左括号入栈，右括号匹配栈顶。**

```java
public boolean isValid(String s) {
    Deque<Character> stack = new ArrayDeque<>();
    Map<Character, Character> mapping = Map.of(')', '(', '}', '{', ']', '[');
    for (char c : s.toCharArray()) {
        if (mapping.containsKey(c)) {
            // 右括号：栈为空或栈顶不匹配则失败
            if (stack.isEmpty() || stack.pop() != mapping.get(c)) {
                return false;
            }
        } else {
            stack.push(c); // 左括号入栈
        }
    }
    return stack.isEmpty(); // 栈为空说明全部匹配
}
```

**核心思路**：遇到左括号就入栈，遇到右括号就检查栈顶。遍历结束后，栈为空说明全部匹配。


## 高频题二：每日温度（单调栈模板）

> 题目：给定每天的温度数组 T，返回一个数组 ans，其中 ans[i] 是第 i 天之后需要等多少天才能等到更高的温度。如果不存在，返回 0。

这是单调栈的经典应用。

```java
public int[] dailyTemperatures(int[] temperatures) {
    int n = temperatures.length;
    int[] answer = new int[n];
    Deque<Integer> stack = new ArrayDeque<>(); // 存放下标，栈内温度单调递增
    for (int i = 0; i < n; i++) {
        // 当前温度比栈顶高，说明栈顶等到了答案
        while (!stack.isEmpty() && temperatures[i] > temperatures[stack.peek()]) {
            int prevIndex = stack.pop();
            answer[prevIndex] = i - prevIndex;
        }
        stack.push(i);
    }
    return answer;
}
```

**单调栈的核心思想**：维护一个递增栈（存放下标），当前元素比栈顶大时，栈顶元素「等到」了比它更大的温度，出栈并计算距离。


## 单调栈通用模板

单调栈能解决的问题都有一个共同特征：**求每个元素「下一个更大 / 更小元素」**。

```java
public int[] nextGreaterElement(int[] nums) {
    int n = nums.length;
    int[] result = new int[n];
    Deque<Integer> stack = new ArrayDeque<>(); // 存放下标
    Arrays.fill(result, -1);
    for (int i = 0; i < n; i++) {
        // 当前 > 栈顶时，栈顶元素的下一个更大元素就是当前元素
        while (!stack.isEmpty() && nums[i] > nums[stack.peek()]) {
            result[stack.pop()] = nums[i];
        }
        stack.push(i);
    }
    return result;
}
```

**变形**：
- 找「下一个更小元素」：条件改为 `nums[i] < nums[stack.peek()]`
- 找「前一个更大元素」：从右往左遍历


## 高频题三：柱状图中最大的矩形

> 题目：给定 n 个非负整数表示柱状图的高度，每个柱子的宽度为 1，求其中能勾勒出的最大矩形的面积。

```java
public int largestRectangleArea(int[] heights) {
    // 两端加哨兵，省去最后清算栈内元素的步骤
    int[] extended = new int[heights.length + 2];
    System.arraycopy(heights, 0, extended, 1, heights.length);
    Deque<Integer> stack = new ArrayDeque<>();
    stack.push(0);
    int maxArea = 0;
    for (int i = 1; i < extended.length; i++) {
        while (extended[i] < extended[stack.peek()]) {
            int h = extended[stack.pop()];
            // 栈顶现在是左边界，i 是右边界，减 1 得到宽度
            int w = i - stack.peek() - 1;
            maxArea = Math.max(maxArea, h * w);
        }
        stack.push(i);
    }
    return maxArea;
}
```

**核心思想**：维护一个递增的高度栈。当遇到比栈顶更低的柱子时，说明栈顶柱子遇到了「左右第一个比它更低的边界」，可以计算以它为高度的矩形最大宽度。


## 高频题四：滑动窗口最大值

> 题目：给定一个数组 nums 和一个窗口大小 k，输出每个滑动窗口的最大值。

**单调队列**：维护一个**单调递减**的队列（存放下标），队头永远是当前窗口最大值。

```java
public int[] maxSlidingWindow(int[] nums, int k) {
    if (nums == null || nums.length == 0) return new int[0];
    int[] result = new int[nums.length - k + 1];
    Deque<Integer> deque = new ArrayDeque<>();
    int resultIndex = 0;

    for (int i = 0; i < nums.length; i++) {
        // 移除超出窗口的索引
        while (!deque.isEmpty() && deque.peek() <= i - k) {
            deque.poll();
        }
        // 移除比当前元素小的索引——它们在当前窗口内永远不可能是最大值
        while (!deque.isEmpty() && nums[deque.peekLast()] <= nums[i]) {
            deque.pollLast();
        }
        deque.offer(i);
        // 窗口形成后开始记录
        if (i >= k - 1) {
            result[resultIndex++] = nums[deque.peek()];
        }
    }
    return result;
}
```

**时间复杂度 O(n)**：每个元素最多入队出队各一次。


## 栈与队列小结

| 题型 | 数据结构 | 时间复杂度 | 核心思想 |
|------|----------|------------|----------|
| 有效括号 | 栈 | O(n) | 左括号入栈，右括号匹配栈顶 |
| 每日温度 | 单调栈 | O(n) | 递增栈，当前 > 栈顶时栈顶出栈得答案 |
| 最大矩形 | 单调栈 | O(n) | 递增栈，遇更矮柱时栈顶得边界，计算最大面积 |
| 滑动窗口最大值 | 单调队列 | O(n) | 递减队列，队头是当前窗口最大 |


## 面试延伸问题

**Q：什么时候用栈，什么时候用队列？**

- **栈**：需要「回溯」「撤销」「嵌套结构匹配」时
- **队列**：需要「先来先服务」「BFS 遍历」时
- **单调栈**：求「每个元素下一个更大 / 更小」时
- **单调队列**：求「滑动窗口最值」时

**Q：单调栈的空间复杂度？** 最坏 O(n)，例如数组严格递增时，所有元素都压在栈里。


## 练习建议

栈和队列的题目，最难的不是写代码，而是**识别题型**。

记住三个关键模式：
1. **括号匹配** → 普通栈
2. **下一个更大 / 更小** → 单调栈
3. **滑动窗口最值** → 单调队列

刷透这三类，面试中栈和队列的题目就不会失分。
