# JDBC 执行流程：手写实现与核心原理

你有没有想过，MyBatis、Hibernate 这些框架底层是怎么操作数据库的？

它们都离不开 JDBC——Java 数据库连接的基石。

这一节，我们从零开始，手写一个完整的 JDBC 操作，理解数据库交互的本质。

## JDBC 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      JDBC 架构图                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐                                               │
│  │ Java 应用程序 │                                               │
│  └──────┬──────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐                                               │
│  │   JDBC API   │  (java.sql 包)                               │
│  │  Connection  │                                               │
│  │  Statement   │                                               │
│  │  ResultSet   │                                               │
│  └──────┬──────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐                                               │
│  │ JDBC Driver  │  (各数据库厂商实现)                            │
│  │   Manager    │                                               │
│  └──────┬──────┘                                               │
│         │                                                        │
│    ┌────┴────┐                                                 │
│    ▼         ▼                                                 │
│ ┌──────┐ ┌──────┐                                              │
│ │MySQL │ │Oracle│                                              │
│ │ Driver│ │Driver│                                              │
│ └──────┘ └──────┘                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## JDBC 核心 API

| 接口/类 | 作用 |
|---------|------|
| `DriverManager` | 加载驱动，创建连接 |
| `Connection` | 数据库连接，管理事务 |
| `Statement` | 执行 SQL 语句 |
| `PreparedStatement` | 预编译 SQL，防止注入 |
| `ResultSet` | 结果集遍历 |
| `Driver` | 数据库驱动接口 |

## JDBC 执行流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    JDBC 执行流程                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 加载驱动                                                    │
│     Class.forName("com.mysql.cj.jdbc.Driver");                  │
│          │                                                      │
│          ▼                                                      │
│  2. 获取连接                                                    │
│     Connection conn = DriverManager.getConnection(url, user, pwd);│
│          │                                                      │
│          ▼                                                      │
│  3. 创建语句                                                    │
│     Statement stmt = conn.createStatement();                     │
│          │                                                      │
│          ▼                                                      │
│  4. 执行 SQL                                                    │
│     ResultSet rs = stmt.executeQuery("SELECT ...");             │
│          │                                                      │
│          ▼                                                      │
│  5. 处理结果                                                    │
│     while (rs.next()) { ... }                                   │
│          │                                                      │
│          ▼                                                      │
│  6. 关闭资源                                                    │
│     rs.close(); stmt.close(); conn.close();                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 手写实现 CRUD

### 1. 查询单个对象

```java
public class JdbcUserDao {

    private static final String URL = "jdbc:mysql://localhost:3306/test?useUnicode=true&characterEncoding=utf-8";
    private static final String USER = "root";
    private static final String PASSWORD = "root";

    /**
     * 根据 ID 查询用户
     */
    public User findById(Long id) {
        Connection conn = null;
        PreparedStatement pstmt = null;
        ResultSet rs = null;
        try {
            // 1. 获取连接
            conn = DriverManager.getConnection(URL, USER, PASSWORD);

            // 2. 预编译 SQL
            String sql = "SELECT id, name, age, email FROM user WHERE id = ?";
            pstmt = conn.prepareStatement(sql);
            pstmt.setLong(1, id);

            // 3. 执行查询
            rs = pstmt.executeQuery();

            // 4. 处理结果
            if (rs.next()) {
                User user = new User();
                user.setId(rs.getLong("id"));
                user.setName(rs.getString("name"));
                user.setAge(rs.getInt("age"));
                user.setEmail(rs.getString("email"));
                return user;
            }
            return null;
        } catch (Exception e) {
            throw new RuntimeException("查询用户失败", e);
        } finally {
            // 5. 关闭资源（注意顺序）
            close(rs, pstmt, conn);
        }
    }

    private void close(ResultSet rs, PreparedStatement pstmt, Connection conn) {
        if (rs != null) {
            try {
                rs.close();
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
        if (pstmt != null) {
            try {
                pstmt.close();
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
        if (conn != null) {
            try {
                conn.close();
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
    }
}
```

### 2. 查询列表

