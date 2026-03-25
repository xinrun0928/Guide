# MyBatis 整体架构：四个核心组件的协作交响

你有没有想过，当执行这一行代码时：

```java
User user = sqlSession.selectOne("com.example.mapper.UserMapper.selectById", 1);
```

MyBatis 内部到底发生了什么？

答案藏在四个核心组件里：**Executor**、**StatementHandler**、**ParameterHandler**、**ResultSetHandler**。

它们各司其职，组成了一条精密的执行流水线。

## 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         SqlSession                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Configuration                       │   │
│  │  （管理所有配置信息：Mapper、SQL、缓存规则、类型处理器）    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌───────────────────────────▼─────────────────────────────┐   │
│  │                      Executor                            │   │
│  │     （SQL 执行器：简单执行、复用执行、批量执行）           │   │
│  │                          │                               │   │
│  │  ┌──────────────────────▼───────────────────────────┐   │   │
│  │  │                 StatementHandler                  │   │   │
│  │  │   （SQL 预处理：编译、参数设置、结果集准备）         │   │   │
│  │  │        │                        │                  │   │   │
│  │  │   ┌────▼────┐            ┌──────▼──────┐          │   │   │
│  │  │   │Parameter│            │ ResultSet   │          │   │   │
│  │  │   │ Handler │            │  Handler    │          │   │   │
│  │  │   └─────────┘            └─────────────┘          │   │   │
│  │  └───────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 四大组件详解

### 1. Executor：SQL 执行器

Executor 是 MyBatis 的**调度中心**，负责 SQL 语句的执行和缓存管理。

MyBatis 提供了三种 Executor：

| 类型 | 说明 | 使用场景 |
|-----|------|---------|
| SimpleExecutor | 每次查询创建新的 PreparedStatement | 默认，简单场景 |
| ReuseExecutor | 复用 PreparedStatement | 重复执行相同 SQL |
| BatchExecutor | 批量执行 SQL | 批量插入、更新 |

```java
// 配置方式（mybatis-config.xml）
<settings>
    <setting name="defaultExecutorType" value="REUSE"/>
</settings>
```

> **面试追问**：为什么要区分三种 Executor？
>
> 答：BatchExecutor 可以显著提升批量操作的性能，因为减少了数据库交互次数。但要注意事务边界——BatchExecutor 的 SQL 不会立即执行，只有 flushStatements 时才会真正发送。

### 2. StatementHandler：SQL 处理器

StatementHandler 负责**SQL 编译和参数设置**，它直接与数据库交互。

核心方法：

```java
public interface StatementHandler {
    // 准备语句（创建 PreparedStatement）
    Statement prepare(Connection connection, Integer transactionTimeout);

    // 参数绑定
    void parameterize(Statement statement) throws SQLException;

    // 执行更新（INSERT/UPDATE/DELETE）
    int update(Statement statement) throws SQLException;

    // 执行查询
    <E> List<E> query(Statement statement, ResultHandler resultHandler) throws SQLException;
}
```

它有三种实现：

| 类型 | 说明 |
|-----|------|
| SimpleStatementHandler | 处理普通 Statement（不使用预编译） |
| PreparedStatementHandler | 处理 PreparedStatement（**最常用**） |
| CallableStatementHandler | 处理存储过程 |

> **性能提示**：MyBatis 默认使用 PreparedStatement，所以能防止 SQL 注入。**不要为了「省事」去拼接 SQL**。

### 3. ParameterHandler：参数绑定器

ParameterHandler 负责**将 Java 对象的属性值绑定到 SQL 参数**。

核心方法：

```java
public interface ParameterHandler {
    // 获取参数
    Object getParameterObject();

    // 设置参数到 PreparedStatement
    void setParameters(PreparedStatement ps) throws SQLException;
}
```

它处理两种占位符：

- `#{}`：预编译占位符，自动进行类型转换和 SQL 注入防护
- `${}`：直接替换，容易导致 SQL 注入，**慎用**

