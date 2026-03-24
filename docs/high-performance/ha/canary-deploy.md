# 灰度发布与金丝雀发布策略

你有没有想过这个问题：你的系统有一个重大升级，涉及到核心业务逻辑的改动。

你是选择深夜凌晨悄悄上线，然后祈祷不要出问题？还是选择先让一小部分用户试试，发现问题就回滚？

聪明的工程师会选择后者——这就是**灰度发布**。

## 什么是灰度发布

灰度发布（Gray Release）是指在生产环境中，逐步将新版本推送给一部分用户，观察运行情况，确认稳定后再全量发布的策略。

这个名字来源于「灰度测试」——就像从黑色逐渐过渡到白色的色阶，新版本也是逐步「灰度」地替换旧版本。

```
传统发布：
    旧版本 ──────▶ 新版本（瞬间切换）

灰度发布：
    旧版本 ───┬───▶ 旧版本（90% 用户）
              │
              └───▶ 新版本（10% 用户）◀── 观察
                     │
                     ▼
              ┌────────┴────────┐
              │                 │
         稳定OK ──┘           有问题
              │                 │
              ▼                 ▼
         扩大灰度 ───────▶ 快速回滚
              │
              ▼
         全量发布
```

## 金丝雀发布

金丝雀发布（Canary Release）是灰度发布的一种形式，名字来源于矿工使用金丝雀检测有毒气体的历史。

```
┌─────────────────────────────────────────────────────────┐
│                   金丝雀发布示意                           │
│                                                         │
│    ┌─────────────────────────────────────────┐        │
│    │                                         │        │
│    │    金丝雀（10% 流量）→ 新版本 v2         │        │
│    │         ↓                                │        │
│    │    健康检查 + 指标监控                    │        │
│    │         ↓                                │        │
│    │    稳定 ──▶ 扩大灰度 ──▶ 全量发布        │        │
│    │         │                               │        │
│    │         └──▶ 有问题 ──▶ 快速回滚         │        │
│    │                                         │        │
│    └─────────────────────────────────────────┘        │
│                                                         │
│    旧版本 v1（90% 流量）                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 金丝雀发布的特点

- **渐进式**：从 1% → 5% → 10% → 50% → 100%
- **可观测**：每个阶段都有详细的监控和报警
- **快速回滚**：出问题可以快速切回旧版本
- **风险可控**：问题只影响小部分用户

## 灰度策略

### 1. 流量比例灰度

按照固定比例将流量分配到新版本。

```java
@Configuration
public class CanaryRoutingConfig {

    @Bean
    public CanaryRouter canaryRouter() {
        return new CanaryRouter();
    }
}

public class CanaryRouter {

    private final AtomicInteger canaryPercentage = new AtomicInteger(10);

    /**
     * 根据流量比例路由
     */
    public String route(String userId) {
        // 使用哈希确保同一用户始终路由到同一版本
        int hash = Math.abs(userId.hashCode()) % 100;

        if (hash &lt; canaryPercentage.get()) {
            return "v2";  // 金丝雀版本
        }

        return "v1";  // 稳定版本
    }

    /**
     * 调整灰度比例
     */
    public void adjustPercentage(int newPercentage) {
        canaryPercentage.set(newPercentage);
    }
}
```

### 2. 用户标签灰度

根据用户特征进行灰度，如用户 ID、地区、VIP 等级等。

```java
public class LabelBasedCanaryRouter {

    /**
     * 根据用户标签路由
     */
    public String route(User user) {
        // 内部员工先尝新
        if (user.isInternal()) {
            return "v2";
        }

        // 白名单用户
        if (whiteListService.isInWhiteList(user.getId())) {
            return "v2";
        }

        // VIP 用户优先体验新功能
        if (user.getVipLevel() >= 3) {
            return "v2";
        }

        // 按地区灰度
        if (isGrayRegion(user.getRegion())) {
            return "v2";
        }

        return "v1";
    }

    private boolean isGrayRegion(String region) {
        // 灰度地区列表可配置
        Set&lt;String&gt; grayRegions = grayConfig.getRegions();
        return grayRegions.contains(region);
    }
}
```

### 3. 请求特征灰度

根据请求的特征进行灰度，如 Header、Cookie、设备类型等。

```java
public class FeatureBasedCanaryRouter {

    private final Set&lt;String&gt; testDevices = Set.of("iPhone14", "iPhone15");
    private final Set&lt;String&gt; betaBrowsers = Set.of("Chrome-Beta", "Firefox-Nightly");