```java
/**
 * 查询用户列表
 */
public List&lt;User&gt; findAll() {
    Connection conn = null;
    PreparedStatement pstmt = null;
    ResultSet rs = null;
    try {
        conn = DriverManager.getConnection(URL, USER, PASSWORD);
        String sql = "SELECT id, name, age, email FROM user WHERE status = 1 ORDER BY id";
        pstmt = conn.prepareStatement(sql);
        rs = pstmt.executeQuery();

        List&lt;User&gt; users = new ArrayList&lt;&gt;();
        while (rs.next()) {
            User user = new User();
            user.setId(rs.getLong("id"));
            user.setName(rs.getString("name"));
            user.setAge(rs.getInt("age"));
            user.setEmail(rs.getString("email"));
            users.add(user);
        }
        return users;
    } catch (Exception e) {
        throw new RuntimeException("查询用户列表失败", e);
    } finally {
        close(rs, pstmt, conn);
    }
}
```

### 3. 插入数据

```java
/**
 * 插入用户
 */
public Long insert(User user) {
    Connection conn = null;
    PreparedStatement pstmt = null;
    ResultSet rs = null;
    try {
        conn = DriverManager.getConnection(URL, USER, PASSWORD);

        // 返回自增主键
        String sql = "INSERT INTO user (name, age, email, status) VALUES (?, ?, ?, 1)";
        pstmt = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
        pstmt.setString(1, user.getName());
        pstmt.setInt(2, user.getAge());
        pstmt.setString(3, user.getEmail());

        // 执行插入
        int rows = pstmt.executeUpdate();

        // 获取自增主键
        if (rows > 0) {
            rs = pstmt.getGeneratedKeys();
            if (rs.next()) {
                return rs.getLong(1);
            }
        }
        return null;
    } catch (Exception e) {
        throw new RuntimeException("插入用户失败", e);
    } finally {
        close(rs, pstmt, conn);
    }
}
```

### 4. 更新数据

```java
/**
 * 更新用户
 */
public int update(User user) {
    Connection conn = null;
    PreparedStatement pstmt = null;
    try {
        conn = DriverManager.getConnection(URL, USER, PASSWORD);
        String sql = "UPDATE user SET name = ?, age = ?, email = ? WHERE id = ?";
        pstmt = conn.prepareStatement(sql);
        pstmt.setString(1, user.getName());
        pstmt.setInt(2, user.getAge());
        pstmt.setString(3, user.getEmail());
        pstmt.setLong(4, user.getId());

        return pstmt.executeUpdate();
    } catch (Exception e) {
        throw new RuntimeException("更新用户失败", e);
    } finally {
        close(null, pstmt, conn);
    }
}
```

### 5. 删除数据

```java
/**
 * 删除用户
 */
public int delete(Long id) {
    Connection conn = null;
    PreparedStatement pstmt = null;
    try {
        conn = DriverManager.getConnection(URL, USER, PASSWORD);
        String sql = "DELETE FROM user WHERE id = ?";
        pstmt = conn.prepareStatement(sql);
        pstmt.setLong(1, id);

        return pstmt.executeUpdate();
    } catch (Exception e) {
        throw new RuntimeException("删除用户失败", e);
    } finally {
        close(null, pstmt, conn);
    }
}
```

### 6. 批量操作

```java
/**
 * 批量插入
 */
public void batchInsert(List&lt;User&gt; users) {
    Connection conn = null;
    PreparedStatement pstmt = null;
    try {
        conn = DriverManager.getConnection(URL, USER, PASSWORD);

        // 关闭自动提交，开启事务
        conn.setAutoCommit(false);

        String sql = "INSERT INTO user (name, age, email) VALUES (?, ?, ?)";
        pstmt = conn.prepareStatement(sql);

        for (User user : users) {
            pstmt.setString(1, user.getName());
            pstmt.setInt(2, user.getAge());
            pstmt.setString(3, user.getEmail());
            pstmt.addBatch();  // 添加到批次
        }

        // 执行批量
        pstmt.executeBatch();

        // 提交事务
        conn.commit();
    } catch (Exception e) {
        if (conn != null) {
            try {
                conn.rollback();  // 回滚
            } catch (SQLException ex) {
                ex.printStackTrace();
            }
        }
        throw new RuntimeException("批量插入失败", e);
    } finally {
        if (pstmt != null) {
            try {
                pstmt.close();
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
        if (conn != null) {
            try {
                conn.setAutoCommit(true);
                conn.close();
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
    }
}
```

## 事务管理

