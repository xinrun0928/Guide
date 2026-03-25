# ParameterHandler：参数绑定与 #{} vs ${} 的区别

你有没有遇到过这种诡异的情况：

```java
// 方式一
List&lt;User&gt; users = mapper.selectByName("zhang");

// 方式二
List&lt;User&gt; users = mapper.selectByName("'zhang'"); // 加了引号！
```

方式一会报错，方式二反而能工作？

这背后就是 **#{} 和 ${} 的本质区别**。

## ParameterHandler 是什么？

`ParameterHandler` 负责**将 Java 对象的属性值绑定到 SQL 的占位符上**。

```java
public interface ParameterHandler {
    // 获取参数对象
    Object getParameterObject();

    // 将参数设置到 PreparedStatement
    void setParameters(PreparedStatement ps) throws SQLException;
}
```

它的实现类是 `DefaultParameterHandler`，是 MyBatis 核心组件之一。

## 两种占位符的本质区别

### #{}：预编译参数

```java
// SQL 中的写法
SELECT * FROM user WHERE name = #{name}

// 最终执行的 SQL（预编译）
SELECT * FROM user WHERE name = ?  -- 占位符
```

**原理**：

1. `#{}` 会被解析成 `?` 占位符
2. 参数值通过 `PreparedStatement.setXxx()` 方法绑定
3. 数据库使用预编译机制执行

```java
// 编译：SELECT * FROM user WHERE name = ?
// 执行时：ps.setString(1, "zhang")
// 最终执行：SELECT * FROM user WHERE name = 'zhang'
```

**特点**：

- 参数值会经过 TypeHandler 处理
- 字符串类型会自动添加引号
- **安全**，能防止 SQL 注入

### ${}：直接替换

```java
// SQL 中的写法
SELECT * FROM user ORDER BY ${columnName}

// 最终执行的 SQL（直接替换）
SELECT * FROM user ORDER BY id
```

**原理**：

1. `${}` 直接把参数值替换到 SQL 中
2. 不经过预编译机制
3. 参数值被当作 SQL 语句的一部分

**特点**：

- 参数值不会添加引号
- **危险**，可能导致 SQL 注入
- 适用于动态表名、列名等场景

## 安全使用指南

### ❌ 危险用法

```java
// 用户输入可能被注入
@Select("SELECT * FROM user WHERE name = '${name}'")
List&lt;User&gt; searchByName(String name);

// 如果用户输入：zhang' OR '1'='1
// 最终 SQL：SELECT * FROM user WHERE name = 'zhang' OR '1'='1'
```

### ✅ 正确用法

```java
// #{} 自动处理引号
@Select("SELECT * FROM user WHERE name = #{name}")
List&lt;User&gt; searchByName(String name);

// ${} 只用于安全的场景
@Select("SELECT * FROM ${tableName}")
List&lt;Map&lt;String, Object&gt;&gt; getAllFrom(String tableName);

// 如果 tableName 来自白名单，是安全的
private static final Set&lt;String&gt; ALLOWED_TABLES = Set.of("user", "order", "product");
```

## 参数绑定过程详解

```java
public class DefaultParameterHandler implements ParameterHandler {

    private final TypeHandlerRegistry typeHandlerRegistry;
    private final MappedStatement mappedStatement;
    private final Object parameterObject;
    private final BoundSql boundSql;
    private final Connection connection;

    @Override
    public void setParameters(PreparedStatement ps) {
        // 1. 获取参数映射列表（按顺序）
        List&lt;ParameterMapping&gt; parameterMappings = boundSql.getParameterMappings();

        for (int i = 0; i < parameterMappings.size(); i++) {
            ParameterMapping parameterMapping = parameterMappings.get(i);

            // 2. 如果是 'extra' 参数（动态 SQL 中的额外参数），跳过
            if (parameterMapping.getMode() == ParameterMode.OUT) {
                continue;
            }

            // 3. 获取参数值
            Object value;
            String propertyName = parameterMapping.getPropertyName();

            if (boundSql.hasAdditionalParameter(propertyName)) {
                // 动态 SQL 产生的额外参数
                value = boundSql.getAdditionalParameter(propertyName);
            } else if (parameterObject == null) {
                // 参数对象为 null
                value = null;
            } else if (typeHandlerRegistry.hasTypeHandler(parameterObject.getClass())) {
                // 基本类型或 String，直接使用
                value = parameterObject;
            } else {
                // 复杂对象，通过属性路径获取
                value = getBeanProperty(parameterObject, propertyName);
            }

            // 4. 使用 TypeHandler 设置参数
            TypeHandler&lt;Object&gt; typeHandler = parameterMapping.getTypeHandler();
            JdbcType jdbcType = parameterMapping.getJdbcType();

            if (value == null && jdbcType == null) {
                // 如果值为空且未指定 JDBC 类型，使用默认类型
                jdbcType = JdbcType.OTHER;
            }

            // 5. 核心调用：typeHandler.setParameter()
            typeHandler.setParameter(ps, i + 1, value, jdbcType);
        }
    }
}
```

