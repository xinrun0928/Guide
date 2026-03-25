# Shiro 授权流程：isPermitted() 与 Permissions

用户登录了，但登录不代表可以访问所有资源。

一个普通用户不能访问管理后台，一个付费用户才能查看付费内容——这就是授权要解决的问题。

这一节，我们深入理解 Shiro 的授权机制。

## 两种授权方式

Shiro 支持两种级别的访问控制：

| 方式 | 方法 | 示例 | 粒度 |
|-----|------|-----|------|
| **角色检查** | `hasRole()` | `subject.hasRole("admin")` | 粗粒度 |
| **权限检查** | `isPermitted()` | `subject.isPermitted("user:create")` | 细粒度 |

### 角色检查

```java
Subject subject = SecurityUtils.getSubject();

// 检查是否拥有某个角色
if (subject.hasRole("admin")) {
    // 显示管理后台入口
}

// 检查是否拥有所有指定角色
if (subject.hasAllRoles(Arrays.asList("admin", "user"))) {
    // 同时拥有 admin 和 user 角色
}

// 获取所有角色
Set&lt;String&gt; roles = subject.getPrincipals().byType(String.class);
```

### 权限检查

```java
Subject subject = SecurityUtils.getSubject();

// 检查是否拥有某个权限
if (subject.isPermitted("user:create")) {
    // 可以创建用户
}

// 检查是否同时拥有多个权限
if (subject.isPermitted("user:create", "user:update")) {
    // 同时拥有创建和更新用户的权限
}

// 检查是否拥有所有指定权限
boolean permittedAll = subject.isPermittedAll("user:create", "user:delete");
```

## Shiro 权限模型：WildcardPermission

Shiro 使用 **Wildcard 权限语法**，它比简单的字符串匹配更强大。

### 权限字符串格式

```
module:action:instance
```

三个部分，用冒号分隔：

```
user:create        → user 模块的 create 操作
user:create:1      → user 模块的 create 操作，操作对象是 ID 为 1 的用户
user:*              → user 模块的所有操作
*:create            → 所有模块的 create 操作
*:*                 → 所有模块的所有操作
```

### 实际业务中的权限设计

```java
// 订单模块
order:create       // 创建订单
order:view:1001    // 查看 ID 为 1001 的订单
order:cancel:1001  // 取消 ID 为 1001 的订单
order:*            // 所有订单操作

// 商品模块
product:add        // 添加商品
product:edit:2001 // 编辑 ID 为 2001 的商品
product:delete    // 删除商品
product:list       // 商品列表

// 系统模块
system:user:list   // 用户列表
system:user:add    // 添加用户
system:role:assign // 分配角色
```

## 权限检查的内部流程

```
subject.isPermitted("user:create")
          │
          ▼
┌────────────────────────────────────┐
│  SecurityManager                  │
│    └─▶ Authorizer.isPermitted()   │
└────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────┐
│  Authorizer 调用 CacheManager     │
│    检查权限缓存                    │
└────────────────────────────────────┘
          │
          ├─ 缓存命中 ──▶ 直接返回
          │
          ▼ 缓存未命中
┌────────────────────────────────────┐
│  ModularRealmAuthorizer           │
│    遍历所有 Realm                 │
└────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────┐
│  Realm.doGetAuthorizationInfo()  │
│    从数据库查询权限信息           │
└────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────┐
│  权限比对                          │
│    判断是否包含请求的权限          │
└────────────────────────────────────┘
```

## Realm 中的授权实现

```java
public class MyRealm extends AuthorizingRealm {
    
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) {
        
        // 1. 获取当前登录用户名
        String username = (String) principals.getPrimaryPrincipal();
        
        // 2. 查询用户的角色
        Set&lt;String&gt; roles = userDAO.findRolesByUsername(username);
        
        // 3. 查询用户的权限
        Set&lt;String&gt; permissions = userDAO.findPermissionsByUsername(username);
        
        // 4. 返回授权信息
        SimpleAuthorizationInfo info = new SimpleAuthorizationInfo();
        info.setRoles(roles);
        info.setStringPermissions(permissions);
        
        return info;
    }
}
```

### 角色 vs 权限：什么时候用哪个？

**角色**适合粗粒度的分类：

```java
// 场景：只有管理员才能访问后台
if (subject.hasRole("admin")) {
    // 显示管理后台入口
}
```

**权限**适合细粒度的控制：

```java
// 场景：检查用户是否有编辑特定文章的权限
if (subject.isPermitted("article:edit:" + articleId)) {
    // 显示编辑按钮
}
```

## 编程式授权

### checkPermission() vs isPermitted()

```java
Subject subject = SecurityUtils.getSubject();

// isPermitted()：返回 boolean，不抛异常
if (subject.isPermitted("user:delete")) {
    // 执行删除
}

// checkPermission()：权限不足时抛出异常
try {
    subject.checkPermission("user:delete");
    // 执行删除
} catch (UnauthorizedException e) {
    // 处理权限不足
}
```

