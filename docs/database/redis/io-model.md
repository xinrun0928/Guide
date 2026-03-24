# I/O 模型：epoll 原理与事件循环

Redis 为什么这么快？

单线程 + epoll。

但「单线程」和「epoll」是怎么配合工作的？

今天来深入聊聊 Redis 的 I/O 模型。

## 五种 I/O 模型回顾

在深入 Redis 之前，先回顾一下五种 I/O 模型：

| 模型 | 阻塞 | 非阻塞 | 多路复用 | 异步 |
|-----|------|--------|--------|-----|
| 阻塞 I/O | ✓ | | | |
| 非阻塞 I/O | | ✓ | | |
| I/O 多路复用 | | | ✓ | |
| 信号驱动 I/O | | | | |
| 异步 I/O | | | | ✓ |

### 阻塞 I/O

```
用户进程 ──▶ recvfrom() ──▶ 等待数据 ──▶ 数据就绪 ──▶ 返回
                    │
                    └── 阻塞等待
```

### 非阻塞 I/O

```
用户进程 ──▶ recvfrom() ──▶ EWOULDBLOCK ──▶ 轮询...
                │                          │
                └──────────────────────────┘
```

### I/O 多路复用

```
用户进程 ──▶ select() ──▶ 等待多个 fd ──▶ 返回就绪的 fd
                │
                ▼
        ┌───────┬───────┬───────┐
        │  fd1  │  fd2  │  fd3  │
        │ READY │  ...  │ READY │
        └───────┴───────┴───────┘
```

## Redis 的 I/O 模型

Redis 采用的是 **单线程 + I/O 多路复用** 模型：

```
┌─────────────────────────────────────────────────────────────────┐
│                      Redis I/O 模型                                │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │                     主线程（单线程）                       │    │
│   │                                                         │    │
│   │   ┌─────────┐                                         │    │
│   │   │ accept │ 接收连接                                  │    │
│   │   └────┬────┘                                         │    │
│   │        │                                               │    │
│   │        ▼                                               │    │
│   │   ┌─────────┐                                         │    │
│   │   │  epoll │ 事件循环                                  │    │
│   │   └────┬────┘                                         │    │
│   │        │                                               │    │
│   │        ▼                                               │    │
│   │   ┌─────────┐                                         │    │
│   │   │  命令   │ 读取 → 解析 → 执行 → 响应                  │    │
│   │   └─────────┘                                         │    │
│   │                                                         │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 核心组件

```c
// Redis 事件循环结构
typedef struct aeEventLoop {
    int maxfd;              // 最大的文件描述符
    int setsize;            // 事件监听集合大小
    events[];               // 注册的事件数组
    aeFiredEvent fired[];   // 已触发的事件数组
    aeBeforeSleepProc *beforesleep;  // 事件处理前的回调
    aeAfterSleepProc *aftersleep;     // 事件处理后的回调
    // ...
} aeEventLoop;
```

## select/poll 的局限性

select/poll 面临的问题：

### 1. 文件描述符数量限制

```c
// select 使用位图，最多监听 1024 个 fd
fd_set readfds;
FD_SET(fd, &readfds);  // fd 必须 < 1024

// poll 使用数组
struct pollfd fds[1024];  // 数组大小有限
```

### 2. 每次调用都需要重新设置

```c
// 每次 select 前都需要重置
FD_ZERO(&readfds);
FD_SET(fd1, &readfds);
FD_SET(fd2, &readfds);
FD_SET(fd3, &readfds);
// ...
select(maxfd + 1, &readfds, NULL, NULL, NULL);
```

### 3. 用户态到内核态拷贝

```c
// 每次调用都需要将 fd 集合拷贝到内核
select(maxfd + 1, &readfds, ...);
// 拷贝的开销：O(n)
```

## epoll 的优势

### 1. 无文件描述符限制

```c
// epoll_create 返回一个 epoll 实例
int epfd = epoll_create(1024);  // 建议大小，之后忽略

// 不需要预先知道 fd 数量
```

### 2. 事件只拷贝一次

```c
// 创建时注册
struct epoll_event ev;
ev.events = EPOLLIN;
ev.data.fd = fd;
epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ev);

// 每次调用只返回已触发的事件
int n = epoll_wait(epfd, events, MAX_EVENTS, timeout);
```

### 3. 只返回就绪的事件

```c
// select/poll：返回所有监听的 fd，需要遍历检查
for (int i = 0; i < nfds; i++) {
    if (FD_ISSET(i, &readfds)) {
        // 处理
    }
}

// epoll：只返回就绪的 fd
for (int i = 0; i < n; i++) {
    int fd = events[i].data.fd;
    // 直接处理
}
```

## epoll 的工作原理

### 三个核心函数

```c
// 1. 创建 epoll 实例
int epfd = epoll_create(int size);

// 2. 注册事件
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
// op: EPOLL_CTL_ADD, EPOLL_CTL_MOD, EPOLL_CTL_DEL

// 3. 等待事件
int epoll_wait(int epfd, struct epoll_event *events, 
               int maxevents, int timeout);
```

### epoll 的数据结构

```c
// 红黑树：存储注册的事件（O(log n) 插入/删除/修改）
// 就绪队列：存储已触发的事件（O(1) 双向列表）

