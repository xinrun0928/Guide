# SqlSessionFactory：创建流程与生命周期

先问一个问题：**SqlSessionFactory 应该创建几次？**

很多人会说：「每次查询都创建新的 factory 啊，这样资源隔离更清晰。」

错。**SqlSessionFactory 应该只创建一次**，整个应用生命周期共享同一个实例。

## SqlSessionFactory 是什么？

`SqlSessionFactory` 是 MyBatis 的**会话工厂**，它负责创建 `SqlSession`。

你可以把它理解为「数据库连接的工厂」——它不直接操作数据库，但它是操作数据库的起点。

```java
// SqlSessionFactory 接口定义
public interface SqlSessionFactory {
    // 打开一个新的 SqlSession
    SqlSession openSession();

    // 打开一个新的 SqlSession，支持指定是否自动提交
    SqlSession openSession(boolean autoCommit);

    // 打开一个新的 SqlSession，支持指定事务隔离级别
    SqlSession openSession(TransactionIsolationLevel level);

    // 打开一个新的 SqlSession，指定执行器类型
    SqlSession openSession(ExecutorType execType);

    // ... 更多重载方法
}
```

## 创建流程回顾

上一节我们讲了 [MyBatis 初始化流程](/framework/mybatis/init-flow)，创建 SqlSessionFactory 的完整路径是：

```
mybatis-config.xml
       │
       ▼
SqlSessionFactoryBuilder.build()
       │
       ▼
XMLConfigBuilder.parse() → Configuration
       │
       ▼
DefaultSqlSessionFactory
```

代码层面：

```java
// 方式一：基于 XML 配置
SqlSessionFactory factory = new SqlSessionFactoryBuilder()
    .build(Resources.getResourceAsStream("mybatis-config.xml"));

// 方式二：基于 YAML 配置（Spring Boot）
SqlSessionFactory factory = new SqlSessionFactoryBuilder()
    .build(inputStream, "development", props);
```

## 生命周期分析

### SqlSessionFactory 的生命周期

| 维度 | 说明 |
|-----|------|
| 创建次数 | **整个应用生命周期只创建一次** |
| 线程安全 | **线程安全**，可以共享使用 |
| 作用域 | 应用级别（Application） |
| 销毁时机 | 应用关闭时 |

> **为什么 SqlSessionFactory 是线程安全的？**
>
> 因为它只包含 **Configuration**（配置信息）和 **Environment**（数据源配置），这些在创建后就只读了，不涉及可变状态。

### SqlSession 的生命周期

| 维度 | 说明 |
|-----|------|
| 创建次数 | **每次数据库操作都应创建新的** |
| 线程安全 | **非线程安全**，每个线程使用独立的 SqlSession |
| 作用域 | 方法级别或请求级别 |
| 销毁时机 | 使用完毕后必须关闭 |

```java
// 正确用法：每次操作都打开新的 SqlSession
SqlSessionFactory factory = ...; // 整个应用共享

public User getUserById(Long id) {
    SqlSession session = factory.openSession();
    try {
        UserMapper mapper = session.getMapper(UserMapper.class);
        return mapper.selectById(id);
    } finally {
        session.close(); // 重要！必须关闭
    }
}

// 更好的方式：使用 try-with-resources
public User getUserById(Long id) {
    try (SqlSession session = factory.openSession()) {
        UserMapper mapper = session.getMapper(UserMapper.class);
        return mapper.selectById(id);
    }
}
```

## 工厂模式在 MyBatis 中的体现

MyBatis 使用了**工厂模式**来解耦 SqlSession 的创建：

```
┌─────────────────┐
│  SqlSession     │  ← 产品（数据库会话）
└────────┬────────┘
         │
┌────────▼────────┐
│ SqlSessionFactory│  ← 工厂（创建产品）
└────────┬────────┘
         │
┌────────▼────────┐
│SqlSessionFactory │  ← 工厂构建器（负责构建工厂）
│    Builder      │
└─────────────────┘
```

### 为什么要用工厂模式？

1. **封装创建逻辑**：SqlSession 的创建涉及数据源、事务、Executor 等复杂组件，工厂模式隐藏了这些细节
2. **延迟初始化**：SqlSessionFactory 创建后不代表数据库连接已经建立，真正的连接在 openSession() 时才获取
3. **统一管理**：所有 SqlSession 的创建都通过同一个入口，便于配置管理和资源控制

