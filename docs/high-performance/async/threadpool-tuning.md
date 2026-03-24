# 线程池调优经验：IO 密集型 vs CPU 密集型

「线程池的线程数到底设置多少合适？」

「IO 密集型和 CPU 密集型的线程数计算方法一样吗？」

「为什么我的线程池配置看起来没问题，却总是出问题？」

这些问题，是每个 Java 开发者都会遇到的灵魂拷问。

## 线程池配置的核心公式

### 线程数的本质

线程池的线程数，不是拍脑袋定的，而是由**任务特性**决定的。

```
线程数 = CPU 核心数 × CPU 利用率 × (1 + 等待时间 / 计算时间)
```

这个公式的推导：

- CPU 密集型任务：等待时间 ≈ 0，所以线程数 ≈ CPU 核心数
- IO 密集型任务：等待时间很长，所以线程数 >> CPU 核心数

## CPU 密集型任务

### 什么是 CPU 密集型

CPU 密集型任务的瓶颈是 **CPU**，大部分时间在**计算**：

```
特点：
├─ 纯计算：数学运算、加密解密、压缩解压
├─ 复杂逻辑：算法求解、数据处理
└─ CPU 绑定的循环：批量数据转换

线程状态：
├─ 执行时间 ≈ CPU 时间
├─ 等待时间 ≈ 0
└─ 线程主要在 RUNNING 状态
```

### 线程数配置

```java
// CPU 密集型：线程数 = CPU 核心数 + 1
// +1 是为了利用 CPU 等待时的上下文切换

int cpuCores = Runtime.getRuntime().availableProcessors();
int poolSize = cpuCores + 1;

// 原因：
// - CPU 密集型任务线程数过多 → 上下文切换开销
// - 加上 1 是为了当某个线程阻塞时，其他线程还能用 CPU
```

### 验证示例

```java
// 模拟 CPU 密集型任务
public class CpuTask implements Runnable {
    @Override
    public void run() {
        // 纯计算：计算 PI 到小数点后 N 位
        double result = 0;
        for (int i = 0; i &lt; 1_000_000; i++) {
            result += Math.sqrt(i) * Math.sin(i);
        }
    }
}

// 测试：不同线程数下的执行时间
// 8 核 CPU：
// 线程数=8: 耗时 1000ms
// 线程数=16: 耗时 1200ms（上下文切换开销）
// 线程数=32: 耗时 2000ms（严重上下文切换）
```

## IO 密集型任务

### 什么是 IO 密集型

IO 密集型任务的瓶颈是 **IO**，大部分时间在**等待**：

```
特点：
├─ 网络请求：HTTP 调用、数据库查询
├─ 文件操作：读写磁盘、读写文件
├─ 等待响应：RPC 调用、消息队列

线程状态：
├─ 执行时间 &lt;&lt; 等待时间
├─ 线程大部分时间在 WAITING/BLOCKED
└─ CPU 处于空闲状态
```

### 线程数配置

```java
// IO 密集型：线程数 = CPU 核心数 × (1 + 等待时间 / 计算时间)
// 假设等待时间 / 计算时间 = 4（IO 时间是计算时间的 4 倍）
// 则：线程数 = CPU 核心数 × 5

int cpuCores = Runtime.getRuntime().availableProcessors();
int ioWaitRatio = 4;  // IO 等待时间 / 计算时间
int poolSize = cpuCores * (1 + ioWaitRatio);
// = cpuCores * 5
// 如果 CPU 有 8 核，则线程数 = 40
```

### 经验公式

实际生产中，常用经验值：

```java
// 公式 1：线程数 = CPU 核心数 × 2
// 适用于 IO 等待比例一般的场景

// 公式 2：线程数 = CPU 核心数 / (1 - 阻塞系数)
// 阻塞系数 = 等待时间 / (等待时间 + 计算时间)
// 如果阻塞系数 = 0.8（80% 时间在等待）
// 则：线程数 = CPU 核心数 / 0.2 = CPU 核心数 × 5

// 公式 3：线程数 = CPU 核心数 × 线程等待时间比率
// 适用于具体知道 IO 耗时的场景
```

## 混合型任务

### 线程池分离策略

如果系统中既有 CPU 密集型任务又有 IO 密集型任务，应该**分开处理**：