    public String route(HttpRequest request) {
        // 根据 Header 灰度
        String canaryHeader = request.getHeader("X-Canary");
        if ("enable".equals(canaryHeader)) {
            return "v2";
        }

        // 根据 Cookie 灰度
        String canaryCookie = request.getCookie("canary_version");
        if ("v2".equals(canaryCookie)) {
            return "v2";
        }

        // 根据设备类型灰度
        String device = request.getHeader("X-Device-Type");
        if (testDevices.contains(device)) {
            return "v2";
        }

        // 根据浏览器灰度
        String userAgent = request.getHeader("User-Agent");
        if (isBetaBrowser(userAgent)) {
            return "v2";
        }

        return "v1";
    }
}
```

### 4. 渐进式灰度

逐步增加流量，观察指标变化。

```java
@Service
public class ProgressiveCanaryService {

    @Autowired
    private MetricsService metricsService;
    @Autowired
    private CanaryRouter router;

    private final int[] graySteps = {1, 5, 10, 20, 50, 100};
    private volatile int currentStep = 0;

    /**
     * 渐进式增加灰度
     */
    public void increaseGray() {
        if (currentStep >= graySteps.length - 1) {
            log.info("已达到 100% 灰度，全量发布");
            return;
        }

        currentStep++;
        int newPercentage = graySteps[currentStep];

        // 检查前一个阶段的指标
        if (currentStep > 0) {
            if (!isHealthy(graySteps[currentStep - 1])) {
                log.warn("灰度 {}% 时指标异常，停止升级", newPercentage);
                return;
            }
        }

        // 更新路由比例
        router.adjustPercentage(newPercentage);
        log.info("灰度比例调整为: {}%", newPercentage);
    }

    /**
     * 检查灰度是否健康
     */
    private boolean isHealthy(int percentage) {
        // 检查错误率
        double errorRate = metricsService.getErrorRate(percentage);
        if (errorRate > 0.01) {  // 错误率超过 1%
            log.warn("错误率过高: {}%", errorRate * 100);
            return false;
        }

        // 检查延迟
        double avgLatency = metricsService.getAvgLatency(percentage);
        if (avgLatency > 500) {  // 平均延迟超过 500ms
            log.warn("延迟过高: {}ms", avgLatency);
            return false;
        }

        // 检查成功率
        double successRate = metricsService.getSuccessRate(percentage);
        if (successRate &lt; 0.99) {  // 成功率低于 99%
            log.warn("成功率过低: {}%", successRate * 100);
            return false;
        }

        return true;
    }

    /**
     * 回滚到上一个阶段
     */
    public void rollback() {
        if (currentStep > 0) {
            currentStep--;
            int newPercentage = graySteps[currentStep];
            router.adjustPercentage(newPercentage);
            log.info("灰度回滚到: {}%", newPercentage);
        }
    }
}
```

## Kubernetes 灰度发布

### 1. Deployment 灰度配置

```yaml
# 金丝雀 Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-canary
spec:
  replicas: 1  # 金丝雀副本数少
  selector:
    matchLabels:
      app: myapp
      version: v2
  template:
    metadata:
      labels:
        app: myapp
        version: v2
    spec:
      containers:
      - name: myapp
        image: myapp:v2
        resources:
          requests:
            memory: "64Mi"
            cpu: "250m"
          limits:
            memory: "128Mi"
            cpu: "500m"
---
# Service 选择器
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
```

### 2. Istio 流量管理

```yaml
# VirtualService 配置
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
  - myapp
  http:
  - route:
    - destination:
        host: myapp
        subset: v1
      weight: 90
    - destination:
        host: myapp
        subset: v2
      weight: 10  # 10% 流量到金丝雀
---
# DestinationRule 定义子集
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: myapp
spec:
  host: myapp
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```

### 3. 渐进式流量调整

```java
@Service
public class IstioCanaryController {

    @Autowired
    private KubernetesClient kubernetesClient;

    /**
     * 调整金丝雀流量比例
     */
    public void adjustTraffic(String namespace, String virtualServiceName, int canaryWeight) {
        // 获取当前 VirtualService
        VirtualService vs = kubernetesClient.virtualServices()
            .inNamespace(namespace)
            .withName(virtualServiceName)
            .get();

        // 调整权重
        HttpRoute httpRoute = vs.getSpec().getHttp().get(0);
        List&lt;DestinationWeight&gt; weights = httpRoute.getRoute();
        weights.get(0).setWeight(100 - canaryWeight);  // v1
        weights.get(1).setWeight(canaryWeight);        // v2

        // 更新
        kubernetesClient.virtualServices()
            .inNamespace(namespace)
            .withName(virtualServiceName)
            .update(vs);
    }
}
```

## 灰度发布实现

### 1. 网关层灰度

```java
@Component
public class CanaryGatewayFilter {

