# SQL 性能分析：让你的 SQL 无处遁形

你有没有遇到过这种情况：

接口响应慢，查日志发现某条 SQL 跑了 5 秒；
DBA 告诉你某个查询走了全表扫描；
但你不知道是哪里出了问题。

MyBatis Plus 的**SQL 分析打印**和**性能分析插件**，就是来解决这个问题的——**让你看清每一条 SQL 的执行情况**。

## SQL 分析的必要性

```
┌─────────────────────────────────────────────────────────────────┐
│                    SQL 性能问题来源                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 慢查询                                                        │
│     ├── 缺少索引                                                  │
│     ├── 索引失效                                                  │
│     └── 查询条件不合理                                            │
│                                                                 │
│  2. N+1 问题                                                      │
│     ├── 嵌套查询                                                  │
│     └── 循环查询                                                  │
│                                                                 │
│  3. 全表扫描                                                      │
│     ├── 查询条件不命中索引                                         │
│     └── 数据量过小（MySQL 优化器不走索引）                        │
│                                                                 │
│  4. 锁等待                                                        │
│     ├── 长事务                                                    │
│     └── 并发更新                                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## MyBatis Plus SQL 分析

### 1. 控制台打印 SQL

```yaml
mybatis-plus:
  configuration:
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
```

执行后，控制台会打印 SQL：

```
DEBUG | ==>  Preparing: SELECT * FROM user WHERE deleted = 0 AND status = ? 
DEBUG | ==> Parameters: 1(Integer)
DEBUG | <==      Total: 1
```

### 2. 配置日志级别

```yaml
logging:
  level:
    com.example.mapper: DEBUG      # 打印 SQL
    com.baomidou.mybatisplus: INFO  # MyBatis Plus 日志
```

## 性能分析插件

### 1. 添加依赖

```xml
<dependency>
    <groupId>com.baomidou</groupId>
    <artifactId>mybatis-plus-extension</artifactId>
    <version>3.5.5</version>
</dependency>
```

### 2. 配置性能分析插件

```java
@Configuration
public class MyBatisPlusConfig {

    @Bean
    public PerformanceInterceptor performanceInterceptor() {
        PerformanceInterceptor interceptor = new PerformanceInterceptor();

        // SQL 执行最大时间（毫秒），超过则打印日志
        interceptor.setMaxTime(3000L);

        // 是否格式化 SQL
        interceptor.setFormat(true);

        // 是否写入日志文件
        interceptor.setWriteInLog(true);

        return interceptor;
    }
}
```

### 3. 执行效果

```
[performance]  Inelct SQL  Cost: 1234 ms, ID: com.example.mapper.UserMapper.selectById
SELECT * FROM user WHERE id = ?
```

### 4. 配置多个拦截器

```java
@Bean
public MybatisPlusInterceptor mybatisPlusInterceptor() {
    MyBatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

    // 1. 多租户插件
    interceptor.addInnerInterceptor(new TenantLineInnerInterceptor(
        new MyTenantLineHandler()
    ));

    // 2. 分页插件
    interceptor.addInnerInterceptor(new PaginationInnerInterceptor());

    // 3. 乐观锁插件
    interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());

    return interceptor;
}

@Bean
public PerformanceInterceptor performanceInterceptor() {
    PerformanceInterceptor interceptor = new PerformanceInterceptor();
    interceptor.setMaxTime(3000L);
    interceptor.setFormat(true);
    return interceptor;
}
```

## SQL 分析器 SqlExplainInterceptor

### 配置

```java
@Configuration
public class MyBatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

        // SQL 分析拦截器（会抛出异常）
        interceptor.addInnerInterceptor(new SqlExplainInterceptor());

        return interceptor;
    }
}
```

### 执行效果

```java
// 执行全表扫描的 SQL
List&lt;User&gt; users = userMapper.selectList(wrapper);

// 如果 SQL 被判定为全表扫描，会抛出异常
throw new CannotExecuteSqlException("SQL 未使用索引，执行全表扫描!");
```

### 配合性能分析

```java
@Bean
public MybatisPlusInterceptor mybatisPlusInterceptor() {
    MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

    // 添加 SQL 分析拦截器
    SqlExplainInterceptor sqlExplainInterceptor = new SqlExplainInterceptor();
    // 设置是否抛出异常（生产环境建议 false）
    sqlExplainInterceptor.setBlockAttack(true);
    interceptor.addInnerInterceptor(sqlExplainInterceptor);

    return interceptor;
}
```

## 实战：分析慢查询

### 场景：用户列表接口慢

```java
@GetMapping("/users")
public List&lt;User&gt; getUsers(String name, Integer status, String orderBy) {
    LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
    if (name != null) {
        wrapper.like(User::getName, name);
    }
    if (status != null) {
        wrapper.eq(User::getStatus, status);
    }
    if (orderBy != null) {
        wrapper.orderByDesc(orderBy);
    }
    return userMapper.selectList(wrapper);
}
```

### 问题分析

1. **开启 SQL 日志**

```yaml
mybatis-plus:
  configuration:
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
```

2. **查看执行的 SQL**

```
DEBUG | ==>  Preparing: SELECT id, name, email, status, create_time
                           FROM user
                           WHERE deleted = 0
                           AND name LIKE CONCAT('%', ?, '%')
                           AND status = ?
DEBUG | ==> Parameters: Tom(String), 1(Integer)
DEBUG | <==      Total: 150
```

3. **分析执行计划**

```sql
EXPLAIN SELECT id, name, email, status, create_time
FROM user
WHERE deleted = 0
AND name LIKE CONCAT('%', 'Tom', '%')
AND status = 1;
```

结果：

```
id | select_type | table | type   | key       | rows  | Extra
---|-------------|-------|--------|-----------|-------|-------
1  | SIMPLE     | user  | ALL    | NULL      | 10000 | Using where
```

**问题发现**：`type = ALL` 表示全表扫描！

4. **优化建议**

```
问题：
1. name 使用 LIKE '%Tom%'，导致索引失效
2. status 字段可能有索引但效果不佳