```java
@Configuration
public class ThreadPoolConfig {
    
    // CPU 密集型线程池
    @Bean("cpuExecutor")
    public ExecutorService cpuExecutor() {
        int cpuCores = Runtime.getRuntime().availableProcessors();
        return new ThreadPoolExecutor(
            cpuCores + 1,     // 核心线程数
            cpuCores + 1,     // 最大线程数（不需要太多）
            0L, TimeUnit.MILLISECONDS,
            new LinkedBlockingQueue&lt;&gt;(1000),
            new ThreadFactory() {
                private int count = 0;
                @Override
                public Thread newThread(Runnable r) {
                    return new Thread(r, "cpu-task-" + count++);
                }
            },
            new CallerRunsPolicy()
        );
    }
    
    // IO 密集型线程池
    @Bean("ioExecutor")
    public ExecutorService ioExecutor() {
        int cpuCores = Runtime.getRuntime().availableProcessors();
        int poolSize = cpuCores * 2;  // 或根据实际 IO 比例调整
        return new ThreadPoolExecutor(
            poolSize,
            poolSize * 2,
            60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue&lt;&gt;(10000),
            new ThreadFactory() {
                private int count = 0;
                @Override
                public Thread newThread(Runnable r) {
                    return new Thread(r, "io-task-" + count++);
                }
            },
            new CallerRunsPolicy()
        );
    }
}

@Service
public class TaskService {
    
    @Autowired
    @Qualifier("cpuExecutor")
    private ExecutorService cpuExecutor;
    
    @Autowired
    @Qualifier("ioExecutor")
    private ExecutorService ioExecutor;
    
    // CPU 密集型任务
    public void processCpuTask() {
        ioExecutor.submit(() -&gt; {
            // CPU 密集型计算
            calculate();
        });
    }
    
    // IO 密集型任务
    public void processIoTask() {
        cpuExecutor.submit(() -&gt; {
            // IO 密集型操作
            callRemoteApi();
        });
    }
}
```

## 线程池参数详解

### 核心参数作用

```
┌─────────────────────────────────────────────────────────────┐
│                  线程池参数作用图                            │
│                                                              │
│   请求进来                                                    │
│      │                                                       │
│      ├─ 核心线程数未满？                                      │
│      │   └─ 否 → 检查队列                                      │
│      │                                                       │
│      ├─ 队列未满？                                            │
│      │   └─ 否 → 创建新线程（不超过最大线程数）                 │
│      │                                                       │
│      ├─ 最大线程数未满？                                      │
│      │   └─ 否 → 执行拒绝策略                                 │
│      │                                                       │
│      └─ 执行任务                                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 队列选择

```java
// 无界队列：LinkedBlockingQueue&lt;Integer&gt;()
// 风险：队列无限增长，可能 OOM
// 适用：任务量可控，不允许丢弃任务的场景

// 有界队列：LinkedBlockingQueue&lt;Integer&gt;(capacity)
// 优点：控制内存，避免 OOM
// 缺点：任务可能被拒绝
// 适用：大部分场景

// 同步队列：SynchronousQueue&lt;Integer&gt;()
// 特点：不存储任务，来一个处理一个
// 适用：需要立即执行，不接受等待的任务
// 配合较大的最大线程数使用
```

### 拒绝策略

```java
// AbortPolicy（默认）：抛异常
// 适用：需要明确知道任务被拒绝的场景

// CallerRunsPolicy：由调用线程执行
// 优点：任务不丢失，有一定的限流效果
// 缺点：调用方线程被阻塞，可能影响主流程
// 适用：不允许任务丢失，但又希望有保护机制的场景

// DiscardPolicy：直接丢弃
// 适用：允许任务丢失，如日志收集

// DiscardOldestPolicy：丢弃最老的任务
// 适用：优先处理新任务的场景
```

## 调优经验总结

### CPU 密集型

```java
// 核心线程数 = CPU 核心数 + 1
// 最大线程数 = 核心线程数（不需要弹性扩缩容）
// 队列容量 = 适度大小

