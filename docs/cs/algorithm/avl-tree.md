# AVL 树：平衡条件与旋转操作


## 为什么 BST 会变成「瘸子」？

想象你往一棵 BST 里依次插入：1, 2, 3, 4, 5, 6, 7...

这棵树会变成什么样？

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
                 \
                  6
                   \
                    7
```

一个好好的二叉树，变成了一个「链表」！查找变成了 O(n)，完全失去了 BST 的优势。

问题的根源：**左右子树高度差太大，树失去了平衡**。

解决方案：**让树在插入和删除时自动调整，保持平衡**。这就是**AVL 树**的核心思想。


## AVL 树的基本概念

### 什么是 AVL 树？

AVL 树是最早被发明的自平衡二叉查找树，由两位苏联数学家 Adelson-Velsky 和 Landis 在 1962 年提出。

**平衡条件**：对于任意节点，左右子树的高度差（平衡因子）绝对值不超过 1。

```
平衡的 BST:                    不平衡的 BST:
        4                            4
       / \                          /
      2   6                         2
     / \ / \                        \
    1  3 5  7                       3
   高度差: 0                         \
                                      5
高度差: 0                    高度差: 3（不平衡！）
```

### 平衡因子

平衡因子（Balance Factor）= 左子树高度 - 右子树高度

- BF = -1, 0, 1：平衡
- BF = -2, 2：不平衡，需要调整

```java
public class AVLNode {
    int val;
    AVLNode left;
    AVLNode right;
    int height;  // 记录高度
    
    AVLNode(int val) {
        this.val = val;
        this.height = 1;
    }
}
```


## AVL 树的旋转操作

当插入或删除节点导致不平衡时，需要通过**旋转**来恢复平衡。

### 单旋：LL 型（左左型）

**情况**：在节点的左子树的左孩子处插入，导致左子树比右子树高 2。

```
原始状态:          失衡状态:          旋转后:
      k2               k2                k1
     /                 /                 / \
    k1      →        k1        →        X   k2
   /                 / \
  k0                k0  Y              X, Y: 子树
 / \
X   Y
```

**例子**：插入 1, 2 后，3 导致了不平衡。

```java
// 右旋
private AVLNode rotateRight(AVLNode y) {
    AVLNode x = y.left;
    AVLNode b = x.right;
    
    // 旋转
    x.right = y;
    y.left = b;
    
    // 更新高度（注意顺序：先更新 y，再更新 x）
    y.height = Math.max(getHeight(y.left), getHeight(y.right)) + 1;
    x.height = Math.max(getHeight(x.left), getHeight(x.right)) + 1;
    
    return x;  // 返回新的根节点
}
```

### 单旋：RR 型（右右型）

**情况**：在节点的右子树的右孩子处插入，导致右子树比左子树高 2。

对称于 LL 型。

```java
// 左旋
private AVLNode rotateLeft(AVLNode x) {
    AVLNode y = x.right;
    AVLNode b = y.left;
    
    // 旋转
    y.left = x;
    x.right = b;
    
    // 更新高度
    x.height = Math.max(getHeight(x.left), getHeight(x.right)) + 1;
    y.height = Math.max(getHeight(y.left), getHeight(y.right)) + 1;
    
    return y;
}
```

### 双旋：LR 型（左右型）

**情况**：在节点的左子树的右孩子处插入。

单纯一次右旋无法解决问题，需要先对左子树左旋，再对当前节点右旋。

```
原始状态:          先左旋 k1:         再右旋 k2:
    k2                 k2                  k1
   /                   \                  / \
  k1         →         k1        →       k2   k3
    \                 /                  / \ / \
    k3               k3                  X  Y Z  W
   / \               / \
  Z   W             X   Y
