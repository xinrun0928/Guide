# 序列化协议：JSON 够用吗？

「直接用 JSON 吧，简单，还能直接看日志。」

这句话听起来很合理。但当你的系统 QPS 从 1000 飙升到 10000 时，JSON 带来的额外 CPU 开销会让你开始思考：是不是应该换个序列化协议？

**序列化是 RPC 性能的关键瓶颈之一，选择错误的协议，可能让你的系统天生就比别人慢几倍。**

---

## 序列化的本质

在说具体协议之前，我们先理解序列化的本质。

### 什么是序列化？

序列化就是把内存中的对象转换成字节流；反序列化就是把字节流还原成对象。

```java
// 序列化：对象 → 字节流
Order order = new Order();
order.setId(1001L);
order.setCustomerName("张三");

byte[] bytes = serializer.serialize(order);
// bytes = [???] 二进制数据，无法直接阅读

// 反序列化：字节流 → 对象
Order restored = (Order) serializer.deserialize(bytes);
restored.getId(); // 1001L
```

### 序列化的三个核心指标

| 指标 | 含义 | 影响 |
|-----|-----|-----|
| **序列化速度** | 对象转字节流的快慢 | CPU 消耗 |
| **反序列化速度** | 字节流转对象的快慢 | CPU 消耗 |
| **序列化体积** | 转换后的大小 | 网络带宽占用 |

这三个指标往往互相制约，你需要根据实际场景权衡。

---

## 常见序列化协议

### JSON：人类友好的老将

JSON 是 Web 时代的宠儿，以可读性和跨语言兼容性著称。

**序列化示例：**

```java
Order order = new Order();
order.setId(1001L);
order.setCustomerName("张三");
order.setItems(Arrays.asList(new Item("SKU001", 2)));

// 序列化
String json = objectMapper.writeValueAsString(order);
// {"id":1001,"customerName":"张三","items":[{"sku":"SKU001","quantity":2}]}

// 反序列化
Order restored = objectMapper.readValue(json, Order.class);
```

**优点：**
- 人类可读，调试方便
- 跨语言，生态成熟
- 几乎所有语言都有 JSON 库

**缺点：**
- 体积大（每个字段都要写字段名）
- 速度慢（字符串解析）
- 没有类型信息（反序列化依赖类型信息）

**适用场景：** 对外 API、跨语言通信、数据交换。

---

### Java 原生序列化：简单但危险

Java 原生序列化（实现 `Serializable` 接口）曾经是很多项目的选择。

```java
public class Order implements Serializable {
    private static final long serialVersionUID = 1L;
    
    private Long id;
    private String customerName;
    private List&lt;Item&gt; items;
    
    // 序列化
    ByteArrayOutputStream baos = new ByteArrayOutputStream();
    ObjectOutputStream oos = new ObjectOutputStream(baos);
    oos.writeObject(order);
    byte[] bytes = baos.toByteArray();
    
    // 反序列化
    ObjectInputStream ois = new ObjectInputStream(
        new ByteArrayInputStream(bytes));
    Order restored = (Order) ois.readObject();
}
```

**为什么现在不推荐？**

1. **体积大**：包含类名、方法签名等元数据
2. **速度慢**：反射机制效率低
3. **安全性问题**：可以执行任意类的 `readObject`，容易被攻击
4. **跨语言差**：Java 序列化后的数据，其他语言几乎无法解析

**JDK 9+ 已经开始废弃 Java 序列化。**

---

### Hessian：跨语言的二进制协议

Hessian 是一种动态类型的二进制序列化协议，支持多种语言，性能不错。

```java
// Hessian 序列化
HessianFactory factory = new HessianFactory();
Serializer serializer = factory.createSerializer(Order.class);

Order order = new Order();
order.setId(1001L);

byte[] bytes = serializer.serialize(order);

// 反序列化
Order restored = serializer.deserialize(bytes);
```

