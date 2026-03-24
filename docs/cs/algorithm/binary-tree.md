# 二叉树：遍历方式与性质


## 一棵倒过来的家谱

想象你公司的组织架构图：CEO 在最上面，向下是各级管理层，再往下是普通员工。

或者想象一个家族谱系：祖先在上，后代在下，每个人往下延伸出自己的孩子。

这种**层级分明、自顶向下**的数据结构，就是**树**。

而**二叉树**（Binary Tree）是树家族中最简单、最重要的成员——每个节点最多只有两个子节点：左孩子和右孩子。

二叉树是几乎所有高级树结构的基础：二叉搜索树、平衡树、堆、红黑树……都是从二叉树演变而来。

理解二叉树，是理解整个树家族的钥匙。


## 二叉树的基本概念

### 节点定义

```java
public class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    
    TreeNode(int val) {
        this.val = val;
    }
}
```

### 基本术语

- **根节点（Root）**：树的顶端，没有父节点的节点
- **叶子节点（Leaf）**：没有子节点的节点
- **父节点 / 子节点**：相邻两层的节点关系
- **深度（Depth）**：从根到该节点的路径长度（根节点深度为 0）
- **高度（Height）**：从该节点到最深叶子节点的路径长度
- **层（Level）**：深度相同的节点集合

```
        A(深度0, 高度3)        ← 根节点
       / \
      B(深度1, 高度2)   C(深度1, 高度1)
     / \     \
    D   E     F                ← 叶子节点
   /
  G(深度2, 高度0)
```

### 二叉树的分类

1. **满二叉树（Full Binary Tree）**：每个节点都有 0 或 2 个子节点
2. **完全二叉树（Complete Binary Tree）**：除最后一层外，每层节点都达到最大，且最后一层节点左对齐
3. **完美二叉树（Perfect Binary Tree）**：所有叶子节点都在同一层，每层节点数达到最大

```
满二叉树:       完全二叉树:       完美二叉树:
    *              *                  *
   / \            / \                / \
  *   *          *   *              / \
 / \            /   / \            /   \
*   *          *   *   *          /     \

只有最后一层        所有层都填满
可能不满
```


## 二叉树的存储结构

### 顺序存储（适用于完全二叉树）

```java
// 使用数组存储完全二叉树
int[] tree = {1, 2, 3, 4, 5, 6, 7};

// 节点关系:
// 父节点索引 i → 左孩子: 2i+1, 右孩子: 2i+2
// 孩子节点索引 i → 父节点: (i-1) / 2

// 数组结构:
//        1
//       / \
//      2   3        索引:   0  1  2  3  4  5  6
//     / \ /                 [1, 2, 3, 4, 5, 6, 7]
//    4  5 6
```

这种存储方式**节省空间**，且可以利用数组的缓存友好性。

### 链式存储（适用于任意二叉树）

```java
public class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
}

TreeNode root = new TreeNode(1);
root.left = new TreeNode(2);
root.right = new TreeNode(3);
```

灵活，但需要额外的指针空间，且可能导致缓存不友好。


## 二叉树的三种遍历

### 前序遍历（Preorder）：根 → 左 → 右

应用：树的复制、序列化、表达式树（前缀表达式）

```java
// 递归版本
public void preorder(TreeNode root) {
    if (root == null) return;
    System.out.print(root.val + " ");  // 先访问根
    preorder(root.left);               // 再访问左子树
    preorder(root.right);              // 最后访问右子树
}

// 迭代版本（使用栈）
public List&lt;Integer&gt; preorderIterative(TreeNode root) {
    List&lt;Integer&gt; result = new ArrayList&lt;&gt;();
    if (root == null) return result;
    
    Stack&lt;TreeNode&gt; stack = new Stack&lt;&gt;();
    stack.push(root);
    
    while (!stack.isEmpty()) {
        TreeNode node = stack.pop();
        result.add(node.val);
        
        if (node.right != null) stack.push(node.right);  // 右先入栈
        if (node.left != null) stack.push(node.left);    // 左后入栈
    }
    return result;
}
```

### 中序遍历（Inorder）：左 → 根 → 右

应用：二叉搜索树排序（从小到大）、表达式树（中缀表达式）

```java
// 递归版本
public void inorder(TreeNode root) {
    if (root == null) return;
    inorder(root.left);
    System.out.print(root.val + " ");  // 中间访问根
    inorder(root.right);
}

// 迭代版本（统一模板）
public List&lt;Integer&gt; inorderIterative(TreeNode root) {
    List&lt;Integer&gt; result = new ArrayList&lt;&gt;();
    Stack&lt;TreeNode&gt; stack = new Stack&lt;&gt;();
    TreeNode cur = root;
    
    while (cur != null || !stack.isEmpty()) {
        while (cur != null) {
            stack.push(cur);
            cur = cur.left;  // 一路向左
        }
        cur = stack.pop();    // 弹出并访问
        result.add(cur.val);
        cur = cur.right;     // 转向右子树
    }
    return result;
}
```

### 后序遍历（Postorder）：左 → 右 → 根

应用：树的删除、计算目录大小、后缀表达式

