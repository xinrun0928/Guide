# 线程池监控：ThreadPoolExecutor 核心指标采集

你的线程池健康吗？

不是问「有没有在工作」，而是问「有没有潜在问题」。

线程池的很多问题，在崩溃前都有预兆：队列积压、线程饥饿、拒绝任务。监控，就是要在问题爆发前发现它。

## 为什么线程池需要监控

线程池出问题的代价是惨重的：

```
问题场景：

├─ 线程池队列积压
│   └─ 请求等待时间变长 → 用户体验下降
│
├─ 线程耗尽
│   └─ 新任务被拒绝 → 功能失效
│
├─ 线程泄漏
│   └─ 线程数持续增长 → OOM
│
└─ 任务执行异常
   └─ 未捕获的异常导致任务静默失败
```

线程池监控的本质是**提前发现问题**，而不是等事故发生。

## 核心监控指标

### 1. 队列大小

```java
// 获取队列大小
ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) applicationContext.getBean("asyncExecutor");
BlockingQueue&lt;Runnable&gt; queue = executor.getThreadPoolExecutor().getQueue();
int queueSize = queue.size();
int remainingCapacity = queue.remainingCapacity();
```

### 2. 活跃线程数

```java
// 获取活跃线程数（正在执行任务的线程）
int activeCount = executor.getThreadPoolExecutor().getActiveCount();

// 注意：这里只能获取当前 JVM 的值
// 如果有多个 JVM 实例，需要用 JMX 暴露
```

### 3. 线程池状态

```java
// 获取完整线程池状态
ThreadPoolExecutor tpe = executor.getThreadPoolExecutor();
ThreadPoolStatus status = new ThreadPoolStatus(
    tpe.getPoolSize(),        // 当前线程数
    tpe.getActiveCount(),     // 活跃线程数
    tpe.getCorePoolSize(),    // 核心线程数
    tpe.getMaximumPoolSize(), // 最大线程数
    tpe.getQueue().size(),    // 队列大小
    tpe.getCompletedTaskCount(), // 已完成任务数
    tpe.getTaskCount()        // 总任务数
);

// 计算线程利用率
double threadUtilization = (double) activeCount / tpe.getPoolSize();

// 队列使用率
double queueUtilization = (double) queue.size() / (queue.size() + queue.remainingCapacity());
```

## 自定义监控指标

### Micrometer + Prometheus 集成

```java
// 添加 Micrometer 依赖
// &lt;dependency&gt;
//     &lt;groupId&gt;io.micrometer&lt;/groupId&gt;
//     &lt;artifactId&gt;micrometer-registry-prometheus&lt;/artifactId&gt;
// &lt;/dependency&gt;

@Configuration
public class ThreadPoolMonitorConfig {
    
    @Autowired
    private MeterRegistry meterRegistry;
    
    @Autowired
    private ApplicationContext applicationContext;
    
    @PostConstruct
    public void init() {
        // 监控所有线程池
        Map&lt;String, ThreadPoolTaskExecutor&gt; executors = 
            applicationContext.getBeansOfType(ThreadPoolTaskExecutor.class);
        
        for (Map.Entry&lt;String, ThreadPoolTaskExecutor&gt; entry : executors.entrySet()) {
            String name = entry.getKey();
            ThreadPoolTaskExecutor executor = entry.getValue();
            
            // 活跃线程数
            Gauge.builder("threadpool.active", executor, 
                e -&gt; e.getThreadPoolExecutor().getActiveCount())
                .tag("name", name)
                .description("Active threads")
                .register(meterRegistry);
            
            // 队列大小
            Gauge.builder("threadpool.queue", executor,
                e -&gt; e.getThreadPoolExecutor().getQueue().size())
                .tag("name", name)
                .description("Queue size")
                .register(meterRegistry);
            
            // 线程数
            Gauge.builder("threadpool.size", executor,
                e -&gt; e.getThreadPoolExecutor().getPoolSize())
                .tag("name", name)
                .description("Current pool size")
                .register(meterRegistry);
            
            // 完成任务数（计数器）
            Counter.builder("threadpool.completed")
                .tag("name", name)
                .description("Completed tasks")
                .register(meterRegistry);
        }
    }
}
```

### Spring Boot Actuator

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      application: my-app
```

## 告警规则设计

### 队列积压告警

```java
@Configuration
public class ThreadPoolAlertConfig {
    
    @Autowired
    private MeterRegistry meterRegistry;
    
    @Autowired
    private AlertService alertService;
    
    @PostConstruct
    public void init() {
        // 队列积压告警
        MeterRegistry.get("threadpool.queue")
            .tag("name", "asyncExecutor")
            .gauge(new Meter.Id("asyncExecutor.queue", Tags.empty(), null, null, Meter.Type.GAUGE));
        
        // 监听器方式
        if (meterRegistry instanceof PrometheusMeterRegistry) {
            ((PrometheusMeterRegistry) meterRegistry)
                .config()
                .onMeterAdded(meter -&gt; {
                    if (meter.getId().getName().contains("threadpool.queue")) {
                        // 注册告警监听器
                    }
                });
        }
    }
}
```

### 告警阈值设计

```java
public class ThreadPoolAlertRule {
    
    // 队列积压：超过队列容量的 80%
    public static final double QUEUE_HIGH_THRESHOLD = 0.8;
    
    // 活跃线程数：超过最大线程数的 80%
    public static final double ACTIVE_HIGH_THRESHOLD = 0.8;
    
    // 线程利用率：超过 90% 持续 5 分钟
    public static final double THREAD_UTILIZATION_THRESHOLD = 0.9;
    
    // 任务拒绝次数：超过 0
    public static final int REJECTION_THRESHOLD = 0;
    
