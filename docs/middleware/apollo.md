# Apollo 配置中心：让配置「活」起来

你刚上线了一个新功能，测试没问题。但运营说：「这个 Banner 文案要改一下」。

你改代码 → 重新打包 → 重新部署 → 重启服务 → 观察日志 → 确认没问题。

整个过程花了 30 分钟，运营等得不耐烦，你也累得够呛。

如果能直接在后台改配置，**点击保存，秒级生效，不需要重启服务**——你愿意试吗？

这就是 Apollo 配置中心做的事：**配置与代码分离，配置热更新，配置集中管理**。

## 为什么需要配置中心？

### 配置的「坏味道」

传统项目里，配置散落在各处：

```properties
# application.properties
jdbc.url=jdbc:mysql://localhost:3306/order
jdbc.username=root
jdbc.password=root123
redis.host=localhost
redis.port=6379
feature.banner.title=双十一大促
feature.max.retry=3
```

**问题来了：**

1. **环境不统一**：开发环境、测试环境、预发环境、生产环境，配置都不一样，怎么管理？
2. **修改要发版**：改一个字也要重新打包，在金融场景这是噩梦
3. **密码泄露风险**：配置里有数据库密码，开发人员都能看到
4. **配置回滚难**：改错了想回滚？只能翻 Git 历史

### 配置中心的解决思路

配置中心的核心理念：**配置是独立于代码的，配置是有版本的，配置是可控的**。

```
传统模式：
代码 + 配置 → 打包 → 部署 → 重启

配置中心模式：
代码 → 部署 → 运行中读取配置中心 → 动态更新
                              ↑
                        改配置，不改代码，不重启
```

## Apollo 架构：两层架构的精髓

Apollo 分为两层：**注册层**（Config Service）和**管理层**（Admin Service），这是它区别于其他配置中心的关键设计。

```
┌──────────────────────────────────────────────────────────────────┐
│                         Apollo 架构                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│                      ┌─────────────────┐                         │
│                      │      Portal      │  ← 配置管理界面         │
│                      │   (管理后台)      │    多环境统一管理        │
│                      └────────┬────────┘                         │
│                               │                                   │
│              ┌────────────────┼────────────────┐                │
│              │                 │                 │                │
│              ▼                 ▼                 ▼                │
│    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│    │  Admin Service  │ │  Admin Service  │ │  Admin Service  │   │
│    │    (DEV 环境)    │ │    (TEST 环境)  │ │   (PROD 环境)   │   │
│    │  管理配置的增删改  │ │  管理配置的增删改 │ │  管理配置的增删改  │   │
│    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘   │
│             │                    │                    │           │
│             └────────────────────┼────────────────────┘           │
│                                  ▼                                 │
│                        ┌─────────────────┐                        │
│                        │  Config Service  │  ← 客户端读取配置     │
│                        │   (配置读取服务)  │                        │
│                        └────────┬────────┘                        │
│                                 │                                   │
│                    ┌────────────┼────────────┐                    │
│                    ▼            ▼            ▼                    │
│              ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│              │ Client  │  │ Client  │  │ Client  │                │
│              │ (应用1) │  │ (应用2) │  │ (应用3) │                │
│              └─────────┘  └─────────┘  └─────────┘                │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Config Service：配置的「分发站」

Config Service 是客户端读取配置的入口，它的职责是：

1. **提供配置读取接口**：客户端通过 HTTP 长轮询拉取配置
2. **通知配置变更**：当配置被修改时，主动推送给客户端
3. **多实例部署**：高可用，支持水平扩展

### Admin Service：配置的「管理员」

Admin Service 的职责是：

1. **配置管理**：增删改查配置项
2. **环境隔离**：每个环境有独立的 Admin Service
3. **权限控制**：谁可以改配置、改哪些配置

### Portal：配置的「控制台」

Portal 是统一的管理界面，同时管理 DEV、TEST、PROD 等多个环境：

```java
// Portal 操作示例：修改一个配置
// 1. 在 Portal 选择环境和应用
// 2. 找到对应的 Namespace（配置集合）
// 3. 修改配置项，点击发布

// 假设修改前：
// feature.banner.title=双十一大促
// feature.max.retry=3

// 修改后：
// feature.banner.title=双十二年终盛典
// feature.max.retry=5

// 点击发布 → 配置立即生效 → 应用无需重启
```

## 配置热更新原理：长轮询的秘密

Apollo 的热更新核心是**长轮询（Long Polling）**，而不是推送。

```
传统推送方式的问题：
- 连接数多：每个客户端都和服务器保持长连接
- 推送压力大：服务器要主动推送，高并发下性能差
- 协议复杂：需要 WebSocket 或 Server-Sent Events

