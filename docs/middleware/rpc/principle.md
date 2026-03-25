# RPC 到底是怎么工作的？

想象一个场景：你写了一段代码，调用了一个方法，获取了返回值。一切看起来那么自然。

但如果这个方法不在你的 JVM 里，而是在另一台服务器的 JVM 上呢？

你写的代码不需要改，返回值还是那个返回值。但中间发生了什么？

**这就是 RPC（Remote Procedure Call）要解决的核心问题。**

---

## 从本地调用到远程调用

### 本地调用：一切都在掌控之中

```java
public class OrderService {
    public Order getOrderById(Long id) {
        // 直接调用本地方法，JVM 内存中完成
        return orderRepository.findById(id);
    }
}
```

当方法调用者和实现者都在同一个 JVM 时，调用过程清晰明了：

```
调用者 → JVM 内存 → 方法实现 → 返回结果
```

### 远程调用：一场「跨服通信」

但当方法在另一台机器上时，局面完全不同：

```
机器 A 上的调用代码 → 网络传输 → 机器 B 上的实现代码 → 网络传输 → 返回结果
```

你需要解决几个问题：

1. **调用者怎么知道另一台机器在哪里？**（服务发现）
2. **参数怎么传过去？**（序列化）
3. **返回结果怎么传回来？**（反序列化 + 网络传输）
4. **调用者怎么像调用本地方法一样调用远程方法？**（Stub 技术）

---

## Stub：让远程调用看起来像本地调用

### 什么是 Stub？

Stub（桩）是 RPC 框架的核心概念。你可以把它理解为**代理人**。

就像你委托律师打官司一样——你只需要告诉律师你的诉求，律师会帮你处理法院、对方律师、所有法律程序。你不需要知道这些细节。

Stub 就是那个「律师」，它替你在远程执行代码，把一切复杂性藏在你看不见的地方。

### 客户端 Stub（Client Stub）

客户端 Stub 负责三件事：

1. **把方法调用打包成网络消息**——包括类名、方法名、参数
2. **通过网络发送消息**
3. **接收远程返回的结果**

```java
// 你写的代码（看起来像本地调用）
Order order = orderService.getOrderById(1001L);

// 实际上，orderService 是一个 Stub
// 调用被拦截，变成了：
// 1. 序列化参数：1001L → 字节流
// 2. 构造请求消息：{class: "OrderService", method: "getOrderById", params: [1001L]}
// 3. 发送网络请求到服务端
// 4. 等待响应
// 5. 反序列化结果：字节流 → Order 对象
```

### 服务端 Stub（Server Stub）

服务端 Stub 同样负责三件事：

1. **接收网络消息**
2. **反序列化参数**
3. **调用真正的服务实现**，把结果返回

```java
// 服务端 Stub 伪代码
public class OrderServiceServerStub {
    public Object handleRequest(byte[] requestData) {
        // 1. 反序列化请求
        Request request = deserialize(requestData);
        
        // 2. 找到真正的实现类
        OrderServiceImpl impl = new OrderServiceImpl();
        
        // 3. 调用本地方法
        Object result = impl.getOrderById(request.getParam(0));
        
        // 4. 序列化结果返回
        return serialize(result);
    }
}
```

---

## 完整的 RPC 调用流程

```
┌─────────────┐                                    ┌─────────────┐
│   客户端     │                                    │   服务端     │
│  应用代码    │                                    │  业务逻辑    │
└──────┬──────┘                                    └──────┬──────┘
       │                                                 │
       │ 调用 getOrderById(1001)                         │
       ▼                                                 ▼
┌─────────────┐                                    ┌─────────────┐
│ Client Stub │                                    │Server Stub  │
│  序列化参数  │ ──────────── 网络请求 ───────────▶ │  反序列化   │
│  发送请求   │                                    │  调用实现   │
└─────────────┘                                    └──────┬──────┘
       ▲                                                 │
       │                                                 │
       │ 返回 Order 对象                                 │ 返回结果
       │ (反序列化)                                       │ (序列化)
       │                                                 ▼
       │                                         ┌─────────────┐
       └──────────────────────────────────────── │  业务逻辑   │
                                                 └─────────────┘
```

**Step by Step：**

