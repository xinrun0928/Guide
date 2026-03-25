# ResultSetHandler：结果集映射的魔法

你有没有想过这个问题的答案：

```java
List<User> users = mapper.selectUsers();
// users 是什么？User 对象是怎么来的？
```

从数据库返回的 `ResultSet` 只是一堆数据行和列，MyBatis 是怎么知道：

1. 第 1 列叫 `id`，对应 `User.id`
2. 第 2 列叫 `name`，对应 `User.name`
3. 第 3 列叫 `email`，对应 `User.email`

这个「翻译」工作，就是 **ResultSetHandler** 完成的。

## ResultSetHandler 是什么？

`ResultSetHandler` 负责**将 JDBC ResultSet 映射为 Java 对象**。

```java
public interface ResultSetHandler {
    // 处理 ResultSet，映射为 List
    <E> List<E> handleResultSets(Statement statement) throws SQLException;

    // 处理多结果集（存储过程返回多个结果集）
    <E> Cursor<E> handleCursorResultSets(Statement statement) throws SQLException;

    // 处理存储过程的输出参数
    void handleOutputParameters(CallableStatement callableStatement) throws SQLException;
}
```

它的默认实现是 `DefaultResultSetHandler`。

## 自动映射 vs 自定义映射

### 自动映射（默认）

MyBatis 会根据列名和属性名自动匹配：

```xml
<select id="selectById" resultType="com.example.User">
    SELECT id, name, email FROM user WHERE id = #{id}
</select>
```

```java
public class User {
    private Long id;
    private String name;
    private String email;
    // getters and setters
}
```

**映射规则**：

| 数据库列名 | Java 属性名 | 匹配方式 |
|-----------|------------|---------|
| `id` | `id` | 完全匹配 |
| `user_name` | `userName` | 下划线转驼峰（需开启 `mapUnderscoreToCamelCase`） |
| `USER_NAME` | `userName` | 大小写不敏感 + 驼峰转换 |

### 自定义映射（resultMap）

当自动映射不满足需求时，使用 `resultMap`：

```xml
<resultMap id="userResultMap" type="com.example.User">
    <!-- 主键映射 -->
    <id property="id" column="user_id"/>
    <!-- 普通属性映射 -->
    <result property="name" column="user_name"/>
    <result property="email" column="user_email"/>
</resultMap>

<select id="selectById" resultMap="userResultMap">
    SELECT user_id, user_name, user_email FROM user WHERE id = #{id}
</select>
```

> **为什么需要 `<id>` 标签？**
>
> `<id>` 用于标识主键，它会影响 MyBatis 的缓存和嵌套查询。没有 `<id>`，MyBatis 可能无法正确识别对象的唯一性。

## 结果集处理流程

```java
public class DefaultResultSetHandler implements ResultSetHandler {

    private final Executor executor;
    private final MappedStatement mappedStatement;
    private final ResultHandler resultHandler;
    private final BoundSql boundSql;
    private final Configuration configuration;

    @Override
    public <E> List<E> handleResultSets(Statement stmt) throws SQLException {
        List<E> multipleResults = new ArrayList<>();

        int resultSetCount = 0;
        ResultSetWrapper rsw = new ResultSetWrapper(stmt.getResultSet(), configuration);

        // 1. 处理第一个结果集
        ResultMap resultMap = mappedStatement.getResultMap();
        List<E> resultList = resultSetHandler.handleResultSet(rsw, resultMap, null);
        multipleResults.addAll(resultList);

        // 2. 处理多结果集（如果有）
        while (stmt.getMoreResults()) {
            // ...
        }

        return collapseSingleResultList(multipleResults);
    }

    private <E> List<E> handleResultSet(ResultSetWrapper rsw,
                                        ResultMap resultMap,
                                        ResultMapping parentMapping) throws SQLException {
        List<E> resultList = new ArrayList<>();

        if (ResultType.MAP.equals(resultMap.getType())) {
            // 返回 Map
        } else if (ResultType.CURSOR.equals(resultMap.getType())) {
            // 返回 Cursor
        } else {
            // 返回 POJO（最常见）
            Object rowValue = createResultObject(rsw, resultMap, null, null);
            if (rowValue != null && !resultMap.getType().isPrimitive()) {
                // 自动化属性映射
                applyAutomaticMappings(rsw, resultMap, null, null);
                // 自定义映射
                applyPropertyMappings(rsw, resultMap, resultList, null, null);
            }
            resultList.add(rowValue);
        }
        return resultList;
    }
}
```

## 核心映射方法

### applyPropertyMappings：处理自定义 resultMap

