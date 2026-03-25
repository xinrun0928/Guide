# @PreAuthorize 与 @Secured 注解权限控制

你有没有遇到过这种情况：在 Controller 或 Service 方法上加了一个权限注解，结果登录用户反而无法访问了？

这很可能是你没有正确理解权限注解的用法。

今天，我们就来深入了解 Spring Security 的方法级权限控制注解。

---

## 四种权限注解对比

| 注解 | 来源 | SpEL 支持 | 用法 |
|-----|------|----------|------|
| @Secured | Spring 2.0 | ❌ | `@Secured("ROLE_ADMIN")` |
| @RolesAllowed | JSR-250 | ❌ | `@RolesAllowed("ROLE_ADMIN")` |
| @PreAuthorize | Spring Security | ✅ | `@PreAuthorize("hasRole('ADMIN')")` |
| @PostAuthorize | Spring Security | ✅ | `@PostAuthorize("returnObject.owner == authentication.name")` |

---

## @PreAuthorize：前置授权检查

### 基本用法

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    // 需要 ADMIN 角色
    @PreAuthorize("hasRole('ADMIN')")
    @GetMapping("/admin")
    public String adminOnly() {
        return "只有管理员才能看到这段话";
    }
    
    // 需要特定权限
    @PreAuthorize("hasAuthority('USER_READ')")
    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }
    
    // 多个权限（OR 关系）
    @PreAuthorize("hasAnyRole('ADMIN', 'USER')")
    @GetMapping("/list")
    public List&lt;User&gt; listUsers() {
        return userService.findAll();
    }
    
    // 多个权限（AND 关系）
    @PreAuthorize("hasRole('ADMIN') and hasAuthority('USER_WRITE')")
    @PostMapping
    public User createUser(@RequestBody UserDTO dto) {
        return userService.create(dto);
    }
}
```

### SpEL 表达式详解

```java
public class UserController {
    
    // 1. hasRole - 角色检查（自动加 ROLE_ 前缀）
    @PreAuthorize("hasRole('ADMIN')")
    public void adminOnly() { }
    
    // 2. hasAuthority - 精确权限检查
    @PreAuthorize("hasAuthority('DELETE_USER')")
    public void deleteUser(Long id) { }
    
    // 3. permitAll - 允许所有人
    @PreAuthorize("permitAll()")
    public void publicInfo() { }
    
    // 4. denyAll - 拒绝所有人
    @PreAuthorize("denyAll()")
    public void neverAccessible() { }
    
    // 5. isAnonymous - 匿名用户
    @PreAuthorize("isAnonymous()")
    public void forGuests() { }
    
    // 6. isAuthenticated - 已认证用户
    @PreAuthorize("isAuthenticated()")
    public void forMembers() { }
    
    // 7. isFullyAuthenticated - 非匿名且非 Remember-Me
    @PreAuthorize("isFullyAuthenticated()")
    public void sensitiveOperation() { }
}
```

---

## 启用方法级安全

### Spring Security 6.x 配置

```java
@Configuration
@EnableMethodSecurity(
    prePostEnabled = true,    // 启用 @PreAuthorize / @PostAuthorize
    securedEnabled = true,    // 启用 @Secured
    jsr250Enabled = true      // 启用 @RolesAllowed
)
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated()
            );
        
        return http.build();
    }
}
```

### 旧版本配置（Spring Security 5.x）

```java
@Configuration
@EnableGlobalMethodSecurity(
    prePostEnabled = true,
    securedEnabled = true,
    jsr250Enabled = true
)
public class SecurityConfig { }
```

---

## 获取当前用户信息

### 在 SpEL 中使用

```java
@RestController
public class OrderController {
    
    // 获取当前用户名
    @PreAuthorize("#username == authentication.name")
    @GetMapping("/orders")
    public List&lt;Order&gt; getMyOrders(@RequestParam String username) {
        return orderService.findByUsername(username);
    }
    
