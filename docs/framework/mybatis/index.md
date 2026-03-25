# MyBatis：优雅地告别 JDBC 模板代码

如果你是 Java 开发者，一定写过这种代码：

```java
Connection conn = null;
PreparedStatement pstmt = null;
ResultSet rs = null;
try {
    conn = dataSource.getConnection();
    pstmt = conn.prepareStatement("SELECT * FROM user WHERE id = ?");
    pstmt.setInt(1, userId);
    rs = pstmt.executeQuery();
    User user = null;
    if (rs.next()) {
        user = new User();
        user.setId(rs.getInt("id"));
        user.setName(rs.getString("name"));
        user.setEmail(rs.getString("email"));
    }
    return user;
} finally {
    // 关闭连接... 10 行代码
}
```

每写一次 CRUD，就要在 `try-catch-finally` 里挣扎一次。

这就是 MyBatis 诞生的原因——**让数据库操作变得优雅，让开发者专注于业务，而不是 SQL 拼接**。

## MyBatis 是什么？

MyBatis 是一款优秀的持久层框架，它支持定制化 SQL、存储过程以及高级映射。

与 Hibernate 这种「全自动」 ORM 不同，MyBatis 采用**半自动**模式：

- 你写 SQL，它帮你执行
- 你定义映射规则，它帮你把结果集转换成对象
- 你想要极致控制？没问题，SQL 完全由你掌控

> **面试官可能会问**：MyBatis 和 Hibernate 的核心区别是什么？
>
> 答：MyBatis 是半自动，SQL 可控，适合复杂查询和性能敏感场景；Hibernate 是全自动，屏蔽 SQL，适合快速开发但 SQL 不透明。

## 核心特性

### 1. SQL 与代码分离

MyBatis 把 SQL 放在 XML 文件或注解中，与 Java 代码彻底分离。这意味着：

- SQL 修改不需要重新编译
- SQL 可以集中管理
- IDE 可以对 SQL 进行语法提示

### 2. 强大的映射能力

MyBatis 的 `resultMap` 可以处理：

- 一对一关联（`association`）
- 一对多关联（`collection`）
- 嵌套查询与嵌套结果
- 自动映射与自定义映射

### 3. 动态 SQL

MyBatis 提供了丰富的动态 SQL 标签：

- `if`：条件判断
- `where`：智能条件拼接
- `set`：更新语句智能处理
- `foreach`：批量操作
- `choose`：多条件选择

### 4. 缓存机制

MyBatis 内置了两级缓存：

- **一级缓存**（SqlSession 级别）：默认开启，生命周期随 SqlSession
- **二级缓存**（Mapper 级别）：可跨 SqlSession 共享，需要手动开启

## 生态与周边

### MyBatis 生态

```
MyBatis
├── MyBatis-Spring（Spring 集成）
├── MyBatis-Spring-Boot-Starter（Spring Boot 集成）
├── MyBatis-Plus（增强工具，国内使用广泛）
├── MyBatis-Generator（代码生成器）
└── PageHelper（分页插件）
```

### MyBatis Plus

全网最火的 MyBatis 增强工具，**中国人开发的开源项目**。它在内 MyBatis 基础上做了大量增强：

- 内置通用 CRUD，无需编写简单 SQL
- 强大的条件构造器
- 分页插件
- 自动填充
- 逻辑删除
- 乐观锁

> 有人说：用了 MyBatis Plus，就再也回不去了。
>
> 也有人说：这让开发者变懒了，连 SQL 都不会写了。
>
> **我的观点**：工具是为人服务的，会用工具是能力，但别忘了原理。

## 章节导航

这一模块，我们将深入 MyBatis 的核心机制：

- **初始化流程**：[MyBatis 初始化流程](/framework/mybatis/init-flow) → 从 XML 到 Configuration
- **核心组件**：[MyBatis 架构](/framework/mybatis/architecture) → Executor、StatementHandler、ParameterHandler、ResultSetHandler
- **执行流程**：[SqlSession 与 Mapper](/framework/mybatis/sqlsession-mapper) → 执行链路
- **参数与结果**：[参数绑定](/framework/mybatis/parameter-handler) 与 [结果映射](/framework/mybatis/resultset-handler)
- **缓存机制**：[一级缓存与二级缓存](/framework/mybatis/cache)
- **高级映射**：[resultMap 配置](/framework/mybatis/resultmap) 与 [嵌套查询](/framework/mybatis/nested-query)
- **动态 SQL**：[动态 SQL 使用指南](/framework/mybatis/dynamic-sql)

---

## 留一个思考题

MyBatis 的一级缓存和二级缓存，分别在什么场景下会失效？

这个问题看似简单，但很多人答不完整——**只说「增删改会清缓存」的人，一定没遇到过生产环境下的缓存穿透问题**。

下一节，我们从初始化流程开始，揭开 MyBatis 的神秘面纱。
