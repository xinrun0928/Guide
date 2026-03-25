# Spring Security 授权模型：Authority 与 Role

你有没有被 `hasRole()` 和 `hasAuthority()` 搞混过？

在配置 Spring Security 权限时，很多人会疑惑：这两个方法有什么区别？什么时候用哪个？

今天，我们就来彻底搞清楚 Spring Security 的授权模型。

---

## Authority 与 Role 的区别

### 先说结论

| 概念 | 说明 | 典型用途 |
|-----|------|---------|
| Authority（权限） | 最细粒度的权限标识 | `READ`, `WRITE`, `DELETE` |
| Role（角色） | 一组权限的集合 | `ROLE_ADMIN`, `ROLE_USER` |

**关键区别**：`Role` 本质上也是一种 `Authority`，只不过命名上带 `ROLE_` 前缀。

### 源码解析

```java
// Role 的本质：就是 GrantedAuthority
public interface GrantedAuthority extends Serializable {
    String getAuthority();
}

// Spring Security 中的 Role 实现
public class SimpleGrantedAuthority implements GrantedAuthority {
    private final String role;
    
    public SimpleGrantedAuthority(String role) {
        // 注意：role 会自动添加 ROLE_ 前缀
        this.role = role;
    }
    
    @Override
    public String getAuthority() {
        return role;
    }
}
```

### 配置时的区别

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                // hasAuthority：精确匹配权限字符串
                .requestMatchers("/admin/**").hasAuthority("ROLE_ADMIN")
                
                // hasRole：自动添加 ROLE_ 前缀
                // 内部会转换为 hasAuthority("ROLE_ADMIN")
                .requestMatchers("/user/**").hasRole("USER")
                
                // 同样的效果：
                // hasRole("USER") === hasAuthority("ROLE_USER")
                
                // 批量配置权限
                .requestMatchers("/api/**")
                    .hasAnyAuthority("READ", "WRITE", "ROLE_USER")
                
                .requestMatchers("/manager/**")
                    .hasAnyRole("ADMIN", "MANAGER")
            );
        
        return http.build();
    }
}
```

### 代码中的区别

```java
// UserDetails 中设置权限
UserDetails user = User.builder()
    .username("admin")
    .password(passwordEncoder.encode("123456"))
    
    // 方式一：使用 authorities() 设置精确权限
    .authorities("READ", "WRITE", "DELETE")
    
    // 方式二：使用 roles() 设置角色（自动加 ROLE_ 前缀）
    // roles("ADMIN") 会转换为 authorities("ROLE_ADMIN")
    .roles("ADMIN", "USER")
    
    .build();

// 获取权限后的效果
user.getAuthorities();
// authorities() 返回：{READ, WRITE, DELETE}
// roles() 返回：{ROLE_ADMIN, ROLE_USER}
```

---

## 命名规范

### Spring Security 的约定

| 类型 | 前缀 | 示例 |
|-----|------|-----|
| Role | `ROLE_` | `ROLE_ADMIN`, `ROLE_USER` |
| Authority | 无前缀 | `READ`, `WRITE`, `DELETE` |

### 为什么这样设计？

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Spring Security 的权限检查逻辑                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  配置：hasAuthority("ROLE_ADMIN")                                   │
│                                                                      │
│  检查：authentication.getAuthorities()                               │
│        遍历每个 GrantedAuthority                                    │
│        调用 getAuthority() 获取字符串                               │
│        比较是否等于 "ROLE_ADMIN"                                      │
│                                                                      │
│  配置：hasRole("ADMIN")                                             │
│                                                                      │
│  检查：内部转换为 hasAuthority("ROLE_ADMIN")                          │
│        同样的比较逻辑                                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 实战：如何设计权限体系

### 方案一：纯 Role 模式（简单场景）

适合：小型系统，权限简单，角色少。

```java
// 用户拥有多个角色
UserDetails user = User.builder()
    .username("admin")
    .authorities("ROLE_ADMIN", "ROLE_USER")
    .build();

// 权限配置
.requestMatchers("/admin/**").hasRole("ADMIN")
.requestMatchers("/user/**").hasRole("USER")
.requestMatchers("/public/**").authenticated()
```

### 方案二：Authority + Role 混合模式（推荐）

适合：权限较复杂，需要细粒度控制。

```java
// 用户拥有基础角色 + 具体权限
UserDetails user = User.builder()
    .username("editor")
    // 角色
    .authorities("ROLE_EDITOR")
    // 细粒度权限
    .authorities("ARTICLE_READ", "ARTICLE_WRITE")
    .build();

// 权限配置
.requestMatchers("/article/read/**").hasAuthority("ARTICLE_READ")
.requestMatchers("/article/write/**").hasAuthority("ARTICLE_WRITE")
.requestMatchers("/article/delete/**").hasAuthority("ARTICLE_DELETE")
.requestMatchers("/article/**").hasRole("EDITOR")
```

### 方案三：完整 RBAC 模型（复杂场景）

适合：企业级系统，需要动态权限管理。

```java
// 用户 → 角色 → 权限
UserDetails user = User.builder()
    .username("manager")
    // 动态从数据库加载
    .authorities(loadAuthoritiesFromDatabase(userId))
    .build();

