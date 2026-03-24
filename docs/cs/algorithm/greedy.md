# 贪心算法：活动选择与哈夫曼编码


## 为什么「贪心」有时候是对的？

你面临一个选择：去 A 公司，月薪 1 万；去 B 公司，月薪 8 千但有 10% 股份。

你怎么选？

如果你只看月薪，选 A。但如果你有长远眼光，可能会选 B——因为股份可能带来更大的回报。

这种**只看眼前最优解**的策略，叫做**贪心算法**。

但问题是：**什么时候可以贪心？什么时候不能？**

今天，我们来彻底搞懂贪心。


## 贪心算法的核心思想

**贪心算法**的核心是：**每一步都选择当前最优的解，期望最终得到全局最优解**。

关键特征：

1. **贪心选择**：每一步都做最优选择
2. **最优子结构**：全局最优解包含局部最优解
3. **无后效性**：当前选择不影响未来的选择

### 贪心 vs 动态规划

| 特征 | 贪心 | 动态规划 |
|------|------|----------|
| 选择策略 | 只看当前 | 考虑全局 |
| 时间复杂度 | 通常较低 | 通常较高 |
| 最优性 | 局部最优 ≠ 全局最优 | 一定是最优 |
| 适用场景 | 满足贪心选择性质 | 满足最优子结构 |

### 如何判断是否可以用贪心？

**证明贪心有效性的两种方法：**

1. **数学归纳法**：证明第 k 步的选择可以被扩展为最优解
2. **交换论证**：证明任何最优解都可以在不降低解质量的情况下，转换成贪心解


## 经典问题一：活动选择

**问题**：有 n 个活动，每个活动有一个开始时间 si 和结束时间 ei。选择最多不重叠的活动。

```java
public class ActivitySelection {
    public int maxActivities(int[] start, int[] end) {
        int n = start.length;
        // 按结束时间排序
        Integer[] indices = new Integer[n];
        for (int i = 0; i < n; i++) indices[i] = i;
        Arrays.sort(indices, (a, b) -> end[a] - end[b]);
        
        int count = 0;
        int lastEnd = 0;
        for (int idx : indices) {
            if (start[idx] >= lastEnd) {
                count++;
                lastEnd = end[idx];
            }
        }
        return count;
    }
}
```

**为什么这样贪心是对的？**

- 按结束时间排序后，第一个活动（最早结束）一定在某个最优解中
- 因为它留下最多的时间给后续活动
- 递归地，这个结论对子问题也成立

**证明**：

设 S 是最优解集，A₁ 是按结束时间排序后的第一个活动。

如果最优解不含 A₁，设 A₁' 是最优解中第一个结束的活动。

因为 A₁ 结束最早，所以 A₁' 结束 ≥ A₁ 结束。

用 A₁ 替换 A₁'，得到另一个最优解（同样多的活动）。

所以存在包含 A₁ 的最优解。


## 经典问题二：硬币找零

**问题**：给定硬币面值 {1, 5, 10, 25}，用最少数量的硬币凑出 n 分钱。

```java
public int coinChange(int[] coins, int amount) {
    int count = 0;
    int remain = amount;
    
    // 从面额最大的开始贪心
    Arrays.sort(coins);
    for (int i = coins.length - 1; i >= 0; i--) {
        int coin = coins[i];
        while (remain >= coin) {
            remain -= coin;
            count++;
        }
    }
    
    return remain == 0 ? count : -1;
}
```

**这个贪心一定是最优的吗？**

- 对于 {1, 5, 10, 25} 确实是最优的
- 但对于 {1, 3, 4}，凑 6 分钱：贪心得到 {4, 1, 1}（3 个），但最优是 {3, 3}（2 个）

**所以贪心不是万能的！**

对于 {1, 3, 4}，必须用动态规划：

```java
public int coinChangeDP(int[] coins, int amount) {
    int[] dp = new int[amount + 1];
    Arrays.fill(dp, amount + 1);
    dp[0] = 0;
    
    for (int i = 1; i <= amount; i++) {
        for (int coin : coins) {
            if (coin <= i) {
                dp[i] = Math.min(dp[i], dp[i - coin] + 1);
            }
        }
    }
    
    return dp[amount] > amount ? -1 : dp[amount];
}
```


## 经典问题三：哈夫曼编码

哈夫曼编码是贪心的经典应用，在[哈夫曼树](/cs/algorithm/huffman-tree.md)中有详细讲解。

核心思想：每次选择频率最小的两个节点合并。

```java
public int huffmanCoding(int[] freq) {
    PriorityQueue&lt;Integer&gt; pq = new PriorityQueue&lt;&gt;();
    for (int f : freq) pq.offer(f);
    
    int cost = 0;
    while (pq.size() > 1) {
        int a = pq.poll();
        int b = pq.poll();
        cost += a + b;  // 合并成本
        pq.offer(a + b);  // 新节点放回
    }
    return cost;
}
```


