# Tomcat 线程模型与 NIO 处理

Tomcat 8 比 Tomcat 7 快了多少？

有人说 3 倍，有人说 10 倍。

但很少有人说出本质：**Tomcat 8 默认用 NIO，而 Tomcat 7 默认用 BIO**。

这意味着什么？

意味着从「每个连接一个线程」变成了「一个线程处理多个连接」。

今天，我们来彻底理解 Tomcat 的线程模型。

---

## Tomcat 架构：Server → Service → Connector

### 核心组件

```
Server
  └── Service
        └── Engine（容器）
              └── Host
                    └── Context
                          └── Wrapper
        └── Connector（连接器）← 处理网络连接
```

| 组件 | 职责 |
|-----|------|
| Server | Tomcat 实例，代表整个 Servlet 容器 |
| Service | 包含 Engine 和 Connector 的服务单元 |
| Connector | 处理网络连接，监听端口 |
| Engine | Servlet 引擎，处理请求 |
| Host | 虚拟主机 |
| Context | Web 应用 |
| Wrapper | 单个 Servlet |

### Connector 的作用

Connector 是 Tomcat 的核心，负责：

1. 监听网络端口
2. 接收连接请求
3. 处理 HTTP 请求/响应
4. 与容器交互

---

## Tomcat 线程模型演进

### BIO 时代：Thread per Request

Tomcat 3/4/5 默认使用 BIO（也叫阻塞连接器）：

```
请求 1 ──→ Thread 1
请求 2 ──→ Thread 2
请求 3 ──→ Thread 3
...
请求 N ──→ Thread N
```

**每个连接分配一个线程**：

```java
// Tomcat BIO 的简化模型
ServerSocket serverSocket = new ServerSocket(8080);
while (true) {
    Socket socket = serverSocket.accept();  // 阻塞
    new Thread(() -> {
        handleRequest(socket);  // 每个请求一个线程
    }).start();
}
```

**问题**：

- 10000 并发 = 10000 线程
- 线程栈默认 1MB = 10GB 内存
- 线程上下文切换开销巨大

### NIO 时代：一个线程处理多个连接

Tomcat 8+ 默认使用 NIO：

```
                    ┌──────────────┐
  Connection 1 ──→ │              │
  Connection 2 ──→ │   Selector   │
  Connection 3 ──→ │              │ ──→ Thread Pool ──→ Servlet
  ...               └──────────────┘
```

**核心思想**：用更少的线程处理更多的连接。

---

## Tomcat NIO 的实现：AprEndpoint

### AprEndpoint 组件

Tomcat 的 NIO 实现主要依赖 AprEndpoint，包含三个核心组件：

```
┌──────────────────────────────────────────────────┐
│                  AprEndpoint                      │
│  ┌─────────────┐  ┌───────────┐  ┌───────────┐  │
│  │  Acceptor   │→ │  Poller   │→ │  Socket   │  │
│  │  (接收连接)   │  │  (事件轮询) │  │ Processor │  │
│  │              │  │           │  │  (任务执行) │  │
│  └─────────────┘  └───────────┘  └───────────┘  │
└──────────────────────────────────────────────────┘
```

### Acceptor：接收连接

Acceptor 负责接收新连接：

```java
// 伪代码
while (running) {
    Socket socket = serverSocket.accept();  // 接收连接
    // 交给 Poller 处理
    poller.register(socket);
}
```

### Poller：事件轮询

Poller 使用 Selector 监听多个 Socket 的读写事件：

```java
// 伪代码
while (running) {
    selector.select();  // 阻塞等待就绪事件
    Set<SelectionKey> keys = selector.selectedKeys();
    for (SelectionKey key : keys) {
        if (key.isReadable()) {
            // 交给 Processor 处理
            executor.submit(new SocketProcessor(key));
        }
    }
}
```

### SocketProcessor：任务执行

SocketProcessor 是线程池中的任务，负责处理具体的请求：

