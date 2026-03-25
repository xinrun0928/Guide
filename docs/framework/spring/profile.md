# 环境隔离与多环境配置：@Profile

你有没有为不同环境写过大量 if-else？

```java
if ("dev".equals(env)) {
    // 开发环境配置
} else if ("prod".equals(env)) {
    // 生产环境配置
} else if ("test".equals(env)) {
    // 测试环境配置
}
```

代码越写越乱，环境切换越来越难。

Spring 的 `@Profile` 注解，让不同环境使用不同配置，互不干扰。

## @Profile 的本质

### 什么是 Profile？

Profile（环境配置）是一种将 Bean 和配置隔离的机制。只有激活特定 Profile 时，对应的 Bean 才会被创建。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Profile 隔离示意图                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  dev Profile           prod Profile           test Profile            │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐     │
│  │ DevDataSource   │   │ ProdDataSource  │   │ TestDataSource  │     │
│  │ DevCacheService │   │ ProdCacheService│   │ MockCacheService│     │
│  │ DevFilter       │   │ ProdFilter      │   │ TestFilter      │     │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘     │
│                                                                         │
│  同时只激活一个 Profile，只有该 Profile 的 Bean 会被创建                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 基本用法

```java
// 开发环境数据源
@Profile("dev")
@Configuration
public class DevDataSourceConfig {
    @Bean
    public DataSource devDataSource() {
        // 连接本地数据库
        return new HikariDataSource(/* localhost */);
    }
}

// 生产环境数据源
@Profile("prod")
@Configuration
public class ProdDataSourceConfig {
    @Bean
    public DataSource prodDataSource() {
        // 连接生产数据库
        return new HikariDataSource(/* 正式地址 */);
    }
}
```

## @Profile 的多种用法

### 标注在 @Configuration 类上

```java
@Configuration
@Profile("dev")
public class DevConfig {
    // 所有 @Bean 都属于 dev Profile
    @Bean
    public DataSource dataSource() { ... }
}
```

### 标注在 @Bean 方法上

```java
@Configuration
public class DataSourceConfig {

    @Bean
    @Profile("dev")
    public DataSource devDataSource() {
        return new DevDataSource();
    }

    @Bean
    @Profile("prod")
    public DataSource prodDataSource() {
        return new ProdDataSource();
    }

    @Bean
    @Profile("!prod")  // 非 prod 环境时创建
    public DataSource defaultDataSource() {
        return new DefaultDataSource();
    }
}
```

### 标注在 @Component 上

```java
@Component
@Profile("dev")
public class DevCacheService implements CacheService {
    // 只有 dev 环境才注册
}

@Service
@Profile("prod")
public class ProdCacheService implements CacheService {
    // 只有 prod 环境才注册
}
```

### 标注在 @Controller/@RestController 上

```java
@RestController
@Profile("dev")
public class DevAdminController {
    // 开发环境管理员接口
}

@RestController
@Profile("prod")
public class ProdAdminController {
    // 生产环境管理员接口（权限更严格）
}
```

### 标注在 @Repository 上

```java
@Repository
@Profile("dev")
public class DevUserRepository implements UserRepository {
    // 开发环境：使用日志记录所有查询
}

@Repository
@Profile("prod")
public class ProdUserRepository implements UserRepository {
    // 生产环境：优化查询性能
}
```

## Profile 表达式

### 多个 Profile

```java
// 满足任意一个即可
@Profile({"dev", "test"})
@Configuration
public class DevTestConfig {
}
```

### Profile 逻辑运算

```java
// AND：同时满足
@Profile("dev & mysql")  // 或使用 @Profile({"dev", "mysql"}) 并改写
public class DevMysqlConfig {
}

// NOT：反选
@Profile("!prod")  // 非生产环境
public class NonProdConfig {
}

// 组合
@Profile("dev & !test")
public class DevOnlyConfig {
}
```

## 激活 Profile

### 方式一：spring.profiles.active

```yaml
# application.yml
spring:
  profiles:
    active: dev

# 或
---
spring:
  config:
    activate:
      on-profile: dev
```

```java
// Spring Boot 启动类
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

// 在 IDE 中设置 VM 参数：
// -Dspring.profiles.active=dev
```

