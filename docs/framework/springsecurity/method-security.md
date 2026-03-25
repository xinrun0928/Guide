# 方法级别安全：@EnableMethodSecurity 与 SpEL 表达式

你有没有想过，在 Controller 或 Service 方法上直接加个注解就能控制权限，是怎么做到的？

Spring Security 的方法级安全机制，背后其实是 AOP（面向切面编程）在起作用。

今天，我们就来深入了解 `@EnableMethodSecurity` 和 SpEL 表达式的威力。

---

## 方法级安全的原理

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       方法级安全原理                                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  @EnableMethodSecurity                                                  │
│       │                                                                 │
│       ▼                                                                 │
│  注册 MethodSecurityInterceptor                                          │
│       │                                                                 │
│       ▼                                                                 │
│  包装 BeanPostProcessor                                                  │
│       │                                                                 │
│       ▼                                                                 │
│  为每个 Bean 创建代理对象                                                │
│       │                                                                 │
│       ▼                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    方法调用拦截                               │    │
│  │                                                               │    │
│  │  1. Before：检查权限（@PreAuthorize / @Secured）             │    │
│  │       ↓ 通过                                              │    │
│  │  2. 执行目标方法                                            │    │
│  │       ↓                                                    │    │
│  │  3. AfterReturning：检查返回值（@PostAuthorize）            │    │
│  │       ↓                                                    │    │
│  │  4. AfterThrowing：异常处理                                  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## @EnableMethodSecurity 详解

### 基本配置

```java
@Configuration
@EnableMethodSecurity(
    prePostEnabled = true,    // 启用 @PreAuthorize 和 @PostAuthorize
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

### 启用后可以使用的注解

```java
// @PreAuthorize - 方法执行前检查
@PreAuthorize("hasRole('ADMIN')")
public void adminMethod() { }

// @PostAuthorize - 方法执行后检查
@PostAuthorize("returnObject.owner == authentication.name")
public User getUser(Long id) { }

// @Secured - 简单角色检查（不支持 SpEL）
@Secured({"ROLE_ADMIN", "ROLE_USER"})
public void securedMethod() { }

// @RolesAllowed - JSR-250 标准
@RolesAllowed("ROLE_ADMIN")
public void rolesAllowedMethod() { }
```

---

## SpEL 表达式中的内置对象

### Authentication 对象

```java
@PreAuthorize("authentication.name == 'admin'")
public void adminOnly() { }

// 获取权限列表
@PreAuthorize("authentication.authorities.?[authority == 'ROLE_ADMIN'].isEmpty() == false")
public void adminCheck() { }

// 获取认证详情
@PreAuthorize("authentication.details.remoteAddress == '127.0.0.1'")
public void localhostOnly() { }
```

### Principal 对象

```java
@PreAuthorize("principal.username == 'admin'")
public void adminOnly() { }

// 强制类型转换
@PreAuthorize("principal instanceof T(com.example.CustomUserDetails)")
public void customUserOnly() { }
```

### MethodSecurityExpressionRoot 的内置方法

```java
public class UserService {
    
    // 1. hasRole / hasAnyRole - 角色检查
    @PreAuthorize("hasRole('ADMIN')")
    public void adminOnly() { }
    
    @PreAuthorize("hasAnyRole('ADMIN', 'USER')")
    public void adminOrUser() { }
    
    // 2. hasAuthority / hasAnyAuthority - 权限检查
    @PreAuthorize("hasAuthority('DELETE')")
    public void deleteMethod() { }
    
    // 3. isAuthenticated / isAnonymous / isFullyAuthenticated
    @PreAuthorize("isAuthenticated()")
    public void forMembers() { }
    
    @PreAuthorize("isAnonymous()")
    public void forGuests() { }
    
    @PreAuthorize("isFullyAuthenticated()")
    public void noRememberMe() { }
    
    // 4. permitAll / denyAll
    @PreAuthorize("permitAll()")
    public void publicMethod() { }
    
    // 5. hasPermission - 权限表达式
    @PreAuthorize("hasPermission(#userId, 'User', 'READ')")
    public User getUser(Long userId) { }
}
```

---

## 自定义权限表达式

### 定义自定义 SecurityExpressionRoot

```java
public class CustomMethodSecurityExpressionRoot extends MethodSecurityExpressionOperations {
    
    private Authentication authentication;
    private Object filterObject;
    private Object returnObject;
    private TargetClass targetClass;
    private Method targetMethod;
    
    public CustomMethodSecurityExpressionRoot(Authentication authentication) {
        this.authentication = authentication;
    }
    
