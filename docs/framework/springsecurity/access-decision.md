# 动态权限决策：投票器（Voter）与 AccessDecisionManager

你有没有遇到过这种情况：权限判断逻辑太复杂，用 `hasRole()` 已经无法表达？

比如：「只有文章作者或者管理员才能删除文章」——这种跨对象、跨条件的判断，简单的权限注解根本搞不定。

今天，我们就来深入了解 Spring Security 的动态权限决策机制。

---

## 权限决策的核心组件

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     权限决策核心组件                                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SecurityMetadataSource                                                  │
│       │                                                                 │
│       │ 提供资源需要的权限                                               │
│       ▼                                                                 │
│  AccessDecisionManager                                                   │
│       │                                                                 │
│       │ 协调多个 Voter 进行决策                                          │
│       ▼                                                                 │
│  AccessDecisionVoter                                                    │
│       │                                                                 │
│       │ 投票判断                                                         │
│       └──┬─────────────────────────────────────────────────────────┐  │
│          │                         │                         │       │
│          ▼                         ▼                         ▼       │
│    WebExpressionVoter       RoleVoter              CustomVoter         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## AccessDecisionManager 接口

### 三种实现

| 实现类 | 策略 | 说明 |
|-------|------|------|
| AffirmativeBased | 一票通过 | 任意一个 Voter 通过即可 |
| ConsensusBased | 多数通过 | 多数票通过 |
| UnanimousBased | 全票通过 | 所有 Voter 都必须通过 |

### AffirmativeBased（默认）

```java
public class AffirmativeBased extends AbstractAccessDecisionManager {
    
    @Override
    public void decide(Authentication authentication, 
                       Object object, 
                       List&lt;ConfigAttribute&gt; attributes) {
        int grant = 0;
        
        for (AccessDecisionVoter&lt;?&gt; voter : getDecisionVoters()) {
            int result = voter.vote(authentication, object, attributes);
            
            switch (result) {
                case AccessDecisionVoter.ACCESS_GRANTED:
                    grant++;  // 通过
                    break;
                case AccessDecisionVoter.ACCESS_DENIED:
                    break;  // 拒绝，继续看其他 Voter
            }
        }
        
        if (grant > 0) {
            return;  // 有票通过，放行
        }
        
        // 所有票都拒绝
        checkAllowIfSecondsAuthorizationDecision();
        throw new AccessDeniedException(
            "没有足够的权限访问该资源");
    }
}
```

### UnanimousBased

```java
public class UnanimousBased extends AbstractAccessDecisionManager {
    
    @Override
    public void decide(Authentication authentication, 
                       Object object, 
                       List&lt;ConfigAttribute&gt; attributes) {
        int grant = 0;
        
        for (AccessDecisionVoter&lt;?&gt; voter : getDecisionVoters()) {
            int result = voter.vote(authentication, object, attributes);
            
            switch (result) {
                case AccessDecisionVoter.ACCESS_GRANTED:
                    grant++;
                    break;
                case AccessDecisionVoter.ACCESS_DENIED:
                    // 只要有一个拒绝，直接拒绝
                    throw new AccessDeniedException("权限不足");
            }
        }
        
        // 所有 Voter 都通过才放行
        if (grant > 0) {
            return;
        }
        
        throw new AccessDeniedException("权限不足");
    }
}
```

---

## AccessDecisionVoter 接口

### Voter 的投票结果

```java
public interface AccessDecisionVoter&lt;S&gt; {
    
    // 弃权：Voter 不关心这个资源
    int ACCESS_GRANTED = 1;
    
    // 拒绝：Voter 明确拒绝
    int ACCESS_DENIED = -1;
    
    // 弃权：Voter 无法判断，交给其他 Voter
    int ACCESS_ABSTAIN = 0;
    
    // 投票方法
    int vote(Authentication authentication, S object, Collection&lt;ConfigAttribute&gt; attributes);
}
```

### Spring Security 内置 Voter

| Voter | 职责 |
|-------|------|
| WebExpressionVoter | 处理 SpEL 表达式 |
| RoleVoter | 处理角色检查 |
| AuthenticatedVoter | 处理认证状态 |
| Jsr250Voter | 处理 @RolesAllowed |

---

## 自定义 AccessDecisionVoter

### 场景：文章删除权限

