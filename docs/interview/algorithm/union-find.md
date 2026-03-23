# 并查集：朋友圈数量、岛屿数量

> 假设有 n 个人，如果有两个人是朋友，我们就说他们在同一个朋友圈里。现在给你若干对「朋友关系」，问你一共有多少个朋友圈。

暴力做法是建图然后 BFS/DFS。但如果我告诉你，还有一种更优雅的解法——**并查集**，只需要几行代码呢？


## 并查集是什么

并查集（Union-Find）是一种数据结构，专门用来处理「动态连通性」问题。它的核心就两个操作：

1. **Find**：找到元素所属的集合（代表元）
2. **Union**：合并两个集合

想象一下：你有一堆城市，高速公路把它们连成网络。Find 就是问「某两个城市是否连通」，Union 就是「再建一条公路」。


## 并查集的优雅实现

### 基本版本

```java
class UnionFind {
    private int[] parent; // parent[i] 表示 i 的父节点

    public UnionFind(int n) {
        parent = new int[n];
        for (int i = 0; i < n; i++) {
            parent[i] = i; // 初始时，每个元素都是自己的父节点
        }
    }

    // 查找：返回元素 x 的代表元（根节点）
    public int find(int x) {
        if (parent[x] != x) {
            parent[x] = find(parent[x]); // 路径压缩：直接指向根节点
        }
        return parent[x];
    }

    // 合并：将 x 和 y 所在集合合并
    public void union(int x, int y) {
        int px = find(x);
        int py = find(y);
        if (px != py) {
            parent[px] = py; // 让 px 的根指向 py 的根
        }
    }

    // 判断 x 和 y 是否在同一集合
    public boolean connected(int x, int y) {
        return find(x) == find(y);
    }
}
```

**为什么要路径压缩？**

因为树可能会变得很高，每次 find 都要从叶子走到根。为了避免这种退化，我们在 find 时把路径上的所有节点都直接指向根——这就是「路径压缩」。

### 带「秩」的优化版本

```java
class UnionFind {
    private int[] parent;
    private int[] rank; // 秩：树的深度估计

    public UnionFind(int n) {
        parent = new int[n];
        rank = new int[n];
        for (int i = 0; i < n; i++) {
            parent[i] = i;
            rank[i] = 1; // 初始秩都是 1
        }
    }

    public int find(int x) {
        if (parent[x] != x) {
            parent[x] = find(parent[x]); // 路径压缩
        }
        return parent[x];
    }

    public void union(int x, int y) {
        int px = find(x);
        int py = find(y);
        if (px == py) return; // 已经在同一集合

        // 按秩合并：小秩的根指向大秩的根
        if (rank[px] < rank[py]) {
            parent[px] = py;
        } else if (rank[px] > rank[py]) {
            parent[py] = px;
        } else {
            parent[py] = px;
            rank[px]++; // 高度相同时，合并后秩加 1
        }
    }
}
```

**为什么按秩合并？**

如果总是让大树吃掉小树，树的高度会保持较低水平。按秩合并 + 路径压缩，可以做到近乎 O(1) 的均摊复杂度。


## 经典问题：朋友圈数量

> 题目：给定一个 N × N 的矩阵 `isConnected`，其中 `isConnected[i][j] = 1` 表示第 i 个人和第 j 个人是直接朋友。返回朋友圈的数量。

```java
public int findCircleNum(int[][] isConnected) {
    int n = isConnected.length;
    UnionFind uf = new UnionFind(n);
    int provinces = n; // 初始朋友圈数量 = 人数

    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            if (isConnected[i][j] == 1) {
                // 如果 i 和 j 是朋友，且不在同一朋友圈
                if (!uf.connected(i, j)) {
                    uf.union(i, j);
                    provinces--; // 朋友圈数量减 1
                }
            }
        }
    }
    return provinces;
}
```

**为什么用 `j = i + 1`？**

矩阵是对称的，`isConnected[i][j] = isConnected[j][i]`，所以只需要遍历上三角。


## 经典问题：岛屿数量

> 题目：给定一个二维网格地图（'1' 表示陆地，'0' 表示水域），计算岛屿的数量。

