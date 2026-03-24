# 算法高频面试题汇总


## 为什么刷题还是会挂？

很多人刷了 300 道 LeetCode，面试遇到变体题还是懵。

问题不在于刷题数量，而在于**没有形成体系**。

今天，我把算法面试的高频题型整理成册，帮你把零散的知识点串成线，让你在面试中游刃有余。


## 一、数组与链表

### 经典题目

**1. 两数之和（LeetCode 1）**

```java
public int[] twoSum(int[] nums, int target) {
    Map&lt;Integer, Integer&gt; map = new HashMap&lt;&gt;();
    for (int i = 0; i < nums.length; i++) {
        int complement = target - nums[i];
        if (map.containsKey(complement)) {
            return new int[]{map.get(complement), i};
        }
        map.put(nums[i], i);
    }
    return new int[0];
}
```

**2. 反转链表（LeetCode 206）**

```java
public ListNode reverseList(ListNode head) {
    ListNode prev = null, cur = head;
    while (cur != null) {
        ListNode next = cur.next;
        cur.next = prev;
        prev = cur;
        cur = next;
    }
    return prev;
}
```

**3. 合并两个有序链表（LeetCode 21）**

```java
public ListNode mergeTwoLists(ListNode l1, ListNode l2) {
    ListNode dummy = new ListNode(0);
    ListNode cur = dummy;
    
    while (l1 != null && l2 != null) {
        if (l1.val <= l2.val) {
            cur.next = l1;
            l1 = l1.next;
        } else {
            cur.next = l2;
            l2 = l2.next;
        }
        cur = cur.next;
    }
    cur.next = l1 != null ? l1 : l2;
    return dummy.next;
}
```

### 常考知识点

| 题型 | 关键点 |
|------|--------|
| 双指针 | 快慢指针、左右指针 |
| 滑动窗口 | 变长/定长窗口 |
| 前缀和 | 区间和、子数组问题 |
| 环形链表 | 快慢指针检测环 |


## 二、二叉树与图

### 经典题目

**1. 二叉树层序遍历（LeetCode 102）**

```java
public List&lt;List&lt;Integer&gt;&gt; levelOrder(TreeNode root) {
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    if (root == null) return result;
    
    Queue&lt;TreeNode&gt; queue = new LinkedList&lt;&gt;();
    queue.offer(root);
    
    while (!queue.isEmpty()) {
        int size = queue.size();
        List&lt;Integer&gt; level = new ArrayList&lt;&gt;();
        for (int i = 0; i < size; i++) {
            TreeNode node = queue.poll();
            level.add(node.val);
            if (node.left != null) queue.offer(node.left);
            if (node.right != null) queue.offer(node.right);
        }
        result.add(level);
    }
    return result;
}
```

**2. 验证二叉搜索树（LeetCode 98）**

```java
public boolean isValidBST(TreeNode root) {
    return validate(root, Long.MIN_VALUE, Long.MAX_VALUE);
}

private boolean validate(TreeNode node, long min, long max) {
    if (node == null) return true;
    if (node.val <= min || node.val >= max) return false;
    return validate(node.left, min, node.val) 
        && validate(node.right, node.val, max);
}
```

**3. 最近公共祖先（LeetCode 236）**

```java
public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
    if (root == null || root == p || root == q) return root;
    
    TreeNode left = lowestCommonAncestor(root.left, p, q);
    TreeNode right = lowestCommonAncestor(root.right, p, q);
    
    if (left != null && right != null) return root;
    return left != null ? left : right;
}
```

### 常考知识点

| 题型 | 关键点 |
|------|--------|
| 遍历 | 前/中/后序遍历（递归/迭代） |
| 重建 | 前+中序、中+后序 |
| 路径 | DFS 路径总和 |
| 序列化 | 前序遍历 + 标记 |


## 三、动态规划

### 经典题目

**1. 爬楼梯（LeetCode 70）**

```java
public int climbStairs(int n) {
    if (n <= 2) return n;
    int a = 1, b = 2;
    for (int i = 3; i <= n; i++) {
        int c = a + b;
        a = b;
        b = c;
    }
    return b;
}
```

**2. 背包问题（LeetCode 416）**

```java
public boolean canPartition(int[] nums) {
    int sum = Arrays.stream(nums).sum();
    if (sum % 2 != 0) return false;
    
    int target = sum / 2;
    boolean[] dp = new boolean[target + 1];
    dp[0] = true;
    
    for (int num : nums) {
        for (int i = target; i >= num; i--) {
            dp[i] = dp[i] || dp[i - num];
        }
    }
    return dp[target];
}
```

**3. 最长公共子序列（LeetCode 1143）**

```java
public int longestCommonSubsequence(String text1, String text2) {
    int m = text1.length(), n = text2.length();
    int[][] dp = new int[m + 1][n + 1];
    
    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            if (text1.charAt(i - 1) == text2.charAt(j - 1)) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    return dp[m][n];
}
```

### 常考知识点

| 题型 | 状态定义 |
|------|----------|
| 线性 DP | dp[i] = 前 i 个... |
| 区间 DP | dp[i][j] = [i,j] 区间内... |
| 背包问题 | dp[i][j] = 前 i 个物品，容量 j |
| 树形 DP | 在树上做 DP |


## 四、回溯与递归

### 经典题目

**1. 全排列（LeetCode 46）**