    // 自定义方法：检查用户是否属于某个部门
    public boolean belongsToDept(String deptId) {
        UserDetails user = (UserDetails) authentication.getPrincipal();
        return user.getDepartmentId().equals(deptId);
    }
    
    // 自定义方法：检查用户年龄
    public boolean isAdult() {
        UserDetails user = (UserDetails) authentication.getPrincipal();
        return user.getAge() >= 18;
    }
    
    // 自定义方法：检查资源所有权
    public boolean isOwner(Object resourceId) {
        UserDetails user = (UserDetails) authentication.getPrincipal();
        return resourceId.equals(user.getId());
    }
}
```

### 创建自定义表达式处理器

```java
public class CustomMethodSecurityExpressionHandler 
    extends DefaultMethodSecurityExpressionHandler {
    
    @Override
    protected MethodSecurityExpressionOperations createSecurityExpressionRoot(
            Authentication authentication, 
            MethodInvocation invocation) {
        
        CustomMethodSecurityExpressionRoot root = 
            new CustomMethodSecurityExpressionRoot(authentication);
        
        root.setPermissionEvaluator(getPermissionEvaluator());
        root.setTrustResolver(getTrustResolver());
        root.setRoleHierarchy(getRoleHierarchy());
        root.setDefaultRolePrefix(getDefaultRolePrefix());
        
        return root;
    }
}
```

### 注册自定义处理器

```java
@Configuration
@EnableMethodSecurity(prePostEnabled = true)
public class MethodSecurityConfig {
    
    @Bean
    public MethodSecurityExpressionHandler methodSecurityExpressionHandler() {
        CustomMethodSecurityExpressionHandler handler = 
            new CustomMethodSecurityExpressionHandler();
        handler.setPermissionEvaluator(customPermissionEvaluator());
        return handler;
    }
}
```

---

## hasPermission 权限表达式

### PermissionEvaluator 接口

```java
public interface PermissionEvaluator {
    
    // 单资源权限检查
    boolean hasPermission(Authentication authentication, 
                          Object targetDomainObject, 
                          Object permission);
    
    // ID 方式权限检查
    boolean hasPermission(Authentication authentication, 
                          Serializable targetId, 
                          String targetType, 
                          Object permission);
}
```

### 实现 PermissionEvaluator

```java
@Component
public class CustomPermissionEvaluator implements PermissionEvaluator {
    
    @Autowired
    private PermissionService permissionService;
    
    @Override
    public boolean hasPermission(Authentication authentication, 
                                 Object targetDomainObject, 
                                 Object permission) {
        if (targetDomainObject == null) {
            return true;
        }
        
        String username = authentication.getName();
        String permissionStr = permission.toString();
        
        return permissionService.checkPermission(username, targetDomainObject, permissionStr);
    }
    
    @Override
    public boolean hasPermission(Authentication authentication, 
                                 Serializable targetId, 
                                 String targetType, 
                                 Object permission) {
        if (targetId == null) {
            return true;
        }
        
        String username = authentication.getName();
        String permissionStr = permission.toString();
        
        return permissionService.checkPermissionById(username, targetType, 
            Long.parseLong(targetId.toString()), permissionStr);
    }
}
```

### 使用 hasPermission

```java
public class DocumentService {
    
    // 检查用户是否有读取文档的权限
    @PreAuthorize("hasPermission(#docId, 'Document', 'READ')")
    public Document getDocument(@Param("docId") Long docId) {
        return documentRepository.findById(docId);
    }
    
    // 检查用户是否有写入权限
    @PreAuthorize("hasPermission(#doc, 'WRITE')")
    public void updateDocument(@Param("doc") Document doc) {
        documentRepository.save(doc);
    }
    
    // 检查用户是否是文档所有者
    @PreAuthorize("hasPermission(#docId, 'Document', 'OWNER')")
    public void transferOwnership(@Param("docId") Long docId) {
        // 转让所有权
    }
}
```

---

## 参数级权限控制

### 使用 @P 引用参数

```java
public class OrderService {
    
    // 直接引用方法参数
    @PreAuthorize("#orderId == authentication.userId or hasRole('ADMIN')")
    public Order getOrder(@Param("orderId") Long orderId) {
        return orderRepository.findById(orderId);
    }
    
    // 引用对象属性
    @PreAuthorize("#order.userId == authentication.userId or hasRole('ADMIN')")
    public void updateOrder(@Param("order") Order order) {
        orderRepository.save(order);
    }
    
