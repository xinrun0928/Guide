# 哈希表高频题：两数之和、字母异位词

> 哈希表是面试中最常用的数据结构之一。它的核心思想很简单：**用空间换时间，以 O(1) 的代价完成查找**。但怎么「用得好」，才是面试真正考察的地方。

## 哈希表的核心思想

先回忆一下哈希表的工作原理：

```
数据: key -> hash(key) -> 数组下标 -> value
```

插入和查找的平均时间复杂度都是 O(1)。这是它相比数组（查找 O(n)）和链表（查找 O(n)）最大的优势。

**但 O(1) 不是没有代价的——哈希冲突、空间利用率、扩容成本，都是潜在的坑。**


## 高频题一：两数之和

> 题目：给定一个整数数组 nums 和一个目标值 target，请你在数组中找出和为目标值的那两个整数，返回它们的下标。假设每种输入对应唯一答案。

**哈希表优化：**

```java
public int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> seen = new HashMap<>(); // 值 -> 下标
    for (int i = 0; i < nums.length; i++) {
        int complement = target - nums[i];
        // 先检查 complement 是否已存在，再放入，避免和自己配对
        if (seen.containsKey(complement)) {
            return new int[]{seen.get(complement), i};
        }
        seen.put(nums[i], i);
    }
    return new int[]{-1, -1};
}
```

遍历时，检查「目标值减去当前值」是否已经出现过。时间复杂度 O(n)，空间复杂度 O(n)。

**关键细节：为什么要先检查再插入？** 如果先插入再检查，会导致自己和自己配对（`nums[i] + nums[i] == target`）的情况被误判。先检查再插入，保证配对的两个数下标不同。


## 高频题二：字母异位词分组

> 题目：给定一个字符串数组，将字母异位词组合在一起，返回结果列表。

**思路：将字母排序作为 key**

```java
public List<List<String>> groupAnagrams(String[] strs) {
    Map<String, List<String>> groups = new HashMap<>();
    for (String s : strs) {
        char[] chars = s.toCharArray();
        Arrays.sort(chars);
        String key = new String(chars);
        // computeIfAbsent 避免重复的 containsKey + new ArrayList
        groups.computeIfAbsent(key, k -> new ArrayList<>()).add(s);
    }
    return new ArrayList<>(groups.values());
}
```

**进阶：O(n * k) 的字符计数方法（优于排序方法）：**

```java
public List<List<String>> groupAnagrams(String[] strs) {
    Map<String, List<String>> groups = new HashMap<>();
    int[] count = new int[26];
    for (String s : strs) {
        Arrays.fill(count, 0);
        for (char c : s.toCharArray()) {
            count[c - 'a']++;
        }
        // 用 # 分隔构建 key，避免 1,11 和 11 的歧义（如 "aa" vs "k"）
        StringBuilder key = new StringBuilder();
        for (int i = 0; i < 26; i++) {
            key.append('#').append(count[i]);
        }
        groups.computeIfAbsent(key.toString(), k -> new ArrayList<>()).add(s);
    }
    return new ArrayList<>(groups.values());
}
```

排序方法时间复杂度 O(n * k log k)，字符计数方法 O(n * k)，后者更优。


## 高频题三：最长连续序列

> 题目：给定一个未排序的整数数组，找出最长连续序列的长度。要求时间复杂度 O(n)。

**优化思路：以序列起点为基准**

```java
public int longestConsecutive(int[] nums) {
    Set<Integer> numSet = new HashSet<>();
    for (int num : nums) numSet.add(num);

    int longest = 0;
    for (int num : numSet) {
        // 只有当 num-1 不存在时，num 才是序列起点，避免重复遍历
        if (!numSet.contains(num - 1)) {
            int cur = num, curLen = 1;
            while (numSet.contains(cur + 1)) {
                cur++;
                curLen++;
            }
            longest = Math.max(longest, curLen);
        }
    }
    return longest;
}
```

**关键优化**：只有当 `num - 1` 不存在时，才认为 num 是序列起点。这样每个序列只遍历一次，时间复杂度 O(n)，空间复杂度 O(n)。


## 高频题四：存在重复元素 II

> 题目：给定一个整数数组和一个整数 k，判断数组中是否存在两个不同的索引 i 和 j，使得 `nums[i] == nums[j]` 且 `abs(i - j) <= k`。

```java
public boolean containsNearbyDuplicate(int[] nums, int k) {
    Map<Integer, Integer> seen = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        if (seen.containsKey(nums[i]) && i - seen.get(nums[i]) <= k) {
            return true;
        }
        seen.put(nums[i], i); // 更新为最近出现的位置
    }
    return false;
}
```


## 面试中的延伸问题

### Q1：哈希表查找一定是 O(1) 吗？

不一定。哈希表查找的平均复杂度是 O(1)，但最坏情况是 O(n)（所有 key 都哈希冲突到同一个桶）。

**面试加分回答**：在 Java 中，HashMap 会在链表长度超过 8 时转为红黑树，所以最坏复杂度是 O(log n)。Python 的 dict 使用开放地址法，扩容时会重新哈希。


### Q2：哈希表和数组该怎么选择？

| 场景 | 选择 | 原因 |
|------|------|------|
| 需要 O(1) 查找 + 键值映射 | 哈希表 | 键到值的直接映射 |
| 需要有序遍历 | 数组 / TreeMap | 哈希表无序 |
| 键是连续整数 | 数组 | 更省空间，避免哈希开销 |
| 需要范围查询 | 数组 / TreeMap | 哈希表不支持范围查询 |


### Q3：如果面试官追问「哈希冲突怎么解决」？

两种主流方案：

- **拉链法（Separate Chaining）**：冲突的元素用链表（或红黑树）挂在同一个桶下。Java HashMap 用这个。
- **开放地址法（Open Addressing）**：冲突时按探测策略（线性探测、二次探测、双重哈希）找下一个空桶。


## 总结

哈希表的高频题型，核心都是**「快速查找匹配项」**：

1. **两数之和**：遍历时查找 `target - num` 是否存在
2. **字母异位词**：用规范化表示（排序 / 计数）作为哈希 key
3. **最长连续序列**：只从序列起点出发，避免重复计算
4. **重复元素 II**：滑动窗口控制范围，哈希表快速查重

记住一个口诀：**哈希表面试题，本质都是「边走边查、以空间换时间」**。
