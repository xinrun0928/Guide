# 响应式编程：Reactor 与 Flux/Mono

你有没有想过这个问题：为什么有的系统 CPU 利用率只有 30%，却已经跑满了？

这不是硬件问题，而是 IO 问题。

传统 servlet 模型中，每个请求占用一个线程，线程等待 IO 时什么都不做，CPU 只能空闲。响应式编程（Reactive Programming）正是为了解决这个矛盾而生——**用更少的线程，处理更多的并发**。

## 响应式编程是什么

响应式编程是一种**异步数据流**编程范式。核心思想是：

- **数据是流**：而不是离散的变量
- **变化会传播**：数据变化时自动通知订阅者
- **非阻塞**：不等待 IO，充分利用 CPU

类比一下：

```
同步编程：去餐厅 → 等厨师做菜（等待） → 吃 → 再点下一道
响应式编程：去餐厅 → 点菜（订阅） → 去做别的事 → 菜好了通知你 → 吃
```

## Reactive Streams 规范

Java 界面的响应式编程，遵循 **Reactive Streams** 规范，定义了四个核心接口：

```java
// 发布者，生产数据
public interface Publisher&lt;T&gt; {
    void subscribe(Subscriber&lt;? super T&gt; s);
}

// 订阅者，消费数据
public interface Subscriber&lt;T&gt; {
    void onSubscribe(Subscription s);
    void onNext(T t);
    void onError(Throwable t);
    void onComplete();
}

// 订阅，控制数据流
public interface Subscription {
    void request(long n);    // 请求 n 个数据
    void cancel();           // 取消订阅
}

// 处理器，发布者和订阅者的结合
public interface Processor&lt;T, R&gt; extends Subscriber&lt;T&gt;, Publisher&lt;R&gt; {}
```

**核心概念**：

- `Publisher` 产生数据，但不主动推送
- `Subscriber` 通过 `subscribe` 订阅
- `Subscription` 控制何时请求多少数据（背压机制）

## Reactor 入门：Flux 和 Mono

**Reactor** 是 Spring 5 推荐的响应式编程库，是 Reactive Streams 规范的最佳实现。

两个核心类型：

| 类型 | 含义 | 适用场景 |
|------|------|---------|
| `Flux&lt;T&gt;` | 0~N 个元素的异步序列 | 返回列表、多条消息 |
| `Mono&lt;T&gt;` | 0~1 个元素 | 返回单个对象、可能为空的结果 |

### 创建 Flux 和 Mono

```java
// 创建 Flux
Flux.just("A", "B", "C");                    // 从已知元素创建
Flux.fromArray(new Integer[]{1, 2, 3});       // 从数组创建
Flux.range(1, 10);                            // 创建数字序列
Flux.empty();                                 // 创建空序列
Flux.error(new Exception("error"));           // 创建错误序列
Flux.never();                                 // 永远不发出任何信号的序列

// 创建 Mono
Mono.just("Hello");                           // 单个元素
Mono.justOrEmpty(null);                       // 可以为 null
Mono.justOrEmpty(Optional.empty());           // Optional 为空时
Mono.error(new Exception("error"));           // 错误
Mono.delay(Duration.ofSeconds(1));           // 延时
Mono.fromCallable(() -> callDatabase());      // 从同步方法转换
Mono.fromFuture(() -> httpClient.get());      // 从 Future 转换
```

### 订阅：触发数据流

**`subscribe`** 是启动数据流的方式：

```java
Flux.just("A", "B", "C")
    .subscribe(System.out::println);

// 输出:
// A
// B
// C
```

带错误处理和完成信号：

```java
Flux.just("A", "B", "C")
    .subscribe(
        item -> System.out.println("收到: " + item),    // onNext
        error -> System.out.println("错误: " + error),  // onError
        () -> System.out.println("完成")                 // onComplete
    );
```

## 常用操作符

### 转换操作

**`map`**：同步转换每个元素