Apollo 的长轮询方式：
- 客户端主动拉：每个客户端定时（如 5 秒）拉取一次配置
- 响应可长可短：配置没变，服务器 Hold 请求 30 秒再返回
- 配置变了，服务器立即返回
```

```java
// Apollo Client 源码核心逻辑（简化版）
public class ApolloConfigClient {
    private static final long LONG_POLLING_INTERVAL = 5000; // 5 秒

    public void start() {
        // 启动一个线程，持续长轮询
        new Thread(() -> {
            while (true) {
                poll();
            }
        }).start();
    }

    private void poll() {
        // 带超时（30 秒）的 HTTP 请求
        // 如果配置没变，服务器会等 30 秒再返回
        // 如果配置变了，服务器立即返回
        HttpResponse response = httpClient.get(
            configServiceUrl + "/configs/" + appId,
            LONG_POLL_TIMEOUT_MS  // 30 秒
        );

        if (response.isModified()) {
            // 配置变了，触发回调
            notifyListeners(response.getConfig());
        }
        // 没变，继续下一次轮询
    }

    // 关键参数说明：
    // - 使用 HTTP 短连接，不需要维持长连接
    // - 服务端 Hold 请求，超时或配置变更时返回
    // - 网络断开时，客户端会立即收到超时，自动重试
}
```

**为什么用长轮询而不是推送？**

1. **兼容性**：HTTP 短连接，普通防火墙、代理都能过
2. **解耦**：Config Service 不需要维护大量长连接
3. **可靠**：客户端超时重试，保证最终一致

## 多环境与命名空间

### 环境隔离

Apollo 通过**环境**（Environment）实现物理隔离：

| 环境 | 说明 | 典型用途 |
|-----|------|---------|
| DEV | 开发环境 | 本地联调 |
| TEST | 测试环境 | QA 测试 |
| UAT | 预发环境 | 生产前最后验证 |
| PRO | 生产环境 | 正式用户 |

```java
// 客户端指定环境
// 方式一：JVM 参数
// -Denv=PRO

// 方式二：配置文件
// META-INF/app.properties
// apollo.meta=http://config-service-pro:8080
```

### 命名空间（Namespace）

一个应用有多个配置维度，Apollo 用 Namespace 组织：

```
应用：order-service
│
├── application (默认命名空间)
│   ├── jdbc.url
│   ├── redis.host
│   └── feature.max.retry
│
├── application-prod (关联到 application 的生产配置)
│   ├── jdbc.url (生产数据库地址，覆盖默认)
│   └── redis.host (生产 Redis，覆盖默认)
│
└── db-config (自定义命名空间，存放数据库相关配置)
    ├── connection.pool.size
    └── query.timeout
```

**Namespace 有什么用？**

1. **分类管理**：不同类型的配置放不同 Namespace
2. **继承覆盖**：application-prod 继承 application，部分覆盖
3. **公共配置**：多个应用共享同一个公共 Namespace（如中间件配置）

```java
// Apollo 的 Namespace 获取
// 1. 默认 Namespace：application
Config appConfig = ConfigService.getAppConfig();

// 2. 指定 Namespace
Config dbConfig = ConfigService.getConfig("db-config");

// 3. 监听配置变更
appConfig.addChangeListener(changeEvent -> {
    for (String key : changeEvent.changedKeys()) {
        System.out.println("配置变更: " + key + " = " +
            changeEvent.getNewValue(key));
    }
});
```

## Apollo vs Nacos vs Spring Cloud Config

| 维度 | Apollo | Nacos | Spring Cloud Config |
|-----|--------|-------|---------------------|
| **配置模型** | 应用 + Namespace + 配置项 | DataId + Group | Git 仓库 + 文件 |
| **架构复杂度** | 较高（多服务） | 简单（一体化） | 依赖 Git + Bus |
| **多环境支持** | 原生多环境 | 原生多环境 | 需要多个 Git 仓库 |
| **权限管理** | 细粒度权限 | 简单 | 无 |
| **灰度发布** | 支持 | 支持 | 不支持 |
| **客户端支持** | 多语言 | 多语言 | Java 为主 |
| **运维难度** | 较高 | 低 | 中 |

**选型建议：**

- **大厂场景、多团队协作** → Apollo（权限、审计、灰度完善）
- **快速上线、中小团队** → Nacos（开箱即用，运维简单）
- **已有 Spring Cloud 体系** → Spring Cloud Config（生态兼容）

## 实战：Spring Boot 集成 Apollo

### 1. 添加依赖

```xml
<dependency>
    <groupId>com.ctrip.framework.apollo</groupId>
    <artifactId>apollo-client</artifactId>
    <version>2.2.0</version>
