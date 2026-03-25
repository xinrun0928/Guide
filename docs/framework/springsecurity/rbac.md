# RBAC 权限模型与数据表设计

你有没有想过，一个拥有几万员工的企业，权限管理是怎么做到的？

难道要给每个员工单独配置每个资源的权限？那运维人员不得疯掉？

这就是 RBAC 模型存在的意义——通过「角色」这个中间层，让权限管理变得简单可控。

今天，我们就来深入了解 RBAC 权限模型。

---

## 什么是 RBAC？

RBAC（Role-Based Access Control）——基于角色的访问控制。

**核心思想**：不再直接给用户分配权限，而是先把权限分配给角色，再把角色分配给用户。

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          RBAC 核心思想                                    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  传统方式（直接分配权限）：                                              │
│                                                                          │
│  用户 A ──► 权限 1                                                       │
│  用户 A ──► 权限 2                                                       │
│  用户 A ──► 权限 3                                                       │
│  ...                                                                     │
│  当有 1000 个用户，每个用户有 50 个权限时 = 50000 条记录                   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  RBAC 方式（通过角色）：                                                 │
│                                                                          │
│  用户 ──► 角色 ──► 权限                                                  │
│                                                                          │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐                        │
│  │  用户 A  │ ───► │  管理员  │ ───► │ 权限 1  │                        │
│  │  用户 B  │ ───► │         │ ───► │ 权限 2  │                        │
│  │  用户 C  │ ───► └─────────┘───► │ 权限 3  │                        │
│  └─────────┘                       └─────────┘                        │
│       │                                                                    │
│       │                       ┌─────────┐      ┌─────────┐              │
│       └─────────────────────► │ 普通用户 │ ───► │ 权限 4  │              │
│                               └─────────┘      │ 权限 5  │              │
│                                                 └─────────┘              │
│                                                                          │
│  当有 1000 个用户，10 个角色，每个角色有 50 个权限时：                    │
│  用户-角色关系：1000 条                                                   │
│  角色-权限关系：500 条                                                    │
│  总计：1500 条 << 50000 条                                               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## RBAC 的四个核心模型

### RBAC0：最基础模型

```
用户 ──► 用户角色关系 ──► 角色 ──► 角色权限关系 ──► 权限
```

用户和角色是多对多关系，角色和权限也是多对多关系。

### RBAC1：增加角色继承

```
角色等级：
ROLE_ADMIN > ROLE_MANAGER > ROLE_EMPLOYEE

继承关系：
ROLE_ADMIN（管理员）继承自 ROLE_MANAGER（经理）
ROLE_MANAGER 继承自 ROLE_EMPLOYEE（员工）
```

拥有高级角色的用户，自动拥有低级角色的所有权限。

### RBAC2：增加约束

| 约束类型 | 说明 |
|---------|------|
| 互斥角色 | 用户不能同时拥有两个互斥的角色（如会计和出纳） |
| 基数约束 | 限制用户拥有的角色数量 |
| 先决条件 | 用户要获得某角色，必须先拥有另一个角色 |

### RBAC3：完整模型

RBAC1 + RBAC2，支持角色继承和约束。

---

## 数据表设计

### 最简设计（RBAC0）

```sql
-- 用户表
CREATE TABLE sys_user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    status TINYINT DEFAULT 1 COMMENT '1:正常, 0:禁用',
    create_time DATETIME,
    update_time DATETIME
);

-- 角色表
CREATE TABLE sys_role (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_code VARCHAR(50) NOT NULL UNIQUE COMMENT '角色代码，如 ADMIN',
    role_name VARCHAR(100) COMMENT '角色名称',
    description VARCHAR(500) COMMENT '描述',
    create_time DATETIME
);

-- 权限表
CREATE TABLE sys_permission (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    permission_code VARCHAR(100) NOT NULL UNIQUE COMMENT '权限代码',
    permission_name VARCHAR(100) COMMENT '权限名称',
    permission_type VARCHAR(20) COMMENT 'PERMISSION, MENU, BUTTON',
    resource_type VARCHAR(20) COMMENT 'URL, METHOD, DATA',
    resource_value VARCHAR(500) COMMENT '资源标识',
    parent_id BIGINT DEFAULT 0 COMMENT '父权限ID',
    sort_order INT DEFAULT 0,
    create_time DATETIME
);

-- 用户角色关联表
CREATE TABLE sys_user_role (
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

-- 角色权限关联表
CREATE TABLE sys_role_permission (
    role_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);
```

### 完整设计（RBAC1 + 角色继承）

