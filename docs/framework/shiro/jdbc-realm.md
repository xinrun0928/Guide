# JDBCRealm 连接数据库实现认证授权

IniRealm 的局限性太明显了——用户多了怎么办？密码要改怎么办？

真实项目中，用户和权限数据都在数据库里。这一节，我们来学习如何让 Shiro 连接数据库。

## JDBCRealm 简介

Shiro 内置了 `JDBCRealm`，它可以从数据库中读取用户、角色、权限信息。

```
┌──────────────────────────────────────────────────────────────┐
│                        JDBCRealm                             │
│                                                              │
│   ┌────────────┐     ┌────────────┐     ┌────────────┐      │
│   │   Users    │     │   Roles    │     │  Permissions│      │
│   │   Table    │     │   Table    │     │    Table   │      │
│   └────────────┘     └────────────┘     └────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

## 数据库表设计

JDBCRealm 对表结构有要求，你需要创建三张表：

### 用户表（users）

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    password_salt VARCHAR(50),  -- 可选：密码盐值
    locked TINYINT(1) DEFAULT 0,  -- 可选：账户是否锁定
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 角色表（roles）

```sql
CREATE TABLE roles (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(200)
);
```

### 权限表（permissions）

```sql
CREATE TABLE permissions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    permission VARCHAR(100) NOT NULL,
    description VARCHAR(200)
);
```

### 关系表

```sql
-- 用户-角色关系表
CREATE TABLE user_roles (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (role_id) REFERENCES roles(id),
    UNIQUE KEY uk_user_role (user_id, role_id)
);

-- 角色-权限关系表
CREATE TABLE role_permissions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    FOREIGN KEY (role_id) REFERENCES roles(id),
    FOREIGN KEY (permission_id) REFERENCES permissions(id),
    UNIQUE KEY uk_role_perm (role_id, permission_id)
);
```

### 初始化数据

```sql
-- 插入用户（密码是 MD5 加密后的 123456）
INSERT INTO users (username, password) VALUES 
    ('admin', '123456'),
    ('zhangsan', '123456');

-- 插入角色
INSERT INTO roles (role_name) VALUES 
    ('admin'), ('user'), ('guest');

-- 插入权限
INSERT INTO permissions (permission) VALUES 
    ('user:*'), ('user:view'), ('user:edit'),
    ('order:*'), ('order:view'), ('order:create');

-- 分配角色给用户
INSERT INTO user_roles (user_id, role_id) 
SELECT u.id, r.id FROM users u, roles r 
WHERE u.username = 'admin' AND r.role_name = 'admin';

INSERT INTO user_roles (user_id, role_id) 
SELECT u.id, r.id FROM users u, roles r 
WHERE u.username = 'zhangsan' AND r.role_name = 'user';

-- 分配权限给角色
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.role_name = 'admin';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.role_name = 'user' AND p.permission LIKE 'user:%';
```

## Shiro 配置

### 数据源配置

```java
@Configuration
public class DataSourceConfig {
    
    @Bean
    public DataSource dataSource() {
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:mysql://localhost:3306/shiro_demo");
        dataSource.setUsername("root");
        dataSource.setPassword("password");
        dataSource.setDriverClassName("com.mysql.cj.jdbc.Driver");
        return dataSource;
    }
}
```

### JDBCRealm 配置

```java
@Configuration
public class ShiroConfig {
    
    @Autowired
    private DataSource dataSource;
    
    @Bean
    public SecurityManager securityManager() {
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        manager.setRealm(jdbcRealm());
        return manager;
    }
    
    @Bean
    public JdbcRealm jdbcRealm() {
        JdbcRealm realm = new JdbcRealm();
        realm.setDataSource(dataSource);
        
        // 启用权限查询（默认就是 true，可以不设置）
        realm.setPermissionsLookupEnabled(true);
        
        // 可选：配置密码加密
        HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
        matcher.setHashAlgorithmName("MD5");
        matcher.setHashIterations(1);
        realm.setCredentialsMatcher(matcher);
        
        return realm;
    }
}
```

### SQL 查询配置

JDBCRealm 默认的 SQL 可能不满足你的需求，可以自定义：

```java
@Bean
public JdbcRealm jdbcRealm() {
    JdbcRealm realm = new JdbcRealm() {{
        setDataSource(dataSource);
        setPermissionsLookupEnabled(true);
        
        // 自定义 SQL
        String authcQuery = "SELECT password FROM users WHERE username = ? AND locked = 0";
        String userRolesQuery = "SELECT r.role_name FROM roles r " +
            "INNER JOIN user_roles ur ON r.id = ur.role_id " +
            "INNER JOIN users u ON u.id = ur.user_id " +
            "WHERE u.username = ?";
        String permissionsQuery = "SELECT p.permission FROM permissions p " +
            "INNER JOIN role_permissions rp ON p.id = rp.permission_id " +
            "INNER JOIN roles r ON r.id = rp.role_id " +
            "INNER JOIN user_roles ur ON r.id = ur.role_id " +
            "INNER JOIN users u ON u.id = ur.user_id " +
            "WHERE u.username = ?";
        
        setAuthenticationQuery(authcQuery);
        setUserRolesQuery(userRolesQuery);
        setPermissionsQuery(permissionsQuery);
    }};
    
    return realm;
}
```

## 完整配置类

```java
@Configuration
public class ShiroJdbcConfig {
    
