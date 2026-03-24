# 负载均衡健康检查：主动检查与被动检查

你的负载均衡器后面挂了 10 台服务器，其中 1 台「假死」了——进程还在，端口还在监听，但就是无法处理请求。

更糟糕的是，负载均衡器不知道它已经「不行」了，继续把请求往这台机器分发。

1/10 的用户会遇到超时，体验极差。

这就是为什么健康检查如此重要。

## 健康检查的本质

健康检查回答一个问题：**后端服务器能否正常处理请求？**

看起来简单，实际上有很多坑：

1. **检查什么？** TCP 连接？HTTP 状态码？应用层接口？
2. **检查频率？** 太频繁浪费资源，太稀疏导致故障发现慢
3. **超时设置？** 网络抖动导致的误判怎么处理？
4. **如何恢复？** 恢复后立即加入还是逐步恢复？

## 主动检查 vs 被动检查

| 类型 | 执行者 | 时机 | 典型场景 |
|------|--------|------|----------|
| 主动检查 | 负载均衡器 | 定期主动探测 | 大多数场景 |
| 被动检查 | 负载均衡器观察请求结果 | 请求失败时触发 | 快速故障发现 |

## 主动检查

负载均衡器定期向后端服务器发送探测包，根据响应判断服务器健康状态。

### 1. TCP 端口检查

最简单的检查，只验证端口是否可达：

```
负载均衡器 ──TCP SYN──→ 后端服务器
              ←─TCP SYN-ACK─
负载均衡器 ──TCP RST──→ 关闭连接
```

**优点**：开销小，简单可靠
**缺点**：只能检查网络层，无法发现应用层问题

```nginx
# Nginx Plus 配置
upstream backend {
    zone backend 64k;
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;

    # 主动健康检查
    health_check port=8080 interval=5s fails=3 passes=2;
}
```

### 2. HTTP/HTTPS 检查

发送真实的 HTTP 请求，检查响应状态码和内容：

```
负载均衡器 ──HTTP GET /health──→ 后端服务器
               ←─HTTP 200 OK───
```

```nginx
# Nginx Plus HTTP 健康检查
upstream backend {
    zone backend 64k;

    health_check uri=/health match=ok;

    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
}

# 定义健康检查匹配规则
match ok {
    # 状态码必须是 200-399
    status 200-399;
    # 响应体必须包含特定内容（可选）
    body ~ "OK";
}
```

### 3. 自定义健康检查接口

生产环境建议实现专门的状态检查接口：

```java
// Spring Boot 健康检查端点
@RestController
public class HealthController {

    @GetMapping("/health")
    public ResponseEntity&lt;HealthStatus&gt; health() {
        HealthStatus status = new HealthStatus();

        // 检查数据库连接
        try {
            jdbcTemplate.execute("SELECT 1");
            status.setDatabase("UP");
        } catch (Exception e) {
            status.setDatabase("DOWN");
        }

        // 检查 Redis 连接
        try {
            redisTemplate.opsForValue().get("health");
            status.setRedis("UP");
        } catch (Exception e) {
            status.setRedis("DOWN");
        }

        // 检查下游依赖
        try {
            boolean ok = userClient.checkHealth();
            status.setUserClient(ok ? "UP" : "DOWN");
        } catch (Exception e) {
            status.setUserClient("DOWN");
        }

        // 如果有组件不可用，返回 503
        if (!status.isAllUp()) {
            return ResponseEntity
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(status);
        }

        return ResponseEntity.ok(status);
    }
}

@Data
public class HealthStatus {
    private String database;
    private String redis;
    private String userClient;
    private long timestamp;

    public boolean isAllUp() {
        return "UP".equals(database)
            && "UP".equals(redis)
            && "UP".equals(userClient);
    }
}
```

### 4. 检查频率与阈值

```yaml
# 健康检查配置
health_check:
  # 检查间隔：5 秒
  interval: 5s

  # 连续失败 3 次才摘除
  fails: 3

  # 连续成功 2 次才恢复
  passes: 2

  # 检查超时：2 秒
  timeout: 2s

  # 检查端口（可与后端端口不同）
  port: 8080

  # 期望的状态码
  status_code: 200
```

### 健康状态转换

