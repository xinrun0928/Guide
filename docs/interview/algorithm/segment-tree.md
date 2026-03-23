# 线段树与树状数组

> 假设你有 10 万个数据，需要支持两种操作：1. 区间求和；2. 单点修改。

遍历求和是 O(n)，遍历修改是 O(1)。有没有办法让两种操作都快起来？

**线段树**和**树状数组**，就是解决这类问题的利器。它们让「区间查询」和「单点修改」都达到 O(log n)。

---

## 从一个朴素的问题说起

你有一个数组 `arr = [1, 3, 5, 7, 9, 11]`，需要：

1. 频繁查询区间 [l, r] 的和
2. 频繁修改某个位置的值

最简单的做法：

- 查询：遍历求和 → O(n)
- 修改：直接赋值 → O(1)

能不能都快起来？分段存储！

把数组分成若干段，每段预先计算好和。查询时只需要合并几段的值，修改时只需要更新涉及到的段。

这就是线段树的基本思想。

---

## 线段树：从分治到数据结构

### 线段树的结构

线段树是一棵二叉树，每个节点代表一个区间：

- 根节点：整个区间 [0, n-1]
- 叶节点：单个元素
- 内部节点：两个子区间的合并

```
数组: [1, 3, 5, 7, 9, 11]
          [0,5]
        /      \
     [0,2]      [3,5]
    /    \      /    \
  [0,1]  [2]  [3,4]  [5]
  / \    |    / \     |
 [0][1] [2] [3][4]  [5]
```

### 线段树的实现

```java
class SegTree {
    private int[] tree; // 线段树数组，tree[i] 表示第 i 个节点的值
    private int n;      // 原数组长度

    public SegTree(int[] nums) {
        n = nums.length;
        tree = new int[4 * n]; // 4n 是常用的空间上界
        build(0, 0, n - 1, nums);
    }

    // 构建线段树
    private void build(int node, int start, int end, int[] nums) {
        if (start == end) {
            tree[node] = nums[start]; // 叶节点，直接赋值
            return;
        }
        int mid = (start + end) / 2;
        int left = node * 2 + 1;
        int right = node * 2 + 2;
        build(left, start, mid, nums);
        build(right, mid + 1, end, nums);
        tree[node] = tree[left] + tree[right]; // 父节点 = 子节点之和
    }

    // 单点修改
    public void update(int idx, int val) {
        update(0, 0, n - 1, idx, val);
    }

    private void update(int node, int start, int end, int idx, int val) {
        if (start == end) {
            tree[node] = val; // 找到目标位置，更新值
            return;
        }
        int mid = (start + end) / 2;
        if (idx <= mid) {
            update(node * 2 + 1, start, mid, idx, val);
        } else {
            update(node * 2 + 2, mid + 1, end, idx, val);
        }
        tree[node] = tree[node * 2 + 1] + tree[node * 2 + 2];
    }

    // 区间查询
    public int query(int left, int right) {
        return query(0, 0, n - 1, left, right);
    }

    private int query(int node, int start, int end, int left, int right) {
        if (right < start || left > end) {
            return 0; // 区间完全不重叠，返回 0（加法单位元）
        }
        if (left <= start && end <= right) {
            return tree[node]; // 区间完全包含，直接返回
        }
        // 部分重叠，继续向下查询
        int mid = (start + end) / 2;
        return query(node * 2 + 1, start, mid, left, right)
             + query(node * 2 + 2, mid + 1, end, left, right);
    }
}
```

**为什么空间用 4n？**

完全二叉树中，n 个叶子节点最多需要 2n-1 个节点，而完全二叉树最后一层可能比前面所有层加起来还多，所以用 4n 是一个安全的上界。

---

## 树状数组：更简洁的解决方案

对于「单点更新 + 区间求和」这种经典场景，树状数组比线段树更简洁。

### 核心思想

树状数组（Fenwick Tree）用一种巧妙的结构，把一个数分解成若干「片段」的和。

```java
class FenwickTree {
    private int[] tree;
    private int n;

    public FenwickTree(int size) {
        n = size;
        tree = new int[n + 1];
    }

    // 单点更新：给位置 i 增加 val
    public void update(int i, int val) {
        while (i <= n) {
            tree[i] += val;
            i += i & (-i); // 找下一个需要更新的位置
        }
    }

    // 前缀和：求 [1, i] 的和
    public int prefixSum(int i) {
        int sum = 0;
        while (i > 0) {
            sum += tree[i];
            i -= i & (-i); // 找上一个需要累加的位置
        }
        return sum;
    }

    // 区间和：求 [l, r] 的和
    public int rangeSum(int l, int r) {
        return prefixSum(r) - prefixSum(l - 1);
    }
}
```

**为什么要用 `i & (-i)`？**

`i & (-i)` 能得到 i 的二进制表示中最右边的 1。例如：

- 6 (110) & (-6) (010) = 2
- 8 (1000) & (-8) (1000) = 8

这个操作叫做 **lowbit**，它表示「以 i 结尾的连续 1 的个数」。利用 lowbit 可以快速定位「管理区间」的边界。

---

## 经典问题：区域和检索

> 题目：给定一个整数数组，实现 `NumArray` 类，支持 `sumRange(left, right)` 查询区间和。

