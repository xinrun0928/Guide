# 动态规划高频题：背包、打家劫舍、股票买卖

> 动态规划（DP）是面试中公认的「拦路虎」。很多人觉得它难，其实是因为没有掌握「套路」。一旦摸清门道，很多 DP 题其实是送分题。

## 动态规划的本质

动态规划的核心思想：**把大问题拆成小问题，小问题的答案被复用**。

关键特征：
1. **最优子结构**：最优解由子问题的最优解构成
2. **无后效性**：某个状态一旦确定，之后不受后续决策影响
3. **重叠子问题**：子问题会被重复计算（这正是 DP 要解决的核心痛点）


## 入门：爬楼梯

> 题目：假设你正在爬楼梯。每次你可以爬 1 或 2 个台阶。有 n 个台阶，有多少种不同的方法爬到楼顶？

**分析**：`dp[i]` = 爬到第 i 阶的方法数，`dp[i] = dp[i-1] + dp[i-2]`

```java
public int climbStairs(int n) {
    if (n <= 2) return n;
    int prev2 = 1, prev1 = 2; // prev2 = dp[i-2], prev1 = dp[i-1]
    for (int i = 3; i <= n; i++) {
        int curr = prev1 + prev2;
        prev2 = prev1;
        prev1 = curr;
    }
    return prev1;
}
```

**空间优化**：只保留前两个值 → O(1) 空间。


## 高频题一：打家劫舍

> 题目：你是一个专业小偷，相邻的房屋装有相互连通的安保系统。给定数组 nums 表示每个房屋的金额，计算在不触动警报的情况下，今晚能够偷窃的最高金额。

```java
public int rob(int[] nums) {
    if (nums.length == 0) return 0;
    if (nums.length == 1) return nums[0];
    // dp[i] = 偷到第 i 间房时的最高金额
    // 要么不偷第 i 间（等于 dp[i-1]），要么偷（等于 dp[i-2] + 当前房间）
    int prev2 = 0, prev1 = nums[0];
    for (int i = 1; i < nums.length; i++) {
        int curr = Math.max(prev1, prev2 + nums[i]);
        prev2 = prev1;
        prev1 = curr;
    }
    return prev1;
}
```

**变体：房屋围成环（首尾不能同时偷）** → 取 `max(rob(0, n-2), rob(1, n-1))` 两种情况。


## 高频题二：0-1 背包问题

> 题目：给定 n 个物品，每个物品有重量 w[i] 和价值 v[i]，以及容量为 W 的背包。求背包能装下的最大价值（每个物品只能装一次）。

```java
public int knapsack(int[] weights, int[] values, int capacity) {
    int n = weights.length;
    int[] dp = new int[capacity + 1];
    for (int i = 0; i < n; i++) {
        // 逆序遍历容量：确保每个物品只选一次（正序会导致同一物品被重复选）
        for (int w = capacity; w >= weights[i]; w--) {
            dp[w] = Math.max(dp[w], dp[w - weights[i]] + values[i]);
        }
    }
    return dp[capacity];
}
```

**为什么逆序？** 正序会导致同一物品被重复选择（01 背包每个物品只能用一次）。


## 高频题三：完全背包问题

> 题目：同 0-1 背包，但每种物品可以选无限次。

```java
public int completeKnapsack(int[] weights, int[] values, int capacity) {
    int n = weights.length;
    int[] dp = new int[capacity + 1];
    for (int i = 0; i < n; i++) {
        // 正序遍历容量：同一物品可以多次选
        for (int w = weights[i]; w <= capacity; w++) {
            dp[w] = Math.max(dp[w], dp[w - weights[i]] + values[i]);
        }
    }
    return dp[capacity];
}
```

**0-1 背包 vs 完全背包**：逆序 = 0-1，正序 = 完全。


## 高频题四：股票买卖系列

股票买卖是 DP 领域的「全家桶」，从简单到复杂有多个版本。