```
         初始状态
             │
             ▼
┌─────────────────────────┐
│      健康 (Healthy)     │
└───────────┬─────────────┘
            │ 连续失败 3 次
            ▼
┌─────────────────────────┐
│     不健康 (Unhealthy)   │
└───────────┬─────────────┘
            │ 连续成功 2 次
            ▼
┌─────────────────────────┐
│      恢复 (Recovering)   │
└───────────┬─────────────┘
            │
            ▼
      返回健康状态
```

## 被动检查

被动检查不主动发送探测，而是观察请求的结果来判断后端服务器状态。

### 1. 基于请求结果的检查

```nginx
# Nginx 配置
upstream backend {
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    server 192.168.1.12:8080;

    # 连接失败时不计入失败次数
    # 响应超时时计入
    proxy_next_upstream error timeout http_502 http_503;

    # 最大失败次数
    max_fails: 3;

    # 失败超时时间
    fail_timeout: 30s;
}
```

### 2. 自适应被动检查

更智能的被动检查会根据失败率动态调整：

```java
public class AdaptiveHealthCheck {

    // 每个后端实例的失败计数器
    private final Map&lt;String, AtomicInteger&gt; failureCount = new ConcurrentHashMap<>();
    private final Map&lt;String, CircuitBreaker&gt; circuitBreakers = new ConcurrentHashMap<>();

    // 连续失败阈值
    private static final int FAILURE_THRESHOLD = 5;

    // 恢复时间窗口
    private static final Duration RECOVERY_TIMEOUT = Duration.ofMinutes(1);

    public void recordSuccess(String serverId) {
        AtomicInteger failures = failureCount.get(serverId);
        if (failures != null) {
            failures.set(0);
        }

        CircuitBreaker cb = circuitBreakers.get(serverId);
        if (cb != null) {
            cb.recordSuccess();
        }
    }

    public void recordFailure(String serverId) {
        AtomicInteger failures = failureCount.computeIfAbsent(
            serverId, k -> new AtomicInteger(0));

        int current = failures.incrementAndGet();

        if (current >= FAILURE_THRESHOLD) {
            // 连续失败超过阈值，标记为不健康
            markUnhealthy(serverId);
        }
    }

    private void markUnhealthy(String serverId) {
        CircuitBreaker cb = circuitBreakers.computeIfAbsent(
            serverId, k -> CircuitBreaker.ofDefaults(k));

        cb.transitionToOpenState();

        // 延迟恢复
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
        scheduler.schedule(() -> {
            cb.transitionToHalfOpenState();
            scheduler.shutdown();
        }, RECOVERY_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
    }
}
```

### 3. 基于延迟的检查

```java
public class LatencyBasedHealthCheck {

    // 滑动窗口：记录最近 N 次请求的延迟
    private final Map&lt;String, MovingAverage&gt; latencyStats = new ConcurrentHashMap<>();

    // 平均延迟超过阈值则不健康
    private static final double LATENCY_THRESHOLD_MS = 500;

    // 采样数
    private static final int SAMPLE_SIZE = 10;

    public void recordLatency(String serverId, long latencyMs) {
        MovingAverage avg = latencyStats.computeIfAbsent(
            serverId, k -> new MovingAverage(SAMPLE_SIZE));
        avg.add(latencyMs);
    }

    public boolean isHealthy(String serverId) {
        MovingAverage avg = latencyStats.get(serverId);
        if (avg == null || avg.getCount() < SAMPLE_SIZE / 2) {
            return true;  // 数据不足时默认健康
        }

        return avg.getAverage() < LATENCY_THRESHOLD_MS;
    }

    private static class MovingAverage {
        private final double[] values;
        private int index = 0;
        private int count = 0;

        MovingAverage(int size) {
            this.values = new double[size];
        }

        void add(double value) {
            values[index] = value;
            index = (index + 1) % values.length;
            count = Math.min(count + 1, values.length);
        }

        double getAverage() {
            if (count == 0) return 0;
            return Arrays.stream(values).limit(count).average().orElse(0);
        }

        int getCount() {
            return count;
        }
    }
}
```

## 健康检查的坑与最佳实践

### 1. 健康检查端口独立

```yaml
# 建议：健康检查使用独立端口
server:
  # 业务端口
  port: 8080
  # 健康检查端口（仅允许 LB 访问）
  management:
    server:
      port: 8081
      address: 127.0.0.1  # 只允许本地访问
```

