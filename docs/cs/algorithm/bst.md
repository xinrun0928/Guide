# 二叉查找树（BST）与平衡树


## 为什么需要「有序」的树？

普通的二叉树，节点可以随便插随便排。但这有什么用？

想象一下，如果我告诉你：**这棵树里任意一个节点的左子树所有节点都比它小，右子树所有节点都比它大**，会发生什么？

你只需要沿着一条路径向下找——最多树的高度次，就能判断一个值在不在树里。

这就是**二叉查找树**（Binary Search Tree，BST）的魔力：**把「查找」从 O(n) 优化到 O(log n)**。

但 BST 有一个致命弱点——它依赖于树的形状。如果数据有序插入，树就会退化成链表，查找变成 O(n)。

怎么解决？**平衡**。


## 二叉查找树（BST）

### BST 的定义

对于 BST 中的任意节点：
- 左子树的所有节点值 < 当前节点值
- 右子树的所有节点值 > 当前节点值
- 左右子树本身也是 BST

```
        8
       / \
      3   10
     / \    \
    1   6    14
      /  \   /
     4    7 13
```

### 节点定义

```java
public class BSTNode {
    int val;
    BSTNode left;
    BSTNode right;
    
    BSTNode(int val) {
        this.val = val;
    }
}
```

### BST 的核心操作

**1. 查找**

```java
public BSTNode search(BSTNode root, int target) {
    while (root != null && root.val != target) {
        if (target < root.val) {
            root = root.left;
        } else {
            root = root.right;
        }
    }
    return root;
}
```

**2. 插入**

```java
public BSTNode insert(BSTNode root, int val) {
    if (root == null) {
        return new BSTNode(val);
    }
    
    if (val < root.val) {
        root.left = insert(root.left, val);
    } else if (val > root.val) {
        root.right = insert(root.right, val);
    }
    // val == root.val 的情况：不插入（可重复则自行设计）
    
    return root;
}
```

**3. 删除（最复杂）**

删除有三种情况：

```java
public BSTNode delete(BSTNode root, int val) {
    if (root == null) return null;
    
    if (val < root.val) {
        root.left = delete(root.left, val);
    } else if (val > root.val) {
        root.right = delete(root.right, val);
    } else {
        // 找到要删除的节点
        if (root.left == null) return root.right;
        if (root.right == null) return root.left;
        
        // 度为2：找后继节点（右子树最左节点）
        BSTNode successor = findMin(root.right);
        root.val = successor.val;
        root.right = delete(root.right, successor.val);
    }
    return root;
}

private BSTNode findMin(BSTNode node) {
    while (node.left != null) {
        node = node.left;
    }
    return node;
}
```

### BST 的时间复杂度

| 操作 | 平均 | 最坏（树退化为链表） |
|------|------|---------------------|
| 查找 | O(log n) | O(n) |
| 插入 | O(log n) | O(n) |
| 删除 | O(log n) | O(n) |
| 找最大/最小 | O(log n) | O(n) |

**最坏情况**：按顺序插入 1, 2, 3, 4, 5...，树变成：

```
1
 \
  2
   \
    3
     \
      4
       \
        5
```

这就是为什么要引入**平衡树**。


## 平衡树：让树不再「倾斜」

### 什么是平衡？

平衡的定义有很多种：

1. **高度平衡**：对于每个节点，左右子树高度差不超过某个值（如 AVL 树的 1）
2. **重量平衡**：子树大小（节点数）相对平衡
3. **近似平衡**：不严格要求，但保证树的高度是 O(log n)

### 平衡树 vs 非平衡树

```
非平衡 BST（最坏情况）:      平衡 BST（理想情况）:
        1                        4
       / \                      / \
      2   3                    /   \
         / \                  2     6
        4   5                / \   / \
              \             1   3 5   7
               6
高度 = 5                    高度 = 2
复杂度 O(n)                  复杂度 O(log n)
```


## 常见平衡树类型

### 1. AVL 树（高度平衡）

- 性质：左右子树高度差 ≤ 1
- 旋转操作：单旋（LL、RR）、双旋（LR、RL）
- 查找性能好，但插入删除可能需要多次旋转

### 2. 红黑树（近似平衡）

- 性质：5条规则（后面专门讲）
- 高度最多是 2 × log(n+1)
- 插入删除最多只需 3 次旋转
- Java 的 HashMap（链表转红黑树）、TreeMap、ConcurrentHashMap 都在用

### 3. B 树 / B+ 树（多路平衡树）

- 节点可以有多个孩子（m 阶）
- 所有叶子节点在同一层
- 数据库索引的标配