```java
// #{} 会自动处理类型转换
User user = mapper.selectById(1);          // int -> Integer
List&lt;User&gt; users = mapper.selectByName("zhang"); // String 自动加引号

// ${} 直接替换，小心 SQL 注入
// 错误示例：mapper.selectByColumn("name", "zhang' OR '1'='1");
// 正确用法：ORDER BY ${columnName}，但必须确保 columnName 可控
```

### 4. ResultSetHandler：结果集映射器

ResultSetHandler 负责**将 ResultSet 映射为 Java 对象**。

核心方法：

```java
public interface ResultSetHandler {
    // 处理 ResultSet，映射为 List
    <E> List<E> handleResultSets(Statement statement) throws SQLException;

    // 处理多结果集
    <E> List<E> handleOutputParameters(Statement statement) throws SQLException;
}
```

映射方式有两种：

| 方式 | 说明 |
|-----|------|
| 自动映射 | 根据列名和属性名自动匹配（默认开启） |
| 自定义映射 | 通过 `resultMap` 手动指定映射规则 |

```xml
<!-- 自动映射 -->
<select id="selectById" resultType="com.example.User">
    SELECT id, name, email FROM user WHERE id = #{id}
</select>

<!-- 自定义映射（处理列名与属性名不一致） -->
<resultMap id="userResultMap" type="com.example.User">
    <id property="id" column="user_id"/>
    <result property="name" column="user_name"/>
    <result property="email" column="user_email"/>
</resultMap>
```

## 执行流程时序图

```
用户调用
    │
    ▼
┌────────────┐
│  SqlSession│
└─────┬──────┘
      │ selectOne / selectList
      ▼
┌────────────┐
│  Executor  │ ← 缓存管理在这里
└─────┬──────┘
      │ query
      ▼
┌──────────────────┐
│ StatementHandler │ ← SQL 编译在这里
│  (prepareStatement)│
└─────┬────────────┘
      │ parameterize
      ▼
┌──────────────────┐
│  ParameterHandler│ ← 参数绑定在这里
└─────┬────────────┘
      │ execute
      ▼
┌────────────┐
│  Database  │
└─────┬──────┘
      │ ResultSet
      ▼
┌──────────────────┐
│  ResultSetHandler│ ← 结果映射在这里
└─────┬────────────┘
      │
      ▼
    Java Object
```

## 四大组件的协同关系

想象一个餐厅的场景：

| 组件 | 角色 | 做什么 |
|-----|------|-------|
| Executor | 经理 | 接收顾客（SQL）请求，决定派谁来处理（调度），还管仓库（缓存） |
| StatementHandler | 厨师长 | 拿到食材（参数），决定怎么烹饪（SQL 编译） |
| ParameterHandler | 配菜员 | 把原材料（Java 对象）切好（类型转换）给厨师 |
| ResultSetHandler | 摆盘师 | 把做好的菜（ResultSet）摆成漂亮的样子（Java 对象） |

## 面试高频问题

### Q1：MyBatis 中 Executor 和 StatementHandler 的区别是什么？

- **Executor** 是更高层的抽象，负责 SQL 执行和缓存管理
- **StatementHandler** 负责更底层的 SQL 预处理、参数绑定、结果集获取
- Executor 调用 StatementHandler 来执行 SQL

### Q2：为什么 ParameterHandler 只负责设置参数，而不是解析 `#{}`？

因为 `#{}` 的解析是在更早的阶段完成的——在 `StatementHandler.prepare()` 调用之前，`BoundSql` 对象就已经包含了完整的 SQL 字符串，`#{}` 已经被替换成了 `?`。

---

## 思考题

如果让你实现一个自定义的 `TypeHandler`，来处理 JSON 字段（如 MySQL 的 JSON 类型），四大组件中哪个会用到它？

答案：**ParameterHandler 在设置参数时用到 `TypeHandler`，ResultSetHandler 在映射结果时也会用到 `TypeHandler`**。

下一节，我们深入 `TypeHandler` 的世界。
