# MongoDB Spring Data MongoDB 集成

Java 项目中使用 MongoDB，最常用的方案是 **Spring Data MongoDB**。

这一篇，我们来全面了解如何集成和使用。

## Maven 依赖

```xml
<!-- Spring Boot 项目 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-mongodb</artifactId>
    <version>3.2.0</version>
</dependency>

<!-- 非 Spring Boot 项目 -->
<dependency>
    <groupId>org.springframework.data</groupId>
    <artifactId>spring-data-mongodb</artifactId>
    <version>4.2.0</version>
</dependency>

<dependency>
    <groupId>org.mongodb</groupId>
    <artifactId>mongodb-driver-sync</artifactId>
    <version>4.11.1</version>
</dependency>
```

## 配置

### application.yml

```yaml
spring:
  data:
    mongodb:
      # 单机配置
      uri: mongodb://localhost:27017/myapp

      # 副本集配置
      # uri: mongodb://mongo1:27017,mongo2:27017,mongo3:27017/myapp?replicaSet=rs0

      # 分片集群配置
      # uri: mongodb://mongos1:27017,mongos2:27017/myapp

      # 其他配置
      auto-index-creation: true  # 自动创建索引
      uuid-representation: standard  # UUID 表示方式
```

### Java 配置类

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.MongoDatabaseFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.convert.DefaultMongoTypeMapper;
import org.springframework.data.mongodb.core.convert.MappingMongoConverter;
import org.springframework.data.mongodb.repository.config.EnableMongoRepositories;

@Configuration
@EnableMongoRepositories(basePackages = "com.example.repository")
public class MongoConfig {

    @Bean
    public MongoTemplate mongoTemplate(MongoDatabaseFactory factory,
                                       MappingMongoConverter converter) {
        // 移除 _class 字段
        converter.setTypeMapper(new DefaultMongoTypeMapper(null));
        return new MongoTemplate(factory, converter);
    }
}
```

## 定义实体

### 基本实体

```java
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Field;
import java.time.LocalDateTime;
import java.util.List;

@Document(collection = "users")
public class User {

    @Id
    private String id;

    @Indexed(unique = true)
    private String username;

    @Field("pwd")  // 映射到 MongoDB 的 pwd 字段
    private String password;

    @Indexed
    private String email;

    private Integer age;

    private Boolean active;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    // 嵌入式文档
    private Address address;

    // 数组字段
    private List<String> roles;

    // Getter/Setter
}
```

### 嵌入式文档

```java
import org.springframework.data.mongodb.core.mapping.Embedded;

@Embedded
public class Address {
    private String province;
    private String city;
    private String district;
    private String street;

    // Getter/Setter
}
```

### 索引注解

```java
@Document(collection = "orders")
public class Order {

    @Id
    private String id;

    // 单字段索引
    @Indexed
    private String userId;

    // 复合索引
    @Indexed(direction = IndexDirection.DESCENDING, name = "idx_user_created")
    private LocalDateTime createdAt;

    // 唯一索引
    @Indexed(unique = true)
    private String orderNo;

    // 文本索引
    @TextIndexed
    private String description;

    // 地理空间索引
    @GeoSpatialIndexed(type = GeoSpatialIndexType.GEO_2DSPHERE)
    private GeoJsonPoint location;
}
```

## Repository 接口

### 基本 CRUD

```java
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends MongoRepository&lt;User, String&gt; {

    // 方法名查询
    Optional&lt;User&gt; findByUsername(String username);

    List&lt;User&gt; findByAgeGreaterThan(Integer age);

    List&lt;User&gt; findByCityAndStatus(String city, String status);

    List&lt;User&gt; findByUsernameContaining(String keyword);

    // @Query 自定义查询
    @Query("{ 'username': ?0 }")
    User findUserByUsername(String username);

    // 原生查询
    @Query(value = "{ 'age': { $gte: ?0, $lte: ?1 } }", count = true)
    long countByAgeRange(Integer minAge, Integer maxAge);

    // 模糊查询
    @Query("{ 'username': { $regex: ?0, $options: 'i' } }")
    List&lt;User&gt; searchByUsernameRegex(String keyword);
}
```

### 高级查询

```java
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.Query;

