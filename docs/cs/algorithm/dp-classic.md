# 动态规划经典问题：背包、最长公共子序列、最长递增子序列


## DP 问题的三板斧

动态规划（DP）是算法面试的重头戏。掌握了它，你就掌握了面试的半壁江山。

但 DP 的题目千变万化，如何以不变应万变？

记住三步：

1. **定义状态**：`dp[i]` 或 `dp[i][j]` 是什么？
2. **找转移方程**：如何从子问题推导？
3. **确定遍历顺序**：保证子问题先被计算

今天，我们用三道经典题目，掌握 DP 的套路。


## 一、背包问题

### 0-1 背包

**问题**：有 n 件物品，每件重量 w[i]，价值 v[i]，容量为 C 的背包。求不超过容量的最大价值。

**状态定义**：`dp[i][j]` = 前 i 件物品，容量为 j 时的最大价值

**转移方程**：

```
dp[i][j] = max(dp[i-1][j], dp[i-1][j-w[i]] + v[i])
// 不选第 i 件          选第 i 件
```

```java
public int knapsack01(int[] weights, int[] values, int capacity) {
    int n = weights.length;
    int[][] dp = new int[n + 1][capacity + 1];
    
    for (int i = 1; i <= n; i++) {
        for (int j = 0; j <= capacity; j++) {
            dp[i][j] = dp[i - 1][j];  // 不选第 i 件
            if (j >= weights[i - 1]) {
                dp[i][j] = Math.max(dp[i][j], 
                    dp[i - 1][j - weights[i - 1]] + values[i - 1]);
            }
        }
    }
    
    return dp[n][capacity];
}
```

**空间优化**：二维变一维

```java
public int knapsack01Optimized(int[] weights, int[] values, int capacity) {
    int n = weights.length;
    int[] dp = new int[capacity + 1];
    
    for (int i = 0; i < n; i++) {
        // 逆序遍历，保证用上一行的数据
        for (int j = capacity; j >= weights[i]; j--) {
            dp[j] = Math.max(dp[j], dp[j - weights[i]] + values[i]);
        }
    }
    
    return dp[capacity];
}
```

**为什么逆序遍历？**

因为 `dp[j]` 依赖 `dp[j - weights[i]]`，而 `dp[j - weights[i]]` 应该是上一行的值。如果顺序遍历，会被当前行覆盖。

### 完全背包

**问题**：每件物品可以选无限次。

**区别**：从正序遍历

```java
public int knapsackComplete(int[] weights, int[] values, int capacity) {
    int n = weights.length;
    int[] dp = new int[capacity + 1];
    
    for (int i = 0; i < n; i++) {
        // 正序遍历，可以多次选择同一物品
        for (int j = weights[i]; j <= capacity; j++) {
            dp[j] = Math.max(dp[j], dp[j - weights[i]] + values[i]);
        }
    }
    
    return dp[capacity];
}
```

### 多重背包

**问题**：每件物品最多选 k 次。

```java
public int knapsackMultiple(int[] weights, int[] values, int[] limits, int capacity) {
    int n = weights.length;
    int[] dp = new int[capacity + 1];
    
    for (int i = 0; i < n; i++) {
        int limit = limits[i];
        for (int j = capacity; j >= weights[i]; j--) {
            // 枚举选择次数
            for (int k = 1; k <= limit && j >= k * weights[i]; k++) {
                dp[j] = Math.max(dp[j], 
                    dp[j - k * weights[i]] + k * values[i]);
            }
        }
    }
    
    return dp[capacity];
}
```

### 背包问题的变体

**变体1**：恰好装满

```java
// 初始化时，只有 dp[0] = 0，其他为 -∞
int[] dp = new int[capacity + 1];
Arrays.fill(dp, Integer.MIN_VALUE);
dp[0] = 0;
```

**变体2**：价值最大 vs 件数最少

```java
// 价值最大：max
// 件数最少：min
```

**变体3**：二维费用背包

```java
int[][] dp = new int[C1 + 1][C2 + 1];
```


## 二、最长公共子序列（LCS）

**问题**：给定两个字符串，求最长公共子序列的长度。

**状态定义**：`dp[i][j]` = text1[0...i-1] 和 text2[0...j-1] 的 LCS 长度

**转移方程**：

```
if (text1[i-1] == text2[j-1]) {
    dp[i][j] = dp[i-1][j-1] + 1;
} else {
    dp[i][j] = max(dp[i-1][j], dp[i][j-1]);
}
```

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

