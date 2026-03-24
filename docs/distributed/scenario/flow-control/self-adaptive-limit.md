# 系统自适应限流：Sentinel 与 Prometheus 联动

固定阈值限流有一个问题：**系统负载是动态的**。

系统空闲时，10000 QPS 完全没问题；系统繁忙时，5000 QPS 就可能崩溃。

固定阈值无法适应系统的动态变化，你需要——**自适应限流**。

## 固定阈值限流的问题

```yaml
# 固定阈值限流
接口 A: 10000 QPS
接口 B: 5000 QPS
接口 C: 2000 QPS
```

问题：

- 接口 A 平时只有 1000 QPS，设置 10000 浪费了 90%
- 接口 A 促销时达到 12000 QPS，限流了，但系统其实还能扛得住
- 接口 B 系统繁忙时，5000 QPS 可能直接让数据库崩溃

固定阈值是静态的，无法感知系统状态。

## 自适应限流的思想

让系统自己「感知」负载，动态调整限流阈值。

```
系统负载低 → 提高 QPS 阈值 → 让更多请求通过
系统负载高 → 降低 QPS 阈值 → 保护系统
```

## BBR 算法

TCP BBR（Bottleneck Bandwidth and Round-trip propagation time）是 Google 提出的拥塞控制算法：

- **吞吐量**：网络管道能承载的最大带宽
- **RTT**：数据往返时间

BBR 的核心思想：**在吞吐量最高点附近工作，既不浪费带宽，又不过载**。

### BBR 在服务限流中的应用

```java
public class BBRRateLimiter {

    private long windowSize = 1000;  // 统计窗口 1 秒
    private long currentLimit;

    // 动态计算限流阈值
    public long calculateLimit() {
        double throughput = getCurrentThroughput();    // 当前吞吐量
        double latency = getCurrentLatency();          // 当前延迟

        // 在最佳吞吐量点附近工作
        double optimalPoint = throughput / latency;

        // 预留 20% 冗余
        return (long) (optimalPoint * 0.8);
    }

    public boolean tryAcquire() {
        currentLimit = calculateLimit();
        long currentCount = getCurrentCount();

        return currentCount < currentLimit;
    }
}
```

## Sentinel 自适应策略

Sentinel 提供了 QPS 自适应和并发数自适应：

```java
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void init() {
        // QPS 自适应限流
        FlowRule qpsRule = new FlowRule("getProduct")
            .setGrade(RuleConstant.FLOW_GRADE_QPS)
            .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT)
            .setMaxQueueingTimeMs(500)  // 最大排队时间
            .set暖WARM_UP_PERIOD_SEC(10)  // 预热时间
            .set暖WARM_UP_COLD_FACTOR(3);  // 冷启动因子
        FlowRuleManager.loadRules(Collections.singletonList(qpsRule));
    }
}
```

### 关键参数

- **maxQueueingTimeMs**：最大排队时间，超过则拒绝
- **暖WARM_UP_PERIOD_SEC**：冷启动时间
- **暖WARM_UP_COLD_FACTOR**：冷启动因子

## Prometheus + Sentinel 联动

将 Sentinel 的指标暴露给 Prometheus，实现联动：

```yaml
# Prometheus 配置
scrape_configs:
  - job_name: 'sentinel'
    metrics_path: '/censor/metrics'
    static_configs:
      - targets: ['sentinel:8719']
```

### 自适应限流规则

```java
@Configuration
public class AdaptiveFlowConfig {

    @Autowired
    private PrometheusMeterRegistry registry;

    @Autowired
    private ConfigService configService;

    @Scheduled(fixedRate = 5000)
    public void adjustFlowRules() {
        // 获取当前系统指标
        double cpuUsage = getCpuUsage();
        double rtAvg = getAvgResponseTime();
        double errorRate = getErrorRate();

        // CPU 过高时，自动降低 QPS
        if (cpuUsage > 0.8) {
            int newQps = calculateQps(cpuUsage);
            updateFlowRule("getProduct", newQps);
            sendAlert("CPU 使用率过高，已自动降流");
        }

        // RT 过高时，自动降流
        if (rtAvg > 500) {
            int newQps = calculateQpsByRt(rtAvg);
            updateFlowRule("getProduct", newQps);
        }
    }

    private int calculateQps(double cpuUsage) {
        // CPU 80% 时，限流 50%
        // CPU 90% 时，限流 30%
        double ratio = 1.0 - (cpuUsage - 0.7) / 0.3;
        int baseQps = configService.getBaseQps("getProduct");
        return (int) (baseQps * Math.max(0.1, ratio));
    }

    private void updateFlowRule(String resource, int qps) {
        FlowRule rule = new FlowRule(resource)
            .setCount(qps)
            .setGrade(RuleConstant.FLOW_GRADE_QPS);
        FlowRuleManager.loadRules(Collections.singletonList(rule));
    }
}
```

## 告警与恢复

```java
@Service
public class FlowControlAlertService {

    @Autowired
    private AlertManager alertManager;

    @Scheduled(fixedRate = 10000)
    public void checkAndAlert() {
        // 检查限流次数
        double blockRate = getBlockRate();
        if (blockRate > 0.1) {
            alertManager.send("限流率过高: " + (blockRate * 100) + "%");
        }

        // 检查 CPU
        double cpu = getCpuUsage();
        if (cpu > 0.9) {
            alertManager.sendCritical("CPU 危险: " + (cpu * 100) + "%");
        }
    }
}
```

## 面试追问方向

- 自适应限流和固定限流如何选择？（答：固定限流简单可控，自适应限流更智能但复杂）
- BBR 和传统拥塞控制的区别？（答：BBR 不丢包，根据吞吐量调整；传统根据丢包调整）
- Prometheus 如何采集 Sentinel 指标？（答：通过 Sentinel 的端点暴露，Prometheus 定期拉取）
- 自适应限流会震荡吗？（答：设置合理的调整步长和最小间隔，避免频繁调整）

## 小结

自适应限流让系统「自己保护自己」：

1. **感知负载**：通过 CPU、RT、错误率等指标感知系统状态
2. **动态调整**：根据负载动态调整限流阈值
3. **自动化**：Prometheus + AlertManager 实现自动调整和告警
4. **平衡取舍**：在稳定性和精确性之间取得平衡

自适应限流是高级限流策略，适合对稳定性要求高的系统。
