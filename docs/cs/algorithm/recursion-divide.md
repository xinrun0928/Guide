# 递归与分治：汉诺塔与归并排序


## 递归：程序员的魔法

你一定见过这样的代码：

```java
public int fibonacci(int n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}
```

这就是**递归**——函数调用自身。

递归是计算机科学中最优雅的思想之一：把大问题分解成小问题，小问题的解合并成大问题的解。

但递归也是最容易出错的地方——用得好是魔法，用不好是灾难。

今天，让我们彻底理解递归。


## 递归的三要素

一个正确的递归，必须满足：

1. **终止条件**：有明确的最小问题的答案（基准情况）
2. **递归调用**：把问题规模缩小
3. **状态传递**：把问题答案从子问题「传」回来

### 递归求阶乘

```java
public int factorial(int n) {
    // 1. 终止条件
    if (n <= 1) return 1;
    
    // 2. 递归调用（规模减小）
    int subResult = factorial(n - 1);
    
    // 3. 状态传递（合并子问题答案）
    return n * subResult;
}
```

### 递归的本质：调用栈

每次递归调用都会在栈上创建一个**栈帧**，包含：
- 参数
- 局部变量
- 返回地址

```
factorial(4) 的调用栈:

| factorial(0) = 1      | ← 最后返回
| factorial(1) = 1        |
| factorial(2) = 2        |
| factorial(3) = 6        |
| factorial(4) = 24      | ← 入口
```

**递归深度过大时栈会溢出**——这就是为什么面试官喜欢问「递归的缺点」。


## 经典递归问题

### 1. 汉诺塔

**问题**：有 3 根柱子，n 个圆盘，大盘在下小盘在上。每次移动一个圆盘，大盘不能放在小盘上面。把所有圆盘从 A 移到 C。

```
初始状态:          最终状态:

    |                |
   [=]               |
  [===]              |
 [=====]        [=====[=====][=====]
 ──────────────────────────────
    A  B  C              A  B  C
```

**分析**：
- 把 n-1 个盘子从 A 移到 B（借助 C）
- 把最大的盘子从 A 移到 C
- 把 n-1 个盘子从 B 移到 C（借助 A）

```java
public void hanoi(int n, char from, char to, char aux) {
    if (n == 1) {
        System.out.println("Move disk 1 from " + from + " to " + to);
        return;
    }
    
    // 第一步：把 n-1 个盘子从 A 移到 B（借助 C）
    hanoi(n - 1, from, aux, to);
    
    // 第二步：把最大的盘子从 A 移到 C
    System.out.println("Move disk " + n + " from " + from + " to " + to);
    
    // 第三步：把 n-1 个盘子从 B 移到 C（借助 A）
    hanoi(n - 1, aux, to, from);
}
```

**复杂度**：T(n) = 2T(n-1) + 1，解得 **T(n) = 2ⁿ - 1**。

移动次数呈指数增长，所以汉诺塔游戏非常难（n=64 的移动次数是 2⁶⁴ - 1 ≈ 1.8 × 10¹⁹）。

### 2. 括号生成

```java
public List&lt;String&gt; generateParenthesis(int n) {
    List&lt;String&gt; result = new ArrayList&lt;&gt;();
    generate(result, new StringBuilder(), 0, 0, n);
    return result;
}

private void generate(List&lt;String&gt; result, StringBuilder sb, int open, int close, int n) {
    // 终止条件：括号用完了
    if (sb.length() == 2 * n) {
        result.add(sb.toString());
        return;
    }
    
    // 可以加左括号
    if (open < n) {
        sb.append('(');
        generate(result, sb, open + 1, close, n);
        sb.deleteCharAt(sb.length() - 1);
    }
    
    // 可以加右括号（但必须左括号比右括号多）
    if (close < open) {
        sb.append(')');
        generate(result, sb, open, close + 1, n);
        sb.deleteCharAt(sb.length() - 1);
    }
}
```


## 分治：递归的升华

**分治**是一种更高级的递归策略：**把问题分解成若干个相同的子问题，分别求解，最后合并**。

分治的核心步骤：

1. **分解**：把问题分成若干子问题
2. **解决**：递归求解子问题
3. **合并**：把子问题的解合并成原问题的解

### 分治 vs 递归

| 特征 | 纯递归 | 分治 |
|------|--------|------|
| 子问题 | 可能有重叠 | 通常无重叠 |
| 是否合并 | 通常不需要 | 必须合并 |
| 典型例子 | 斐波那契数列 | 归并排序 |

### 分治的经典应用