public interface OrderRepository extends MongoRepository&lt;Order, String&gt; {

    // 分页查询
    Page&lt;Order&gt; findByUserId(String userId, Pageable pageable);

    // 排序查询
    List&lt;Order&gt; findByUserIdOrderByCreatedAtDesc(String userId);

    // 统计查询
    long countByStatus(String status);

    // 是否存在
    boolean existsByOrderNo(String orderNo);

    // 删除
    void deleteByUserId(String userId);
}
```

## MongoTemplate 操作

### 基本 CRUD

```java
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    private final MongoTemplate mongoTemplate;

    public UserService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    // 插入
    public User createUser(User user) {
        user.setCreatedAt(LocalDateTime.now());
        return mongoTemplate.insert(user);
    }

    // 批量插入
    public List&lt;User&gt; createUsers(List&lt;User&gt; users) {
        return mongoTemplate.insertAll(users);
    }

    // 查询
    public Optional&lt;User&gt; getUserById(String id) {
        return Optional.ofNullable(mongoTemplate.findById(id, User.class));
    }

    // 条件查询
    public List&lt;User&gt; getUsersByAge(Integer age) {
        Query query = new Query(Criteria.where("age").is(age));
        return mongoTemplate.find(query, User.class);
    }

    // 更新
    public void updateUserAge(String id, Integer newAge) {
        Query query = new Query(Criteria.where("_id").is(id));
        Update update = new Update().set("age", newAge)
                                   .set("updatedAt", LocalDateTime.now());
        mongoTemplate.updateFirst(query, update, User.class);
    }

    // 批量更新
    public void updateUserStatus(List&lt;String&gt; ids, String status) {
        Query query = new Query(Criteria.where("_id").in(ids));
        Update update = new Update().set("status", status);
        mongoTemplate.updateMulti(query, update, User.class);
    }

    // upsert
    public void upsertUser(User user) {
        Query query = new Query(Criteria.where("username").is(user.getUsername()));
        Update update = new Update()
            .setOnInsert("username", user.getUsername())
            .setOnInsert("createdAt", LocalDateTime.now())
            .set("updatedAt", LocalDateTime.now());
        mongoTemplate.upsert(query, update, User.class);
    }

    // 删除
    public void deleteUser(String id) {
        Query query = new Query(Criteria.where("_id").is(id));
        mongoTemplate.remove(query, User.class);
    }
}
```

### 聚合操作

```java
@Service
public class OrderAnalyticsService {

    private final MongoTemplate mongoTemplate;

    public OrderAnalyticsService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    // 分组统计
    public Map&lt;String, Long&gt; countOrdersByStatus() {
        Aggregation aggregation = Aggregation.newAggregation(
            Aggregation.group("status").count().as("count"),
            Aggregation.project("count").and("_id").as("status")
        );

        AggregationResults&lt;Document&gt; results = mongoTemplate.aggregate(
            aggregation, "orders", Document.class
        );

        return results.getMappedResults().stream()
            .collect(Collectors.toMap(
                doc -> doc.getString("status"),
                doc -> doc.getLong("count")
            ));
    }

    // 按用户统计订单
    public List&lt;UserOrderSummary&gt; getUserOrderSummary() {
        Aggregation aggregation = Aggregation.newAggregation(
            Aggregation.match(Criteria.where("status").is("paid")),
            Aggregation.group("userId")
                .sum("amount").as("totalAmount")
                .count().as("orderCount")
                .avg("amount").as("avgAmount"),
            Aggregation.sort(Sort.Direction.DESC, "totalAmount"),
            Aggregation.limit(10),
            Aggregation.lookup("users", "userId", "_id", "user"),
            Aggregation.unwind("user")
        );

        return mongoTemplate.aggregate(aggregation, "orders", UserOrderSummary.class)
            .getMappedResults();
    }
}
```

## 事务支持

### 配置事务管理器

```java
@Configuration
public class TransactionConfig {