**优点：**
- 二进制格式，体积小
- 跨语言（Java、C++、Python、PHP...）
- 速度较快

**缺点：**
- 序列化后的数据不可读
- 协议版本间兼容性较差
- 国内使用较多，海外生态较弱

**Dubbo 2.x 默认使用 Hessian 2。**

---

### Kryo：Java 高性能序列化

Kryo 是一个快速、占用空间小的 Java 序列化库，被广泛用于 Hadoop、Spark 等大数据系统。

```java
// Kryo 序列化
Kryo kryo = new Kryo();
kryo.register(Order.class);

// 序列化
Output output = new Output(new FileOutputStream("order.bin"));
kryo.writeObject(output, order);
output.close();

// 反序列化
Input input = new Input(new FileInputStream("order.bin"));
Order restored = kryo.readObject(input, Order.class);
input.close();
```

**优点：**
- 速度极快，比 Hessian 快 10 倍以上
- 序列化体积小
- 序列化结果不含类信息（依赖注册机制）

**缺点：**
- 仅 Java，不支持跨语言
- 序列化格式不保证跨版本兼容性
- 线程不安全，需要池化使用

```java
// Kryo 线程安全问题：使用 ThreadLocal 池化
public class KryoPool {
    private static final ThreadLocal&lt;Kryo&gt; kryoThreadLocal = 
        ThreadLocal.withInitial(Kryo::new);
    
    public static Kryo getKryo() {
        Kryo kryo = kryoThreadLocal.get();
        kryo.setReferences(true); // 启用循环引用检测
        return kryo;
    }
}
```

---

### Protobuf：Google 出品的跨语言王者

Protobuf（Protocol Buffers）是 Google 内部使用多年的序列化协议，2018 年开源，是 gRPC 的默认序列化协议。

**使用步骤：**

1. 定义 `.proto` 文件

```protobuf
syntax = "proto3";

package order;

option java_package = "com.example.order";
option java_outer_classname = "OrderProtos";

message Order {
    int64 id = 1;
    string customer_name = 2;
    repeated Item items = 3;
}

message Item {
    string sku = 1;
    int32 quantity = 2;
}
```

2. 编译生成 Java 代码

```bash
protoc --java_out=. order.proto
```

3. 使用生成的类

```java
// 构建消息
OrderProtos.Order order = OrderProtos.Order.newBuilder()
    .setId(1001L)
    .setCustomerName("张三")
    .addItems(OrderProtos.Item.newBuilder()
        .setSku("SKU001")
        .setQuantity(2)
        .build())
    .build();

// 序列化
byte[] bytes = order.toByteArray();

// 反序列化
OrderProtos.Order restored = 
    OrderProtos.Order.parseFrom(bytes);
```

**优点：**
- 跨语言（Java、C++、Python、Go...）
- 体积小（字段用数字编号，不重复传输字段名）
- 速度快（固定内存布局，无需反射）
- Schema 集中管理，版本兼容性好

**缺点：**
- 需要预先定义 Schema（`.proto` 文件）
- 不能直接序列化普通 Java 对象
- 学习曲线稍陡

关于 Protobuf 的更多细节，可以阅读 [Protobuf 原理：IDL 编译器与编解码](/middleware/rpc/protobuf)。

---

## 性能对比：谁才是性能之王？

以下数据是业界常见的基准测试结果（仅供参考，实际性能因场景而异）：

| 序列化方式 | 序列化速度 | 反序列化速度 | 序列化体积 |
|----------|----------|------------|----------|
| JSON | 慢 | 慢 | 大 |
| Java 原生 | 较慢 | 较慢 | 中 |
| Hessian | 中 | 中 | 小 |
| Kryo | 快 | 快 | 小 |
| Protobuf | 极快 | 极快 | 极小 |

**数据背后的原因：**

