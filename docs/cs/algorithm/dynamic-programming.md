# 动态规划：最优子结构与状态转移


## 从斐波那契到动态规划

你知道斐波那契数列：

```java
public int fibonacci(int n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}
```

但这个算法的问题是：重复计算太多！

```
fibonacci(5)
├── fibonacci(4)
│   ├── fibonacci(3)
│   │   ├── fibonacci(2)
│   │   └── fibonacci(1)
│   └── fibonacci(2)
└── fibonacci(3)
    ├── fibonacci(2)
    └── fibonacci(1)
```

fibonacci(3) 被计算了 2 次，fibonacci(2) 被计算了 3 次！

**解决方案**：用数组保存已经计算过的值，避免重复计算。这就是**记忆化递归**，也是动态规划的雏形。


## 动态规划的定义

**动态规划（Dynamic Programming，DP）**是一种解决**最优子结构**问题的算法思想。

核心要素：

1. **最优子结构**：全局最优解包含子问题的最优解
2. **重叠子问题**：子问题会被重复计算
3. **状态转移**：从子问题的解推导出原问题的解

### 动态规划 vs 记忆化递归

**记忆化递归**：自顶向下，计算结果保存下来

```java
public int fibMemo(int n, int[] memo) {
    if (n <= 1) return n;
    if (memo[n] != 0) return memo[n];  // 已计算过
    memo[n] = fibMemo(n - 1, memo) + fibMemo(n - 2, memo);
    return memo[n];
}
```

**动态规划**：自底向上，从最小的子问题开始

```java
public int fibDP(int n) {
    if (n <= 1) return n;
    int[] dp = new int[n + 1];
    dp[0] = 0;
    dp[1] = 1;
    for (int i = 2; i <= n; i++) {
        dp[i] = dp[i - 1] + dp[i - 2];
    }
    return dp[n];
}
```


## 动态规划的解题框架

### 步骤一：定义状态

**状态**是描述问题局部解的变量。

```java
// 爬楼梯问题
// dp[i] = 爬到第 i 阶的方法数
```

### 步骤二：找状态转移方程

**状态转移方程**是 DP 的核心，描述如何从子问题推导当前问题。

```java
// 爬楼梯
// dp[i] = dp[i-1] + dp[i-2]
// 要到第 i 阶，要么从 i-1 阶走一步，要么从 i-2 阶走两步
```

### 步骤三：确定初始值

```java
dp[0] = 1;  // 站在第 0 阶有一种方法（不动）
dp[1] = 1;  // 爬到第 1 阶有一种方法
```

### 步骤四：确定遍历顺序

```java
// 自底向上，从小到大
for (int i = 2; i <= n; i++) {
    dp[i] = dp[i - 1] + dp[i - 2];
}
```

### 步骤五：优化空间（如需要）

有时候只需要保存最近几个状态，可以压缩空间。

```java
// 斐波那契：只需要前两个状态
public int fibOptimized(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int c = a + b;
        a = b;
        b = c;
    }
    return b;
}
```


## 经典问题：不同路径

**问题**：机器人从左上角走到右下角，只能向右或向下走，有多少条不同的路径？

```java
// 二维 DP
public int uniquePaths(int m, int n) {
    int[][] dp = new int[m][n];
    
    // 初始化
    for (int i = 0; i < m; i++) dp[i][0] = 1;
    for (int j = 0; j < n; j++) dp[0][j] = 1;
    
    // 填表
    for (int i = 1; i < m; i++) {
        for (int j = 1; j < n; j++) {
            dp[i][j] = dp[i - 1][j] + dp[i][j - 1];
        }
    }
    
    return dp[m - 1][n - 1];
}
```

**空间优化**：只需要保存当前行和上一行

```java
public int uniquePathsOptimized(int m, int n) {
    int[] dp = new int[n];
    Arrays.fill(dp, 1);
    
    for (int i = 1; i < m; i++) {
        for (int j = 1; j < n; j++) {
            dp[j] += dp[j - 1];
        }
    }
    
    return dp[n - 1];
}
```


## 状态压缩：二维变一维

### 规则

当 `dp[i][j]` 只依赖 `dp[i-1][j]` 和 `dp[i][j-1]` 时，可以压缩成一维。

```java
// 压缩前：dp[i][j] = ...
// 压缩后：
for (int i = 0; i < m; i++) {
    for (int j = 0; j < n; j++) {
        if (i == 0 || j == 0) {
            dp[j] = 1;
        } else {
            dp[j] = dp[j] + dp[j - 1];  // dp[j] 是 dp[i-1][j]，dp[j-1] 是 dp[i][j-1]
        }
    }
}
```

### 更复杂的状态依赖

如果依赖 `dp[i-1][j]`、`dp[i-1][j-1]`、`dp[i][j-1]`，需要从右到左遍历：

```java
for (int i = 0; i < m; i++) {
    for (int j = n - 1; j >= 0; j--) {  // 从右到左！
        if (i == 0 && j == 0) {
            dp[j] = grid[i][j];
        } else if (i == 0) {
            dp[j] = dp[j - 1] + grid[i][j];
        } else if (j == 0) {
            dp[j] = dp[j] + grid[i][j];
        } else {
            dp[j] = Math.min(dp[j], dp[j - 1]) + grid[i][j];
        }
    }
}
```


## 经典问题：打家劫舍

**问题**：一排 houses，每个 house 有一定金额，不能连续偷两个相邻的 house，最大金额是多少？

```java
public int rob(int[] nums) {
    if (nums.length == 0) return 0;
    if (nums.length == 1) return nums[0];
    
    int n = nums.length;
    int[] dp = new int[n];
    dp[0] = nums[0];
    dp[1] = Math.max(nums[0], nums[1]);
    
    for (int i = 2; i < n; i++) {
        // 不偷：dp[i-1]，偷：dp[i-2] + nums[i]
        dp[i] = Math.max(dp[i - 1], dp[i - 2] + nums[i]);
    }
    
    return dp[n - 1];
}
```

**空间优化**：

```java
public int robOptimized(int[] nums) {
    if (nums.length == 0) return 0;
    int prevMax = 0, currMax = 0;
    for (int num : nums) {
        int temp = currMax;
        currMax = Math.max(currMax, prevMax + num);
        prevMax = temp;
    }
    return currMax;
}
```


## 经典问题：最长公共子序列

**问题**：给定两个字符串，找最长公共子序列（不要求连续）的长度。

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


## 总结

动态规划是解决最优子结构问题的神器。

核心步骤：

1. **定义状态**：dp[i] 或 dp[i][j] 是什么？
2. **状态转移**：如何从子问题推导？
3. **初始化**：dp[0]、dp[1] 怎么定？
4. **遍历顺序**：从小到大还是从大到小？
5. **空间优化**：能否压缩？

动态规划的难点在于**找到正确的状态定义**，这需要多做多练。

## 面试追问方向

- 动态规划和递归的区别？（DP 避免了重复计算）
- 什么时候用一维 DP，什么时候用二维？（取决于状态变量数量）
- 空间优化要注意什么？（遍历顺序，防止覆盖）
- 动态规划如何初始化？（边界条件和 base case）
- 状态转移方程怎么找？（分析最后一步，考虑所有可能）
