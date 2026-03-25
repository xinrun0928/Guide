# Spring JDBC Template 使用

你想过没有，为什么学了 MyBatis，还要学 JDBC Template？

因为 **JDBC Template 是 MyBatis、Hibernate 等 ORM 框架的底层基础**。

理解 JDBC Template，你就能理解 ORM 框架在「封装」什么、「简化」什么。这是每个 Java 工程师的必修课。

## JDBC Template 简介

### 什么是 JDBC Template

JDBC Template 是 Spring 提供的 JDBC 封装类，它简化了 JDBC 的操作，同时保留了 SQL 的可控性。

```
JDBC 原生流程：
Connection → Statement → SQL → ResultSet → 手动映射 → 关闭资源

JDBC Template 流程：
jdbcTemplate.execute(sql) → 自动获取连接 → 自动关闭资源
```

### 核心优势

| 特性 | 说明 |
|-----|-----|
| 自动资源管理 | 无需手动关闭 Connection、Statement、ResultSet |
| 异常转换 | 将 SQLException 转换为 Spring 的 DataAccessException（运行时异常） |
| 批量操作 | 支持批量执行 SQL |
| 回调机制 | 提供 RowMapper 简化结果映射 |
| 事务支持 | 与 Spring 事务管理器无缝集成 |

## 快速开始

### 添加依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-java</artifactId>
</dependency>
<dependency>
    <groupId>com.zaxxer</groupId>
    <artifactId>HikariCP</artifactId>
</dependency>
```

### 配置数据源

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb?useSSL=false&amp;serverTimezone=UTC
    username: root
    password: root
    driver-class-name: com.mysql.cj.jdbc.Driver
    hikari:
      maximum-pool-size: 10
      minimum-idle: 5
      connection-timeout: 30000
```

Spring Boot 会自动创建 `DataSource` 和 `JdbcTemplate`：

```java
@Autowired
private JdbcTemplate jdbcTemplate;
```

## 基础 CRUD 操作

### 1. 查询单个对象

```java
// 使用 RowMapper
public User findById(Long id) {
    String sql = "SELECT * FROM user WHERE id = ?";
    return jdbcTemplate.queryForObject(sql, new UserRowMapper(), id);
}

public class UserRowMapper implements RowMapper&lt;User&gt; {
    @Override
    public User mapRow(ResultSet rs, int rowNum) throws SQLException {
        User user = new User();
        user.setId(rs.getLong("id"));
        user.setName(rs.getString("name"));
        user.setEmail(rs.getString("email"));
        user.setAge(rs.getInt("age"));
        user.setCreatedAt(rs.getTimestamp("created_at"));
        return user;
    }
}
```

```java
// 使用 Lambda 简化（Java 8+）
public User findById(Long id) {
    String sql = "SELECT * FROM user WHERE id = ?";
    return jdbcTemplate.queryForObject(sql, (rs, rowNum) -&gt; {
        User user = new User();
        user.setId(rs.getLong("id"));
        user.setName(rs.getString("name"));
        user.setEmail(rs.getString("email"));
        user.setAge(rs.getInt("age"));
        return user;
    }, id);
}
```

### 2. 查询单个值

```java
// 查询单个值
public String findNameById(Long id) {
    String sql = "SELECT name FROM user WHERE id = ?";
    return jdbcTemplate.queryForObject(sql, String.class, id);
}

// 查询数量
public int countUsers() {
    String sql = "SELECT COUNT(*) FROM user";
    return jdbcTemplate.queryForObject(sql, Integer.class);
}

// 查询布尔值
public boolean existsById(Long id) {
    String sql = "SELECT COUNT(*) > 0 FROM user WHERE id = ?";
    return jdbcTemplate.queryForObject(sql, Boolean.class, id);
}
```

### 3. 查询列表

```java
// 查询用户列表
public List&lt;User&gt; findAll() {
    String sql = "SELECT * FROM user ORDER BY created_at DESC";
    return jdbcTemplate.query(sql, new UserRowMapper());
}

// 带条件查询
public List&lt;User&gt; findByAgeGreaterThan(Integer minAge) {
    String sql = "SELECT * FROM user WHERE age > ? ORDER BY age";
    return jdbcTemplate.query(sql, new UserRowMapper(), minAge);
}

// Lambda 写法
public List&lt;User&gt; findByName(String name) {
    String sql = "SELECT * FROM user WHERE name LIKE ?";
    return jdbcTemplate.query(sql, (rs, rowNum) -&gt; {
        User user = new User();
        user.setId(rs.getLong("id"));
        user.setName(rs.getString("name"));
        user.setEmail(rs.getString("email"));
        return user;
    }, "%" + name + "%");
}
```