```java
class NumArray {
    private FenwickTree fenwick;
    private int[] nums;

    public NumArray(int[] nums) {
        this.nums = nums;
        fenwick = new FenwickTree(nums.length);
        for (int i = 0; i < nums.length; i++) {
            fenwick.update(i + 1, nums[i]); // FenwickTree 用 1-indexed
        }
    }

    public int sumRange(int left, int right) {
        return fenwick.rangeSum(left + 1, right + 1);
    }
}
```

---

## 经典问题：动态数据的中位数

> 题目：数据流不断加入数字，实时返回中位数。

这需要「两个堆」来维护，但如果你只有线段树，也可以：

```java
class MedianFinder {
    private SegTree segTree;
    private int min = Integer.MIN_VALUE;
    private int max = Integer.MAX_VALUE;
    private int count = 0;

    public MedianFinder() {
        // 离散化：假设数据范围已知
        segTree = new SegTree(new int[100001]);
    }

    public void addNum(int num) {
        segTree.update(num - min, 1); // 在 num 位置加 1
        count++;
    }

    public double findMedian() {
        int mid = (count + 1) / 2; // 中位数位置
        // 查找第 mid 小的数（二分 + 线段树）
        int left = 0, right = max - min;
        while (left < right) {
            int midVal = (left + right) / 2;
            int leftCount = segTree.query(0, midVal);
            if (leftCount < mid) {
                left = midVal + 1;
            } else {
                right = midVal;
            }
        }
        return (left + right) / 2.0 + min;
    }
}
```

**线段树 + 二分 = 查找第 k 小的数**。这是线段树的一个高级用法。

---

## 线段树的进阶：懒更新

如果操作变成「区间更新 + 区间查询」，普通线段树就不够用了。

### 懒更新线段树

```java
class LazySegTree {
    private int[] tree;
    private int[] lazy;
    private int n;

    public LazySegTree(int[] nums) {
        n = nums.length;
        tree = new int[4 * n];
        lazy = new int[4 * n];
        build(0, 0, n - 1, nums);
    }

    // 区间更新：给 [l, r] 区间加上 val
    public void rangeUpdate(int l, int r, int val) {
        rangeUpdate(0, 0, n - 1, l, r, val);
    }

    private void rangeUpdate(int node, int start, int end, int l, int r, int val) {
        if (l <= start && end <= r) {
            tree[node] += (end - start + 1) * val; // 更新当前节点
            lazy[node] += val; // 标记懒更新
            return;
        }
        pushDown(node, start, end); // 向下传递懒标记
        int mid = (start + end) / 2;
        if (l <= mid) rangeUpdate(node * 2 + 1, start, mid, l, r, val);
        if (r > mid) rangeUpdate(node * 2 + 2, mid + 1, end, l, r, val);
        tree[node] = tree[node * 2 + 1] + tree[node * 2 + 2];
    }

    // 懒标记下推
    private void pushDown(int node, int start, int end) {
        if (lazy[node] != 0) {
            int mid = (start + end) / 2;
            lazy[node * 2 + 1] += lazy[node];
            tree[node * 2 + 1] += (mid - start + 1) * lazy[node];
            lazy[node * 2 + 2] += lazy[node];
            tree[node * 2 + 2] += (end - mid) * lazy[node];
            lazy[node] = 0;
        }
    }

    // 区间查询
    public int rangeQuery(int l, int r) {
        return rangeQuery(0, 0, n - 1, l, r);
    }

    private int rangeQuery(int node, int start, int end, int l, int r) {
        if (l <= start && end <= r) {
            return tree[node];
        }
        pushDown(node, start, end);
        int mid = (start + end) / 2;
        int sum = 0;
        if (l <= mid) sum += rangeQuery(node * 2 + 1, start, mid, l, r);
        if (r > mid) sum += rangeQuery(node * 2 + 2, mid + 1, end, l, r);
        return sum;
    }
}
```

**懒更新的核心**：不立即向下更新，只把变化记录在当前节点。等真正需要访问子节点时，再把懒标记「下推」。

---

## 线段树 vs 树状数组

| 特性 | 线段树 | 树状数组 |
|------|--------|----------|
| 单点更新 | O(log n) | O(log n) |
| 区间查询 | O(log n) | O(log n) |
| 区间更新 | O(log n)（需要懒标记） | O(log n) |
| 代码复杂度 | 较高 | 简洁 |
| 功能 | 通用（可扩展到最大值、最小值） | 只适合「可合并」的操作（求和、区间异或） |

---

## 面试追问预判

1. **为什么树状数组的空间是 n+1？**
   - 树状数组用 1-indexed，索引 0 留空不用（便于 lowbit 计算）

2. **线段树和二叉搜索树有什么关系？**
   - 没有直接关系。线段树是区间树，和 BST 的「值有序」不同

3. **什么场景用线段树，什么场景用树状数组？**
   - 只需要「求和/异或」：用树状数组（代码简单）
   - 需要「最大值/最小值」或「区间更新」：用线段树

---

## 记忆口诀

> **线段树，分段存。**
> **查询要递归，更新要下沉。**
> **懒标记，推一推。**
> **树状数组，lowbit 追。**
> **i += i&-i，更新要加回。**
> **i -= i&-i，查询要累。**

---

## 练习建议

1. **入门**：区域和检索 → 动态数据流的中位数
2. **进阶**：我的Calendar（区间合并）→ 计数问题
3. **挑战**：线段树的懒更新 → 区间修改 + 区间查询

线段树和树状数组，教会我们一件事：**分而治之，是优化复杂度的艺术**。把问题分解成小问题，小问题解决后合并——这就是递归的力量。
