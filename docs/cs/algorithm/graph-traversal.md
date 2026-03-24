# 图的遍历：DFS 与 BFS


## 一张地图的两种走法

想象你站在迷宫入口，要找到出口。

**走法一**：一条路走到黑，遇到死胡同就退回来换一条——这是**深度优先搜索（DFS）**。

**走法二**：先看看附近有哪些岔路，一层层向外探索——这是**广度优先搜索（BFS）**。

这两种走法，正好对应图遍历的两种核心算法。


## 深度优先搜索（DFS）

### 核心思想

DFS 的核心是**「深入」**：沿着一条路径走到底，直到走不通了再回退（回溯）。

```
DFS 遍历顺序（A 为起点）:

        A
       / \
      B   C
     /   / \
    D   E   F
     \
      G

DFS: A → B → D → G → D(回退) → B(回退) → A(回退) → C → E → C(回退) → C → F

遍历顺序: A, B, D, G, C, E, F
```

### DFS 的实现

**递归版本**：

```java
public void dfs(int start) {
    boolean[] visited = new boolean[n];
    dfsRecursive(start, visited);
}

private void dfsRecursive(int v, boolean[] visited) {
    visited[v] = true;
    System.out.print(v + " ");
    
    for (int neighbor : graph.get(v)) {
        if (!visited[neighbor]) {
            dfsRecursive(neighbor, visited);
        }
    }
}
```

**迭代版本（用栈）**：

```java
public void dfsIterative(int start) {
    boolean[] visited = new boolean[n];
    Stack&lt;Integer&gt; stack = new Stack&lt;&gt;();
    
    stack.push(start);
    visited[start] = true;
    
    while (!stack.isEmpty()) {
        int v = stack.pop();
        System.out.print(v + " ");
        
        for (int neighbor : graph.get(v)) {
            if (!visited[neighbor]) {
                visited[neighbor] = true;
                stack.push(neighbor);
            }
        }
    }
}
```

### DFS 的应用

**1. 连通分量检测**

```java
public int countComponents() {
    boolean[] visited = new boolean[n];
    int count = 0;
    
    for (int i = 0; i < n; i++) {
        if (!visited[i]) {
            dfs(i, visited);
            count++;
        }
    }
    return count;
}
```

**2. 检测环**

```java
public boolean hasCycle() {
    boolean[] visited = new boolean[n];
    boolean[] inStack = new boolean[n];  // 当前递归栈中的节点
    
    for (int i = 0; i < n; i++) {
        if (dfsDetectCycle(i, visited, inStack)) {
            return true;
        }
    }
    return false;
}

private boolean dfsDetectCycle(int v, boolean[] visited, boolean[] inStack) {
    visited[v] = true;
    inStack[v] = true;
    
    for (int neighbor : graph.get(v)) {
        if (!visited[neighbor]) {
            if (dfsDetectCycle(neighbor, visited, inStack)) {
                return true;
            }
        } else if (inStack[neighbor]) {
            return true;  // 回边：检测到环
        }
    }
    
    inStack[v] = false;  // 回溯
    return false;
}
```

**3. 拓扑排序**（DFS 版本）

```java
public List&lt;Integer&gt; topologicalSort() {
    boolean[] visited = new boolean[n];
    Stack&lt;Integer&gt; stack = new Stack&lt;&gt;();
    
    for (int i = 0; i < n; i++) {
        if (!visited[i]) {
            topologicalSortDFS(i, visited, stack);
        }
    }
    
    List&lt;Integer&gt; result = new ArrayList&lt;&gt;();
    while (!stack.isEmpty()) {
        result.add(stack.pop());
    }
    return result;
}

private void topologicalSortDFS(int v, boolean[] visited, Stack&lt;Integer&gt; stack) {
    visited[v] = true;
    for (int neighbor : graph.get(v)) {
        if (!visited[neighbor]) {
            topologicalSortDFS(neighbor, visited, stack);
        }
    }
    stack.push(v);  // 后序遍历，入栈
}
```


## 广度优先搜索（BFS）

### 核心思想

BFS 的核心是**「扩散」**：先访问起点的所有邻居，再访问邻居的邻居，一层层向外扩展。

```
BFS 遍历顺序（A 为起点）:

        A
       / \
      B   C
     /   / \
    D   E   F
     \
      G

BFS: 访问 A → 访问 B, C → 访问 D, E, F → 访问 G

遍历顺序: A, B, C, D, E, F, G
```

### BFS 的实现

**迭代版本（用队列）**：

```java
public void bfs(int start) {
    boolean[] visited = new boolean[n];
    Queue&lt;Integer&gt; queue = new LinkedList&lt;&gt;();
    
    queue.offer(start);
    visited[start] = true;
    
    while (!queue.isEmpty()) {
        int v = queue.poll();
        System.out.print(v + " ");
        
        for (int neighbor : graph.get(v)) {
            if (!visited[neighbor]) {
                visited[neighbor] = true;
                queue.offer(neighbor);
            }
        }
    }
}
```

**递归版本**：BFS 通常用迭代实现，递归实现需要用队列模拟，不常用。

