# 最小生成树：Prim 与 Kruskal


## 如何用最低成本铺光缆？

假设你是电信公司的工程师，需要在城市之间铺设光缆。

有 n 个城市，某些城市之间可以铺设光缆，但每条线路的铺设成本不同。

你的任务是：**用最小的总成本，把所有城市连接起来**。

这就是**最小生成树**（Minimum Spanning Tree，MST）问题。

注意两个关键约束：
1. **生成树**：包含所有顶点，但边数 = 顶点数 - 1，无环
2. **最小**：边的总权重最小

```
原图:                      最小生成树:
A---2---B                  A
| \3   5/|                  \
2   X   3                   2
| /4   2\|                  B---3---C
C---1---D                      \
                               1
                            D

最小生成树总成本: 2 + 2 + 3 + 1 = 8
```


## 最小生成树的基础知识

### 切分定理（Cut Property）

切分定理是所有 MST 算法的理论基础：

> 把图中的顶点分成两部分，这是一个**切分（Cut）**。
> 如果一条边的权重小于横跨该切分的所有其他边，那么这条边必然属于某个最小生成树。

```
    切分:           A | B C D
       A---2---B   
      2\   X   3/   
       X   5   X    
      1/   2   3\   
       C---1---D   

横跨切分的边: 2, 3, 1
最小边是 1 (C-D)，它必然属于 MST
```

### MST 的性质

1. **存在性**：如果所有边权重不同， MST 唯一
2. **边数**： n 个顶点的 MST 恰好有 n-1 条边
3. **切分定理**：所有 MST 算法都可以用切分定理解释


## Prim 算法：从点出发

### 核心思想

Prim 算法从任意一个顶点开始，**像染色一样不断向外扩展**。

每一步都选择连接已染色顶点和未染色顶点的**最小权重边**。

这本质上是不断应用切分定理——每次选择的都是横跨切分的最小边。

### 算法步骤

1. 从任意顶点开始，将其加入生成树
2. 重复直到所有顶点都被加入：
   - 找到连接生成树内和生成树外的最小边
   - 将该边和对应的顶点加入生成树

### Java 实现

```java
public List&lt;int[]&gt; prim(int[][] graph) {
    int n = graph.length;
    boolean[] inMST = new boolean[n];
    int[] minEdge = new int[n];  // 到生成树的最小边权重
    int[] parent = new int[n];   // 最小边的父节点
    Arrays.fill(minEdge, Integer.MAX_VALUE);
    minEdge[0] = 0;  // 从顶点 0 开始
    parent[0] = -1;
    
    List&lt;int[]&gt; mst = new ArrayList&lt;&gt;();
    
    for (int i = 0; i < n; i++) {
        // 1. 选择最小边
        int u = -1;
        int minWeight = Integer.MAX_VALUE;
        for (int v = 0; v < n; v++) {
            if (!inMST[v] && minEdge[v] < minWeight) {
                u = v;
                minWeight = minEdge[v];
            }
        }
        
        inMST[u] = true;
        if (parent[u] != -1) {
            mst.add(new int[]{parent[u], u, minWeight});
        }
        
        // 2. 更新邻居的最小边
        for (int v = 0; v < n; v++) {
            if (!inMST[v] && graph[u][v] != 0 && graph[u][v] < minEdge[v]) {
                minEdge[v] = graph[u][v];
                parent[v] = u;
            }
        }
    }
    
    return mst;
}
```

### 优化：优先队列

```java
public List&lt;int[]&gt; primOptimized(int[][] graph) {
    int n = graph.length;
    boolean[] inMST = new boolean[n];
    List&lt;int[]&gt; mst = new ArrayList&lt;&gt;();
    
    // 优先队列：(权重, from, to)
    PriorityQueue&lt;int[]&gt; pq = new PriorityQueue&lt;&gt;(
        Comparator.comparingInt(a -> a[0]));
    pq.offer(new int[]{0, -1, 0});  // 从顶点 0 开始
    
    while (!pq.isEmpty() && mst.size() < n) {
        int[] edge = pq.poll();
        int w = edge[0], u = edge[2];
        
        if (inMST[u]) continue;
        
        inMST[u] = true;
        if (edge[1] != -1) {
            mst.add(edge);
        }
        
        for (int v = 0; v < n; v++) {
            if (!inMST[v] && graph[u][v] != 0 && graph[u][v] < findMinEdge(v, graph, inMST)) {
                pq.offer(new int[]{graph[u][v], u, v});
            }
        }
    }
    
    return mst;
}
```

