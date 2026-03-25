# Sentinel 规则持久化，推模式与拉模式

> Sentinel 控制台配置的规则，重启后就丢了？生产环境怎么保证规则持久化？
>
> 这一讲，我们来聊聊 Sentinel 规则持久化的两种模式。

---

## 规则持久化的必要性

```
┌─────────────────────────────────────────────────────────┐
│                Sentinel 规则生命周期                       │
│                                                          │
│  ┌──────────────┐                                       │
│  │   控制台       │ ──► 配置规则                         │
│  │   Dashboard   │                                      │
│  └───────┬───────┘                                       │
│          │                                               │
│          ▼                                               │
│  ┌──────────────┐                                       │
│  │   内存        │ ──► 规则生效                          │
│  │  (In Memory) │                                      │
│  └──────────────┘                                       │
│          │                                               │
│          │ 重启                                          │
│          ▼                                               │
│     ═══════════════                                     │
│       规则丢失！                                         │
│     ═══════════════                                     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**问题**：规则只存在内存中，服务重启后规则丢失。

**解决方案**：规则持久化——将规则存储到外部存储（文件、数据库、Nacos、Apollo 等）。

---

## 两种持久化模式

```
┌─────────────────────────────────────────────────────────┐
│                    持久化模式对比                         │
│                                                          │
│   ┌─────────────┐         ┌─────────────┐              │
│   │   推模式     │         │   拉模式     │              │
│   │ (Push Mode) │         │ (Pull Mode) │              │
│   └──────┬──────┘         └──────┬──────┘              │
│          │                       │                      │
│          ▼                       ▼                      │
│   ┌─────────────┐         ┌─────────────┐              │
│   │  控制台推送   │         │  客户端拉取   │              │
│   │  规则到存储   │         │  规则到内存   │              │
│   └─────────────┘         └─────────────┘              │
│                                                          │
│   推荐：推模式（实时性更好）                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 推模式（Push Mode）

```
控制台 → 配置中心（如 Nacos） → Sentinel Client
         (规则存储)              (订阅变更)
```

- **优点**：实时性好，规则变更立即生效
- **缺点**：需要配置中心支持
- **适用**：生产环境

### 拉模式（Pull Mode）

```
控制台 → 文件 → Sentinel Client
         (规则存储)   (定时拉取)
```

- **优点**：实现简单，不依赖外部组件
- **缺点**：实时性差，有延迟
- **适用**：开发测试环境

---

## 推模式：Nacos 持久化

### 1. 引入依赖

```xml
<dependencies>
    <dependency>
        <groupId>com.alibaba.cloud</groupId>
        <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
    </dependency>
    
    <!-- Sentinel 数据源 Nacos -->
    <dependency>
        <groupId>com.alibaba.csp</groupId>
        <artifactId>sentinel-datasource-nacos</artifactId>
    </dependency>
</dependencies>
```

### 2. 配置 Nacos 数据源

```yaml
spring:
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848
      config:
        server-addr: 127.0.0.1:8848

# Sentinel 配置
sentinel:
  datasource:
    # 流控规则
    flow:
      nacos:
        server-addr: ${spring.cloud.nacos.config.server-addr}
        data-id: ${spring.application.name}-sentinel-flow
        group-id: SENTINEL_GROUP
        data-type: json
        rule-type: flow
    # 熔断规则
    degrade:
      nacos:
        server-addr: ${spring.cloud.nacos.config.server-addr}
        data-id: ${spring.application.name}-sentinel-degrade
        group-id: SENTINEL_GROUP
        data-type: json
        rule-type: degrade
    # 系统规则
    system:
      nacos:
        server-addr: ${spring.cloud.nacos.config.server-addr}
        data-id: ${spring.application.name}-sentinel-system
        group-id: SENTINEL_GROUP
        data-type: json
        rule-type: system
```

### 3. Nacos 配置规则

#### 流控规则（flow）

```json
[
    {
        "resource": "getOrder",
        "limitApp": "default",
        "grade": 1,
        "count": 100,
        "strategy": 0,
        "controlBehavior": 0,
        "clusterMode": false
    }
]
```

**字段说明**：

| 字段 | 说明 | 可选值 |
|---|---|---|
| resource | 资源名 | - |
| limitApp | 来源应用 | default（不区分来源） |
| grade | 阈值类型 | 0=线程数，1=QPS |
| count | 阈值 | - |
| strategy | 流控模式 | 0=直接，1=关联，2=链路 |
| controlBehavior | 流控效果 | 0=直接拒绝，1=冷启动，2=匀速排队 |
| clusterMode | 是否集群 | false |

#### 熔断规则（degrade）

```json
[
    {
        "resource": "getOrder",
        "grade": 0,
        "count": 100,
        "timeWindow": 10,
        "minRequestAmount": 5,
        "slowRatioThreshold": 1.0
    }
]
```

**字段说明**：

| 字段 | 说明 | 可选值 |
|---|---|---|
| resource | 资源名 | - |
| grade | 熔断模式 | 0=RT，1=异常比例，2=异常数 |
| count | 阈值 | - |
| timeWindow | 熔断时长（秒） | - |
| minRequestAmount | 最小请求数 | - |

#### 系统规则（system）

```json
[
    {
        "resource": "/api/order",
        "highestSystemLoad": 3.0,
        "highestCpuUsage": 0.9,
        "avgRt": 100,
        "qps": 1000
    }
]
```

---

## 拉模式：文件持久化

### 1. 引入依赖

```xml
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-datasource-file</artifactId>
</dependency>
```

### 2. 配置规则文件

