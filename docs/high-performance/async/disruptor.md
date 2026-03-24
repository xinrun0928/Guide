# Disruptor 高性能队列：无锁队列原理

Disruptor 号称「史上最快的消息队列」，单线程每秒处理超过 2500 万条消息。

它凭什么这么快？

答案是：**无锁**。

但无锁不是银弹，理解它的原理，你才能用好它。

## 为什么需要无锁队列

### 传统队列的问题

传统队列（ArrayBlockingQueue、LinkedBlockingQueue）使用**锁**来保证线程安全：

```
┌─────────────────────────────────────────────┐
│         ArrayBlockingQueue 工作原理          │
│                                              │
│  写入线程:                                    │
│    ├─ 获取锁                                  │
│    ├─ 写入数据                                │
│    ├─ 释放锁                                  │
│    └─ 通知消费者（可能阻塞）                   │
│                                              │
│  读取线程:                                    │
│    ├─ 获取锁（可能等待）                      │
│    ├─ 读取数据                                │
│    ├─ 释放锁                                  │
│    └─ 通知生产者（可能阻塞）                   │
│                                              │
│  问题：锁竞争导致性能下降                      │
└─────────────────────────────────────────────┘
```

**锁的开销有多大**？

- 一次 CAS 操作：约 20-30 纳秒
- 一次加锁/解锁：约 100-200 纳秒
- 一次阻塞/唤醒：约 10-100 微秒

在高并发场景下，锁竞争会成为性能瓶颈。

### 伪共享问题

```
CPU 缓存行：64 字节

┌─────────────────────────────────────────────┐
│           Cache Line (64 bytes)             │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
│  │ 写指针 │ │ 读指针 │ │ 空闲  │ │ 空闲  │ │
│  │ (8字节) │ │ (8字节) │ │        │ │        │ │
│  └────────┴────────┴────────┴────────┘ │
└─────────────────────────────────────────────┘

问题：写指针和读指针在同一缓存行
      一个线程修改写指针 → 另一个线程的读指针缓存失效
      这叫「伪共享」
```

## Disruptor 核心原理

### 环形缓冲区

Disruptor 使用**环形缓冲区**（Ring Buffer）作为核心数据结构：

```
┌────────────────────────────────────────────────────────────┐
│                      Ring Buffer                           │
│                                                             │
│                         ┌───┐                             │
│                        /     \                            │
│                      ┌─┘       └─┐                         │
│                      │           │                        │
│                      │     0      │                        │
│                      │           │                        │
│                      └─┐       ┌─┘                         │
│                        \     /                             │
│                         └───┘                              │
│               ┌───┐           ┌───┐                       │
│              /     \         /     \                      │
│            ┌─┘       └─┐   ┌─┘       └─┐                   │
│            │           │   │           │                   │
│            │     N-2    │   │    N-1    │                   │
│            │           │   │           │                   │
│            └─┐       ┌─┘   └─┐       ┌─┘                   │
│              \     /         \     /                      │
│               └───┘           └───┘                       │
│                                                             │
│  特点：                                                      │
│  ├─ 固定大小，数组实现                                       │
│  ├─ 预先分配内存，无 GC 压力                                 │
│  ├─ 写指针和读指针是数组索引（递增）                          │
│  └─ 索引溢出后回绕到 0（通过位运算）                         │
└────────────────────────────────────────────────────────────┘
```

### 无锁实现原理

```java
// 传统队列的写入（有锁）
public class BlockingQueue {
    private final ReentrantLock lock = new ReentrantLock();
    
    public void put(Object element) {
        lock.lock();
        try {
            // 写入数据
            buffer[tail] = element;
            tail++;
        } finally {
            lock.unlock();
        }
    }
}

// Disruptor 的写入（无锁）
public class DisruptorRingBuffer {
    private final Object[] buffer;
    private final int mask;  // 掩码，用于取模运算
    
    public void put(Object element) {
        // 1. 获取下一个可写位置（CAS）
        long current = next.get();       // 获取当前序列号
        long nextSequence = current + 1; // 下一个序列号
        
        // 2. 检查前一个位置是否已消费（等待策略）
        waitStrategy.waitFor(current - 1, cursor, consumers);
        
        // 3. 写入数据（无锁，直接写入）
        buffer[(int)(current & mask)] = element;
        
        // 4. 发布（发布当前序列号）
        cursor.set(current);  // 这里用 volatile 或 CAS
    }
}
```

**关键点**：