struct epoll_event {
    uint32_t events;    // 事件类型
    epoll_data_t data;  // 用户数据
};
```

### epoll 的两种模式

#### 1. 水平触发（LT, Level Triggered）

```c
// 默认模式
// 只要条件满足，就一直触发
struct epoll_event ev;
ev.events = EPOLLIN;  // 水平触发

// 读取一半数据，缓冲区还有数据
// 下次 epoll_wait 仍会返回
```

#### 2. 边缘触发（ET, Edge Triggered）

```c
// 高效模式
// 只在新数据到达时触发一次
struct epoll_event ev;
ev.events = EPOLLIN | EPOLLET;  // 边缘触发

// 读取一半数据
// 下次 epoll_wait 不会返回，直到有新数据
```

## Redis 的事件循环

### 核心流程

```c
// Redis 事件循环伪代码
void aeMain(aeEventLoop *eventLoop) {
    eventLoop->stop = 0;
    
    while (!eventLoop->stop) {
        // 处理事件前回调
        if (eventLoop->beforesleep != NULL) {
            eventLoop->beforesleep(eventLoop);
        }
        
        // 等待并处理事件
        aeProcessEvents(eventLoop, AE_ALL_EVENTS);
    }
}

// 处理事件
int aeProcessEvents(aeEventLoop *eventLoop, int flags) {
    // 计算超时时间
    int tv = aeSearchNearestTimer(eventLoop);
    
    // 等待事件
    int numevents = aeApiPoll(eventLoop, tv);
    
    // 处理已触发的事件
    for (int i = 0; i < numevents; i++) {
        aeFileEvent *fe = &eventLoop->events[events[i].fd];
        int mask = events[i].mask;
        
        // 调用对应的处理函数
        if (fe->mask & mask & AE_READABLE) {
            fe->rfileProc(eventLoop, fd, fe->clientData, mask);
        }
        if (fe->mask & mask & AE_WRITABLE) {
            fe->wfileProc(eventLoop, fd, fe->clientData, mask);
        }
    }
}
```

### 时间事件

Redis 不仅处理 I/O 事件，还处理时间事件：

```c
// 时间事件结构
typedef struct aeTimeEvent {
    long long id;           // 唯一 ID
    long when_sec;           // 触发时间（秒）
    long when_ms;            // 触发时间（毫秒）
    aeTimeProc *timeProc;    // 处理函数
    aeEventFinalizerProc *finalizerProc;  // 清理函数
    struct aeTimeEvent *next;
} aeTimeEvent;

// 常见时间事件
// - serverCron: 定时执行（默认每秒 10 次）
//   - 清理过期 key
//   - 更新统计信息
//   - 持久化检查
//   - 主从同步检查
```

### I/O 事件 + 时间事件的处理顺序

```c
int aeProcessEvents(aeEventLoop *eventLoop, int flags) {
    // 1. 处理所有已到期的 I/O 事件
    // ...
    
    // 2. 处理时间事件
    aeSearchNearestTimer(eventLoop);  // 找最近的时间事件
    // ...
    
    // 3. 继续处理 I/O 事件
    // ...
}
```

## Redis 6.0 的多线程 I/O

Redis 6.0 引入了 **I/O threading**：

```c
// io-threads.c
void *IOThreadMain(void *thread_id) {
    while (1) {
        // 等待任务
        while (io_threads_pending[*thread_id] == 0) {
            pthread_cond_wait(&io_threads_mutex, &io_threads_mutex);
        }
        
        // 处理任务
        for (int j = 0; j < io_threads_pending[*thread_id]; j++) {
            client *c = io_threads_list[*thread_id][j];
            // 处理读或写
        }
        io_threads_pending[*thread_id] = 0;
    }
}
```

**注意**：命令执行仍然是单线程，I/O threading 只处理网络读写。

## 性能对比

| 模型 | select | poll | epoll |
|-----|--------|------|-------|
| 监听数量 | 有限（1024） | 无限制 | 无限制 |
| 时间复杂度 | O(n) | O(n) | O(1) |
| 内核拷贝 | 每次全量 | 每次全量 | 增量 |
| 触发方式 | 水平触发 | 水平触发 | LT/ET |
| Redis 使用 | < 2.8 | 未使用 | 2.8+ |

## epoll 的问题

### 1. epoll 惊群

```
多个进程/线程同时等待同一个 fd
当 fd 就绪时，所有进程/线程都被唤醒
但只有一个能处理
```

**解决**：Redis 使用 lock 保证只有一个处理

### 2. 边缘触发需要一次性读完

```c
// 边缘触发下，必须一次性读完所有数据
while (1) {
    n = read(fd, buf, sizeof(buf));
    if (n == -1) {
        if (errno == EAGAIN) break;  // 非阻塞
        // 处理错误
    }
    if (n == 0) {
        // 连接关闭
        break;
    }
    // 处理数据
}
```

## 总结

Redis 的 I/O 模型：

- **单线程**：主线程处理命令
- **I/O 多路复用**：epoll 高效管理大量连接
- **事件循环**：I/O 事件 + 时间事件
- **Redis 6.0**：I/O threading 进一步优化

## 留给你的问题

epoll 的边缘触发模式（ET）性能更高，但使用更复杂。

**为什么 Redis 没有使用 epoll 的边缘触发模式？使用水平触发（LT）有什么优势和劣势？**
