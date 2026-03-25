# TypeHandler：类型转换的桥梁

你有没有遇到过这种问题：

```java
// 数据库存的是 0 和 1
// Java 用的是枚举
public enum Status {
    ACTIVE, INACTIVE
}
```

MyBatis 怎么知道 `0` 对应 `ACTIVE`，`1` 对应 `INACTIVE`？

答案就是 **TypeHandler**——它在 Java 类型和 JDBC 类型之间架起一座桥梁。

## TypeHandler 是什么？

`TypeHandler` 负责**Java 类型和 JDBC 类型之间的双向转换**。

```java
public interface TypeHandler<T> {
    // 设置参数到 PreparedStatement（Java → JDBC）
    void setParameter(PreparedStatement ps, int i, T parameter, JdbcType jdbcType) throws SQLException;

    // 从 ResultSet 获取值（JDBC → Java）
    T getResult(ResultSet rs, String columnName) throws SQLException;

    T getResult(ResultSet rs, int columnIndex) throws SQLException;
}
```

## 内置 TypeHandler 一览

MyBatis 内置了很多 TypeHandler，覆盖常见类型：

| Java 类型 | JDBC 类型 | TypeHandler |
|----------|----------|-------------|
| String | VARCHAR, CHAR | StringTypeHandler |
| Integer | INTEGER | IntegerTypeHandler |
| Long | BIGINT | LongTypeHandler |
| Double | DOUBLE | DoubleTypeHandler |
| Boolean | BIT | BooleanTypeHandler |
| Date | TIMESTAMP | DateTypeHandler |
| byte[] | BLOB | ByteArrayTypeHandler |
| Object | OTHER | ObjectTypeHandler |

### 注册机制

```java
// TypeHandlerRegistry 负责管理所有 TypeHandler
public class TypeHandlerRegistry {
    // JDBC Type → TypeHandler 映射
    private final Map<JdbcType, TypeHandler<?>>  jdbcTypeHandlerMap;

    // Java Type → TypeHandler 映射
    private final Map<Type, TypeHandler<?>> typeHandlerMap;

    // Java Type → JDBC Type → TypeHandler 映射（更精确的匹配）
    private final Map<Type, Map<JdbcType, TypeHandler<?>>> typeHandlerMap2;

    public TypeHandlerRegistry() {
        // 注册内置的 TypeHandler
        register(Boolean.class, new BooleanTypeHandler());
        register(String.class, new StringTypeHandler());
        register(Integer.class, new IntegerTypeHandler());
        // ...
    }
}
```

## TypeHandler 的工作原理

### 写操作：Java → JDBC

```java
public class StringTypeHandler implements TypeHandler<String> {

    @Override
    public void setParameter(PreparedStatement ps, int position,
                             String value, JdbcType jdbcType) throws SQLException {
        if (value == null) {
            // 如果值为 null，设置 JDBC NULL
            ps.setNull(position, JdbcType.VARCHAR.TYPE_CODE);
        } else {
            // 正常设置字符串
            ps.setString(position, value);
        }
    }
}
```

### 读操作：JDBC → Java

```java
public class StringTypeHandler implements TypeHandler<String> {

    @Override
    public String getResult(ResultSet rs, String columnName) throws SQLException {
        String result = rs.getString(columnName);
        // 注意：rs.getString() 和 rs.wasNull() 的配合使用
        return result;
    }

    @Override
    public String getResult(ResultSet rs, int columnIndex) throws SQLException {
        String result = rs.getString(columnIndex);
        return result;
    }
}
```

## 自定义 TypeHandler 实战

### 场景一：枚举处理

数据库存储枚举的 code，业务层使用枚举对象：

```java
// 枚举定义
public enum Status {
    ACTIVE(1, "启用"),
    INACTIVE(0, "禁用"),
    DELETED(-1, "已删除");

    private final int code;
    private final String desc;

    Status(int code, String desc) {
        this.code = code;
        this.desc = desc;
    }

    public int getCode() {
        return code;
    }

    public static Status fromCode(int code) {
        for (Status status : values()) {
            if (status.code == code) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown status code: " + code);
    }
}

// TypeHandler 实现
@MappedTypes(Status.class)
public class StatusTypeHandler implements TypeHandler<Status> {

    @Override
    public void setParameter(PreparedStatement ps, int index,
                             Status parameter, JdbcType jdbcType) throws SQLException {
        // 枚举 → 数据库存储的 code
        ps.setInt(index, parameter.getCode());
    }

    @Override
    public Status getResult(ResultSet rs, String columnName) throws SQLException {
        int code = rs.getInt(columnName);
        return Status.fromCode(code);
    }

    @Override
    public Status getResult(ResultSet rs, int columnIndex) throws SQLException {
        int code = rs.getInt(columnIndex);
        return Status.fromCode(code);
    }
}
```

### 场景二：JSON 字段处理

MySQL 5.7+ 的 JSON 类型，需要在 JSON 字符串和 Java 对象之间转换：

