# gRPC 入门：Protocol Buffers 与 HTTP/2

你有没有想过这个问题：

REST API 用 JSON，Dubbo 用 Hessian/Protobuf。

但如果我告诉你，有一种方案可以比 REST 快 5-10 倍，同时支持双向流式调用，还自动生成多语言代码——你会不会觉得太完美了？

这就是 **gRPC**。

今天，我们来彻底搞清楚 gRPC 的核心技术栈。

## gRPC 是什么？

gRPC 是 Google 开源的高性能 RPC 框架，核心是：

- **HTTP/2**：高性能网络传输协议
- **Protocol Buffers**：高效的序列化格式
- **多语言支持**：自动生成各语言的客户端/服务端代码

```
┌─────────────────────────────────────────────────────────┐
│                      gRPC 技术栈                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │                   gRPC 框架                      │  │
│  │  ┌─────────────┐  ┌─────────────┐               │  │
│  │  │ HTTP/2     │  │ ProtoBuf    │               │  │
│  │  │ 多路复用    │  │ 高效序列化  │               │  │
│  │  │ Header压缩  │  │ 强类型定义  │               │  │
│  │  └─────────────┘  └─────────────┘               │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  支持：Java, Go, Python, C++, Node.js, C#, Ruby...      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Protocol Buffers：比 JSON 小 5-20 倍

### 什么是 Protocol Buffers？

Protocol Buffers（简称 ProtoBuf）是 Google 开发的一种序列化协议，比 JSON/XML 更小、更快。

### 定义 .proto 文件

```protobuf
syntax = "proto3";

package com.example;

option java_multiple_files = true;
option java_package = "com.example.grpc";
option java_outer_classname = "UserServiceProto";

// 用户服务
service UserService {
    // 一元 RPC：一次请求一次响应
    rpc GetUser (UserRequest) returns (UserResponse);

    // 服务端流：一次请求多次响应
    rpc ListUsers (UserListRequest) returns (stream UserResponse);

    // 客户端流：多次请求一次响应
    rpc CreateUsers (stream UserRequest) returns (UserCreateResponse);

    // 双向流：多次请求多次响应
    rpc StreamUsers (stream UserRequest) returns (stream UserResponse);
}

// 请求消息
message UserRequest {
    int64 id = 1;      // 字段编号，序列化时使用编号而非字段名
}

// 用户响应
message UserResponse {
    int64 id = 1;
    string name = 2;
    string email = 3;
    int32 age = 4;
}

// 列表请求
message UserListRequest {
    string department = 1;
}

// 批量创建响应
message UserCreateResponse {
    int32 success_count = 1;
    repeated int64 user_ids = 2;
}
```

### ProtoBuf vs JSON 对比

```
相同数据序列化后的大小对比：

JSON：
{
    "id": 12345,
    "name": "张三",
    "email": "zhangsan@example.com",
    "age": 28
}
大小：89 字节

ProtoBuf：
字段编号 + 数据，字符串只有内容没有字段名
大小：28 字节

节省空间：69%
序列化速度：ProtoBuf 比 JSON 快 5-10 倍
```

### ProtoBuf 的优势

| 特性 | JSON | ProtoBuf |
|-----|------|---------|
| 体积 | 大（含字段名） | 小（只用编号） |
| 速度 | 中 | 快 5-10 倍 |
| 类型安全 | 弱（字符串、数字） | 强（明确定义类型） |
| 可读性 | 好（人类可读） | 差（需要解析） |
| 跨语言 | 简单 | 需要 .proto 编译器 |

## HTTP/2：高性能网络协议

HTTP/2 是 HTTP/1.1 的升级，主要改进：

### 多路复用：解决队头阻塞

HTTP/1.1 的问题：每个 TCP 连接一次只能传输一个请求/响应（队头阻塞）。

```
HTTP/1.1：
连接 1：请求 A ──────────────→ 响应 A ←──────────────
连接 2：请求 B ───────→ 响应 B ←──────────
连接 3：请求 C ─→ 响应 C ←─────
需要建立多个连接来并发请求

HTTP/2：
连接 1（多路复用）：
    Stream 1：请求 A ────────────→ 响应 A ←───────────
    Stream 2：请求 B ───→ 响应 B ←──
    Stream 3：请求 C ─→ 响应 C ←─
一条连接，并行传输多个请求！
```

### Header 压缩：HPACK

HTTP/1.1 每次请求都携带大量重复的 Header：

```
HTTP/1.1：
GET /api/users HTTP/1.1
Host: api.example.com
Accept: application/json
Authorization: Bearer xxx
... (几百字节)

