# 并查集：合并与查找


## 朋友圈与连通分量

微博的「好友关系」有一个有趣的特性：**如果 A 是 B 的好友，B 是 C 的好友，那么 A 和 C 也在同一个社交圈里**。

这种「传递性」的关系，在图论中叫做**连通分量**。

如果给你一张图，如何快速判断两个节点是否在同一个连通分量中？

答案就是**并查集**（Disjoint Set Union，DSU）。

并查集是解决「分组」问题的神器：社交网络、岛屿数量、朋友圈、最小生成树……到处都有它的身影。


## 并查集的基本操作

### 核心思想

并查集维护 N 个集合，每个集合有一个**代表元素**（通常叫「根」）。

- **find(x)**：找到 x 所在集合的代表元素
- **union(x, y)**：合并 x 和 y 所在的两个集合

### 并查集的「森林」表示

想象有 N 棵树，每棵树代表一个集合。树根就是集合的代表元素。

```
初始状态（5 个独立元素）:       合并 0-1, 2-3 后:

     0    1    2    3    4          0         2
     |              |               |         |         4
     ↓              ↓               ↓         ↓         ↓
     0    1    2    3    4          1         3         4

                                 (0-1 一组)  (2-3 一组)  (单独)
```

### 基本实现

```java
class UnionFind {
    private int[] parent;
    
    UnionFind(int size) {
        parent = new int[size];
        for (int i = 0; i < size; i++) {
            parent[i] = i;  // 每个元素的父节点是自身
        }
    }
    
    // 查找根节点（朴素版本）
    public int find(int x) {
        if (parent[x] == x) {
            return x;
        }
        return find(parent[x]);
    }
    
    // 合并两个集合
    public void union(int x, int y) {
        int px = find(x);
        int py = find(y);
        if (px != py) {
            parent[px] = py;  // 把 x 所在树的根指向 y 所在树的根
        }
    }
    
    // 判断是否在同一个集合
    public boolean connected(int x, int y) {
        return find(x) == find(y);
    }
}
```


## 路径压缩

### 问题

朴素实现的 find 操作，最坏情况下会退化成 O(n)。

```
合并顺序: 1-2, 2-3, 3-4, 4-5

形成的树:

     1
     /
    2
   /
  3
 /
4
/
5

find(5) 需要 5 次查找！
```

### 解决方案：路径压缩

在 find 过程中，把路径上的所有节点直接指向根节点。

```java
public int find(int x) {
    if (parent[x] != x) {
        parent[x] = find(parent[x]);  // 路径压缩
    }
    return parent[x];
}
```

```
压缩后:

        1 (根)
       / \ \
      5   2 3 4

find(5) 现在只需要 1 次查找！
```

**路径压缩的复杂度**：接近 O(1)，单次 find 最坏 O(log n)，摊还 O(α(n))，其中 α 是阿克曼函数的反函数，增长极慢，可以视为常数。


## 按秩合并

### 问题

如果总是把一个集合的根指向另一个集合的根，可能形成一棵很深的树。

### 解决方案：按秩合并

**秩**可以是树的高度或 size。合并时，把秩较小的树合并到秩较大的树上。

```java
class UnionFind {
    private int[] parent;
    private int[] rank;  // 秩
    
    UnionFind(int size) {
        parent = new int[size];
        rank = new int[size];
        for (int i = 0; i < size; i++) {
            parent[i] = i;
            rank[i] = 0;
        }
    }
    
    public int find(int x) {
        if (parent[x] != x) {
            parent[x] = find(parent[x]);  // 路径压缩
        }
        return parent[x];
    }
    
    public void union(int x, int y) {
        int px = find(x);
        int py = find(y);
        
        if (px == py) return;  // 已经在同一个集合
        
        // 按秩合并：秩小的合并到秩大的
        if (rank[px] < rank[py]) {
            parent[px] = py;
        } else if (rank[px] > rank[py]) {
            parent[py] = px;
        } else {
            parent[py] = px;
            rank[px]++;  // 秩相等时，合并后秩 +1
        }
    }
}
```

### 路径压缩 + 按秩合并

同时使用两种优化，并查集的复杂度达到 **O(α(n))**，几乎等于 O(1)。

```
α(10^80) < 5
```

这意味着，即使是宇宙中原子数量的级别，α 函数的值也不超过 5。


## 并查集的高级应用

### 1. 岛屿数量（LeetCode 200）

