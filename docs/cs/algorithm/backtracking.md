# 回溯算法：八皇后与全排列


## 试错的艺术

想象你站在迷宫入口，要找到出口。

你选择一条路，走到死胡同，退回来；再选另一条路，又走到死胡同，再退回来……直到找到出口。

这就是**回溯**（Backtracking）的核心思想：**走不通就退，退回来换一条路**。

回溯是解决「组合」「排列」「子集」「搜索」类问题的通用框架。掌握它，你就掌握了算法面试的半壁江山。


## 回溯的基本框架

```java
void backtrack(参数) {
    if (终止条件) {
        收集结果;
        return;
    }
    
    for (选择 : 当前可选的选项) {
        做选择;
        backtrack(下一层);
        撤销选择;  // 回溯的关键！
    }
}
```

**为什么叫回溯？**

因为每一步都有「撤销」操作——选择之后，还能退回去选择其他的。


## 经典问题一：八皇后

**问题**：在国际象棋棋盘（8×8）上放 8 个皇后，使得它们互不攻击（不在同一行、同一列、同一对角线）。

```java
public class EightQueens {
    private List&lt;List&lt;String&gt;&gt; solutions;
    
    public List&lt;List&lt;String&gt;&gt; solveNQueens(int n) {
        solutions = new ArrayList&lt;&gt;();
        int[] queens = new int[n];  // queens[i] = j 表示第 i 行皇后在第 j 列
        solve(queens, 0, n);
        return solutions;
    }
    
    private void solve(int[] queens, int row, int n) {
        // 终止条件：所有行都放了皇后
        if (row == n) {
            solutions.add(formatBoard(queens));
            return;
        }
        
        // 尝试在当前行的每一列放皇后
        for (int col = 0; col < n; col++) {
            if (isValid(queens, row, col)) {
                queens[row] = col;      // 放皇后
                solve(queens, row + 1, n);  // 递归下一行
                queens[row] = 0;        // 撤销（回溯）
            }
        }
    }
    
    // 判断在 (row, col) 放皇后是否有效
    private boolean isValid(int[] queens, int row, int col) {
        for (int i = 0; i < row; i++) {
            int j = queens[i];
            // 同一列
            if (j == col) return false;
            // 同一主对角线 (row - i == col - j)
            if (row - i == col - j) return false;
            // 同一副对角线 (row - i == j - col)
            if (row - i == j - col) return false;
        }
        return true;
    }
    
    // 格式化棋盘
    private List&lt;String&gt; formatBoard(int[] queens) {
        List&lt;String&gt; board = new ArrayList&lt;&gt;();
        for (int i = 0; i < queens.length; i++) {
            StringBuilder sb = new StringBuilder();
            for (int j = 0; j < queens.length; j++) {
                sb.append(j == queens[i] ? 'Q' : '.');
            }
            board.add(sb.toString());
        }
        return board;
    }
}
```

**复杂度分析**：
- 最坏情况：O(N!)（每个位置都尝试）
- 实际上由于剪枝，远小于 N!
- 8 皇后有 92 个解


## 经典问题二：全排列

**问题**：给定一个不含重复数字的数组，返回所有可能的全排列。

```java
public List&lt;List&lt;Integer&gt;&gt; permute(int[] nums) {
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    List&lt;Integer&gt; path = new ArrayList&lt;&gt;();
    boolean[] used = new boolean[nums.length];
    permuteDFS(nums, used, path, result);
    return result;
}

private void permuteDFS(int[] nums, boolean[] used, 
                        List&lt;Integer&gt; path, List&lt;List&lt;Integer&gt;&gt; result) {
    // 终止条件：路径长度等于数组长度
    if (path.size() == nums.length) {
        result.add(new ArrayList&lt;&gt;(path));
        return;
    }
    
    for (int i = 0; i < nums.length; i++) {
        if (used[i]) continue;  // 已使用的跳过
        
        used[i] = true;
        path.add(nums[i]);
        permuteDFS(nums, used, path, result);
        path.remove(path.size() - 1);  // 撤销
        used[i] = false;
    }
}
```

**有重复数字的全排列**：

```java
// 先排序，然后剪枝
public List&lt;List&lt;Integer&gt;&gt; permuteUnique(int[] nums) {
    Arrays.sort(nums);
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    List&lt;Integer&gt; path = new ArrayList&lt;&gt;();
    boolean[] used = new boolean[nums.length];
    permuteUniqueDFS(nums, used, path, result);
    return result;
}

private void permuteUniqueDFS(int[] nums, boolean[] used,
                              List&lt;Integer&gt; path, List&lt;List&lt;Integer&gt;&gt; result) {
    if (path.size() == nums.length) {
        result.add(new ArrayList&lt;&gt;(path));
        return;
    }
    
    for (int i = 0; i < nums.length; i++) {
        if (used[i]) continue;
        // 剪枝：跳过重复元素
        if (i > 0 && nums[i] == nums[i-1] && !used[i-1]) continue;
        
        used[i] = true;
        path.add(nums[i]);
        permuteUniqueDFS(nums, used, path, result);
        path.remove(path.size() - 1);
        used[i] = false;
    }
}
```


