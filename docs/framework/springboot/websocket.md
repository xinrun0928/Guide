# WebSocket 整合：实现实时双向通信

你有没有想过，网页上怎么实现实时消息推送？

传统的 HTTP 请求是「一问一答」模式，服务器不能主动推送消息给客户端。

而 WebSocket 解决了这个问题——**建立一次连接，双向通信**。

这一节，我们来学习 Spring Boot 如何整合 WebSocket。

## WebSocket 是什么？

WebSocket 是一种在单个 TCP 连接上进行全双工通信的协议。

```
┌─────────────────────────────────────────────────────────────────┐
│                    HTTP vs WebSocket                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  HTTP（轮询）                                                   │
│  ┌────────┐    请求     ┌────────┐    请求     ┌────────┐      │
│  │ Client │ ─────────► │ Server │ ─────────► │ Client │      │
│  └────────┘             └────────┘             └────────┘      │
│       │                                        │                 │
│       │     ◄─────────────────────────────────┘                 │
│       │              响应（N 秒后）                              │
│                                                                 │
│  WebSocket（双向）                                              │
│  ┌────────┐                        ┌────────┐                    │
│  │ Client │ ◄────────────────────► │ Server │                    │
│  └────────┘    双向实时通信          └────────┘                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## WebSocket 使用场景

- 实时聊天
- 在线游戏
- 股票行情推送
- 实时协作编辑
- 系统通知
- IoT 设备状态

## Spring Boot 整合 WebSocket

### 方式一：@ServerEndpoint（标准方式）

#### Maven 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-websocket</artifactId>
</dependency>
```

#### 配置类

```java
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(myHandler(), "/ws")
                .setAllowedOrigins("*");  // 允许跨域
    }

    @Bean
    public TextWebSocketHandler myHandler() {
        return new MyWebSocketHandler();
    }
}
```

#### WebSocket 处理器

```java
@Component
public class MyWebSocketHandler extends TextWebSocketHandler {

    // 保存所有连接
    private final CopyOnWriteArraySet<WebSocketSession> sessions = new CopyOnWriteArraySet<>();

    /**
     * 连接建立
     */
    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.add(session);
        System.out.println("连接建立: " + session.getId());
    }

    /**
     * 接收消息
     */
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        System.out.println("收到消息: " + payload);

        // 广播给所有客户端
        for (WebSocketSession s : sessions) {
            s.sendMessage(new TextMessage("服务器收到: " + payload));
        }
    }

    /**
     * 连接关闭
     */
    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        sessions.remove(session);
        System.out.println("连接关闭: " + session.getId());
    }

    /**
     * 异常处理
     */
    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        System.out.println("传输异常: " + exception.getMessage());
        sessions.remove(session);
    }
}
```

### 方式二：STOMP 协议（推荐）

STOMP 是一个简单的消息协议，提供了订阅/发布机制，更适合企业应用。

#### 配置类

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // 订阅前缀（客户端接收消息的前缀）
        registry.enableSimpleBroker("/topic", "/queue");

        // 请求前缀（客户端发送消息的前缀）
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // STOMP 端点
        registry.addEndpoint("/ws")
                .setAllowedOrigins("*");

        // SockJS 支持（SockJS 提供降级方案）
        registry.addEndpoint("/ws")
                .setAllowedOrigins("*")
                .withSockJS();
    }
}
```

#### 消息控制器

```java
@Controller
public class ChatController {

    /**
     * 发送消息到 /app/chat
     * 客户端订阅 /topic/public 接收
     */
    @MessageMapping("/chat")
    @SendTo("/topic/public")
    public ChatMessage sendMessage(@Payload ChatMessage message) {
        return message;
    }

    /**
     * 私有消息
     */
    @MessageMapping("/private")
    public void sendPrivateMessage(@Payload PrivateMessage message, Principal principal) {
        // 发送到指定用户
        messagingTemplate.convertAndSendToUser(
            message.getTo(),   // 用户名
            "/queue/private",   // 目的地
            message            // 消息内容
        );
    }
}
```

#### 客户端代码（JavaScript）

```javascript
// 建立连接
const socket = new SockJS('/ws');
const stompClient = Stomp.over(socket);

// 连接
stompClient.connect({}, function(frame) {
    console.log('Connected: ' + frame);

    // 订阅公共频道
    stompClient.subscribe('/topic/public', function(message) {
        showMessage(JSON.parse(message.body));
    });

    // 订阅私有频道
    stompClient.subscribe('/user/queue/private', function(message) {
        showPrivateMessage(JSON.parse(message.body));
    });
});