### 2. 健康检查路径使用独立线程池

```java
@Configuration
public class HealthCheckConfig {

    @Bean(name = "healthExecutor")
    public ExecutorService healthCheckExecutor() {
        return Executors.newFixedThreadPool(
            10,
            new ThreadFactoryBuilder()
                .setNameFormat("health-check-%d")
                .build()
        );
    }
}

@Service
public class CustomHealthCheck implements HealthIndicator {

    @Autowired
    @Qualifier("healthExecutor")
    private ExecutorService executor;

    @Override
    public Health health() {
        try {
            // 健康检查使用独立线程池，不影响主业务
            CompletableFuture&lt;Health&gt; future = CompletableFuture.supplyAsync(
                this::performHealthCheck,
                executor
            );

            // 设置超时，避免健康检查本身卡住
            return future.get(3, TimeUnit.SECONDS);
        } catch (Exception e) {
            return Health.down()
                .withDetail("error", e.getMessage())
                .build();
        }
    }

    private Health performHealthCheck() {
        // 执行实际的健康检查
        // ...
        return Health.up().build();
    }
}
```

### 3. 分层健康检查

```java
public class LayeredHealthCheck {

    // 第一层：基础检查（快速）
    private boolean basicCheck() {
        // TCP 端口可达即可
        return isPortOpen(host, port, 1000);
    }

    // 第二层：应用检查（稍慢）
    private boolean applicationCheck() {
        // HTTP 健康接口
        ResponseEntity&lt;HealthStatus&gt; response = restTemplate.getForEntity(
            healthUrl,
            HealthStatus.class
        );
        return response.getStatusCode().is2xxSuccessful()
            && response.getBody() != null
            && response.getBody().isAllUp();
    }

    // 第三层：深度检查（慢）
    private boolean deepCheck() {
        // 数据库查询
        // Redis 读写测试
        // 下游依赖逐一检查
        return checkDatabase() && checkRedis() && checkDependencies();
    }

    public HealthResult check(String host, int port) {
        // 逐层检查，任何一层失败立即返回
        if (!basicCheck()) {
            return HealthResult.unhealthy("Basic check failed");
        }

        if (!applicationCheck()) {
            return HealthResult.unhealthy("Application check failed");
        }

        if (!deepCheck()) {
            return HealthResult.degraded("Deep check failed, running in degraded mode");
        }

        return HealthResult.healthy();
    }
}
```

### 4. 优雅下线

```java
@SpringBootApplication
public class Application implements ApplicationListener&lt;PreDestroy.class&gt; {

    private final LoadBalancerClient loadBalancer;

    public Application(LoadBalancerClient loadBalancer) {
        this.loadBalancer = loadBalancer;
    }

    @Override
    public void onApplicationEvent(PreDestroy event) {
        // 下线前先从负载均衡器摘除
        // 这样就不会再有新请求过来

        ServiceInstance instance = loadBalancer.getLocalServiceInstance();
        // 向注册中心发送下线请求
        // Eureka: POST /eureka/apps/{app-id}/{instance-id}/status?value=OUT_OF_SERVICE
        // Nacos: PUT /nacos/v1/ns/instance/catalog/offline

        log.info("Instance deregistered: {}", instance.getServiceId());
    }
}
```

## 常见问题排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 健康检查正常但用户请求失败 | 健康检查路径与业务路径不同 | 检查路径配置 |
| 某台服务器反复上下线 | 网络抖动，阈值设置不合理 | 调高 fails 参数 |
| 健康检查正常但实例被摘除 | 并发量大，检查超时 | 增大 timeout |
| 故障恢复后长时间未加入 | 恢复阈值太低 | 增大 passes 参数 |

---

**思考题：**

假设你负责一个金融交易系统，负载均衡器后面挂了 5 台交易服务器。

某天，其中 1 台服务器的数据库连接池泄漏，进程没有崩溃但无法处理新请求。

问题：
1. 如果使用 TCP 端口检查，这台服务器会被摘除吗？为什么？
2. 如果使用 HTTP /health 接口检查，这台服务器会被摘除吗？为什么？
3. 如果健康检查接口本身需要查询数据库才能返回状态，会产生什么问题？
4. 如何设计健康检查策略，既能快速发现问题，又能避免误判导致频繁摘挂？

提示：考虑检查的准确性、速度、以及对业务的影响。