### 方式二：命令行参数

```bash
java -jar app.jar --spring.profiles.active=prod
```

### 方式三：环境变量

```bash
# Linux/Mac
export SPRING_PROFILES_ACTIVE=prod

# Windows
set SPRING_PROFILES_ACTIVE=prod

# Docker
docker run -e SPRING_PROFILES_ACTIVE=prod myapp:latest
```

### 方式四：JVM 系统属性

```java
System.setProperty("spring.profiles.active", "dev");
SpringApplication.run(Application.class, args);
```

### 方式五：web.xml（传统 Spring MVC）

```xml
&lt;context-param&gt;
    &lt;param-name&gt;spring.profiles.active&lt;/param-name&gt;
    &lt;param-value&gt;dev&lt;/param-value&gt;
&lt;/context-param&gt;
```

## 多 Profile 配置文件

### 文件命名规范

```
src/main/resources/
├── application.yml              # 通用配置（所有环境共享）
├── application-dev.yml           # 开发环境
├── application-test.yml         # 测试环境
├── application-prod.yml         # 生产环境
└── application-local.yml         # 本地环境（可选）
```

### 配置文件激活

```yaml
# application.yml - 主配置
spring:
  profiles:
    active: dev
    include: local  # 同时激活 dev 和 local
    exclude: test   # 排除某个 profile
```

### Spring Boot 3.x 语法

```yaml
# application.yml
spring:
  config:
    activate:
      on-profile: dev

# application-dev.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/dev
```

```yaml
# 主配置文件
spring:
  profiles:
    active: dev
    group:
      dev: common,dev
      prod: common,prod
```

## Profile 与 @Configuration

### @Profile 在自动配置中的使用

```java
// Spring Boot 自动配置类
@Configuration
@ConditionalOnClass(DataSource.class)
public class DataSourceAutoConfiguration {

    @Configuration
    @Profile("dev")
    public class DevDataSourceConfiguration {
        @Bean
        public DataSource dataSource() {
            return new EmbeddedDatabaseBuilder()
                .setType(EmbeddedDatabaseType.H2)
                .build();
        }
    }

    @Configuration
    @Profile("prod")
    public class ProdDataSourceConfiguration {
        @Bean
        @ConfigurationProperties("spring.datasource.hikari")
        public DataSource dataSource() {
            return new HikariDataSource();
        }
    }
}
```

### @ConditionalOnProfile

```java
// 自定义条件注解
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Conditional(ProfileCondition.class)
public @interface ConditionalOnProfile {
    String[] value();
}

// 条件实现
public class ProfileCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        AnnotationAttributes attributes = 
            MetadataUtils.attributesFor(metadata, ConditionalOnProfile.class);
        
        String[] profiles = attributes.getStringArray("value");
        Environment env = context.getEnvironment();
        
        for (String profile : profiles) {
            if (env.matchesProfiles(profile)) {
                return true;
            }
        }
        return false;
    }
}

// 使用
@Configuration
@ConditionalOnProfile("dev")
public class DevOnlyConfig {
}
```

## Profile 的加载顺序

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Profile 加载顺序                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. application.yml 中的 spring.profiles.active                        │
│         │                                                               │
│         ▼                                                               │
│  2. 命令行参数 --spring.profiles.active                                  │
│         │                                                               │
│         ▼                                                               │
│  3. 环境变量 SPRING_PROFILES_ACTIVE                                      │
│         │                                                               │
│         ▼                                                               │
│  4. JVM 系统属性 spring.profiles.active                                  │
│         │                                                               │
│         ▼                                                               │
│  5. Servlet/Filter 初始化参数（Web 应用）                                │
│                                                                         │
│  高优先级可以覆盖低优先级的配置                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 实际应用场景

### 场景一：不同环境的数据源

