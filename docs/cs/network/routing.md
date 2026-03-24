# 路由与路由算法

你有没有想过：从北京发往深圳的数据包，是怎么「知道」走哪条路的？

路由器不只是一个转发设备，它的核心是**路由算法**——在复杂的网络拓扑中找到最优路径的数学问题。

理解路由算法，是理解互联网如何运作的关键。

## 路由的基本概念

### 什么是路由？

路由（Routing）是指导数据包从源地址到目的地址的过程。

数据包经过的每一跳，都需要路由器做出转发决策：这个包该往哪个方向走？

### 路由表

每台路由器都维护一张**路由表**（Routing Table），告诉它「去某个目的地该走哪条路」。

```bash
# Linux 查看路由表
$ route -n
Kernel IP routing table
Destination     Gateway         Genmask         Flags Metric Ref    Use Iface
0.0.0.0         192.168.1.1    0.0.0.0         UG    100    0        0 eth0
192.168.1.0     0.0.0.0        255.255.255.0   U     100    0        0 eth0
10.0.0.0        192.168.1.254  255.0.0.0       UG    200    0        0 eth0
```

| 字段 | 含义 |
|------|------|
| Destination | 目标网络（或主机） |
| Gateway | 下一跳网关地址（0.0.0.0 表示直连） |
| Genmask | 子网掩码 |
| Flags | U=可用, G=网关, H=主机 |
| Metric | 路由优先级（越小越优先） |
| Iface | 出接口 |

### 路由查找过程

当路由器收到数据包时：

```
1. 提取数据包的目标 IP 地址
2. 与路由表的每条条目进行「按位与」运算
3. 找到最长匹配（Longest Prefix Match）的路由
4. 从对应接口发送出去，或发送给指定的网关
```

```
目标 IP: 192.168.2.100

路由表：
  192.168.0.0/16   → 下一跳 10.0.0.1    （匹配前 16 位）
  192.168.2.0/24   → 下一跳 192.168.1.1  （匹配前 24 位，更长）

选择：192.168.2.0/24（因为 24 位比 16 位更长）
```

## 路由算法分类

### 静态路由 vs 动态路由

```
静态路由：管理员手动配置，适用于小型、稳定的网络
动态路由：路由器自动学习，适用于大型、变化的网络
```

### 动态路由算法

```
┌─────────────────────────────────────────────────────────┐
│                      动态路由协议                         │
├─────────────────────────┬───────────────────────────────┤
│      距离矢量协议        │         链路状态协议            │
├─────────────────────────┼───────────────────────────────┤
│ RIP (Routing Information Protocol) │ OSPF (Open Shortest Path First) │
│ IGRP / EIGRP            │ IS-IS                          │
├─────────────────────────┴───────────────────────────────┤
│                      路径矢量协议                         │
├─────────────────────────────────────────────────────────┤
│           BGP (Border Gateway Protocol)                  │
└─────────────────────────────────────────────────────────┘
```

## 距离矢量算法（RIP）

### 工作原理

距离矢量（Distance Vector）算法的核心是：**每个路由器只知道到所有目的地的距离（跳数）和方向（下一跳）**。

```
距离：跳数（经过的路由器数量）
矢量：方向（下一跳）
```

### RIP 协议

RIP（Routing Information Protocol）是典型的距离矢量协议，使用**跳数**作为度量值。

```
RIP 规则：
- 最大跳数：15（16 跳视为不可达）
- 每 30 秒发送完整的路由表给邻居
- 收到新路由时，如果比现有路由跳数更少，更新
```

### 路由环路问题

距离矢量协议最大的问题是**路由环路**（Routing Loop）。

```
场景：网络故障后，A 以为 B 能到达，D 以为 C 能到达...

A → B → C → D → A  → B → C → D → A...
数据包在环里转，直到 TTL 耗尽
```

**解决方案**：

1. **定义最大跳数**：RIP 最大 15 跳，限制环路影响范围
2. **水平分割**：不把从一个邻居学到的路由再发回给那个邻居
3. **毒性逆转**：把不可达路由的跳数设为 16（无穷大），明确告知邻居
4. **触发更新**：网络变化时立即发送更新，不等 30 秒

### RIP 的缺点

- 最大跳数限制（不适合大型网络）
- 收敛速度慢（网络变化时需要多次交换才能稳定）
- 容易产生路由环路

## 链路状态算法（OSPF）

### 工作原理

链路状态（Link-State）算法的核心是：**每个路由器都有整个网络的拓扑图**，知道每条链路的状态。

```
每个路由器都知道：
- 自己和哪些路由器相连
- 每条链路的「代价」（带宽、延迟等）
- 其他路由器告诉自己的链路状态
```

### OSPF 协议

OSPF（Open Shortest Path First）使用 Dijkstra 算法计算最短路径。

```
OSPF 特点：
- 使用带宽作为度量值（cost = 100Mbps / 带宽）
- 支持区域（Area）划分，减少计算量
- 快速收敛，触发式更新
- 支持负载均衡
```

### Dijkstra 算法

Dijkstra 算法是图论中的经典最短路径算法：