HTTP/2（HPACK 压缩后）：
Header 复用 + 整数编码 + Huffman 编码
实际传输可能只需要 10-20 字节
```

### 其他特性

- **服务器推送**：服务端可以主动推送资源
- **流控**：更精细的流量控制
- **优先级**：可以设置请求优先级

## gRPC 的四种通信模式

gRPC 支持四种 RPC 类型，比 REST 更丰富：

### 1. Unary RPC（一元 RPC）

最普通的请求-响应模式。

```protobuf
rpc GetUser (UserRequest) returns (UserResponse);
```

```java
// 服务端
public class UserServiceImpl extends UserServiceGrpc.UserServiceImplBase {
    @Override
    public void getUser(UserRequest request, StreamObserver<UserResponse> responseObserver) {
        UserResponse response = UserResponse.newBuilder()
            .setId(request.getId())
            .setName("张三")
            .build();
        responseObserver.onNext(response);
        responseObserver.onCompleted();
    }
}

// 客户端
UserResponse response = blockingStub.getUser(UserRequest.newBuilder()
    .setId(1L)
    .build());
```

### 2. Server Streaming（服务端流）

一次请求，服务端分多次返回。

```protobuf
rpc GetUserOrders (UserRequest) returns (stream OrderResponse);
```

```java
// 服务端
@Override
public void getUserOrders(UserRequest request, StreamObserver<OrderResponse> responseObserver) {
    // 分多次返回
    for (Order order : orderService.findByUserId(request.getId())) {
        responseObserver.onNext(OrderResponse.newBuilder()
            .setOrderId(order.getId())
            .build());
    }
    responseObserver.onCompleted();
}

// 客户端：迭代器接收
Iterator<OrderResponse> responses = asyncStub.getUserOrders(request);
while (responses.hasNext()) {
    OrderResponse order = responses.next();
    // 处理每个订单
}
```

### 3. Client Streaming（客户端流）

客户端分多次发送，服务端一次返回。

```protobuf
rpc UploadUserData (stream UserData) returns (UploadResponse);
```

```java
// 客户端：流式发送
StreamObserver<UploadResponse> responseObserver = new StreamObserver<UploadResponse>() {
    @Override
    public void onNext(UploadResponse response) {
        System.out.println("上传完成：" + response.getStatus());
    }

    @Override
    public void onError(Throwable t) { }

    @Override
    public void onCompleted() { }
};

StreamObserver<UserData> requestObserver = asyncStub.uploadUserData(responseObserver);
for (UserData data : userDataList) {
    requestObserver.onNext(data);
}
requestObserver.onCompleted();
```

### 4. Bidirectional Streaming（双向流）

客户端和服务端都可以分多次发送和接收。

```protobuf
rpc Chat (stream ChatMessage) returns (stream ChatMessage);
```

```java
// 服务端
@Override
public StreamObserver<ChatMessage> chat(StreamObserver<ChatMessage> responseObserver) {
    return new StreamObserver<ChatMessage>() {
        @Override
        public void onNext(ChatMessage message) {
            // 收到消息后，发送回复
            responseObserver.onNext(ChatMessage.newBuilder()
                .setContent("收到：" + message.getContent())
                .build());
        }

        @Override
        public void onError(Throwable t) { }

        @Override
        public void onCompleted() {
            responseObserver.onCompleted();
        }
    };
}
```

## Java gRPC 完整示例

### 1. 添加依赖

```xml
<dependency>
    <groupId>io.grpc</groupId>
    <artifactId>grpc-netty-shaded</artifactId>
    <version>1.59.0</version>
</dependency>
<dependency>
    <groupId>io.grpc</groupId>
    <artifactId>grpc-protobuf</artifactId>
    <version>1.59.0</version>
</dependency>
<dependency>
    <groupId>io.grpc</groupId>
    <artifactId>grpc-stub</artifactId>
    <version>1.59.0</version>
</dependency>
<dependency>
    <groupId>io.grpc</groupId>
    <artifactId>grpc-services</artifactId>
    <version>1.59.0</version>
</dependency>
<!-- 注解处理 -->
<dependency>
    <groupId>org.apache.tomcat</groupId>
    <artifactId>annotations-api</artifactId>
    <version>6.0.53</version>
    <scope>provided</scope>