### 4. 插入数据

```java
public int insertUser(User user) {
    String sql = "INSERT INTO user (name, email, age, created_at) VALUES (?, ?, ?, ?)";
    
    KeyHolder keyHolder = new GeneratedKeyHolder();
    
    jdbcTemplate.update(connection -&gt; {
        PreparedStatement ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
        ps.setString(1, user.getName());
        ps.setString(2, user.getEmail());
        ps.setInt(3, user.getAge());
        ps.setTimestamp(4, new Timestamp(System.currentTimeMillis()));
        return ps;
    }, keyHolder);
    
    // 获取自增主键
    Number key = keyHolder.getKey();
    if (key != null) {
        user.setId(key.longValue());
    }
    
    return 1;
}
```

### 5. 更新数据

```java
public int updateUser(User user) {
    String sql = "UPDATE user SET name = ?, email = ?, age = ? WHERE id = ?";
    return jdbcTemplate.update(sql, 
        user.getName(),
        user.getEmail(),
        user.getAge(),
        user.getId()
    );
}

// 部分更新
public int updateName(Long id, String name) {
    String sql = "UPDATE user SET name = ? WHERE id = ?";
    return jdbcTemplate.update(sql, name, id);
}
```

### 6. 删除数据

```java
public int deleteById(Long id) {
    String sql = "DELETE FROM user WHERE id = ?";
    return jdbcTemplate.update(sql, id);
}
```

## 批量操作

### 批量插入

```java
public void batchInsertUsers(List&lt;User&gt; users) {
    String sql = "INSERT INTO user (name, email, age, created_at) VALUES (?, ?, ?, ?)";
    
    List&lt;Object[]&gt; batchArgs = users.stream()
        .map(user -&gt; new Object[]{
            user.getName(),
            user.getEmail(),
            user.getAge(),
            new Timestamp(System.currentTimeMillis())
        })
        .collect(Collectors.toList());
    
    jdbcTemplate.batchUpdate(sql, batchArgs);
}
```

### 批量更新

```java
public void batchUpdateUsers(List&lt;User&gt; users) {
    String sql = "UPDATE user SET name = ?, email = ? WHERE id = ?";
    
    List&lt;Object[]&gt; batchArgs = users.stream()
        .map(user -&gt; new Object[]{
            user.getName(),
            user.getEmail(),
            user.getId()
        })
        .collect(Collectors.toList());
    
    jdbcTemplate.batchUpdate(sql, batchArgs);
}
```

## 命名参数查询

使用 `NamedParameterJdbcTemplate`，告别 `?` 占位符：

```java
@Autowired
private NamedParameterJdbcTemplate namedParameterJdbcTemplate;

public User findByNameAndEmail(String name, String email) {
    String sql = "SELECT * FROM user WHERE name = :name AND email = :email";
    
    Map&lt;String, Object&gt; params = new HashMap&lt;&gt;();
    params.put("name", name);
    params.put("email", email);
    
    return namedParameterJdbcTemplate.queryForObject(sql, params, new UserRowMapper());
}

// 使用 SqlParameterSource 更方便
public User findByNameAndEmailSqlParameterSource(String name, String email) {
    String sql = "SELECT * FROM user WHERE name = :name AND email = :email";
    
    SqlParameterSource params = new MapSqlParameterSource()
        .addValue("name", name)
        .addValue("email", email);
    
    return namedParameterJdbcTemplate.queryForObject(sql, params, new UserRowMapper());
}

// 使用 BeanPropertySqlParameterSource（自动从对象取值）
public User findByBeanProperty(User user) {
    String sql = "SELECT * FROM user WHERE name = :name AND email = :email";
    
    SqlParameterSource params = new BeanPropertySqlParameterSource(user);
    
    return namedParameterJdbcTemplate.queryForObject(sql, params, new UserRowMapper());
}
```

## 事务管理

### 声明式事务