    @Bean
    public MongoTransactionManager transactionManager(MongoDatabaseFactory factory) {
        return new MongoTransactionManager(factory);
    }
}
```

### 声明式事务

```java
@Service
public class OrderService {

    private final MongoTemplate mongoTemplate;

    @Transactional
    public void createOrder(Order order) {
        // 创建订单
        mongoTemplate.insert(order);

        // 更新用户积分
        User user = mongoTemplate.findById(order.getUserId(), User.class);
        user.setPoints(user.getPoints() + order.getPoints());
        mongoTemplate.save(user);

        // 如果这里抛异常，整个事务会回滚
    }
}
```

### 编程式事务

```java
@Service
public class TransferService {

    private final MongoTemplate mongoTemplate;

    public void transfer(String fromUserId, String toUserId, double amount) {
        Session session = mongoTemplate.getMongoDatabaseFactory()
            .getMongoDatabase().startSession();

        try {
            session.startTransaction();

            // 扣减余额
            mongoTemplate.updateFirst(
                Query.query(Criteria.where("_id").is(fromUserId)
                    .and("balance").gte(amount)),
                new Update().inc("balance", -amount),
                User.class
            );

            // 增加余额
            mongoTemplate.updateFirst(
                Query.query(Criteria.where("_id").is(toUserId)),
                new Update().inc("balance", amount),
                User.class
            );

            session.commitTransaction();

        } catch (Exception e) {
            session.abortTransaction();
            throw e;
        } finally {
            session.endSession();
        }
    }
}
```

## 常用注解

| 注解 | 说明 |
|-----|------|
| `@Document` | 映射到 MongoDB 集合 |
| `@Id` | 主键字段 |
| `@Field` | 字段映射 |
| `@Indexed` | 创建索引 |
| `@CompoundIndex` | 复合索引 |
| `@TextIndexed` | 文本索引 |
| `@GeoSpatialIndexed` | 地理空间索引 |
| `@Embedded` | 嵌入式文档 |
| `@DBRef` | 引用其他文档 |

## 常见问题

### 问题 1：`_class` 字段

Spring Data MongoDB 默认会在文档中添加 `_class` 字段存储类型信息。

解决方案：

```java
// 方式 1：移除 _class
@Bean
public MappingMongoConverter mappingMongoConverter(...) {
    MappingMongoConverter converter = new DefaultMongoConverter(...);
    converter.setTypeMapper(new DefaultMongoTypeMapper(null));
    return converter;
}

// 方式 2：配置文件
spring:
  data:
    mongodb:
      auto-index-creation: false
```

### 问题 2：LocalDateTime 序列化

```java
// 配置 LocalDateTime 序列化
@Bean
public MongoCustomConversions customConversions() {
    return new MongoCustomConversions(
        Arrays.asList(new LocalDateTimeToDateConverter(),
                     new DateToLocalDateTimeConverter())
    );
}
```

## 总结

Spring Data MongoDB 核心组件：

| 组件 | 说明 |
|-----|------|
| `MongoTemplate` | MongoDB 操作模板，类似 JdbcTemplate |
| `MongoRepository` | JPA 风格的 Repository 接口 |
| `@Document` | 实体类注解 |
| `@Indexed` | 索引注解 |
| `@Transactional` | 事务支持 |

**常用操作**：
- `MongoRepository`：简单 CRUD，快速开发
- `MongoTemplate`：复杂查询，灵活控制

---

**下一步，你可以：**

- 了解 [MongoDB 认证与授权](/database/mongodb/security)
- 学习 [MongoDB 数据备份与恢复](/database/mongodb/backup)
- 掌握 [MongoDB vs MySQL vs Redis 选型](/database/mongodb/compare)