```sql
-- 用户表
CREATE TABLE sys_user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    nickname VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(20),
    avatar VARCHAR(500),
    dept_id BIGINT COMMENT '所属部门',
    status TINYINT DEFAULT 1 COMMENT '1:正常, 0:禁用',
    last_login_time DATETIME,
    last_login_ip VARCHAR(50),
    password_expire_time DATETIME,
    create_time DATETIME,
    update_time DATETIME
);

-- 角色表（增加层级）
CREATE TABLE sys_role (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_code VARCHAR(50) NOT NULL UNIQUE,
    role_name VARCHAR(100),
    description VARCHAR(500),
    parent_id BIGINT DEFAULT 0 COMMENT '父角色ID，0表示顶级',
    role_level INT DEFAULT 0 COMMENT '角色层级，越高级别数字越大',
    data_scope TINYINT DEFAULT 1 COMMENT '数据权限范围：1全部, 2本部门, 3本部门及以下, 4仅本人',
    status TINYINT DEFAULT 1,
    create_time DATETIME,
    update_time DATETIME
);

-- 角色继承关系表
CREATE TABLE sys_role_inherit (
    role_id BIGINT NOT NULL COMMENT '子角色',
    inherit_role_id BIGINT NOT NULL COMMENT '父角色',
    PRIMARY KEY (role_id, inherit_role_id)
);

-- 权限表
CREATE TABLE sys_permission (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    permission_code VARCHAR(100) NOT NULL UNIQUE,
    permission_name VARCHAR(100),
    permission_type VARCHAR(20) COMMENT 'MENU, BUTTON, API',
    resource_type VARCHAR(20) COMMENT 'URL, METHOD',
    resource_value VARCHAR(500),
    http_method VARCHAR(10) COMMENT 'GET, POST, PUT, DELETE',
    parent_id BIGINT DEFAULT 0,
    path VARCHAR(500) COMMENT '菜单路径',
    icon VARCHAR(100) COMMENT '菜单图标',
    sort_order INT DEFAULT 0,
    external_link TINYINT DEFAULT 0 COMMENT '是否外链',
    visible TINYINT DEFAULT 1 COMMENT '是否显示',
    status TINYINT DEFAULT 1,
    create_time DATETIME
);

-- 用户角色关联表
CREATE TABLE sys_user_role (
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    create_time DATETIME,
    PRIMARY KEY (user_id, role_id)
);

-- 角色权限关联表
CREATE TABLE sys_role_permission (
    role_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    create_time DATETIME,
    PRIMARY KEY (role_id, permission_id)
);

-- 部门表
CREATE TABLE sys_dept (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    parent_id BIGINT DEFAULT 0,
    dept_name VARCHAR(100) NOT NULL,
    dept_code VARCHAR(50),
    leader VARCHAR(50),
    phone VARCHAR(20),
    email VARCHAR(100),
    sort_order INT DEFAULT 0,
    create_time DATETIME
);
```

---

## 常用查询

### 查询用户的直接权限

```sql
SELECT DISTINCT p.permission_code
FROM sys_user_role ur
INNER JOIN sys_role_permission rp ON ur.role_id = rp.role_id
INNER JOIN sys_permission p ON rp.permission_id = p.id
WHERE ur.user_id = ?
  AND p.status = 1
  AND ur.user_id IN (
      SELECT ur2.user_id FROM sys_user_role ur2 
      WHERE ur2.role_id = ur.role_id
  );
```

### 查询用户的权限（含继承）

```sql
-- 展开角色继承链，然后查询所有权限
WITH RECURSIVE role_chain AS (
    -- 基础角色
    SELECT r.id, r.parent_id, r.role_code
    FROM sys_role r
    INNER JOIN sys_user_role ur ON r.id = ur.role_id
    WHERE ur.user_id = ?
    
    UNION ALL
    
    -- 继承的角色
    SELECT r.id, r.parent_id, r.role_code
    FROM sys_role r
    INNER JOIN role_chain rc ON r.id = rc.parent_id
)
SELECT DISTINCT p.permission_code
FROM role_chain rc
INNER JOIN sys_role_permission rp ON rc.id = rp.role_id
INNER JOIN sys_permission p ON rp.permission_id = p.id
WHERE p.status = 1;
```

### 查询用户的所有角色

```sql
SELECT r.*
FROM sys_role r
INNER JOIN sys_user_role ur ON r.id = ur.role_id
WHERE ur.user_id = ?;
```

---

## Java 实现

### 实体类

```java
@Entity
@Table(name = "sys_user")
public class User {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(nullable = false, unique = true)
    private String username;
    
    private String password;
    private String nickname;
    private String email;
    private Integer status;
    
    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
        name = "sys_user_role",
        joinColumns = @JoinColumn(name = "user_id"),
        inverseJoinColumns = @JoinColumn(name = "role_id")
    )
    private Set&lt;Role&gt; roles;
}

@Entity
@Table(name = "sys_role")
public class Role {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(unique = true)
    private String roleCode;
    
    private String roleName;
    private String description;
    
    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
        name = "sys_role_permission",
        joinColumns = @JoinColumn(name = "role_id"),
        inverseJoinColumns = @JoinColumn(name = "permission_id")
    )
    private Set&lt;Permission&gt; permissions;
}

@Entity
@Table(name = "sys_permission")
public class Permission {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(unique = true)
    private String permissionCode;
    
    private String permissionName;
    private String permissionType;  // MENU, BUTTON, API
    private String resourceType;     // URL, METHOD
    private String resourceValue;
}
```

### 权限查询服务