```java
public int numIslands(char[][] grid) {
    if (grid == null || grid.length == 0) return 0;

    int m = grid.length;
    int n = grid[0].length;
    UnionFind uf = new UnionFind(m * n);
    int islands = 0;

    // 先统计所有陆地的数量
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            if (grid[i][j] == '1') {
                islands++;
            }
        }
    }

    // 遍历网格，合并相邻的陆地
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            if (grid[i][j] == '1') {
                int idx = i * n + j;
                // 向下合并
                if (i + 1 < m && grid[i + 1][j] == '1') {
                    uf.union(idx, (i + 1) * n + j);
                }
                // 向右合并
                if (j + 1 < n && grid[i][j + 1] == '1') {
                    uf.union(idx, i * n + (j + 1));
                }
            }
        }
    }

    // 最终岛屿数量 = 初始岛屿数量 - 被合并掉的岛屿数量
    // 等价于：数有多少个不同的根节点
    Set<Integer> roots = new HashSet<>();
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            if (grid[i][j] == '1') {
                roots.add(uf.find(i * n + j));
            }
        }
    }
    return roots.size();
}
```

**为什么用并查集而不是 BFS/DFS？**

BFS/DFS 需要递归或栈，而且每次访问都要标记。并查集的优势是「合并」而不是「遍历」——只需要处理相邻关系，时间复杂度更稳定。


## 进阶问题：被围绕的区域

> 题目：给定一个包含 'X' 和 'O' 的二维网格，找出所有被 'X' 包围的区域，并把该区域内的 'O' 变成 'X'。

```java
public void solve(char[][] board) {
    if (board == null || board.length == 0) return;

    int m = board.length;
    int n = board[0].length;
    UnionFind uf = new UnionFind(m * n + 1); // 多一个虚拟节点表示边界

    int dummy = m * n; // 虚拟节点的索引

    // 先把所有边界的 O 都和虚拟节点合并
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            if (board[i][j] == 'O') {
                if (i == 0 || i == m - 1 || j == 0 || j == n - 1) {
                    uf.union(i * n + j, dummy);
                }
            }
        }
    }

    // 合并内部相邻的 O
    int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
    for (int i = 1; i < m - 1; i++) {
        for (int j = 1; j < n - 1; j++) {
            if (board[i][j] == 'O') {
                for (int[] d : dirs) {
                    int ni = i + d[0];
                    int nj = j + d[1];
                    if (board[ni][nj] == 'O') {
                        uf.union(i * n + j, ni * n + nj);
                    }
                }
            }
        }
    }

    // 所有不和虚拟节点相连的 O，都被 X 包围
    for (int i = 1; i < m - 1; i++) {
        for (int j = 1; j < n - 1; j++) {
            if (board[i][j] == 'O' && !uf.connected(i * n + j, dummy)) {
                board[i][j] = 'X';
            }
        }
    }
}
```

**为什么要用虚拟节点？**

把边界的 O 都和一个「虚拟节点」合并，之后只需要检查「是否和虚拟节点连通」就能知道是否被包围。反向思维——「找出不需要变的那部分」，比「找出需要变的那部分」更简单。


## 并查集小结

| 操作 | 时间复杂度 | 说明 |
|------|------------|------|
| find | α(n) ≈ O(1) | 加上路径压缩后，几乎是常数 |
| union | α(n) ≈ O(1) | 加上按秩合并后，几乎是常数 |
| connected | α(n) ≈ O(1) | 复用 find |

α(n) 是阿克曼函数的反函数，增长极慢，在宇宙毁灭前都可以当作常数。


## 面试追问预判

1. **并查集和 DFS/BFS 相比，有什么优劣？**
   - 并查集：适合「合并」操作多于「查询」的场景，代码简洁
   - DFS/BFS：适合需要遍历所有节点、找连通分量的场景

2. **什么时候用路径压缩，什么时候用按秩合并？**
   - 两个优化可以单独使用，也可以一起用
   - 一起用时，复杂度接近 O(1)

3. **并查集能处理删除操作吗？**
   - 不能。并查集只支持「合并」，不支持「分裂」
   - 如果需要删除，需要用其他数据结构（如链表 + 并查集）


## 记忆口诀

> **并查集，两个操。**
> **Find 找老大，Union 来合并。**
> **路径压缩找根快，按秩合并树不深。**


## 练习建议

1. **入门**：朋友圈数量 → 岛屿数量
2. **进阶**：被围绕的区域 → 省份数量
3. **挑战**：合并石子（一堆合并成一堆）→ 最小生成树

并查集教会我们一件事：**合并比分裂简单**。有时候，换个角度思考问题，答案就简单了。