## 经典问题四：分数背包

**问题**：有 n 个物品，每个物品有价值 v 和重量 w，背包容量为 C。每个物品可以部分装入。求最大价值。

**贪心策略**：按单位价值 v/w 降序排列，依次装入。

```java
public double fractionalKnapsack(int[] values, int[] weights, int capacity) {
    int n = values.length;
    Item[] items = new Item[n];
    for (int i = 0; i < n; i++) {
        items[i] = new Item(values[i], weights[i]);
    }
    
    // 按单位价值降序排序
    Arrays.sort(items, (a, b) -> 
        Double.compare(b.valuePerWeight(), a.valuePerWeight()));
    
    double totalValue = 0;
    int remain = capacity;
    
    for (Item item : items) {
        if (remain >= item.weight) {
            totalValue += item.value;
            remain -= item.weight;
        } else {
            // 部分装入
            totalValue += item.value * ((double) remain / item.weight);
            break;
        }
    }
    
    return totalValue;
}
```

**为什么可以用贪心？**

因为可以部分装入，所以总能找到填满背包的最优装法。

**注意**：0-1 背包（不可部分装入）不能用贪心，必须用动态规划！


## 贪心算法的应用场景

### 1. 区间调度

选择最多不重叠的区间。

### 2. 任务安排

带截止时间的最早完成优先。

```java
public int taskScheduling(int[] deadlines, int[] profits) {
    int n = deadlines.length;
    Integer[] indices = new Integer[n];
    for (int i = 0; i < n; i++) indices[i] = i;
    
    // 按截止时间排序
    Arrays.sort(indices, (a, b) -> deadlines[a] - deadlines[b]);
    
    int time = 0;
    int profit = 0;
    for (int idx : indices) {
        time++;
        profit += profits[idx];
    }
    
    return profit;
}
```

### 3. 删数问题

给定数字串，删 k 个数字，使剩下的数字最小。

```java
public String removeKdigits(String num, int k) {
    if (k >= num.length()) return "0";
    
    StringBuilder sb = new StringBuilder();
    for (char c : num.toCharArray()) {
        while (k > 0 && sb.length() > 0 && sb.charAt(sb.length()-1) > c) {
            sb.deleteCharAt(sb.length()-1);
            k--;
        }
        sb.append(c);
    }
    
    // 如果还没删够，从尾部删除
    while (k > 0) {
        sb.deleteCharAt(sb.length()-1);
        k--;
    }
    
    // 去除前导零
    String result = sb.toString().replaceAll("^0+", "");
    return result.isEmpty() ? "0" : result;
}
```

### 4. 加油站问题

```java
public int canCompleteCircuit(int[] gas, int[] cost) {
    int total = 0, current = 0, start = 0;
    
    for (int i = 0; i < gas.length; i++) {
        int diff = gas[i] - cost[i];
        total += diff;
        current += diff;
        
        if (current < 0) {
            start = i + 1;
            current = 0;
        }
    }
    
    return total >= 0 ? start : -1;
}
```


## 贪心 vs 其他算法

| 问题 | 贪心 | 动态规划 | 回溯 |
|------|------|----------|------|
| 活动选择 | ✅ | ✅ | ❌ |
| 背包 | 部分背包 ✅ | 0-1 背包 ❌ | 可用但慢 |
| 最短路径 | Dijkstra ✅ | Bellman-Ford | ❌ |
| 哈夫曼编码 | ✅ | ❌ | ❌ |
| 硬币找零 | 面值特殊时 ✅ | 通用解法 | 可用但慢 |


## 总结

贪心算法是「每一步最优，期望全局最优」的策略。

核心要点：

1. **适用条件**：贪心选择性质 + 最优子结构
2. **常见应用**：区间调度、哈夫曼编码、部分背包、删数问题
3. **注意事项**：不是所有问题都能用贪心，需要证明或验证

判断是否可以用贪心的方法：

1. 尝试几种贪心策略，看是否正确
2. 找反例，如果找不到，可能是对的
3. 数学证明（交换论证或归纳法）

## 面试追问方向

- 贪心算法和动态规划的区别？（贪心只看当前，DP 考虑全局）
- 什么情况下贪心一定正确？（有贪心选择性质和最优子结构）
- 硬币找零什么情况下贪心正确？（面值是「规范硬币系统」时，如 {1,5,10,25}）
- 活动选择为什么按结束时间排序？（留下最多时间给后续活动）
- 0-1 背包为什么不能用贪心？（因为物品不可分割，贪心可能选大价值但重的东西）
