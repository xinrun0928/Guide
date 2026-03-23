# 二叉树高频题：遍历、路径和、公共祖先

> 二叉树是面试中出现频率最高的数据结构之一。不是因为它难，而是因为它足够经典——遍历、递归、路径问题，每一种都有深意。

## 二叉树的基本结构

```java
public class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode(int x) { val = x; }
}
```

面试中，二叉树的问题通常围绕**遍历**和**递归**展开。


## 高频题一：二叉树的前序、中序、后序遍历

### 前序遍历（根 → 左 → 右）

**递归版（3 行）：**

```java
public void preorder(TreeNode root, List<Integer> result) {
    if (root == null) return;
    result.add(root.val);      // 根
    preorder(root.left, result);   // 左
    preorder(root.right, result);  // 右
}
```

**迭代版（用栈模拟）：**

```java
public List<Integer> preorderIter(TreeNode root) {
    List<Integer> result = new ArrayList<>();
    if (root == null) return result;
    Deque<TreeNode> stack = new ArrayDeque<>();
    stack.push(root);
    while (!stack.isEmpty()) {
        TreeNode node = stack.pop();
        result.add(node.val);
        // 先压右孩子再压左孩子，这样左孩子先出栈（根左右）
        if (node.right != null) stack.push(node.right);
        if (node.left != null) stack.push(node.left);
    }
    return result;
}
```


### 中序遍历（左 → 根 → 右）

```java
public List<Integer> inorderIter(TreeNode root) {
    List<Integer> result = new ArrayList<>();
    Deque<TreeNode> stack = new ArrayDeque<>();
    TreeNode cur = root;
    while (cur != null || !stack.isEmpty()) {
        // 一直往左走到头
        while (cur != null) {
            stack.push(cur);
            cur = cur.left;
        }
        // 弹出，访问，转向右子树
        cur = stack.pop();
        result.add(cur.val);
        cur = cur.right;
    }
    return result;
}
```

中序遍历 BST（二叉搜索树）的结果是**升序数组**，这是很多题目的突破口。


### 后序遍历（左 → 右 → 根）

```java
public List<Integer> postorderIter(TreeNode root) {
    List<Integer> result = new ArrayList<>();
    if (root == null) return result;
    Deque<TreeNode> stack = new ArrayDeque<>();
    stack.push(root);
    while (!stack.isEmpty()) {
        TreeNode node = stack.pop();
        result.add(node.val); // 根右左的顺序
        if (node.left != null) stack.push(node.left);
        if (node.right != null) stack.push(node.right);
    }
    Collections.reverse(result); // 翻转得到左右根
    return result;
}
```

**巧记**：后序遍历 = 前序遍历「根右左」→ 翻转得到「左右根」。


## 高频题二：二叉树的层序遍历

> 题目：返回其节点值的层序遍历（即逐层从左到右访问）。

```java
public List<List<Integer>> levelOrder(TreeNode root) {
    List<List<Integer>> result = new ArrayList<>();
    if (root == null) return result;
    Queue<TreeNode> queue = new ArrayDeque<>();
    queue.offer(root);
    while (!queue.isEmpty()) {
        int levelSize = queue.size();
        List<Integer> levelVals = new ArrayList<>();
        for (int i = 0; i < levelSize; i++) {
            TreeNode node = queue.poll();
            levelVals.add(node.val);
            if (node.left != null) queue.offer(node.left);
            if (node.right != null) queue.offer(node.right);
        }
        result.add(levelVals);
    }
    return result;
}
```


## 高频题三：路径总和

> 题目：判断是否存在根节点到叶子节点的路径，使得路径上所有节点值相加等于目标和。

```java
public boolean hasPathSum(TreeNode root, int targetSum) {
    if (root == null) return false;
    // 叶子节点：判断当前值是否等于目标和
    if (root.left == null && root.right == null) {
        return root.val == targetSum;
    }
    // 递归左右子树，目标值减去当前节点值
    return hasPathSum(root.left, targetSum - root.val)
        || hasPathSum(root.right, targetSum - root.val);
}
```


## 高频题四：二叉树的最近公共祖先（LCA）

**递归解法：**

```java
public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
    if (root == null || root == p || root == q) return root;
    // 在左右子树中分别找 p 和 q
    TreeNode left = lowestCommonAncestor(root.left, p, q);
    TreeNode right = lowestCommonAncestor(root.right, p, q);
    // 如果左右都找到了，说明 root 是 LCA
    if (left != null && right != null) return root;
    // 否则返回非空的那个
    return left != null ? left : right;
}
```

**核心思想**：
- 如果 p、q 分别在 root 的左右子树，则 root 就是 LCA
- 如果都在左子树，递归左子树
- 如果都在右子树，递归右子树
- 如果有一个等于 root，直接返回 root


## 高频题五：二叉搜索树的最近公共祖先

> BST 的特性：**左子树所有节点 < 根节点 < 右子树所有节点**。

```java
public TreeNode lowestCommonAncestorBST(TreeNode root, TreeNode p, TreeNode q) {
    while (root != null) {
        if (p.val < root.val && q.val < root.val) {
            root = root.left;  // p、q 都在左子树
        } else if (p.val > root.val && q.val > root.val) {
            root = root.right; // p、q 都在右子树
        } else {
            return root; // p、q 在 root 的两侧，root 就是 LCA
        }
    }
    return null;
}
```

比普通二叉树简单得多，因为可以根据值的大小判断方向。


## 二叉树面试总结

| 题型 | 递归要点 | 迭代要点 |
|------|----------|----------|
| 前序遍历 | 根 → 左 → 右 | 栈模拟，右先入左后入 |
| 中序遍历 | 左 → 根 → 右 | 栈模拟，一直往左走 |
| 后序遍历 | 左 → 右 → 根 | 前序翻转 / 双栈 |
| 层序遍历 | BFS 框架 | 队列 + 每层计数 |
| 路径总和 | target - node.val | 递归返回值 |
| 最近公共祖先 | 左右子树各找到一个 | 存储父节点再回溯 |


## 面试延伸问题

**Q：二叉树的递归算法，时间复杂度怎么分析？**

每个节点最多访问一次，所以是 **O(n)**。但递归深度最坏是 O(n)（链表状的二叉树），可能导致栈溢出。

**Q：什么时候用递归，什么时候用迭代？**

- 能用递归的，大多数也能用迭代（需要显式栈）
- 如果面试官追问非递归实现，要有准备
- BST 相关题目，优先考虑利用 BST 特性（值域判断）


## 练习建议

二叉树的题，关键在**画图**。

拿到题目后，先在纸上画出几棵典型的二叉树（满二叉树、倾斜树、平衡树），标注节点值，然后模拟算法过程。边画边思考，比盯着代码空想有效得多。

推荐刷题顺序：遍历三件套 → 层序遍历 → 路径问题 → BST 专题 → LCA 专题 → 综合变体。
