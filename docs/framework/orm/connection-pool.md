# 数据库连接池：性能优化的关键

你有没有算过，一个查询从发起到返回，需要多长时间？

```
建立连接：50-200ms
执行 SQL：5-20ms
关闭连接：10-50ms
─────────────────────
总计：65-270ms
```

**连接管理占了大部分时间！**

数据库连接池就是来解决这个问题的——**复用连接，减少连接开销**。

## 为什么需要连接池？

### 没有连接池

```
请求 1：创建连接 ──→ 查询 ──→ 关闭连接
请求 2：创建连接 ──→ 查询 ──→ 关闭连接
请求 3：创建连接 ──→ 查询 ──→ 关闭连接
...
请求 N：创建连接 ──→ 查询 ──→ 关闭连接
```

**每个请求都要创建和关闭连接**，性能损耗巨大。

### 有连接池

```
连接池：[连接1] [连接2] [连接3]
        ─────────────────────────
请求 1：获取连接 ──→ 查询 ──→ 归还连接
请求 2：获取连接 ──→ 查询 ──→ 归还连接
请求 3：获取连接 ──→ 查询 ──→ 归还连接
...
请求 N：获取连接 ──→ 查询 ──→ 归还连接
```

**连接复用，性能提升 10-100 倍。**

## 连接池核心原理

```
┌─────────────────────────────────────────────────────────────────┐
│                      连接池工作原理                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  初始状态                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  连接池（容量: 10）                                       │   │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                    │   │
│  │  │conn│ │conn│ │conn│ │conn│ │conn│ ...              │   │
│  │  │ 1  │ │ 2  │ │ 3  │ │ 4  │ │ 5  │                    │   │
│  │  └────┘ └────┘ └────┘ └────┘ └────┘                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  使用中                                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  连接池（可用: 5 / 总数: 10）                              │   │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                    │   │
│  │  │使用│ │使用│ │使用│ │使用│ │空闲│                    │   │
│  │  │ 1  │ │ 2  │ │ 3  │ │ 4  │ │ 5  │                    │   │
│  │  └────┘ └────┘ └────┘ └────┘ └────┘                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 主流连接池对比

| 连接池 | 出品方 | 性能 | 功能 | 维护 |
|-------|--------|------|------|------|
| **HikariCP** | Spring | 最高 | 基础 | 活跃 |
| **Druid** | 阿里 | 高 | 丰富 | 活跃 |
| **DBCP2** | Apache | 中等 | 基础 | 一般 |
| **C3P0** | 开源 | 较低 | 丰富 | 停止维护 |
| **HikariCP (Spring Boot 2.x 默认)** | - | 最高 | 基础 | 活跃 |

### 性能对比（来自官方测试）

```
HikariCP   ████████████████████████████████ 80,000+ QPS
Druid      ████████████████████████████████ 70,000+ QPS
DBCP2      ██████████████████████           50,000+ QPS
C3P0       ████████████████                   30,000+ QPS
```

## HikariCP 配置

### Spring Boot 默认配置

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/test
    username: root
    password: root
    # HikariCP 是默认连接池，无需额外配置
```

### 完整配置

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/test?useUnicode=true&characterEncoding=utf-8&useSSL=false&serverTimezone=Asia/Shanghai
    username: root
    password: root
    driver-class-name: com.mysql.cj.jdbc.Driver

    # HikariCP 配置
    hikari:
      # 连接池名称
      pool-name: HikariCP-Pool

      # 最小空闲连接数
      minimum-idle: 5

      # 最大连接数
      maximum-pool-size: 20

      # 连接最大生命周期（毫秒）
      max-lifetime: 1800000  # 30 分钟

      # 连接超时（毫秒）
      connection-timeout: 30000  # 30 秒

      # 空闲超时（毫秒）
      idle-timeout: 600000  # 10 分钟

      # 连接测试查询
      connection-test-query: SELECT 1