- **JSON**：字符串解析，需要遍历文本，性能差
- **Java 原生**：反射机制，大量开销
- **Hessian**：二进制，但实现偏保守
- **Kryo**：优化了大量细节，如循环引用缓存、对象复用
- **Protobuf**：固定字段位置，无需解析字段名

---

## 选型指南

### 按场景选择

**场景一：开放 API / 跨语言**

```java
// 选择 JSON
// 原因：可读性好，生态成熟，所有语言都支持
public interface OrderApi {
    @POST("/orders")
    Order createOrder(@Body OrderRequest request);
}
```

**场景二：内部微服务（Java 栈）**

```java
// 选择 Kryo 或 Protobuf
// 原因：高性能，体积小
// 如果需要跨语言，选 Protobuf
// 如果纯 Java，选 Kryo（性能更好）
@Configuration
public class DubboConfig {
    @Bean
    public ProtocolConfig dubboProtocol() {
        ProtocolConfig config = new ProtocolConfig();
        config.setSerialization("kryo"); // 或 "protobuf"
        return config;
    }
}
```

**场景三：对性能要求极高（如大数据、实时计算）**

```java
// 选择 Protobuf + 自定义编解码
// 原因：极致的性能和体积优化
```

### 按框架选择

| RPC 框架 | 默认序列化 | 可选序列化 |
|---------|----------|-----------|
| Dubbo 2.x | Hessian | Kryo、Protobuf、JSON |
| Dubbo 3.x | Triple（基于 Protobuf） | 多种 |
| gRPC | Protobuf | 插件扩展 |
| Thrift | Thrift 二进制 | JSON |

---

## 序列化协议的高级特性

### 循环引用处理

```java
// 场景：订单包含用户，用户又引用订单
class Order {
    User user;
}
class User {
    Order latestOrder; // 循环引用！
}
```

Kryo 和 Hessian 支持循环引用检测，避免无限递归或重复序列化。

### 引用复用

同一个对象多次出现在序列化流中时，只序列化一次，后续引用同一个 ID：

```java
Order order = new Order();
User user = new User();
order.user = user;
order.shipper = user; // user 对象只序列化一次
```

### 泛型支持

```java
// Kryo 序列化泛型
Kryo kryo = getKryo();
kryo.writeObject(output, list); // 自动处理 List&lt;Order&gt;

List&lt;Order&gt; restored = kryo.readObject(input, 
    (Class&lt;List&lt;Order&gt;&gt;) (Class<?>) List.class);
```

---

## 常见问题

### Q：为什么不都用 Protobuf？

A：Protobuf 需要预定义 Schema，增加了开发成本。如果接口经常变动、需要快速迭代，JSON 的灵活性更高。

### Q：Kryo 不跨语言怎么办？

A：如果系统是纯 Java 技术栈，这不是问题。如果需要跨语言，考虑 Protobuf 或 Thrift。

### Q：序列化协议对 RPC 性能影响有多大？

A：**非常大**。以一个返回 100 字节数据的接口为例：
- JSON：序列化后约 150 字节，CPU 开销 0.5ms
- Protobuf：序列化后约 80 字节，CPU 开销 0.1ms

在万级 QPS 下，这个差距会非常明显。

---

## 总结

| 协议 | 性能 | 跨语言 | 可读性 | 推荐场景 |
|-----|-----|-------|-------|---------|
| JSON | 低 | 好 | 高 | 开放 API、调试 |
| Hessian | 中 | 好 | 低 | Dubbo 2.x、跨语言 |
| Kryo | 高 | 差（仅 Java） | 无 | Java 微服务内部 |
| Protobuf | 极高 | 好 | 无 | 高性能、跨语言 |

---

## 留给你的问题

如果你的团队决定从 JSON 迁移到 Protobuf，但接口数量已经超过 200 个，你怎么评估迁移的工作量和风险？

**Schema 驱动开发的理念，如何在迁移过程中发挥作用？**

这个问题，可以结合 [Protobuf 原理](/middleware/rpc/protobuf) 来思考。
