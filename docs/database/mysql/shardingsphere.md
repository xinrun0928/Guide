# ShardingSphere：分库分表的一站式解决方案

分库分表的实现很复杂：路由规则、数据聚合、跨分片查询...

有没有现成的轮子？

**ShardingSphere** 就是这个轮子。

---

## ShardingSphere 是什么？

ShardingSphere 是 Apache 基金会的顶级项目，是面向企业的分布式数据库中间件生态。

```
┌─────────────────────────────────────────────────────────────┐
│                    ShardingSphere                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────┐      │
│   │           ShardingSphere-JDBC                    │      │
│   │              (轻量级 JDBC 增强)                  │      │
│   └─────────────────────────────────────────────────┘      │
│                                                             │
│   ┌─────────────────────────────────────────────────┐      │
│   │          ShardingSphere-Proxy                   │      │
│   │              (数据库代理层)                      │      │
│   └─────────────────────────────────────────────────┘      │
│                                                             │
│   ┌─────────────────────────────────────────────────┐      │
│   │         ShardingSphere-Sidecar                   │      │
│   │              (云原生适配器)                       │      │
│   └─────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## ShardingSphere-JDBC

轻量级 Java 类库，在应用层实现分库分表。

### Maven 依赖

```xml
<dependency>
    <groupId>org.apache.shardingsphere</groupId>
    <artifactId>shardingsphere-jdbc-core</artifactId>
    <version>5.3.0</version>
</dependency>
```

### YAML 配置

```yaml
spring:
  shardingsphere:
    datasource:
      names: ds_0, ds_1
      ds_0:
        driver-class-name: com.mysql.cj.jdbc.Driver
        url: jdbc:mysql://localhost:3306/orders_0
        username: root
        password: password
      ds_1:
        driver-class-name: com.mysql.cj.jdbc.Driver
        url: jdbc:mysql://localhost:3306/orders_1
        username: root
        password: password

    rules:
      sharding:
        tables:
          orders:
            actual-data-nodes: ds_$->{0..1}.orders_$->{0..3}
            table-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: orders_inline
            key-generate-strategy:
              column: order_id
              key-generator-name: snowflake

        sharding-algorithms:
          orders_inline:
            type: INLINE
            props:
              algorithm-expression: orders_$->{user_id % 4}

        key-generators:
          snowflake:
            type: SNOWFLAKE

    props:
      sql-show: true  # 显示 SQL 日志
```

### Java 配置

```java
@Configuration
public class ShardingConfig {
    @Bean
    public DataSource dataSource() {
        return DataSourceFactory.getDataSource(yamlConfig());
    }
}
```

---

## ShardingSphere-Proxy

数据库代理层部署方式，对应用透明。

```
┌─────────────────────────────────────────────────────────────┐
│                  ShardingSphere-Proxy 架构                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   应用 (MySQL Client)                                       │
│         │                                                   │
│         ↓                                                   │
│   ┌───────────────────────┐                                │
│   │  ShardingSphere-Proxy │                                │
│   │     (MySQL 协议代理)   │                                │
│   └───────────┬───────────┘                                │
│               │                                             │
│   ┌───────────┼───────────┐                                 │
│   ↓           ↓           ↓                                 │
│ ┌──────┐   ┌──────┐   ┌──────┐                             │
│ │ MySQL│   │ MySQL│   │ MySQL│                             │
│ │ ds_0 │   │ ds_1 │   │ ds_2 │                             │
│ └──────┘   └──────┘   └──────┘                             │
│                                                             │
│ 应用无需修改代码，连接 ShardingSphere-Proxy 即可              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 启动 Proxy

```bash
# 下载 ShardingSphere-Proxy
wget https://archive.apache.org/dist/shardingsphere/5.3.0/shardingsphere-proxy-5.3.0.tar.gz

# 解压
tar -xzf shardingsphere-proxy-5.3.0.tar.gz

# 配置
vim conf/config-sharding.yaml

# 启动
bin/start.sh
```

---

## 核心功能

### 功能一：分片

```yaml
# 标准分片策略
table-strategy:
  standard:
    sharding-column: user_id
    sharding-algorithm-name: orders_mod

# 绑定表策略
binding-tables:
  - orders, orders_detail
```

### 功能二：读写分离

```yaml
rules:
  readwrite-splitting:
    data-sources:
      ds_master:
        write:
          url: jdbc:mysql://master:3306/guide
          username: root
          password: password
        read:
          - url: jdbc:mysql://slave1:3306/guide
            username: root
            password: password
          - url: jdbc:mysql://slave2:3306/guide
            username: root
            password: password
    rules:
      - load-balancer-type: ROUND_ROBIN
```

### 功能三：数据加密

```yaml
rules:
  encryption:
    tables:
      users:
        columns:
          password:
            cipher-column: password
            encryptor-name: aes
            query-with-cipher-column: true
```

---

## 分片算法示例

### 取模分片

```yaml
sharding-algorithms:
  orders_mod:
    type: MOD
    props:
      sharding-count: 4
```

### 范围分片

```yaml
sharding-algorithms:
  orders_range:
    type: RANGE
    props:
      algorithm-expression: ds_$->{Long.parseLong(id) / 1000000}
```

### 自定义分片算法

```java
public class MyShardingAlgorithm implements PreciseShardingAlgorithm&lt;Long&gt; {
    @Override
    public String doSharding(Collection&lt;String&gt; availableTargetNames,
                              PreciseShardingValue&lt;Long&gt; shardingValue) {
        long userId = shardingValue.getValue();
        int index = (int) (userId % 4);
        for (String targetName : availableTargetNames) {
            if (targetName.endsWith(String.valueOf(index))) {
                return targetName;
            }
        }
        throw new IllegalStateException("No target found for userId: " + userId);
    }
}
```

```yaml
sharding-algorithms:
  my_algorithm:
    type: CLASS_BASED
    props:
      strategy: STANDARD
      algorithmClassName: com.example.MyShardingAlgorithm
```

---

## 使用示例

### Spring Boot 集成

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

@Repository
public interface OrderMapper {
    @Select("SELECT * FROM orders WHERE user_id = #{userId}")
    List&lt;Order&gt; selectByUserId(@Param("userId") long userId);

    @Insert("INSERT INTO orders (order_id, user_id, amount) VALUES (#{orderId}, #{userId}, #{amount})")
    int insert(Order order);
}
```

使用方式和平常一样，ShardingSphere 自动处理分库分表逻辑。

---

## 监控和管理

```bash
# 开启治理模块
rules:
  - !TRANSFORM
  - !SQL_PARSER
  - !SCHEDULED_MERGE
  - !TRAFFIC
  - !GITHER

props:
  check-duplicate-table-enabled: true
```

可以通过 SQL Parser 分析 SQL，给出优化建议。

---

## 面试追问方向

- ShardingSphere-JDBC 和 ShardingSphere-Proxy 的区别？
- ShardingSphere 支持哪些分片算法？
- 如何自定义分片算法？
- ShardingSphere 的绑定表是什么？

> ShardingSphere-JDBC 是类库方式，对应用有依赖；Proxy 是代理方式，对应用透明。绑定表是为了解决跨分片 JOIN 时笛卡尔积的问题。
