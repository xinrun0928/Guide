# Dubbo 集群容错：Failover、Failfast、Failsafe、Failback、Forking

你有没有遇到过这种情况：

服务 A 调用服务 B，结果服务 B 的一个实例挂了。你的应用直接报错 `RpcException: Failed to invoke...`，用户看到的是白屏。

但如果你的容错策略配置得当，这种情况完全可以避免——调用会自动切换到其他健康实例，用户根本感知不到。

这就是**集群容错**的价值。

今天，我们来彻底搞清楚 Dubbo 的六种容错策略，以及它们各自的适用场景。

## 什么是集群容错？

在分布式系统中，服务调用失败是常态：

- 网络抖动
- 服务器过载
- 代码 Bug 导致超时
- 机器突然宕机

集群容错解决的问题是：**当调用失败时，该怎么办？**

Dubbo 定义了六种容错策略，每种策略对应一种处理方式。

## Failover：失败自动切换（最常用）

### 工作原理

Failover 是**默认的容错策略**。它的逻辑很简单：

```
调用失败 → 重试其他服务器 → 还是失败 → 再重试 → ... → 达到重试次数 → 返回错误
```

### 配置参数

```java
// 重试次数（不含首次调用）
@Reference(
    retries = 2,  // 默认 2，最多调用 3 次（1 次原始 + 2 次重试）
    cluster = "failover"
)
private UserService userService;
```

```xml
<dubbo:reference
    id="userService"
    interface="com.example.UserService"
    retries="2"
    cluster="failover"
/>
```

### Java 实现

```java
public class FailoverClusterInvoker&lt;T&gt; extends AbstractClusterInvoker&lt;T&gt; {

    @Override
    public Result doInvoke(Invocation invocation,
                          List&lt;Invoker&lt;T&gt;&gt; invokers,
                          LoadBalance loadbalance) throws RpcException {

        List&lt;Invoker&lt;T&gt;&gt; copyInvokers = invokers;
        int len = getUrl().getMethodParameter(invocation.getMethodName(),
                                               Constants.RETRIES_KEY, 2) + 1;

        RpcException exception = null;
        for (int i = 0; i < len; i++) {
            try {
                // 选择一个 Invoker 调用
                Invoker&lt;T&gt; invoker = select(loadbalance, copyInvokers, invocation);
                return invoker.invoke(invocation);
            } catch (RpcException e) {
                exception = e;
                if (i < len - 1) {
                    copyInvokers.remove(invoker);  // 移除失败的
                }
            }
        }

        throw exception;
    }
}
```

### 适用场景

Failover 适合**读操作和幂等性服务**：

- **查询接口**：查不到就换个机器再查
- **幂等操作**：新增用户（用户 ID 唯一约束）、更新状态（可重复执行）

### 注意事项

Failover 的重试会**增加响应延迟**。如果你的服务对延迟敏感，不建议使用重试次数过多的配置。

另外，**非幂等操作绝对不能使用 Failover**——重试可能导致数据重复写入。

## Failfast：快速失败

### 工作原理

Failfast 的逻辑更直接：

```
调用失败 → 立即报错，不重试
```

```java
@Reference(
    retries = 0,
    cluster = "failfast"
)
private OrderService orderService;
```

### 适用场景

Failfast 适合**非幂等操作**：

- **下单接口**：重复调用可能导致重复下单
- **转账接口**：重复调用可能导致重复转账
- **删除操作**：如果删除已经生效，再删一次会报错

### 面试加分点

面试官可能会问：Failfast 和 Failover 在代码层面的区别是什么？

答案是：**Failfast 不捕获异常继续重试，而是直接抛出异常**。

## Failsafe：失败安全

### 工作原理

Failsafe 的策略是：**调用失败了也不报错，记录日志，返回一个空结果**。

```
调用失败 → 记录警告日志 → 返回空结果（通常是 null 或空对象）
```

### Java 实现

```java
public class FailsafeClusterInvoker&lt;T&gt; extends AbstractClusterInvoker&lt;T&gt; {

    @Override
    public Result doInvoke(Invocation invocation,
                          List&lt;Invoker&lt;T&gt;&gt; invokers,
                          LoadBalance loadbalance) {

        try {
            Invoker&lt;T&gt; invoker = select(loadbalance, invokers, invocation);
            return invoker.invoke(invocation);
        } catch (RpcException e) {
            // 记录日志，但不抛出异常
            logger.warn("Failsafe invoke failed", e);
            return AsyncRpcResult.newDefaultAsyncResult(null, null, invocation);
        }
    }
}
```

### 适用场景

Failsafe 适合**非核心操作**：

- **审计日志**：记录用户行为，失败了也不能影响主流程
- **统计上报**：上报监控数据，失败了就丢了，不影响业务
- **通知服务**：发送通知，失败了可以稍后重试

### 注意事项

使用 Failsafe 时，调用方**必须检查返回值**，否则可能遇到空指针异常：

```java
User user = userService.findById(1L);
if (user != null) {  // 必须判空
    System.out.println(user.getName());
}
```

## Failback：失败自动恢复

### 工作原理

Failback 的逻辑是：**调用失败了，先记下来，然后定时重试**。

