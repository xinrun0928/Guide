# Nacos 配置中心

你有没有遇到过这种情况：

线上出了 bug，紧急修改配置。结果改完后发现——改的是测试环境的配置。

或者：配置改了，要发版才能生效。但发版需要测试、审批、灰度……一套流程下来，1 个小时过去了。

**配置中心要解决的核心问题只有一个：让配置变更实时生效，不需要重启。**

## 配置管理的痛点

在微服务架构中，配置管理是个大麻烦：

```
10 个微服务
每个微服务 3 台机器
每台机器有 5 个配置文件
总共：10 × 3 × 5 = 150 个配置文件
```

**没有配置中心时：**

- 改配置：登录 30 台机器，改 150 个文件
- 出错排查：不知道哪台机器的配置是旧版本
- 环境隔离：dev、test、prod 配置混在一起
- 配置回滚：改错了怎么恢复到上一版本？

## Nacos 配置模型

### 配置的基本概念

```
Data ID    = 配置文件的名字（如 application.yml）
Group      = 配置分组（如 DEFAULT_GROUP、REDIS_GROUP）
Namespace  = 环境隔离（如 dev、test、prod）
```

### 三层隔离

```
Namespace（租户隔离）
    └── Group（业务隔离）
        └── Data ID（配置隔离）
```

```java
// 获取配置
String dataId = "datasource.properties";
String group = "DATABASE_GROUP";
String namespace = "prod";

String content = configService.getConfig(dataId, group, namespace);
```

### 创建配置

```java
// 方式一：使用 Nacos Console（图形界面）
// 方式二：使用 API
configService.publishConfig(
    "datasource.properties",  // Data ID
    "DATABASE_GROUP",         // Group
    "prod",                   // Namespace
    "spring.datasource.url=jdbc:mysql://localhost:3306/order"
);
```

```yaml
# Spring Boot 配置
spring:
  application:
    name: order-service
  cloud:
    nacos:
      config:
        server-addr: 192.168.1.100:8848
        namespace: prod
        group: DEFAULT_GROUP
        file-extension: properties
        refreshable-dataids: common.properties  # 需要热更新的配置文件
```

## 热更新：配置变更秒级生效

这是配置中心最重要的功能。

### 工作原理

```
配置变更（Nacos Console 或 API）
         ↓
Nacos 推送变更通知到客户端
         ↓
客户端刷新配置
         ↓
Spring 重新绑定配置值
         ↓
@RefreshScope 注解的 Bean 重新创建
```

### 使用方式

**第一步：添加依赖**

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
</dependency>
```

**第二步：启用配置刷新**

```java
// 方式一：@RefreshScope 注解
// 标注了这个注解的 Bean，配置变更后会自动重新创建
@RestController
@RefreshScope
public class OrderController {
    @Value("${order.max-count:100}")
    private int maxOrderCount;

    @GetMapping("/create")
    public String createOrder() {
        if (orderCount >= maxOrderCount) {
            return "超出最大订单数限制";
        }
        // ...
    }
}

// 方式二：@ConfigurationProperties 注解
// 配置属性类，配置变更后属性值自动更新
@Component
@ConfigurationProperties(prefix = "order")
@Data
public class OrderProperties {
    private int maxCount = 100;
    private int timeoutSeconds = 30;
    private String discountCode;
}
```

**第三步：在 Nacos 控制台修改配置**

```
配置管理 → 配置列表 → 选择 Namespace 和 Group → 编辑
```

修改完成后，客户端会在几秒内收到通知，并刷新配置。

### 配置变更监听

```java
// 监听配置变更
@NacosConfigListener(timeout = 5000)
public void onChange(String newValue) {
    // 配置变更时的回调
    System.out.println("配置变更: " + newValue);
    // 重新初始化相关组件
    reload(newValue);
}
```

## 多环境隔离

### 环境划分

```
dev（开发环境）
    ├── order-service (DEFAULT_GROUP)
    ├── inventory-service (DEFAULT_GROUP)
    └── ...