</dependency>
```

### 2. Maven 插件编译 proto

```xml
<build>
    <extensions>
        <extension>
            <groupId>kr.motd.maven</groupId>
            <artifactId>os-maven-plugin</artifactId>
            <version>1.7.1</version>
        </extension>
    </extensions>
    <plugins>
        <plugin>
            <groupId>org.xolstice.maven.plugins</groupId>
            <artifactId>protobuf-maven-plugin</artifactId>
            <version>0.6.1</version>
            <configuration>
                <protocArtifact>
                    com.google.protobuf:protoc:3.25.0:exe:${os.detected.classifier}
                </protocArtifact>
                <pluginId>grpc-java</pluginId>
                <pluginArtifact>
                    io.grpc:protoc-gen-grpc-java:1.59.0:exe:${os.detected.classifier}
                </pluginArtifact>
            </configuration>
            <executions>
                <execution>
                    <goals>
                        <goal>compile</goal>
                        <goal>compile-custom</goal>
                    </goals>
                </execution>
            </executions>
        </plugin>
    </plugins>
</build>
```

### 3. 服务端实现

```java
public class GrpcServer {

    public static void main(String[] args) throws IOException, InterruptedException {
        // 创建 gRPC 服务器
        Server server = ServerBuilder.forPort(8080)
            .addService(new UserServiceImpl())
            .build();

        server.start();
        System.out.println("gRPC Server started on port 8080");

        server.awaitTermination();
    }
}

class UserServiceImpl extends UserServiceGrpc.UserServiceImplBase {

    private final UserDao userDao = new UserDao();

    @Override
    public void getUser(UserRequest request, StreamObserver<UserResponse> responseObserver) {
        User user = userDao.findById(request.getId());

        UserResponse response = UserResponse.newBuilder()
            .setId(user.getId())
            .setName(user.getName())
            .setEmail(user.getEmail())
            .setAge(user.getAge())
            .build();

        responseObserver.onNext(response);
        responseObserver.onCompleted();
    }
}
```

### 4. 客户端实现

```java
public class GrpcClient {

    public static void main(String[] args) {
        // 创建 Channel
        ManagedChannel channel = ManagedChannelBuilder
            .forAddress("localhost", 8080)
            .usePlaintext()  // 测试环境，生产环境应使用 TLS
            .build();

        try {
            // 创建 Stub
            UserServiceGrpc.UserServiceBlockingStub blockingStub =
                UserServiceGrpc.newBlockingStub(channel);

            // 调用远程服务
            UserRequest request = UserRequest.newBuilder()
                .setId(1L)
                .build();

            UserResponse response = blockingStub.getUser(request);

            System.out.println("用户信息：");
            System.out.println("  ID: " + response.getId());
            System.out.println("  姓名: " + response.getName());
            System.out.println("  邮箱: " + response.getEmail());

        } finally {
            channel.shutdown();
        }
    }
}
```

## gRPC vs REST

| 维度 | REST | gRPC |
|-----|------|------|
| **协议** | HTTP/1.1 | HTTP/2 |
| **数据格式** | JSON | ProtoBuf |
| **传输效率** | 中 | 高（5-10 倍） |
| **类型安全** | 弱 | 强 |
| **代码生成** | Swagger/OpenAPI | .proto 自动生成 |
| **流式支持** | 不原生支持 | 支持 |
| **浏览器支持** | 原生支持 | 需要 gRPC-Web |
| **可读性** | 高（JSON 可见） | 低（二进制） |
| **生态** | 成熟庞大 | 快速发展 |

## 面试追问方向

- HTTP/2 的多路复用是怎么实现的？为什么能解决队头阻塞？
- ProtoBuf 的字段编号是怎么设计的？为什么不能重复使用？
- gRPC 怎么实现负载均衡？客户端负载均衡 vs 服务端负载均衡？
- gRPC-Web 是什么？有什么限制？

## 总结

gRPC 代表了现代 RPC 的发展方向：

```
┌─────────────────────────────────────────────────────────┐
│                  为什么选择 gRPC？                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 性能：HTTP/2 + ProtoBuf，比 REST 快 5-10 倍         │
│                                                         │
│  2. 类型安全：.proto 定义接口，强类型约束                 │
│                                                         │
│  3. 多语言：一次定义，自动生成各语言代码                  │
│                                                         │
│  4. 流式：原生支持四种 RPC 模式                         │
│                                                         │
│  5. 双向：真正的双向通信，不像 REST 需要轮询            │
│                                                         │
│  适用场景：                                            │
│  - 微服务内部通信                                      │
│  - 高性能数据传输                                       │
│  - 实时流处理                                          │
│  - 移动端与后端通信                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

gRPC 不是银弹——它不适合需要浏览器直接访问或需要人类可读数据的场景。但在你需要高性能、强类型、双向通信的场景下，gRPC 是绝佳的选择。
