# 最短路径：Dijkstra、Floyd、Bellman-Ford


## 导航软件是怎么工作的？

你打开导航软件，输入目的地。

软件显示：「预计 30 分钟，途经 5 个红绿灯，避开拥堵路段」。

它是怎么在几秒钟内，从全国几百万公里的路网中，算出最优路径的？

这就是**最短路径算法**要解决的问题。

根据不同的场景，有不同的算法：单源最短路、多源最短路、负权边……今天，我们来逐一解析。


## 图的基础回顾

在讨论最短路径之前，先回顾几个关键概念：

- **有权图**：边有权重，可以是距离、时间、成本等
- **路径长度**：路径上所有边的权重之和
- **单源最短路**：从一个源点到所有其他点的最短路径
- **多源最短路**：所有点对之间的最短路径

```
        2
   A ------- B
   |  \     |
  1|   \5   |3
   |     \  |
   C-------D
        4

A 到 D 的最短路径: A → C → D = 1 + 4 = 5
（而不是 A → B → D = 2 + 3 = 5，或 A → D = 5）
```


## Dijkstra 算法：单源非负权最短路

### 核心思想

Dijkstra 算法的核心是**贪心**：每次选择当前距离源点最近的未确定节点，确定它的最短距离。

**为什么是贪心？**

因为边的权重非负，当某个节点的最短距离被确定后，它就不可能再被更短的路径更新了。

### 算法步骤

1. 初始化：源点距离为 0，其他节点距离为 ∞
2. 从未确定的节点中，选择距离最小的节点 u
3. 确定 u 的最短距离，并用 u 松弛其邻居
4. 重复 2-3，直到所有节点都被确定

### Java 实现

```java
public int[] dijkstra(int[][] graph, int source) {
    int n = graph.length;
    int[] dist = new int[n];
    boolean[] visited = new boolean[n];
    Arrays.fill(dist, Integer.MAX_VALUE);
    dist[source] = 0;
    
    for (int i = 0; i < n; i++) {
        // 1. 找到未确定节点中距离最小的
        int u = -1;
        int minDist = Integer.MAX_VALUE;
        for (int v = 0; v < n; v++) {
            if (!visited[v] && dist[v] < minDist) {
                u = v;
                minDist = dist[v];
            }
        }
        
        if (u == -1) break;  // 图不连通
        visited[u] = true;
        
        // 2. 用 u 松弛其邻居
        for (int v = 0; v < n; v++) {
            if (graph[u][v] != 0 && !visited[v]) {
                int newDist = dist[u] + graph[u][v];
                if (newDist < dist[v]) {
                    dist[v] = newDist;
                }
            }
        }
    }
    
    return dist;
}
```

### 优化：优先队列

朴素实现每次找最小节点需要 O(V)，总复杂度 O(V²)。使用优先队列优化后：

```java
public int[] dijkstraOptimized(int[][] graph, int source) {
    int n = graph.length;
    int[] dist = new int[n];
    Arrays.fill(dist, Integer.MAX_VALUE);
    dist[source] = 0;
    
    // 优先队列：(距离, 节点)
    PriorityQueue&lt;int[]&gt; pq = new PriorityQueue&lt;&gt;(
        Comparator.comparingInt(a -> a[0]));
    pq.offer(new int[]{0, source});
    
    while (!pq.isEmpty()) {
        int[] cur = pq.poll();
        int u = cur[1];
        int d = cur[0];
        
        // 跳过已确定且距离更短的
        if (d > dist[u]) continue;
        
        for (int v = 0; v < n; v++) {
            if (graph[u][v] != 0) {
                int newDist = dist[u] + graph[u][v];
                if (newDist < dist[v]) {
                    dist[v] = newDist;
                    pq.offer(new int[]{newDist, v});
                }
            }
        }
    }
    
    return dist;
}
```

优化后复杂度：**O(E log V)**

### 局限性

Dijkstra 算法**不能处理负权边**。如果存在负权边，贪心策略会失效。

```
   A → B = 2
   B → C = 3
   A → C = -4
```

