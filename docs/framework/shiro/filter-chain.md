# Shiro 过滤器链：anon、authc、roles、perms、logout

上一节我们用到了 `anon`、`authc`、`logout` 这些过滤器，但你真的了解它们吗？

这一节，我们深入学习 Shiro 的过滤器链。

## Shiro 过滤器架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      ShiroFilterChain                            │
│                                                                  │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐        │
│  │  anon   │ → │  authc  │ → │  roles  │ → │  perms  │ → ... │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Shiro 的过滤器是**链式调用**的，请求会依次经过每个过滤器。

## 内置过滤器

| 过滤器 | 类名 | 说明 |
|-------|------|------|
| `anon` | AnonymousFilter | 匿名访问，不需要认证 |
| `authc` | FormAuthenticationFilter | 表单认证，需要登录 |
| `authcBasic` | BasicHttpAuthenticationFilter | HTTP Basic 认证 |
| `user` | UserFilter | 已认证或 RememberMe |
| `logout` | LogoutFilter | 登出 |
| `noSessionCreation` | NoSessionCreationFilter | 不创建 Session |
| `perms` | PermissionsAuthorizationFilter | 权限校验 |
| `port` | PortFilter | 端口校验 |
| `rest` | HttpMethodPermissionFilter | REST 风格 |
| `roles` | RolesAuthorizationFilter | 角色校验 |
| `ssl` | SslFilter | HTTPS 强制跳转 |

## 过滤器详解

### 1. anon - 匿名过滤器

```java
// 格式
filterChain.addPathDefinition("/path", "anon");

// 示例
filterChain.addPathDefinition("/login", "anon");           // 登录页面
filterChain.addPathDefinition("/register", "anon");       // 注册页面
filterChain.addPathDefinition("/static/**", "anon");      // 静态资源
filterChain.addPathDefinition("/api/public/**", "anon");  // 公开 API
```

任何人都可以访问，不需要认证，不创建 Session。

### 2. authc - 表单认证过滤器

```java
// 格式
filterChain.addPathDefinition("/path", "authc");

// 示例
filterChain.addPathDefinition("/**", "authc");           // 所有请求都需要认证
```

- 未认证用户会被重定向到登录页面
- 登录成功后重定向到原始请求页面

### 3. user - 用户过滤器

```java
// 格式
filterChain.addPathDefinition("/path", "user");

// 示例
filterChain.addPathDefinition("/product/detail/**", "user");
```

- 已认证用户可以访问
- **通过 RememberMe 自动登录的用户也可以访问**
- 与 `authc` 的区别：`authc` 必须真正登录，`user` 允许 RememberMe

### 4. logout - 登出过滤器

```java
// 格式
filterChain.addPathDefinition("/path", "logout");

// 示例
filterChain.addPathDefinition("/logout", "logout");
```

访问该 URL 会自动登出，跳转到指定页面：

```java
// 配置登出后的跳转页面
factory.setFilterConfig(new FilterConfig() {
    // 默认跳转到 /login
});
```

### 5. roles - 角色过滤器

```java
// 格式：roles[role1,role2,...]
filterChain.addPathDefinition("/path", "roles[admin]");

// 示例
filterChain.addPathDefinition("/admin/**", "roles[admin]");        // 需要 admin 角色
filterChain.addPathDefinition("/manager/**", "roles[manager,admin]"); // 需要 manager 或 admin

// 注意：多个角色是 OR 关系（满足一个即可）
```

没有对应角色会跳转到未授权页面。

### 6. perms - 权限过滤器

```java
// 格式：perms[permission1,permission2,...]
filterChain.addPathDefinition("/path", "perms[user:create]");

// 示例
filterChain.addPathDefinition("/user/create", "perms[user:create]");         // 需要 user:create 权限
filterChain.addPathDefinition("/user/**", "perms[user:*]");                   // 需要 user:* 权限

// 多个权限是 AND 关系（必须同时满足）
filterChain.addPathDefinition("/order/approve", "perms[order:view,order:approve]");
```

### 7. authcBasic - HTTP Basic 认证

```java
// 格式
filterChain.addPathDefinition("/path", "authcBasic");

// 示例
filterChain.addPathDefinition("/api/**", "authcBasic");
```

弹出浏览器登录框进行认证。

### 8. noSessionCreation - 不创建 Session

```java
// 格式
filterChain.addPathDefinition("/path", "noSessionCreation");

// 示例
filterChain.addPathDefinition("/api/**", "noSessionCreation");
```

访问时不会创建新 Session，常用于 REST API。

## 过滤器组合使用

```java
// 多个过滤器用逗号分隔
filterChain.addPathDefinition("/admin/user", "authc, roles[admin]");
filterChain.addPathDefinition("/admin/setting", "authc, roles[admin], perms[system:config]");

// 解释：
// 1. 先通过 authc 认证
// 2. 再检查是否有 admin 角色
// 3. 最后检查是否有 system:config 权限
```

