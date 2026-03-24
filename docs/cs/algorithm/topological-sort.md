# 拓扑排序与关键路径


## 盖房子要先打地基

盖房子有严格的先后顺序：打地基 → 砌墙 → 封顶 → 装修。

如果你把这些任务看成图中的节点，任务之间的依赖关系看成有向边，那么：

- **打地基** 没有前驱
- **砌墙** 依赖打地基
- **封顶** 依赖砌墙
- **装修** 依赖封顶

这种**有向无环图（DAG）**描述的先后关系，在计算机领域无处不在：任务调度、依赖安装、课程安排、编译顺序……

而解决这类问题的核心算法，就是**拓扑排序**。


## 拓扑排序（Topological Sort）

### 定义

对有向无环图的顶点进行排序，使得对于每一条有向边 (u, v)，u 都在 v 的前面。

换句话说：**让所有依赖关系都得到满足**。

### 拓扑排序的存在条件

**只有有向无环图（DAG）才有拓扑排序。**

如果有环，就无法确定环内节点的先后顺序。

```
有环的图无法拓扑排序:

    A → B → C
         ↗
         D

无法确定 A、B、C、D 的顺序（因为 C → D → B 形成了环）
```

### Kahn 算法：基于入度

**核心思想**：不断删除入度为 0 的节点（没有前驱）。

```java
public List&lt;Integer&gt; topologicalSortKahn(int[][] graph) {
    int n = graph.length;
    int[] inDegree = new int[n];
    List&lt;Integer&gt; result = new ArrayList&lt;&gt;();
    
    // 1. 计算入度
    for (int u = 0; u < n; u++) {
        for (int v : graph[u]) {
            inDegree[v]++;
        }
    }
    
    // 2. 将所有入度为 0 的节点加入队列
    Queue&lt;Integer&gt; queue = new LinkedList&lt;&gt;();
    for (int i = 0; i < n; i++) {
        if (inDegree[i] == 0) {
            queue.offer(i);
        }
    }
    
    // 3. BFS：不断删除入度为 0 的节点
    while (!queue.isEmpty()) {
        int u = queue.poll();
        result.add(u);
        
        for (int v : graph[u]) {
            inDegree[v]--;
            if (inDegree[v] == 0) {
                queue.offer(v);
            }
        }
    }
    
    // 4. 如果结果不包含所有节点，说明有环
    if (result.size() != n) {
        throw new IllegalStateException("图有环，无法拓扑排序");
    }
    
    return result;
}
```

### DFS 算法：基于后序遍历

**核心思想**：对图进行 DFS，后序遍历时将节点加入结果，最后反转。

```java
public List&lt;Integer&gt; topologicalSortDFS(int[][] graph) {
    int n = graph.length;
    boolean[] visited = new boolean[n];
    boolean[] inStack = new boolean[n];  // 检测环
    List&lt;Integer&gt; result = new ArrayList&lt;&gt;();
    
    for (int i = 0; i < n; i++) {
        if (!visited[i]) {
            if (!dfs(i, visited, inStack, graph, result)) {
                throw new IllegalStateException("图有环");
            }
        }
    }
    
    Collections.reverse(result);
    return result;
}

private boolean dfs(int u, boolean[] visited, boolean[] inStack,
                    int[][] graph, List&lt;Integer&gt; result) {
    visited[u] = true;
    inStack[u] = true;
    
    for (int v : graph[u]) {
        if (!visited[v]) {
            if (!dfs(v, visited, inStack, graph, result)) {
                return false;
            }
        } else if (inStack[v]) {
            return false;  // 检测到环
        }
    }
    
    result.add(u);  // 后序位置加入
    inStack[u] = false;
    return true;
}
```

### 复杂度

- 时间复杂度：O(V + E)
- 空间复杂度：O(V)


## AOE 网与关键路径

### 什么是 AOE 网？

AOE（Activity On Edge）网是一种特殊的有向带权图：

- **顶点**表示**事件**（如「地基完成」「墙体完成」）
- **边**表示**活动**（如「打地基」「砌墙」），有权重表示活动所需时间

```
AOE 网示例:

    事件: v1(开工), v2(地基完成), v3(墙体完成), v4(封顶完成), v5(完工)
    活动: a1(打地基, 3天), a2(砌墙, 5天), a3(封顶, 2天), a4(装修, 4天)
    
    v1 → a1 → v2 → a2 → v3 → a3 → v4 → a4 → v5
```

### 关键路径

**关键路径**是从开工到完工**最长**的路径。

关键路径上的活动叫**关键活动**，关键活动的总时长就是**最短完工时间**。

```
    v1          v2          v3          v4          v5
    [1]----3---->[2]----5---->[3]----2---->[4]----4---->[5]
    
    关键路径: v1 → v2 → v3 → v4 → v5
    关键活动: a1, a2, a3, a4
    最短完工时间: 3 + 5 + 2 + 4 = 14 天
```

### 求关键路径

关键路径的求法基于以下概念：

1. **最早发生时间（ve）**：从起点到该事件的最长路径长度
2. **最晚发生时间（vl）**：从该事件到终点，不影响总工期的前提下最晚开始
3. **最早开始时间（e）**：活动的起点事件的最早发生时间
4. **最晚开始时间（l）**：活动的终点事件的最晚发生时间减去活动时长

**关键活动的判定**：`e == l`

