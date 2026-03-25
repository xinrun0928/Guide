# Protobuf 为什么这么快？

你可能听说过 Protobuf 性能很强，但强在哪里？为什么强？

大多数人会告诉你「因为它是二进制的」，但这个答案只说对了一半。JSON 也是二进制（所有文件在磁盘上都是二进制），但 JSON 慢得像蜗牛。

**真正让 Protobuf 快的原因，藏在它的设计细节里。**

---

## 从一个故事开始

假设你要把一个人的信息发给朋友：

**用 JSON 发送：**
```
{"name": "张三", "age": 30, "city": "北京"}
```

**用 Protobuf 发送：**
```
(1) (26) (3) (18)
```

数字变少了，体积变小了。但这只是表面。

**真正的问题是：为什么数字变少了？因为 Protobuf 用了字段标签（Tag）。**

---

## IDL：一种新的接口定义方式

### 什么是 IDL？

IDL（Interface Definition Language，接口定义语言）是一种用来描述数据结构和服务接口的语言。

Java 用 `interface` 定义接口，Protobuf 用 `.proto` 文件定义接口和数据结构。

### 定义一个 Protobuf 消息

```protobuf
syntax = "proto3";

package order;

option java_package = "com.example.order";

message Order {
    // 字段格式：类型 字段名 = 字段编号;
    int64 order_id = 1;           // 订单 ID
    string customer_name = 2;      // 客户名称
    string shipping_address = 3;   // 收货地址
    int32 total_amount = 4;       // 订单金额（分）
    OrderStatus status = 5;       // 订单状态
    repeated Item items = 6;      // 商品列表（repeated 表示数组）
    map&lt;string, string&gt; attributes = 7; // 扩展属性
}

message Item {
    string sku = 1;
    string name = 2;
    int32 quantity = 3;
    int32 price = 4;  // 单价（分）
}

enum OrderStatus {
    UNKNOWN = 0;      // 必须从 0 开始
    PENDING = 1;
    PAID = 2;
    SHIPPED = 3;
    COMPLETED = 4;
    CANCELLED = 5;
}
```

### 字段编号：Protobuf 的核心创新

注意每个字段后面的数字：`order_id = 1`、`customer_name = 2`...

**这就是 Protobuf 的核心：字段编号代替字段名。**

传输时，只传 `1`、`2`、`3` 这样的数字，不传 `"customer_name"` 这种字符串。

| 对比 | JSON | Protobuf |
|-----|------|----------|
| 字段标识 | 字符串 `"customer_name"` | 数字 `2` |
| 类型信息 | 无（靠推断） | 编译时确定 |
| 字段不存在 | 返回 `null` | 使用默认值 |

---

## 编译原理：编译器是怎么工作的？

### 编译器的工作流程

```
order.proto  →  protoc (编译器)  →  OrderProtos.java (生成的代码)
```

### protoc 编译器

`protoc` 是 Protobuf 的官方编译器，负责解析 `.proto` 文件并生成目标语言的代码。

```bash
# 安装 protoc（macOS）
brew install protobuf

# 编译 proto 文件为 Java
protoc --java_out=./src/main/java \
       --proto_path=./src/main/proto \
       order.proto

# 编译为多个语言
protoc --java_out=./java \
       --python_out=./python \
       --cpp_out=./cpp \
       --go_out=./go \
       order.proto
```

### 生成代码解析

生成的 Java 代码长什么样？

```java
// OrderProtos.java（简化版）
public final class OrderProtos {
    
    public static final class Order extends 
        com.google.protobuf.GeneratedMessageV3 {
        
        // 订单 ID，字段编号 1
        private long orderId_ = 0L;
        public static final int ORDER_ID_FIELD_NUMBER = 1;
        public long getOrderId() {
            return orderId_;
        }
        public Builder setOrderId(long value) {
            orderId_ = value;
            onChanged();
            return this;
        }
        
        // 客户名称，字段编号 2
        private volatile Object customerName_ = "";
        public static final int CUSTOMER_NAME_FIELD_NUMBER = 2;
        public String getCustomerName() {
            return customerName_;
        }
        public Builder setCustomerName(String value) {
            if (value == null) {
                throw new NullPointerException();
            }
            customerName_ = value;
            onChanged();
            return this;
        }
        
        // 内部字段存储
        private byte memoizedIsInitialized = -1;
        private int memoizedSize = -1;
        
        // 序列化方法（核心）
        @Override
        public void writeTo(com.google.protobuf.CodedOutputStream output)
                throws java.io.IOException {
            // 写入顺序按字段编号，而非定义顺序
            if (orderId_ != 0L) {
                output.writeInt64(1, orderId_);
            }
            if (!com.google.protobuf.GeneratedMessageV3
                    .equals("", customerName_)) {
                output.writeString(2, customerName_);
            }
            // ... 其他字段
        }
    }
}
```