```

### 配置参数详解

| 参数 | 说明 | 默认值 | 建议 |
|-----|------|--------|-----|
| `pool-name` | 连接池名称 | - | 根据应用命名 |
| `minimum-idle` | 最小空闲连接 | 10 | 根据并发量设置 |
| `maximum-pool-size` | 最大连接数 | 10 | CPU 核心数 * 2 |
| `max-lifetime` | 连接最大生命周期 | 1800000 | 小于数据库超时 |
| `connection-timeout` | 获取连接超时 | 30000 | 根据业务容忍度 |
| `idle-timeout` | 空闲连接超时 | 600000 | 根据访问频率 |

## Druid 配置

### Maven 依赖

```xml
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>druid-spring-boot-starter</artifactId>
    <version>1.2.20</version>
</dependency>
```

### Druid 配置

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/test
    username: root
    password: root
    driver-class-name: com.mysql.cj.jdbc.Driver

    # Druid 连接池配置
    druid:
      # 初始化连接数
      initial-size: 5

      # 最大连接数
      max-active: 20

      # 最小空闲连接
      min-idle: 5

      # 获取连接最大等待时间（毫秒）
      max-wait: 60000

      # 连接检测周期（毫秒）
      time-between-eviction-runs-millis: 60000

      # 连接最小生存时间（毫秒）
      min-evictable-idle-time-millis: 300000

      # 检测连接是否有效
      validation-query: SELECT 1

      # 是否在获取连接时检测
      test-while-idle: true

      # 是否在获取连接时检测
      test-on-borrow: false

      # 是否在归还连接时检测
      test-on-return: false

      # 监控配置
      stat-view-servlet:
        enabled: true
        url-pattern: /druid/*
      filter:
        stat:
          enabled: true
          log-slow-sql: true
          slow-sql-millis: 2000
```

### Druid 监控页面

```
访问地址：http://localhost:8080/druid/
```

Druid 提供强大的监控功能：

- SQL 执行监控
- 慢 SQL 记录
- 连接池状态
- URI 监控

## 连接池工作流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    连接获取流程                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 请求获取连接                                                 │
│       │                                                         │
│       ▼                                                         │
│  2. 检查连接池是否有空闲连接？                                    │
│       │                                                         │
│       ├── 有 ──→ 获取连接 ──→ 检查连接有效性？                   │
│       │                │                                       │
│       │                ├── 有效 ──→ 返回连接                   │
│       │                │                                       │
│       │                └── 无效 ──→ 销毁 ──→ 创建新连接 ──→ 返回│
│       │                                                         │
│       └── 没有 ──→ 检查连接数是否已达上限？                      │
│                       │                                         │
│                       ├── 未达上限 ──→ 创建新连接 ──→ 返回       │
│                       │                                         │
│                       └── 已达上限 ──→ 等待可用连接               │
│                                         │                       │
│                                         └── 超时 ──→ 抛出异常  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 连接池调优

### 1. 估算连接数

```
最佳连接数 = ((核心数 * 2) + 磁盘数)
```

例如：4 核 CPU + 1 块 SSD = 9 个连接

### 2. 根据并发量调整

```yaml
# 低并发场景
hikari:
  maximum-pool-size: 10

# 高并发场景
hikari:
  maximum-pool-size: 50
```

### 3. 监控调优

```java
// HikariCP 监控
HikariDataSource ds = (HikariDataSource) dataSource;
HikariPoolMXBean poolMXBean = ds.getHikariPoolMXBean();

System.out.println("活跃连接: " + poolMXBean.getActiveConnections());
System.out.println("空闲连接: " + poolMXBean.getIdleConnections());
System.out.println("总连接数: " + poolMXBean.getTotalConnections());
System.out.println("等待线程: " + poolMXBean.getThreadsAwaitingConnection());
```

### 4. Druid 监控配置

