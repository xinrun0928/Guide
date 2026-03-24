# 一致性哈希（Consistent Hash）与虚拟节点

你有一个分布式缓存系统，用户请求如何路由到具体的缓存节点？

**方案 A：普通哈希**

```java
/**
 * 普通哈希：节点数变化时，大量数据需要重新映射
 */
public class NormalHashing {
    
    /**
     * 根据 key 哈希值取模，决定路由到哪个节点
     */
    public int getNode(String key, int nodeCount) {
        int hash = key.hashCode();
        return Math.abs(hash % nodeCount);
    }
    
    /**
     * 问题：
     * 
     * 假设原来有 4 个节点：0, 1, 2, 3
     * key1.hashCode() % 4 = 1 → 路由到节点 1
     * key2.hashCode() % 4 = 2 → 路由到节点 2
     * 
     * 现在增加一个节点，变成 4 个节点：0, 1, 2, 3, 4
     * key1.hashCode() % 5 = ? → 可能是任何值
     * key2.hashCode() % 5 = ? → 重新计算
     * 
     * 结果：
     * - key1 可能从节点 1 迁移到节点 2
     * - key2 可能从节点 2 迁移到节点 4
     * - 所有 key 的路由都可能改变！
     * 
     * 这就是「雪崩效应」：节点增减导致大量缓存失效
     */
}
```

**方案 B：一致性哈希**

```
一致性哈希的核心思想：

1. 将哈希值空间组织成一个环（0 ~ 2^32）
2. 每个节点映射到环上的一个位置
3. 查找时，顺时针找到最近的节点

这样：
- 节点增减只影响相邻区域
- 大部分 key 的路由保持不变
```

## 一致性哈希原理

### 环形空间

```java
/**
 * 一致性哈希环
 * 
 * 将哈希值空间组织成一个环：
 * 0 → 1 → 2 → ... → 2^32-1 → 0（回到起点）
 */
public class ConsistentHashRing {
    
    /**
     * 哈希环的结构：
     * 
     *        0
     *       /
     *      /    节点 B
     *  2^32 ───── 节点 C
     *     \     /
     *      \   /
     *       \ /
     *      节点 A
     * 
     * 查找规则：顺时针最近节点
     * - key1 落在 A 和 B 之间 → 路由到 B
     * - key2 落在 B 和 C 之间 → 路由到 C
     * - key3 落在 C 和 A 之间 → 路由到 A
     */
    
    /**
     * 查找节点
     * 
     * @param key 数据键
     * @return 顺时针最近的节点
     */
    public String findNode(String key) {
        int hash = hash(key);
        
        // 如果哈希值大于等于所有节点，落到最小的节点
        if (hash &gt;= sortedNodes.last().hash) {
            return sortedNodes.first().nodeId;
        }
        
        // 否则，找到第一个比 hash 大的节点
        for (NodeEntry entry : sortedNodes) {
            if (entry.hash &gt; hash) {
                return entry.nodeId;
            }
        }
        
        // 不应该到达这里
        return sortedNodes.first().nodeId;
    }
    
    private int hash(String key) {
        // 使用 MD5 或其他哈希函数
        return Math.abs(key.hashCode());
    }
}
```

### 节点增减的影响

```
场景：移除节点 B

原来的路由：
- key1 → B
- key2 → B
- key3 → C

移除 B 后的路由：
- key1 → C（不再路由到 B）
- key2 → C（不再路由到 B）
- key3 → C（不变）

分析：
- 只有原来路由到 B 的 key 会迁移到 C
- key3 的路由完全没变
- 大部分 key 的路由保持不变
```

## 虚拟节点：解决数据倾斜

### 数据倾斜问题

```
问题：如果节点数量很少，或者哈希分布不均匀

场景：3 个节点，物理分布如下：

         0
        /|
       / |
   节点 A  |
     \    |
      \   |   节点 B
       \  |
        \ |
         X 1000000000（哈希值）

结果：
- 大部分 key 落在 A 和 B 之间
- 只有少量 key 落在 B 和 C、C 和 A 之间
- 节点 A 和 B 数据量远大于节点 C

这就是「数据倾斜」问题
```

### 虚拟节点解决方案

```
解决方案：为每个物理节点创建多个虚拟节点

节点 A：虚拟节点 A1, A2, A3, ... A100
节点 B：虚拟节点 B1, B2, B3, ... B100
节点 C：虚拟节点 C1, C2, C3, ... C100

这样：
- 总共有 300 个虚拟节点在环上
- 即使物理节点分布不均，虚拟节点也可以均匀分布
- 每个物理节点承载约 1/3 的数据
```

