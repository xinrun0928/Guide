# UserDetailsService 与自定义登录认证

你有没有遇到过这样的需求：用户表有自己的结构，需要从数据库加载用户信息进行登录验证？

很多人在 Spring Security 入门时，用的是内存用户：

```java
auth.inMemoryAuthentication()
    .withUser("admin").password("{noop}admin").roles("ADMIN");
}
```

但真实项目中，用户信息存在数据库里，密码是加密的，角色是从关联表查的——这才是主流场景。

今天，我们就来深入了解 `UserDetailsService`，搞定自定义登录认证。

---

## UserDetailsService 接口

`UserDetailsService` 是 Spring Security 认证体系的核心接口，专门用于加载用户信息：

```java
public interface UserDetailsService {
    // 根据用户名加载用户，返回 UserDetails
    UserDetails loadUserByUsername(String username) throws UsernameNotFoundException;
}
```

**核心职责**：根据用户名从数据源（数据库、LDAP、外部服务等）加载完整的用户信息，包括密码和权限。

### 为什么需要这个接口？

```
AuthenticationManager 需要：
    - 用户名（来自登录表单）
    - 密码（来自登录表单）
    - 用户权限（来自数据源）
    
但 AuthenticationManager 不直接访问数据库，
它通过 UserDetailsService 来获取这些信息。
```

---

## UserDetails 接口

`UserDetails` 是用户信息的抽象，定义了用户需要具备的所有属性：

```java
public interface UserDetails extends Serializable {
    
    // 获取权限列表
    Collection&lt;? extends GrantedAuthority&gt; getAuthorities();
    
    // 获取密码
    String getPassword();
    
    // 获取用户名
    String getUsername();
    
    // 账户是否未过期
    boolean isAccountNonExpired();
    
    // 账户是否未锁定
    boolean isAccountNonLocked();
    
    // 凭证（密码）是否未过期
    boolean isCredentialsNonExpired();
    
    // 账户是否启用
    boolean isEnabled();
}
```

Spring Security 内部会根据这些方法判断用户是否可以登录。

### UserDetails 的默认实现

Spring Security 提供了一个默认实现 `org.springframework.security.core.userdetails.User`：

```java
UserDetails user = User.builder()
    .username("admin")
    .password(passwordEncoder.encode("123456"))
    .roles("ADMIN", "USER")           // 自动加 ROLE_ 前缀
    // 或使用 authorities()
    // .authorities("ROLE_ADMIN", "READ")
    .accountExpired(false)
    .accountLocked(false)
    .credentialsExpired(false)
    .disabled(false)
    .build();
```

---

## 自定义 UserDetailsService 实现

### 需求分析

假设用户表结构如下：

```sql
CREATE TABLE sys_user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    status TINYINT DEFAULT 1,  -- 1:正常, 0:禁用
    lock_count INT DEFAULT 0,  -- 连续登录失败次数
    create_time DATETIME
);

CREATE TABLE sys_role (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_code VARCHAR(50) NOT NULL UNIQUE,
    role_name VARCHAR(100)
);

CREATE TABLE sys_user_role (
    user_id BIGINT,
    role_id BIGINT,
    PRIMARY KEY (user_id, role_id)
);
```

### 实现 UserDetailsService

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {
    
    @Autowired
    private UserMapper userMapper;
    
    @Autowired
    private RoleMapper roleMapper;
    
    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        // 1. 查询用户信息
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在: " + username);
        }
        
        // 2. 查询用户角色
        List&lt;Role&gt; roles = roleMapper.findByUserId(user.getId());
        
        // 3. 转换为 Spring Security 的权限格式
        List&lt;GrantedAuthority&gt; authorities = roles.stream()
            .map(role -> new SimpleGrantedAuthority("ROLE_" + role.getCode()))
            .collect(Collectors.toList());
        
        // 4. 构建 UserDetails 返回
        // 注意：这里的 enabled、accountNonLocked 等需要对应表字段
        return User.builder()
            .username(user.getUsername())
            .password(user.getPassword())
            .authorities(authorities)
            .accountExpired(false)
            .accountLocked(user.getLockCount() >= 5)  // 连续失败5次，锁定账户
            .credentialsExpired(false)
            .disabled(user.getStatus() == 0)          // status=0 表示禁用
            .build();
    }
}
```

### Mapper 接口

```java
@Mapper
public interface UserMapper {
    