```java
public List&lt;Integer&gt; criticalPath(int[][] graph, int[] weight) {
    int n = graph.length;
    int[] ve = new int[n];  // 最早发生时间
    int[] vl = new int[n];  // 最晚发生时间
    
    // 1. 计算 ve（按拓扑顺序）
    List&lt;Integer&gt; topoOrder = topologicalSortKahn(graph);
    for (int u : topoOrder) {
        for (int v : graph[u]) {
            if (ve[u] + weight[u] > ve[v]) {
                ve[v] = ve[u] + weight[u];
            }
        }
    }
    
    // 2. 初始化 vl
    int maxTime = ve[n - 1];
    Arrays.fill(vl, maxTime);
    
    // 3. 计算 vl（按逆拓扑顺序）
    for (int i = topoOrder.size() - 1; i >= 0; i--) {
        int u = topoOrder.get(i);
        for (int v : graph[u]) {
            if (vl[v] - weight[u] < vl[u]) {
                vl[u] = vl[v] - weight[u];
            }
        }
    }
    
    // 4. 找关键活动
    List&lt;Integer&gt; criticalPath = new ArrayList&lt;&gt;();
    for (int u = 0; u < n - 1; u++) {
        for (int v : graph[u]) {
            int e = ve[u];       // 最早开始时间
            int l = vl[v] - weight[u];  // 最晚开始时间
            if (e == l) {
                criticalPath.add(u);
            }
        }
    }
    
    return criticalPath;
}
```


## 拓扑排序的变体

### 1. 按字典序拓扑排序

如果需要保证相等的顶点按字典序输出：

```java
public List&lt;Integer&gt; topologicalSortLex(int[][] graph) {
    int n = graph.length;
    int[] inDegree = new int[n];
    
    for (int u = 0; u < n; u++) {
        for (int v : graph[u]) {
            inDegree[v]++;
        }
    }
    
    // 使用最小堆（字典序优先队列）
    PriorityQueue&lt;Integer&gt; pq = new PriorityQueue&lt;&gt;();
    for (int i = 0; i < n; i++) {
        if (inDegree[i] == 0) {
            pq.offer(i);
        }
    }
    
    List&lt;Integer&gt; result = new ArrayList&lt;&gt;();
    while (!pq.isEmpty()) {
        int u = pq.poll();
        result.add(u);
        for (int v : graph[u]) {
            inDegree[v]--;
            if (inDegree[v] == 0) {
                pq.offer(v);
            }
        }
    }
    
    return result;
}
```

### 2. 所有可能的拓扑排序

如果需要输出所有可能的拓扑排序：

```java
public List&lt;List&lt;Integer&gt;&gt; allTopologicalSorts(int[][] graph) {
    List&lt;List&lt;Integer&gt;&gt; results = new ArrayList&lt;&gt;();
    int n = graph.length;
    int[] inDegree = new int[n];
    int[][] graphCopy = new int[n][];
    
    // 复制图并计算入度
    for (int i = 0; i < n; i++) {
        graphCopy[i] = graph[i].clone();
        inDegree[i] = graph[i].length;
    }
    
    List&lt;Integer&gt; path = new ArrayList&lt;&gt;();
    allTopologicalSortsDFS(path, inDegree, graphCopy, results);
    return results;
}

private void allTopologicalSortsDFS(List&lt;Integer&gt; path, int[] inDegree,
                                   int[][] graph, List&lt;List&lt;Integer&gt;&gt; results) {
    if (path.size() == graph.length) {
        results.add(new ArrayList&lt;&gt;(path));
        return;
    }
    
    for (int i = 0; i < graph.length; i++) {
        if (inDegree[i] == 0) {
            path.add(i);
            inDegree[i]--;
            
            for (int v : graph[i]) {
                inDegree[v]--;
            }
            
            allTopologicalSortsDFS(path, inDegree, graph, results);
            
            path.remove(path.size() - 1);
            inDegree[i]++;
            
            for (int v : graph[i]) {
                inDegree[v]++;
            }
        }
    }
}
```


## 实战：拓扑排序的应用

### 1. 任务调度

```java
// LeetCode 207: 课程表
public boolean canFinish(int numCourses, int[][] prerequisites) {
    List&lt;Integer&gt;[] graph = new ArrayList[numCourses];
    for (int i = 0; i < numCourses; i++) {
        graph[i] = new ArrayList&lt;&gt;();
    }
    
    int[] inDegree = new int[numCourses];
    for (int[] p : prerequisites) {
        graph[p[1]].add(p[0]);
        inDegree[p[0]]++;
    }
    
    Queue&lt;Integer&gt; queue = new LinkedList&lt;&gt;();
    for (int i = 0; i < numCourses; i++) {
        if (inDegree[i] == 0) {
            queue.offer(i);
        }
    }
    
    int count = 0;
    while (!queue.isEmpty()) {
        int course = queue.poll();
        count++;
        for (int next : graph[course]) {
            inDegree[next]--;
            if (inDegree[next] == 0) {
                queue.offer(next);
            }
        }
    }
    
    return count == numCourses;
}
```

### 2. 依赖安装顺序

apt、npm、pip 等包管理器需要按依赖顺序安装包。


## 总结

拓扑排序是处理有向无环图依赖关系的利器，关键路径是 AOE 网的核心分析。

核心要点：

1. **拓扑排序**：只有 DAG 才有拓扑排序，Kahn 算法（入度）或 DFS 都能实现
2. **关键路径**：最长路径，决定最短完工时间
3. **关键活动**：e == l 的活动，延误会导致整个项目延期

理解拓扑排序和关键路径，你就掌握了处理「先后顺序」问题的标准武器。

## 面试追问方向

- 什么样的图有拓扑排序？（只有有向无环图 DAG）
- Kahn 算法和 DFS 算法哪个更常用？各有什么优缺点？
- 如何检测图中是否有环？（拓扑排序结果数量 < 顶点数，或 DFS 检测回边）
- 关键路径有什么用？（确定最短工期、识别关键活动）
- 如何求一个 DAG 的最长路径？（把边权取负，跑最短路算法）