1. **归并排序**：分两半 → 分别排序 → 合并
2. **快速排序**：分两半（partition）→ 分别排序 → 无需合并
3. **二分查找**：分一半 → 找区间 → 合并答案
4. **大整数乘法**：分半 → 分治计算 → 合并
5. **矩阵乘法（Strassen 算法）**：分块 → 8 次乘 → 合并


## 实战：归并排序

### 算法思想

归并排序是分治思想的完美体现：

1. **分解**：把数组分成两半
2. **解决**：递归排序两半
3. **合并**：合并两个有序数组

```java
public void mergeSort(int[] arr, int left, int right) {
    // 终止条件：只有一个元素
    if (left >= right) return;
    
    int mid = left + (right - left) / 2;
    
    // 分解：分成两半
    mergeSort(arr, left, mid);
    mergeSort(arr, mid + 1, right);
    
    // 合并：合并两个有序数组
    merge(arr, left, mid, right);
}

private void merge(int[] arr, int left, int mid, int right) {
    int[] temp = new int[right - left + 1];
    int i = left, j = mid + 1, k = 0;
    
    // 合并两个有序数组
    while (i <= mid && j <= right) {
        if (arr[i] <= arr[j]) {
            temp[k++] = arr[i++];
        } else {
            temp[k++] = arr[j++];
        }
    }
    
    // 处理剩余元素
    while (i <= mid) temp[k++] = arr[i++];
    while (j <= right) temp[k++] = arr[j++];
    
    // 复制回原数组
    for (int p = 0; p < k; p++) {
        arr[left + p] = temp[p];
    }
}
```

### 复杂度分析

- **时间复杂度**：T(n) = 2T(n/2) + O(n) = **O(n log n)**
- **空间复杂度**：O(n)（需要额外的临时数组）
- **稳定性**：稳定（相同元素相对位置不变）

### 为什么归并排序是 O(n log n)？

```
归并排序的递归树:

第一层:  [0...7] → 合并 O(8)
       /          \
第二层: [0...3]  [4...7] → 各合并 O(4)
       /\          /\
第三层: [0...1] [2...3] [4...5] [6...7] → 各合并 O(2)
       /\    /\    /\    /\
第四层: [0][1][2][3][4][5][6][7] → 不需要合并

层数 = log n
每层合并总代价 = O(n)
总代价 = O(n log n)
```


## 递归与迭代的转换

### 什么时候用递归？

- 问题本身具有递归结构（树、图、分形）
- 问题可以分解为相似的子问题
- 代码可读性比性能更重要

### 什么时候用迭代？

- 对性能要求高（避免栈开销）
- 递归深度可能很大
- 需要更好的空间控制

### 尾递归优化

某些语言（如 Scala、Haskell）支持尾递归优化，把递归转成迭代。

```java
// 尾递归版本（需要语言支持）
public int factorialTail(int n, int acc) {
    if (n <= 1) return acc;
    return factorialTail(n - 1, n * acc);
}
```

Java 不支持尾递归优化，但可以用手动改写的方式转成迭代。

### 递归改迭代模板

```java
// 递归版本
public void recursive(TreeNode root) {
    if (root == null) return;
    process(root);
    recursive(root.left);
    recursive(root.right);
}

// 迭代版本（用栈模拟）
public void iterative(TreeNode root) {
    Stack&lt;TreeNode&gt; stack = new Stack&lt;&gt;();
    stack.push(root);
    
    while (!stack.isEmpty()) {
        TreeNode node = stack.pop();
        process(node);
        if (node.right != null) stack.push(node.right);
        if (node.left != null) stack.push(node.left);
    }
}
```


## 总结

递归是计算机科学的核心思想，分治是递归的升华。

核心要点：

1. **递归三要素**：终止条件、递归调用、状态传递
2. **分治三步**：分解、解决、合并
3. **归并排序**：O(n log n)，稳定，需要 O(n) 额外空间
4. **递归 vs 迭代**：可读性 vs 性能，需要权衡

理解递归的关键是**理解调用栈**——每次递归调用都在栈上添加一个栈帧，函数返回时弹出。

## 面试追问方向

- 递归的缺点是什么？（栈溢出、重复计算）
- 什么情况下递归会变成无限循环？（缺少终止条件或终止条件永远不满足）
- 斐波那契数列用递归有什么问题？（指数级时间复杂度，存在大量重复计算）
- 归并排序的时间复杂度为什么是 O(n log n)？（递归树高度 × 每层合并代价）
- 如何把递归改成迭代？（用栈/队列模拟调用栈）