    @Autowired
    private CanaryRouter canaryRouter;
    @Autowired
    private LoadBalancer loadBalancer;

    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String userId = extractUserId(exchange);
        String targetVersion = canaryRouter.route(userId);

        // 根据版本选择后端服务
        List&lt;ServiceInstance&gt; instances = loadBalancer.getInstances("myapp");
        ServiceInstance target = instances.stream()
            .filter(i -> targetVersion.equals(i.getMetadata().get("version")))
            .findFirst()
            .orElse(instances.get(0));

        // 转发请求
        String url = "http://" + target.getHost() + ":" + target.getPort() + exchange.getRequest().getPath();
        return webClient.get().uri(url)
            .retrieve()
            .bodyToMono(Void.class);
    }
}
```

### 2. Spring Cloud 灰度

```java
@Configuration
public class RibbonCanaryConfig {

    @Bean
    public IRule canaryRule() {
        return new CanaryWeightedRule();
    }
}

public class CanaryWeightedRule extends AbstractLoadBalancerRule {

    private final CanaryRouter router = new CanaryRouter();

    @Override
    public Server choose(Object key) {
        LoadBalancerStats stats = getLoadBalancer().getLoadBalancerStats();
        if (stats == null) {
            return super.choose(key);
        }

        // 获取原始 Ribbon 选择的目标
        Server target = new RuleServerLocator(this).getLoadBalancer()
            .choose(key);

        // 检查是否需要路由到金丝雀版本
        String userId = RequestContextHolder.getContext().getUserId();
        String version = router.route(userId);

        // 查找对应版本的服务器
        List&lt;Server&gt; servers = getLoadBalancer().getReachableServers();
        return servers.stream()
            .filter(s -> version.equals(s.getMetaInfo().getServerGroup()))
            .findFirst()
            .orElse(target);
    }
}
```

### 3. 配置中心灰度

```java
@Configuration
public class ConfigGrayConfig {

    @Autowired
    private ConfigServer configServer;

    /**
     * 根据用户灰度配置
     */
    @GetMapping("/config/{key}")
    public Config getConfig(@PathVariable String key,
                            @RequestHeader(value = "X-User-Id", required = false) String userId) {
        // 检查是否有灰度配置
        String grayConfigKey = key + ".gray." + userId;
        String grayValue = configServer.get(grayConfigKey);

        if (grayValue != null) {
            return new Config(key, grayValue, true);
        }

        // 返回默认配置
        String defaultValue = configServer.get(key);
        return new Config(key, defaultValue, false);
    }
}
```

## 灰度监控

### 1. 核心指标监控

```java
@Service
public class CanaryMetricsCollector {

    @Autowired
    private MeterRegistry meterRegistry;

    public void recordRequest(String version, boolean success, long latency) {
        Counter.builder("canary.requests")
            .tag("version", version)
            .tag("status", success ? "success" : "failure")
            .register(meterRegistry)
            .increment();

        Timer.builder("canary.latency")
            .tag("version", version)
            .register(meterRegistry)
            .record(latency, TimeUnit.MILLISECONDS);
    }

    /**
     * 获取版本对比数据
     */
    public CanaryReport generateReport() {
        return CanaryReport.builder()
            .v1Metrics(collectMetrics("v1"))
            .v2Metrics(collectMetrics("v2"))
            .difference(calculateDifference())
            .recommendation(makeRecommendation())
            .build();
    }

    private Metrics collectMetrics(String version) {
        return Metrics.builder()
            .requestCount(getCounterValue("canary.requests", version))
            .errorRate(getErrorRate(version))
            .avgLatency(getAvgLatency(version))
            .p99Latency(getP99Latency(version))
            .successRate(getSuccessRate(version))
            .build();
    }
}
```

### 2. 异常检测

```java
@Service
public class CanaryAnomalyDetector {

    private static final double ERROR_RATE_THRESHOLD = 0.01;
    private static final double LATENCY_INCREASE_THRESHOLD = 1.5;

    @Autowired
    private CanaryMetricsCollector collector;

