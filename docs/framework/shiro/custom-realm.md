# 自定义 Realm：继承 AuthorizingRealm

JDBCRealm 的表结构是固定的，但真实项目的数据模型往往五花八门。

这一节，我们来学习如何编写一个完全自定义的 Realm。

## 为什么需要自定义 Realm？

| 场景 | JDBCRealm | 自定义 Realm |
|-----|-----------|-------------|
| 表名不同 | 需要配置 SQL | 直接写 |
| 多表联合查询 | 很难配置 | 轻松实现 |
| 动态权限计算 | 不支持 | 随心所欲 |
| 业务逻辑集成 | 无法实现 | 完美集成 |

简单来说：**自定义 Realm = 完全掌控认证授权逻辑**。

## Realm 的继承体系

```
AuthenticationRealm
    │
    └── AuthorizingRealm
            │
            ├── JdbcRealm
            └── IniRealm
            └── 自定义 Realm（我们写的）
```

- `AuthenticationRealm`：基础认证，提供认证方法
- `AuthorizingRealm`：授权支持，提供授权方法和缓存

**通常我们继承 `AuthorizingRealm`**，因为大多数场景既需要认证也需要授权。

## 自定义 Realm 骨架

```java
public class CustomRealm extends AuthorizingRealm {
    
    // 认证：从数据库验证用户身份
    @Override
    protected AuthenticationInfo doGetAuthenticationInfo(
            AuthenticationToken token) throws AuthenticationException {
        // ...
    }
    
    // 授权：从数据库获取用户权限
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) throws AuthorizationException {
        // ...
    }
    
    // 密码比对（如果需要自定义）
    @Override
    protected boolean onCredentialsMatch(
            AuthenticationToken token, 
            AuthenticationInfo info) {
        // ...
    }
}
```

## 完整实现

### 实体类

```java
public class User {
    private Long id;
    private String username;
    private String password;
    private String salt;
    private Integer status;  // 1: 正常, 0: 锁定
    private Date createTime;
    // getters and setters
}

public class Role {
    private Long id;
    private String roleName;
    private String description;
    // getters and setters
}

public class Permission {
    private Long id;
    private String permission;  // 如 "user:create"
    private String description;
    // getters and setters
}
```

### Mapper 接口

```java
@Mapper
public interface UserMapper {
    
    @Select("SELECT * FROM users WHERE username = #{username}")
    User findByUsername(String username);
    
    @Select("SELECT r.* FROM roles r " +
            "INNER JOIN user_roles ur ON r.id = ur.role_id " +
            "INNER JOIN users u ON u.id = ur.user_id " +
            "WHERE u.username = #{username}")
    List&lt;Role&gt; findRolesByUsername(String username);
    
    @Select("SELECT p.* FROM permissions p " +
            "INNER JOIN role_permissions rp ON p.id = rp.permission_id " +
            "INNER JOIN roles r ON r.id = rp.role_id " +
            "INNER JOIN user_roles ur ON r.id = ur.role_id " +
            "INNER JOIN users u ON u.id = ur.user_id " +
            "WHERE u.username = #{username}")
    List&lt;Permission&gt; findPermissionsByUsername(String username);
}
```

### 自定义 Realm