```java
public int numIslands(char[][] grid) {
    if (grid == null || grid.length == 0) return 0;
    
    int m = grid.length, n = grid[0].length;
    UnionFind uf = new UnionFind(m * n);
    
    // 初始化：把陆地上的格子作为单独的岛屿
    int zeroCount = 0;
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            if (grid[i][j] == '1') {
                int id = i * n + j;
                uf.makeSet(id);  // 实际上构造函数已经初始化了
            } else {
                zeroCount++;
            }
        }
    }
    
    // 遍历所有格子，把相邻的陆地合并
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            if (grid[i][j] == '1') {
                int id = i * n + j;
                // 上
                if (i > 0 && grid[i-1][j] == '1') {
                    uf.union(id, (i-1) * n + j);
                }
                // 左
                if (j > 0 && grid[i][j-1] == '1') {
                    uf.union(id, i * n + j - 1);
                }
            }
        }
    }
    
    // 总格子数 - 水格子数 = 岛屿数
    return uf.countSets() - zeroCount;
}
```

### 2. 图的连通分量数

```java
public int countComponents(int n, int[][] edges) {
    UnionFind uf = new UnionFind(n);
    for (int[] e : edges) {
        uf.union(e[0], e[1]);
    }
    return uf.countSets();
}
```

### 3. 判断是否为二分图

```java
public boolean isBipartite(int[][] graph) {
    int n = graph.length;
    int[] color = new int[n];  // 0: 未着色, 1: 红色, -1: 蓝色
    UnionFind uf = new UnionFind(n + 1);  // 多一个集合用于存储「红色组」
    
    for (int i = 0; i < n; i++) {
        for (int j : graph[i]) {
            // i 和 j 不能在同一颜色组
            if (color[i] == color[j]) return false;
            // 合并 i 和 j 的「对立方」
            uf.union(i, j + n);
            uf.union(i + n, j);
        }
    }
    return true;
}
```


## 并查集的复杂度分析

### 时间复杂度

- **朴素实现**：find O(n)，union O(n)
- **路径压缩**：find 摊还 O(α(n))，几乎常数
- **路径压缩 + 按秩合并**：所有操作摊还 O(α(n))

### 空间复杂度

O(n)，存储 parent 和 rank 数组。

### 为什么 α(n) 这么小？

α(n) 是阿克曼函数的反函数：

- α(4) = 2
- α(16) = 3
- α(65536) = 4
- α(2^65536) = 5

对于任何实际应用中的 n，α(n) ≤ 5。


## 实战：Kruskal 最小生成树

并查集最经典的应用之一是 Kruskal 最小生成树算法：

```java
public List&lt;int[]&gt; kruskal(int[][] graph, int n) {
    // 收集边
    List&lt;int[]&gt; edges = new ArrayList&lt;&gt;();
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            if (graph[i][j] != 0) {
                edges.add(new int[]{i, j, graph[i][j]});
            }
        }
    }
    
    // 按权重排序
    edges.sort(Comparator.comparingInt(a -> a[2]));
    
    // 并查集 + 贪心
    UnionFind uf = new UnionFind(n);
    List&lt;int[]&gt; mst = new ArrayList&lt;&gt;();
    
    for (int[] edge : edges) {
        int u = edge[0], v = edge[1], w = edge[2];
        if (!uf.connected(u, v)) {
            uf.union(u, v);
            mst.add(edge);
            if (mst.size() == n - 1) break;
        }
    }
    
    return mst;
}
```


## 总结

并查集是处理「分组」问题的利器，核心只有两个操作：find 和 union。

核心要点：

1. **路径压缩**：让 find 接近 O(1)
2. **按秩合并**：让树保持扁平
3. **两者结合**：摊还复杂度 O(α(n))，几乎等于 O(1)

并查集的应用场景：
- 连通分量检测
- 岛屿数量
- Kruskal 最小生成树
- 二分图检测
- 朋友圈计算

## 面试追问方向

- 并查集的两个核心操作是什么？（find 和 union）
- 什么是路径压缩？它有什么用？（让树变扁平，find 接近 O(1)）
- 什么是按秩合并？为什么需要它？（避免形成深度树，配合路径压缩效果最好）
- 并查集的时间复杂度是多少？（路径压缩 + 按秩合并：O(α(n))）
- 并查集有什么实际应用？（Kruskal、连通分量、岛屿数量）