ThreadPoolExecutor cpuPool = new ThreadPoolExecutor(
    cpuCores + 1,
    cpuCores + 1,
    0L, TimeUnit.MILLISECONDS,
    new LinkedBlockingQueue&lt;&gt;(1000),
    new CallerRunsPolicy()
);
```

### IO 密集型

```java
// 核心线程数 = CPU 核心数 × 2（保守估计）
// 或 = CPU 核心数 / (1 - 阻塞系数)
// 最大线程数 = 核心线程数 × 2~3（允许弹性）
// 队列容量 = 较大

ThreadPoolExecutor ioPool = new ThreadPoolExecutor(
    cpuCores * 2,
    cpuCores * 4,
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue&lt;&gt;(10000),
    new CallerRunsPolicy()
);
```

### 监控调优

```java
// 监控线程池状态，根据实际情况调整
@Service
public class ThreadPoolTuner {
    
    @Scheduled(fixedRate = 60000)
    public void tune() {
        ThreadPoolExecutor executor = getThreadPoolExecutor();
        
        int activeCount = executor.getActiveCount();
        int poolSize = executor.getPoolSize();
        int queueSize = executor.getQueue().size();
        
        // 如果活跃线程数经常等于最大线程数 → 线程数不够，增加
        if (activeCount == executor.getMaximumPoolSize()) {
            increasePoolSize();
        }
        
        // 如果队列持续积压 → 增加线程数或队列容量
        if (queueSize > queueCapacity * 0.8) {
            increaseQueueCapacity();
        }
        
        // 如果线程数经常低于核心线程数 → 任务太少，可以减少核心线程数
        if (poolSize > executor.getCorePoolSize() * 1.5) {
            // 持续高负载，不需要调整
        }
    }
}
```

## 常见配置问题

### 问题 1：核心线程数和最大线程数设置反了

```java
// 错误：核心线程数小，最大线程数大
// 这样线程池会先创建少量线程，等队列满了才扩容
// 对于 IO 密集型任务，这种策略不合适
new ThreadPoolExecutor(2, 100, ...);  // 错误

// 正确：核心线程数设置为期望的正常负载
new ThreadPoolExecutor(40, 80, ...);  // 正确
```

### 问题 2：队列容量设置过小

```java
// 错误：队列太小，容易触发拒绝
new ThreadPoolExecutor(10, 20, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue&lt;&gt;(10));  // 队列只有 10，太小

// 正确：根据峰值 QPS × 平均处理时间 × 容忍的等待时间
// 例如：1000 QPS × 0.1s × 10s = 1000
new ThreadPoolExecutor(20, 40, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue&lt;&gt;(1000));
```

### 问题 3：keepAliveTime 设置不当

```java
// 错误：IO 密集型线程池 keepAliveTime 太短
// 线程刚创建就被回收，无法复用
new ThreadPoolExecutor(20, 40, 0L, TimeUnit.SECONDS, ...);  // 错误

// 正确：IO 密集型线程池 keepAliveTime 设置较长
// 让线程池有时间复用空闲线程
new ThreadPoolExecutor(20, 40, 60L, TimeUnit.SECONDS, ...);  // 正确
```

## 总结

| 任务类型 | 核心线程数 | 最大线程数 | keepAliveTime | 队列 |
|---------|-----------|-----------|--------------|------|
| CPU 密集型 | CPU + 1 | =核心线程数 | 0 | 适度 |
| IO 密集型 | CPU × 2~N | 核心线程数×2~3 | 60s+ | 较大 |
| 混合型 | 分开配置 | 分开配置 | 分开配置 | 分开配置 |

**核心原则**：

1. CPU 密集型：线程数不宜过多，CPU 是瓶颈
2. IO 密集型：线程数可以多一些，充分利用等待时间
3. 监控调优：根据实际运行情况调整参数

---

## 留给你的问题

假设你的系统有两个场景：

1. 图片处理服务：需要对图片进行缩放、滤镜、转码等处理
2. API 网关服务：需要聚合多个下游服务的响应

请回答：

1. 哪个是 CPU 密集型，哪个是 IO 密集型？
2. 如果你有 8 核 CPU，分别应该配置多少线程数？
3. 如果图片处理服务突然流量增加 10 倍，线程池会怎么响应？这种响应方式合理吗？
4. 如果你发现 IO 密集型的线程池活跃线程数总是接近最大线程数，队列也在积压，你该怎么办？

思考这些问题，能帮助你更好地理解线程池调优。