```yaml
sentinel:
  rules:
    flow:
      # 流控规则文件路径
      file: classpath:rules/flow-rule.json
    degrade:
      # 熔断规则文件路径
      file: classpath:rules/degrade-rule.json
```

### 3. 创建规则文件

**flow-rule.json**：

```json
[
    {
        "resource": "getOrder",
        "limitApp": "default",
        "grade": 1,
        "count": 100,
        "strategy": 0,
        "controlBehavior": 0
    },
    {
        "resource": "createOrder",
        "limitApp": "default",
        "grade": 1,
        "count": 50,
        "strategy": 0,
        "controlBehavior": 0
    }
]
```

**degrade-rule.json**：

```json
[
    {
        "resource": "getOrder",
        "grade": 0,
        "count": 100,
        "timeWindow": 10,
        "minRequestAmount": 5
    }
]
```

### 4. 代码加载规则

```java
@Configuration
public class SentinelRuleConfig {
    
    @PostConstruct
    public void loadRules() {
        try {
            // 加载流控规则
            String flowRule = ResourceUtil.readResource("rules/flow-rule.json");
            List&lt;FlowRule&gt; flowRules = JSON.parseArray(flowRule, FlowRule.class);
            FlowRuleManager.loadRules(flowRules);
            
            // 加载熔断规则
            String degradeRule = ResourceUtil.readResource("rules/degrade-rule.json");
            List&lt;DegradeRule&gt; degradeRules = JSON.parseArray(degradeRule, DegradeRule.class);
            DegradeRuleManager.loadRules(degradeRules);
            
        } catch (Exception e) {
            log.error("加载 Sentinel 规则失败", e);
        }
    }
}
```

---

## 动态规则更新

### Watch 机制（推模式）

Nacos 推模式天然支持动态更新：

```java
@Configuration
public class SentinelNacosConfig {
    
    @Bean
    public ConfigService sentinelConfigService() throws Exception {
        Properties properties = new Properties();
        properties.put("serverAddr", "127.0.0.1:8848");
        return ConfigFactory.getConfigService(properties);
    }
}
```

当 Nacos 中的规则变更时，Sentinel Client 会自动感知并更新。

### 手动刷新（拉模式）

```java
@Configuration
public class SentinelRuleConfig {
    
    @Scheduled(fixedRate = 5000)  // 每 5 秒刷新一次
    public void refreshRules() {
        try {
            // 重新读取文件并加载
            String flowRule = ResourceUtil.readResource("rules/flow-rule.json");
            List&lt;FlowRule&gt; flowRules = JSON.parseArray(flowRule, FlowRule.class);
            FlowRuleManager.loadRules(flowRules);
            
            log.info("Sentinel 规则已刷新");
        } catch (Exception e) {
            log.error("刷新 Sentinel 规则失败", e);
        }
    }
}
```

---

## 规则优先级

当多个数据源配置了相同资源名的规则时，按以下优先级生效：

```
1. 控制台动态配置（最高）
2. Nacos / Apollo 等配置中心
3. 本地文件
4. 代码硬编码（最低）
```

---

## 生产环境推荐方案

### Nacos 持久化 + 控制台管理

```
┌─────────────────────────────────────────────────────────┐
│                  生产环境推荐架构                          │
│                                                          │
│   ┌─────────────┐                                       │
│   │   Nacos     │ ← 规则存储（配置中心）                 │
│   │   Server    │                                       │
│   └──────┬──────┘                                       │
│          │                                               │
│          ▼                                               │
│   ┌─────────────────────────────────────────────────┐   │
│   │              Sentinel Client                     │   │
│   │                                                  │   │
│   │   @SentinelResource 定义资源                     │   │
│   │   DataSource 监听 Nacos 配置变更                 │   │
│   │   规则自动同步到内存                              │   │
│   └─────────────────────────────────────────────────┘   │
│                                                          │
│   ┌─────────────┐                                       │
│   │  Dashboard  │ ← 可选：用于查看规则（不修改）         │
│   └─────────────┘                                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 最佳实践

1. **使用 Nacos 作为规则存储**：配置中心已是标配，无需额外引入组件
2. **规则 ID 命名规范**：`${application.name}-sentinel-${rule-type}`
3. **分组管理**：不同环境使用不同 Group
4. **规则版本控制**：Nacos 配置历史版本可追溯

---

## 面试高频问题

### Q：Sentinel 的推模式和拉模式有什么区别？

A：**推模式**是配置中心主动推送规则到 Client，实时性好。**拉模式**是 Client 定时从存储拉取规则，有延迟。生产环境推荐推模式。

### Q：Sentinel 规则如何保证一致性？

A：通过配置中心（如 Nacos）的配置发布订阅机制。当配置变更时，Nacos 主动推送给所有订阅的 Client，保证规则一致性。

### Q：多个 Sentinel Client 如何共享规则？

A：所有 Client 连接同一个 Nacos 配置中心，规则存储在 Nacos 中，所有 Client 都会监听到规则变更。

### Q：如何实现规则的灰度发布？

A：可以通过 Nacos 的命名空间（Namespace）实现不同环境的规则隔离，或者通过 rule-type 字段区分不同应用。

---

## 总结

Sentinel 规则持久化是生产环境的必备能力：

1. **推模式（Nacos）**：实时性好，推荐生产环境使用
2. **拉模式（文件）**：实现简单，适合开发测试
3. **规则配置**：JSON 格式，字段含义需理解
4. **动态更新**：配置中心变更自动同步

> 规则持久化让 Sentinel 的流量控制更加可靠，是生产环境的必备配置。