    @Select("SELECT * FROM sys_user WHERE username = #{username}")
    User findByUsername(@Param("username") String username);
}

@Mapper
public interface RoleMapper {
    
    @Select("SELECT r.* FROM sys_role r " +
           "INNER JOIN sys_user_role ur ON r.id = ur.role_id " +
           "WHERE ur.user_id = #{userId}")
    List&lt;Role&gt; findByUserId(@Param("userId") Long userId);
}
```

### 配置 UserDetailsService

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated()
            )
            .formLogin(Customizer.withDefaults());
        
        return http.build();
    }
    
    // 方式一：直接注入
    @Bean
    public UserDetailsService userDetailsService() {
        return userDetailsService;
    }
    
    // 方式二：通过 AuthenticationManager 暴露
    @Bean
    public AuthenticationManager authenticationManager(
            AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
```

---

## UserDetails 的生命周期

理解 UserDetails 在认证流程中是怎么被使用的，很重要：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     UserDetails 在认证流程中的使用                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 用户提交登录表单                                                 │
│         ↓                                                           │
│  2. UsernamePasswordAuthenticationFilter                            │
│     提取 username 和 password，构造未认证的 Token                     │
│         ↓                                                           │
│  3. DaoAuthenticationProvider                                       │
│     调用 userDetailsService.loadUserByUsername(username)             │
│     获取数据库中的 UserDetails（包含加密后的密码）                    │
│         ↓                                                           │
│  4. 密码比对                                                         │
│     passwordEncoder.matches(表单密码, UserDetails.password)          │
│         ↓                                                           │
│  5. 账户状态检查                                                     │
│     UserDetails.isEnabled()                                         │
│     UserDetails.isAccountNonLocked()                                 │
│     UserDetails.isAccountNonExpired()                                │
│     UserDetails.isCredentialsNonExpired()                            │
│         ↓                                                           │
│  6. 认证成功                                                         │
│     用 UserDetails 构建已认证的 Authentication                        │
│     保存到 SecurityContext                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 认证后如何获取 UserDetails？

```java
// 获取当前用户的 Authentication
Authentication auth = SecurityContextHolder.getContext().getAuthentication();

// 方式一：强转为 UserDetails
if (auth.getPrincipal() instanceof UserDetails) {
    UserDetails userDetails = (UserDetails) auth.getPrincipal();
    String username = userDetails.getUsername();
}

// 方式二：使用 @AuthenticationPrincipal 注解
@GetMapping("/current")
public UserInfo currentUser(@AuthenticationPrincipal UserDetails user) {
    return new UserInfo(user.getUsername(), user.getAuthorities());
}

// 方式三：获取完整权限
Collection&lt;? extends GrantedAuthority&gt; authorities = auth.getAuthorities();
authorities.forEach(System.out::println);
```

---

## 密码加密配置

密码加密需要和 UserDetailsService 配合使用：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
    
    // 确保 UserDetailsService 使用正确的 PasswordEncoder
    @Autowired
    public void configureGlobal(AuthenticationManagerBuilder auth) throws Exception {
        auth.userDetailsService(customUserDetailsService())
            .passwordEncoder(passwordEncoder());
    }
    
    @Bean
    public CustomUserDetailsService customUserDetailsService() {
        return new CustomUserDetailsService();
    }
}
```

---

## 常见的 UserDetailsService 实现

### 1. InMemoryUserDetailsManager（测试用）

```java
@Bean
public UserDetailsService users() {
    UserDetails user = User.builder()
        .username("user")
        .password("{noop}password")
        .roles("USER")
        .build();
    
    UserDetails admin = User.builder()
        .username("admin")
        .password("{noop}admin")
        .roles("USER", "ADMIN")
        .build();
    
    return new InMemoryUserDetailsManager(user, admin);
}
```

### 2. JdbcUserDetailsManager（连接数据库）

```java
@Configuration
public class SecurityConfig {
    