```
调用失败 → 记录到重试队列 → 立即返回 → 后台定时重试
```

### Java 实现

```java
public class FailbackClusterInvoker&lt;T&gt; extends AbstractClusterInvoker&lt;T&gt; {

    // 定时重试机制
    private final ScheduledExecutorService scheduledExecutor =
        Executors.newScheduledThreadPool(1);

    private volatile ScheduledFuture&lt;?&gt; retryFuture;

    @Override
    protected Result doInvoke(Invocation invocation,
                              List&lt;Invoker&lt;T&gt;&gt; invokers,
                              LoadBalance loadbalance) {

        try {
            Invoker&lt;T&gt; invoker = select(loadbalance, invokers, invocation);
            return invoker.invoke(invocation);
        } catch (RpcException e) {
            // 添加到重试队列
            addFailedLoadBalance(invoker, invocation);
            // 启动定时重试
            retry();
            return AsyncRpcResult.newDefaultAsyncResult(null, null, invocation);
        }
    }

    private void retry() {
        if (retryFuture == null || retryFuture.isDone()) {
            retryFuture = scheduledExecutor.scheduleWithFixedDelay(() -> {
                // 重新执行失败的调用
                reDoInvoke();
            }, 5, 5, TimeUnit.SECONDS);  // 每 5 秒重试一次
        }
    }
}
```

### 适用场景

Failback 适合**异步非关键操作**：

- **消息发送**：发送失败就记录下来，稍后重试
- **数据同步**：将数据同步到其他系统，失败了自动重试
- **回调通知**：调用第三方接口，失败了等会再试

## Forking：并行调用

### 工作原理

Forking 的策略是：**同时调用多个 Provider，只要有一个成功就返回**。

```
同时发起 N 个调用 → 谁先成功返回谁 → 取消其他调用
```

### 配置

```java
@Reference(
    forks = 4,           // 同时调用 4 个实例
    timeout = 1000,     // 超时时间
    cluster = "forking"
)
private UserService userService;
```

### 适用场景

Forking 适合**对实时性要求极高的场景**：

- **多机房场景**：同城市的多个机房同时调用，优先返回的那个
- **高可用查询**：多副本数据查询，取最快返回的结果

### 性能开销

Forking 会同时占用多个 Provider 的资源，所以 `forks` 参数不宜过大，通常 2-4 即可。

## Broadcast：广播调用

### 工作原理

Broadcast 会**逐个调用所有 Provider**，所有 Provider 都成功，才算成功。

```
遍历所有 Provider → 一个一个调用 → 全部成功 → 返回成功
→ 任意一个失败 → 返回失败
```

### 适用场景

- **更新缓存**：需要通知所有实例更新本地缓存
- **刷新配置**：需要让所有实例重新加载配置
- **批量操作**：需要在多个服务实例上执行相同的操作

## 六种策略对比

| 策略 | 失败处理 | 是否重试 | 适用场景 | 风险 |
|-----|---------|---------|---------|-----|
| Failover | 切换实例 | ✓（自动） | 读操作、幂等操作 | 延迟增加、幂等性要求 |
| Failfast | 立即报错 | ✗ | 非幂等写操作 | 用户直接看到错误 |
| Failsafe | 返回空结果 | ✗ | 审计日志、通知 | 可能返回 null |
| Failback | 定时重试 | ✓（后台） | 异步任务、回调 | 成功前返回 null |
| Forking | 返回最快 | 同时多路 | 实时性要求高 | 资源消耗大 |
| Broadcast | 全部成功 | ✗ | 广播通知 | 一个失败全失败 |

## 集群容错 vs 负载均衡

这是面试常考的点，很多人搞混：

| 维度 | 集群容错 | 负载均衡 |
|-----|---------|---------|
| **解决的问题** | 调用失败怎么办 | 选择哪个 Provider 调用 |
| **触发时机** | 调用失败时 | 每次调用都要选择 |
| **关键字** | Failover、Failfast... | Random、RoundRobin... |
| **配置位置** | `cluster` 属性 | `loadbalance` 属性 |

**一句话总结**：
- 负载均衡决定「选谁」
- 容错策略决定「失败后怎么办」

## 面试追问方向

- Failover 重试可能导致幂等性问题，怎么解决？（答：接口设计保证幂等、唯一键约束）
- Forking 和 Bulkhead（隔板）模式有什么区别？
- 如果 Provider 全部挂了，Consumer 会怎样？（答：调用链超时后返回异常）
- 如何实现「熔断降级」？Dubbo 原生支持吗？（答：需要结合 Sentinel）

## 总结

Dubbo 的六种容错策略覆盖了不同的失败场景：

- **Failover**：最常用，自动切换，适合读操作
- **Failfast**：快速失败，适合非幂等写操作
- **Failsafe**：安全失败，适合非核心操作
- **Failback**：后台重试，适合异步任务
- **Forking**：并行调用，适合实时性要求高的场景
- **Broadcast**：广播通知，适合批量操作

在实际项目中，往往需要**组合使用**：Failover 做主策略 + Failsafe 做兜底 + 配合 Sentinel 做流量控制。

没有银弹，只有场景匹配。