// authorities 可能包含：
// {ROLE_MANAGER, DEPT_READ, DEPT_WRITE, EMP_READ, EMP_WRITE, EMP_DELETE}
```

---

## 常见问题解析

### 问题一：hasRole 和 hasAuthority 哪个更好？

**没有绝对的好坏，关键是团队约定**。

推荐实践：
- **用 hasRole()**：判断用户是否是某个角色
- **用 hasAuthority()**：判断用户是否有某个具体权限

```java
// 判断是否是管理员（角色）
.hasRole("ADMIN")

// 判断是否有删除文章的权限（具体权限）
.hasAuthority("ARTICLE_DELETE")
```

### 问题二：角色和权限可以同时用吗？

当然可以：

```java
// 管理员可以做任何事
.hasAnyAuthority("ROLE_ADMIN", "ARTICLE_READ", "ARTICLE_WRITE", "ARTICLE_DELETE")

// 或者用角色
.hasAnyRole("ADMIN", "EDITOR")
```

### 问题三：前缀搞混了怎么办？

记住：**`hasRole()` 会自动加 `ROLE_` 前缀，`hasAuthority()` 不会**。

```java
// 假设数据库中的权限字段是 "ROLE_ADMIN"

// ✅ 正确：用 hasRole
.hasRole("ADMIN")  // 转换为 hasAuthority("ROLE_ADMIN")

// ✅ 正确：用 hasAuthority 直接匹配
.hasAuthority("ROLE_ADMIN")

// ❌ 错误：hasRole 会再加一次前缀
.hasRole("ROLE_ADMIN")  // 实际检查的是 "ROLE_ROLE_ADMIN"（错误）
```

### 问题四：注解中用哪个？

```java
// @Secured 用 hasRole（自动加 ROLE_）
@Secured("ROLE_ADMIN")  // 检查 AUTHORITY_ROLE_ADMIN

// @PreAuthorize 用 hasRole 或 hasAuthority
@PreAuthorize("hasRole('ADMIN')")
@PreAuthorize("hasAuthority('ARTICLE_DELETE')")

// @RolesAllowed (JSR-250) 用 hasRole
@RolesAllowed("ADMIN")  // 检查 ROLE_ADMIN
```

---

## Authority 层级结构

### URL 路径匹配

```java
.requestMatchers("/api/**").authenticated()

// 等价于
.requestMatchers("/api/user/**").authenticated()
.requestMatchers("/api/order/**").authenticated()
```

### SpEL 表达式中的权限判断

```java
@PreAuthorize("hasRole('ADMIN') or hasRole('USER')")
public void doSomething() { }

// 或者用 hasAnyRole
@PreAuthorize("hasAnyRole('ADMIN', 'USER')")

// 组合条件
@PreAuthorize("hasRole('ADMIN') and hasAuthority('WRITE')")
public void adminWrite() { }
```

---

## 代码示例：从数据库加载权限

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {
    
    @Autowired
    private UserMapper userMapper;
    
    @Autowired
    private PermissionMapper permissionMapper;
    
    @Override
    public UserDetails loadUserByUsername(String username) {
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在");
        }
        
        // 1. 查询用户拥有的角色
        List&lt;String&gt; roles = roleMapper.findByUserId(user.getId());
        
        // 2. 查询用户拥有的具体权限
        List&lt;String&gt; authorities = permissionMapper.findByUserId(user.getId());
        
        // 3. 合并（角色会自动转成 ROLE_ 前缀格式）
        List&lt;GrantedAuthority&gt; grantedAuthorities = new ArrayList&lt;&gt;();
        
        // 添加角色
        roles.forEach(role -> 
            grantedAuthorities.add(new SimpleGrantedAuthority("ROLE_" + role))
        );
        
        // 添加具体权限
        authorities.forEach(auth -> 
            grantedAuthorities.add(new SimpleGrantedAuthority(auth))
        );
        
        return User.builder()
            .username(user.getUsername())
            .password(user.getPassword())
            .authorities(grantedAuthorities)
            .build();
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| Authority 和 Role 的区别？ | 概念辨析 | 本篇 |
| hasRole 和 hasAuthority 的区别？ | 配置理解 | 本篇 |
| 如何设计一个权限体系？ | 系统设计 | RBAC |
| 注解中 @Secured 和 @PreAuthorize 的区别？ | 注解理解 | preauthorize |
| 权限如何动态加载？ | 实战能力 | 本篇 |

---

## 总结

Authority 和 Role 的关系：

1. **Role 是特殊的 Authority**：带 `ROLE_` 前缀的 Authority
2. **hasRole() 会自动加前缀**：使用更简洁
3. **hasAuthority() 精确匹配**：适合细粒度权限
4. **推荐混合使用**：Role 做粗粒度控制，Authority 做细粒度控制
5. **命名约定很重要**：团队内部统一规范

理解了这个区别，再去看 RBAC 模型、方法级安全、动态权限决策，都会清晰很多。

---

## 下一步

- 想了解权限注解？→ [@PreAuthorize 与权限控制](/framework/springsecurity/preauthorize)
- 想学习 RBAC 模型？→ [RBAC 权限模型](/framework/springsecurity/rbac)
- 想自定义权限决策？→ [动态权限决策](/framework/springsecurity/access-decision)
