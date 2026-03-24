# 红黑树：五大性质与插入修复


## 面试官问你：「HashMap 底层用什么？」

你答：「JDK 8 之后用数组+链表+红黑树。」

面试官点点头，又问：「红黑树有什么性质？」

你愣了一下：「嗯……好像有几个约束条件……大概记得是关于节点颜色的……」

如果你对红黑树只停留在「听说过」的程度，那这道题就是送命题。

红黑树是 Java 标准库中最常用的平衡树：HashMap 的链表转红黑树、TreeMap、ConcurrentHashMap 的部分实现……到处都是它的身影。

但红黑树真正难的不是「知道它是什么」，而是**理解它为什么这样设计**。

今天，让我们彻底搞懂红黑树。


## 红黑树的五大性质

红黑树（Red-Black Tree）是一种**近似平衡**的二叉查找树。它通过节点的颜色标记和一套严格的规则，保证树的高度大致在 O(log n)。

**红黑树的五大性质（背下来！）：**

1. **每个节点要么是红色，要么是黑色**
2. **根节点是黑色**
3. **叶子节点（NIL）是黑色**（这里的叶子节点是空节点，不是普通叶子）
4. **红色节点的子节点必须是黑色**（不能出现两个连续的红色节点）
5. **从任一节点到其每个叶子的路径上，黑色的数量相同**（黑高相同）

```
        B(黑)                          B(黑)
       /    \                         /    \
     R(红)   B(黑)       ≠          R(红)   R(红)  ← 违反性质4
      ↓       ↓                        ↓       ↓
     B(黑)   B(黑)                  B(黑)   B(黑)
```

**性质 5 的含义**：每条路径的黑色节点数相同，保证树是「黑平衡」的。

这意味着，即使红黑树不是高度严格平衡的（左右子树高度差可能达到 2 倍），但从黑高角度，它是平衡的，查找复杂度仍是 O(log n)。


## 红黑树 vs AVL 树

在深入红黑树之前，先看看它和 AVL 树的区别：

| 特性 | AVL 树 | 红黑树 |
|------|--------|--------|
| 平衡标准 | 严格（高度差 ≤ 1） | 近似（黑高平衡） |
| 高度上界 | 1.44 × log n | 2 × log n |
| 插入/删除 | 最多 O(log n) 次旋转 | 最多 3 次旋转 |
| 查找性能 | 更快 | 略慢（但常数因子不大） |
| 实现复杂度 | 较高 | 中等 |

**为什么 Java 选红黑树而不是 AVL 树？**

因为 Java 的集合框架（HashMap、TreeMap）需要频繁插入和删除。AVL 树的严格平衡虽然带来更好的查找性能，但插入/删除时可能需要多次旋转。红黑树的近似平衡牺牲一点查找性能，但大大简化了插入/删除操作（最多 3 次旋转）。


## 红黑树的旋转与修复

### 基本旋转操作

红黑树的旋转和 AVL 树类似，分为左旋和右旋：

```java
private void rotateLeft(Node x) {
    Node y = x.right;
    x.right = y.left;
    if (y.left != null) y.left.parent = x;
    y.parent = x.parent;
    
    if (x.parent == null) {
        root = y;
    } else if (x == x.parent.left) {
        x.parent.left = y;
    } else {
        x.parent.right = y;
    }
    
    y.left = x;
    x.parent = y;
}
```

### 插入的修复

**插入的两种情况：**

插入的节点默认为红色。

- **情况 1**：父节点是黑色——无需修复（不影响黑高，不违反性质 4）
- **情况 2**：父节点是红色——需要修复

**修复的三种情况（叔节点颜色决定）：**

```java
public void insert(int val) {
    Node node = new Node(val);
    node.color = Color.RED;  // 新节点默认为红色
    
    // 1. 普通 BST 插入
    insertBST(node);
    
    // 2. 修复红黑树性质
    fixInsert(node);
}

private void fixInsert(Node node) {
    while (node.parent != null && node.parent.color == Color.RED) {
        if (node.parent == node.parent.parent.left) {
            Node uncle = node.parent.parent.right;
            
            // 情况 1：叔节点是红色
            if (uncle != null && uncle.color == Color.RED) {
                node.parent.color = Color.BLACK;
                uncle.color = Color.BLACK;
                node.parent.parent.color = Color.RED;
                node = node.parent.parent;
            } else {
                // 情况 2 & 3：叔节点是黑色
                if (node == node.parent.right) {
                    node = node.parent;
                    rotateLeft(node);  // 转为 LL 型
                }
                node.parent.color = Color.BLACK;
                node.parent.parent.color = Color.RED;
                rotateRight(node.parent.parent);
            }
        } else {
            // 对称情况（父节点是右孩子）
            Node uncle = node.parent.parent.left;
            
            if (uncle != null && uncle.color == Color.RED) {
                node.parent.color = Color.BLACK;
                uncle.color = Color.BLACK;
                node.parent.parent.color = Color.RED;
                node = node.parent.parent;
            } else {
                if (node == node.parent.left) {
                    node = node.parent;
                    rotateRight(node);
                }
                node.parent.color = Color.BLACK;
                node.parent.parent.color = Color.RED;
                rotateLeft(node.parent.parent);
            }
        }
    }
    
    // 根节点必须是黑色
    root.color = Color.BLACK;
}
```

**修复的三种情况图解：**