```java
/**
 * 一致性哈希 + 虚拟节点
 */
public class ConsistentHashWithVirtualNodes {
    
    /**
     * 虚拟节点配置
     */
    private static final int VIRTUAL_NODE_COUNT = 150;
    
    /**
     * 虚拟节点后缀
     */
    private static final String VIRTUAL_NODE_SUFFIX = "&&VN";
    
    /**
     * 哈希环：虚拟节点 → 物理节点
     */
    private final SortedMap&lt;Integer, String&gt; virtualNodes = new TreeMap&lt;&gt;();
    
    /**
     * 物理节点 → 虚拟节点数量
     */
    private final Map&lt;String, Integer&gt; physicalNodeReplicas = new HashMap&lt;&gt;();
    
    /**
     * 添加物理节点
     */
    public void addNode(String nodeId) {
        // 为每个物理节点创建多个虚拟节点
        for (int i = 0; i &lt; VIRTUAL_NODE_COUNT; i++) {
            String virtualNodeId = nodeId + VIRTUAL_NODE_SUFFIX + i;
            int hash = hash(virtualNodeId);
            virtualNodes.put(hash, nodeId);
        }
        physicalNodeReplicas.put(nodeId, VIRTUAL_NODE_COUNT);
    }
    
    /**
     * 移除物理节点
     */
    public void removeNode(String nodeId) {
        // 移除所有虚拟节点
        for (int i = 0; i &lt; VIRTUAL_NODE_COUNT; i++) {
            String virtualNodeId = nodeId + VIRTUAL_NODE_SUFFIX + i;
            int hash = hash(virtualNodeId);
            virtualNodes.remove(hash);
        }
        physicalNodeReplicas.remove(nodeId);
    }
    
    /**
     * 查找节点
     */
    public String findNode(String key) {
        if (virtualNodes.isEmpty()) {
            return null;
        }
        
        int hash = hash(key);
        
        // 找到顺时针最近的虚拟节点
        SortedMap&lt;Integer, String&gt; tail = virtualNodes.tailMap(hash);
        int nodeHash = tail.isEmpty() ? virtualNodes.firstKey() : tail.firstKey();
        
        // 返回虚拟节点对应的物理节点
        return virtualNodes.get(nodeHash);
    }
    
    private int hash(String key) {
        // 使用 MD5 获得更好的分布
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(key.getBytes());
            return (int) (Math.abs(digest[0] &amp; 0xFF) * 0x1000000L 
                       | Math.abs(digest[1] &amp; 0xFF) * 0x10000L
                       | Math.abs(digest[2] &amp; 0xFF) * 0x100L
                       | Math.abs(digest[3] &amp; 0xFF));
        } catch (NoSuchAlgorithmException e) {
            return key.hashCode();
        }
    }
    
    /**
     * 统计每个物理节点的负载
     */
    public Map&lt;String, Integer&gt; getPhysicalNodeLoads(List&lt;String&gt; keys) {
        Map&lt;String, Integer&gt; loads = new HashMap&lt;&gt;();
        
        for (String key : keys) {
            String node = findNode(key);
            loads.merge(node, 1, Integer::sum);
        }
        
        return loads;
    }
}
```

## 一致性哈希的优点

```
1. 单调性（Mono tonicity）
   节点增加时，只有新增节点附近的数据需要迁移
   已有的数据不会被迁移到其他节点

2. 负载均衡
   通过虚拟节点，可以让数据更均匀地分布

3. 节点增减影响小
   节点故障或新增时，只需要重新路由相邻区域的数据
```

## 一致性哈希的不足

```
1. 热点数据问题
   如果某个 key 被频繁访问，该 key 所在的节点压力会很大
   解决方案：热点数据复制到多个节点

2. 负载不均
   即使使用虚拟节点，也可能存在一定的负载不均
   解决方案：动态调整虚拟节点数量

3. 元数据管理
   节点信息需要同步到所有客户端
   解决方案：使用配置中心或服务发现
```

## 工程应用

### Dubbo 负载均衡

Dubbo 使用一致性哈希实现负载均衡：

```java
/**
 * Dubbo 的一致性哈希负载均衡
 */
public class ConsistentHashLoadBalance {
    
    private final TreeMap&lt;Long, String&gt; virtualNodes = new TreeMap&lt;&gt;();
    
    /**
     * 初始化服务节点
     */
    public void addProviders(List&lt;Invoker&gt; invokers) {
        virtualNodes.clear();
        
        for (Invoker invoker : invokers) {
            String address = invoker.getUrl().getAddress();
            
            // 每个服务节点创建 160 个虚拟节点
            for (int i = 0; i &lt; 160; i++) {
                long hash = hash(address + i);
                virtualNodes.put(hash, address);
            }
        }
    }
    
    /**
     * 选择服务提供者
     */
    public Invoker select(List&lt;Invoker&gt; invokers, Invocation invocation) {
        String key = invocation.getArguments().toString();
        long hash = hash(key);
        
        // 找到顺时针最近的虚拟节点
        Map.Entry&lt;Long, String&gt; entry = virtualNodes.ceilingEntry(hash);
        if (entry == null) {
            entry = virtualNodes.firstEntry();
        }
        
        String address = entry.getValue();
        return findInvokerByAddress(address, invokers);
    }
}
```

### Cassandra 数据分片

Cassandra 使用一致性哈希做数据分片：

```
1. 虚拟节点
   每个节点有多个虚拟节点，数据分布更均匀

2. 数据复制
   数据复制到 N 个节点，使用一致性哈希选择副本

3. 动态扩容
   新节点加入时，只需要迁移相邻范围的数据
```

## 总结

一致性哈希是分布式系统的经典算法：

1. **核心思想**：环形空间 + 顺时针查找
2. **单调性**：节点增减只影响相邻区域
3. **虚拟节点**：解决数据倾斜问题
4. **应用场景**：负载均衡、分布式缓存、数据分片

> "一致性哈希的魅力在于：用最小的改动，换取最大的稳定。在分布式系统中，避免大规模数据迁移是一门艺术。"