## Spring 集成中的 SqlSessionFactory

在 Spring 中，`SqlSessionFactory` 由 `SqlSessionFactoryBean` 创建：

```java
@Configuration
public class MyBatisConfig {

    @Bean
    public SqlSessionFactoryBean sqlSessionFactory(DataSource dataSource) {
        SqlSessionFactoryBean factoryBean = new SqlSessionFactoryBean();
        factoryBean.setDataSource(dataSource);
        // 设置 mapper xml 位置
        factoryBean.setMapperLocations(
            new PathMatchingResourcePatternResolver()
                .getResources("classpath:mapper/*.xml")
        );
        // 设置类型别名包
        factoryBean.setTypeAliasesPackage("com.example.entity");
        return factoryBean;
    }
}
```

> **注意**：`SqlSessionFactoryBean` 实现了 `FactoryBean` 接口，所以注入到 Spring 容器后，实际注入的是 `SqlSessionFactory`。

## 多数据源场景

如果应用需要连接多个数据库怎么办？

**每个数据源对应一个 SqlSessionFactory**：

```java
// 数据源1
@Bean
public SqlSessionFactory sqlSessionFactory1() {
    SqlSessionFactoryBean factory = new SqlSessionFactoryBean();
    factory.setDataSource(dataSource1());
    return factory.getObject();
}

// 数据源2
@Bean
public SqlSessionFactory sqlSessionFactory2() {
    SqlSessionFactoryBean factory = new SqlSessionFactoryBean();
    factory.setDataSource(dataSource2());
    return factory.getObject();
}
```

使用时，通过 `@Qualifier` 指定使用哪个 factory：

```java
@Autowired
@Qualifier("sqlSessionFactory1")
private SqlSessionFactory sqlSessionFactory1;
```

## 常见错误：SqlSessionFactory 重复创建

```java
// 错误示例：在工具类中每次都创建新的 factory
public class UserDao {
    public User selectById(Long id) {
        // 每次查询都创建新的 SqlSessionFactory？大错特错！
        SqlSessionFactory factory = new SqlSessionFactoryBuilder()
            .build(inputStream);
        try (SqlSession session = factory.openSession()) {
            return session.getMapper(UserMapper.class).selectById(id);
        }
    }
}
```

**问题**：

1. 每次都解析 XML，**性能极差**
2. Configuration 被重复创建，**内存浪费**
3. 无法利用缓存，**浪费资源**

**正确做法**：将 SqlSessionFactory 作为单例管理：

```java
public class SqlSessionFactoryUtil {
    private static SqlSessionFactory factory;

    public static synchronized SqlSessionFactory getFactory() {
        if (factory == null) {
            factory = new SqlSessionFactoryBuilder()
                .build(Resources.getResourceAsStream("mybatis-config.xml"));
        }
        return factory;
    }
}
```

在 Spring 中，只需要在配置类中定义一次 `@Bean` 即可。

## 面试高频问题

### Q1：SqlSessionFactory 和 SqlSession 的关系是什么？

- **SqlSessionFactory** 是工厂，负责创建 **SqlSession**
- **SqlSessionFactory** 应该整个应用只创建一次，**SqlSession** 每次操作创建新的
- **SqlSession** 是数据库会话，包含实际的数据库连接

### Q2：为什么不直接用 SqlSessionFactory 创建 Connection？

因为 **SqlSession 封装了更多功能**，包括：

- 事务管理
- 缓存管理
- Mapper 代理
- 统一资源管理

直接使用 Connection 会丢失这些功能。

---

## 思考题

如果在多线程环境下，两个线程同时调用 `SqlSessionFactory.openSession()`，它们会拿到同一个 SqlSession 吗？

答案：**不会**。每个 `openSession()` 调用都会创建新的 `SqlSession` 实例，它们是相互独立的。

但这里有个陷阱——如果两个线程共用同一个 SqlSession（通过共享引用），就会出现线程安全问题。所以 **SqlSession 一定要在方法内部创建，使用后及时关闭**。

下一节，我们深入 [SqlSession 与 Mapper](/framework/mybatis/sqlsession-mapper) 的关系。