```java
/**
 * 转账操作（事务示例）
 */
public void transfer(Long fromId, Long toId, BigDecimal amount) {
    Connection conn = null;
    PreparedStatement pstmt = null;
    try {
        conn = DriverManager.getConnection(URL, USER, PASSWORD);
        conn.setAutoCommit(false);  // 开启事务

        // 1. 扣除转出账户金额
        String sql1 = "UPDATE account SET balance = balance - ? WHERE id = ?";
        pstmt = conn.prepareStatement(sql1);
        pstmt.setBigDecimal(1, amount);
        pstmt.setLong(2, fromId);
        int rows1 = pstmt.executeUpdate();
        if (rows1 == 0) {
            throw new RuntimeException("转出账户不存在");
        }

        // 2. 转入账户增加金额
        String sql2 = "UPDATE account SET balance = balance + ? WHERE id = ?";
        pstmt = conn.prepareStatement(sql2);
        pstmt.setBigDecimal(1, amount);
        pstmt.setLong(2, toId);
        int rows2 = pstmt.executeUpdate();
        if (rows2 == 0) {
            throw new RuntimeException("转入账户不存在");
        }

        // 3. 提交事务
        conn.commit();
    } catch (Exception e) {
        // 回滚
        if (conn != null) {
            try {
                conn.rollback();
            } catch (SQLException ex) {
                ex.printStackTrace();
            }
        }
        throw new RuntimeException("转账失败", e);
    } finally {
        close(null, pstmt, conn);
    }
}
```

## SQL 注入问题

### 危险写法：Statement

```java
// 危险！可能被 SQL 注入
String sql = "SELECT * FROM user WHERE name = '" + name + "'";
Statement stmt = conn.createStatement();
ResultSet rs = stmt.executeQuery(sql);
// 如果 name = "Tom' OR '1'='1"，SQL 变成：
// SELECT * FROM user WHERE name = 'Tom' OR '1'='1'
```

### 安全写法：PreparedStatement

```java
// 安全！参数被转义
String sql = "SELECT * FROM user WHERE name = ?";
PreparedStatement pstmt = conn.prepareStatement(sql);
pstmt.setString(1, name);  // 参数自动转义
ResultSet rs = pstmt.executeQuery();
```

## DriverManager 加载驱动

### 方式一：Class.forName（传统方式）

```java
Class.forName("com.mysql.cj.jdbc.Driver");
Connection conn = DriverManager.getConnection(url, user, password);
```

### 方式二：SPI 自动加载（JDBC 4.0+）

JDBC 4.0 之后，驱动会在 `META-INF/services/java.sql.Driver` 中自动注册，无需手动加载：

```java
// 无需 Class.forName，直接获取连接
Connection conn = DriverManager.getConnection(url, user, password);
```

## 常见错误

### 1. 驱动未找到

```
java.lang.ClassNotFoundException: com.mysql.cj.jdbc.Driver
```

解决：添加 MySQL 驱动依赖

```xml
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
</dependency>
```

### 2. 连接超时

```
com.mysql.jdbc.exceptions.jdbc4.CommunicationsException:
  Communications link failure
```

解决：检查 URL、用户名密码、网络

### 3. 连接池耗尽

```
No operations allowed after connection closed.
```

解决：检查连接是否正确关闭，是否正确归还连接池

---

## 面试高频问题

### Q1：Statement 和 PreparedStatement 的区别？

| 维度 | Statement | PreparedStatement |
|-----|-----------|------------------|
| SQL | 拼接 | 预编译 |
| 性能 | 每次编译 | 一次编译多次执行 |
| SQL 注入 | 危险 | 安全 |
| 参数支持 | 不支持 | 支持 |

### Q2：JDBC 事务的四大特性（ACID）？

- Atomic（原子性）：事务是最小执行单位，不可分割
- Consistency（一致性）：事务执行前后，数据库状态一致
- Isolation（隔离性）：并发事务互不干扰
- Duration（持久性）：事务提交后，永久生效

### Q3：JDBC 如何实现事务？

通过 `Connection` 的 `setAutoCommit(false)` 开启事务，`commit()` 提交，`rollback()` 回滚。

---

## 最佳实践

1. **使用 PreparedStatement**：防止 SQL 注入
2. **使用连接池**：避免频繁创建连接
3. **关闭资源**：finally 中确保关闭
4. **事务控制**：相关操作放在一个事务中
5. **异常处理**：包装成运行时异常

---

## 思考题

为什么推荐使用 PreparedStatement 而不是 Statement？

如果一个 SQL 被执行 1000 次，PreparedStatement 比 Statement 快多少？