如果用 Dijkstra，从 A 出发确定 A 的距离为 0，确定 B 的距离为 2，但实际 A 到 C 的最短距离是 -4！


## Bellman-Ford 算法：可以处理负权边

### 核心思想

Bellman-Ford 算法的核心是**动态规划**的思想：对所有边进行 V-1 次松弛操作。

**为什么 V-1 次？**

因为最短路径最多有 V-1 条边（不含环）。经过 V-1 次松弛后，所有最短路径都应该被确定。

### 算法步骤

1. 初始化：源点距离为 0，其他为 ∞
2. 对所有边进行 V-1 次松弛操作
3. （可选）检测负环：如果第 V 次松弛还能更新，说明存在负环

### Java 实现

```java
public int[] bellmanFord(int[][] edges, int n, int source) {
    int[] dist = new int[n];
    Arrays.fill(dist, Integer.MAX_VALUE);
    dist[source] = 0;
    
    // 松弛 V-1 次
    for (int i = 0; i < n - 1; i++) {
        boolean updated = false;
        for (int[] edge : edges) {
            int u = edge[0], v = edge[1], w = edge[2];
            if (dist[u] != Integer.MAX_VALUE && dist[u] + w < dist[v]) {
                dist[v] = dist[u] + w;
                updated = true;
            }
        }
        if (!updated) break;  // 没有更新，提前结束
    }
    
    // 检测负环
    for (int[] edge : edges) {
        int u = edge[0], v = edge[1], w = edge[2];
        if (dist[u] != Integer.MAX_VALUE && dist[u] + w < dist[v]) {
            System.out.println("图中存在负环");
        }
    }
    
    return dist;
}
```

### 复杂度

- 时间复杂度：O(V × E)
- 空间复杂度：O(V)

### Bellman-Ford 的优化：SPFA

SPFA（Shortest Path Faster Algorithm）是对 Bellman-Ford 的队列优化：

```java
public int[] spfa(int[][] edges, int n, int source) {
    int[] dist = new int[n];
    Arrays.fill(dist, Integer.MAX_VALUE);
    dist[source] = 0;
    
    Queue&lt;Integer&gt; queue = new LinkedList&lt;&gt;();
    queue.offer(source);
    boolean[] inQueue = new boolean[n];
    inQueue[source] = true;
    
    while (!queue.isEmpty()) {
        int u = queue.poll();
        inQueue[u] = false;
        
        for (int[] edge : edges) {
            if (edge[0] == u) {
                int v = edge[1], w = edge[2];
                if (dist[u] + w < dist[v]) {
                    dist[v] = dist[u] + w;
                    if (!inQueue[v]) {
                        queue.offer(v);
                        inQueue[v] = true;
                    }
                }
            }
        }
    }
    
    return dist;
}
```

期望复杂度 O(E)，最坏情况 O(VE)。


## Floyd-Warshall 算法：多源最短路

### 核心思想

Floyd 算法的核心是**动态规划**：

```
d[i][j] = min(直接距离, 经过 k 的距离)
```

枚举所有可能的中间节点 k，看看能否让 i 到 j 的距离更短。

### Java 实现

```java
public int[][] floydWarshall(int[][] graph) {
    int n = graph.length;
    int[][] dist = new int[n][n];
    
    // 初始化
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            if (i == j) {
                dist[i][j] = 0;
            } else if (graph[i][j] != 0) {
                dist[i][j] = graph[i][j];
            } else {
                dist[i][j] = Integer.MAX_VALUE / 2;
            }
        }
    }
    
    // 动态规划
    for (int k = 0; k < n; k++) {
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (dist[i][k] + dist[k][j] < dist[i][j]) {
                    dist[i][j] = dist[i][k] + dist[k][j];
                }
            }
        }
    }
    
    return dist;
}
```

### 复杂度

- 时间复杂度：O(V³)
- 空间复杂度：O(V²)

### Floyd 的优势