```java
/**
 * 文章删除权限 Voter
 * 
 * 规则：只有文章作者或管理员可以删除文章
 */
public class ArticleDeleteVoter implements AccessDecisionVoter&lt;Object&gt; {
    
    @Override
    public boolean supports(ConfigAttribute attribute) {
        // 只处理特定配置的权限
        return attribute.getAttribute() != null 
            && attribute.getAttribute().equals("ARTICLE_DELETE");
    }
    
    @Override
    public boolean supports(Class&lt;?&gt; clazz) {
        // 支持所有类型的对象
        return true;
    }
    
    @Override
    public int vote(Authentication authentication, 
                    Object object, 
                    Collection&lt;ConfigAttribute&gt; attributes) {
        
        // 1. 检查是否需要此 Voter 处理
        if (!needToVote(attributes)) {
            return ACCESS_ABSTAIN;
        }
        
        // 2. 获取当前用户
        if (authentication == null || !authentication.isAuthenticated()) {
            return ACCESS_DENIED;
        }
        
        Collection&lt;? extends GrantedAuthority&gt; authorities = 
            authentication.getAuthorities();
        
        // 3. 管理员可以直接删除
        if (authorities.stream()
                .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"))) {
            return ACCESS_GRANTED;
        }
        
        // 4. 普通用户需要检查是否是文章作者
        UserDetails user = (UserDetails) authentication.getPrincipal();
        
        // 从请求或上下文中获取文章信息
        Article article = getArticleFromContext(object);
        
        if (article != null && article.getAuthorId().equals(user.getId())) {
            return ACCESS_GRANTED;
        }
        
        return ACCESS_DENIED;
    }
    
    private boolean needToVote(Collection&lt;ConfigAttribute&gt; attributes) {
        return attributes.stream()
            .anyMatch(a -> a.getAttribute().equals("ARTICLE_DELETE"));
    }
    
    private Article getArticleFromContext(Object object) {
        // 从 FilterInvocation 或 MethodInvocation 中提取资源
        if (object instanceof FilterInvocation) {
            HttpServletRequest request = ((FilterInvocation) object).getRequest();
            Long articleId = Long.parseLong(request.getParameter("id"));
            return articleService.findById(articleId);
        }
        return null;
    }
}
```

### 配置自定义 Voter

```java
@Configuration
@EnableMethodSecurity
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
    
    @Bean
    public AccessDecisionManager accessDecisionManager() {
        List&lt;AccessDecisionVoter&lt;?&gt;&gt; voters = new ArrayList&lt;&gt;();
        
        // 添加内置 Voter
        voters.add(new WebExpressionVoter());
        voters.add(new RoleVoter());
        voters.add(new AuthenticatedVoter());
        
        // 添加自定义 Voter
        voters.add(articleDeleteVoter());
        
        // 使用 AffirmativeBased：一票通过
        return new AffirmativeBased(voters);
        
        // 或使用 UnanimousBased：全票通过
        // return new UnanimousBased(voters);
    }
    
    @Bean
    public ArticleDeleteVoter articleDeleteVoter() {
        return new ArticleDeleteVoter();
    }
}
```

---

## AccessDecisionVoter 与 URL 权限

### URL 权限配置

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                // 使用权限配置
                .requestMatchers("/article/delete/**").hasAuthority("ARTICLE_DELETE")
                .requestMatchers("/article/edit/**").hasAuthority("ARTICLE_EDIT")
                .requestMatchers("/article/read/**").hasAuthority("ARTICLE_READ")
                
                // 管理员可以访问所有文章接口
                .requestMatchers("/article/admin/**").hasRole("ADMIN")
                
                // 其他请求需要登录
                .anyRequest().authenticated()
            );
        
        return http.build();
    }
}
```

### 动态加载权限配置

```java
/**
 * 动态权限数据源
 */
@Component
public class DynamicSecurityMetadataSource implements SecurityMetadataSource {
    
    @Autowired
    private PermissionService permissionService;
    
    @Override
    public Collection&lt;ConfigAttribute&gt; getAttributes(Object object) 
            throws IllegalArgumentException {
        
        if (object instanceof FilterInvocation) {
            FilterInvocation filterInvocation = (FilterInvocation) object;
            String url = filterInvocation.getRequestUrl();
            String httpMethod = filterInvocation.getRequest().getMethod();
            
            // 从数据库查询该 URL 需要的权限
            List&lt;Permission&gt; permissions = permissionService
                .findByUrlAndMethod(url, httpMethod);
            
            if (permissions.isEmpty()) {
                return SecurityConfig.createList("IS_AUTHENTICATED");
            }
            
            return permissions.stream()
                .map(p -> (ConfigAttribute) () -> p.getAuthority())
                .collect(Collectors.toList());
        }
        
        return null;
    }
    
    @Override
    public Collection&lt;ConfigAttribute&gt; getAllConfigAttributes() {
        // 返回所有定义的权限（用于初始化）
        return permissionService.findAll().stream()
            .map(p -> (ConfigAttribute) () -> p.getAuthority())
            .collect(Collectors.toList());
    }
    
    @Override
    public boolean supports(Class&lt;?&gt; clazz) {
        return FilterInvocation.class.isAssignableFrom(clazz);
    }
}
```

---

## 自定义 AccessDecisionManager

### 场景：组织架构权限

```java
/**
 * 组织架构权限决策管理器
 * 
 * 规则：
 * 1. 管理员可以访问所有
 * 2. 部门经理可以访问本部门的数据
 * 3. 普通员工只能访问自己的数据
 */
public class OrgAccessDecisionManager extends AffirmativeBased {
    