优化方案：
1. 如果搜索频率高，考虑全文索引
2. 使用 Elasticsearch
3. 或者使用前缀匹配 LIKE 'Tom%'
```

## 常用分析命令

### EXPLAIN

```sql
-- 分析 SQL 执行计划
EXPLAIN SELECT * FROM user WHERE id = 1;

-- 详细分析
EXPLAIN ANALYZE SELECT * FROM user WHERE id = 1;
```

### SHOW PROFILE

```sql
-- 开启性能分析
SET profiling = 1;

-- 执行 SQL
SELECT * FROM user WHERE id = 1;

-- 查看分析结果
SHOW PROFILES;
SHOW PROFILE FOR QUERY 1;
```

### 慢查询日志

```sql
-- 查看慢查询阈值
SHOW VARIABLES LIKE 'slow_query_log';

-- 设置慢查询阈值
SET GLOBAL long_query_time = 1;

-- 查看慢查询日志
SHOW VARIABLES LIKE 'slow_query_log_file';
```

## 日志配置

### Log4j2 配置

```xml
<Loggers>
    <Logger name="com.example.mapper" level="DEBUG"/>
    <Logger name="com.baomidou.mybatisplus" level="DEBUG"/>
</Loggers>
```

### Logback 配置

```xml
<logger name="com.example.mapper" level="DEBUG"/>
<logger name="com.baomidou.mybatisplus" level="DEBUG"/>
```

### 生产环境配置

```yaml
spring:
  profiles:
    active: prod

---
spring:
  config:
    activate:
      on-profile: prod

mybatis-plus:
  configuration:
    # 生产环境关闭 SQL 日志
    log-impl: org.apache.ibatis.logging.nologging.NoLoggingImpl
```

## 常见问题

### 问题一：性能分析影响性能

```java
// 性能分析本身也有性能损耗
// 生产环境建议关闭

@Bean
@Profile("dev")  // 只在开发环境启用
public PerformanceInterceptor performanceInterceptor() {
    return new PerformanceInterceptor();
}
```

### 问题二：SQL 日志太多

```java
// 只打印慢 SQL
@Bean
@Profile("dev")
public PerformanceInterceptor performanceInterceptor() {
    PerformanceInterceptor interceptor = new PerformanceInterceptor();
    interceptor.setMaxTime(1000L);  // 超过 1 秒才打印
    return interceptor;
}
```

### 问题三：参数值不显示

```java
configuration:
  log-impl: org.apache.ibatis.logging.slf4j.Slf4jImpl

# 配置 SLF4J
logging:
  level:
    com.example.mapper: DEBUG
```

## 完整的开发环境配置

```yaml
spring:
  profiles:
    active: dev

---
spring:
  config:
    activate:
      on-profile: dev

mybatis-plus:
  configuration:
    # 开启 SQL 日志
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
    # 开启下划线转驼峰
    map-underscore-to-camel-case: true

logging:
  level:
    com.example.mapper: DEBUG
    com.baomidou.mybatisplus: DEBUG
```

```java
@Configuration
@Profile("dev")
public class MyBatisPlusDevConfig {

    @Bean
    public PerformanceInterceptor performanceInterceptor() {
        PerformanceInterceptor interceptor = new PerformanceInterceptor();
        interceptor.setMaxTime(1000L);
        interceptor.setFormat(true);
        return interceptor;
    }

    @Bean
    public SqlExplainInterceptor sqlExplainInterceptor() {
        SqlExplainInterceptor interceptor = new SqlExplainInterceptor();
        interceptor.setBlockAttack(false);  // 开发环境不阻断
        return interceptor;
    }
}
```

---

## 面试高频问题

### Q1：如何排查慢查询？

1. 开启 SQL 日志，查看执行的 SQL
2. 使用 `EXPLAIN` 分析执行计划
3. 检查是否有索引
4. 检查是否有全表扫描

### Q2：MyBatis Plus 如何打印 SQL？

配置 `log-impl: org.apache.ibatis.logging.stdout.StdOutImpl`

### Q3：如何防止全表扫描？

1. 确保查询条件命中索引
2. 使用 `SqlExplainInterceptor` 拦截全表扫描 SQL
3. 定期分析慢查询日志

---

## 最佳实践

1. **开发环境开启 SQL 日志**：方便调试
2. **生产环境关闭 SQL 日志**：避免性能损耗
3. **使用性能分析插件**：定位慢 SQL
4. **定期分析慢查询**：优化索引
5. **使用 EXPLAIN 分析**：理解 SQL 执行计划

---

## 思考题

一个订单查询接口，执行时间 5 秒。通过 SQL 日志发现：

```sql
SELECT * FROM orders WHERE user_id = 1 ORDER BY create_time DESC
```

1. `EXPLAIN` 显示 `type = ALL`，说明什么问题？
2. 可能的原因有哪些？
3. 如何验证和解决？

提示：检查 `user_id` 和 `create_time` 是否有索引，索引顺序是否正确。

到这里，MyBatis Plus 的核心内容就讲完了。我们学习了：

- 快速上手和核心注解
- CRUD 接口与条件构造器
- 分页插件
- 自动填充
- 逻辑删除
- 乐观锁
- 多租户
- SQL 性能分析

这些知识点覆盖了 MyBatis Plus 的大部分应用场景。如果你想进一步深入，可以查看官方文档或源码。
