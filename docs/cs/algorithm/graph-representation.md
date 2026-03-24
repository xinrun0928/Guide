# 图的表示：邻接矩阵 vs 邻接表


## 从「朋友圈」到「最短路径」

微信的「朋友圈」功能背后是什么数据结构？

- 用户是**顶点**
- 好友关系是**边**
- 你和好友之间隔着多少人，就是图的**最短路径**

不仅是社交网络，路况图、任务依赖、网页链接……几乎所有「实体 + 关系」的问题，都可以用**图**来建模。

理解图的第一步，是知道**怎么存**。


## 图的基本概念

### 有向图 vs 无向图

```
无向图:              有向图:
A --- B             A → B
|  \  |             ↓   ↘
|   \ |             C ← D
C --- D
```

- **无向图**：边没有方向，(A, B) 和 (B, A) 是同一条边
- **有向图**：边有方向，A → B 不代表 B → A

### 有权图 vs 无权图

- **无权图**：每条边权重相同（可视为权重 = 1）
- **有权图**：边有权重，可以表示距离、成本、时间等

### 图的术语

- **度（Degree）**：无向图中，某个顶点相连的边的数量
- **入度 / 出度**：有向图中，指向该顶点的边数 / 从该顶点指出的边数
- **路径（Path）**：从一个顶点到另一个顶点经过的边序列
- **环（Cycle）**：起点和终点相同的路径


## 表示方法一：邻接矩阵

### 什么是邻接矩阵？

用一个 n × n 的二维数组表示图，`matrix[i][j]` 表示顶点 i 和顶点 j 之间的关系。

```java
// 无权图邻接矩阵
public class AdjMatrix {
    private int[][] matrix;
    private int n;  // 顶点数
    
    public AdjMatrix(int n) {
        this.n = n;
        this.matrix = new int[n][n];
    }
    
    // 添加边（无权图）
    public void addEdge(int i, int j) {
        matrix[i][j] = 1;
        // 无向图需要对称设置
        // matrix[j][i] = 1;
    }
    
    // 添加带权边
    public void addEdge(int i, int j, int weight) {
        matrix[i][j] = weight;
    }
    
    // 判断两个顶点是否有边
    public boolean hasEdge(int i, int j) {
        return matrix[i][j] != 0;
    }
    
    // 获取权重
    public int getWeight(int i, int j) {
        return matrix[i][j];
    }
}
```

### 邻接矩阵的特点

```
图的示例:          邻接矩阵:
A --- B           [A]  [B]  [C]  [D]
|      |          ────────────────────
C --- D     [A]   0    1    1    0
              [B]   1    0    0    1
              [C]   1    0    0    1
              [D]   0    1    1    0
```

**优点：**
- O(1) 时间判断两个顶点是否有边
- O(1) 时间获取边的权重
- 矩阵操作方便（如求传递闭包）

**缺点：**
- 空间复杂度 O(n²)，无论有多少边都占用这么多空间
- 对于稀疏图（边远少于顶点数），空间浪费严重
- 无法高效遍历某个顶点的所有邻居


## 表示方法二：邻接表

### 什么是邻接表？

为每个顶点维护一个列表，存储它的所有邻居。

```java
import java.util.*;

public class AdjList {
    // 邻接表：顶点 i 的邻居列表
    private List&lt;Integer&gt;[] adj;
    private int n;
    
    public AdjList(int n) {
        this.n = n;
        this.adj = new ArrayList[n];
        for (int i = 0; i < n; i++) {
            adj[i] = new ArrayList&lt;&gt;();
        }
    }
    
    // 添加边（无权图）
    public void addEdge(int i, int j) {
        adj[i].add(j);
        // 无向图需要反向添加
        // adj[j].add(i);
    }
    
    // 添加带权边
    public void addEdge(int i, int j, int weight) {
        adj[i].add(j);  // 或使用 (j, weight) 的包装类
    }
    
    // 获取邻居列表
    public List&lt;Integer&gt; neighbors(int i) {
        return adj[i];
    }
    
    // 判断两个顶点是否有边
    public boolean hasEdge(int i, int j) {
        return adj[i].contains(j);
    }
}

// 带权重的邻接表
class WeightedAdjList {
    private class Edge {
        int to;
        int weight;
        Edge(int to, int weight) {
            this.to = to;
            this.weight = weight;
        }
    }
    
    private List&lt;Edge&gt;[] adj;
    
    public WeightedAdjList(int n) {
        adj = new ArrayList[n];
        for (int i = 0; i < n; i++) {
            adj[i] = new ArrayList&lt;&gt;();
        }
    }
    
    public void addEdge(int from, int to, int weight) {
        adj[from].add(new Edge(to, weight));
    }
    
    public List&lt;Edge&gt; neighbors(int from) {
        return adj[from];
    }
}
```