```java
@Service
public class UserService {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;
    
    @Transactional(rollbackFor = Exception.class)
    public void transferMoney(Long fromId, Long toId, BigDecimal amount) {
        // 扣钱
        String sql1 = "UPDATE account SET balance = balance - ? WHERE user_id = ?";
        jdbcTemplate.update(sql1, amount, fromId);
        
        // 故意抛异常测试回滚
        if (amount.compareTo(BigDecimal.ZERO) &lt; 0) {
            throw new RuntimeException("金额不能为负数");
        }
        
        // 加钱
        String sql2 = "UPDATE account SET balance = balance + ? WHERE user_id = ?";
        jdbcTemplate.update(sql2, amount, toId);
    }
}
```

### 编程式事务

```java
@Service
public class OrderService {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;
    
    @Autowired
    private PlatformTransactionManager transactionManager;
    
    public void createOrder(Order order) {
        TransactionTemplate transactionTemplate = new TransactionTemplate(transactionManager);
        transactionTemplate.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
        
        transactionTemplate.execute(status -&gt; {
            try {
                // 创建订单
                String sql1 = "INSERT INTO orders (user_id, amount, status) VALUES (?, ?, ?)";
                jdbcTemplate.update(sql1, order.getUserId(), order.getAmount(), "PENDING");
                
                // 更新库存
                String sql2 = "UPDATE product SET stock = stock - 1 WHERE id = ?";
                jdbcTemplate.update(sql2, order.getProductId());
                
                return true;
            } catch (Exception e) {
                status.setRollbackOnly();  // 标记回滚
                throw e;
            }
        });
    }
}
```

## 高级用法

### 1. 查询分页

```java
public Page&lt;User&gt; findByPage(int page, int size, String name) {
    String countSql = "SELECT COUNT(*) FROM user WHERE name LIKE ?";
    String dataSql = "SELECT * FROM user WHERE name LIKE ? LIMIT ? OFFSET ?";
    
    String likeName = "%" + name + "%";
    
    // 查询总数
    int total = jdbcTemplate.queryForObject(countSql, Integer.class, likeName);
    
    // 查询数据
    int offset = (page - 1) * size;
    List&lt;User&gt; users = jdbcTemplate.query(dataSql, new UserRowMapper(), likeName, size, offset);
    
    return new Page&lt;&gt;(users, total, page, size);
}

public class Page&lt;T&gt; {
    private List&lt;T&gt; data;
    private long total;
    private int page;
    private int size;
    
    public Page(List&lt;T&gt; data, long total, int page, int size) {
        this.data = data;
        this.total = total;
        this.page = page;
        this.size = size;
    }
    
    public int getTotalPages() {
        return (int) Math.ceil((double) total / size);
    }
}
```

### 2. 多表查询结果映射

```java
// 查询用户及其订单
public List&lt;UserOrderVO&gt; findUserOrders() {
    String sql = "SELECT u.id, u.name, o.order_no, o.amount " +
                 "FROM user u LEFT JOIN orders o ON u.id = o.user_id " +
                 "ORDER BY u.id";
    
    return jdbcTemplate.query(sql, (rs, rowNum) -&gt; {
        UserOrderVO vo = new UserOrderVO();
        vo.setUserId(rs.getLong("id"));
        vo.setUserName(rs.getString("name"));
        vo.setOrderNo(rs.getString("order_no"));
        vo.setAmount(rs.getBigDecimal("amount"));
        return vo;
    });
}
```

### 3. 调用存储过程

```java
public void callProcedure(Long userId) {
    String sql = "{CALL update_user_status(?)}";
    jdbcTemplate.call(connection -&gt; {
        CallableStatement cs = connection.prepareCall(sql);
        cs.setLong(1, userId);
        return cs;
    }, Collections.emptyList());
}

// 调用有返回值的存储过程
public User callFunction(Long userId) {
    String sql = "{? = CALL get_user_by_id(?)}";
    
    Map&lt;String, Object&gt; result = jdbcTemplate.call(connection -&gt; {
        CallableStatement cs = connection.prepareCall(sql);
        cs.registerOutParameter(1, Types.REF_CURSOR);
        cs.setLong(2, userId);
        return cs;
    }, Collections.emptyList());
    
    // 处理结果
    // ...
}
```

## 异常处理