## 经典问题三：子集

**问题**：给定一个不含重复数字的数组，返回所有可能的子集。

```java
public List&lt;List&lt;Integer&gt;&gt; subsets(int[] nums) {
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    List&lt;Integer&gt; path = new ArrayList&lt;&gt;();
    subsetsDFS(nums, 0, path, result);
    return result;
}

private void subsetsDFS(int[] nums, int start, 
                        List&lt;Integer&gt; path, List&lt;List&lt;Integer&gt;&gt; result) {
    // 每个节点都是一个子集
    result.add(new ArrayList&lt;&gt;(path));
    
    for (int i = start; i < nums.length; i++) {
        path.add(nums[i]);
        subsetsDFS(nums, i + 1, path, result);  // 注意是 i+1，不是 start+1
        path.remove(path.size() - 1);
    }
}
```

**有重复数字的子集**：

```java
public List&lt;List&lt;Integer&gt;&gt; subsetsWithDup(int[] nums) {
    Arrays.sort(nums);
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    List&lt;Integer&gt; path = new ArrayList&lt;&gt;();
    subsetsWithDupDFS(nums, 0, path, result);
    return result;
}

private void subsetsWithDupDFS(int[] nums, int start,
                              List&lt;Integer&gt; path, List&lt;List&lt;Integer&gt;&gt; result) {
    result.add(new ArrayList&lt;&gt;(path));
    
    for (int i = start; i < nums.length; i++) {
        // 剪枝：跳过重复元素
        if (i > start && nums[i] == nums[i-1]) continue;
        
        path.add(nums[i]);
        subsetsWithDupDFS(nums, i + 1, path, result);
        path.remove(path.size() - 1);
    }
}
```


## 回溯的优化：剪枝

**剪枝**是减少搜索空间的关键技术。

### 1. 组合求和剪枝

```java
// LeetCode 40: 组合总和 II
public List&lt;List&lt;Integer&gt;&gt; combinationSum2(int[] candidates, int target) {
    Arrays.sort(candidates);  // 排序是剪枝的前提
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    List&lt;Integer&gt; path = new ArrayList&lt;&gt;();
    combinationSum2DFS(candidates, target, 0, path, result);
    return result;
}

private void combinationSum2DFS(int[] candidates, int target, int start,
                                List&lt;Integer&gt; path, List&lt;List&lt;Integer&gt;&gt; result) {
    if (target == 0) {
        result.add(new ArrayList&lt;&gt;(path));
        return;
    }
    
    for (int i = start; i < candidates.length; i++) {
        // 剪枝：小了就跳过
        if (candidates[i] > target) continue;
        // 剪枝：跳过同一层的重复元素
        if (i > start && candidates[i] == candidates[i-1]) continue;
        
        path.add(candidates[i]);
        combinationSum2DFS(candidates, target - candidates[i], i + 1, path, result);
        path.remove(path.size() - 1);
    }
}
```

### 2. 排列的剪枝

```java
// 排列中使用剪枝
if (used[i]) continue;
if (i > 0 && nums[i] == nums[i-1] && !used[i-1]) continue;
// !used[i-1] 确保同一树枝不重复（而不是同一层）
```


## 回溯的复杂度分析

### 时间复杂度

- 理论上是 O(N!)，但通常因为剪枝会小很多
- 子集问题：O(2ⁿ)
- 全排列：O(N!)
- 组合求和：O(N!)

### 空间复杂度

- O(N) 递归栈空间
- O(N) 用于路径和 used 数组


## 回溯的变形：岛屿问题

```java
// LeetCode 200: 岛屿数量
public int numIslands(char[][] grid) {
    int count = 0;
    for (int i = 0; i < grid.length; i++) {
        for (int j = 0; j < grid[0].length; j++) {
            if (grid[i][j] == '1') {
                dfs(grid, i, j);
                count++;
            }
        }
    }
    return count;
}

private void dfs(char[][] grid, int i, int j) {
    if (i < 0 || i >= grid.length || j < 0 || j >= grid[0].length
        || grid[i][j] == '0') {
        return;
    }
    grid[i][j] = '0';  // 标记为已访问
    dfs(grid, i + 1, j);
    dfs(grid, i - 1, j);
    dfs(grid, i, j + 1);
    dfs(grid, i, j - 1);
}
```


## 总结

回溯是「枚举 + 剪枝」的哲学：

- **枚举**：遍历所有可能的解
- **剪枝**：跳过不可能的解
- **回溯**：枚举+剪枝后的暴力搜索

回溯的精髓在于**「不撞南墙不回头，撞了南墙就回头换条路」**。

## 面试追问方向

- 回溯和递归的区别？（回溯是特殊的递归，有撤销操作）
- 回溯的复杂度是多少？（通常是 O(N!)，但实际因剪枝远小于）
- 什么时候用回溯？（组合、排列、子集、切割、棋盘类问题）
- 如何剪枝？（排序、跳过重复、利用约束条件）
- 回溯能解决的所有问题类型？（组合、排列、子集、N皇后、岛屿、单词搜索）