---

## 编解码原理：字节是怎么拼出来的？

### 基本类型编码规则

| 类型 | 编码方式 | 示例 |
|-----|---------|-----|
| int32/int64 | Varint（变长整数） | 值小则用 1 字节 |
| fixed32/fixed64 | 定长 4/8 字节 | 始终占用固定字节 |
| string/bytes | Length-delimited | 长度 + 数据 |
| bool | Varint（0 或 1） | 1 字节 |

### Varint：变长整数的秘密

**为什么 300 用 Varint 编码只需要 2 个字节？**

```java
// 普通编码：300 = 0x012C，需要 2 个字节
// Varint 编码：300 需要... 竟然是 2 个字节！

// 原理：Varint 用 7 位存储数据，最高位表示「是否有更多字节」
// 300 的二进制：100101100
// 分组（7 位）：0000010 0101100
// 添加延续位：10000010 00101100
// 结果：0x82 0x2C
```

**Varint 的优势：**

- 小数字用很少的字节表示（1-5 字节）
- 大数字用更多字节，但通常业务数据都不会太大
- 大幅减少常见的整数字段体积

### 字段标签的编码

```
字段编号 + 类型信息 → 字段标签
```

```java
// wire_type：0 表示 Varint，1 表示 64-bit，2 表示 Length-delimited，5 表示 32-bit
// 字段标签 = (字段编号 << 3) | wire_type

// customer_name (编号=2, 类型=string/wire_type=2)
// 字段标签 = (2 << 3) | 2 = 18 = 0x12

// 然后再加长度前缀和实际数据
```

### 一个完整的编码示例

```java
// 要编码的 Order 对象
Order.newBuilder()
    .setOrderId(12345L)
    .setCustomerName("张三")
    .build()
    .toByteString();

// 编码结果（十六进制）
08 39 30 12 06 E5 BC A0 E4 B8 89

// 逐字节解析：
08       → 字段 1 (order_id), Varint 类型, 值 = 0x39 = 57? 不对...
// 实际上 Varint 解析：0x08 = 00001000，最低位是 0，表示值就是 0x08 >> 1 = 4
// 但 08 是 Varint 的一部分（延续位），需要继续读下一字节

39 30    → 字段 2 (customer_name), Length-delimited 类型
           长度 = 0x30 >> 1 = 24
           数据 = 后面的 24 个字节（"张三"的 UTF-8 编码）
```

---

## 为什么 Protobuf 比 JSON 快？

### JSON 的解析过程

```java
// JSON 解析伪代码
String json = "{\"orderId\":12345,\"customerName\":\"张三\"}";

// 1. 词法分析：解析成 Token
// {"", "orderId", :, 12345, ,, "customerName", :, "张三", }

// 2. 语法分析：构建 AST
// {key-value-pair, key-value-pair}

// 3. 类型转换：JSON Object → Java Object
// 需要根据字段名查找、类型转换、反射赋值

// 全部是字符串操作，CPU 密集
```

### Protobuf 的解析过程

```java
// Protobuf 解析伪代码
byte[] data = order.toByteArray();
CodedInputStream input = CodedInputStream.newInstance(data);

// 1. 读取字段标签
int tag = input.readTag();
// tag = 0x08 → 字段 1，Varint 类型

// 2. 根据字段编号 switch
switch (WireFormat.getTagFieldNumber(tag)) {
    case 1:  // order_id
        orderId_ = input.readInt64();
        break;
    case 2:  // customer_name
        customerName_ = input.readString();
        break;
    // ...
}

// 直接按编号读取，无需字符串匹配
```

### 性能差距的本质