### Spring 数据访问异常体系

JDBC Template 会将 `SQLException` 转换为 Spring 的统一异常：

```
DataAccessException（根异常）
  ├─ DataIntegrityViolationException（数据完整性违规）
  ├─ DuplicateKeyException（重复键）
  ├─ DeadlockLoserDataAccessException（死锁）
  ├─ CannotAcquireLockException（无法获取锁）
  ├─ QueryTimeoutException（查询超时）
  └─ ...
```

### 异常处理示例

```java
@Service
public class UserService {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;
    
    public void saveUser(User user) {
        try {
            String sql = "INSERT INTO user (name, email) VALUES (?, ?)";
            jdbcTemplate.update(sql, user.getName(), user.getEmail());
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException("数据已存在，邮箱不能重复");
        } catch (DuplicateKeyException e) {
            throw new BusinessException("主键或唯一索引冲突");
        } catch (Exception e) {
            throw new RuntimeException("保存用户失败", e);
        }
    }
}
```

## 最佳实践

### 1. 使用 RowMapper 预编译

```java
@Component
public class UserRowMapper implements RowMapper&lt;User&gt; {
    
    // 单例模式，避免重复创建
    public static final UserRowMapper INSTANCE = new UserRowMapper();
    
    private UserRowMapper() {}
    
    @Override
    public User mapRow(ResultSet rs, int rowNum) throws SQLException {
        User user = new User();
        user.setId(rs.getLong("id"));
        user.setName(rs.getString("name"));
        user.setEmail(rs.getString("email"));
        user.setAge(rs.getInt("age"));
        user.setCreatedAt(rs.getTimestamp("created_at"));
        return user;
    }
}

// 使用
public User findById(Long id) {
    return jdbcTemplate.queryForObject(
        "SELECT * FROM user WHERE id = ?", 
        UserRowMapper.INSTANCE, 
        id
    );
}
```

### 2. SQL 日志打印

```yaml
logging:
  level:
    org.springframework.jdbc.core: DEBUG
    org.springframework.jdbc.core.StatementCreatorFactory: DEBUG
```

### 3. 防止 SQL 注入

```java
// 使用占位符 ?，不要拼接 SQL
String sql = "SELECT * FROM user WHERE name = ?";
jdbcTemplate.query(sql, rowMapper, name);  // 安全

// 错误写法
String sql = "SELECT * FROM user WHERE name = '" + name + "'";  // SQL 注入风险！
```

### 4. 大数据量处理

```java
// 分批处理大量数据
public void processLargeData(List&lt;User&gt; users) {
    String sql = "INSERT INTO user (name, email) VALUES (?, ?)";
    
    List&lt;Object[]&gt; batch = new ArrayList&lt;&gt;();
    int batchSize = 1000;
    int count = 0;
    
    for (User user : users) {
        batch.add(new Object[]{user.getName(), user.getEmail()});
        count++;
        
        if (count % batchSize == 0) {
            jdbcTemplate.batchUpdate(sql, batch);
            batch.clear();
        }
    }
    
    // 处理剩余数据
    if (!batch.isEmpty()) {
        jdbcTemplate.batchUpdate(sql, batch);
    }
}
```

## 性能对比

| 操作 | JDBC 原生 | JDBC Template | MyBatis | JPA |
|-----|----------|---------------|---------|-----|
| 样板代码 | 多 | 少 | 少 | 少 |
| SQL 控制 | 完全可控 | 完全可控 | 需配置 | 不推荐 |
| 学习曲线 | 陡 | 平缓 | 中等 | 陡 |
| 性能 | 最高 | 高 | 高 | 中 |
| 维护性 | 差 | 中 | 好 | 好 |
| 适用场景 | 极致性能 | 简单 CRUD | 复杂 SQL | 快速开发 |

---

## 留给你的问题

JDBC Template 已经帮你处理了资源关闭、异常转换这些繁琐的事。

但你有没有想过：为什么它能做到这些？

如果你去翻看 `JdbcTemplate` 的源码，你会发现它内部做的事情，其实你都能自己做——只是更麻烦。

**理解「封装了什么」，才能理解框架的价值。**

建议你找时间看看 `JdbcTemplate` 的核心方法 `execute(Callback)` 的实现，这对理解 Spring 的设计思想会很有帮助。