### 邻接表的特点

```
图的示例:          邻接表:
A → B              A: B, C
↓    ↓             B: A, D
C → D              C: A, D
                   D: B, C
```

**优点：**
- 空间复杂度 O(V + E)，只存储实际存在的边
- 对于稀疏图，空间效率远高于邻接矩阵
- 方便遍历某个顶点的所有邻居

**缺点：**
- 判断两个顶点是否有边需要 O(degree(v)) 时间
- 无法直接获取边的权重（需要遍历）


## 两种表示方法的对比

| 特性 | 邻接矩阵 | 邻接表 |
|------|---------|--------|
| 空间复杂度 | O(V²) | O(V + E) |
| 适用场景 | 稠密图、频繁查边 | 稀疏图、频繁遍历邻居 |
| 判断两点是否有边 | O(1) | O(degree) |
| 获取所有邻居 | O(V) | O(degree) |
| 矩阵操作 | 支持 | 不直接支持 |
| 实现复杂度 | 简单 | 稍复杂 |

**经验法则：**
- 边数 E 远小于 V² 时（稀疏图），用邻接表
- 边数 E 接近 V² 时（稠密图），用邻接矩阵
- 需要 O(1) 查边时，考虑邻接矩阵
- 需要遍历邻居时，考虑邻接表


## 进阶：十字链表与邻接多重表

### 十字链表（有向图）

将邻接表和逆邻接表结合，每个边节点同时链接出边和入边。

```java
class OrthogonalNode {
    int tail, head;        // 边的尾和头顶点
    OrthogonalNode nextOut; // 同尾的下一条边
    OrthogonalNode nextIn;   // 同头的下一条边
}
```

### 邻接多重表（无向图）

解决无向图邻接表中每条边存储两次的问题。

```java
class MultiNode {
    int i, j;           // 边的两个顶点
    MultiNode nexti;    // 与顶点 i 相连的下一条边
    MultiNode nextj;    // 与顶点 j 相连的下一条边
}
```


## 实战：图结构的选择

```java
public class GraphFactory {
    
    // 根据图的特性选择合适的表示方法
    public static Graph createGraph(int vertices, int edges, boolean directed) {
        // 稀疏图：用邻接表
        if (edges < vertices * Math.log(vertices)) {
            return new AdjListGraph(vertices, directed);
        }
        // 稠密图：用邻接矩阵
        else {
            return new AdjMatrixGraph(vertices, directed);
        }
    }
    
    // 或者使用更现代的方式：HashMap + List
    public static Map&lt;Integer, List&lt;Integer&gt;&gt; createHashAdjList(int n) {
        Map&lt;Integer, List&lt;Integer&gt;&gt; adj = new HashMap&lt;&gt;();
        for (int i = 0; i < n; i++) {
            adj.put(i, new ArrayList&lt;&gt;());
        }
        return adj;
    }
}
```

### Java 标准库中的图

Java 没有内置的图数据结构，但可以用以下方式表示：

```java
// 方式 1：List&lt;List&lt;Integer&gt;&gt;
List&lt;List&lt;Integer&gt;&gt; graph = new ArrayList&lt;&gt;();

// 方式 2：HashMap&lt;Integer, Set&lt;Integer&gt;&gt;
Map&lt;Integer, Set&lt;Integer&gt;&gt; graph = new HashMap&lt;&gt;();

// 方式 3：自定义邻接表类
Map&lt;Integer, List&lt;Edge&gt;&gt; weightedGraph = new HashMap&lt;&gt;();
```


## 总结

图的存储是图算法的基础，选择合适的存储方式直接影响算法效率。

核心要点：

1. **邻接矩阵**：O(1) 查边，但空间 O(V²)，适合稠密图
2. **邻接表**：空间 O(V+E)，适合稀疏图，但查边较慢
3. **选择依据**：根据图的稀疏程度和操作需求选择

理解图的两种表示方法，是后续学习图算法的前提——DFS、BFS、最短路径、最小生成树等算法，都需要先确定图的表示方式。

## 面试追问方向

- 邻接矩阵和邻接表的空间复杂度？（O(V²) vs O(V+E)）
- 什么情况下用邻接矩阵，什么情况下用邻接表？（稠密 vs 稀疏）
- 如何判断一个图是稀疏图还是稠密图？（E 与 V² 的关系）
- 无向图和有向图在存储上有什么区别？（对称性）
- 如何判断一个图是否有环？（DFS + 回边检测，或用拓扑排序）
