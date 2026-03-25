# gRPC 流式调用：为什么普通 RPC 不够用？

你可能用过 gRPC 的普通 RPC 调用：

```java
// 普通 RPC：一次请求，一次响应
Order order = orderService.getOrderById(1001L);
```

这很简单，就像打电话——你问一句，对方答一句。

但如果你的业务是这样的场景呢？

- **文件上传**：几百 MB 的文件，怎么传？
- **实时监控**：服务端需要不断推送数据给客户端
- **聊天消息**：双向持续通信

**普通 RPC 解决不了这些问题，你需要流式调用。**

---

## 三种流式 RPC

gRPC 支持四种 RPC 类型：

| 类型 | 说明 | 比喻 |
|-----|-----|-----|
| **普通 RPC** | 一发一收 | 打电话 |
| **服务端流 RPC** | 一发多收 | 发邮件 |
| **客户端流 RPC** | 多发一收 | 批量上传 |
| **双向流 RPC** | 多发多收 | 微信聊天 |

---

## 服务端流 RPC：Server Streaming

### 场景

客户端发送一个请求，服务端返回一系列消息。

典型场景：
- 获取历史订单（分页返回）
- 实时日志推送
- AI 模型推理的逐步输出

### 定义接口

```protobuf
syntax = "proto3";

package order;

option java_package = "com.example.order";

service OrderService {
    // 普通 RPC
    rpc GetOrder(GetOrderRequest) returns (Order);
    
    // 服务端流 RPC：搜索订单，返回流式结果
    rpc SearchOrders(SearchRequest) returns (stream Order);
    
    // 服务端流 RPC：获取订单变更通知
    rpc WatchOrderStatus(WatchRequest) returns (stream OrderStatusChange);
}

message SearchRequest {
    string keyword = 1;
    int32 page_size = 10;
}

message WatchRequest {
    int64 order_id = 1;
}

message OrderStatusChange {
    int64 order_id = 1;
    OrderStatus old_status = 2;
    OrderStatus new_status = 3;
    int64 change_time = 4;
}

enum OrderStatus {
    UNKNOWN = 0;
    PENDING = 1;
    PAID = 2;
    SHIPPED = 3;
    COMPLETED = 4;
    CANCELLED = 5;
}
```

### 服务端实现

```java
public class OrderServiceImpl extends OrderServiceGrpc.OrderServiceImplBase {
    
    private final OrderRepository orderRepository;
    
    @Override
    public void searchOrders(SearchRequest request,
                           StreamObserver&lt;Order&gt; responseObserver) {
        // 模拟分页查询
        String keyword = request.getKeyword();
        int pageSize = request.getPageSize();
        
        // 第一次查询获取总数
        int total = orderRepository.countByKeyword(keyword);
        int page = 0;
        
        while (page * pageSize < total) {
            // 查询每一页
            List&lt;Order&gt; orders = orderRepository
                .findByKeyword(keyword, page++, pageSize);
            
            // 流式返回每一条
            for (Order order : orders) {
                // 每次调用 onNext，发送一条消息给客户端
                responseObserver.onNext(order);
                
                // 模拟限流：每秒最多返回 100 条
                try {
                    Thread.sleep(10);
                } catch (InterruptedException e) {
                    responseObserver.onError(e);
                    return;
                }
            }
        }
        
        // 发送完成信号
        responseObserver.onCompleted();
    }
}
```

### 客户端调用

```java
public class OrderClient {
    
    private final ManagedChannel channel;
    private final OrderServiceGrpc.OrderServiceBlockingStub blockingStub;
    private final OrderServiceGrpc.OrderServiceStub asyncStub;
    
    public void searchOrdersDemo() {
        SearchRequest request = SearchRequest.newBuilder()
            .setKeyword("手机")
            .setPageSize(100)
            .build();
        
        // 使用阻塞调用获取流
        Iterator&lt;Order&gt; iterator = blockingStub.searchOrders(request);
        
        int count = 0;
        System.out.println("开始接收订单...");
        
        while (iterator.hasNext()) {
            Order order = iterator.next();
            count++;
            System.out.printf("收到订单 #%d: %s%n", 
                order.getOrderId(), order.getCustomerName());
        }
        
        System.out.println("共收到 " + count + " 个订单");
    }
}
```