</dependency>
```

### 2. 配置 application.yml

```yaml
apollo:
  # Apollo 配置中心地址
  meta: http://config-service:8080
  # 应用 ID（在 Apollo Portal 创建）
  app-id: order-service
  # 环境
  env: PRO
  # 集群（可选）
  cluster: default
  # 命名空间，默认 application
  namespaces: application,db-config
  # 开启配置变更监听
  auto-update-in-spring: true
```

### 3. 使用配置

```java
@RestController
@RequestMapping("/order")
public class OrderController {
    // @ApolloConfig 会自动注入 application 命名空间的配置
    @ApolloConfig
    private Config config;

    // @ApolloConfigChangeListener 监听配置变更
    @ApolloConfigChangeListener
    private void onConfigChange(ConfigChangeEvent changeEvent) {
        // 配置变更时，重新绑定 @Value 属性
        // Spring 会自动更新 Bean 的属性值
        System.out.println("配置变更: " + changeEvent.changedKeys());
    }

    @Value("${feature.banner.title:默认标题}")
    private String bannerTitle;

    @GetMapping("/banner")
    public String getBanner() {
        // 这个值会随着 Apollo 配置变更而自动更新
        // 不需要重启服务
        return bannerTitle;
    }

    // 如果配置项是 Map 或对象，可以用 @ConfigurationProperties
    @Bean
    public Config createConfig() {
        return config;
    }
}
```

### 4. 高级用法：动态刷新

```java
@RestController
// @RefreshScope 会让这个 Bean 在配置变更时重新创建
@RefreshScope
public class BannerController {
    @Value("${feature.banner.title:默认标题}")
    private String title;

    // 当 Apollo 修改 feature.banner.title 时
    // 这个方法返回的新值会自动更新
    @GetMapping("/banner")
    public String getBanner() {
        return title;
    }
}
```

## Apollo 的安全机制

### 1. 权限模型

```
组织 (Organization)
└── 项目 (App)
    ├── 环境 (Environment)
    │   └── Cluster
    │       └── Namespace
    │           └── Config
    │
    ├── 管理员 (AppMaster) - 管理项目配置
    ├── 运维 (DevOps) - 管理发布
    └── 开发 (Developer) - 只能读，发布需审批
```

### 2. 敏感配置加密

```java
// Portal 创建配置时，可以选择「加密」
// 加密后的配置在界面上显示为 *****
// 只有客户端解密后才能获取真实值

// Apollo 使用 AES 加密
// 秘钥由 Apollo 自己管理，客户端通过安全通道获取
```

## 面试高频问题

**Q: Apollo 为什么用长轮询而不是 WebSocket 推送？**

A: 长轮询的优势在于：
- 兼容性：基于 HTTP，防火墙、代理都支持
- 简单可靠：客户端超时重试即可，不需要维护长连接状态
- 性能：服务端不需要维持大量并发连接，减少资源消耗

**Q: 配置变更后，客户端是如何感知的？**

A: 三步走：
1. Config Service 感知到配置变更（Admin Service 通知）
2. 长轮询请求返回，客户端收到变更通知
3. 客户端拉取最新配置，触发 `ConfigChangeListener`

**Q: Apollo 如何保证配置一致性？**

A: 两层保障：
1. **配置存储**：MySQL 存储配置，Config Service 读取 MySQL
2. **配置缓存**：客户端本地有缓存，断网时使用本地缓存

**Q: Apollo 的灰度发布是什么？**

A: 灰度发布允许只让部分实例加载新配置，其他实例继续使用旧配置。适合新功能的「金丝雀验证」——先让 10% 用户试试，没问题再全量。

## 写在最后

Apollo 的价值不只是「改配置不用重启」，更重要的是**让配置变得可控、可追溯、可回滚**。

以前改配置靠人记，现在改配置靠系统——谁改了什么、什么时候改的、为什么改，全都有记录。

但配置中心解决的只是「改配置」的问题。如果你想追踪一次请求在多个服务间的流转，那需要另一个工具：**链路追踪**。

还记得我们之前聊过的 [SkyWalking](/middleware/skywalking) 吗？它能画出服务间的调用关系，告诉你慢在哪、卡在哪。

日志、链路、配置——这三个工具组合起来，就构成了完整的可观测性体系：**日志告诉你发生了什么，链路告诉你发生在哪，配置告诉你可以怎么改**。