    // 使用 # 参数名
    @PreAuthorize("#username == authentication.name")
    public User getUserByName(@Param("username") String username) {
        return userRepository.findByUsername(username);
    }
}
```

---

## 方法级别的权限元注解

### 定义权限注解

```java
// 定义注解
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@PreAuthorize("hasRole('ADMIN')")
@Documented
public @interface RequireAdmin { }

// 定义注解
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@PreAuthorize("hasAuthority('READ')")
@Documented
public @interface ReadOperation { }

// 定义注解
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@PreAuthorize("hasAuthority('WRITE')")
@Documented
public @interface WriteOperation { }
```

### 使用元注解

```java
public class ArticleService {
    
    @ReadOperation
    public Article getArticle(Long id) {
        return articleRepository.findById(id);
    }
    
    @WriteOperation
    public Article createArticle(Article article) {
        return articleRepository.save(article);
    }
    
    @RequireAdmin
    public void deleteArticle(Long id) {
        articleRepository.deleteById(id);
    }
}
```

---

## 角色层级（Role Hierarchy）

### 角色继承

```java
@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    
    @Bean
    public RoleHierarchy roleHierarchy() {
        RoleHierarchyImpl hierarchy = new RoleHierarchyImpl();
        
        // 角色继承关系
        hierarchy.setHierarchy(
            "ROLE_ADMIN > ROLE_MANAGER\n" +
            "ROLE_MANAGER > ROLE_USER\n" +
            "ROLE_USER > ROLE_GUEST"
        );
        
        return hierarchy;
    }
}
```

### 配置后的效果

```
ROLE_ADMIN
    ↓ 继承
ROLE_MANAGER
    ↓ 继承
ROLE_USER
    ↓ 继承
ROLE_GUEST

拥有 ROLE_ADMIN 角色的用户，同时拥有：
- ROLE_ADMIN
- ROLE_MANAGER
- ROLE_USER
- ROLE_GUEST
```

---

## 异步方法安全

### @Async 与权限注解

```java
@Service
public class AsyncService {
    
    @Async
    @PreAuthorize("hasRole('ADMIN')")
    public void asyncAdminTask() {
        // 异步执行，但仍然会检查权限
    }
}
```

> **注意**：异步方法调用时，SecurityContext 可能无法正确传播，需要额外配置。

---

## 常见问题

### 问题一：注解不生效？

```java
// 检查一：是否启用了 @EnableMethodSecurity
@Configuration
@EnableMethodSecurity  // ❌ 忘记加这个
public class SecurityConfig { }

// 检查二：注解是否在正确的包下
// Spring 默认只扫描带 @PreAuthorize 等注解的类
```

### 问题二：SpEL 表达式报错？

```java
// 检查一：字符串比较
@PreAuthorize("authentication.name == 'admin'")  // ✅ 正确

// 检查二：方法调用
@PreAuthorize("authentication.name.equals('admin')")  // ❌ 不支持

// 检查三：避免复杂逻辑
// 复杂逻辑建议使用自定义方法
@PreAuthorize("@securityService.isAdmin(authentication)")
```

### 问题三：权限检查失败后返回什么？

```java
// 抛出 AccessDeniedException
@PreAuthorize("hasRole('ADMIN')")
public void adminOnly() { }

// 返回 403 Forbidden
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(AccessDeniedException.class)
    public Result&lt;Void&gt; handleAccessDenied(AccessDeniedException e) {
        return Result.fail(403, "没有权限");
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| 方法级安全的原理是什么？ | 原理理解 | AOP 机制 |
| @EnableMethodSecurity 做了什么？ | 配置理解 | 本篇 |
| 如何自定义 SpEL 表达式？ | 扩展能力 | 本篇 |
| hasPermission 是怎么工作的？ | 权限模型 | 自定义权限评估器 |
| 角色层级有什么作用？ | 配置理解 | 本篇 |

---

## 总结

@EnableMethodSecurity 的核心要点：

1. **启用注解**：prePostEnabled、securedEnabled、jsr250Enabled
2. **SpEL 内置对象**：authentication、principal、hasPermission
3. **自定义表达式**：继承 MethodSecurityExpressionRoot
4. **hasPermission**：支持复杂的权限评估逻辑
5. **元注解**：简化重复的权限配置

方法级安全让权限控制更细粒度，配合 URL 级安全，形成完整的权限防护体系。

---

## 下一步

- 想自定义权限决策逻辑？→ [动态权限决策](/framework/springsecurity/access-decision)
- 想设计权限数据模型？→ [RBAC 权限模型](/framework/springsecurity/rbac)
- 想了解接口权限设计？→ [接口权限数据模型](/framework/springsecurity/permission-model)