```java
public List&lt;List&lt;Integer&gt;&gt; permute(int[] nums) {
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    backtrack(result, new ArrayList&lt;&gt;(), nums, new boolean[nums.length]);
    return result;
}

private void backtrack(List&lt;List&lt;Integer&gt;&gt; result, List&lt;Integer&gt; path, 
                       int[] nums, boolean[] used) {
    if (path.size() == nums.length) {
        result.add(new ArrayList&lt;&gt;(path));
        return;
    }
    
    for (int i = 0; i < nums.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        path.add(nums[i]);
        backtrack(result, path, nums, used);
        path.remove(path.size() - 1);
        used[i] = false;
    }
}
```

**2. 子集（LeetCode 78）**

```java
public List&lt;List&lt;Integer&gt;&gt; subsets(int[] nums) {
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    subsetsDFS(result, new ArrayList&lt;&gt;(), nums, 0);
    return result;
}

private void subsetsDFS(List&lt;List&lt;Integer&gt;&gt; result, List&lt;Integer&gt; path, 
                        int[] nums, int start) {
    result.add(new ArrayList&lt;&gt;(path));
    for (int i = start; i < nums.length; i++) {
        path.add(nums[i]);
        subsetsDFS(result, path, nums, i + 1);
        path.remove(path.size() - 1);
    }
}
```

**3. N 皇后（LeetCode 51）**

```java
public List&lt;List&lt;String&gt;&gt; solveNQueens(int n) {
    List&lt;List&lt;String&gt;&gt; result = new ArrayList&lt;&gt;();
    int[] queens = new int[n];
    solve(result, queens, n, 0);
    return result;
}

private void solve(List&lt;List&lt;String&gt;&gt; result, int[] queens, int n, int row) {
    if (row == n) {
        result.add(formatBoard(queens));
        return;
    }
    
    for (int col = 0; col < n; col++) {
        if (isValid(queens, row, col)) {
            queens[row] = col;
            solve(result, queens, n, row + 1);
        }
    }
}

private boolean isValid(int[] queens, int row, int col) {
    for (int i = 0; i < row; i++) {
        int qCol = queens[i];
        if (qCol == col) return false;
        if (Math.abs(row - i) == Math.abs(col - qCol)) return false;
    }
    return true;
}
```


## 五、排序与查找

### 经典题目

**1. 快速排序实现**

```java
public void quickSort(int[] arr, int left, int right) {
    if (left >= right) return;
    
    int pivotIndex = partition(arr, left, right);
    quickSort(arr, left, pivotIndex - 1);
    quickSort(arr, pivotIndex + 1, right);
}

private int partition(int[] arr, int left, int right) {
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
```

**2. 二分查找变体**

```java
// 查找第一个 >= target 的位置
public int lowerBound(int[] arr, int target) {
    int left = 0, right = arr.length;
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    return left;
}
```

**3. 合并区间（LeetCode 56）**

```java
public int[][] merge(int[][] intervals) {
    if (intervals.length == 0) return new int[0][];
    
    Arrays.sort(intervals, Comparator.comparingInt(a -> a[0]));
    List&lt;int[]&gt; result = new ArrayList&lt;&gt;();
    int[] cur = intervals[0];
    
    for (int i = 1; i < intervals.length; i++) {
        if (cur[1] >= intervals[i][0]) {
            cur[1] = Math.max(cur[1], intervals[i][1]);
        } else {
            result.add(cur);
            cur = intervals[i];
        }
    }
    result.add(cur);
    return result.toArray(new int[0][]);
}
```


## 六、常见算法思想

| 思想 | 核心问题 |
|------|----------|
| 双指针 | 两数之和、滑动窗口、链表环 |
| 二分查找 | 有序数组查找、旋转数组 |
| 哈希表 | 去重、快速查找 |
| 堆 | Top K、中位数、流数据 |
| 回溯 | 全排列、子集、N皇后 |
| 动态规划 | 最优子结构、状态转移 |
| 分治 | 归并排序、分治 + 合并 |
| 贪心 | 区间调度、哈夫曼编码 |


## 七、面试技巧

### 1. 五分钟思考法

1. **2 分钟**：理解题意，确认边界条件和特殊情况
2. **2 分钟**：想思路（暴力解法 → 优化）
3. **1 分钟**：选择最优解，准备代码框架

### 2. 复杂度分析

面试官问「时间和空间复杂度」，要能快速回答：
- 数组：O(1) 或 O(n)
- 链表：遍历 O(n)
- 树/图：遍历 O(V+E)
- 排序：O(n log n) 或 O(n)
- 哈希表：平均 O(1)，最坏 O(n)

### 3. 代码规范

- 变量命名清晰
- 关键逻辑加注释
- 边界条件处理完整
- 异常情况返回合理值

### 4. 追问预判

面试官可能会追问：
- 如何优化？（空间换时间、预处理、缓存）
- 如果数据更大怎么办？（外部排序、分布式）
- 这个算法有什么局限性？（时间复杂度、空间限制）


## 总结

算法面试的核心是**思路 + 实现**：

1. **读懂题意**：确认输入输出、边界条件
2. **快速思路**：从暴力到优化的思考路径
3. **正确实现**：代码规范、逻辑清晰
4. **复杂度分析**：时间和空间都要考虑

记住，没有最好的算法，只有最适合的算法。理解每个算法的适用场景，才能在面试中游刃有余。

## 面试追问方向

- 如何在 O(1) 空间内实现归并排序？（原地归并很难，一般需要额外空间）
- 哈希表和有序数组的时间复杂度对比？（哈希 O(1) 但无序，有序数组 O(log n) 但有序）
- 什么情况下快速排序比归并排序更快？（数据随机、缓存友好）
- 如何检测链表是否有环？（快慢指针，相遇即有环）
- 如何在大数据中找中位数？（两个堆，或分治）
