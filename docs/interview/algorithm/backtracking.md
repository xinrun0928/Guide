# 回溯高频题：全排列、组合、N 皇后

> 回溯是「搜索 + 撤销选择」的过程，本质是一种有剪枝的深度优先搜索（DFS）。它解决的问题都有一个共同特征：**在多个选择中做决策，最终找出所有满足条件的组合**。

## 回溯的本质

回溯的伪代码模板：

```java
void backtrack(路径, 选择列表) {
    if (满足结束条件) {
        result.add(路径);
        return;
    }
    for (选择 in 选择列表) {
        if (满足剪枝条件) continue;
        做选择;
        backtrack(路径 + [选择], ...);
        撤销选择; // 核心：回溯
    }
}
```

---

## 高频题一：全排列

> 题目：给定一个不含重复数字的数组，返回其所有可能的全排列。

```java
public List<List<Integer>> permute(int[] nums) {
    List<List<Integer>> result = new ArrayList<>();
    backtrack(new ArrayList<>(), nums, new boolean[nums.length], result);
    return result;
}

private void backtrack(List<Integer> path, int[] nums,
                       boolean[] used, List<List<Integer>> result) {
    if (path.size() == nums.length) {
        result.add(new ArrayList<>(path));
        return;
    }
    for (int i = 0; i < nums.length; i++) {
        if (used[i]) continue; // 已经在当前路径中，跳过
        used[i] = true;
        path.add(nums[i]);
        backtrack(path, nums, used, result);
        path.remove(path.size() - 1); // 撤销选择
        used[i] = false;
    }
}
```

**关键点**：`used[i]` 标记 nums[i] 是否已在当前路径中（避免重复选择），`path.remove()` + `used[i] = false` 完成回溯。

---

## 高频题二：全排列 II（含重复元素）

> 题目：给定一个可包含重复数字的序列，返回所有不重复的全排列。

**去重策略**：同一层不能选相同的数字（分支去重），同一路径选相同数字是允许的。

```java
public List<List<Integer>> permuteUnique(int[] nums) {
    Arrays.sort(nums); // 先排序，便于去重
    List<List<Integer>> result = new ArrayList<>();
    backtrack(new ArrayList<>(), nums, new boolean[nums.length], result);
    return result;
}

private void backtrack(List<Integer> path, int[] nums,
                       boolean[] used, List<List<Integer>> result) {
    if (path.size() == nums.length) {
        result.add(new ArrayList<>(path));
        return;
    }
    for (int i = 0; i < nums.length; i++) {
        if (used[i]) continue;
        // 剪枝：同一层相同数字只选第一个
        // i > 0（不是第一个）+ nums[i]==nums[i-1]（和前一个相同）
        // + !used[i-1]（前一个在当前层还没被选，说明在前一个分支用过）
        if (i > 0 && nums[i] == nums[i - 1] && !used[i - 1]) continue;

        used[i] = true;
        path.add(nums[i]);
        backtrack(path, nums, used, result);
        path.remove(path.size() - 1);
        used[i] = false;
    }
}
```

---

## 高频题三：组合

> 题目：给定两个整数 n 和 k，返回所有可能的 k 个数的组合。

**组合 vs 排列**：组合不在乎顺序，`[1,2]` 和 `[2,1]` 是同一个结果。

```java
public List<List<Integer>> combine(int n, int k) {
    List<List<Integer>> result = new ArrayList<>();
    backtrack(1, n, k, new ArrayList<>(), result);
    return result;
}

private void backtrack(int start, int n, int k,
                       List<Integer> path, List<List<Integer>> result) {
    if (path.size() == k) {
        result.add(new ArrayList<>(path));
        return;
    }
    for (int i = start; i <= n; i++) {
        path.add(i);
        backtrack(i + 1, n, k, path, result); // 从 i+1 开始，避免重复
        path.remove(path.size() - 1);
    }
}
```

---

## 高频题四：N 皇后

> 题目：在 n×n 的棋盘上放置 n 个皇后，使得它们互不攻击。返回所有解法。

N 皇后需要同时满足三个约束：
1. 同一行只能有一个皇后
2. 同一列只能有一个皇后
3. 同一对角线只能有一个皇后

```java
public List<List<String>> solveNQueens(int n) {
    List<List<String>> result = new ArrayList<>();
    char[][] board = new char[n][n];
    for (char[] row : board) Arrays.fill(row, '.');
    backtrack(board, 0, result);
    return result;
}

private void backtrack(char[][] board, int row,
                       List<List<String>> result) {
    if (row == board.length) {
        result.add(construct(board));
        return;
    }
    for (int col = 0; col < board.length; col++) {
        if (!isValid(board, row, col)) continue; // 剪枝：不符合约束就跳过
        board[row][col] = 'Q';
        backtrack(board, row + 1, result);
        board[row][col] = '.'; // 撤销选择
    }
}

// 只需检查当前行上方的列和对角线（下面的行还没放皇后）
private boolean isValid(char[][] board, int row, int col) {
    for (int i = 0; i < row; i++) {
        if (board[i][col] == 'Q') return false; // 列冲突
    }
    for (int i = row - 1, j = col - 1; i >= 0 && j >= 0; i--, j--) {
        if (board[i][j] == 'Q') return false; // 左上对角线
    }
    for (int i = row - 1, j = col + 1; i >= 0 && j < board.length; i--, j++) {
        if (board[i][j] == 'Q') return false; // 右上对角线
    }
    return true;
}

private List<String> construct(char[][] board) {
    List<String> list = new ArrayList<>();
    for (char[] row : board) list.add(new String(row));
    return list;
}
```

---

## 回溯剪枝策略

回溯的性能瓶颈在于**搜索空间太大**，剪枝是优化的关键：

| 剪枝策略 | 适用场景 |
|----------|----------|
| **已访问标记** | 全排列、组合 |
| **同层去重** | 含重复元素的排列 |
| **约束检查** | N 皇后、数独 |
| **排序预处理** | 便于去重和剪枝 |

---

## 回溯 vs DFS vs BFS

| 维度 | 回溯 | DFS | BFS |
|------|------|-----|-----|
| 数据结构 | 栈（隐式） | 栈（显式/隐式） | 队列 |
| 核心思想 | 走不通就退回 | 深入一条路 | 逐层展开 |
| 记忆 | 撤销选择 | 不撤销 | 不撤销 |
| 适用场景 | 决策树、组合 | 连通性、拓扑 | 最短路径、层序 |

---

## 面试延伸问题

**Q：回溯的时间复杂度怎么算？**

回溯是指数级别的，时间复杂度通常是 **O(k^n)**，其中 k 是每个节点的分支数，n 是深度。但通过剪枝可以大幅减少。

**Q：什么时候用回溯，什么时候用 DP？**

- **回溯**：求所有解、穷举所有可能 → 组合 / 排列 / 子集
- **DP**：求最优解、子问题可复用 → 背包 / 股票 / 路径

一个简单判断：**如果需要列出所有可能的答案 → 回溯；如果只需要最值 → DP**。

---

## 总结

回溯的核心框架：

```java
void backtrack(路径, 选择列表) {
    if (满足结束条件) { result.add(路径); return; }
    for (选择 in 选择列表) {
        做选择;
        backtrack(路径 + [选择], ...);
        撤销选择;
    }
}
```

记住四类经典题型的模板：
1. **全排列**：used 数组标记已访问
2. **组合**：从 start 开始递增
3. **子集**：每个节点都记录结果
4. **N皇后**：约束检查 + 按行递归

回溯没有捷径，多画递归树，多练习，套路自然就清晰了。
