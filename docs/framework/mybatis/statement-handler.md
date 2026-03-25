# StatementHandler：SQL 预编译与Statement管理

如果说 Executor 是「指挥官」，那么 StatementHandler 就是「技术主管」——它直接与数据库通信，负责 SQL 的预编译、参数绑定和结果获取。

你可能写过这样的 SQL：

```sql
SELECT * FROM user WHERE id = #{id} AND name = #{name}
```

但有没有想过：**这条 SQL 是怎么变成 PreparedStatement 的？参数是怎么绑定的？**

## StatementHandler 的家族

```
StatementHandler（接口）
    │
    ├── SimpleStatementHandler（普通 Statement）
    ├── PreparedStatementHandler（预编译 Statement）← 最常用
    └── CallableStatementHandler（存储过程）
```

### 三种 Statement 的区别

| 类型 | SQL 处理 | 安全性 | 性能 |
|-----|---------|-------|------|
| Statement | 每次拼接 SQL | ❌ 有 SQL 注入风险 | ❌ 每次都要编译 |
| PreparedStatement | 预编译一次，参数替换 | ✅ 防注入 | ✅ 预编译后复用 |
| CallableStatement | 调用存储过程 | ✅ 安全 | 一般 |

## PreparedStatementHandler 核心流程

```java
public class PreparedStatementHandler extends BaseStatementHandler {

    @Override
    public <E> List<E> query(Statement statement, ResultHandler resultHandler)
            throws SQLException {
        // 1. 强转为 PreparedStatement
        PreparedStatement ps = (PreparedStatement) statement;

        // 2. 执行查询
        ps.execute();

        // 3. 处理结果集
        return resultSetHandler.handleResultSets(ps);
    }

    @Override
    public int update(Statement statement) throws SQLException {
        PreparedStatement ps = (PreparedStatement) statement;
        // 执行更新，返回影响的行数
        return ps.executeUpdate();
    }
}
```

## SQL 预编译原理

### 什么是预编译？

预编译是数据库的优化机制——**先把 SQL 结构发给数据库编译，参数之后再传入**。

```
普通查询流程：
客户端 → 发送完整 SQL → 数据库编译 → 执行 → 返回结果

预编译流程：
客户端 → 发送 SQL 结构（含占位符?）→ 数据库编译 → 缓存编译结果
客户端 → 发送参数 → 数据库执行（用缓存的编译结果）→ 返回结果
```

### MyBatis 中的预编译

```java
// 源码简化
public abstract class BaseStatementHandler implements StatementHandler {

    protected Statement prepare(Connection connection) throws SQLException {
        // 1. 调用底层 PreparedStatement（这里会触发预编译）
        Statement statement = instantiateStatement(connection);

        // 2. 设置超时等属性
        statement.setQueryTimeout(timeout);
        statement.setFetchSize(fetchSize);

        return statement;
    }

    protected abstract Statement instantiateStatement(Connection connection)
            throws SQLException;
}

// PreparedStatementHandler 的实现
public class PreparedStatementHandler extends BaseStatementHandler {
    @Override
    protected Statement instantiateStatement(Connection connection) throws SQLException {
        // 获取 SQL，例如：SELECT * FROM user WHERE id = ?
        String sql = boundSql.getSql();

        // 关键！调用 connection.prepareStatement()，这里会预编译
        return connection.prepareStatement(sql);
    }
}
```

## BoundSql：SQL 与参数的载体

```java
public class BoundSql {
    // 原始 SQL（带 #{} 占位符）
    private final String sql;

    // 参数信息（用于设置参数）
    private final List&lt;ParameterMapping&gt; parameterMappings;

    // 参数值
    private final Object parameterObject;

    // 额外参数（用于动态 SQL）
    private final Map&lt;String, Object&gt; additionalParameters;
}
```

### #{} 是怎么变成 ? 的？

```java
// 配置文件中：SELECT * FROM user WHERE id = #{id}
// 解析后，BoundSql.sql = "SELECT * FROM user WHERE id = ?"

// 配置文件中：SELECT * FROM user WHERE name LIKE #{name}
// 解析后，BoundSql.sql = "SELECT * FROM user WHERE name LIKE ?"
// 注意：#{name} 会被替换为 ?，而不是 'zhang%'
```

## 参数绑定过程