**建议**：除非你确实需要捕获权限异常，否则用 `isPermitted()` 更简洁。

### 基于角色的逻辑

```java
// 检查单个角色
boolean isAdmin = subject.hasRole("admin");

// 检查多个角色（所有都满足才返回 true）
boolean hasAllRoles = subject.hasAllRoles(Arrays.asList("admin", "manager"));

// 获取所有角色
boolean[] roleResults = subject.hasRoles(roleList);
for (int i = 0; i &lt; roleList.size(); i++) {
    System.out.println(roleList.get(i) + ": " + roleResults[i]);
}
```

## 授权缓存

每次调用 `isPermitted()` 都要查数据库？那性能会很糟糕。

Shiro 支持权限缓存，配置方式：

```java
// 方式一：使用 EhCache（默认）
CacheManager cacheManager = new EhCacheManager();
securityManager.setCacheManager(cacheManager);

// 方式二：使用 Redis
RedisCacheManager redisCacheManager = new RedisCacheManager();
redisCacheManager.setRedisManager(redisManager);
securityManager.setCacheManager(redisCacheManager);
```

缓存生效后，授权信息会被缓存。**但要注意**：用户权限变更后，需要清除缓存：

```java
// 清除用户的授权缓存
Cache&lt;Object, AuthorizationInfo&gt; cache = 
    securityManager.getCache("authorizationCache");
cache.remove(username);

// 或者使用 Subject 的方法
subject.releaseRunAs();
```

## 权限注解

Shiro 提供了丰富的注解支持，配合 AOP 使用：

```java
@RequiresAuthentication      // 需要认证
@RequiresGuest              // 需要匿名访问
@RequiresUser               // 需要已认证或 RememberMe
@RequiresPermissions("user:delete")  // 需要特定权限
@RequiresRoles("admin")     // 需要特定角色
```

注解详细用法会在后续章节展开。

## 实际业务场景

### 场景一：按钮级别的权限控制

```java
@GetMapping("/user/{id}")
public String userDetail(@PathVariable Long id, Model model) {
    Subject subject = SecurityUtils.getSubject();
    
    User user = userService.findById(id);
    model.addAttribute("user", user);
    
    // 只有编辑权限的用户才显示编辑按钮
    model.addAttribute("canEdit", 
        subject.isPermitted("user:edit:" + id));
    
    // 只有删除权限的用户才显示删除按钮
    model.addAttribute("canDelete", 
        subject.isPermitted("user:delete:" + id));
    
    return "user/detail";
}
```

### 场景二：服务层的权限校验

```java
@Service
public class OrderService {
    
    @Autowired
    private SecurityManager securityManager;
    
    public void cancelOrder(Long orderId) {
        Subject subject = SecurityUtils.getSubject();
        
        // 检查是否有取消订单的权限
        if (!subject.isPermitted("order:cancel:" + orderId)) {
            throw new UnauthorizedException("您没有权限取消此订单");
        }
        
        // 执行业务逻辑
        Order order = orderRepository.findById(orderId);
        order.setStatus(OrderStatus.CANCELLED);
        orderRepository.save(order);
    }
}
```

### 场景三：数据级别的权限控制

```java
// 自定义权限检查逻辑
public class DataPermissionFilter extends PathMatchingFilter&lt;Boolean&gt; {
    
    @Override
    protected boolean onPreHandle(String requestURI, Object mappedValue) {
        Subject subject = SecurityUtils.getSubject();
        
        // 提取请求中的数据 ID
        String dataId = extractDataId(requestURI);
        
        if (dataId == null) {
            return true; // 无需数据级别权限控制
        }
        
        // 检查是否有访问此数据的权限
        return subject.isPermitted("data:view:" + dataId);
    }
    
    private String extractDataId(String requestURI) {
        // 从 URL 中提取数据 ID，例如 /order/1001 → 1001
        Pattern pattern = Pattern.compile("/order/(\\d+)");
        Matcher matcher = pattern.matcher(requestURI);
        return matcher.find() ? matcher.group(1) : null;
    }
}
```

## 面试追问方向

**面试官可能会问**：

1. **Shiro 的权限模型是什么？**
   - 重点：WildcardPermission 的结构 `module:action:instance`

2. **hasRole() 和 isPermitted() 有什么区别？**
   - 角色是粗粒度，权限是细粒度
   - 角色通常用于分类，权限用于具体操作

3. **如果用户权限变更了，缓存怎么处理？**
   - 主动清除缓存
   - 设置缓存过期时间
   - 使用动态刷新机制

4. **Shiro 的授权信息存储在哪里？**
   - 存在 Subject 的 PrincipalCollection 中
   - 实际数据来自 Realm

---

## 留给你的问题

我们已经知道 Shiro 如何检查权限，但权限数据本身是从哪来的？

下一节，我们会深入讨论 Realm 的实现——从最简单 IniRealm，到连接数据库的 JDBCRealm，再到完全自定义的 Realm。