    // 获取当前用户的权限
    @PreAuthorize("hasAuthority('ORDER_READ')")
    @GetMapping("/orders")
    public List&lt;Order&gt; getOrders() {
        return orderService.findAll();
    }
}
```

### 使用方法参数

```java
@RestController
public class UserController {
    
    // 通过 @AuthenticationPrincipal 获取当前用户
    @GetMapping("/profile")
    public UserProfile getProfile(
            @AuthenticationPrincipal UserDetails user) {
        return userService.getProfile(user.getUsername());
    }
    
    // 使用 @AuthenticationPrincipal(expression = "username") 直接取值
    @GetMapping("/settings")
    public Settings getSettings(
            @AuthenticationPrincipal(expression = "username") String username) {
        return userService.getSettings(username);
    }
}
```

---

## @PostAuthorize：后置授权检查

### 基本用法

```java
public class UserService {
    
    // 只有数据所有者才能查看自己的信息
    @PostAuthorize("returnObject.username == authentication.name or hasRole('ADMIN')")
    public User getUser(Long id) {
        return userRepository.findById(id);
    }
    
    // 只有管理员才能删除
    @PostAuthorize("hasRole('ADMIN')")
    public void deleteUser(Long id) {
        userRepository.deleteById(id);
    }
    
    // 复杂条件
    @PostAuthorize("returnObject.status == 'PUBLIC' or " +
                  "returnObject.owner == authentication.name or " +
                  "hasRole('ADMIN')")
    public Post getPost(Long id) {
        return postRepository.findById(id);
    }
}
```

> **注意**：`@PostAuthorize` 在方法执行**之后**才检查，如果方法有副作用（如删除数据），不建议使用。

---

## 自定义权限表达式

### 定义自定义方法

```java
@Component("ss")
public class SecurityExpressions {
    
    // 自定义方法：检查用户是否属于某个部门
    public boolean belongsToDepartment(Authentication authentication, String deptId) {
        UserDetails user = (UserDetails) authentication.getPrincipal();
        return user.getDepartmentId().equals(deptId);
    }
    
    // 自定义方法：检查用户年龄
    public boolean isAdult(Authentication authentication) {
        UserDetails user = (UserDetails) authentication.getPrincipal();
        return user.getAge() >= 18;
    }
}
```

### 使用自定义方法

```java
public class DepartmentController {
    
    // 使用自定义权限方法
    @PreAuthorize("@securityExpressions.belongsToDepartment(authentication, #deptId)")
    @GetMapping("/departments/{deptId}/members")
    public List&lt;User&gt; getDepartmentMembers(@PathVariable String deptId) {
        return departmentService.getMembers(deptId);
    }
    
    // 组合使用
    @PreAuthorize("@securityExpressions.isAdult(authentication) and hasRole('USER')")
    @GetMapping("/adult-content")
    public Object getAdultContent() { }
}
```

---

## 数据权限控制

### 基于用户的数据过滤

```java
public class OrderService {
    
    // 只返回当前用户的数据
    @PreAuthorize("#oauth2.hasScope('read')")
    @Query("SELECT o FROM Order o WHERE o.userId = :userId")
    public List&lt;Order&gt; findMyOrders(@Param("userId") Long userId) {
        return orderRepository.findByUserId(userId);
    }
    
    // 数据权限注解
    @DataPermission(type = DataPermissionType.USER_SCOPE)
    @Query("SELECT o FROM Order o")
    public List&lt;Order&gt; findAllOrders() {
        return orderRepository.findAll();
    }
}
```

### 基于机构的数据过滤

```java
public class DocumentService {
    
    // 只返回当前机构的数据
    @PreAuthorize("@orgSecurity.isSameOrg(authentication, #doc.orgId)")
    @GetMapping("/documents/{id}")
    public Document getDocument(@PathVariable Long id) {
        return documentRepository.findById(id);
    }
}
```

---

## 异常处理

### 权限不足时的异常

```java
// 当权限检查失败时，抛出 AccessDeniedException
@PreAuthorize("hasRole('ADMIN')")
public void adminOnly() { }