```java
@Service
public class PermissionService {
    
    @Autowired
    private RoleRepository roleRepository;
    
    /**
     * 获取用户的所有权限
     */
    public Set&lt;String&gt; getUserPermissions(Long userId) {
        Set&lt;String&gt; permissions = new HashSet&lt;&gt;();
        
        // 获取用户角色
        Set&lt;Role&gt; roles = roleRepository.findByUserId(userId);
        
        // 展开角色继承链
        Set&lt;Role&gt; allRoles = expandRoleHierarchy(roles);
        
        // 收集所有权限
        for (Role role : allRoles) {
            role.getPermissions().forEach(p -> 
                permissions.add(p.getPermissionCode())
            );
        }
        
        return permissions;
    }
    
    /**
     * 展开角色继承链
     */
    private Set&lt;Role&gt; expandRoleHierarchy(Set&lt;Role&gt; roles) {
        Set&lt;Role&gt; result = new HashSet&lt;&gt;(roles);
        Queue&lt;Role&gt; queue = new LinkedList&lt;&gt;(roles);
        
        while (!queue.isEmpty()) {
            Role role = queue.poll();
            
            // 查询继承的角色
            List&lt;Role&gt; parentRoles = roleRepository
                .findByParentId(role.getId());
            
            for (Role parent : parentRoles) {
                if (result.add(parent)) {
                    queue.add(parent);
                }
            }
        }
        
        return result;
    }
}
```

---

## Spring Security 集成

### 自定义 UserDetailsService

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {
    
    @Autowired
    private UserRepository userRepository;
    
    @Autowired
    private PermissionService permissionService;
    
    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userRepository.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在: " + username);
        }
        
        // 获取用户权限
        Set&lt;String&gt; permissions = permissionService.getUserPermissions(user.getId());
        
        // 转换为 GrantedAuthority
        Set&lt;GrantedAuthority&gt; authorities = permissions.stream()
            .map(SimpleGrantedAuthority::new)
            .collect(Collectors.toSet());
        
        // 添加角色
        user.getRoles().forEach(role -> 
            authorities.add(new SimpleGrantedAuthority("ROLE_" + role.getRoleCode()))
        );
        
        return User.builder()
            .username(user.getUsername())
            .password(user.getPassword())
            .authorities(authorities)
            .accountExpired(false)
            .accountLocked(user.getStatus() == 0)
            .credentialsExpired(false)
            .disabled(user.getStatus() == 0)
            .build();
    }
}
```

---

## 常见问题

### 问题一：用户离职后如何处理？

```java
// 方案一：直接删除用户
userRepository.deleteById(userId);

// 方案二：禁用用户（推荐）
user.setStatus(0);
userRepository.save(user);

// 同时清空用户角色关系
userRoleRepository.deleteByUserId(userId);
```

### 问题二：权限变更后如何生效？

```java
// 方案一：使用权限缓存
@Cacheable(value = "userPermissions", key = "#userId")
public Set&lt;String&gt; getUserPermissions(Long userId) { }

// 修改权限时清除缓存
@CacheEvict(value = "userPermissions", key = "#userId")
public void updateUserPermissions(Long userId) { }

// 方案二：强制用户重新登录
sessionRegistry.getAllSessions(user, false).forEach(SessionInformation::expireNow);
```

### 问题三：如何实现数据权限？

```java
// 数据权限范围枚举
public enum DataScope {
    ALL,           // 全部数据
    DEPT_ONLY,     // 本部门数据
    DEPT_AND_CHILD, // 本部门及以下数据
    SELF           // 仅本人数据
}

// 在查询时添加数据权限过滤
@Query("SELECT o FROM Order o WHERE o.userId = :userId")
List&lt;Order&gt; findMyOrders(@Param("userId") Long userId);

@Query("SELECT o FROM Order o WHERE o.deptId IN :deptIds")
List&lt;Order&gt; findByDeptIds(@Param("deptIds") List&lt;Long&gt; deptIds);
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| RBAC 的核心思想是什么？ | 概念理解 | 本篇 |
| RBAC0、RBAC1、RBAC2、RBAC3 的区别？ | 模型理解 | 本篇 |
| 如何设计一个权限系统？ | 系统设计 | 本篇 |
| 角色继承怎么处理？ | 实现能力 | 本篇 |
| 数据权限怎么实现？ | 进阶能力 | 数据权限 |

---

## 总结

RBAC 权限模型的核心：

1. **用户-角色-权限三层结构**：简化权限管理
2. **多对多关系**：灵活配置
3. **角色继承**：减少重复配置
4. **约束机制**：互斥角色、基数约束等
5. **数据权限**：控制数据访问范围

RBAC 是目前最主流的权限管理模型，几乎所有企业级系统都在使用。

---

## 下一步

- 想了解接口权限设计？→ [接口权限数据模型](/framework/springsecurity/permission-model)
- 想实现动态权限？→ [动态权限决策](/framework/springsecurity/access-decision)
- 想学习权限注解？→ [@PreAuthorize 与权限控制](/framework/springsecurity/preauthorize)