```java
@Configuration
public class DruidConfig {

    @Bean
    public ServletRegistrationBean&lt;DruidStatViewServlet&gt; druidStatViewServlet() {
        ServletRegistrationBean&lt;DruidStatViewServlet&gt; bean =
            new ServletRegistrationBean<>(
                new DruidStatViewServlet(), "/druid/*");
        // 设置登录信息
        bean.addInitParameter("loginUsername", "admin");
        bean.addInitParameter("loginPassword", "admin");
        return bean;
    }

    @Bean
    public FilterRegistrationBean&lt;DruidStatFilter&gt; druidStatFilter() {
        FilterRegistrationBean&lt;DruidStatFilter&gt; bean =
            new FilterRegistrationBean<>(
                new DruidStatFilter());
        bean.addUrlPatterns("/*");
        bean.addInitParameter("exclusions", "*.js,*.gif,*.jpg,*.png,*.css,*.ico,/druid/*");
        return bean;
    }
}
```

## 常见问题

### 问题一：连接池耗尽

```
Caused by: java.sql.SQLTransientConnectionException:
  HikariPool - Connection is not available, request timed out after 30000ms.
```

**原因**：
- 连接泄漏（获取后未归还）
- 连接数设置过小
- 数据库连接超时

**解决方案**：
```yaml
hikari:
  maximum-pool-size: 30
  leak-detection-threshold: 60000  # 检测连接泄漏
```

### 问题二：连接泄漏

```java
Connection conn = null;
try {
    conn = dataSource.getConnection();
    // 业务代码
} finally {
    // 忘记关闭
    // conn.close();
}
```

**解决方案**：
```java
// 方式一：使用 try-with-resources
try (Connection conn = dataSource.getConnection()) {
    // 业务代码
}  // 自动关闭

// 方式二：确保 finally 中关闭
try {
    conn = dataSource.getConnection();
} finally {
    if (conn != null) {
        conn.close();  // 归还到连接池
    }
}
```

### 问题三：连接超时

```yaml
hikari:
  connection-timeout: 10000  # 10 秒超时
  max-lifetime: 1800000      # 30 分钟最大生命周期
```

## Spring Boot 中的 HikariCP

### 方式一：直接使用（推荐）

```java
@Service
public class UserService {

    @Autowired
    private DataSource dataSource;

    public User findById(Long id) {
        try (Connection conn = dataSource.getConnection()) {
            // 使用连接
        }
    }
}
```

### 方式二：JdbcTemplate（推荐）

```java
@Service
public class UserService {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    public User findById(Long id) {
        String sql = "SELECT * FROM user WHERE id = ?";
        return jdbcTemplate.queryForObject(sql, new BeanPropertyRowMapper&lt;&gt;(User.class), id);
    }
}
```

---

## 面试高频问题

### Q1：连接池的工作原理？

预先创建一定数量的连接放到池中，使用时从池中获取，使用完毕后归还到池中，避免频繁创建和销毁连接。

### Q2：HikariCP 为什么性能最高？

- 使用 `ConcurrentBag` 实现高性能并发集合
- 使用 `FastStatementList` 优化 PreparedStatement 缓存
- 极致的字节码优化
- 最小化的同步控制

### Q3：如何排查连接池问题？

1. 开启连接泄漏检测：`leak-detection-threshold`
2. 查看 Druid/HikariCP 监控
3. 检查 SQL 执行时间
4. 检查连接获取等待时间

---

## 最佳实践

1. **使用连接池**：必须使用，不要手动管理连接
2. **合理配置**：根据并发量设置连接数
3. **监控**：接入 Druid 监控或 Micrometer
4. **关闭连接**：使用 try-with-resources 确保关闭
5. **连接测试**：配置 `validation-query` 检测无效连接

---

## 思考题

一个系统高峰期 QPS 1000，每个请求需要 1 个数据库连接。

- 如果每个请求平均占用连接 50ms，最多需要多少连接？
- 如果实际只配置了 10 个连接，会有什么问题？
- 如何验证连接池配置是否合理？