```java
private <E> List<E> applyPropertyMappings(ResultSetWrapper rsw,
                                          ResultMap resultMap,
                                          List<E> resultList,
                                          String columnPrefix,
                                          ResultMapping parentMapping) {
    // 获取列名列表
    final List<String> columnNames = rsw.getColumnNames();
    final List<ResultMapping> propertyMappings = resultMap.getPropertyResultMappings();

    for (ResultMapping propertyMapping : propertyMappings) {
        // 获取列名
        String column = prependPrefix(propertyMapping.getColumn(), columnPrefix);

        // 查找匹配的列索引
        Integer columnIndex = rsw.hasColumn(column) ? rsw.getColumnIndex(column) : null;

        // 获取 TypeHandler
        TypeHandler<?> typeHandler = typeHandlerRegistry.getTypeHandler(
            propertyMapping.getJavaType(),
            propertyMapping.getJdbcType()
        );

        // 从 ResultSet 获取值
        Object value = typeHandler.getResult(rs, columnIndex);

        // 嵌套映射
        if (propertyMapping.getNestedQueryId() != null) {
            value = executeNestedQuery(propertyMapping);
        } else if (propertyMapping.getNestedResultMapId() != null) {
            value = handleNestedResultMaps(rsw, resultMap, propertyMapping, columnPrefix);
        }

        // 设置属性值（通过反射）
        applyPropertyValue(rs, propertyMapping, value);
    }
    return resultList;
}
```

### applyAutomaticMappings：自动映射

```java
private boolean applyAutomaticMappings(ResultSetWrapper rsw,
                                        ResultMap resultMap,
                                        String columnPrefix,
                                        ResultMapping parentMapping) {
    // 1. 获取未映射的列
    final List<String> unmappedColumnNames = rsw.getUnmappedColumnNames(resultMap);

    for (String columnName : unmappedColumnNames) {
        // 2. 根据列名查找匹配的属性（支持下划线转驼峰）
        String propertyName = rsw.findProperty(propertyMapping, columnPrefix);

        if (propertyName != null && !resultMap.hasProperty(propertyName)) {
            // 3. 获取对应的 TypeHandler
            TypeHandler<?> typeHandler = rsw.getTypeHandler(propertyMapping, columnName);

            // 4. 获取值并设置
            Object value = typeHandler.getResult(rs, columnName);
            applyPropertyValue(rs, propertyMapping, propertyName, value);
        }
    }
    return true;
}
```

## ResultSetHandler 处理流程图

```
ResultSet（数据库返回）
        │
        ▼
┌──────────────────────┐
│   ResultSetWrapper   │  ← 包装 ResultSet，方便处理
│  - 列名列表           │
│  - 类型信息           │
│  - 列索引映射         │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   handleResultSets   │  ← 入口方法
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  创建空对象           │  ← new User()
└──────────┬───────────┘
           │
           ├──► 是否需要嵌套映射？
           │        │
           │       是        否
           │        │         │
           │        ▼         ▼
           │  嵌套查询    自动/手动映射
           │        │
           └────────┤
                    ▼
┌──────────────────────┐
│   填充属性值          │  ← 通过反射设置
│  rs.getXxx() → obj   │
└──────────┬───────────┘
           │
           ▼
        User 对象
```

## 嵌套结果映射

### association：一对一关联

```xml
<resultMap id="orderResultMap" type="com.example.Order">
    <id property="id" column="order_id"/>
    <result property="orderNo" column="order_no"/>
    <result property="userId" column="user_id"/>

    <!-- 一对一：嵌套结果映射 -->
    <association property="user" javaType="com.example.User">
        <id property="id" column="user_id"/>
        <result property="name" column="user_name"/>
        <result property="email" column="user_email"/>
    </association>
</resultMap>

<select id="selectOrderWithUser" resultMap="orderResultMap">
    SELECT o.id AS order_id, o.order_no, o.user_id,
           u.name AS user_name, u.email AS user_email
    FROM orders o
    LEFT JOIN user u ON o.user_id = u.id
    WHERE o.id = #{id}
</select>
```

### collection：一对多关联

```xml
<resultMap id="userResultMap" type="com.example.User">
    <id property="id" column="user_id"/>
    <result property="name" column="user_name"/>

    <!-- 一对多：嵌套结果映射 -->
    <collection property="orders" ofType="com.example.Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
    </collection>
</resultMap>

<select id="selectUserWithOrders" resultMap="userResultMap">
    SELECT u.id AS user_id, u.name AS user_name,
           o.id AS order_id, o.order_no
    FROM user u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = #{id}
</select>
```

## 面试高频问题

### Q1：MyBatis 如何实现列名和属性名的自动映射？

1. **列名和属性名完全匹配**
2. **开启下划线转驼峰**后，`user_name` 匹配 `userName`
3. MyBatis 会忽略大小写差异

### Q2：`<id>` 和 `<result>` 的区别？

- `<id>` 用于标识主键列，会参与对象的唯一性判断，影响嵌套结果映射
- `<result>` 用于普通属性列

### Q3：自动映射和 resultMap 映射可以同时使用吗？

**可以**。MyBatis 会先处理 `<id>` 和 `<result>` 映射，再处理自动映射。自动映射会填充 `resultMap` 中未明确映射的列。

---

## 思考题

如果查询返回的列名和 Java 属性名完全不匹配（如数据库用中文列名），怎么处理？

答案：使用 `<result>` 明确指定映射关系：

```xml
<result property="name" column="用户名"/>
```

或者使用注解方式：

```java
@Results({
    @Result(property = "name", column = "用户名")
})
@Select("SELECT 用户名 FROM user")
String getName();
```

下一节，我们看 [TypeHandler](/framework/mybatis/type-handler) 的更多细节。
