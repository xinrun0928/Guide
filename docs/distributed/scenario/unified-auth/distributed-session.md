# 分布式 Session：Spring Session + Redis 方案

你有没有遇到过这种情况：本地开发好好的，部署到生产环境后，用户登录后总是「掉线」？

刷新一次好了，再刷新又掉了。查日志，没报错；查 Session，没问题。

问题出在哪？

大概率是——**你的 Session 没有共享**。

## Session 共享的问题

在单体架构下，Session 存在单机内存中：

```
用户登录 → Session 存入 Server A 的内存
用户请求 → Server A 从内存取 Session → 正常
```

但在集群环境下：

```
用户登录 → Session 存入 Server A 的内存
用户请求 → 负载均衡到 Server B → Server B 没有这个 Session → 掉线！
```

Server B 根本不知道用户登录过，因为 Session 在 Server A 的内存里，Server B 访问不到。

## Spring Session 的核心思想

解决思路很简单：**不要把 Session 存在 JVM 内存里，存到一个所有服务都能访问的地方。**

Spring Session 就是干这个的——**将 Session 存储从 JVM 内存移到 Redis**。

```
用户登录 → Session 存入 Redis
用户请求 → 任意 Server 从 Redis 取 Session → 正常
```

## Spring Session 的使用

### 引入依赖

```xml
<dependency>
    <groupId>org.springframework.session</groupId>
    <artifactId>spring-session-data-redis</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

### 开启 Redis Session

```java
@SpringBootApplication
@EnableRedisHttpSession(maxInactiveIntervalInSeconds = 3600)
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

`maxInactiveIntervalInSeconds = 3600` 设置 Session 过期时间为 1 小时。

就这样，Spring Session 会自动把 Session 存入 Redis，后续的集群部署无需任何代码改动。

### Cookie 配置

Session 共享后，还需要配置 Cookie 的相关属性：

```yaml
server:
  servlet:
    session:
      cookie:
        name: SESSIONID
        http-only: true      # 防止 XSS 攻击
        secure: false        # 生产环境设为 true，强制 HTTPS
        same-site: Lax        # CSRF 防护
```

| 属性 | 说明 | 推荐值 |
|-----|------|--------|
| http-only | JS 无法读取 Cookie | true |
| secure | 只在 HTTPS 下传输 | 生产环境 true |
| same-site | CSRF 防护 | Lax 或 Strict |

## Spring Session 的实现原理

Spring Session 为什么这么神奇？核心在于**Filter 拦截 + Session 替换**。

### 请求处理流程

```
请求到达 → DelegatingFilterProxy 拦截
→ SessionRepositoryFilter 处理
→ 从 Redis 读取/创建 Session
→ 将 Spring 的 Session 实现（RedisSession）绑定到 Request
→ 业务代码通过 HttpServletRequest.getSession() 获取
```

### 核心代码

Spring Session 的核心是 `SessionRepositoryFilter`：

```java
public class SessionRepositoryFilter<S extends Session>
        extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) {
        // 用自定义的 Session 包装原始 Request
        SessionRepositoryRequestWrapper wrappedRequest =
            new SessionRepositoryRequestWrapper(request, this.sessionRepository);
        // 后续代码通过 wrappedRequest.getSession() 获取 Redis 中的 Session
        filterChain.doFilter(wrappedRequest, response);
    }
}
```

`SessionRepositoryRequestWrapper` 重写了 `getSession()` 方法，不再从 JVM 内存取，而是从 Redis 读写。

## Session 数据序列化

Session 数据从 JVM 内存移到 Redis，需要序列化。Spring Session 支持多种序列化方式：

### JSON vs Java 序列化

| 序列化方式 | 优点 | 缺点 |
|----------|------|------|
| Java 序列化 | 自动、类型安全 | 跨语言不兼容、安全漏洞 |
| JSON 序列化 | 跨语言兼容、可读性好 | 需要手动处理类型 |

生产环境推荐使用 JSON 序列化：

```java
@Configuration
public class SessionConfig {

    @Bean
    public RedisSerializer&lt;Object&gt; springSessionDefaultRedisSerializer() {
        return new GenericJackson2JsonRedisSerializer();
    }
}
```

JSON 序列化后，Session 数据在 Redis 中是明文的，可以直接用 Redis CLI 查看和调试。

## 集群部署架构

完整的集群部署架构是这样的：

```
                    ┌─────────────────┐
                    │     Nginx        │
                    │  (负载均衡)       │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Tomcat A     │    │  Tomcat B     │    │  Tomcat C     │
│  (实例 1)      │    │  (实例 2)      │    │  (实例 3)      │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                    ┌────────▼────────┐
                    │      Redis      │
                    │  (Session 存储)  │
                    └─────────────────┘
```

三个 Tomcat 实例共享同一个 Redis。用户无论访问哪个实例，都能获取到自己的 Session。

## Session 过期策略

### Redis TTL vs Session 超时同步

Spring Session 创建 Session 时，会同时设置两个过期时间：

1. **Redis Key 的 TTL**：由 `maxInactiveIntervalInSeconds` 控制
2. **Session 的 maxInactiveInterval**：Spring Session 的业务逻辑过期时间

两者应该保持一致，否则可能出现 Redis Key 已过期但 Session 业务逻辑还未过期的情况。

```yaml
spring:
  session:
    timeout: 3600s      # Session 业务过期时间
  redis:
    timeout: 3600s     # Redis 连接超时（不是 TTL）
```

## 面试追问方向

- Spring Session 如何实现集群环境下 Session 共享？（答：通过 Filter 拦截请求，用 Redis 替换 JVM 内存存储）
- Session 数据量大时有什么问题？（答：Redis 内存占用增加，网络开销增大，建议 Session 数据尽量精简）
- 如何处理 Session 序列化失败？（答：避免存储不可序列化的对象，使用 JSON 序列化提高兼容性）
- Spring Session 和 JWT 相比有什么优劣？（答：Session 有状态管理更方便，但需要 Redis 支持；JWT 无状态但撤销困难）

## 小结

Spring Session + Redis 是解决分布式 Session 共享的成熟方案。它对业务代码几乎没有侵入，你甚至不需要知道 Session 存在了 Redis 里——一切都是透明的。

但要注意，Session 数据要尽量精简，避免存储大对象。同时记得设置合理的过期时间，既要保证用户体验，也要控制 Redis 内存占用。

下一次遇到「集群环境下用户总是掉线」的问题，记得检查 Session 是否共享。