### 版本一：最多交易一次

```java
public int maxProfitOnce(int[] prices) {
    int minPrice = Integer.MAX_VALUE, maxProfit = 0;
    for (int price : prices) {
        maxProfit = Math.max(maxProfit, price - minPrice);
        minPrice = Math.min(minPrice, price);
    }
    return maxProfit;
}
```

### 版本二：不限交易次数

```java
public int maxProfitUnlimited(int[] prices) {
    int profit = 0;
    for (int i = 1; i < prices.length; i++) {
        // 只要明天价格比今天高，就今天买入明天卖出
        if (prices[i] > prices[i - 1]) {
            profit += prices[i] - prices[i - 1];
        }
    }
    return profit;
}
```

### 版本三：最多交易 k 次

```java
public int maxProfitK(int k, int[] prices) {
    int n = prices.length;
    if (k >= n / 2) { // 等价于无限次交易
        int profit = 0;
        for (int i = 1; i < n; i++) {
            profit += Math.max(0, prices[i] - prices[i - 1]);
        }
        return profit;
    }
    // dp[i][j]: 第 i 天，状态 j 下的最大利润
    // j 为奇数=持股，j 为偶数=不持股
    int[][] dp = new int[n][2 * k + 1];
    for (int j = 1; j < 2 * k + 1; j++) {
        dp[0][j] = (j % 2 == 1) ? -prices[0] : 0;
    }
    for (int i = 1; i < n; i++) {
        for (int j = 1; j < 2 * k + 1; j++) {
            if (j % 2 == 1) {
                // 持股：保持或买入
                dp[i][j] = Math.max(dp[i - 1][j], dp[i - 1][j - 1] - prices[i]);
            } else {
                // 不持股：保持或卖出
                dp[i][j] = Math.max(dp[i - 1][j], dp[i - 1][j - 1] + prices[i]);
            }
        }
    }
    return dp[n - 1][2 * k];
}
```

### 版本四：含冷冻期

> 卖出后有一天冷冻期，不能买入。

```java
public int maxProfitCooldown(int[] prices) {
    int n = prices.length;
    if (n == 0) return 0;
    // dp[i][0]=持有, dp[i][1]=不持有且在冷冻, dp[i][2]=不持有且不在冷冻
    int[][] dp = new int[n][3];
    dp[0][0] = -prices[0];
    for (int i = 1; i < n; i++) {
        dp[i][0] = Math.max(dp[i - 1][0], dp[i - 1][2] - prices[i]);
        dp[i][1] = dp[i - 1][0] + prices[i]; // 卖出 -> 冷冻
        dp[i][2] = Math.max(dp[i - 1][1], dp[i - 1][2]);
    }
    return Math.max(dp[n - 1][1], dp[n - 1][2]);
}
```


## DP 通用解题框架

1. **确定状态**：找到「最后一步」和「子问题」
2. **转移方程**：`dp[i] = max/min/sum(dp[i-1], ...)`
3. **初始条件**：dp[0]、dp[1] 或者边界
4. **计算顺序**：从前往后或从后往前
5. **空间优化**：如果只用到前几个值，就降维


## 总结

| 题型 | 状态定义 | 空间优化 |
|------|----------|----------|
| 爬楼梯 | dp[i] = 方案数 | 两变量滚动 |
| 打家劫舍 | dp[i] = 最高金额 | 两变量滚动 |
| 0-1 背包 | dp[w] = 最大价值 | 一维数组（逆序）|
| 完全背包 | dp[w] = 最大价值 | 一维数组（正序）|
| 股票（最多1次）| 单变量贪心 | 无 |
| 股票（无限次）| 累加正差 | 无 |
| 股票（k次）| dp[n][2k+1] | 空间压缩 |

动态规划的核心是多练，**先理解状态定义，再写转移方程，最后优化空间**。按这个顺序，没有 DP 题能难倒你。