1. 客户端调用 `orderService.getOrderById(1001)`
2. 客户端 Stub 拦截调用，把方法签名和参数序列化成字节流
3. 客户端通过网络把请求发送给服务端
4. 服务端 Stub 接收请求，反序列化得到方法名和参数
5. 服务端 Stub 调用真正的 `OrderServiceImpl.getOrderById(1001)`
6. 服务端执行业务逻辑，返回 `Order` 对象
7. 服务端 Stub 把 `Order` 序列化成字节流，通过网络返回
8. 客户端 Stub 接收响应，反序列化为 `Order` 对象
9. 客户端代码收到返回值，调用结束

整个过程对上层代码完全透明——你写的代码看起来就像本地调用。

---

## 序列化：把对象变成字节流

### 为什么需要序列化？

网络传输只能发送字节，不能直接发送 Java 对象。你需要把对象「拍扁」成字节，这叫**序列化**；接收端再把字节「还原」成对象，这叫**反序列化**。

### 序列化的选择

序列化协议直接影响 RPC 的性能：

| 协议 | 体积 | 速度 | 可读性 | 跨语言 |
|-----|-----|-----|-------|-------|
| JSON | 大 | 慢 | 高 | 好 |
| Java 原生 | 中 | 中 | 低 | 差（仅 Java） |
| Protobuf | 小 | 快 | 低 | 好 |
| Kryo | 小 | 快 | 无 | 差 |
| Hessian | 小 | 快 | 低 | 中 |

序列化协议的选择是 RPC 框架性能优化的关键点之一。

---

## 网络传输：数据的搬运工

序列化后的数据需要通过网络传输到对端。RPC 框架通常基于以下传输层：

### TCP 传输

直接基于 TCP Socket 通信，性能高，但需要自己处理粘包/拆包问题。

### HTTP/2 传输

gRPC 基于 HTTP/2，支持流式调用、双向通信，头部压缩等高级特性。

### 连接池

频繁创建销毁 TCP 连接开销很大，成熟的 RPC 框架会使用连接池复用连接：

```java
// 连接池简化模型
public class ConnectionPool {
    private final Map&lt;Address, List&lt;Connection&gt;&gt; pool = new ConcurrentHashMap&lt;&gt;();
    
    public Connection getConnection(Address address) {
        List&lt;Connection&gt; connections = pool.get(address);
        if (!connections.isEmpty()) {
            return connections.remove(connections.size() - 1);
        }
        // 没有可用连接，创建新的
        return createNewConnection(address);
    }
    
    public void returnConnection(Address address, Connection conn) {
        // 归还连接到池中复用
        pool.computeIfAbsent(address, k -> new ArrayList&lt;&gt;()).add(conn);
    }
}
```

---

## 服务发现：找到目标在哪里

### 问题

客户端怎么知道服务端有哪些 IP 和端口？

### 解决方案

1. **硬编码**：简单但不可扩展，服务端 IP 变更时客户端要重新配置
2. **注册中心**：Zookeeper、Nacos、Consul 等，服务端启动时注册，客户端查询

```java
// 服务发现简化模型
public class ServiceDiscovery {
    private final Registry registry;
    
    public OrderService lookup() {
        // 从注册中心获取可用的服务实例
        List&lt;Instance&gt; instances = registry.getInstances("order-service");
        // 根据负载均衡策略选择一个实例
        return selectOne(instances);
    }
}
```

---

## 总结：RPC 的三大核心组件

| 组件 | 职责 |
|-----|-----|
| **Stub** | 把远程调用伪装成本地调用，屏蔽网络细节 |
| **序列化** | 把对象转换为字节流，用于网络传输 |
| **网络传输** | 把序列化后的数据从一端送到另一端 |

三大组件加上服务发现、负载均衡、容错处理等周边能力，构成了完整的 RPC 框架。

---

## 留给你的问题

Dubbo 2.x 使用 Hessian 作为序列化协议，而 Dubbo 3.x 切换成了 Triple 协议（基于 HTTP/2）。

**为什么序列化协议的改变会影响整个 RPC 框架的选型？Triple 协议相比 Dubbo 2.x 的私有协议，有什么优势？**

这个问题，值得你去看一下 [Dubbo 协议演进](/middleware/rpc/compare) 的相关内容。