```java
import java.util.*;

public class DijkstraAlgorithm {

    // Dijkstra 算法求单源最短路径
    public static Map<String, Integer> dijkstra(
            Map<String, Map<String, Integer>> graph,
            String start) {

        // 最短距离表
        Map<String, Integer> distances = new HashMap<>();
        for (String node : graph.keySet()) {
            distances.put(node, Integer.MAX_VALUE);
        }
        distances.put(start, 0);

        // 已确定最短距离的节点集合
        Set<String> visited = new HashSet<>();

        // 优先队列，按距离从小到大排序
        PriorityQueue<Node> pq = new PriorityQueue<>(
            Comparator.comparingInt(n -> n.distance)
        );
        pq.add(new Node(start, 0));

        while (!pq.isEmpty()) {
            Node current = pq.poll();

            if (visited.contains(current.name)) {
                continue;
            }
            visited.add(current.name);

            // 更新邻居的距离
            Map<String, Integer> neighbors = graph.get(current.name);
            if (neighbors != null) {
                for (Map.Entry<String, Integer> entry : neighbors.entrySet()) {
                    String neighbor = entry.getKey();
                    int newDist = current.distance + entry.getValue();

                    if (newDist < distances.get(neighbor)) {
                        distances.put(neighbor, newDist);
                        pq.add(new Node(neighbor, newDist));
                    }
                }
            }
        }
        return distances;
    }

    static class Node {
        String name;
        int distance;
        Node(String name, int distance) {
            this.name = name;
            this.distance = distance;
        }
    }

    public static void main(String[] args) {
        // 构建网络拓扑
        Map<String, Map<String, Integer>> graph = new HashMap<>();

        // A 连接 B(4), C(1)
        graph.put("A", Map.of("B", 4, "C", 1));
        // B 连接 A(4), C(4), D(3), E(5)
        graph.put("B", Map.of("A", 4, "C", 4, "D", 3, "E", 5));
        // C 连接 A(1), B(4), D(2)
        graph.put("C", Map.of("A", 1, "B", 4, "D", 2));
        // D 连接 B(3), C(2), E(6)
        graph.put("D", Map.of("B", 3, "C", 2, "E", 6));
        // E 连接 B(5), D(6)
        graph.put("E", Map.of("B", 5, "D", 6));

        Map<String, Integer> result = dijkstra(graph, "A");

        System.out.println("从 A 出发的最短距离：");
        result.forEach((k, v) ->
            System.out.println("到 " + k + ": " + v + " 跳"));
    }
}
```

### 链路状态 vs 距离矢量

| 特性 | 距离矢量（RIP） | 链路状态（OSPF） |
|------|---------------|------------------|
| 路由器视角 | 只知道邻居 | 知道整个网络拓扑 |
| 路由计算 | 分布式 | 本地独立计算 |
| 收敛速度 | 慢 | 快 |
| 网络开销 | 低（只传路由表） | 高（要传链路状态） |
| 可扩展性 | 差（最大跳数限制） | 好 |
| 算法复杂度 | O(n×k) | O(n² log n) |

## BGP：互联网的「外交官」

### 为什么需要 BGP？

OSPF 和 RIP 是**内部网关协议**（IGP），适用于单个 AS（自治系统）内部。

互联网由成千上万个 AS 组成，AS 之间的路由需要**外部网关协议**（EGP），这就是 BGP。

### BGP 的特点

```
BGP（Border Gateway Protocol）：

1. 路径矢量：不仅知道距离，还知道完整路径
2. AS 号：每个自治系统有唯一编号
3. 策略路由：根据商业协议选择路由（不走竞争对手的网络）
4. 极其稳定：互联网骨干路由器不能轻易重启
```

### BGP 路由属性

```
BGP 选择最优路径的顺序：
1. 最高权重（Weight，本地 Cisco 特有）
2. 最高 Local Preference
3. 本地生成的路由（next hop = 0.0.0.0）
4. 最短 AS_PATH
5. 最低 Origin 类型（IGP < EGP < Incomplete）
6. 最低 MED
7. eBGP < iBGP
8. 最近下一跳（IGP 成本最低）
9. 最大可用路由
10. 最低 Router ID
11. 最短 Cluster List
12. 最低邻居地址
```

## 实际应用

### 查看路由信息

```bash
# Linux/Mac 查看路由表
netstat -rn
ip route show

# Windows 查看路由表
route print

# 查看 AS 号
whois -h whois.arin.net 8.8.8.8
```

### 添加静态路由

```bash
# Linux 添加静态路由
ip route add 192.168.100.0/24 via 10.0.0.1 dev eth0

# Windows 添加静态路由
route add 192.168.100.0 mask 255.255.255.0 10.0.0.1

# 删除路由
ip route del 192.168.100.0/24
```

### 路由追踪

```bash
# 追踪路由（Linux）
traceroute www.baidu.com

# 追踪路由（Windows）
tracert www.baidu.com

# 跟踪 AS 路径
traceroute -A www.baidu.com
```

## 面试追问方向

- 路由表是如何工作的？如何进行路由查找？
- 什么是最长前缀匹配（Longest Prefix Match）？
- 距离矢量协议（如 RIP）有什么优缺点？如何避免路由环路？
- 链路状态协议（如 OSPF）是如何工作的？
- Dijkstra 算法求最短路径的基本步骤是什么？
- BGP 协议的作用是什么？为什么互联网需要 BGP？
- 什么是 AS（自治系统）？IGP 和 EGP 的区别是什么？