---

## 客户端流 RPC：Client Streaming

### 场景

客户端发送一系列消息，服务端返回一个响应。

典型场景：
- 批量上传订单
- 大文件分片上传
- 批量导入数据

### 定义接口

```protobuf
service OrderService {
    // 客户端流 RPC：批量创建订单
    rpc BatchCreateOrders(stream CreateOrderRequest) returns (BatchCreateResponse);
    
    // 客户端流 RPC：批量取消订单
    rpc BatchCancelOrders(stream CancelOrderRequest) returns (BatchCancelResponse);
}

message CreateOrderRequest {
    string customer_name = 1;
    int32 total_amount = 2;
    repeated string sku_codes = 3;
}

message BatchCreateResponse {
    int32 success_count = 1;
    int32 fail_count = 2;
    repeated int64 created_order_ids = 3;
    repeated string errors = 4;
}
```

### 服务端实现

```java
@Override
public StreamObserver&lt;CreateOrderRequest&gt; batchCreateOrders(
        StreamObserver&lt;BatchCreateResponse&gt; responseObserver) {
    
    // 返回 StreamObserver 用于接收客户端消息
    return new StreamObserver&lt;CreateOrderRequest&gt;() {
        
        private List&lt;Long&gt; successIds = new ArrayList&lt;&gt;();
        private List&lt;String&gt; errors = new ArrayList&lt;&gt;();
        
        // 每收到一条客户端消息调用一次
        @Override
        public void onNext(CreateOrderRequest request) {
            try {
                // 校验参数
                if (request.getTotalAmount() <= 0) {
                    throw new IllegalArgumentException("金额必须大于 0");
                }
                
                // 创建订单
                Order order = orderService.createOrder(
                    request.getCustomerName(),
                    request.getTotalAmount(),
                    request.getSkuCodesList()
                );
                
                successIds.add(order.getId());
                
            } catch (Exception e) {
                errors.add("订单 " + request.getCustomerName() 
                    + " 创建失败: " + e.getMessage());
            }
        }
        
        // 客户端发送完毕，客户端会调用 onCompleted
        @Override
        public void onCompleted() {
            // 所有消息都接收完了，返回汇总结果
            BatchCreateResponse response = BatchCreateResponse.newBuilder()
                .setSuccessCount(successIds.size())
                .setFailCount(errors.size())
                .addAllCreatedOrderIds(successIds)
                .addAllErrors(errors)
                .build();
            
            responseObserver.onNext(response);
            responseObserver.onCompleted();
        }
        
        @Override
        public void onError(Throwable t) {
            // 客户端出错，记录日志
            log.error("批量创建订单失败", t);
        }
    };
}
```

### 客户端调用

```java
public void batchCreateOrdersDemo() {
    // 使用异步 stub
    StreamObserver&lt;CreateOrderRequest&gt; requestObserver = 
        asyncStub.batchCreateOrders(new StreamObserver&lt;BatchCreateResponse&gt;() {
            
            private BatchCreateResponse finalResponse;
            
            @Override
            public void onNext(BatchCreateResponse response) {
                // 服务端返回最终结果
                this.finalResponse = response;
            }
            
            @Override
            public void onCompleted() {
                // 收到响应
                System.out.println("批量创建完成:");
                System.out.println("  成功: " + finalResponse.getSuccessCount());
                System.out.println("  失败: " + finalResponse.getFailCount());
            }
            
            @Override
            public void onError(Throwable t) {
                System.err.println("调用失败: " + t.getMessage());
            }
        });
    
    // 模拟批量发送请求
    for (int i = 0; i < 100; i++) {
        CreateOrderRequest request = CreateOrderRequest.newBuilder()
            .setCustomerName("客户 #" + i)
            .setTotalAmount(100 + i)
            .addSkuCodes("SKU00" + (i % 10))
            .build();
        
        // 发送请求
        requestObserver.onNext(request);
        
        // 模拟限流
        try {
            Thread.sleep(10);
        } catch (InterruptedException e) {
            requestObserver.onError(e);
            return;
        }
    }
    
    // 发送完毕，必须调用 onCompleted
    requestObserver.onCompleted();
}
```