```java
class SocketProcessor implements Runnable {
    public void run() {
        // 1. 读取请求
        request = socket.read();
        // 2. 解析协议
        parseHttpRequest();
        // 3. 调用 Servlet
        servlet.service(request, response);
        // 4. 发送响应
        socket.write(response);
    }
}
```

---

## Tomcat NIO 请求处理流程

```
客户端请求
      ↓
┌─────────────┐
│  Acceptor   │ ← 接收连接
└─────────────┘
      ↓
┌─────────────┐
│   Poller    │ ← Selector 轮询（注册 OP_READ）
└─────────────┘
      ↓
┌─────────────┐
│  LimitLatch │ ← 控制最大连接数
└─────────────┘
      ↓
┌─────────────────────────┐
│     SocketProcessor     │ ← 线程池执行
│   (Worker Thread)       │
└─────────────────────────┘
      ↓
┌─────────────────────────┐
│   Coyote Adapter        │ ← 适配到容器层
└─────────────────────────┘
      ↓
┌─────────────────────────┐
│   Servlet / Filter      │ ← 业务处理
└─────────────────────────┘
      ↓
响应客户端
```

---

## 关键调优参数

### Connector 配置

```xml
<Connector port="8080"
           protocol="org.apache.coyote.http11.Http11NioProtocol"
           maxThreads="200"
           acceptCount="100"
           connectionTimeout="20000"
           maxConnections="10000"
           />
```

### 参数详解

| 参数 | 默认值 | 说明 |
|-----|-------|------|
| maxThreads | 200 | 最大工作线程数 |
| acceptCount | 100 | 等待队列长度（超过 maxThreads 后入队） |
| connectionTimeout | 20000 | 连接超时时间（毫秒） |
| maxConnections | 10000 | 最大并发连接数（NIO 时） |
| minSpareThreads | 10 | 最小空闲线程数 |

### NIO 特有参数

```xml
<Connector protocol="org.apache.coyote.http11.Http11NioProtocol">
    <UpgradeProtocol internal="http/1.1" />
    <Property name="selectorTimeout" value="3000" />
</Connector>
```

| 参数 | 说明 |
|-----|------|
| selectorTimeout | Selector 超时时间 |
| pollerSize | Poller 队列大小 |

---

## BIO vs NIO vs APR

### 三种模式对比

| 特性 | BIO | NIO | APR |
|-----|-----|-----|-----|
| 协议 | HTTP/1.1 | HTTP/1.1 | HTTP/1.1 |
| 线程模型 | 1:1 | N:1（M:N 可配） | NIO + Native |
| 并发能力 | 低 | 高 | 最高 |
| 适用场景 | 低并发 | 高并发 | 极致性能 |
| CPU 消耗 | 高 | 中 | 低 |

### 如何选择

```xml
<!-- Tomcat 8+ 默认 NIO，无需配置 -->
<Connector protocol="org.apache.coyote.http11.Http11NioProtocol">

<!-- 想用 APR（需要安装 apr/native）-->
<Connector protocol="org.apache.coyote.http11.Http11AprProtocol">

<!-- 强制 BIO（不推荐）-->
<Connector protocol="org.apache.coyote.http11.Http11Protocol">
```

**建议**：

- Tomcat 8+ 直接用默认 NIO
- 如果追求极致性能，使用 APR
- 除非特殊原因，不要使用 BIO

### APR 的优势

APR（Apache Portable Runtime）是 Tomcat 的 native 库：

1. **OS 级别优化**：使用操作系统的原生 IO
2. **OpenSSL 集成**：HTTPS 性能更好
3. **Sendfile 支持**：大文件传输零拷贝

---

## 连接数控制：LimitLatch

Tomcat 使用 LimitLatch 控制最大连接数：