### 4. 跳表（Skip List）

- 链表的「升维」：多层链表
- 实现简单，支持范围查询
- Redis 的 ZSet 在用


## BST 的变体：增删改查的权衡

### 普通 BST vs 平衡 BST

```java
// 普通 BST：简单，但可能退化为链表
// 平衡 BST：复杂，但保证性能

// 什么时候用普通 BST？
// - 数据随机插入（期望平衡）
// - 需要简单实现
// - 数据量小（n < 10000）

// 什么时候用平衡 BST？
// - 数据有序或近似有序
// - 对性能有严格要求
// - 需要保证最坏情况性能
```

### Treap：随机化的 BST

Treap = Tree + Heap，每个节点有优先级，满足 BST 性质的同时满足堆性质。

```java
public class TreapNode {
    int key;
    int priority;
    TreapNode left, right;
}
```

期望高度 O(log n)，实现简单，但最坏情况仍可能退化。

### Splay Tree：自适应平衡

被访问过的节点会「伸展」到根附近，热点数据访问效率高，但最坏情况仍是 O(n)。


## 实战：手写 BST 实现

```java
public class BinarySearchTree {
    private class Node {
        int val;
        Node left, right;
        Node(int val) { this.val = val; }
    }
    
    private Node root;
    
    public void insert(int val) {
        root = insertRec(root, val);
    }
    
    private Node insertRec(Node node, int val) {
        if (node == null) return new Node(val);
        
        if (val < node.val) {
            node.left = insertRec(node.left, val);
        } else if (val > node.val) {
            node.right = insertRec(node.right, val);
        }
        // 相等不插入
        return node;
    }
    
    public boolean contains(int target) {
        return containsRec(root, target);
    }
    
    private boolean containsRec(Node node, int target) {
        if (node == null) return false;
        if (target == node.val) return true;
        return target < node.val 
            ? containsRec(node.left, target) 
            : containsRec(node.right, target);
    }
    
    public void delete(int val) {
        root = deleteRec(root, val);
    }
    
    private Node deleteRec(Node node, int val) {
        if (node == null) return null;
        
        if (val < node.val) {
            node.left = deleteRec(node.left, val);
        } else if (val > node.val) {
            node.right = deleteRec(node.right, val);
        } else {
            if (node.left == null) return node.right;
            if (node.right == null) return node.left;
            
            node.val = findMin(node.right);
            node.right = deleteRec(node.right, node.val);
        }
        return node;
    }
    
    private int findMin(Node node) {
        while (node.left != null) node = node.left;
        return node.val;
    }
    
    // 中序遍历（有序）
    public void inorder() {
        inorderRec(root);
    }
    
    private void inorderRec(Node node) {
        if (node == null) return;
        inorderRec(node.left);
        System.out.print(node.val + " ");
        inorderRec(node.right);
    }
}
```


## BST 与其他数据结构的对比

| 数据结构 | 查找 | 插入 | 删除 | 范围查询 | 实现复杂度 |
|----------|------|------|------|----------|------------|
| 数组（无序） | O(n) | O(1) | O(n) | O(n) | 简单 |
| 数组（有序） | O(log n) | O(n) | O(n) | O(log n) | 简单 |
| 链表 | O(n) | O(1) | O(n) | O(n) | 简单 |
| BST | O(log n)~O(n) | O(log n)~O(n) | O(log n)~O(n) | O(log n)~O(n) | 中等 |
| 平衡 BST | O(log n) | O(log n) | O(log n) | O(log n) | 复杂 |
| 哈希表 | O(1) | O(1) | O(1) | 不支持 | 中等 |


## 总结

BST 的核心价值在于：**把查找从 O(n) 优化到 O(log n)**。

但 BST 的性能取决于树的形状，数据有序时会退化。解决方案是**平衡**：

- **AVL**：严格平衡，查找最快，插入删除较慢
- **红黑树**：近似平衡，插入删除快，Java 标准库在用
- **B/B+ 树**：多路平衡，磁盘友好，数据库在用

没有绝对的「最好」，只有「最适合场景」。

## 面试追问方向

- BST 的查找、插入、删除时间复杂度？（最坏 O(n)，平均 O(log n)）
- 删除度为 2 的节点时，为什么用后继节点替换？（保持 BST 性质）
- 为什么有了 HashMap 还需要 TreeMap？（有序、范围查询）
- 红黑树的 5 条性质是什么？（根黑、叶黑、红子必黑、路径黑数相同）
- AVL 和红黑树的区别？（AVL 更严格，平衡因子 ≤ 1；红黑树允许路径长度差 2 倍）