---

## 双向流 RPC：Bidirectional Streaming

### 场景

客户端和服务端都可以随时发送消息，互不阻塞。

典型场景：
- 实时聊天
- 在线协作编辑
- 游戏同步

### 定义接口

```protobuf
service ChatService {
    // 双向流 RPC：聊天室
    rpc Chat(stream ChatMessage) returns (stream ChatMessage);
}

message ChatMessage {
    string session_id = 1;
    string user_id = 2;
    string content = 3;
    int64 timestamp = 4;
}
```

### 服务端实现

```java
@Override
public StreamObserver&lt;ChatMessage&gt; chat(
        StreamObserver&lt;ChatMessage&gt; responseObserver) {
    
    return new StreamObserver&lt;ChatMessage&gt;() {
        
        private final Map&lt;String, Set&lt;StreamObserver&lt;ChatMessage&gt;&gt;&gt; 
            sessions = new ConcurrentHashMap&lt;&gt;();
        
        @Override
        public void onNext(ChatMessage message) {
            String sessionId = message.getSessionId();
            
            // 获取该会话的所有在线用户
            Set&lt;StreamObserver&lt;ChatMessage&gt;&gt; subscribers = 
                sessions.computeIfAbsent(sessionId, 
                    k -> ConcurrentHashMap.newKeySet());
            
            // 广播消息给所有订阅者（包括发送者）
            ChatMessage broadcastMsg = ChatMessage.newBuilder(message)
                .setTimestamp(System.currentTimeMillis())
                .build();
            
            for (StreamObserver&lt;ChatMessage&gt; subscriber : subscribers) {
                subscriber.onNext(broadcastMsg);
            }
        }
        
        @Override
        public void onCompleted() {
            // 客户端离开会话
            sessions.remove(this);
        }
        
        @Override
        public void onError(Throwable t) {
            log.error("聊天出错", t);
        }
    };
}
```

### 客户端实现

```java
public void chatDemo() {
    // 发起双向流调用
    StreamObserver&lt;ChatMessage&gt; chatStream = asyncStub.chat(
        new StreamObserver&lt;ChatMessage&gt;() {
            
            @Override
            public void onNext(ChatMessage message) {
                // 收到服务端消息
                System.out.printf("[%s] %s: %s%n",
                    formatTime(message.getTimestamp()),
                    message.getUserId(),
                    message.getContent());
            }
            
            @Override
            public void onCompleted() {
                System.out.println("会话结束");
            }
            
            @Override
            public void onError(Throwable t) {
                System.err.println("连接失败: " + t.getMessage());
            }
        }
    );
    
    // 模拟发送消息
    String[] messages = {
        "你好",
        "在吗？",
        "想聊聊 gRPC 流式调用",
        "双向流真强大！"
    };
    
    for (String content : messages) {
        ChatMessage message = ChatMessage.newBuilder()
            .setSessionId("session-001")
            .setUserId("user-zhang")
            .setContent(content)
            .setTimestamp(System.currentTimeMillis())
            .build();
        
        chatStream.onNext(message);
        
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            chatStream.onError(e);
            return;
        }
    }
    
    // 结束会话
    chatStream.onCompleted();
}
```

---

## 流式调用的底层原理

### HTTP/2 的多路复用

流式调用依赖于 HTTP/2 的多路复用特性：

```
HTTP/1.1：每次请求需要独立的 TCP 连接（或串行使用）
┌────────────────────────────────────────────────────┐
│  Request 1 → Response 1 → Request 2 → Response 2  │
└────────────────────────────────────────────────────┘

HTTP/2：多个 Stream 共用一个 TCP 连接
┌────────────────────────────────────────────────────┐
│ Stream 1:  HEADERS ──────────────────────────────→  │
│ Stream 1:  DATA ──────────────────────────────→   │
│ Stream 1:  DATA ──────────────────────────────→   │
│ Stream 2:  HEADERS ────────────────→              │
│ Stream 2:  DATA ────────────────→                 │
│ Stream 1:  DATA ──────────────────────────────→   │
└────────────────────────────────────────────────────┘
```