// 或 SecurityExpressionViolationException（更详细的异常信息）
```

### 自定义异常处理

```java
@RestControllerAdvice
public class SecurityExceptionHandler {
    
    @ExceptionHandler(AccessDeniedException.class)
    public Result&lt;Void&gt; handleAccessDenied(AccessDeniedException e) {
        return Result.fail(403, "权限不足，无法访问该资源");
    }
    
    @ExceptionHandler(SecurityExpressionViolationException.class)
    public Result&lt;Void&gt; handleExpressionViolation(SecurityExpressionViolationException e) {
        return Result.fail(403, "权限表达式评估失败: " + e.getMessage());
    }
}
```

---

## 权限注解的继承

### 类级别的注解

```java
@PreAuthorize("hasRole('USER')")  // 类级别：所有方法都需要 USER 角色
public class UserController {
    
    @GetMapping("/info")  // 继承类级别的权限
    public UserInfo getInfo() { }
    
    @PreAuthorize("hasRole('ADMIN')")  // 方法级别：覆盖类级别
    @GetMapping("/admin")
    public String adminOnly() { }
}
```

### 接口级别的注解

```java
public interface UserService {
    
    @PreAuthorize("isAuthenticated()")
    User findById(Long id);
    
    @PreAuthorize("hasRole('ADMIN')")
    void deleteById(Long id);
}

@Service
public class UserServiceImpl implements UserService {
    
    @Override
    public User findById(Long id) {
        // 自动继承接口的 @PreAuthorize 注解
    }
}
```

---

## 性能优化

### 方法级安全的开销

```
权限检查流程：
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  请求到达 Controller                                                  │
│       │                                                               │
│       ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ @PreAuthorize 拦截器                                        │    │
│  │                                                             │    │
│  │ 1. 解析 SpEL 表达式                                        │    │
│  │ 2. 获取当前 Authentication                                 │    │
│  │ 3. 评估表达式                                               │    │
│  │ 4. 返回 true/false                                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                               │
│       ▼                                                               │
│  方法执行                                                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 优化建议

```java
public class SecurityConfig {
    
    @Bean
    public MethodSecurityExpressionHandler methodSecurityExpressionHandler() {
        DefaultMethodSecurityExpressionHandler handler = 
            new DefaultMethodSecurityExpressionHandler();
        // 可以自定义表达式根对象
        handler.setPermissionEvaluator(new CustomPermissionEvaluator());
        return handler;
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| @PreAuthorize 和 @Secured 的区别？ | 注解对比 | 本篇 |
| SpEL 表达式中 authentication 和 principal 的区别？ | 表达式理解 | 本篇 |
| @PreAuthorize 和 @PostAuthorize 的区别？ | 注解理解 | 本篇 |
| 如何自定义权限表达式？ | 扩展能力 | 本篇 |
| 方法级安全注解是如何生效的？ | 原理理解 | AOP |

---

## 总结

Spring Security 的方法级权限注解：

1. **@PreAuthorize**：方法执行**前**检查，最常用
2. **@PostAuthorize**：方法执行**后**检查，适合数据权限
3. **@Secured**：简单角色检查，不支持 SpEL
4. **@RolesAllowed**：JSR-250 标准注解

开启方法级安全：`@EnableMethodSecurity(prePostEnabled = true)`

常用 SpEL 表达式：`hasRole()`, `hasAuthority()`, `hasAnyRole()`, `isAuthenticated()`, `permitAll()`

---

## 下一步

- 想了解更复杂的权限决策？→ [动态权限决策](/framework/springsecurity/access-decision)
- 想学习 RBAC 模型？→ [RBAC 权限模型](/framework/springsecurity/rbac)
- 想了解接口权限设计？→ [接口权限数据模型](/framework/springsecurity/permission-model)