```java
public class PreparedStatementHandler {
    private final ParameterHandler parameterHandler;

    @Override
    public void parameterize(Statement statement) throws SQLException {
        // 委托给 ParameterHandler
        parameterHandler.setParameters((PreparedStatement) statement);
    }
}

public class DefaultParameterHandler implements ParameterHandler {

    @Override
    public void setParameters(PreparedStatement ps) {
        // 从 BoundSql 获取参数映射
        List&lt;ParameterMapping&gt; parameterMappings = boundSql.getParameterMappings();

        for (int i = 0; i < parameterMappings.size(); i++) {
            ParameterMapping parameterMapping = parameterMappings.get(i);
            Object value;

            // 获取参数值
            if (boundSql.hasAdditionalParameter(parameterMapping.getName())) {
                value = boundSql.getAdditionalParameter(parameterMapping.getName());
            } else if (parameterObject == null) {
                value = null;
            } else if (typeHandlerRegistry.hasTypeHandler(parameterObject.getClass())) {
                // 基本类型，直接使用
                value = parameterObject;
            } else {
                // 对象类型，通过反射获取属性值
                value = new ComplexObjectHandler().getPropertyValue(parameterObject, parameterMapping);
            }

            // 使用 TypeHandler 转换并设置参数
            TypeHandler&lt;Object&gt; typeHandler = parameterMapping.getTypeHandler();
            JdbcType jdbcType = parameterMapping.getJdbcType();
            typeHandler.setParameter(ps, i + 1, value, jdbcType);
        }
    }
}
```

## RoutingStatementHandler：路由器

你不需要手动选择用哪个 StatementHandler，MyBatis 会根据配置自动选择：

```java
public class RoutingStatementHandler implements StatementHandler {
    private final StatementHandler delegate;

    public RoutingStatementHandler(MappedStatement ms, Object parameter,
                                   RowBounds rowBounds, ResultHandler resultHandler,
                                   BoundSql boundSql) {
        // 根据 statementType 选择具体的实现
        switch (ms.getStatementType()) {
            case STATEMENT:
                delegate = new SimpleStatementHandler(...);
                break;
            case PREPARED:
                delegate = new PreparedStatementHandler(...);
                break;
            case CALLABLE:
                delegate = new CallableStatementHandler(...);
                break;
            default:
                throw new ExecutorException("Invalid statement type: " + ms.getStatementType());
        }
    }

    @Override
    public Statement prepare(Connection connection) {
        return delegate.prepare(connection);
    }

    @Override
    public void parameterize(Statement statement) {
        delegate.parameterize(statement);
    }
}
```

## 完整执行流程

```
用户调用 mapper.selectById(1)
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                  RoutingStatementHandler                 │
│  根据配置选择：PreparedStatementHandler                   │
└─────────────────────────┬───────────────────────────────┘
                          │ prepare()
                          ▼
┌─────────────────────────────────────────────────────────┐
│               PreparedStatement.prepare()                │
│  发送 SQL 结构到数据库，预编译                            │
│  SQL: SELECT * FROM user WHERE id = ?                   │
└─────────────────────────┬───────────────────────────────┘
                          │ parameterize()
                          ▼
┌─────────────────────────────────────────────────────────┐
│               ParameterHandler.setParameters()         │
│  使用 TypeHandler 设置参数                               │
│  ps.setInt(1, 1)                                        │
└─────────────────────────┬───────────────────────────────┘
                          │ ps.execute()
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      Database                            │
│  执行预编译后的 SQL                                      │
└─────────────────────────┬───────────────────────────────┘
                          │ ResultSet
                          ▼
┌─────────────────────────────────────────────────────────┐
│              ResultSetHandler.handleResultSets()         │
│  将 ResultSet 映射为 Java 对象                           │
└─────────────────────────────────────────────────────────┘
```

## 面试高频问题

### Q1：Statement 和 PreparedStatement 的区别？

- **Statement**：每次执行都发送完整 SQL，数据库需要每次解析和编译
- **PreparedStatement**：先预编译，再传入参数，可以复用编译结果；还能防止 SQL 注入

### Q2：MyBatis 默认使用哪种 StatementHandler？

**PreparedStatementHandler**。这也是为什么 `#{}` 能防止 SQL 注入的原因。

### Q3：预编译一定能防止 SQL 注入吗？

**大部分情况下能**，但如果 `TypeHandler` 实现不当，仍可能有问题。

```java
// 这样用是安全的：TypeHandler 会处理引号
#{name}  →  'zhang'（自动加引号）

// 这样用不安全（MyBatis 不推荐，但可能有人会这样做）
${name}  →  zhang（没有引号包裹）
```

---

## 思考题

如果我想实现一个「查询时自动记录 SQL 执行日志」的功能，应该在哪里实现？

答案：**StatementHandler** 层。因为：

1. `prepare()` 时可以获取 SQL 语句
2. `parameterize()` 时可以获取参数值
3. `query()` 执行后可以获取执行时间和结果数量

你可以在自定义插件中拦截这些方法来实现日志记录。

下一节，我们深入 [ParameterHandler](/framework/mybatis/parameter-handler) 的参数绑定机制。