    @Scheduled(fixedRate = 60000)
    public void detectAnomalies() {
        CanaryReport report = collector.generateReport();

        Metrics v1 = report.getV1Metrics();
        Metrics v2 = report.getV2Metrics();

        // 检查错误率
        if (v2.getErrorRate() > ERROR_RATE_THRESHOLD) {
            if (v2.getErrorRate() > v1.getErrorRate() * 2) {
                triggerAlert("金丝雀版本错误率异常升高",
                    "v2 错误率: " + v2.getErrorRate() +
                    " 是 v1 (" + v1.getErrorRate() + ") 的 2 倍以上");
            }
        }

        // 检查延迟
        double latencyIncrease = v2.getAvgLatency() / v1.getAvgLatency();
        if (latencyIncrease > LATENCY_INCREASE_THRESHOLD) {
            triggerAlert("金丝雀版本延迟显著增加",
                "v2 延迟: " + v2.getAvgLatency() + "ms，" +
                "v1 延迟: " + v1.getAvgLatency() + "ms");
        }
    }
}
```

### 3. 可视化监控

```java
@RestController
@RequestMapping("/admin/canary")
public class CanaryDashboardController {

    @Autowired
    private CanaryMetricsCollector metricsCollector;

    @GetMapping("/dashboard")
    public CanaryDashboard getDashboard() {
        return CanaryDashboard.builder()
            .report(metricsCollector.generateReport())
            .currentTraffic(collector.getCurrentTraffic())
            .recentEvents(eventRepository.findRecent())
            .build();
    }

    @GetMapping("/traffic")
    public TrafficComparison getTrafficComparison() {
        Map&lt;String, List&lt;TrafficData&gt;&gt; data = metricsCollector.getTrafficData();

        return TrafficComparison.builder()
            .v1Traffic(data.get("v1"))
            .v2Traffic(data.get("v2"))
            .timestamps(getTimestamps())
            .build();
    }
}
```

## 快速回滚

### 1. 自动回滚

```java
@Service
public class AutoRollbackService {

    @Autowired
    private CanaryRouter router;
    @Autowired
    private AlertManager alertManager;

    private static final double ROLLBACK_ERROR_RATE = 0.05;
    private static final double ROLLBACK_LATENCY_P99 = 2000;

    @EventListener
    public void onMetricAnomaly(MetricAnomalyEvent event) {
        if (!isCanaryDeployment()) {
            return;
        }

        if (shouldRollback(event)) {
            log.error("检测到严重异常，自动回滚: {}", event);

            // 1. 立即将流量切回稳定版本
            router.adjustPercentage(0);

            // 2. 告警通知
            alertManager.send(Alert.builder()
                .level(AlertLevel.CRITICAL)
                .title("金丝雀版本自动回滚")
                .message("原因: " + event.getReason())
                .build());

            // 3. 记录回滚事件
            rollbackHistory.record(event);
        }
    }

    private boolean shouldRollback(MetricAnomalyEvent event) {
        return event.getErrorRate() > ROLLBACK_ERROR_RATE ||
               event.getP99Latency() > ROLLBACK_LATENCY_P99;
    }
}
```

### 2. 手动回滚

```java
@RestController
@RequestMapping("/admin/canary")
public class CanaryRollbackController {

    @Autowired
    private CanaryRouter router;
    @Autowired
    private DeploymentManager deploymentManager;

    @PostMapping("/rollback")
    public Response rollback(@RequestParam(required = false) String targetVersion) {
        log.info("管理员发起回滚: targetVersion={}", targetVersion);

        // 1. 停止金丝雀流量
        router.adjustPercentage(0);

        // 2. 触发部署回滚
        String version = targetVersion != null ? targetVersion : "v1";
        deploymentManager.rollback(version);

        // 3. 记录
        auditLog.log("CANARY_ROLLBACK", version);

        return Response.success("回滚成功，当前版本: " + version);
    }

    @PostMapping("/full-rollback")
    public Response fullRollback() {
        log.warn("管理员发起全量回滚");

        // 快速回滚：所有流量切回稳定版本
        router.adjustPercentage(0);
        deploymentManager.fullRollback();

        return Response.success("全量回滚完成");
    }
}
```

---

**思考题：**

1. 金丝雀发布的比例应该如何设置？有人说「1% → 5% → 10% → 50% → 100%」，有人说「直接 10%」。哪种更合理？

2. 如何判断灰度版本是否「健康」？除了错误率和延迟，还需要关注哪些指标？

3. 如果灰度过程中发现问题，是应该立即回滚还是先分析原因？快速回滚和充分测试之间如何平衡？

4. 灰度发布和 A/B 测试有什么区别？它们的适用场景分别是什么？