test（测试环境）
    ├── order-service (DEFAULT_GROUP)
    └── ...

prod（生产环境）
    ├── order-service (DEFAULT_GROUP)
    └── ...
```

### 不同环境的配置示例

```yaml
# application-dev.yml
spring:
  cloud:
    nacos:
      config:
        namespace: dev

# application-test.yml
spring:
  cloud:
    nacos:
      config:
        namespace: test

# application-prod.yml
spring:
  cloud:
    nacos:
      config:
        namespace: prod
```

### 共享配置与扩展配置

```yaml
spring:
  cloud:
    nacos:
      config:
        # 共享配置，所有环境都要加载
        shared-dataids: common.properties,redis.properties
        # 可热更新的共享配置
        refreshable-dataids: common.properties
        # 配置文件扩展名
        file-extension: yaml
```

```
加载顺序（后面的覆盖前面的）：
1. shared-dataids（共享配置）
2. refreshable-dataids（可热更新的共享配置）
3. {application}-{profile}.{file-extension}（当前应用配置）
4. {application}.{file-extension}（默认配置）
```

## 配置的版本管理

### 配置回滚

Nacos 提供了配置历史版本功能：

```
配置管理 → 配置列表 → 历史 → 查看修改记录 → 一键回滚
```

```java
// 使用 API 回滚
configService.getConfigHistory(serviceId, dataId, group, n);
configService.rollbackConfig(dataId, group, namespaceId, num);
```

### 配置监听与审计

```java
// 监听配置变更的来源
// 在 Nacos 控制台可以查看：
// - 谁在什么时间修改了配置
// - 修改前后的内容对比
// - 影响的客户端数量
```

## 配置文件最佳实践

### 按功能划分

```
配置结构：
├── shared/                          # 共享配置
│   ├── common.yaml                  # 通用配置
│   └── redis.yaml                   # Redis 配置
├── order/                           # 订单服务配置
│   ├── order.yaml                   # 订单业务配置
│   └── order-datasource.yaml        # 订单数据库配置
└── inventory/                       # 库存服务配置
    ├── inventory.yaml               # 库存业务配置
    └── inventory-datasource.yaml    # 库存数据库配置
```

### 配置的命名规范

| 配置类型 | 命名格式 | 示例 |
|---------|---------|-----|
| 应用配置 | `{app-name}.yaml` | order.yaml |
| 数据库配置 | `{app-name}-datasource.yaml` | order-datasource.yaml |
| 中间件配置 | `{middleware-type}.yaml` | redis.yaml |
| 共享配置 | `{feature-name}.yaml` | common.yaml |

### 配置的优先级

```
命令行参数 > 环境变量 > application.yml > 共享配置
```

```yaml
# application.yml 中的 Nacos 配置会覆盖共享配置
spring:
  cloud:
    nacos:
      config:
        # 通过这个配置可以禁用远程配置
        enabled: true
        # 配置优先级：1（数字越大优先级越高）
        priority: 1
```

## 总结

Nacos 配置中心的核心价值：

```
配置统一管理 → 多环境隔离 → 热更新 → 版本回滚
```

**核心使用场景：**

- **开关配置**：功能上线/下线
- **参数调优**：连接池大小、超时时间
- **动态数据源**：根据配置切换数据库
- **白名单配置**：IP 白名单、业务白名单

**注意事项：**

- 配置变更后，需要关注 `@RefreshScope` 的生效时机
- 敏感配置（密码、密钥）建议加密存储
- 大规模配置变更时注意灰度发布

---

**留给你的问题：**

假设你在 Nacos 中修改了一个配置，但客户端没有收到通知（网络问题）。这时客户端用的是旧配置，但服务端已经是新配置了。

如果这个配置是一个限流阈值，客户端用的阈值是 100，服务端验证的阈值是 1000。会发生什么？

这涉及到客户端缓存和服务端一致性的问题，你有什么好方案吗？