    @Bean
    public DataSource dataSource() {
        DruidDataSource dataSource = new DruidDataSource();
        dataSource.setUrl("jdbc:mysql://localhost:3306/shiro_demo");
        dataSource.setUsername("root");
        dataSource.setPassword("123456");
        dataSource.setDriverClassName("com.mysql.cj.jdbc.Driver");
        return dataSource;
    }
    
    @Bean
    public SecurityManager securityManager(Realm realm) {
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        manager.setRealm(realm);
        return manager;
    }
    
    @Bean
    public Realm jdbcRealm(DataSource dataSource) {
        JdbcRealm realm = new JdbcRealm();
        realm.setDataSource(dataSource);
        realm.setPermissionsLookupEnabled(true);
        
        // 配置密码加密
        HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
        matcher.setHashAlgorithmName("SHA-256");
        matcher.setHashIterations(3);
        realm.setCredentialsMatcher(matcher);
        
        return realm;
    }
    
    @Bean
    public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
        ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
        factory.setSecurityManager(manager);
        factory.setLoginUrl("/login");
        factory.setUnauthorizedUrl("/403");
        
        Map&lt;String, String&gt; filterChain = new LinkedHashMap&lt;&gt;();
        filterChain.put("/css/**", "anon");
        filterChain.put("/js/**", "anon");
        filterChain.put("/login", "anon");
        filterChain.put("/logout", "logout");
        filterChain.put("/admin/**", "roles[admin]");
        filterChain.put("/**", "authc");
        
        factory.setFilterChainDefinitionMap(filterChain);
        return factory;
    }
}
```

## 使用盐值

如果数据库中密码是加盐存储的，需要配置 `SaltStyle`：

```java
@Bean
public JdbcRealm jdbcRealm(DataSource dataSource) {
    JdbcRealm realm = new JdbcRealm();
    realm.setDataSource(dataSource);
    
    // 设置盐值风格：使用用户名作为盐值
    realm.setSaltStyle(JdbcRealm.SaltStyle.COLUMN);
    
    // 认证 SQL 需要返回 salt 字段
    realm.setAuthenticationQuery(
        "SELECT password, password_salt FROM users WHERE username = ?");
    
    // 配置 HashedCredentialsMatcher
    HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
    matcher.setHashAlgorithmName("SHA-256");
    matcher.setHashIterations(3);
    realm.setCredentialsMatcher(matcher);
    
    return realm;
}
```

**SaltStyle 有三种**：

| 值 | 说明 | SQL 要求 |
|---|------|---------|
| `NO_SALT` | 不使用盐 | 只返回 password |
| `COLUMN` | 盐值存储在单独的列 | 返回 password 和 salt |
| `EXTERNAL` | 盐值可以从其他地方获取 | 只返回 password |

## 密码加密与数据库存储

### 生成加密密码

```java
public class PasswordUtils {
    
    public static void main(String[] args) {
        String rawPassword = "123456";
        String salt = "zhangsan";  // 可以使用随机数或用户名
        
        // SHA-256 加密，迭代 3 次
        SimpleHash hash = new SimpleHash(
            "SHA-256",
            rawPassword,
            salt,
            3
        );
        
        System.out.println("加密后: " + hash.toHexString());
    }
}
```

### 数据库存储

```sql
-- 存储加密后的密码和盐值
INSERT INTO users (username, password, password_salt) 
VALUES ('zhangsan', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'zhangsan');
```

## 多数据源配置

如果你的项目有多个数据库，可以在 Shiro 中配置多个 Realm：

```java
@Bean
public SecurityManager securityManager() {
    DefaultSecurityManager manager = new DefaultWebSecurityManager();
    
    // 配置多个 Realm
    List&lt;Realm&gt; realms = Arrays.asList(
        systemRealm(),    // 主业务系统
        oaRealm()         // OA 系统
    );
    manager.setRealms(realms);
    
    return manager;
}
```

### 多 Realm 的认证策略

```java
@Bean
public ModularRealmAuthenticator authenticator() {
    ModularRealmAuthenticator authenticator = new ModularRealmAuthenticator();
    
    // 只要有一个 Realm 认证成功即可
    authenticator.setAuthenticationStrategy(
        new AtLeastOneSuccessfulStrategy());
    
    return authenticator;
}
```

## JDBCRealm 的局限性

| 局限性 | 说明 |
|-------|------|
| **表结构固定** | 需要按照 Shiro 要求的格式创建表 |
| **SQL 固定** | 自定义 SQL 也需要遵循一定规范 |
| **不支持复杂逻辑** | 如动态数据权限 |

对于复杂的业务场景，建议使用 [自定义 Realm](/framework/shiro/custom-realm)，完全掌控认证授权逻辑。

---

## 留给你的问题

JDBCRealm 已经能满足基本的数据库认证需求，但它的 SQL 是写死的，不够灵活。

如果你的表结构和 Shiro 默认的不一样，或者有复杂的业务逻辑该怎么办？

——下一节，我们来学习如何编写一个完全自定义的 Realm。