### 复杂度

- 朴素版本：O(V²)
- 优先队列版本：O(E log V)

### Prim vs Dijkstra

Prim 和 Dijkstra 的代码几乎一模一样，区别在于：

- **Dijkstra**：用 `dist[v]` 记录源点到 v 的最短距离
- **Prim**：用 `minEdge[v]` 记录到生成树的最小边权重

两者都是贪心算法，都可以用优先队列优化。


## Kruskal 算法：从边出发

### 核心思想

Kruskal 算法的核心是**把所有边按权重排序，从小到大依次加入**。

如果加入一条边会导致生成树有环，就跳过它（用并查集检测）。

最终加入的 n-1 条边就构成了 MST。

### 算法步骤

1. 将所有边按权重从小到大排序
2. 依次遍历每条边：
   - 如果这条边的两个顶点不在同一个集合（不连通），加入这条边，合并两个集合
   - 否则跳过（会形成环）
3. 直到加入了 n-1 条边

### Java 实现

```java
public List&lt;int[]&gt; kruskal(int[][] graph) {
    int n = graph.length;
    List&lt;int[]&gt; edges = new ArrayList&lt;&gt;();
    
    // 收集所有边
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            if (graph[i][j] != 0) {
                edges.add(new int[]{i, j, graph[i][j]});
            }
        }
    }
    
    // 按权重排序
    edges.sort(Comparator.comparingInt(a -> a[2]));
    
    // 并查集
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

### 并查集的实现

```java
class UnionFind {
    private int[] parent;
    private int[] rank;
    
    UnionFind(int n) {
        parent = new int[n];
        rank = new int[n];
        for (int i = 0; i < n; i++) {
            parent[i] = i;
        }
    }
    
    public int find(int x) {
        if (parent[x] != x) {
            parent[x] = find(parent[x]);  // 路径压缩
        }
        return parent[x];
    }
    
    public void union(int x, int y) {
        int px = find(x), py = find(y);
        if (px == py) return;
        
        // 按秩合并
        if (rank[px] < rank[py]) {
            parent[px] = py;
        } else if (rank[px] > rank[py]) {
            parent[py] = px;
        } else {
            parent[py] = px;
            rank[px]++;
        }
    }
    
    public boolean connected(int x, int y) {
        return find(x) == find(y);
    }
}
```

### 复杂度

- 排序：O(E log E)
- 并查集操作：O(E × α(V)) ≈ O(E)
- 总复杂度：O(E log E) = O(E log V)（因为 E ≤ V²）


## Prim vs Kruskal

| 特性 | Prim | Kruskal |
|------|------|---------|
| 起点 | 任意顶点 | 所有边排序 |
| 贪心策略 | 选最小切分边 | 选最小边 |
| 适合图 | 稠密图 | 稀疏图 |
| 时间复杂度 | O(V²) / O(E log V) | O(E log V) |
| 实现方式 | 顶点扩展 | 边扩展 |
| 需要的数据结构 | 数组或优先队列 | 排序 + 并查集 |

### 选择建议

- **图很稠密**（E ≈ V²）：用 Prim（朴素版本）
- **图很稀疏**（E ≈ V）：用 Kruskal
- **需要从一个点扩展**：用 Prim
- **实现简单**：Kruskal 更直观


## 实战：MST 的应用

### 1. 网络设计

铺设光缆、管道、公路等，成本最小化。

### 2. 聚类分析

将 n 个点分成 k 类，可以先求 MST，再删除最长的 k-1 条边。

### 3. 近似算法

旅行商问题的近似解可以用 MST 的两倍长度近似。


## 总结

最小生成树是经典的图论问题，Prim 和 Kruskal 是两种基本算法：

1. **Prim**：从点出发，每次选最小切分边，适合稠密图
2. **Kruskal**：从边出发，先排序后贪心合并，适合稀疏图

两者都基于切分定理，本质都是贪心算法。

## 面试追问方向

- 切分定理是什么？为什么它是 MST 的理论基础？
- Prim 和 Kruskal 的时间复杂度各是多少？（Prim: O(V²) 或 O(E log V), Kruskal: O(E log V)）
- 什么时候用 Prim，什么时候用 Kruskal？（稠密 vs 稀疏）
- 为什么 Kruskal 需要并查集？（检测环、合并集合）
- 如果图不连通，Prim 和 Kruskal 会怎样？（Prim: 只生成一棵树；Kruskal: 生成森林）