    @Autowired
    private DataSource dataSource;
    
    @Bean
    public UserDetailsManager users(DataSource dataSource) {
        UserDetails user = User.builder()
            .username("user")
            .password(passwordEncoder().encode("password"))
            .roles("USER")
            .build();
        
        JdbcUserDetailsManager manager = new JdbcUserDetailsManager(dataSource);
        if (!manager.userExists("user")) {
            manager.createUser(user);
        }
        return manager;
    }
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

### 3. 自定义实现（生产环境）

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {
    // 如上所示
}
```

---

## 高级用法：用户状态检查的精细控制

默认的 `User.isEnabled()` 等方法只能返回简单的布尔值。如果需要更精细的控制：

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {
    
    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在");
        }
        
        // 检查账户是否被删除
        if (user.getDeleted()) {
            throw new UsernameNotFoundException("用户已被删除");
        }
        
        // 检查账户是否过期
        if (user.getExpireTime() != null && user.getExpireTime().before(new Date())) {
            throw new AccountExpiredException("账户已过期");
        }
        
        // 构建自定义 UserDetails
        return new CustomUserDetails(user);
    }
}

// 自定义 UserDetails 实现
public class CustomUserDetails implements UserDetails {
    
    private final User user;
    private final List&lt;GrantedAuthority&gt; authorities;
    
    public CustomUserDetails(User user, List&lt;GrantedAuthority&gt; authorities) {
        this.user = user;
        this.authorities = authorities;
    }
    
    @Override
    public Collection&lt;? extends GrantedAuthority&gt; getAuthorities() {
        return authorities;
    }
    
    @Override
    public String getPassword() {
        return user.getPassword();
    }
    
    @Override
    public String getUsername() {
        return user.getUsername();
    }
    
    @Override
    public boolean isAccountNonExpired() {
        return user.getExpireTime() == null || user.getExpireTime().after(new Date());
    }
    
    @Override
    public boolean isAccountNonLocked() {
        return user.getLockCount() &lt; 5;
    }
    
    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }
    
    @Override
    public boolean isEnabled() {
        return user.getStatus() == 1 && !user.getDeleted();
    }
    
    // 提供额外的业务方法
    public Long getUserId() {
        return user.getId();
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| UserDetailsService 和 AuthenticationProvider 的关系？ | 架构理解 | 认证核心流程 |
| 如果用户不存在，应该抛什么异常？ | 异常处理 | 本篇 |
| 为什么要用 BCrypt 而不是 MD5？ | 安全意识 | 密码加密 |
| loadUserByUsername 每次登录都会调用吗？ | 流程理解 | 本篇 |
| 如何实现多表查询用户信息？ | 实战能力 | 本篇 |

---

## 总结

`UserDetailsService` 是自定义登录认证的核心：

1. **接口职责**：根据用户名加载用户信息和权限
2. **配合组件**：PasswordEncoder（密码校验）、AuthenticationProvider（流程调度）
3. **关键方法**：loadUserByUsername()、getAuthorities()、isEnabled() 等
4. **扩展方向**：支持更多字段、更多状态、更复杂的权限模型

理解了这个接口，再去看短信登录、OAuth2 登录，都是在此基础上的扩展。

---

## 下一步

- 想了解密码加密原理？→ [PasswordEncoder：BCrypt 密码加密](/framework/springsecurity/password-encoder)
- 想了解登录过滤器？→ [表单登录流程](/framework/springsecurity/form-login)
- 想实现其他登录方式？→ [短信验证码登录](/framework/springsecurity/sms-login)