    public AlertLevel checkQueueAlert(int queueSize, int queueCapacity) {
        double utilization = (double) queueSize / queueCapacity;
        
        if (utilization &gt;= QUEUE_HIGH_THRESHOLD) {
            return AlertLevel.CRITICAL;
        } else if (utilization &gt;= 0.6) {
            return AlertLevel.WARNING;
        }
        return AlertLevel.NORMAL;
    }
}
```

## 可视化监控

### Grafana Dashboard

```
面板 1：线程池概览
├─ 当前线程数（实线图）
├─ 活跃线程数（面积图）
└─ 最大线程数（参考线）

面板 2：队列状态
├─ 队列大小（柱状图）
├─ 队列容量（参考线）
└─ 队列使用率（仪表盘）

面板 3：任务统计
├─ 完成任务数（计数器）
├─ 拒绝任务数（计数器）
└─ 执行任务数（计数器）

面板 4：性能指标
├─ 线程利用率（百分比）
└─ 任务执行时间（P99）
```

## 实战：线程池监控服务

### 完整实现

```java
@Service
public class ThreadPoolMonitorService {
    
    private static final Logger log = LoggerFactory.getLogger(ThreadPoolMonitorService.class);
    
    @Autowired
    private ApplicationContext applicationContext;
    
    @Autowired
    private AlertService alertService;
    
    // 定时采集
    @Scheduled(fixedRate = 30000)  // 每 30 秒
    public void monitor() {
        Map&lt;String, ThreadPoolTaskExecutor&gt; executors = 
            applicationContext.getBeansOfType(ThreadPoolTaskExecutor.class);
        
        for (Map.Entry&lt;String, ThreadPoolTaskExecutor&gt; entry : executors.entrySet()) {
            String name = entry.getKey();
            ThreadPoolTaskExecutor executor = entry.getValue();
            ThreadPoolExecutor tpe = executor.getThreadPoolExecutor();
            
            ThreadPoolMetrics metrics = collectMetrics(name, tpe);
            
            // 检查告警
            checkAlerts(metrics);
            
            // 记录日志
            logMetrics(metrics);
        }
    }
    
    private ThreadPoolMetrics collectMetrics(String name, ThreadPoolExecutor tpe) {
        return ThreadPoolMetrics.builder()
            .name(name)
            .poolSize(tpe.getPoolSize())
            .activeCount(tpe.getActiveCount())
            .corePoolSize(tpe.getCorePoolSize())
            .maximumPoolSize(tpe.getMaximumPoolSize())
            .queueSize(tpe.getQueue().size())
            .queueCapacity(tpe.getQueue().size() + tpe.getQueue().remainingCapacity())
            .completedTaskCount(tpe.getCompletedTaskCount())
            .totalTaskCount(tpe.getTaskCount())
            .build();
    }
    
    private void checkAlerts(ThreadPoolMetrics metrics) {
        // 检查线程耗尽
        double activeRatio = (double) metrics.getActiveCount() / metrics.getPoolSize();
        if (metrics.getPoolSize() &gt; 0 && activeRatio &gt; 0.9) {
            alertService.send("Thread pool [{}] thread exhaustion: {}/{}", 
                metrics.getName(), metrics.getActiveCount(), metrics.getPoolSize());
        }
        
        // 检查队列积压
        double queueRatio = (double) metrics.getQueueSize() / metrics.getQueueCapacity();
        if (queueRatio &gt; 0.8) {
            alertService.send("Thread pool [{}] queue backlog: {}/{}", 
                metrics.getName(), metrics.getQueueSize(), metrics.getQueueCapacity());
        }
        
        // 检查任务拒绝
        if (metrics.getRejectedCount() &gt; 0) {
            alertService.send("Thread pool [{}] task rejected: {}", 
                metrics.getName(), metrics.getRejectedCount());
        }
    }
    
    private void logMetrics(ThreadPoolMetrics metrics) {
        log.info("ThreadPool [{}]: pool={}/{}, active={}, queue={}/{}, completed={}", 
            metrics.getName(),
            metrics.getPoolSize(),
            metrics.getMaximumPoolSize(),
            metrics.getActiveCount(),
            metrics.getQueueSize(),
            metrics.getQueueCapacity(),
            metrics.getCompletedTaskCount()
        );
    }
}

@Data
@Builder
public class ThreadPoolMetrics {
    private String name;
    private int poolSize;
    private int activeCount;
    private int corePoolSize;
    private int maximumPoolSize;
    private int queueSize;
    private int queueCapacity;
    private long completedTaskCount;
    private long totalTaskCount;
    private int rejectedCount;
}
```

## 总结

线程池监控要点：

| 指标 | 含义 | 告警阈值 |
|------|------|---------|
| 活跃线程数 | 正在执行任务的线程 | > 最大线程数的 90% |
| 队列大小 | 等待执行的任务数 | > 队列容量的 80% |
| 线程利用率 | 活跃线程数 / 当前线程数 | > 90% |
| 任务拒绝数 | 被拒绝的任务数 | > 0 |
| 已完成任务数 | 累计完成的任务数 | 趋势监控 |

---

## 留给你的问题

假设你的系统有 5 个线程池：

1. 如何设计监控指标，确保能发现「线程池配置错误」而不是等到 OOM？
2. 线程池的活跃线程数从 10 突然涨到 50（最大线程数），然后又降回 10。这个过程中发生了什么？
3. 队列大小持续增长，但活跃线程数不变。这说明什么问题？
4. 如果你的线程池任务执行时间很长（比如调用外部 API 耗时 10 秒），监控指标应该如何调整？

思考这些问题，能帮助你设计更完善的线程池监控方案。