```java
@Component
public class CustomRealm extends AuthorizingRealm {
    
    @Autowired
    private UserMapper userMapper;
    
    /**
     * 认证：验证用户身份
     */
    @Override
    protected AuthenticationInfo doGetAuthenticationInfo(
            AuthenticationToken token) throws AuthenticationException {
        
        // 1. 获取用户名
        UsernamePasswordToken upToken = (UsernamePasswordToken) token;
        String username = upToken.getUsername();
        
        // 2. 查询用户
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UnknownAccountException("用户不存在");
        }
        
        // 3. 检查账户状态
        if (user.getStatus() == 0) {
            throw new LockedAccountException("账户已被锁定");
        }
        
        // 4. 返回认证信息
        // Shiro 会自动调用 CredentialsMatcher 比对密码
        return new SimpleAuthenticationInfo(
            user.getUsername(),    // principal
            user.getPassword(),    // credentials
            ByteSource.Util.bytes(user.getSalt()),  // salt
            getName()             // realm name
        );
    }
    
    /**
     * 授权：获取用户权限
     */
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) {
        
        // 1. 获取用户名
        String username = (String) principals.getPrimaryPrincipal();
        
        // 2. 查询角色
        List&lt;Role&gt; roles = userMapper.findRolesByUsername(username);
        
        // 3. 查询权限
        List&lt;Permission&gt; permissions = userMapper.findPermissionsByUsername(username);
        
        // 4. 构建授权信息
        SimpleAuthorizationInfo info = new SimpleAuthorizationInfo();
        
        // 设置角色
        if (roles != null && !roles.isEmpty()) {
            Set&lt;String&gt; roleNames = roles.stream()
                .map(Role::getRoleName)
                .collect(Collectors.toSet());
            info.setRoles(roleNames);
        }
        
        // 设置权限
        if (permissions != null && !permissions.isEmpty()) {
            Set&lt;String&gt; perms = permissions.stream()
                .map(Permission::getPermission)
                .collect(Collectors.toSet());
            info.setStringPermissions(perms);
        }
        
        return info;
    }
    
    /**
     * 清除授权缓存
     */
    public void clearCachedAuthorizationInfo(String username) {
        SimplePrincipalCollection principals = 
            new SimplePrincipalCollection(username, getName());
        clearCachedAuthorizationInfo(principals);
    }
}
```

### 密码加密配置

```java
@Configuration
public class ShiroConfig {
    
    @Bean
    public SecurityManager securityManager(CustomRealm customRealm) {
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        
        // 配置密码加密
        HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
        matcher.setHashAlgorithmName("SHA-256");
        matcher.setHashIterations(3);
        matcher.setStoredCredentialsHexEncoded(false);  // base64 编码
        customRealm.setCredentialsMatcher(matcher);
        
        // 启用缓存
        CacheManager cacheManager = new EhCacheManager();
        customRealm.setCacheManager(cacheManager);
        
        manager.setRealm(customRealm);
        return manager;
    }
}
```

### 密码加密工具

```java
@Component
public class PasswordEncoder {
    
    /**
     * 加密密码
     */
    public String encodePassword(String rawPassword, String salt) {
        SimpleHash hash = new SimpleHash(
            "SHA-256",
            rawPassword,
            salt,
            3
        );
        return hash.toBase64();  // 返回 base64 编码
    }
    
    /**
     * 验证密码
     */
    public boolean matches(String rawPassword, String salt, String encodedPassword) {
        String encoded = encodePassword(rawPassword, salt);
        return encoded.equals(encodedPassword);
    }
    
    /**
     * 生成随机盐值
     */
    public String generateSalt() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
```

## 复杂业务场景

### 场景一：动态权限计算

```java
@Override
protected AuthorizationInfo doGetAuthorizationInfo(
        PrincipalCollection principals) {
    
    String username = (String) principals.getPrimaryPrincipal();
    User user = userMapper.findByUsername(username);
    
    SimpleAuthorizationInfo info = new SimpleAuthorizationInfo();
    
    // 基础角色权限
    List&lt;Role&gt; roles = userMapper.findRolesByUsername(username);
    Set&lt;String&gt; roleNames = roles.stream()
        .map(Role::getRoleName)
        .collect(Collectors.toSet());
    info.setRoles(roleNames);
    
    // 动态计算数据权限
    // 例如：部门经理只能查看本部门的数据
    if (user.getDepartmentId() != null) {
        info.addStringPermission("data:department:" + user.getDepartmentId());
    }
    
    // 例如：VIP 用户有额外的权限
    if (user.isVip()) {
        info.addStringPermission("content:vip:view");
    }
    
    return info;
}
```

### 场景二：多数据源切换