1. **写入是单线程的**：只有一个线程负责写入，不需要锁
2. **读取也是单线程的**：同一个消费者线程读取，不需要锁
3. **通过序列号协调**：写入线程发布序列号，读取线程等待序列号

### 序列号与位运算

```java
public class SequenceMath {
    
    // Ring Buffer 大小必须是 2 的幂次
    private static final int BUFFER_SIZE = 1024;  // 2^10
    private static final long MASK = BUFFER_SIZE - 1;  // 0x3FF
    
    public static void main(String[] args) {
        // 序列号递增：1, 2, 3, ..., 1023, 1024, 1025, ...
        long sequence = 1;
        
        // 通过位运算取模（等价于 sequence % BUFFER_SIZE）
        int index = (int)(sequence & MASK);  // 1, 2, 3, ..., 1023, 0, 1, ...
        
        // 为什么用位运算？
        // 取模运算：需要除法，耗时
        // 位运算：只是 AND，耗时极短
        // 在高并发场景下，这个优化很重要
    }
}
```

## 等待策略

### 为什么需要等待策略

```
生产者速度 > 消费者速度 时：

├─ 如果消费者来不及消费
│   └─ 需要等待（忙等 or 阻塞）
│
└─ 等待策略决定如何等待
    ├─ 忙等（CPU 空转）
    ├─ 自旋 + yield
    ├─ 阻塞（线程休眠）
    └─ 混合策略
```

### 常用等待策略

```java
// Disruptor 支持多种等待策略

// 1. BusySpinWaitStrategy（忙等）
// 适用：极低延迟，CPU 资源充足
BusySpinWaitStrategy strategy1 = new BusySpinWaitStrategy();

// 2. BlockingWaitStrategy（阻塞）
// 适用：延迟不敏感，希望节省 CPU
BlockingWaitStrategy strategy2 = new BlockingWaitStrategy();

// 3. SleepingWaitStrategy（睡眠等待）
// 适用：低延迟，CPU 资源有限
// 策略：自旋几次，然后 sleep
SleepingWaitStrategy strategy3 = new SleepingWaitStrategy();

// 4. YieldingWaitStrategy（让出等待）
// 适用：中等延迟，需要较好响应性
// 策略：自旋几次，然后 yield
YieldingWaitStrategy strategy4 = new YieldingWaitStrategy();

// 5. PhasedBackoffWaitStrategy（相位退避）
// 适用：平衡延迟和 CPU 使用
PhasedBackoffWaitStrategy strategy5 = new PhasedBackoffWaitStrategy(
    1000, TimeUnit.NANOSECONDS,  // spin 阶段
    10000, TimeUnit.NANOCONDS,   // fall back 阶段
    1, TimeUnit.MILLISECONDS    // timeout 阶段
);

// 选择建议：
// - 超低延迟（金融交易）：BusySpin
// - 一般场景：Yielding 或 Sleeping
// - 延迟不敏感：Blocking
```

## Disruptor 使用示例

### Maven 依赖

```xml
&lt;dependency&gt;
    &lt;groupId&gt;com.lmax&lt;/groupId&gt;
    &lt;artifactId&gt;disruptor&lt;/artifactId&gt;
    &lt;version&gt;3.4.4&lt;/version&gt;
&lt;/dependency&gt;
```

### 基本用法

```java
public class DisruptorDemo {
    
    // 1. 定义事件
    public static class OrderEvent {
        private long orderId;
        private String productName;
        private BigDecimal amount;
        
        // getter/setter
    }
    
    // 2. 定义事件工厂
    public static class OrderEventFactory implements EventFactory&lt;OrderEvent&gt; {
        @Override
        public OrderEvent newInstance() {
            return new OrderEvent();
        }
    }
    
    // 3. 定义事件处理器
    public static class OrderEventHandler implements EventHandler&lt;OrderEvent&gt; {
        @Override
        public void onEvent(OrderEvent event, long sequence, boolean endOfBatch) {
            // 处理订单
            System.out.println("Processing order: " + event.getOrderId());
        }
    }
    
    public static void main(String[] args) {
        // 4. 创建 Ring Buffer
        int bufferSize = 1024;  // 必须是 2 的幂次
        
        Disruptor&lt;OrderEvent&gt; disruptor = new Disruptor&lt;&gt;(
            new OrderEventFactory(),
            bufferSize,
            DaemonThreadFactory.INSTANCE,  // 守护线程工厂
            ProducerType.SINGLE,            // 单生产者
            new YieldingWaitStrategy()      // 等待策略
        );
        
        // 5. 注册消费者
        disruptor.handleEventsWith(new OrderEventHandler());
        
        // 6. 启动
        disruptor.start();
        
        // 7. 获取 Ring Buffer
        RingBuffer&lt;OrderEvent&gt; ringBuffer = disruptor.getRingBuffer();
        
        // 8. 生产者发布消息
        for (int i = 0; i &lt; 10; i++) {
            long sequence = ringBuffer.next();  // 获取下一个可用位置
            try {
                OrderEvent event = ringBuffer.get(sequence);
                event.setOrderId(i);
                event.setProductName("Product " + i);
                event.setAmount(BigDecimal.valueOf(i * 100));
            } finally {
                ringBuffer.publish(sequence);  // 发布
            }
        }
    }
}
```