```

**例子**：插入 1, 3, 2 后，3 导致了不平衡。

```java
// LR 型：先左旋再右旋
private AVLNode rotateLeftRight(AVLNode node) {
    node.left = rotateLeft(node.left);
    return rotateRight(node);
}
```

### 双旋：RL 型（右左型）

对称于 LR 型，先右旋再左旋。

```java
// RL 型：先右旋再左旋
private AVLNode rotateRightLeft(AVLNode node) {
    node.right = rotateRight(node.right);
    return rotateLeft(node);
}
```


## AVL 树的插入与删除

### 插入操作

```java
public AVLNode insert(AVLNode node, int val) {
    // 1. 普通 BST 插入
    if (node == null) return new AVLNode(val);
    
    if (val < node.val) {
        node.left = insert(node.left, val);
    } else if (val > node.val) {
        node.right = insert(node.right, val);
    } else {
        return node;  // 不允许重复
    }
    
    // 2. 更新高度
    node.height = Math.max(getHeight(node.left), getHeight(node.right)) + 1;
    
    // 3. 获取平衡因子，判断失衡类型
    int balance = getBalance(node);
    
    // 4. 四种失衡情况，分别处理
    // LL 型：右旋
    if (balance > 1 && val < node.left.val) {
        return rotateRight(node);
    }
    
    // RR 型：左旋
    if (balance < -1 && val > node.right.val) {
        return rotateLeft(node);
    }
    
    // LR 型：先左旋后右旋
    if (balance > 1 && val > node.left.val) {
        node.left = rotateLeft(node.left);
        return rotateRight(node);
    }
    
    // RL 型：先右旋后左旋
    if (balance < -1 && val < node.right.val) {
        node.right = rotateRight(node.right);
        return rotateLeft(node);
    }
    
    return node;
}
```

### 删除操作

删除比插入更复杂，因为：
1. 删除后可能需要回溯到祖先节点调整
2. 需要找到替代节点（前驱或后继）

```java
public AVLNode delete(AVLNode node, int val) {
    // 1. 普通 BST 删除
    if (node == null) return null;
    
    if (val < node.val) {
        node.left = delete(node.left, val);
    } else if (val > node.val) {
        node.right = delete(node.right, val);
    } else {
        // 找到要删除的节点
        if (node.left == null || node.right == null) {
            node = (node.left != null) ? node.left : node.right;
        } else {
            // 度为2：找后继
            AVLNode successor = findMin(node.right);
            node.val = successor.val;
            node.right = delete(node.right, successor.val);
        }
    }
    
    if (node == null) return null;
    
    // 2. 更新高度
    node.height = Math.max(getHeight(node.left), getHeight(node.right)) + 1;
    
    // 3. 恢复平衡（与插入类似，但需要递归向上调整）
    return rebalance(node);
}

private AVLNode rebalance(AVLNode node) {
    int balance = getBalance(node);
    
    // 左子树不平衡
    if (balance > 1) {
        if (getBalance(node.left) < 0) {
            // LR 型
            node.left = rotateLeft(node.left);
        }
        return rotateRight(node);
    }
    
    // 右子树不平衡
    if (balance < -1) {
        if (getBalance(node.right) > 0) {
            // RL 型
            node.right = rotateRight(node.right);
        }
        return rotateLeft(node);
    }
    
    return node;
}
```


## AVL 树 vs 红黑树

| 特性 | AVL 树 | 红黑树 |
|------|--------|--------|
| 平衡标准 | 严格（高度差 ≤ 1） | 近似（路径长度 ≤ 2 倍） |
| 插入/删除调整 | 可能多次旋转 | 最多 3 次旋转 |
| 查找性能 | 更优（更平衡） | 略逊（路径可能更长） |
| 适用场景 | 读多写少 | 读少写多 |
| 实现复杂度 | 较高 | 较低 |

**为什么 Java 的 HashMap 用红黑树而不是 AVL 树？**

因为 HashMap 的操作是插入+查找混合，插入/删除时 AVL 树需要更多的旋转来维持严格平衡，但这种「更平衡」带来的查找优势在 HashMap 场景下并不明显，反而增加了维护成本。


## AVL 树的性能分析

### 时间复杂度

| 操作 | 时间复杂度 |
|------|-----------|
| 查找 | O(log n) |
| 插入 | O(log n) |
| 删除 | O(log n) |

### 空间复杂度

O(n)，存储 n 个节点。

### 高度上界

AVL 树的高度上界：1.44 × log₂(n + 2) - 1.328

比普通 BST 的 n 好得多，和红黑树的 2 × log₂(n + 1) 接近。


## 实战：完整的 AVL 树实现

```java
public class AVLTree {
    private class Node {
        int val;
        Node left, right;
        int height;
        