| 步骤 | JSON | Protobuf |
|-----|------|----------|
| 字段定位 | 字符串匹配（`if ("orderId".equals(key))`） | 按编号直接跳转 |
| 类型解析 | 动态推断（所有值都是 Object） | 编译时确定 |
| 内存分配 | 大量临时对象（字符串、数字） | 按 Schema 预分配 |
| 反射使用 | 大量反射调用 | 无反射，直接字段访问 |

---

## Schema 演进：字段编号的兼容性

### 添加新字段

```protobuf
// v1
message Order {
    int64 order_id = 1;
    string customer_name = 2;
}

// v2（新增字段）
message Order {
    int64 order_id = 1;
    string customer_name = 2;
    string phone_number = 3;  // 新增字段
}
```

**旧版程序收到新数据怎么办？**
- 不认识的字段编号 3，直接跳过
- 不会报错，只是丢失 `phone_number`

### 删除字段

```protobuf
// v3（删除字段）
message Order {
    int64 order_id = 1;
    // 删除了 customer_name
    
    // 保留编号，但不使用了
    reserved 2;
    reserved "customer_name";
    
    string shipping_address = 4;  // 用新的编号
}
```

**注意：删除的编号要 `reserved`，防止被重用导致兼容性问题。**

### 字段编号的规则

| 规则 | 说明 |
|-----|-----|
| 1-15 | 常用字段，用 1 字节编码 |
| 16-2047 | 不常用字段，用 2+ 字节编码 |
| 19000-19999 | 保留编号，不能使用 |
| 最大编号 | 2^29 - 1 = 536,870,911 |

---

## Protobuf 的局限

### 需要预定义 Schema

```protobuf
// 你不能直接序列化一个普通 Java 对象
// 必须定义 .proto 文件，编译后才能用
```

### 不适合频繁变更的接口

每次修改 `.proto` 文件都需要重新编译、重新发布。

### 可读性差

二进制数据无法直接查看，调试时需要借助工具：

```bash
# 使用 protoc 的 text_format 解析
cat order.bin | protoc --decode=Order order.proto
```

---

## 实战：gRPC 中的 Protobuf

gRPC 使用 Protobuf 定义服务和接口：

```protobuf
syntax = "proto3";

package order;

service OrderService {
    // 普通 RPC
    rpc GetOrder(GetOrderRequest) returns (Order);
    
    // 服务端流式 RPC
    rpc SearchOrders(SearchRequest) returns (stream Order);
    
    // 客户端流式 RPC
    rpc BatchCreateOrders(stream CreateOrderRequest) returns (BatchResult);
    
    // 双向流 RPC
    rpc StreamOrders(stream OrderRequest) returns (stream Order);
}

message GetOrderRequest {
    int64 order_id = 1;
}

message SearchRequest {
    string keyword = 1;
    int32 page = 2;
    int32 page_size = 3;
}
```

生成的代码会自动包含 gRPC 的 Stub 类：

```java
// 生成的 gRPC 客户端
public class OrderServiceGrpc {
    public static final class OrderServiceStub 
            extends io.grpc.stub.AbstractStub&lt;OrderServiceStub&gt; {
        
        // 普通调用
        public void getOrder(GetOrderRequest request,
                           io.grpc.stub.StreamObserver&lt;Order&gt; responseObserver) {
            // 发起 RPC 调用
        }
        
        // 服务端流
        public void searchOrders(SearchRequest request,
                                io.grpc.stub.StreamObserver&lt;Order&gt; responseObserver) {
            // 多次调用 responseObserver.onNext() 返回流式数据
        }
    }
}
```

关于流式调用的更多内容，可以阅读 [gRPC 流式调用](/middleware/rpc/grpc-stream)。

---

## 总结

| 特性 | 说明 |
|-----|-----|
| **字段编号** | 用数字代替字段名，大幅减少体积 |
| **Varint** | 变长整数，小数字用更少字节 |
| **无反射** | 编译时生成代码，运行时直接访问字段 |
| **Schema 演进** | 通过 reserved 机制保证兼容性 |
| **跨语言** | 一次定义，多语言生成 |

---

## 留给你的问题

假设你有一个遗留系统，用 JSON 通信，现在想迁移到 Protobuf。

**最大的挑战是什么？是技术问题，还是组织协作问题？如果两边系统分别由不同团队负责，你怎么推动这个迁移？**

这个问题，可以结合 [Dubbo vs gRPC vs Thrift 对比](/middleware/rpc/compare) 来思考。