### 多消费者示例

```java
// 多消费者：消息会分发给所有消费者
disruptor.handleEventsWith(
    new OrderEventHandler1(),  // 消费者1
    new OrderEventHandler2(),  // 消费者2
    new OrderEventHandler3()   // 消费者3
);
// 所有消费者都会收到每条消息

// 链式处理：消息依次经过每个消费者
disruptor.handleEventsWith(handler1)
    .then(handler2)
    .then(handler3);
// handler1 处理完，handler2 再处理

// 菱形处理：合并结果
disruptor.handleEventsWith(handler1, handler2)
    .then(combinerHandler);
// handler1 和 handler2 并行处理，然后 combinerHandler 合并
```

## 性能对比

### 与 ArrayBlockingQueue 对比

```
测试环境：8 核 CPU，1 百万消息，单生产者+单消费者

┌────────────────────┬──────────────────┬─────────────────┐
│      队列类型       │    吞吐量        │    平均延迟      │
├────────────────────┼──────────────────┼─────────────────┤
│ ArrayBlockingQueue │    200 万/秒     │    5 微秒       │
│ LinkedBlockingQueue │    150 万/秒     │    7 微秒       │
│ Disruptor          │   2500 万/秒     │    0.4 微秒     │
└────────────────────┴──────────────────┴─────────────────┘
```

### 性能差异原因

```
ArrayBlockingQueue vs Disruptor：

1. 锁的开销
   - ArrayBlockingQueue：ReentrantLock
   - Disruptor：无锁（CAS）

2. 缓存行伪共享
   - ArrayBlockingQueue：head/tail 在同一缓存行
   - Disruptor：Sequence 填充缓存行

3. 预分配 vs 动态分配
   - ArrayBlockingQueue：每次 put 创建新对象
   - Disruptor：预分配对象，复用

4. 内存分配
   - ArrayBlockingQueue：会产生大量 GC
   - Disruptor：零 GC（预分配 + 对象复用）
```

## 适用场景

### 什么时候用 Disruptor

```
✓ 适合使用 Disruptor 的场景：
├─ 超低延迟要求（微秒级）
├─ 超高并发（百万 QPS+）
├─ 纯内存处理，无需持久化
├─ 单生产者或少数生产者
└─ 需要避免 GC 的场景

✗ 不适合使用 Disruptor 的场景：
├─ 需要跨进程通信
├─ 需要消息持久化
├─ 多生产者竞争激烈
└─ 需要复杂队列管理（优先级、死信等）
```

### 典型应用

```java
// 1. 日志收集系统
// 2. 金融交易系统
// 3. 消息推送系统
// 4. 实时分析系统
// 5. 高性能缓存更新
```

## 总结

Disruptor 高性能要点：

| 优化点 | 原理 | 效果 |
|-------|------|------|
| 无锁设计 | 单线程写入，CAS 发布 | 避免锁竞争 |
| 环形缓冲区 | 预分配，复用对象 | 零 GC |
| 缓存行填充 | 避免伪共享 | 提升缓存命中率 |
| 批量处理 | 一次发布多条消息 | 减少交互次数 |
| 等待策略 | 根据场景选择 | 平衡延迟和 CPU |

---

## 留给你的问题

假设你要用 Disruptor 实现一个高性能的订单处理系统：

1. 如果生产者突然发送了 100 万条消息，而消费者每秒只能处理 10 万条，Disruptor 会怎么处理？
2. Disruptor 的 Ring Buffer 大小设多大合适？太小会有什么后果？太大呢？
3. 如果你有 3 个消费者，都需要处理所有消息，应该怎么配置？
4. Disruptor 为什么能做到零 GC？这在长时间运行的服务中有什么优势？

思考这些问题，能帮助你更好地理解 Disruptor 的设计理念和适用场景。