**每个 Stream 都有自己的 Stream ID，互不干扰，可以并发传输。**

### 数据帧结构

```
┌──────────────────────────────────────────────────────┐
│                  HTTP/2 Frame                       │
├────────────┬────────────┬───────────┬───────────────┤
│ Length(3B)│ Type(1B)   │ Flags(1B) │ Stream ID(4B) │
├────────────┴────────────┴───────────┴───────────────┤
│                    Payload                           │
└──────────────────────────────────────────────────────┘
```

- **DATA 帧**：传输业务数据（如 Protobuf 序列化的消息）
- **HEADERS 帧**：传输元数据（如方法名、metadata）
- **WINDOW_UPDATE**：流量控制

---

## 流式调用的注意事项

### 1. 背压（Backpressure）

当发送方速度过快，接收方处理不过来时，需要背压机制：

```java
// 服务端实现时，注意处理背压
@Override
public void searchOrders(SearchRequest request,
                        StreamObserver&lt;Order&gt; responseObserver) {
    
    // 使用 Channel 实现背压
    Channel&lt;Order&gt; orderChannel = orderRepository.streamOrders(request);
    
    // 控制发送速度，不要超过客户端消费速度
    while (orderChannel.isOpen()) {
        Order order = orderChannel.poll(100, TimeUnit.MILLISECONDS);
        if (order != null) {
            responseObserver.onNext(order);
        }
    }
    
    responseObserver.onCompleted();
}
```

### 2. 超时控制

```java
// 设置流式调用的超时
ManagedChannel channel = ManagedChannelBuilder
    .forAddress("localhost", 8080)
    .build();

// 普通超时
try {
    Order order = blockingStub
        .withDeadlineAfter(5, TimeUnit.SECONDS)
        .getOrder(request);
} catch (StatusRuntimeException e) {
    if (e.getStatus() == Status.DEADLINE_EXCEEDED) {
        System.err.println("调用超时");
    }
}

// 流式调用超时（每条消息都要检查）
Iterator&lt;Order&gt; iterator = blockingStub
    .withDeadlineAfter(30, TimeUnit.SECONDS)
    .searchOrders(request);
```

### 3. 错误处理

```java
// 服务端主动报错
@Override
public void getOrder(GetOrderRequest request,
                    StreamObserver&lt;Order&gt; responseObserver) {
    try {
        Order order = orderRepository.findById(request.getOrderId());
        if (order == null) {
            // 返回 NOT_FOUND 错误
            responseObserver.onError(Status.NOT_FOUND
                .withDescription("订单不存在: " + request.getOrderId())
                .asRuntimeException());
            return;
        }
        responseObserver.onNext(order);
        responseObserver.onCompleted();
    } catch (Exception e) {
        // 返回 INTERNAL 错误
        responseObserver.onError(Status.INTERNAL
            .withCause(e)
            .asRuntimeException());
    }
}
```

---

## 总结

| 流类型 | 方法 | 使用场景 |
|-------|------|---------|
| 普通 RPC | `rpc Method(Request) returns (Response)` | 简单请求响应 |
| 服务端流 | `rpc Method(Request) returns (stream Response)` | 分页数据、实时推送 |
| 客户端流 | `rpc Method(stream Request) returns (Response)` | 批量上传、大文件传输 |
| 双向流 | `rpc Method(stream Request) returns (stream Response)` | 聊天、协作、游戏 |

**流式 RPC 是 gRPC 区别于传统 REST 的核心优势之一，合理使用可以大幅提升系统性能和实时性。**

---

## 留给你的问题

假设你正在设计一个实时协作文档编辑系统，需要考虑：

- 多个用户同时编辑同一份文档
- 每次编辑操作需要实时同步给所有在线用户
- 网络不稳定时需要处理重连和冲突

**在这种场景下，普通 RPC 能否满足需求？如果用双向流 RPC，你需要考虑哪些问题？**

这个问题，可以结合 [RPC 超时控制与重试机制](/middleware/rpc/timeout-retry) 来思考如何保证流式调用的可靠性。