        Node(int val) {
            this.val = val;
            this.height = 1;
        }
    }
    
    private Node root;
    
    private int getHeight(Node node) {
        return node == null ? 0 : node.height;
    }
    
    private int getBalance(Node node) {
        return node == null ? 0 : getHeight(node.left) - getHeight(node.right);
    }
    
    private Node rotateRight(Node y) {
        Node x = y.left;
        Node b = x.right;
        
        x.right = y;
        y.left = b;
        
        y.height = Math.max(getHeight(y.left), getHeight(y.right)) + 1;
        x.height = Math.max(getHeight(x.left), getHeight(x.right)) + 1;
        
        return x;
    }
    
    private Node rotateLeft(Node x) {
        Node y = x.right;
        Node b = y.left;
        
        y.left = x;
        x.right = b;
        
        x.height = Math.max(getHeight(x.left), getHeight(x.right)) + 1;
        y.height = Math.max(getHeight(y.left), getHeight(y.right)) + 1;
        
        return y;
    }
    
    public void insert(int val) {
        root = insert(root, val);
    }
    
    private Node insert(Node node, int val) {
        if (node == null) return new Node(val);
        
        if (val < node.val) {
            node.left = insert(node.left, val);
        } else if (val > node.val) {
            node.right = insert(node.right, val);
        } else {
            return node;
        }
        
        node.height = Math.max(getHeight(node.left), getHeight(node.right)) + 1;
        
        int balance = getBalance(node);
        
        // LL
        if (balance > 1 && val < node.left.val) {
            return rotateRight(node);
        }
        // RR
        if (balance < -1 && val > node.right.val) {
            return rotateLeft(node);
        }
        // LR
        if (balance > 1 && val > node.left.val) {
            node.left = rotateLeft(node.left);
            return rotateRight(node);
        }
        // RL
        if (balance < -1 && val < node.right.val) {
            node.right = rotateRight(node.right);
            return rotateLeft(node);
        }
        
        return node;
    }
    
    public boolean contains(int target) {
        Node cur = root;
        while (cur != null) {
            if (target == cur.val) return true;
            cur = target < cur.val ? cur.left : cur.right;
        }
        return false;
    }
}
```


## 总结

AVL 树是第一种自平衡二叉查找树，通过「旋转」操作在插入/删除时保持树的平衡。

核心要点：

1. **平衡条件**：左右子树高度差 ≤ 1
2. **四种失衡**：LL、RR、LR、RL
3. **旋转操作**：单旋（LL、RR）和双旋（LR、RL）
4. **性能**：严格平衡带来 O(log n) 查找，但插入/删除成本较高

AVL 树追求极致的查找性能，适合**读多写少**的场景；红黑树牺牲一点查找性能换取更快的插入/删除，适合**写入频繁**的场景。

## 面试追问方向

- AVL 树的平衡因子是什么？取值范围？（左高-右高，-1/0/1）
- 四种失衡情况分别是什么？分别对应什么旋转？（LL右旋、RR左旋、LR先左后右、RL先右后左）
- 为什么 LR 和 RL 需要双旋？（单旋无法解决问题）
- AVL 树和红黑树的区别？（平衡标准、旋转次数、适用场景）
- AVL 树的删除操作需要注意什么？（可能需要回溯调整）