```java
@Component
public class MultiTenantRealm extends AuthorizingRealm {
    
    @Autowired
    private UserMapper userMapper;
    
    @Autowired
    private TenantContext tenantContext;  // 租户上下文
    
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) {
        
        String username = (String) principals.getPrimaryPrincipal();
        Long tenantId = tenantContext.getCurrentTenantId();
        
        // 根据租户查询权限
        List&lt;Permission&gt; permissions = 
            userMapper.findPermissionsByUsernameAndTenant(username, tenantId);
        
        SimpleAuthorizationInfo info = new SimpleAuthorizationInfo();
        info.setStringPermissions(
            permissions.stream()
                .map(Permission::getPermission)
                .collect(Collectors.toSet())
        );
        
        return info;
    }
}
```

### 场景三：权限变更时清除缓存

```java
@Service
public class UserService {
    
    @Autowired
    private CustomRealm customRealm;
    
    @Autowired
    private CacheManager cacheManager;
    
    public void updateUserRoles(Long userId, List&lt;Long&gt; roleIds) {
        // 更新数据库
        userRoleMapper.updateUserRoles(userId, roleIds);
        
        // 获取用户名
        String username = userMapper.findById(userId).getUsername();
        
        // 清除该用户的授权缓存
        Cache&lt;Object, AuthorizationInfo&gt; cache = 
            cacheManager.getCache("authorizationCache");
        if (cache != null) {
            cache.remove(username);
        }
    }
}
```

## Realm 完整配置

```java
@Configuration
public class ShiroConfig {
    
    @Bean
    public SecurityManager securityManager(CustomRealm customRealm) {
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        
        // 密码加密
        HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
        matcher.setHashAlgorithmName("SHA-256");
        matcher.setHashIterations(3);
        customRealm.setCredentialsMatcher(matcher);
        
        // 授权缓存
        customRealm.setCachingEnabled(true);
        customRealm.setAuthorizationCachingEnabled(true);
        customRealm.setAuthorizationCacheName("authorizationCache");
        
        // 认证缓存
        customRealm.setAuthenticationCachingEnabled(true);
        customRealm.setAuthenticationCacheName("authenticationCache");
        
        manager.setRealm(customRealm);
        
        return manager;
    }
    
    @Bean
    public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
        ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
        factory.setSecurityManager(manager);
        factory.setLoginUrl("/login");
        factory.setUnauthorizedUrl("/403");
        
        Map&lt;String, String&gt; filterChain = new LinkedHashMap&lt;&gt;();
        filterChain.put("/static/**", "anon");
        filterChain.put("/login", "anon");
        filterChain.put("/logout", "logout");
        filterChain.put("/admin/**", "authc, roles[admin]");
        filterChain.put("/user/**", "authc, perms[user:*]");
        filterChain.put("/**", "authc");
        
        factory.setFilterChainDefinitionMap(filterChain);
        
        return factory;
    }
    
    @Bean
    public LifecycleBeanPostProcessor lifecycleBeanPostProcessor() {
        return new LifecycleBeanPostProcessor();
    }
    
    @Bean
    @DependsOn("lifecycleBeanPostProcessor")
    public DefaultAdvisorAutoProxyCreator defaultAdvisorAutoProxyCreator() {
        DefaultAdvisorAutoProxyCreator creator = new DefaultAdvisorAutoProxyCreator();
        creator.setProxyTargetClass(true);
        return creator;
    }
    
    @Bean
    public AuthorizationAttributeSourceAdvisor authorizationAttributeSourceAdvisor(
            SecurityManager securityManager) {
        AuthorizationAttributeSourceAdvisor advisor = 
            new AuthorizationAttributeSourceAdvisor();
        advisor.setSecurityManager(securityManager);
        return advisor;
    }
}
```

## 面试追问方向

**面试官可能会问**：

1. **自定义 Realm 需要重写哪些方法？**
   - `doGetAuthenticationInfo()`：认证
   - `doGetAuthorizationInfo()`：授权

2. **Realm 的缓存是怎么工作的？**
   - Shiro 默认使用 EhCache
   - 可以配置 Redis 缓存

3. **如何实现权限的动态更新？**
   - 权限变更后清除缓存
   - 使用 `Realm.clearCachedAuthorizationInfo()`

---

## 留给你的问题

我们已经实现了自定义 Realm，但密码是怎么比对的？

下一节，我们深入学习 Shiro 的密码加密机制——HashedCredentialsMatcher 与盐值。