```java
// 递归版本
public void postorder(TreeNode root) {
    if (root == null) return;
    postorder(root.left);
    postorder(root.right);
    System.out.print(root.val + " ");  // 最后访问根
}

// 迭代版本（基于前序的变形）
public List&lt;Integer&gt; postorderIterative(TreeNode root) {
    List&lt;Integer&gt; result = new ArrayList&lt;&gt;();
    if (root == null) return result;
    
    Stack&lt;TreeNode&gt; stack = new Stack&lt;&gt;();
    stack.push(root);
    
    while (!stack.isEmpty()) {
        TreeNode node = stack.pop();
        result.add(0, node.val);  // 头插法
        if (node.left != null) stack.push(node.left);
        if (node.right != null) stack.push(node.right);
    }
    return result;
}
```

### 层序遍历（BFS）：按层访问

```java
public List&lt;List&lt;Integer&gt;&gt; levelOrder(TreeNode root) {
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    if (root == null) return result;
    
    Queue&lt;TreeNode&gt; queue = new LinkedList&lt;&gt;();
    queue.offer(root);
    
    while (!queue.isEmpty()) {
        int levelSize = queue.size();  // 当前层节点数
        List&lt;Integer&gt; level = new ArrayList&lt;&gt;();
        
        for (int i = 0; i < levelSize; i++) {
            TreeNode node = queue.poll();
            level.add(node.val);
            if (node.left != null) queue.offer(node.left);
            if (node.right != null) queue.offer(node.right);
        }
        result.add(level);
    }
    return result;
}
```


## 二叉树的重要性质

### 性质一：第 i 层最多有 2^i 个节点

```
第0层: 2^0 = 1个节点
第1层: 2^1 = 2个节点
第2层: 2^2 = 4个节点
...
```

### 性质二：深度为 k 的二叉树最多有 2^(k+1) - 1 个节点

这是完美二叉树的节点数公式。等比数列求和：1 + 2 + 4 + ... + 2^k = 2^(k+1) - 1。

### 性质三：叶节点数 = 度为 2 的节点数 + 1

这个结论来自二叉树的递归定义，理解方式：每增加一个度为 2 的节点，就多出一个叶子。

### 性质四：完全二叉树的性质

对于完全二叉树的顺序存储（数组）：

```java
// 已知节点索引 i，求父孩子索引
int parent(int i) { return (i - 1) / 2; }
int leftChild(int i) { return 2 * i + 1; }
int rightChild(int i) { return 2 * i + 2; }
```

最后一个非叶子节点的索引：`n/2 - 1`


## 经典面试题：遍历的应用

### 题目一：重构二叉树（LeetCode 105）

已知前序和中序遍历，重构二叉树。

```java
public TreeNode buildTree(int[] preorder, int[] inorder) {
    Map&lt;Integer, Integer&gt; inorderMap = new HashMap&lt;&gt;();
    for (int i = 0; i < inorder.length; i++) {
        inorderMap.put(inorder[i], i);
    }
    return build(preorder, 0, preorder.length - 1,
                 inorderMap, 0, inorder.length - 1);
}

private TreeNode build(int[] preorder, int preStart, int preEnd,
                       Map&lt;Integer, Integer&gt; inorderMap,
                       int inStart, int inEnd) {
    if (preStart > preEnd) return null;
    
    int rootVal = preorder[preStart];
    int inorderRootIndex = inorderMap.get(rootVal);
    int leftSize = inorderRootIndex - inStart;
    
    TreeNode root = new TreeNode(rootVal);
    root.left = build(preorder, preStart + 1, preStart + leftSize,
                      inorderMap, inStart, inorderRootIndex - 1);
    root.right = build(preorder, preStart + leftSize + 1, preEnd,
                       inorderMap, inorderRootIndex + 1, inEnd);
    return root;
}
```

### 题目二：二叉树最大深度

```java
public int maxDepth(TreeNode root) {
    if (root == null) return 0;
    return Math.max(maxDepth(root.left), maxDepth(root.right)) + 1;
}
```

### 题目三：验证二叉搜索树

```java
public boolean isValidBST(TreeNode root) {
    return validate(root, Long.MIN_VALUE, Long.MAX_VALUE);
}

private boolean validate(TreeNode node, long min, long max) {
    if (node == null) return true;
    if (node.val <= min || node.val >= max) return false;
    return validate(node.left, min, node.val) 
        && validate(node.right, node.val, max);
}
```

### 题目四：最近公共祖先（LCA）

```java
public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
    if (root == null || root == p || root == q) return root;
    
    TreeNode left = lowestCommonAncestor(root.left, p, q);
    TreeNode right = lowestCommonAncestor(root.right, p, q);
    
    if (left != null && right != null) {
        return root;  // p 和 q 在两侧，当前节点是 LCA
    }
    return left != null ? left : right;
}
```


## 总结

二叉树是数据结构的基石，核心要点：

1. **三种遍历**：前序（根左右）、中序（左根右）、后序（左右根）
2. **两种实现**：递归（简洁）和迭代（需要栈）
3. **层序遍历**：用队列，按层访问
4. **重要性质**：节点数、深度关系、完全二叉树的存储

遍历是手段，理解是目的——每种遍历顺序都有其应用场景。

## 面试追问方向

- 递归遍历和迭代遍历的时间空间复杂度？（O(n)，递归 O(h) 栈空间，迭代 O(h)）
- 如何用 O(1) 空间实现遍历？（莫里斯遍历，用叶子节点的空指针存储前驱）
- 前序+后序能唯一确定二叉树吗？（不能，但可以确定树的高度）
- 如何层序遍历时知道每层的分界？（记录当前队列大小）
- 二叉树和二叉搜索树的区别？（BST 有序性，左<根<右）