### BFS 的应用

**1. 最短路径（无权图）**

```java
public int[] shortestPath(int start) {
    int[] dist = new int[n];
    int[] prev = new int[n];
    Arrays.fill(dist, -1);
    Arrays.fill(prev, -1);
    
    Queue&lt;Integer&gt; queue = new LinkedList&lt;&gt;();
    queue.offer(start);
    dist[start] = 0;
    
    while (!queue.isEmpty()) {
        int v = queue.poll();
        
        for (int neighbor : graph.get(v)) {
            if (dist[neighbor] == -1) {
                dist[neighbor] = dist[v] + 1;
                prev[neighbor] = v;
                queue.offer(neighbor);
            }
        }
    }
    
    return dist;
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

**2. 检测二分图**

```java
public boolean isBipartite() {
    int[] color = new int[n];  // 0: 未着色, 1: 红色, -1: 蓝色
    Arrays.fill(color, 0);
    
    for (int i = 0; i < n; i++) {
        if (color[i] == 0) {
            if (!bfsColor(i, color)) {
                return false;
            }
        }
    }
    return true;
}

private boolean bfsColor(int start, int[] color) {
    Queue&lt;Integer&gt; queue = new LinkedList&lt;&gt;();
    queue.offer(start);
    color[start] = 1;
    
    while (!queue.isEmpty()) {
        int v = queue.poll();
        for (int neighbor : graph.get(v)) {
            if (color[neighbor] == 0) {
                color[neighbor] = -color[v];
                queue.offer(neighbor);
            } else if (color[neighbor] == color[v]) {
                return false;  // 相邻节点同色，不是二分图
            }
        }
    }
    return true;
}
```

**3. 层的概念**

```java
public void bfsByLevel(int start) {
    boolean[] visited = new boolean[n];
    Queue&lt;Integer&gt; queue = new LinkedList&lt;&gt;();
    queue.offer(start);
    visited[start] = true;
    int level = 0;
    
    while (!queue.isEmpty()) {
        int size = queue.size();
        System.out.println("Level " + level + ": ");
        
        for (int i = 0; i < size; i++) {
            int v = queue.poll();
            System.out.print(v + " ");
            
            for (int neighbor : graph.get(v)) {
                if (!visited[neighbor]) {
                    visited[neighbor] = true;
                    queue.offer(neighbor);
                }
            }
        }
        level++;
        System.out.println();
    }
}
```


## DFS vs BFS

| 特性 | DFS | BFS |
|------|-----|-----|
| 数据结构 | 栈（递归栈） | 队列 |
| 遍历顺序 | 深度优先，先深后广 | 广度优先，先广后深 |
| 空间复杂度 | O(h)，h 为树高 | O(w)，w 为最大宽度 |
| 最短路径 | 不保证（无权图） | 保证（无权图） |
| 适用场景 | 拓扑排序、连通分量、环检测 | 最短路径、层序遍历 |

### 什么时候用 DFS？

- 需要遍历所有可能的路径（回溯）
- 需要找连通分量
- 需要拓扑排序
- 递归实现简单，代码简洁

### 什么时候用 BFS？

- 需要找最短路径（无权图）
- 需要按层次处理
- 图很宽但深度不大
- 需要找到最近解


## 实战：岛屿数量问题

```java
public int numIslands(char[][] grid) {
    if (grid == null || grid.length == 0) return 0;
    
    int count = 0;
    int m = grid.length, n = grid[0].length;
    boolean[][] visited = new boolean[m][n];
    
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            if (grid[i][j] == '1' && !visited[i][j]) {
                dfsIsland(grid, visited, i, j);
                count++;
            }
        }
    }
    return count;
}

private void dfsIsland(char[][] grid, boolean[][] visited, int i, int j) {
    if (i < 0 || i >= grid.length || j < 0 || j >= grid[0].length 
        || grid[i][j] == '0' || visited[i][j]) {
        return;
    }
    
    visited[i][j] = true;
    dfsIsland(grid, visited, i + 1, j);
    dfsIsland(grid, visited, i - 1, j);
    dfsIsland(grid, visited, i, j + 1);
    dfsIsland(grid, visited, i, j - 1);
}
```


## 总结

DFS 和 BFS 是图遍历的两种基本方式，选择取决于问题需求：

- **DFS**：适合「存在性」问题（是否有解、是否有环）
- **BFS**：适合「最优性」问题（最短路径、最少步骤）

两种方法的时间复杂度都是 **O(V + E)**，空间复杂度取决于图的形态和具体实现。

## 面试追问方向

- DFS 和 BFS 的时间和空间复杂度？（O(V+E)，DFS 用栈/BFS 用队列）
- DFS 的递归和迭代实现有什么区别？（递归有栈溢出风险，迭代更可控）
- 什么场景下 BFS 比 DFS 更优？（最短路径、按层处理）
- 如何用 BFS 判断二分图？（着色法，相邻节点不同色）
- 递归遍历图需要注意什么？（栈溢出、 visited 数组防止重复访问）