```
情况 1：叔节点是红色
        G(黑)                    G(红)
       /   \                    /    \
     P(红) U(红)      →        P(黑)  U(黑)
       \                      \
       N(红)                   N(红)
需要：P、U 变黑，G 变红，继续向上检查

情况 2：叔节点是黑，且 N 是右孩子
        G(黑)                    G(黑)
       /   \                    /    \
     P(红) U(黑)      →        N(红)  U(黑)
       \                      /
       N(红)                  P(红)
需要：左旋 P，转化为情况 3

情况 3：叔节点是黑，且 N 是左孩子
        G(黑)                    P(黑)
       /   \                    /    \
     P(红) U(黑)      →        N(红)  G(红)
     /                              \
   N(红)                             U(黑)
需要：P 变黑，G 变红，右旋 G
```


## 红黑树的删除

删除比插入更复杂，需要考虑：

1. 删除的是红色还是黑色节点
2. 删除节点的替代节点是谁（前驱/后继）
3. 删除后是否影响黑高

删除的修复核心思想是**「借」或「染」**：

- 借：旋转，借节点过来
- 染：把兄弟节点染红，继续向上修复

```java
private void fixDelete(Node node) {
    while (node != root && node.color == Color.BLACK) {
        if (node == node.parent.left) {
            Node sibling = node.parent.right;
            
            // 兄弟是红色
            if (sibling.color == Color.RED) {
                sibling.color = Color.BLACK;
                node.parent.color = Color.RED;
                rotateLeft(node.parent);
                sibling = node.parent.right;
            }
            
            // 兄弟是黑色，两个侄子都是黑色
            if (sibling.left.color == Color.BLACK && 
                sibling.right.color == Color.BLACK) {
                sibling.color = Color.RED;
                node = node.parent;
            } else {
                // 右侄子黑，左侄子红
                if (sibling.right.color == Color.BLACK) {
                    sibling.left.color = Color.BLACK;
                    sibling.color = Color.RED;
                    rotateRight(sibling);
                    sibling = node.parent.right;
                }
                
                // 右侄子红
                sibling.color = node.parent.color;
                node.parent.color = Color.BLACK;
                sibling.right.color = Color.BLACK;
                rotateLeft(node.parent);
                node = root;
            }
        } else {
            // 对称情况
            Node sibling = node.parent.left;
            
            if (sibling.color == Color.RED) {
                sibling.color = Color.BLACK;
                node.parent.color = Color.RED;
                rotateRight(node.parent);
                sibling = node.parent.left;
            }
            
            if (sibling.right.color == Color.BLACK && 
                sibling.left.color == Color.BLACK) {
                sibling.color = Color.RED;
                node = node.parent;
            } else {
                if (sibling.left.color == Color.BLACK) {
                    sibling.right.color = Color.BLACK;
                    sibling.color = Color.RED;
                    rotateLeft(sibling);
                    sibling = node.parent.left;
                }
                
                sibling.color = node.parent.color;
                node.parent.color = Color.BLACK;
                sibling.left.color = Color.BLACK;
                rotateRight(node.parent);
                node = root;
            }
        }
    }
    
    node.color = Color.BLACK;
}
```


## 红黑树的性能分析

### 时间复杂度

| 操作 | 时间复杂度 |
|------|-----------|
| 查找 | O(log n) |
| 插入 | O(log n) |
| 删除 | O(log n) |

### 空间复杂度

O(n)，存储 n 个节点 + 颜色标记。

### 为什么插入最多 3 次旋转？

红黑树的插入修复最多涉及：
- 情况 1：变色 + 指针上移（不旋转）
- 情况 2：一次旋转 + 变色
- 情况 3：两次旋转 + 变色

无论哪种情况，旋转次数不超过 2 次（LR/RL 型），加上初始的 BST 插入，总共不超过 3 次旋转。


## 红黑树的实际应用

### Java 中的应用

1. **HashMap（JDK 8+）**：当链表长度 > 8 且数组长度 >= 64 时，链表转为红黑树
2. **TreeMap**：基于红黑树实现的有序 Map
3. **ConcurrentHashMap（JDK 8+）**：部分操作使用红黑树优化
4. **TreeSet**：基于 TreeMap 的有序 Set

### 其他应用

- **Linux 内核**：CFS 调度器使用红黑树管理进程
- **Epoll**：红黑树管理文件描述符
- **Nginx**：红黑树管理定时器


## 总结

红黑树是工程中最成功的平衡树——它在「查找性能」和「维护成本」之间取得了很好的平衡。

核心要点：

1. **五大性质**：根黑、叶黑、红子黑、黑高相同
2. **旋转次数**：最多 3 次（插入/删除）
3. **黑高平衡**：保证 O(log n) 查找
4. **工程价值**：Java 标准库的最爱

理解红黑树的关键不是「背代码」，而是**理解为什么这样设计**：用颜色标记代替严格的平衡条件，用最多 3 次旋转换取 O(log n) 的性能保证。

## 面试追问方向

- 红黑树的五大性质是什么？（根黑、叶黑、红子黑、黑高相同）
- 红黑树的高度上界是多少？（2 × log₂(n+1)）
- 插入新节点时，为什么默认是红色而不是黑色？（黑色会影响黑高平衡，需要更复杂的修复）
- 红黑树和 AVL 树的取舍？（红黑树：插入删除快；AVL：查找更快）
- 为什么 HashMap 选择红黑树而不是 AVL 树？（写入频繁，需要更少的旋转）
