# 前缀和与差分数组

> 你一定遇到过这种题：给一个数组，然后 m 次查询，每次查询区间 [l, r] 的元素和。暴力 O(n×m) 能做，但数据量一大就超时了。

前缀和，就是让「区间查询」从 O(n) 变成 O(1) 的魔法。

---

## 前缀和：让区间查询从 O(n) 到 O(1)

### 核心思想

前缀和数组 `prefix[i]` 表示原数组前 i 个元素的和。

```java
// 构建前缀和数组
public int[] buildPrefixSum(int[] nums) {
    int n = nums.length;
    int[] prefix = new int[n + 1]; // 多一位，prefix[0] = 0
    for (int i = 0; i < n; i++) {
        prefix[i + 1] = prefix[i] + nums[i];
    }
    return prefix;
}

// 查询区间 [l, r] 的和（闭区间，0-indexed）
public int queryRange(int[] prefix, int l, int r) {
    return prefix[r + 1] - prefix[l];
}
```

**为什么要多开一位？**

`prefix[0] = 0` 是一个「哨兵」，让边界处理变得统一。如果从 `prefix[1]` 开始存，那么查询 [0, r] 时只需要 `prefix[r + 1]`，不需要额外判断。

时间复杂度：构建 O(n)，查询 O(1)。

---

## 经典问题：和为 K 的子数组

> 题目：给定一个整数数组 nums 和一个整数 k，返回子数组数量，使得子数组的元素和等于 k。

这题的关键转化：**前缀和之差等于 k**。

```java
public int subarraySum(int[] nums, int k) {
    int count = 0;
    int prefix = 0;
    // key: 前缀和的值, value: 该前缀和出现的次数
    Map<Integer, Integer> map = new HashMap<>();
    map.put(0, 1); // 空数组的前缀和是0，出现1次

    for (int num : nums) {
        prefix += num;
        // 查找有多少个前缀和等于 prefix - k
        // 即有多少个子数组以当前结尾，且和为 k
        count += map.getOrDefault(prefix - k, 0);
        map.put(prefix, map.getOrDefault(prefix, 0) + 1);
    }
    return count;
}
```

**核心思想**：对于每个位置 i，我们想知道有多少个 j < i 使得 `prefix[i] - prefix[j] = k`。如果已知 `prefix[j] = prefix[i] - k`，就能直接找到。

---

## 经典问题：和可被 K 整除的子数组

> 题目：给定数组 nums，返回其中和能被 K 整除的子数组数量。

```java
public int subarraysDivByK(int[] nums, int k) {
    Map<Integer, Integer> map = new HashMap<>();
    map.put(0, 1); // 余数为0的情况
    int prefix = 0;
    int count = 0;

    for (int num : nums) {
        prefix += num;
        // Java负数取模结果为负，需要调整到 [0, k-1]
        int remainder = ((prefix % k) + k) % k;
        count += map.getOrDefault(remainder, 0);
        map.put(remainder, map.getOrDefault(remainder, 0) + 1);
    }
    return count;
}
```

**为什么要调整负数取模？**

Java 中 `-5 % 3 = -2`，但数学上余数应该是正的（0-2）。如果直接用 `prefix % k`，会导致负数余数和正数余数不等价，无法正确计数。

---

## 差分数组：区间修改的 O(1) 方案

前缀和解决了「区间查询」，差分数组解决的是「区间修改」。

### 核心思想

差分数组 `diff[i]` 是原数组相邻元素的差。

```java
// 构建差分数组
public int[] buildDiff(int[] nums) {
    int n = nums.length;
    int[] diff = new int[n];
    diff[0] = nums[0];
    for (int i = 1; i < n; i++) {
        diff[i] = nums[i] - nums[i - 1];
    }
    return diff;
}
```

**差分数组的神奇性质**：对区间 [l, r] 的所有元素加上 val，只需要：

```java
diff[l] += val;
diff[r + 1] -= val; // 如果 r+1 < n
```

最后对差分数组求前缀和，就得到修改后的原数组。

---

## 经典问题：航班预订统计

> 题目：给定航班预订记录，格式为 [start, end, seats]，表示从 start 到 end 的航班预订了 seats 个座位。返回每个航班的总预订数。

```java
public int[] corpFlightBookings(int[][] bookings, int n) {
    int[] diff = new int[n];
    for (int[] booking : bookings) {
        int start = booking[0] - 1; // 转为0-indexed
        int end = booking[1] - 1;
        int seats = booking[2];
        diff[start] += seats;
        if (end + 1 < n) {
            diff[end + 1] -= seats;
        }
    }
    // 差分数组还原为原数组
    int[] result = new int[n];
    result[0] = diff[0];
    for (int i = 1; i < n; i++) {
        result[i] = result[i - 1] + diff[i];
    }
    return result;
}
```

**为什么差分数组能 O(1) 处理区间修改？**

因为我们记录的是「变化量」而非「最终值」。每次修改只需要记录「从哪里开始变」和「从哪里结束变」，最后一起结算。

---

## 经典问题：我的日程安排表 I

> 题目：实现一个日历类，支持添加区间 [start, end)，判断新区间是否与已存在的区间重叠。

```java
class MyCalendar {
    // 使用 TreeMap 按起始时间排序，值是结束时间
    private TreeMap<Integer, Integer> calendar;

    public MyCalendar() {
        calendar = new TreeMap<>();
    }

    public boolean book(int start, int end) {
        // 找到 start 之前最近的已预订区间
        Map.Entry<Integer, Integer> prev = calendar.floorEntry(start);
        // 找到 start 之后最近的已预订区间
        Map.Entry<Integer, Integer> next = calendar.ceilingEntry(start);

        // 检查前一个区间：如果 prev 的结束时间 > start，说明重叠
        if (prev != null && prev.getValue() > start) {
            return false;
        }
        // 检查后一个区间：如果 next 的开始时间 < end，说明重叠
        if (next != null && next.getKey() < end) {
            return false;
        }

        calendar.put(start, end);
        return true;
    }
}
```

**TreeMap 的 floorEntry 和 ceilingEntry**：一个找「小于等于」，一个找「大于等于」，完美处理区间重叠判断。

---

## 前缀和小结

| 技巧 | 适用场景 | 复杂度 |
|------|----------|--------|
| 前缀和数组 | 区间求和查询 | 构建 O(n)，查询 O(1) |
| 哈希 + 前缀和 | 子数组和为 K | O(n) |
| 差分数组 | 区间批量修改 | 修改 O(1)，还原 O(n) |
| TreeMap | 区间重叠判断 | O(log n) |

---

## 面试追问预判

1. **前缀和适用于什么数据范围？**
   - 正数、负数都可以。关键是有序遍历时能维护累积状态

2. **如果同时有「区间修改」和「区间查询」怎么办？**
   - 用线段树或树状数组，平衡两种操作

3. **差分数组和前缀和是什么关系？**
   - 互为逆运算。差分的前缀和是原数组，原数组的差分是差分数组

---

## 记忆口诀

> **前缀和，区间查；差分数，批量改。**
> **前缀和做差，差分数组累加。**
> **一个正向累，一个反向推。**

---

## 练习建议

1. **入门**：一维前缀和 → 区域和检索
2. **进阶**：和为 K 的子数组 → 和可被 K 整除的子数组
3. **挑战**：航班预订统计 → 二维前缀和 → 矩阵区域和

前缀和是算法中的「瑞士军刀」——看似简单，用好了能解决一大片问题。