```
┌────────────────────────────────────────────┐
│               LimitLatch                    │
│  count: 0 / maxConnections: 10000          │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │          请求进来                    │   │
│  │               ↓                      │   │
│  │         count < max ?               │   │
│  │          ↓ 是          ↓ 否          │   │
│  │      count++       等待/拒绝        │   │
│  │          ↓                      │      │
│  │      处理请求                    │      │
│  │          ↓                      │      │
│  │      count--                    │      │
│  └─────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

```java
// 伪代码
LimitLatch latch = new LimitLatch(maxConnections);
latch.countUpOrAwait();  // 等待直到有空闲
try {
    processRequest();
} finally {
    latch.countDown();
}
```

---

## 线程池配置建议

### 计算公式

```
maxThreads = 并发数 × 平均请求处理时间 / 1000
```

例如：
- 目标并发：1000
- 平均处理时间：100ms
- maxThreads = 1000 × 100 / 1000 = 100

### 配置示例

```xml
<Connector port="8080"
           protocol="org.apache.coyote.http11.Http11NioProtocol"
           maxThreads="500"
           minSpareThreads="50"
           acceptCount="200"
           maxConnections="10000"
           connectionTimeout="30000"
           />
```

### 监控指标

通过 JMX 或 Tomcat Manager 监控：

```bash
# 查看当前线程数
curl http://localhost:8080/manager/status?XML=true | grep threads
```

关键指标：
- currentThreadCount：当前线程数
- currentThreadsBusy：忙碌线程数
- maxThreads：最大线程数

---

## 面试追问方向

### 追问一：Tomcat 8 为什么比 Tomcat 7 快？

1. **NIO vs BIO**：Tomcat 7 用 BIO，Tomcat 8 用 NIO
2. **连接处理方式**：BIO 每个连接一个线程，NIO 一个线程处理多个连接
3. **内存占用**：NIO 减少了线程数量，降低了内存占用和上下文切换
4. **Selector 优化**：Tomcat 8 的 Poller 使用更高效的事件处理

### 追问二：Tomcat 的 Connector 和 Container 是什么关系？

```
Connector                    Container
┌─────────────┐            ┌─────────────┐
│   处理协议   │            │   处理 Servlet │
│  HTTP/NIO   │────请求────→│   Engine     │
│             │            │   Host       │
│             │←───响应────│   Context    │
└─────────────┘            │   Wrapper    │
                           └─────────────┘
```

Connector 负责网络 IO，Container 负责业务逻辑。

它们通过 Adapter 模式连接：Coyote Adapter 把 Connector 的请求转换为 Container 能处理的 Request/Response。

### 追问三：acceptCount 和 maxConnections 有什么区别？

| 参数 | 含义 | 超出表现 |
|-----|------|---------|
| maxConnections | 最大并发连接数（NIO 时） | 超过后不再接受新连接（由 LimitLatch 控制） |
| acceptCount | 等待队列长度 | 超过后拒绝连接（由 OS 的 listen backlog 控制） |

```
客户端 ──→ [已建立连接] ──→ [等待队列] ──→ [拒绝]
              maxConnections    acceptCount
```

### 追问四：如何排查 Tomcat 线程瓶颈？

1. **线程耗尽**：maxThreads 太小，请求排队时间长
   - 症状：`currentThreadsBusy == maxThreads`
   - 解决：增加 maxThreads

2. **连接数不足**：maxConnections 太小
   - 症状：Selector 事件积压
   - 解决：增加 maxConnections

3. **CPU 100%**：业务逻辑太重
   - 症状：线程都在忙碌但队列不长
   - 解决：优化业务逻辑或增加机器

---

## 留给你的思考题

我们讲了 Tomcat 的 NIO 实现、线程模型和调优参数。

但还有一个问题：

**Tomcat 8 使用 NIO 后，单线程处理多个连接。但 Servlet 默认是单实例多线程的。**

如果你的某个 Servlet 需要访问数据库，查询耗时 100ms。

在高并发场景下，会发生什么？

- 200 个线程同时查询数据库
- 数据库连接池只有 100 个连接
- 剩下 100 个线程在等待

这和 Tomcat 的线程模型有什么关系？

> 提示：连接池大小、线程池大小、业务逻辑的配合。