```java
@Configuration
public class DataSourceConfig {

    @Bean
    @Profile("dev")
    public DataSource devDataSource() {
        // 开发环境：H2 内存数据库
        return new EmbeddedDatabaseBuilder()
            .setType(EmbeddedDatabaseType.H2)
            .addScript("classpath:db/dev-schema.sql")
            .build();
    }

    @Bean
    @Profile("test")
    public DataSource testDataSource() {
        // 测试环境：MySQL 测试库
        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setUrl("jdbc:mysql://localhost:3306/test");
        ds.setUsername("test");
        ds.setPassword("test");
        return ds;
    }

    @Bean
    @Profile("prod")
    @ConfigurationProperties(prefix = "spring.datasource.hikari")
    public DataSource prodDataSource() {
        // 生产环境：HikariCP 连接池
        return new HikariDataSource();
    }
}
```

### 场景二：不同环境的缓存

```java
@Configuration
public class CacheConfig {

    @Bean
    @Profile("dev")
    public CacheManager devCacheManager() {
        // 开发环境：不使用缓存，方便调试
        return new NoOpCacheManager();
    }

    @Bean
    @Profile("prod")
    public CacheManager prodCacheManager() {
        // 生产环境：Redis 缓存
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofHours(1))
            .serializeValuesWith(
                SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer())
            );
        return RedisCacheManager.builder(redisConnectionFactory)
            .cacheDefaults(config)
            .build();
    }
}
```

### 场景三：不同环境的日志级别

```yaml
# application-dev.yml
logging:
  level:
    com.example: DEBUG
    org.springframework: INFO

# application-prod.yml
logging:
  level:
    com.example: WARN
    root: INFO
    org.springframework: WARN
```

### 场景四：测试环境使用 Mock

```java
@Configuration
@Profile("test")
public class TestMockConfig {

    @Bean
    @MockBean
    public PaymentService mockPaymentService() {
        return Mockito.mock(PaymentService.class);
    }

    @Bean
    public TestDataInitializer testDataInitializer() {
        return new TestDataInitializer();
    }
}
```

## @ActiveProfiles（测试）

```java
// 指定测试使用的 Profile
@ActiveProfiles("dev")
@SpringBootTest
public class DevIntegrationTest {
    // 使用 dev 环境的配置
}

@ActiveProfiles({"dev", "h2"})
@ExtendWith(SpringExtension.class)
class MultiProfileTest {
    // 同时激活多个 Profile
}
```

## 常见问题

### 1. 没有激活任何 Profile

```java
// 默认 Profile 是 default
// 如果没有激活任何 Profile，@Profile("default") 的 Bean 会被创建

@Bean
@Profile("default")
public DataSource defaultDataSource() {
    // 没有激活 Profile 时使用这个
}

// 等价于
@Bean
public DataSource defaultDataSource() {
    // 没有激活 Profile 时使用这个
}
```

### 2. 多个 Profile 冲突

```java
// 如果两个 @Bean 方法返回类型相同且没有明确的激活策略
// 可能导致冲突

// 解决：确保每个同类型 Bean 都有明确的 Profile
@Bean
@Profile("dev")
public DataSource devDataSource() { ... }

@Bean
@Profile("prod")
public DataSource prodDataSource() { ... }
```

### 3. Profile 与条件注解的优先级

```java
@Bean
@Profile("prod")
@ConditionalOnProperty(name = "app.feature.enabled")
public MyService myService() { ... }
// 需要同时满足 Profile=prod 且属性条件满足
```

## 面试核心问题

### Q1：@Profile 的作用？

`@Profile` 用于环境隔离，只有激活指定 Profile 时，对应的 Bean 才会被创建。适用于不同环境（dev、test、prod）使用不同配置的场景。

### Q2：如何激活 Profile？

1. 配置文件：`spring.profiles.active`
2. 命令行参数：`--spring.profiles.active=dev`
3. 环境变量：`SPRING_PROFILES_ACTIVE=dev`
4. `@ActiveProfiles`（测试）

### Q3：@Profile 和 @Conditional 的区别？

| 特性 | @Profile | @Conditional |
|-----|----------|--------------|
| 条件类型 | 环境激活 | 任意条件 |
| 灵活性 | 固定条件 | 可自定义 |
| 适用场景 | 环境隔离 | 更广泛的场景 |

---

**下节预告**：[Spring 5 新注解 @Indexed](/framework/spring/indexed) —— 理解 @Indexed 如何加速组件扫描。
