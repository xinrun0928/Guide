# Nacos 配置管理：热更新与命名空间隔离

你有没有想过这个问题：

凌晨 2 点，你发现生产环境的数据库连接池配置有问题。

传统方案：改配置 → 重启所有应用实例 → 耗时 30 分钟 → 故障影响扩大。

Nacos 方案：改配置 → 应用自动感知 → 30 秒内生效 → 故障快速恢复。

这就是 Nacos 配置管理的价值——**配置热更新**。

## 配置管理的核心

配置管理的本质是：**程序配置与代码分离，支持运行时修改**。

```
代码：业务逻辑，保持稳定
配置：运行时参数，可以动态调整
```

## 配置的数据模型

Nacos 配置有三个核心概念：

```java
public class ConfigInfo {
    String dataId;      // 配置 ID
    String group;        // 分组（默认 DEFAULT_GROUP）
    String namespace;    // 命名空间（默认 public）
    String content;     // 配置内容
    String type;        // 配置格式（JSON/YAML/PROPERTIES）
    long   md5;         // 配置内容的 MD5
    long   version;     // 版本号
}
```

### DataId

配置的唯一标识，格式：`${prefix}-${spring.profile.active}.${file-extension}`

```yaml
# 假设
spring.application.name=user-service
spring.profiles.active=prod
file-extension=yaml

# DataId = user-service-prod.yaml
```

### Group

分组，用于区分不同环境或用途：

```java
// 默认分组
group = "DEFAULT_GROUP"

// 自定义分组
group = "PROD_GROUP"      // 生产环境
group = "DEV_GROUP"       // 开发环境
group = "UAT_GROUP"       // 验收环境
```

### Namespace

命名空间，用于隔离不同租户或项目：

```yaml
# namespace: dev
# namespace: test
# namespace: prod
```

## 配置热更新

### 原理解析

```
1. 应用启动时，拉取配置到本地缓存
2. Nacos 配置变更
3. Nacos 推送变更通知给客户端
4. 客户端收到通知，重新拉取配置
5. 客户端刷新 @Value 或 @ConfigurationProperties
```

### 代码示例

```java
// 方式一：@NacosConfigurationProperties
@Data
@Component
@NacosConfigurationProperties(
    dataId = "user-service.yaml",
    group = "DEFAULT_GROUP",
    autoRefreshed = true  // 开启自动刷新
)
public class UserProperties {
    private int maxConnections;
    private String databaseUrl;
    private int timeout;
}

// 方式二：@NacosValue
@RestController
public class UserController {

    @NacosValue(value = "${user.max-connections:10}", autoRefreshed = true)
    private int maxConnections;

    @GetMapping("/config")
    public String getConfig() {
        return "maxConnections = " + maxConnections;
    }
}
```

### 监听配置变更

```java
@Component
public class NacosConfigListener {

    @NacosConfigListener(dataId = "user-service.yaml", group = "DEFAULT_GROUP")
    public void onConfigChange(String newContent) {
        System.out.println("配置变更: " + newContent);
        // 自定义处理逻辑
    }
}
```

## 命名空间隔离

### 为什么要隔离？

```
场景一：dev/prod 环境隔离
场景二：不同项目/团队的配置隔离
场景三：敏感配置与非敏感配置隔离
```

### Namespace 使用

```yaml
# application.yml
spring:
  cloud:
    nacos:
      config:
        server-addr: localhost:8848
        namespace: prod  # 指定命名空间
        group: PROD_GROUP # 指定分组
        file-extension: yaml
```

```java
// 代码中指定命名空间
@GetMapping("/namespace")
public String getNamespace(
        @NacosInjected(namespace = "prod") NamingService namingService) {
    // 使用指定命名空间的服务发现
}
```

### 多环境配置优先级

```
同命名空间内：dev > test > prod（profiles.active）
同 profile 内：dev namespace > public namespace
```

## 多配置共享

### shared-dataids

```yaml
# application.yml
spring:
  cloud:
    nacos:
      config:
        shared-dataids: common.yaml,redis.yaml
        refreshable-dataids: common.yaml
```

### extends-dataids

```yaml
# 从公共配置扩展
spring:
  cloud:
    nacos:
      config:
        extends-dataids: common.yaml
        refreshable-dataids: common.yaml
```

## 配置发布与管理

### Nacos 控制台

```
1. 登录 Nacos 控制台（默认账号密码：nacos/nacos）
2. 进入「配置管理」→「配置列表」
3. 点击「+」创建新配置
4. 填写 DataId、Group、配置内容
5. 点击「发布」
```

### 命令行发布

```bash
# 发布配置
curl -X POST "http://localhost:8848/nacos/v1/cs/configs" \
    -d "dataId=user-service.yaml" \
    -d "group=DEFAULT_GROUP" \
    -d "content=maxConnections=100&databaseUrl=jdbc:mysql://localhost:3306"

# 获取配置
curl "http://localhost:8848/nacos/v1/cs/configs?dataId=user-service.yaml&group=DEFAULT_GROUP"

# 监听配置变更
curl "http://localhost:8848/nacos/v1/cs/configs?listened=true&dataId=user-service.yaml&group=DEFAULT_GROUP"
```

### SDK 发布

```java
// Java SDK 方式
ConfigService configService = NacosFactory.createConfigService("localhost:8848");

// 发布配置
configService.publishConfig("user-service.yaml", "DEFAULT_GROUP",
    "maxConnections=100\ndatabaseUrl=jdbc:mysql://localhost:3306");

// 获取配置
String content = configService.getConfig("user-service.yaml", "DEFAULT_GROUP", 5000);

// 监听配置变更
configService.addListener("user-service.yaml", "DEFAULT_GROUP", new Listener() {
    @Override
    public void receiveConfigInfo(String configInfo) {
        System.out.println("配置变更: " + configInfo);
    }

    @Override
    public Executor getExecutor() {
        return Executors.newSingleThreadExecutor();
    }
});
```

## 总结

Nacos 的配置管理，解决了分布式系统的配置难题：

- **热更新**：修改配置无需重启应用
- **命名空间隔离**：dev/prod 分离，多租户隔离
- **多配置共享**：公共配置复用
- **统一管理**：控制台 + API + SDK

**面试追问方向：**
- Nacos 配置变更是如何推送到客户端的？
- 配置热更新时，Spring Bean 是如何刷新的？
- 如果 Nacos Server 不可用，客户端会怎样？
- 如何实现配置变更的灰度发布？