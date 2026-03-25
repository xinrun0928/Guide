# Shiro 权限数据模型：用户-角色-权限树状结构设计

用户、角色、权限，这三个概念你一定不陌生。

但如何设计它们之间的关系，让权限管理既灵活又易于维护？

这一节，我们来学习经典的 RBAC 模型。

## RBAC 是什么？

RBAC（Role-Based Access Control，基于角色的访问控制）是一种权限管理模型：

```
用户 ──拥有──▶ 角色 ──拥有──▶ 权限
```

用户不直接拥有权限，而是通过角色间接拥有。

## 为什么需要 RBAC？

### 直接授权的问题

```
用户 ──拥有──▶ 权限
```

- 用户 A 有 user:create、user:delete、order:create...
- 用户 B 有 user:view、order:view...
- 每次修改权限都要改用户

**问题**：权限直接绑定用户，数量爆炸，难以维护。

### RBAC 的优势

```
用户 ──拥有──▶ 角色 ──拥有──▶ 权限
```

- 创建角色「管理员」，拥有所有权限
- 创建角色「运营」，拥有部分权限
- 用户 A = 管理员角色
- 用户 B = 运营角色

**优势**：
1. 权限按角色分组，易于管理
2. 修改角色权限，所有绑定的用户同步更新
3. 用户离职，只需删除用户账号

## 数据表设计

### 经典五表设计

```
┌─────────┐       ┌─────────────┐       ┌─────────┐
│   User  │──────▶│ User_Role   │◀──────│   Role  │
└─────────┘       └─────────────┘       └────┬────┘
                                             │
                                             ▼
                                    ┌───────────────┐
                                    │ Role_Permission│◀──────┌─────────┐
                                    └───────────────┘       │Permission│
                                                            └─────────┘
```

### 表结构

```sql
-- 用户表
CREATE TABLE sys_user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(200) NOT NULL,
    salt VARCHAR(50),
    status TINYINT(1) DEFAULT 1 COMMENT '1:正常 0:禁用',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 角色表
CREATE TABLE sys_role (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(50) NOT NULL UNIQUE COMMENT '角色标识',
    role_desc VARCHAR(100) COMMENT '角色描述',
    status TINYINT(1) DEFAULT 1 COMMENT '1:正常 0:禁用',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 权限表
CREATE TABLE sys_permission (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    permission VARCHAR(100) NOT NULL UNIQUE COMMENT '权限标识',
    permission_name VARCHAR(50) NOT NULL COMMENT '权限名称',
    parent_id BIGINT DEFAULT 0 COMMENT '父权限ID',
    permission_type TINYINT(1) COMMENT '1:目录 2:菜单 3:按钮',
    url VARCHAR(200) COMMENT '菜单URL',
    icon VARCHAR(50) COMMENT '图标',
    sort_order INT DEFAULT 0,
    status TINYINT(1) DEFAULT 1,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户角色关系表
CREATE TABLE sys_user_role (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_role (user_id, role_id)
);

-- 角色权限关系表
CREATE TABLE sys_role_permission (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_role_permission (role_id, permission_id)
);
```

### 初始化数据

```sql
-- 插入用户（密码是 SHA-256 加密后的 123456）
INSERT INTO sys_user (username, password, salt) VALUES
    ('admin', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'admin'),
    ('zhangsan', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'zhangsan'),
    ('lisi', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'lisi');

-- 插入角色
INSERT INTO sys_role (role_name, role_desc) VALUES
    ('admin', '超级管理员'),
    ('manager', '运营经理'),
    ('user', '普通用户');

-- 插入权限
INSERT INTO sys_permission (permission, permission_name, parent_id, permission_type) VALUES
    ('system', '系统管理', 0, 1),
    ('system:user', '用户管理', 1, 2),
    ('system:user:list', '用户列表', 2, 3),
    ('system:user:add', '添加用户', 2, 3),
    ('system:user:edit', '编辑用户', 2, 3),
    ('system:user:delete', '删除用户', 2, 3),
    ('system:role', '角色管理', 1, 2),
    ('system:role:list', '角色列表', 6, 3),
    ('system:role:add', '添加角色', 6, 3),
    ('order', '订单管理', 0, 1),
    ('order:list', '订单列表', 9, 2),
    ('order:view', '查看订单', 9, 3),
    ('order:create', '创建订单', 9, 3),
    ('order:cancel', '取消订单', 9, 3);

-- 分配角色权限
-- admin 拥有所有权限
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission;

-- manager 拥有订单管理权限
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 2, id FROM sys_permission WHERE permission LIKE 'order:%';

-- user 只有查看权限
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 3, id FROM sys_permission 
WHERE permission IN ('order:list', 'order:view');

-- 分配用户角色
INSERT INTO sys_user_role (user_id, role_id) VALUES
    (1, 1),  -- admin 是超级管理员
    (2, 2),  -- zhangsan 是运营经理
    (3, 3);  -- lisi 是普通用户
```

