# 一致性哈希与数据分片

你有没有想过：当 Redis 集群有 1000 台机器时，一条数据存在哪？

如果用普通的哈希 `key % n`，当机器数量从 10 变成 11 时，80% 的数据都要搬家。这叫「数据迁移灾难」。

一致性哈希就是来解决这个问题的。

## 普通哈希的问题

```java
// 普通哈希取模
int serverIndex = key.hashCode() % serverCount;
```

假设你有 10 台服务器，数据均匀分布。突然，业务增长，你需要扩容到 11 台。

结果呢？`hash(key) % 11` 和 `hash(key) % 10` 的结果完全不同。

**90% 的数据都需要迁移。** 如果每台服务器有 1TB 数据，你需要迁移 900GB——系统在这个过程中基本不可用。

## 一致性哈希的解决思路

一致性哈希的核心思想：**把哈希空间组织成一个环，数据顺时针找最近的服务器**。

```
                    ┌─────────────┐
                    │   Server A  │
                    │  (key 0-60) │
                    └─────────────┘
                          ▲
                          │
    ┌───────────┐         │         ┌─────────────┐
    │ Server D  │◄────────┴─────────►│  Server B   │
    │(key 270-360)│                  │ (key 60-120)│
    └───────────┘                   └─────────────┘
          ▲                                  ▲
          │                                  │
          │                                  │
    ┌─────────────┐                   ┌─────────────┐
    │ Server C    │                   │   哈希环    │
    │(key 180-270)│                   │   0-360°    │
    └─────────────┘                   └─────────────┘
```

### 虚拟节点：解决数据倾斜问题

理想很丰满，现实很骨感。如果只有 3 台服务器，它们的哈希值可能落在环上的 10°、150°、280° 位置——数据严重不均。

**解决方案：虚拟节点**。

每台物理服务器映射多个虚拟节点，比如每台服务器有 150 个虚拟节点，分布在环的不同位置。

```java
// 一致性哈希实现
public class ConsistentHash<T> {
    // 虚拟节点数量，值越大分布越均匀，但占用内存越多
    private static final int VIRTUAL_NODES = 150;

    // 存储虚拟节点到真实节点的映射
    private final TreeMap<Long, T> circle = new TreeMap<>();

    public ConsistentHash(List<T> nodes) {
        // 为每个物理节点创建多个虚拟节点
        for (T node : nodes) {
            addNode(node);
        }
    }

    private void addNode(T node) {
        // 为什么用虚拟节点？因为物理节点太少时，数据分布会不均匀
        // 150 个虚拟节点是通过实践得出的经验值
        for (int i = 0; i < VIRTUAL_NODES; i++) {
            // 生成虚拟节点的哈希值
            // 这里用 "nodeName#VN" 的格式，保证虚拟节点之间哈希值不同
            long hash = hash(node.toString() + "#VN" + i);
            circle.put(hash, node);
        }
    }

    // 核心方法：查找数据应该存在哪个节点
    public T get(String key) {
        if (circle.isEmpty()) {
            throw new IllegalStateException("No nodes available");
        }

        // 1. 计算 key 的哈希值
        long hash = hash(key);

        // 2. 顺时针找到第一个虚拟节点
        // TreeMap 的 ceilingEntry 正好是做这件事的
        Map.Entry<Long, T> entry = circle.ceilingEntry(hash);

        // 3. 如果没有比 hash 更大的，说明落在环的开头
        if (entry == null) {
            entry = circle.firstEntry();
        }

        return entry.getValue();
    }

    // 移除节点时，只需要删除它的虚拟节点
    public void remove(T node) {
        for (int i = 0; i < VIRTUAL_NODES; i++) {
            long hash = hash(node.toString() + "#VN" + i);
            circle.remove(hash);
        }
    }

    // 哈希函数，可以用 FNV、MD5 等
    private long hash(String key) {
        // 自定义的哈希函数，确保分布均匀
        // 这里是简单的实现，实际可以用 MurmurHash 或 FNV
        return Math.abs(key.hashCode());
    }
}
```

## 数据迁移的代价

一致性哈希不是银弹。当新增一台服务器时：

**只有 `1/(N+1)` 的数据需要迁移**，而不是普通哈希的 90%。

比如 10 台服务器加到 11 台，只需要迁移 1/11 ≈ 9% 的数据。

但问题是：这 9% 的数据可能仍然是 TB 级别的。怎么平滑迁移？

**方案：渐进式迁移**
1. 新机器上线，先标记为「只写不读」
2. 旧数据通过后台任务慢慢迁移
3. 迁移完成前，读取时优先从旧节点读，旧节点没有再从新节点读
4. 全部迁移完成后，新机器完全接管

## 应用场景

### Redis Cluster 的分片策略

Redis Cluster 使用哈希槽（16384 个槽），不是严格的一致性哈希，但思想类似：

```java
// Redis Cluster 的槽计算
int slot = CRC16(key) % 16384;
```

好处：
- 槽数量固定，迁移时按槽为单位
- 16384 个槽可以在集群中灵活分配
- 支持在线扩容

### Memcached 的分布式

Memcached 没有内置一致性哈希，需要客户端实现。常见实现：
- Ketama 算法（最常用）
- 一致性哈希的变种

```java
// Ketama 的核心思想
// 将每个服务器映射到多个权重点，权重决定虚拟节点数量
public class KetamaLocator {
    public int getServerForKey(String key) {
        byte[] digest = md5(key);
        // 取 MD5 的前 4 字节计算哈希值
        long hash = ((long) digest[3] & 0xFF)
            | ((long) digest[2] & 0xFF) << 8
            | ((long) digest[1] & 0xFF) << 16
            | ((long) digest[0] & 0xFF) << 24;
        // 后续逻辑同一致性哈希
        return findPointForHash(hash);
    }
}
```

## 面试追问

1. **虚拟节点数量怎么定？**
   - 太少：分布不均匀
   - 太多：内存占用高、查找效率下降
   - 经验值：150-200 个

2. **哈希环用什么数据结构？**
   - TreeMap：支持二分查找，适合大多数场景
   - 跳表：查找更快，但实现复杂

3. **如何处理节点热点？**
   - 热点 key 不走哈希，直接路由到专用服务器
   - 本地缓存 + Redis 两级缓存

## 总结

一致性哈希的核心价值：

1. **减少数据迁移**：扩容时只需迁移部分数据
2. **支持虚拟节点**：解决数据倾斜问题
3. **Trade-off**：需要额外的路由层，增加复杂度

**没有完美的方案，只有适合场景的方案**——这是系统设计永恒的主题。