// 发送消息
function sendMessage() {
    stompClient.send("/app/chat", {},
        JSON.stringify({'content': 'Hello', 'sender': 'User1'}));
}

// 断开连接
stompClient.disconnect();
```

## 集群环境下的 WebSocket

### 问题

多节点部署时，用户可能连接到不同的服务器，A 发送的消息无法直接推送给 B。

### 解决方案

#### 方案一：Redis Pub/Sub

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Autowired
    private RedisMessageBroker redisMessageBroker;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");

        // 使用 Redis 作为消息代理
        registry.setSimpleBroker("/topic", "/queue")
                .setRelayHost("localhost")
                .setRelayPort(61613)
                .setSystemLogin("guest")
                .setSystemPasscode("guest");
    }
}
```

#### 方案二：消息队列

```
用户A → Server1 → RabbitMQ/Kafka → Server2 → 用户B
```

## 完整示例：在线聊天系统

### 消息实体

```java
@Data
public class ChatMessage {
    private MessageType type;
    private String content;
    private String sender;
    private String time;

    public enum MessageType {
        CHAT, JOIN, LEAVE
    }
}
```

### 控制器

```java
@Controller
public class ChatController {

    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    public ChatController(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/chat.send")
    @SendTo("/topic/public")
    public ChatMessage sendMessage(ChatMessage message) {
        message.setTime(LocalDateTime.now().toString());
        return message;
    }

    @MessageMapping("/chat.join")
    public void addUser(ChatMessage message) {
        message.setType(ChatMessage.MessageType.JOIN);
        messagingTemplate.convertAndSend("/topic/public", message);
    }

    @MessageMapping("/chat.leave")
    public void removeUser(ChatMessage message) {
        message.setType(ChatMessage.MessageType.LEAVE);
        messagingTemplate.convertAndSend("/topic/public", message);
    }
}
```

### 前端页面

```html
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Chat</title>
    <script src="https://cdn.jsdelivr.net/npm/sockjs-client@1/dist/sockjs.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/stompjs@2.3.3/lib/stomp.min.js"></script>
</head>
<body>
    <div id="chat">
        <div id="messages"></div>
        <input type="text" id="message" placeholder="输入消息...">
        <button onclick="send()">发送</button>
    </div>

    <script>
        const socket = new SockJS('/ws');
        const stompClient = Stomp.over(socket);

        stompClient.connect({}, function() {
            stompClient.subscribe('/topic/public', function(message) {
                showMessage(JSON.parse(message.body));
            });
        });

        function send() {
            const msg = document.getElementById('message').value;
            stompClient.send('/app/chat.send', {}, JSON.stringify({
                content: msg,
                sender: 'User'
            }));
        }

        function showMessage(msg) {
            document.getElementById('messages').innerHTML +=
                `<div>${msg.sender}: ${msg.content}</div>`;
        }
    </script>
</body>
</html>
```

## 常见问题

### 问题一：WebSocket 断开重连

```javascript
function connect() {
    socket = new SockJS('/ws');
    stompClient = Stomp.over(socket);

    stompClient.connect({}, function() {
        // 连接成功
    }, function() {
        // 连接失败，5 秒后重连
        setTimeout(connect, 5000);
    });
}
```

### 问题二：心跳检测

```java
@Override
public void configureServerConfig(ServerEndpointConfig.Configurator configurator) {
    configurator.getContainer().execPingFrame();
}
```

### 问题三：会话管理

```java
// 使用 ConcurrentHashMap 存储用户会话
private final Map<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();
```

---

## 面试高频问题

### Q1：WebSocket 和 HTTP 的区别？

HTTP 是请求-响应模式，服务器不能主动推送；WebSocket 是全双工通信，建立连接后双方可以随时发送消息。

### Q2：WebSocket 的握手过程？

客户端发送 Upgrade 请求，服务器返回 101 状态码，连接升级为 WebSocket。

### Q3：Spring Boot 如何实现 WebSocket？

通过 `@EnableWebSocket` 启用，配合 `@ServerEndpoint` 或 STOMP 协议实现。

---

## 最佳实践

1. **使用 STOMP 协议**：更适合企业应用，提供订阅机制
2. **心跳检测**：检测连接是否存活
3. **重连机制**：网络不稳定时自动重连
4. **消息压缩**：大消息考虑压缩
5. **集群支持**：多节点部署时使用 Redis 或消息队列

---

## 思考题

WebSocket 连接断开后，如何保证消息不丢失？

提示：消息持久化 + 重连后拉取未读消息。

下一节，我们学习 [GraphQL 整合](/framework/springboot/graphql)，另一种 API 设计风格。
