# Shiro 注解：@RequiresAuthentication / @RequiresRoles / @RequiresPermissions

URL 级别的权限控制很方便，但有时候我们需要更细粒度的控制。

比如：同一个接口，根据不同参数判断是否有权限。

这就是 Shiro 注解的用武之地。

## Shiro 注解一览

| 注解 | 说明 |
|-----|------|
| `@RequiresAuthentication` | 需要认证（登录） |
| `@RequiresGuest` | 需要匿名访问 |
| `@RequiresUser` | 需要已认证或 RememberMe |
| `@RequiresRoles(roles)` | 需要指定角色 |
| `@RequiresPermissions(perms)` | 需要指定权限 |

## 快速上手

### 启用注解

```java
@Configuration
public class ShiroAnnotationConfig {
    
    @Bean
    public AuthorizationAttributeSourceAdvisor advisor(SecurityManager manager) {
        AuthorizationAttributeSourceAdvisor advisor = 
            new AuthorizationAttributeSourceAdvisor();
        advisor.setSecurityManager(manager);
        return advisor;
    }
    
    @Bean
    public DefaultAdvisorAutoProxyCreator proxyCreator() {
        DefaultAdvisorAutoProxyCreator creator = new DefaultAdvisorAutoProxyCreator();
        creator.setProxyTargetClass(true);
        return creator;
    }
}
```

**没有配置这两个 Bean，注解不会生效！**

### 使用注解

```java
@Service
public class UserService {
    
    @RequiresAuthentication
    public void updateProfile(UserProfile profile) {
        // 只有登录用户才能修改资料
    }
    
    @RequiresRoles("admin")
    public void deleteUser(Long userId) {
        // 只有管理员才能删除用户
    }
    
    @RequiresPermissions("user:delete")
    public void deleteUser(Long userId) {
        // 只有拥有 user:delete 权限才能删除用户
    }
}
```

## 注解详解

### @RequiresAuthentication

要求用户已认证（登录）。

```java
@RequiresAuthentication
public User getCurrentUser() {
    Subject subject = SecurityUtils.getSubject();
    return (User) subject.getPrincipal();
}
```

相当于过滤器中的 `authc`。

### @RequiresGuest

要求用户是匿名访问（未认证）。

```java
@RequiresGuest
public void registerInvitation(Invitation invitation) {
    // 只允许未登录用户访问（如邀请注册页面）
}
```

### @RequiresUser

要求用户是已认证或 RememberMe。

```java
@RequiresUser
public void viewHistory() {
    // 登录用户或记住我的用户可以查看历史记录
}
```

相当于过滤器中的 `user`。

### @RequiresRoles

要求用户拥有指定角色。

```java
// 单个角色
@RequiresRoles("admin")
public void adminOperation() {
    // 只有 admin 角色可以执行
}

// 多个角色（AND 关系：必须同时拥有）
@RequiresRoles({"admin", "manager"})
public void adminManagerOperation() {
    // 必须同时拥有 admin 和 manager 角色
}

// 使用 Logical.OR
@RequiresRoles(value = {"admin", "superadmin"}, logical = Logical.OR)
public void adminOrSuperadminOperation() {
    // admin 或 superadmin 其中一个即可
}
```

### @RequiresPermissions

要求用户拥有指定权限。

```java
// 单个权限
@RequiresPermissions("user:create")
public void createUser(User user) {
    // 只有 user:create 权限才能创建用户
}

// 多个权限（AND 关系）
@RequiresPermissions({"user:view", "user:edit"})
public void editUser(Long userId) {
    // 必须同时拥有 user:view 和 user:edit 权限
}

// 使用 Logical.OR
@RequiresPermissions(value = {"user:create", "user:update"}, logical = Logical.OR)
public void createOrUpdateUser(User user) {
    // user:create 或 user:update 其中一个即可
}

// REST 风格
@RequiresPermissions("user:delete")
public void deleteUser(@RequestParam Long id) {
    // REST DELETE 请求需要 user:delete 权限
}
```

## 实际应用场景

### 场景一：服务层权限控制

```java
@Service
public class OrderService {
    
    @Autowired
    private OrderRepository orderRepository;
    
    /**
     * 创建订单 - 需要登录
     */
    @RequiresAuthentication
    public Order createOrder(OrderCreateDTO dto) {
        Subject subject = SecurityUtils.getSubject();
        String username = (String) subject.getPrincipal();
        
        Order order = new Order();
        order.setUserId(getUserIdByUsername(username));
        order.setItems(dto.getItems());
        
        return orderRepository.save(order);
    }
    
    /**
     * 取消订单 - 需要订单所有者或管理员
     */
    @RequiresPermissions("order:cancel")
    public void cancelOrder(Long orderId) {
        Order order = orderRepository.findById(orderId);
        
        Subject subject = SecurityUtils.getSubject();
        if (!subject.isPermitted("order:cancel:" + orderId)) {
            throw new UnauthorizedException("您没有权限取消此订单");
        }
        
        order.setStatus(OrderStatus.CANCELLED);
        orderRepository.save(order);
    }
    
    /**
     * 删除订单 - 需要管理员角色
     */
    @RequiresRoles("admin")
    public void deleteOrder(Long orderId) {
        orderRepository.deleteById(orderId);
    }
}
```

### 场景二：动态权限检查