## 树状结构设计

权限表支持树状结构：

```sql
-- 查看权限树
SELECT 
    p1.id AS lv1_id, p1.permission_name AS lv1_name,
    p2.id AS lv2_id, p2.permission_name AS lv2_name,
    p3.id AS lv3_id, p3.permission_name AS lv3_name
FROM sys_permission p1
LEFT JOIN sys_permission p2 ON p2.parent_id = p1.id
LEFT JOIN sys_permission p3 ON p3.parent_id = p2.id
WHERE p1.parent_id = 0
ORDER BY p1.sort_order, p2.sort_order, p3.sort_order;
```

### 权限树结构

```
system（系统管理）
├── system:user（用户管理）
│   ├── system:user:list（用户列表）
│   ├── system:user:add（添加用户）
│   ├── system:user:edit（编辑用户）
│   └── system:user:delete（删除用户）
└── system:role（角色管理）
    ├── system:role:list（角色列表）
    └── system:role:add（添加角色）

order（订单管理）
├── order:list（订单列表）
├── order:view（查看订单）
├── order:create（创建订单）
└── order:cancel（取消订单）
```

## Mapper 实现

### UserMapper

```java
@Mapper
public interface UserMapper {
    
    @Select("SELECT * FROM sys_user WHERE username = #{username}")
    User findByUsername(String username);
    
    @Select("SELECT r.* FROM sys_role r " +
            "INNER JOIN sys_user_role ur ON r.id = ur.role_id " +
            "WHERE ur.user_id = #{userId}")
    List<Role> findRolesByUserId(Long userId);
    
    @Select("SELECT p.* FROM sys_permission p " +
            "INNER JOIN sys_role_permission rp ON p.id = rp.permission_id " +
            "INNER JOIN sys_user_role ur ON rp.role_id = ur.role_id " +
            "WHERE ur.user_id = #{userId}")
    List<Permission> findPermissionsByUserId(Long userId);
    
    @Select("SELECT p.permission FROM sys_permission p " +
            "INNER JOIN sys_role_permission rp ON p.id = rp.permission_id " +
            "INNER JOIN sys_user_role ur ON rp.role_id = ur.role_id " +
            "WHERE ur.user_id = #{userId}")
    List<String> findPermissionStringsByUserId(Long userId);
}
```

### PermissionMapper

```java
@Mapper
public interface PermissionMapper {
    
    // 获取权限树
    @Select("SELECT * FROM sys_permission ORDER BY sort_order")
    List<Permission> findAll();
    
    // 获取角色拥有的权限ID列表
    @Select("SELECT permission_id FROM sys_role_permission WHERE role_id = #{roleId}")
    List<Long> findPermissionIdsByRoleId(Long roleId);
    
    // 获取角色拥有的权限树
    @Select("SELECT * FROM sys_permission " +
            "WHERE id IN (SELECT permission_id FROM sys_role_permission WHERE role_id = #{roleId})")
    List<Permission> findPermissionsByRoleId(Long roleId);
}
```

## Realm 实现

```java
@Component
public class CustomRealm extends AuthorizingRealm {
    
    @Autowired
    private UserMapper userMapper;
    
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) {
        
        String username = (String) principals.getPrimaryPrincipal();
        User user = userMapper.findByUsername(username);
        
        // 查询角色
        List<Role> roles = userMapper.findRolesByUserId(user.getId());
        
        // 查询权限
        List<Permission> permissions = 
            userMapper.findPermissionsByUserId(user.getId());
        
        SimpleAuthorizationInfo info = new SimpleAuthorizationInfo();
        
        // 设置角色
        info.setRoles(roles.stream()
            .map(Role::getRoleName)
            .collect(Collectors.toSet()));
        
        // 设置权限
        info.setStringPermissions(permissions.stream()
            .map(Permission::getPermission)
            .collect(Collectors.toSet()));
        
        return info;
    }
    
    // ... 认证方法省略
}
```

## 权限树 API

### 返回前端需要的树结构