1. 求所有点对之间的最短路径
2. 代码简洁
3. 可以检测负环（如果 `dist[i][i] < 0`，说明存在负环）
4. 适合密集图（V 不大，E 接近 V²）


## 三种算法的对比

| 算法 | 适用场景 | 时间复杂度 | 空间复杂度 | 负权边 |
|------|----------|-----------|-----------|--------|
| Dijkstra | 单源，无负权边 | O(V²) 或 O(E log V) | O(V) | ❌ |
| Bellman-Ford | 单源，有负权边 | O(VE) | O(V) | ✅ |
| Floyd | 多源 | O(V³) | O(V²) | ✅ |

### 选择建议

- **单源无负权边**：用 Dijkstra（优先队列版本）
- **单源有负权边**：用 Bellman-Ford 或 SPFA
- **多源最短路**：用 Floyd（V 不大时）或多次 Dijkstra


## 实战：最短路的应用

### 1. 迪杰斯特拉 + 前驱数组（还原路径）

```java
public int[] dijkstraWithPath(int[][] graph, int source) {
    int n = graph.length;
    int[] dist = new int[n];
    int[] prev = new int[n];
    boolean[] visited = new boolean[n];
    Arrays.fill(dist, Integer.MAX_VALUE);
    Arrays.fill(prev, -1);
    dist[source] = 0;
    
    for (int i = 0; i < n; i++) {
        int u = -1;
        int minDist = Integer.MAX_VALUE;
        for (int v = 0; v < n; v++) {
            if (!visited[v] && dist[v] < minDist) {
                u = v;
                minDist = dist[v];
            }
        }
        
        if (u == -1) break;
        visited[u] = true;
        
        for (int v = 0; v < n; v++) {
            if (graph[u][v] != 0 && !visited[v]) {
                int newDist = dist[u] + graph[u][v];
                if (newDist < dist[v]) {
                    dist[v] = newDist;
                    prev[v] = u;
                }
            }
        }
    }
    
    return prev;  // 用于还原路径
}

// 还原路径
public List&lt;Integer&gt; getPath(int[] prev, int target) {
    List&lt;Integer&gt; path = new ArrayList&lt;&gt;();
    for (int v = target; v != -1; v = prev[v]) {
        path.add(v);
    }
    Collections.reverse(path);
    return path;
}
```

### 2. 判断负环

```java
public boolean hasNegativeCycle(int[][] edges, int n) {
    int[] dist = new int[n];
    Arrays.fill(dist, 0);  // 源点到自身的距离为 0
    
    for (int i = 0; i < n; i++) {
        boolean updated = false;
        for (int[] edge : edges) {
            int u = edge[0], v = edge[1], w = edge[2];
            if (dist[u] + w < dist[v]) {
                dist[v] = dist[u] + w;
                updated = true;
            }
        }
        if (!updated) break;
    }
    
    // 第 n 次松弛还能更新，说明有负环
    for (int[] edge : edges) {
        int u = edge[0], v = edge[1], w = edge[2];
        if (dist[u] + w < dist[v]) {
            return true;
        }
    }
    return false;
}
```


## 总结

最短路径算法是图论的核心应用，选择的关键在于：

1. **单源还是多源**：单源用 Dijkstra/Bellman-Ford，多源用 Floyd
2. **是否有负权边**：有负权边不能用 Dijkstra
3. **图的规模**：稀疏图用 Dijkstra + 优先队列，稠密图用 Dijkstra 朴素版

理解这三种算法的核心思想，你就有了解决所有最短路径问题的武器。

## 面试追问方向

- Dijkstra 为什么不能处理负权边？（贪心策略失效）
- Bellman-Ford 的时间复杂度是多少？能否优化？（O(VE)，可用 SPFA 优化）
- Floyd 算法的时间复杂度是多少？适合什么场景？（O(V³)，适合多源最短路、V 不大的密集图）
- 如何检测负环？（Bellman-Ford 第 V 次松弛还能更新 / Floyd 的 dist[i][i] < 0）
- Dijkstra 用优先队列优化时，复杂度从多少变成多少？（O(V²) → O(E log V)）