**执行顺序**：从左到右依次执行。

## REST API 场景

### 无状态 API

```java
@Bean
public ShiroFilterChainDefinition shiroFilterChainDefinition() {
    DefaultShiroFilterChain chain = new DefaultShiroFilterChain();
    
    // 公开接口
    chain.addPathDefinition("/api/public/**", "anon");
    
    // 需要登录的接口
    chain.addPathDefinition("/api/user/**", "authc");
    
    // 不创建 Session
    chain.addPathDefinition("/api/nosession/**", "noSessionCreation, authc");
    
    // 登出
    chain.addPathDefinition("/api/logout", "logout");
    
    return chain;
}
```

### 带权限的 REST API

```java
// REST 风格权限配置
chain.addPathDefinition("/api/users", "rest[user]");      // GET:user:list, POST:user:create
chain.addPathDefinition("/api/users/**", "rest[user]");   // GET:user:view, PUT:user:update, DELETE:user:delete
```

`HttpMethodPermissionFilter` 会根据 HTTP 方法自动转换权限：
- GET → `:view`
- POST → `:create`
- PUT → `:update`
- DELETE → `:delete`

## 自定义过滤器

### 实现 BasicFilter

```java
public class CorsFilter extends AdviceFilter {
    
    @Override
    protected boolean preHandle(ServletRequest request, 
                                ServletResponse response) throws Exception {
        HttpServletResponse httpResponse = (HttpServletResponse) response;
        httpResponse.setHeader("Access-Control-Allow-Origin", "*");
        httpResponse.setHeader("Access-Control-Allow-Methods", 
            "GET, POST, PUT, DELETE, OPTIONS");
        httpResponse.setHeader("Access-Control-Allow-Headers", 
            "Content-Type, Authorization");
        return true;
    }
}
```

### 注册自定义过滤器

```java
@Bean
public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
    ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
    factory.setSecurityManager(manager);
    
    // 定义过滤器
    Map<String, Filter> filters = new LinkedHashMap<>();
    filters.put("cors", new CorsFilter());
    filters.put("ipCheck", new IpCheckFilter());
    factory.setFilters(filters);
    
    // 配置链
    Map<String, String> chain = new LinkedHashMap<>();
    chain.addPathDefinition("/**", "cors, authc");
    factory.setFilterChainDefinitionMap(chain);
    
    return factory;
}
```

### 完整自定义过滤器示例

```java
public class IpCheckFilter extends PathMatchingFilter {
    
    private Set<String> allowedIps = new HashSet<>();
    
    @Override
    protected boolean onPreHandle(String requestURI, Object mappedValue) {
        String clientIp = getClientIp();
        
        if (allowedIps.contains(clientIp)) {
            return true;
        }
        
        // IP 不在白名单中，拒绝访问
        return false;
    }
    
    private String getClientIp() {
        // 获取客户端 IP 的逻辑
        HttpServletRequest request = WebUtils.getHttpRequest();
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty()) {
            ip = request.getRemoteAddr();
        }
        return ip;
    }
    
    public void setAllowedIps(Set<String> allowedIps) {
        this.allowedIps = allowedIps;
    }
}
```

## 过滤器执行流程

```
请求进入
    │
    ▼
┌─────────────────────────────────┐
│  ShiroFilterChainDefinition     │ 获取过滤链定义
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  遍历过滤器链                    │
│                                 │
│  ┌─────────────────────────┐   │
│  │ Filter 1: anon          │   │
│  │  ↓                      │   │
│  │  是否匿名可访问？        │   │
│  │    ├─ 是：执行并继续     │   │
│  │    └─ 否：跳过          │   │
│  └─────────────────────────┘   │
│  ┌─────────────────────────┐   │
│  │ Filter 2: authc         │   │
│  │  ↓                      │   │
│  │  是否已认证？            │   │
│  │    ├─ 是：执行并继续     │   │
│  │    └─ 否：重定向登录     │   │
│  └─────────────────────────┘   │
│  ...                            │
└─────────────────────────────────┘
    │
    ▼
请求处理
```

## 面试追问方向

**面试官可能会问**：

1. **Shiro 过滤器的执行顺序是怎样的？**
   - 按照配置顺序从左到右执行
   - 每个过滤器根据自身逻辑决定是否继续

2. **anon 和 user 的区别？**
   - anon：完全匿名，不需要任何认证
   - user：已认证或 RememberMe 即可

3. **roles 和 perms 的区别？**
   - roles：检查角色
   - perms：检查权限
   - roles[admin,user] 是 OR 关系，perms[a,b] 是 AND 关系

4. **如何实现 IP 白名单？**
   - 自定义过滤器继承 PathMatchingFilter
   - 在 preHandle 中检查 IP

---

## 留给你的问题

过滤器可以拦截 URL 级别的请求，但想在方法级别控制权限该怎么办？

下一节，我们来学习 Shiro 的注解——@RequiresAuthentication、@RequiresRoles、@RequiresPermissions。