```java
Flux.just("apple", "banana", "orange")
    .map(String::toUpperCase)
    .subscribe(System.out::println);

// 输出: APPLE, BANANA, ORANGE
```

**`flatMap`**：异步转换，返回 Flux 或 Mono

```java
Flux.just("user1", "user2", "user3")
    .flatMap(userId -> fetchUserOrders(userId))  // 返回 Flux&lt;Order&gt;
    .subscribe(order -> System.out.println(order));
```

**`filter`**：过滤元素

```java
Flux.range(1, 10)
    .filter(n -> n % 2 == 0)  // 保留偶数
    .subscribe(System.out::println);

// 输出: 2, 4, 6, 8, 10
```

### 组合操作

**`zip`**：合并多个数据流

```java
Flux&lt;String&gt; names = Flux.just("Tom", "Jerry");
Flux&lt;Integer&gt; ages = Flux.just(25, 30);

Flux.zip(names, ages, (name, age) -> name + " is " + age)
    .subscribe(System.out::println);

// 输出:
// Tom is 25
// Jerry is 30
```

**`merge`**：合并多个数据流（不保证顺序）

```java
Flux&lt;String&gt; source1 = Flux.interval(Duration.ofMillis(100))
    .map(i -> "S1-" + i);
Flux&lt;String&gt; source2 = Flux.interval(Duration.ofMillis(80))
    .map(i -> "S2-" + i);

Flux.merge(source1, source2)
    .subscribe(System.out::println);
```

### 条件操作

**`take`**：取前 N 个元素

```java
Flux.range(1, 100)
    .take(5)
    .subscribe(System.out::println);

// 输出: 1, 2, 3, 4, 5
```

**`takeUntil`**：满足条件前一直取

```java
Flux.just(1, 2, 3, 4, 5)
    .takeUntil(n -> n == 3)
    .subscribe(System.out::println);

// 输出: 1, 2, 3
```

**`defaultIfEmpty`**：为空时提供默认值

```java
Mono.justOrEmpty(null)
    .defaultIfEmpty("default")
    .subscribe(System.out::println);

// 输出: default
```

## 背压（Backpressure）

这是响应式编程的核心概念。

当数据生产速度快于消费速度时，Subscriber 可以控制请求多少数据，而不是被动接收所有数据。

```java
Flux.range(1, 100)
    .subscribe(new Subscriber&lt;Integer&gt;() {
        private Subscription subscription;
        private int count = 0;
        
        @Override
        public void onSubscribe(Subscription s) {
            this.subscription = s;
            subscription.request(3);  // 告诉 Publisher 一次只发 3 个
        }
        
        @Override
        public void onNext(Integer t) {
            count++;
            System.out.println("处理: " + t);
            if (count % 3 == 0) {
                subscription.request(3);  // 每处理 3 个再请求 3 个
            }
        }
        
        @Override
        public void onError(Throwable t) {}
        
        @Override
        public void onComplete() {}
    });
```

Reactor 还提供背压操作符：

```java
// 限流
Flux.range(1, 100)
    .limitRate(10)  // 每次最多缓存 10 个

// 积压策略
Flux.range(1, 100)
    .onBackpressureBuffer(100)     // 缓冲
    .onBackpressureDrop()          // 丢弃
    .onBackpressureLatest()        // 只保留最新
```

## 实战：数据库查询

使用 Spring Data R2dbc 实现响应式数据库查询：

```java
@Repository
public interface UserRepository extends ReactiveCrudRepository&lt;User, Long&gt; {
    
    // 返回 Flux&lt;User&gt; - 多条记录
    Flux&lt;User&gt; findByAgeGreaterThan(int age);
    
    // 返回 Mono&lt;User&gt; - 单条记录
    Mono&lt;User&gt; findByUsername(String username);
    
    // 响应式分页
    Mono&lt;Page&lt;User&gt;&gt; findByStatus(String status, Pageable pageable);
}
```