## TypeHandler 的作用

`TypeHandler` 负责 Java 类型和 JDBC 类型之间的转换。

### 内置 TypeHandler

MyBatis 内置了很多 TypeHandler：

| Java 类型 | JDBC 类型 | TypeHandler |
|----------|----------|-------------|
| String | VARCHAR | StringTypeHandler |
| Integer | INTEGER | IntegerTypeHandler |
| Long | BIGINT | LongTypeHandler |
| Date | TIMESTAMP | DateTypeHandler |
| Boolean | BIT | BooleanTypeHandler |
| byte[] | BLOB | ByteArrayTypeHandler |

### TypeHandler 的选择逻辑

```java
// 当设置 String 类型的参数时
ps.setString(1, "zhang");

// 当设置 Integer 类型的参数时
ps.setInt(1, 123);

// 当设置 Date 类型的参数时
ps.setTimestamp(1, new Timestamp(date.getTime()));
```

### 自定义 TypeHandler 示例

场景：数据库存储的是枚举的 code，需要在枚举和对象之间转换。

```java
// 枚举定义
public enum Status {
    ACTIVE(1, "启用"),
    INACTIVE(0, "禁用");

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
public class StatusTypeHandler implements TypeHandler&lt;Status&gt; {

    @Override
    public void setParameter(PreparedStatement ps, int index,
                             Status parameter, JdbcType jdbcType) throws SQLException {
        // 写入数据库时：枚举 → code
        ps.setInt(index, parameter.getCode());
    }

    @Override
    public Status getResult(ResultSet rs, String columnName) throws SQLException {
        // 读取时：code → 枚举
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

## 多参数处理

当 Mapper 方法有多个参数时，MyBatis 会使用 `ParamMap` 包装：

```java
// Mapper 定义
List&lt;User&gt; selectByNameAndAge(String name, Integer age);

// MyBatis 内部会包装成
ParamMap {
    "name" → "zhang",
    "age" → 25,
    "param1" → "zhang",  // 额外添加的别名
    "param2" → 25
}
```

### 使用 @Param 指定参数名

```java
List&lt;User&gt; selectByNameAndAge(@Param("name") String name,
                               @Param("age") Integer age);

// ParamMap 中就是
ParamMap {
    "name" → "zhang",
    "age" → 25
}
```

### 使用 POJO 传递参数

```java
// 定义查询条件类
public class UserQuery {
    private String name;
    private Integer age;
    // getters and setters
}

// Mapper 定义
List&lt;User&gt; selectByQuery(UserQuery query);

// 使用时
userQuery.setName("zhang");
userQuery.setAge(25);
```

## 面试高频问题

### Q1：#{} 和 ${} 的区别是什么？

| 区别 | #{} | ${} |
|-----|-----|-----|
| 处理方式 | 预编译参数 | 直接替换 |
| SQL 注入 | 安全 | 危险 |
| 引号处理 | 自动添加 | 不添加 |
| 适用场景 | 普通参数 | 动态列名/表名 |

### Q2：什么时候必须用 ${}？

只有当需要动态指定**标识符**（表名、列名）时才能用 ${}，但必须确保来源是可信的（如白名单）。

### Q3：ParameterHandler 在 MyBatis 架构中的位置？

```
Executor
    │
    └── StatementHandler
            │
            └── ParameterHandler（参数绑定）
```

---

## 思考题

如果参数是 `null`，会怎么处理？

```java
// name 为 null 时
SELECT * FROM user WHERE name = #{name}
```

答案：当参数为 `null` 时：

- 如果 JDBC 类型明确（如 `VARCHAR`），会设置 `ps.setNull(index, Types.VARCHAR)`
- 如果 JDBC 类型不明确，会设置 `ps.setNull(index, Types.OTHER)`

可以通过 `<setting name="jdbcTypeForNull">NULL</setting>` 来统一处理。

下一节，我们看 [ResultSetHandler](/framework/mybatis/resultset-handler) 的结果映射机制。