```java
// 需要的依赖
// <dependency>
//     <groupId>com.fasterxml.jackson.core</groupId>
//     <artifactId>jackson-databind</artifactId>
// </dependency>

public class JsonTypeHandler<T> implements TypeHandler<T> {

    private static final ObjectMapper objectMapper = new ObjectMapper();
    private Class<T> type;

    // 存储泛型类型
    public JsonTypeHandler() {}

    public JsonTypeHandler(Class<T> type) {
        this.type = type;
    }

    @Override
    public void setParameter(PreparedStatement ps, int index,
                             T parameter, JdbcType jdbcType) throws SQLException {
        if (parameter == null) {
            ps.setNull(index, Types.VARCHAR);
        } else {
            // Java 对象 → JSON 字符串
            String json = objectMapper.writeValueAsString(parameter);
            ps.setString(index, json);
        }
    }

    @Override
    public T getResult(ResultSet rs, String columnName) throws SQLException {
        String json = rs.getString(columnName);
        if (json == null) {
            return null;
        }
        return parseJson(json);
    }

    @Override
    public T getResult(ResultSet rs, int columnIndex) throws SQLException {
        String json = rs.getString(columnIndex);
        if (json == null) {
            return null;
        }
        return parseJson(json);
    }

    private T parseJson(String json) {
        try {
            return objectMapper.readValue(json, type);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to parse JSON: " + json, e);
        }
    }
}
```

### 场景三：模糊查询

需要处理 LIKE 查询中的特殊字符：

```java
public class LikeEscapeTypeHandler implements TypeHandler<String> {

    @Override
    public void setParameter(PreparedStatement ps, int index,
                             String parameter, JdbcType jdbcType) throws SQLException {
        if (parameter == null) {
            ps.setNull(index, Types.VARCHAR);
        } else {
            // 转义特殊字符，防止注入
            String escaped = escapeLikeParameter(parameter);
            ps.setString(index, escaped);
        }
    }

    private String escapeLikeParameter(String param) {
        // 转义 LIKE 中的特殊字符
        if (param == null) {
            return null;
        }
        return param
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_");
    }

    @Override
    public String getResult(ResultSet rs, String columnName) throws SQLException {
        return rs.getString(columnName);
    }

    @Override
    public String getResult(ResultSet rs, int columnIndex) throws SQLException {
        return rs.getString(columnIndex);
    }
}
```

## TypeHandler 的注册方式

### 方式一：注解方式（推荐）

```java
@MappedTypes(Status.class)
@MappedJdbcTypes(JdbcType.INTEGER)
public class StatusTypeHandler implements TypeHandler<Status> {
    // ...
}
```

### 方式二：配置文件

```xml
<typeHandlers>
    <package name="com.example.handler"/>
</typeHandlers>
```

### 方式三：显式注册

```xml
<typeHandlers>
    <typeHandler handler="com.example.handler.StatusTypeHandler"
                 javaType="com.example.entity.Status"/>
</typeHandlers>
```

### 方式四：注解在实体字段上

```java
public class User {
    @TableField(typeHandler = StatusTypeHandler.class)
    private Status status;
}
```

## TypeHandler 选择规则

当 MyBatis 需要处理某个类型时，按以下优先级选择：

```
1. 先查找精确匹配（Java Type + JDBC Type）
2. 再查找 Java Type 匹配
3. 最后查找 JDBC Type 匹配
4. 使用默认的 ObjectTypeHandler
```

```java
// 查找逻辑
public <T> TypeHandler<T> getTypeHandler(Type type, JdbcType jdbcType) {
    // 1. 精确匹配
    Map<JdbcType, TypeHandler<?>> jdbcMap = typeHandlerMap2.get(type);
    if (jdbcMap != null) {
        TypeHandler<T> handler = jdbcMap.get(jdbcType);
        if (handler != null) {
            return handler;
        }
    }

    // 2. Java Type 匹配
    TypeHandler<T> handler = (TypeHandler<T>) typeHandlerMap.get(type);
    if (handler != null) {
        return handler;
    }

    // 3. 使用 ObjectTypeHandler
    return (TypeHandler<T>) new ObjectTypeHandler();
}
```

## 面试高频问题

### Q1：MyBatis 内置了哪些 TypeHandler？

MyBatis 为所有基本类型、常用类型和包装类提供了内置 TypeHandler，覆盖 String、Integer、Long、Boolean、Date 等常见类型。

### Q2：如何自定义 TypeHandler？

1. 实现 `TypeHandler<T>` 接口
2. 使用 `@MappedTypes` 注解指定处理的 Java 类型
3. 使用 `@MappedJdbcTypes` 注解指定处理的 JDBC 类型
4. 在配置文件中注册或通过包扫描自动注册

### Q3：TypeHandler 是在哪里被调用的？

- **ParameterHandler.setParameters()** 中调用 `TypeHandler.setParameter()` 进行写操作
- **ResultSetHandler** 中调用 `TypeHandler.getResult()` 进行读操作

---

## 思考题

如果一个字段的值可能是 `null`，TypeHandler 如何处理？

答案：TypeHandler 的 `setParameter()` 和 `getResult()` 方法内部会检查 `null` 值：

```java
// 写操作
if (parameter == null) {
    ps.setNull(index, JdbcType.VARCHAR.TYPE_CODE);
} else {
    ps.setString(index, parameter);
}

// 读操作
String value = rs.getString(columnName);
// rs.getString() 对 null 值的处理是安全的，返回 null
return value;
```

所以在使用自定义 TypeHandler 时，**一定要处理 null 值的情况**。

下一节，我们看 [MyBatis 缓存机制](/framework/mybatis/cache)。
