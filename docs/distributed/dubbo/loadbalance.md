# Dubbo 负载均衡策略：Random、RoundRobin、LeastActive、一致性哈希

你有没有遇到过这种情况：

明明集群里有 4 台服务器，配置也一模一样，但机器 A 的 CPU 天天跑满，机器 D 却闲得发慌。

你以为是负载不均，但重启、重部署都没用。

问题很可能出在**负载均衡策略**上。

今天，我们来彻底搞清楚 Dubbo 的四种负载均衡策略，以及它们各自的适用场景。

## 为什么需要负载均衡？

在分布式系统中，一个服务通常会有多个实例（Provider）。Consumer 调用时，需要决定：**把请求发到哪台机器？**

这个问题，就是「负载均衡」要解决的。

但「均衡」不只是字面意思那么简单——

- 是让每台机器**处理的请求数量**均等？
- 还是让每台机器**CPU/内存负载**均等？
- 还是要保证**相同参数的请求**打到同一台机器？

不同的场景，需要不同的策略。

## Random LoadBalance：加权随机，最常用的策略

### 原理

Random 是 Dubbo 的**默认负载均衡策略**。它的原理很简单：根据权重，随机选择一个 Provider。

```
权重配置：Server A = 3, Server B = 2, Server C = 1
总权重 = 6

随机数落在：
- 0-2 → Server A（概率 3/6 = 50%）
- 3-4 → Server B（概率 2/6 = 33%）
- 5 → Server C（概率 1/6 = 17%）
```

### Java 实现

```java
public class RandomLoadBalance extends AbstractLoadBalance {

    @Override
    protected <T> T doSelect(List&lt;Invoker&lt;T&gt;&gt; invokers, URL url, Invocation invocation) {
        int length = invokers.size();
        boolean sameWeight = true;
        int[] weights = new int[length];

        // 计算所有 Provider 的权重
        int totalWeight = 0;
        for (int i = 0; i &lt; length; i++) {
            int weight = getWeight(invokers.get(i), invocation);
            totalWeight += weight;
            weights[i] = totalWeight;
            if (sameWeight && i > 0 && weight != weights[i - 1]) {
                sameWeight = false;
            }
        }

        // 随机选一个
        if (totalWeight > 0 && !sameWeight) {
            int offset = ThreadLocalRandom.current().nextInt(totalWeight);
            for (int i = 0; i &lt; length; i++) {
                if (offset < weights[i]) {
                    return invokers.get(i);
                }
            }
        }

        // 权重相同或权重为 0 时，随机选择一个
        return invokers.get(ThreadLocalRandom.current().nextInt(length));
    }
}
```

### 常见误区

很多人以为：只要权重相同，请求就会均匀分布。

但实际上，Random 是**概率均匀**，不是**绝对均匀**。看这张图：

```
请求分布（理想）      请求分布（实际某次）
┌─────────────┐      ┌─────────────┐
│ A: 25%      │      │ A: 32%      │
│ B: 25%      │      │ B: 18%      │  ← 运气不好，偏差很大
│ C: 25%      │      │ C: 28%      │
│ D: 25%      │      │ D: 22%      │
└─────────────┘      └─────────────┘
```

**样本越大，Random 的分布越接近理论值**。但如果你的请求量不够大（比如只有几十次），偏差会很明显。

### 适用场景

- 服务实例性能相近，权重相同
- 请求量较大，可以平滑分布

## RoundRobin LoadBalance：加权轮询，解决随机不均的问题

### 原理

RoundRobin 是在 Random 基础上的改进，它保证**绝对均匀**的分布——每个 Provider 轮流处理请求。

```
顺序请求 10 次（A:B:C = 1:1:1）：
Request 1 → Server A
Request 2 → Server B
Request 3 → Server C
Request 4 → Server A
Request 5 → Server B
Request 6 → Server C
...
```

加权轮询会考虑权重：

```
权重配置：A = 3, B = 2, C = 1
10 次请求的分布：
A A A B B C A A B C
```