```java
@Service
public class UserService {
    
    @Autowired
    private UserRepository userRepository;
    
    // 查询用户列表
    public Flux&lt;User&gt; getActiveUsers() {
        return userRepository.findByStatus("ACTIVE");
    }
    
    // 查询单个用户
    public Mono&lt;User&gt; getUserByUsername(String username) {
        return userRepository.findByUsername(username)
            .switchIfEmpty(Mono.error(new UserNotFoundException()));
    }
    
    // 复杂查询：用户 + 订单
    public Mono&lt;UserOrdersVO&gt; getUserOrders(Long userId) {
        Mono&lt;User&gt; userMono = userRepository.findById(userId);
        Flux&lt;Order&gt; ordersFlux = orderRepository.findByUserId(userId);
        
        return Mono.zip(userMono, ordersFlux.collectList())
            .map(tuple -> new UserOrdersVO(tuple.getT1(), tuple.getT2()));
    }
}
```

## 响应式 vs 同步：性能对比

| 场景 | 同步（Tomcat 线程模型） | 响应式（WebFlux） |
|------|------------------------|-------------------|
| 100 并发 | 100 线程 | 少量线程（事件驱动） |
| 1000 并发 | 1000 线程 | 少量线程复用 |
| CPU 利用率 | 阻塞时低 | 高 |
| 内存占用 | 每个线程 1MB | 极低 |
| 适用场景 | 简单 CRUD | IO 密集型高并发 |

**为什么响应式性能好**：

```
Tomcat（同步）：
请求1 [====线程1====]                              时间
请求2             [====线程2====]
请求3                         [====线程3====]
大多数时间在等待 IO

WebFlux（响应式）：
IO 操作交给 Netty 事件循环处理
线程被复用，一个线程可以处理多个请求的 IO
```

## 响应式编程的代价

响应式虽好，但不是银弹：

1. **学习曲线陡峭**：操作符太多，需要时间熟悉
2. **调试困难**：栈追踪很深，异常信息不直观
3. **不能混合使用**：一旦用响应式，全链路都要响应式
4. **背压实现复杂**：需要整个链路都支持背压

```java
// 错误示例：混用响应式和同步
public Flux&lt;User&gt; getUsers() {
    return Flux.just("id1", "id2")
        .flatMap(id -> {
            // 错误：在响应式链中调用同步方法
            return Mono.just(userDao.findById(id));  // 阻塞了！
        });
}

// 正确做法：使用响应式数据源
public Flux&lt;User&gt; getUsers() {
    return Flux.just("id1", "id2")
        .flatMap(id -> userR2dbcRepository.findById(id));
}
```

## 总结

响应式编程的核心：

| 概念 | 说明 |
|------|------|
| `Publisher` | 数据源，产生数据 |
| `Subscriber` | 消费者，处理数据 |
| `Flux` | 0~N 个元素的序列 |
| `Mono` | 0~1 个元素 |
| `backpressure` | 背压，控制数据流速度 |
| `operator` | 操作符，转换/过滤/组合数据流 |

响应式编程适合 IO 密集型、并发量大的场景，能用更少的资源处理更高的吞吐。

---

## 留给你的问题

假设你要改造一个用户服务，将同步查询改为响应式：

```java
// 原同步代码
public UserVO getUserDetail(Long userId) {
    User user = userRepository.findById(userId);           // 10ms
    List&lt;Order&gt; orders = orderRepository.findByUserId(userId);  // 20ms
    List&lt;Product&gt; favorites = productRepository.getFavorites(userId); // 30ms
    return new UserVO(user, orders, favorites);
}
```

1. 改为响应式后，如何并行执行三个查询？
2. 如果 `userRepository` 不支持响应式，只能返回同步的 `User`，怎么办？
3. 如果 `orders` 查询依赖 `user` 的结果（需要 userId），能完全并行吗？

思考这些问题，能帮助你理解响应式编程的实际应用场景和限制。