**还原 LCS 字符串**：

```java
public String findLCS(String text1, String text2) {
    int m = text1.length(), n = text2.length();
    int[][] dp = new int[m + 1][n + 1];
    
    // DP 过程省略...
    
    // 逆向回溯
    StringBuilder sb = new StringBuilder();
    int i = m, j = n;
    while (i > 0 && j > 0) {
        if (text1.charAt(i - 1) == text2.charAt(j - 1)) {
            sb.append(text1.charAt(i - 1));
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }
    
    return sb.reverse().toString();
}
```

**空间优化**：只用两行

```java
public int lcsOptimized(String text1, String text2) {
    int m = text1.length(), n = text2.length();
    int[] prev = new int[n + 1];
    int[] curr = new int[n + 1];
    
    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            if (text1.charAt(i - 1) == text2.charAt(j - 1)) {
                curr[j] = prev[j - 1] + 1;
            } else {
                curr[j] = Math.max(prev[j], curr[j - 1]);
            }
        }
        int[] temp = prev;
        prev = curr;
        curr = temp;
        Arrays.fill(curr, 0);
    }
    
    return prev[n];
}
```


## 三、最长递增子序列（LIS）

**问题**：给定一个数组，求最长递增子序列的长度。

### 方法一：O(n²) DP

**状态定义**：`dp[i]` = 以 nums[i] 结尾的 LIS 长度

**转移方程**：`dp[i] = max(dp[j] + 1)`, 其中 j < i 且 nums[j] < nums[i]

```java
public int lisDP(int[] nums) {
    if (nums.length == 0) return 0;
    
    int n = nums.length;
    int[] dp = new int[n];
    Arrays.fill(dp, 1);
    int maxLen = 1;
    
    for (int i = 1; i < n; i++) {
        for (int j = 0; j < i; j++) {
            if (nums[j] < nums[i]) {
                dp[i] = Math.max(dp[i], dp[j] + 1);
            }
        }
        maxLen = Math.max(maxLen, dp[i]);
    }
    
    return maxLen;
}
```

### 方法二：O(n log n) 二分查找

**核心思想**：维护一个有序数组 tails[i] = 长度为 i+1 的 LIS 的最小结尾元素

```java
public int lisBinarySearch(int[] nums) {
    if (nums.length == 0) return 0;
    
    int[] tails = new int[nums.length];
    int size = 0;
    
    for (int num : nums) {
        // 二分查找插入位置
        int i = 0, j = size;
        while (i < j) {
            int mid = (i + j) / 2;
            if (tails[mid] < num) {
                i = mid + 1;
            } else {
                j = mid;
            }
        }
        
        tails[i] = num;
        if (i == size) {
            size++;
        }
    }
    
    return size;
}
```

**为什么 tails[i] 是长度为 i+1 的 LIS 的最小结尾？**

可以用数学归纳法证明：

- tails[0] 是长度为 1 的 LIS 的最小结尾
- 对于 tails[i]，假设它已经是长度为 i+1 的 LIS 的最小结尾
- 当遍历到 num 时，如果 num > tails[i]，可以扩展成更长的 LIS
- 否则，找到第一个 >= num 的位置更新，保证 tails 是最小的


## 三大经典问题的对比

| 问题 | 状态定义 | 转移方程 | 复杂度 |
|------|----------|----------|--------|
| 0-1 背包 | dp[i][j] = 前 i 件，容量 j | max(dp[i-1][j], dp[i-1][j-w] + v) | O(NC) |
| LCS | dp[i][j] = 两串前 i/j 个 | equals? dp[i-1][j-1]+1 : max(dp[i-1][j], dp[i][j-1]) | O(MN) |
| LIS | dp[i] = 以 i 结尾 | max(dp[j]+1) where j<i && a[j]<a[i] | O(n²) |


## 总结

三大 DP 经典问题的套路：

1. **背包问题**：选或不选，用二维到一维的压缩
2. **LCS**：相等向左上走，不等取最大
3. **LIS**：以 i 结尾，向前找比它小的

掌握这三种问题的 DP 模板，面试中遇到变形题也能举一反三。

## 面试追问方向

- 0-1 背包为什么逆序遍历？（保证用上一行数据）
- 完全背包为什么正序遍历？（可以多次选择）
- LCS 如何还原具体字符串？（逆向回溯）
- LIS 的二分查找优化原理？（维护最小结尾数组）
- 还有什么 DP 问题？（编辑距离、单词拆分、股票买卖）