### 加权平滑轮询

普通加权轮询有个问题：连续 3 个请求都打到 A，可能造成瞬时压力。

Dubbo 使用的是**加权平滑轮询**——在保证权重比例的同时，尽量分散请求：

```
A(3), B(2), C(1)

第1轮：
当前权重：[3, 2, 1]
选择：A（当前权重最大）
更新后：[2, 2, 1]

第2轮：
当前权重：[2, 2, 1]
选择：B（与A相同，轮流向右）
更新后：[2, 1, 1]

第3轮：
当前权重：[2, 1, 1]
选择：A
更新后：[1, 1, 1]

第4轮：
当前权重：[1, 1, 1]
选择：B
更新后：[1, 0, 1]

第5轮：
当前权重：[1, 0, 1]
选择：A
更新后：[0, 0, 1]

第6轮：
当前权重：[0, 0, 1]
选择：C
更新后：[3, 2, 1]（一轮结束，重置）
```

### 适用场景

- 需要请求绝对均匀分布
- 服务实例性能相近，权重不同
- **但注意**：如果连续请求都是重操作，可能造成热点

## LeastActive LoadBalance：最小活跃数，最「聪明」的策略

### 原理

LeastActive 的思路是：**让响应快的服务器处理更多请求**。

每个 Provider 都有一个「活跃数」：
- 正在处理的请求数越多，活跃数越高
- 活跃数低的服务器，说明它处理快、负载轻

```
┌─────────────────────────────────────────────────────────┐
│  LeastActive 选择逻辑                                    │
├─────────────────────────────────────────────────────────┤
│  1. 选出所有 Provider 中活跃数最小的                      │
│  2. 如果有多个（活跃数相同），随机选一个                  │
│  3. 发起调用时，活跃数 +1                               │
│  4. 调用完成时，活跃数 -1                               │
└─────────────────────────────────────────────────────────┘
```

### Java 实现

```java
public class LeastActiveLoadBalance extends AbstractLoadBalance {

    private final Random random = new Random();

    @Override
    protected <T> T doSelect(List&lt;Invoker&lt;T&gt;&gt; invokers, URL url, Invocation invocation) {
        int length = invokers.size();
        int leastActive = -1;
        int leastCount = 0;
        int[] leastIndexes = new int[length];

        // 第一遍：找到最小活跃数
        for (int i = 0; i &lt; length; i++) {
            Invoker&lt;T&gt; invoker = invokers.get(i);
            int active = RpcStatus.getStatus(invoker.getUrl(), invocation.getMethodName())
                                   .getActive();
            if (leastActive == -1 || active < leastActive) {
                leastActive = active;
                leastCount = 1;
                leastIndexes[0] = i;
            } else if (active == leastActive) {
                leastIndexes[leastCount++] = i;
            }
        }

        // 从活跃数最小的 Provider 中随机选择
        if (leastCount == 1) {
            return invokers.get(leastIndexes[0]);
        }
        return invokers.get(leastIndexes[random.nextInt(leastCount)]);
    }
}
```

### 适用场景

- **最佳适用**：服务实例性能差异较大
- 当某些实例性能好、响应快时，会自动分摊更多流量
- 性能差的实例会逐渐减少请求，给它「喘息」的机会

### 注意事项

LeastActive 依赖于**准确统计活跃请求数**，但这个统计是**单机**的。如果 Consumer 有多个实例，它们各自统计，可能导致总体不均衡。

## ConsistentHash LoadBalance：一致性哈希，解决缓存问题

### 原理

一致性哈希的核心目标是：**相同参数的请求，打到同一个 Provider**。

为什么这个很重要？

想象一个缓存场景：

```
请求流程：
1. 查询商品详情（id=123）→ Provider A → 缓存未命中，查询数据库
2. 查询商品详情（id=123）→ Provider B → 缓存未命中，查询数据库  ← 浪费！
3. 查询商品详情（id=123）→ Provider C → 缓存未命中，查询数据库  ← 继续浪费！
```