```java
@Service
public class ArticleService {
    
    @RequiresPermissions("article:edit")
    public void editArticle(Long articleId, ArticleContent content) {
        Subject subject = SecurityUtils.getSubject();
        
        Article article = articleRepository.findById(articleId);
        
        // 检查是否是文章作者或有管理员权限
        if (!article.getAuthorId().equals(getCurrentUserId()) 
            && !subject.hasRole("admin")) {
            throw new UnauthorizedException("您没有权限编辑此文章");
        }
        
        // 执行编辑逻辑
        article.setContent(content);
        articleRepository.save(article);
    }
}
```

### 场景三：使用 SpEL 表达式

Shiro 支持 SpEL 表达式，可以实现更复杂的权限判断：

```java
@Service
public class OrderService {
    
    /**
     * SpEL 表达式：#orderId 是方法参数
     */
    @RequiresPermissions("order:view")
    public Order getOrder(Long orderId) {
        // 方法内可以安全使用 orderId
        return orderRepository.findById(orderId);
    }
    
    /**
     * 参数级别权限检查
     */
    public void transfer(@RequestParam Long fromOrderId, 
                        @RequestParam Long toOrderId) {
        
        Subject subject = SecurityUtils.getSubject();
        
        // 动态检查权限
        if (!subject.isPermitted("order:transfer:" + fromOrderId) 
         || !subject.isPermitted("order:transfer:" + toOrderId)) {
            throw new UnauthorizedException("您没有权限操作此订单");
        }
        
        // 执行转账逻辑
    }
}
```

## 异常处理

### 默认行为

注解校验失败会抛出异常：

| 注解 | 抛出异常 |
|-----|---------|
| `@RequiresAuthentication` | `AuthenticationException` |
| `@RequiresGuest` | `AuthenticationException` |
| `@RequiresUser` | `AuthenticationException` |
| `@RequiresRoles` | `UnauthorizedException` |
| `@RequiresPermissions` | `UnauthorizedException` |

### 全局异常处理

```java
@ControllerAdvice
public class ShiroExceptionHandler {
    
    @ExceptionHandler(UnauthorizedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    @ResponseBody
    public Result<Void> handleUnauthorized(UnauthorizedException e) {
        return Result.error(403, "没有权限访问该资源");
    }
    
    @ExceptionHandler(AuthenticationException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    @ResponseBody
    public Result<Void> handleAuthentication(AuthenticationException e) {
        return Result.error(401, "请先登录");
    }
}
```

### Spring Security 风格的异常处理

```java
@Configuration
public class ShiroExceptionConfig {
    
    @Bean
    public SimpleMappingExceptionResolver exceptionResolver() {
        SimpleMappingExceptionResolver resolver = new SimpleMappingExceptionResolver();
        
        Properties mappings = new Properties();
        mappings.put("org.apache.shiro.authz.UnauthorizedException", "/403");
        mappings.put("org.apache.shiro.authz.HostUnauthorizedException", "/403");
        mappings.put("org.apache.shiro.authc.AuthenticationException", "/login");
        
        resolver.setExceptionMappings(mappings);
        
        return resolver;
    }
}
```

## 与过滤器链对比

| 特性 | 过滤器链 | 注解 |
|-----|---------|------|
| **粒度** | URL 级别 | 方法级别 |
| **灵活性** | 低 | 高 |
| **维护性** | 集中管理 | 分散在代码中 |
| **性能** | 好 | 需要 AOP 支持 |
| **适用场景** | 公开/登录/角色拦截 | 细粒度业务权限 |

**最佳实践**：
- URL 级别拦截用过滤器链
- 业务方法权限用注解
- 两者结合使用

## 自定义权限注解

如果内置注解不够用，可以自定义：

```java
/**
 * 部门数据权限注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@RequiresPermissions("data:view")
public @interface DepartmentPermission {
    
    // 部门 ID 参数名
    String deptIdParam() default "deptId";
}
```

```java
@Service
public class DepartmentService {
    
    @DepartmentPermission
    public List<User> listUsersByDepartment(Long deptId) {
        // 只有有权限查看该部门数据的人才能访问
        return userRepository.findByDepartmentId(deptId);
    }
}
```

## 面试追问方向

**面试官可能会问**：

1. **Shiro 注解和过滤器链哪个先执行？**
   - 过滤器链先执行
   - 过滤器链在 URL 层面拦截
   - 注解在方法层面拦截

2. **@RequiresRoles 和 @RequiresPermissions 的区别？**
   - @RequiresRoles 检查角色
   - @RequiresPermissions 检查权限
   - 角色是粗粒度，权限是细粒度

3. **注解不生效的可能原因？**
   - 没有配置 AuthorizationAttributeSourceAdvisor
   - 没有配置 DefaultAdvisorAutoProxyCreator
   - Bean 不是被 Spring 管理的（需要用 Spring Bean 而不是 new）

4. **如何在注解中使用 SpEL？**
   - Shiro 注解支持基本的 SpEL
   - 可以使用 `#参数名` 引用方法参数

---

## 留给你的问题

注解能控制方法级别的权限，但如果想在 JSP 页面中根据权限显示/隐藏按钮呢？

下一节，我们来学习 Shiro 的 JSP 标签库——`<shiro:principal>` 与 `<shiro:hasRole>`。