    @Override
    public void decide(Authentication authentication, 
                       Object object, 
                       List&lt;ConfigAttribute&gt; attributes) 
            throws AccessDeniedException {
        
        // 1. 获取当前用户
        UserDetails user = (UserDetails) authentication.getPrincipal();
        
        // 2. 检查是否有管理员权限
        if (hasAdminRole(authentication)) {
            return;  // 管理员直接通过
        }
        
        // 3. 获取目标资源
        Resource resource = extractResource(object);
        
        if (resource == null) {
            super.decide(authentication, object, attributes);
            return;
        }
        
        // 4. 组织架构权限检查
        if (isOwner(user, resource)) {
            return;  // 所有者
        }
        
        if (isSameDepartment(user, resource)) {
            return;  // 同部门
        }
        
        // 5. 都失败，抛出异常
        throw new AccessDeniedException("无权访问该资源");
    }
    
    private boolean hasAdminRole(Authentication authentication) {
        return authentication.getAuthorities().stream()
            .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
    }
    
    private boolean isOwner(UserDetails user, Resource resource) {
        return resource.getOwnerId().equals(user.getId());
    }
    
    private boolean isSameDepartment(UserDetails user, Resource resource) {
        return user.getDepartmentId().equals(resource.getDepartmentId());
    }
    
    private Resource extractResource(Object object) {
        // 从请求中提取资源信息
        return null;
    }
}
```

### 配置自定义决策管理器

```java
@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    
    @Bean
    public AccessDecisionManager accessDecisionManager() {
        List&lt;AccessDecisionVoter&lt;?&gt;&gt; voters = Arrays.asList(
            new WebExpressionVoter(),
            new RoleVoter(),
            new AuthenticatedVoter(),
            new OrganizationVoter()
        );
        
        return new OrgAccessDecisionManager(voters);
    }
}
```

---

## 动态权限决策实战

### 权限服务

```java
@Service
public class DynamicPermissionService {
    
    @Autowired
    private ResourcePermissionRepository resourcePermissionRepository;
    
    @Autowired
    private RolePermissionRepository rolePermissionRepository;
    
    /**
     * 检查用户是否有访问某个资源的权限
     */
    public boolean hasPermission(Long userId, String resourceType, Long resourceId, String action) {
        // 1. 获取用户拥有的所有权限
        Set&lt;String&gt; userPermissions = getUserPermissions(userId);
        
        // 2. 获取资源要求的权限
        String requiredPermission = resourceType + ":" + action;
        
        // 3. 检查是否有权限
        return userPermissions.contains(requiredPermission)
            || userPermissions.contains(resourceType + ":*")  // 通配符
            || userPermissions.contains("*:*");  // 超级权限
    }
    
    /**
     * 获取用户的所有权限
     */
    public Set&lt;String&gt; getUserPermissions(Long userId) {
        // 从缓存或数据库获取
        return rolePermissionRepository.findByUserId(userId).stream()
            .map(rp -> rp.getPermission().getCode())
            .collect(Collectors.toSet());
    }
}
```

### 使用动态权限

```java
@Service
public class ResourceService {
    
    @Autowired
    private DynamicPermissionService permissionService;
    
    public Resource getResource(Long resourceId, Authentication authentication) {
        Long userId = extractUserId(authentication);
        String resourceType = "RESOURCE";
        String action = "READ";
        
        // 动态权限检查
        if (!permissionService.hasPermission(userId, resourceType, resourceId, action)) {
            throw new AccessDeniedException("无权访问该资源");
        }
        
        return resourceRepository.findById(resourceId);
    }
}
```

---

## 权限决策的异常处理

```java
@RestControllerAdvice
public class SecurityExceptionHandler {
    
    @ExceptionHandler(AccessDeniedException.class)
    public Result&lt;Void&gt; handleAccessDenied(AccessDeniedException e) {
        return Result.fail(403, "没有权限访问该资源");
    }
    
    @ExceptionHandler(InsufficientAuthenticationException.class)
    public Result&lt;Void&gt; handleInsufficientAuth(InsufficientAuthenticationException e) {
        return Result.fail(401, "请先登录");
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| AccessDecisionManager 有几种实现？ | 配置理解 | 本篇 |
| Voter 的三种投票结果是什么？ | 概念理解 | 本篇 |
| 如何自定义一个权限决策逻辑？ | 实战能力 | 本篇 |
| 动态权限和静态权限的区别？ | 设计理解 | 本篇 |
| 为什么需要自定义 Voter？ | 场景理解 | 本篇 |

---

## 总结

动态权限决策的核心要点：

1. **AccessDecisionManager**：协调多个 Voter 进行决策
2. **三种策略**：一票通过（AffirmativeBased）、多数通过（ConsensusBased）、全票通过（UnanimousBased）
3. **AccessDecisionVoter**：具体的投票逻辑
4. **自定义 Voter**：实现复杂的权限判断逻辑
5. **动态加载**：从数据库实时获取权限配置

当简单的 `hasRole()` 无法满足需求时，自定义 Voter 就是解决方案。

---

## 下一步

- 想了解权限模型设计？→ [RBAC 权限模型](/framework/springsecurity/rbac)
- 想学习接口权限设计？→ [接口权限数据模型](/framework/springsecurity/permission-model)
- 想了解权限注解？→ [@PreAuthorize 与权限控制](/framework/springsecurity/preauthorize)