如果每次请求都打到不同机器，缓存就完全失效了。

一致性哈希解决了这个问题：

```
┌─────────────────────────────────────────────────────────┐
│                    一致性哈希环                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│          Hash A                                         │
│             ↑                                           │
│             │                                           │
│     Hash C ←┼→ Hash D                                   │
│             │                                           │
│             ↓                                           │
│          Hash B                                         │
│                                                         │
│  请求 hash("123") = Hash C → 打到 Server C              │
│  请求 hash("456") = Hash A → 打到 Server A              │
│  请求 hash("789") = Hash B → 打到 Server B              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 虚拟节点：解决数据倾斜

一致性哈希有个经典问题：**数据倾斜**。

如果只有 3 台服务器，而它们的 hash 值恰好都在哈希环的某一区域，就会导致分布不均。

解决方法是「虚拟节点」：

```
实际节点：Server A, Server B, Server C
虚拟节点：Server A#1, Server A#2, Server A#3, Server B#1...（每个实际节点有多个虚拟节点）

虚拟节点的 hash 值分散在环上，让分布更均匀。
```

### Java 配置

```java
@Reference(loadbalance = "consistenthash")
private UserService userService;
```

```xml
<dubbo:reference loadbalance="consistenthash">
    <dubbo:method name="findById" arguments="123" />
</dubbo:reference>
```

### 适用场景

- **读请求多，需要利用缓存**：如商品详情、用户信息
- 相同参数需要打到同一台机器进行计算（如分布式 session）
- **不适合**：写请求多、参数随机性强的场景

## 四种策略对比

| 策略 | 原理 | 优点 | 缺点 | 适用场景 |
|-----|------|------|------|---------|
| Random | 加权随机 | 实现简单，适用性广 | 小样本不均匀 | 性能相近的服务 |
| RoundRobin | 加权轮询 | 请求均匀分布 | 可能瞬时热点 | 需要均匀分配的场景 |
| LeastActive | 最小活跃数 | 自动适应性能差异 | 统计开销，需要足够请求量 | 性能差异大的异构系统 |
| ConsistentHash | 一致性哈希 | 参数定位同一机器 | 分布不均时效率低 | 缓存、Session 亲和 |

## 自定义负载均衡策略

Dubbo 的所有核心组件都支持 SPI 扩展，负载均衡也不例外：

```java
// 1. 实现 LoadBalance 接口
public class MyLoadBalance implements LoadBalance {
    @Override
    public <T> Invoker&lt;T&gt; select(List&lt;Invoker&lt;T&gt;&gt; invokers, URL url, Invocation invocation) {
        // 自定义选择逻辑
        return invokers.get(0);
    }
}
```

```java
// 2. 添加 SPI 配置
// META-INF/dubbo/org.apache.dubbo.rpc.cluster.LoadBalance
myLoadBalance = com.example.MyLoadBalance
```

```java
// 3. 使用自定义策略
@Reference(loadbalance = "myLoadBalance")
private UserService userService;
```

## 面试追问方向

- LeastActive 的活跃数是怎么统计的？是分布式统计还是单机统计？
- 一致性哈希的虚拟节点数量怎么设置？越多越好吗？
- 当某个 Provider 下线时，一致性哈希会怎么重新分配请求？
- 如果服务实例性能差异很大，Random 和 LeastActive 哪个效果更好？

## 总结

负载均衡不是「选哪个都行」的问题，而是要根据业务场景精心选择：

- **Random**：通用场景，默认选择
- **RoundRobin**：需要请求绝对均匀
- **LeastActive**：异构系统，智能分配
- **ConsistentHash**：缓存场景，参数定位

更重要的是：Dubbo 的负载均衡和集群容错是配合使用的——**负载均衡解决选谁的问题，容错解决失败怎么办的问题**。两者配合，才能构建高可用的 RPC 调用。