```java
@Service
public class PermissionService {
    
    @Autowired
    private PermissionMapper permissionMapper;
    
    /**
     * 获取权限树（用于前端菜单渲染）
     */
    public List<PermissionTree> getPermissionTree() {
        List<Permission> all = permissionMapper.findAll();
        
        // 转换为树结构
        return buildTree(all, 0L);
    }
    
    private List<PermissionTree> buildTree(List<Permission> permissions, Long parentId) {
        return permissions.stream()
            .filter(p -> p.getParentId().equals(parentId))
            .map(p -> {
                PermissionTree node = new PermissionTree();
                node.setId(p.getId());
                node.setPermission(p.getPermission());
                node.setPermissionName(p.getPermissionName());
                node.setPermissionType(p.getPermissionType());
                node.setUrl(p.getUrl());
                node.setIcon(p.getIcon());
                node.setChildren(buildTree(permissions, p.getId()));
                return node;
            })
            .collect(Collectors.toList());
    }
}
```

### 角色权限分配

```java
@Service
public class RoleService {
    
    @Autowired
    private RolePermissionMapper rolePermissionMapper;
    
    /**
     * 给角色分配权限
     */
    public void assignPermissions(Long roleId, List<Long> permissionIds) {
        // 1. 删除原有权限
        rolePermissionMapper.deleteByRoleId(roleId);
        
        // 2. 添加新权限
        for (Long permissionId : permissionIds) {
            RolePermission rp = new RolePermission();
            rp.setRoleId(roleId);
            rp.setPermissionId(permissionId);
            rolePermissionMapper.insert(rp);
        }
        
        // 3. 清除该角色下所有用户的授权缓存
        clearAuthorizationCache(roleId);
    }
    
    private void clearAuthorizationCache(Long roleId) {
        List<Long> userIds = userRoleMapper.findUserIdsByRoleId(roleId);
        for (Long userId : userIds) {
            User user = userMapper.findById(userId);
            // 清除缓存
            authorizationCache.remove(user.getUsername());
        }
    }
}
```

## 实际应用场景

### 场景一：动态菜单

```java
@GetMapping("/api/menus")
@RequiresAuthentication
public Result<List<MenuVO>> getMenus() {
    Subject subject = SecurityUtils.getSubject();
    String username = (String) subject.getPrincipal();
    
    // 获取用户所有权限
    Set<String> permissions = subject.getPermissions();
    
    // 过滤出菜单类型的权限
    List<MenuVO> menus = permissionMapper.findMenus()
        .stream()
        .filter(m -> permissions.contains(m.getPermission()))
        .map(this::toMenuVO)
        .collect(Collectors.toList());
    
    // 构建菜单树
    return Result.success(buildMenuTree(menus));
}
```

### 场景二：数据权限

```java
@Service
public class OrderService {
    
    @Autowired
    private OrderMapper orderMapper;
    
    /**
     * 获取订单列表（带数据权限过滤）
     */
    public List<Order> listOrders(OrderQuery query) {
        Subject subject = SecurityUtils.getSubject();
        
        // 管理员可以看所有
        if (subject.hasRole("admin")) {
            return orderMapper.selectList(query);
        }
        
        // 普通用户只能看自己的
        String username = (String) subject.getPrincipal();
        query.setUsername(username);
        return orderMapper.selectList(query);
    }
}
```

## 常见问题

### 问题一：权限层级太深

**建议**：最多三层（目录 → 菜单 → 按钮）。

### 问题二：权限膨胀

**问题**：一个用户有 10 个角色，每个角色有 50 个权限，查询性能差。

**方案**：
1. 使用缓存
2. 权限按模块分组
3. 定期清理无用角色和权限

### 问题三：跨租户权限

**问题**：多租户场景下，权限如何隔离？

**方案**：
1. 权限表中增加租户 ID
2. 查询时加上租户过滤
3. 租户隔离由 Realm 统一处理

## 面试追问方向

**面试官可能会问**：

1. **RBAC 模型的五个表分别是什么？**
   - 用户表、角色表、权限表
   - 用户-角色关系表、角色-权限关系表

2. **为什么需要中间表？**
   - 用户和角色是多对多关系
   - 角色和权限是多对多关系
   - 中间表实现多对多映射

3. **权限表为什么要有 parent_id？**
   - 支持树状结构
   - 方便构建菜单
   - 支持批量授权

4. **如何实现数据级别的权限？**
   - 在 SQL 层面加过滤条件
   - 在 Realm 层面注入额外权限
   - 使用自定义过滤器

---

## 留给你的问题

RBAC 解决了「能做什么」的问题，但还有「数据能否访问」的问题。

这就是数据权限。下一节，我们来学习 Shiro CSRF 防护与 URL 过滤策略。
