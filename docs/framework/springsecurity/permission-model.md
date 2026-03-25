# 接口权限数据模型：用户-角色-权限树状结构

你有没有遇到过这种情况：系统上线后发现权限控制太粗粒度了，想给每个接口单独配置权限，却发现原来的数据模型根本不支持？

或者权限配置页面需要展示一棵权限树，但数据库设计却是一张扁平的表，查询和展示都很麻烦？

今天，我们就来深入了解如何设计一个支持树状结构的接口权限数据模型。

---

## 为什么需要树状权限结构？

### 扁平权限的问题

```
扁平权限（有问题）：
┌─────────────────────────────────────────────────────────────────────┐
│  sys_permission 表                                                   │
│  ─────────────────────────────────────────────────────────────────│
│  id | permission_code      | permission_name                        │
│  1  | system:user:list     | 查看用户列表                            │
│  2  | system:user:add      | 添加用户                                │
│  3  | system:user:edit     | 编辑用户                                │
│  4  | system:user:delete   | 删除用户                                │
│  5  | system:role:list     | 查看角色列表                            │
│  6  | system:role:add      | 添加角色                                │
│  ...                                                                    │
└─────────────────────────────────────────────────────────────────────┘

问题：
1. 权限展示是扁平的，无法直观看到层级关系
2. 批量分配权限时，只能一个个勾选
3. 父子权限的关联关系不明确
4. 新增一个功能模块，需要手动关联所有相关权限
```

### 树状权限的优势

```
树状权限（推荐）：
┌─────────────────────────────────────────────────────────────────────┐
│  系统管理                                                            │
│  ├── 用户管理                                                        │
│  │   ├── 查看用户列表 (system:user:list)                           │
│  │   ├── 添加用户 (system:user:add)                                │
│  │   ├── 编辑用户 (system:user:edit)                              │
│  │   └── 删除用户 (system:user:delete)                             │
│  ├── 角色管理                                                        │
│  │   ├── 查看角色列表 (system:role:list)                           │
│  │   ├── 添加角色 (system:role:add)                                │
│  │   └── ...                                                        │
│  └── 菜单管理                                                        │
│      └── ...                                                        │
└─────────────────────────────────────────────────────────────────────┘

优势：
1. 权限展示清晰直观
2. 可以批量选择整棵子树
3. 父子权限关联自动维护
4. 新增功能模块，只需添加一个父节点
```

---

## 数据模型设计

### 权限表（支持树状结构）

```sql
-- 权限表（核心表）
CREATE TABLE sys_permission (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    
    -- 基础信息
    permission_name VARCHAR(100) NOT NULL COMMENT '权限名称',
    permission_code VARCHAR(100) NOT NULL UNIQUE COMMENT '权限标识',
    permission_type VARCHAR(20) NOT NULL COMMENT 'PERMISSION/MENU/BUTTON',
    
    -- 树状结构
    parent_id BIGINT DEFAULT 0 COMMENT '父权限ID，0表示根节点',
    tree_path VARCHAR(500) DEFAULT '' COMMENT '树路径，如 "/1/3/5/"',
    level INT DEFAULT 1 COMMENT '层级深度',
    sort_order INT DEFAULT 0 COMMENT '同级排序',
    
    -- 资源信息（用于接口权限）
    resource_type VARCHAR(20) COMMENT 'URL/METHOD/DATA',
    resource_value VARCHAR(500) COMMENT '资源值，如 /api/users',
    http_method VARCHAR(10) COMMENT 'HTTP方法：GET/POST/PUT/DELETE',
    
    -- 菜单信息（用于左侧菜单树）
    path VARCHAR(200) COMMENT '路由路径',
    component VARCHAR(200) COMMENT '组件路径',
    icon VARCHAR(100) COMMENT '菜单图标',
    external_link TINYINT DEFAULT 0 COMMENT '是否外链',
    visible TINYINT DEFAULT 1 COMMENT '是否显示',
    keep_alive TINYINT DEFAULT 1 COMMENT '是否缓存',
    
    -- 状态
    status TINYINT DEFAULT 1 COMMENT '1:启用, 0:禁用',
    
    -- 审计字段
    create_time DATETIME,
    update_time DATETIME,
    create_by VARCHAR(64),
    update_by VARCHAR(64),
    
    -- 索引
    INDEX idx_parent_id (parent_id),
    INDEX idx_permission_code (permission_code),
    INDEX idx_tree_path (tree_path)
);

-- 角色权限关联表
CREATE TABLE sys_role_permission (
    role_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    create_time DATETIME,
    PRIMARY KEY (role_id, permission_id)
);
```

### 权限类型说明

| 类型 | 说明 | 示例 |
|-----|------|-----|
| MENU | 菜单权限 | 一级菜单、二级菜单 |
| BUTTON | 按钮权限 | 新增、编辑、删除 |
| PERMISSION | 接口权限 | /api/users GET |

---

## 树形结构查询

### 查询权限树（递归）

```sql
-- 递归查询所有权限（MySQL 8.0+）
WITH RECURSIVE permission_tree AS (
    -- 起始：查询根节点
    SELECT id, permission_name, permission_code, permission_type,
           parent_id, tree_path, level, sort_order, path, icon,
           0 as is_leaf
    FROM sys_permission
    WHERE parent_id = 0 AND status = 1
    
    UNION ALL
    
    -- 递归：查询子节点
    SELECT p.id, p.permission_name, p.permission_code, p.permission_type,
           p.parent_id, p.tree_path, p.level, p.sort_order, p.path, p.icon,
           CASE WHEN (SELECT COUNT(*) FROM sys_permission WHERE parent_id = p.id) = 0 
                THEN 1 ELSE 0 END as is_leaf
    FROM sys_permission p
    INNER JOIN permission_tree pt ON p.parent_id = pt.id
    WHERE p.status = 1
)
SELECT * FROM permission_tree ORDER BY level, sort_order;
```

### 查询用户的权限树

```sql
-- 查询某个角色拥有的权限树
WITH RECURSIVE permission_tree AS (
    SELECT p.id, p.permission_name, p.permission_code, p.permission_type,
           p.parent_id, p.tree_path, p.level, p.sort_order, p.path, p.icon,
           CASE WHEN (SELECT COUNT(*) FROM sys_permission WHERE parent_id = p.id) = 0 
                THEN 1 ELSE 0 END as is_leaf,
           CASE WHEN rp.permission_id IS NOT NULL THEN 1 ELSE 0 END as checked
    FROM sys_permission p
    LEFT JOIN sys_role_permission rp ON p.id = rp.permission_id AND rp.role_id = ?
    WHERE p.parent_id = 0 AND p.status = 1
    
    UNION ALL
    
    SELECT p.id, p.permission_name, p.permission_code, p.permission_type,
           p.parent_id, p.tree_path, p.level, p.sort_order, p.path, p.icon,
           CASE WHEN (SELECT COUNT(*) FROM sys_permission WHERE parent_id = p.id) = 0 
                THEN 1 ELSE 0 END as is_leaf,
           CASE WHEN rp.permission_id IS NOT NULL THEN 1 ELSE 0 END as checked
    FROM sys_permission p
    LEFT JOIN sys_role_permission rp ON p.id = rp.permission_id AND rp.role_id = ?
    INNER JOIN permission_tree pt ON p.parent_id = pt.id
    WHERE p.status = 1
)
SELECT * FROM permission_tree ORDER BY level, sort_order;
```

### 查询子权限

```sql
-- 查询某个权限的所有子权限
SELECT * FROM sys_permission 
WHERE tree_path LIKE CONCAT((SELECT tree_path FROM sys_permission WHERE id = ?), '%');
```

---

## Java 实现

### 权限实体类

```java
@Entity
@Table(name = "sys_permission")
public class Permission {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(nullable = false)
    private String permissionName;
    
    @Column(unique = true, nullable = false)
    private String permissionCode;
    
    // 权限类型：MENU, BUTTON, PERMISSION
    private String permissionType;
    
    // 树状结构
    private Long parentId;
    private String treePath;  // 如 "/1/3/5/"
    private Integer level;
    private Integer sortOrder;
    
    // 资源信息
    private String resourceType;  // URL, METHOD, DATA
    private String resourceValue;
    private String httpMethod;
    
    // 菜单信息
    private String path;
    private String component;
    private String icon;
    private Boolean externalLink;
    private Boolean visible;
    private Boolean keepAlive;
    
    private Integer status;
    
    // 非数据库字段
    @Transient
    private List&lt;Permission&gt; children = new ArrayList&lt;&gt;();
    
    @Transient
    private Boolean hasPermission;  // 用户是否拥有该权限
}
```

### 权限树服务

```java
@Service
public class PermissionTreeService {
    
    @Autowired
    private PermissionRepository permissionRepository;
    
    /**
     * 获取完整权限树
     */
    public List&lt;Permission&gt; getPermissionTree() {
        List&lt;Permission&gt; all = permissionRepository.findByStatusOrderBySortOrder(1);
        return buildTree(all, 0L);
    }
    
    /**
     * 获取用户的权限树（带选中状态）
     */
    public List&lt;Permission&gt; getUserPermissionTree(Long roleId) {
        List&lt;Permission&gt; all = permissionRepository.findByStatusOrderBySortOrder(1);
        Set&lt;Long&gt; ownedIds = permissionRepository.findPermissionIdsByRoleId(roleId);
        
        List&lt;Permission&gt; tree = buildTree(all, 0L);
        markChecked(tree, ownedIds);
        
        return tree;
    }
    
    /**
     * 构建树
     */
    private List&lt;Permission&gt; buildTree(List&lt;Permission&gt; all, Long parentId) {
        return all.stream()
            .filter(p -> parentId.equals(p.getParentId()))
            .peek(p -> {
                List&lt;Permission&gt; children = buildTree(all, p.getId());
                p.setChildren(children);
            })
            .collect(Collectors.toList());
    }
    
    /**
     * 标记选中状态
     */
    private void markChecked(List&lt;Permission&gt; permissions, Set&lt;Long&gt; ownedIds) {
        permissions.forEach(p -> {
            p.setHasPermission(ownedIds.contains(p.getId()));
            if (p.getChildren() != null && !p.getChildren().isEmpty()) {
                markChecked(p.getChildren(), ownedIds);
            }
        });
    }
    
    /**
     * 获取权限的完整路径
     */
    public String getPermissionPath(Long permissionId) {
        Permission permission = permissionRepository.findById(permissionId)
            .orElseThrow(() -> new RuntimeException("权限不存在"));
        return permission.getTreePath() + permission.getId() + "/";
    }
}
```

### 权限树 DTO

```java
public class PermissionTreeDTO {
    
    private Long id;
    private String label;           // 树节点显示的名称
    private String permissionName;
    private String permissionCode;
    private String permissionType;
    private Long parentId;
    private Integer level;
    private String icon;
    private String path;
    private List&lt;PermissionTreeDTO&gt; children;
    private Boolean checked;
    private Boolean disabled;
    private Boolean isLeaf;
    
    // 从 Permission 转换
    public static PermissionTreeDTO from(Permission p) {
        PermissionTreeDTO dto = new PermissionTreeDTO();
        dto.setId(p.getId());
        dto.setLabel(p.getPermissionName());
        dto.setPermissionName(p.getPermissionName());
        dto.setPermissionCode(p.getPermissionCode());
        dto.setPermissionType(p.getPermissionType());
        dto.setParentId(p.getParentId());
        dto.setLevel(p.getLevel());
        dto.setIcon(p.getIcon());
        dto.setPath(p.getPath());
        dto.setChildren(new ArrayList&lt;&gt;());
        return dto;
    }
}
```

---

## 前端权限树组件

### Vue 组件示例

```vue
&lt;template&gt;
  &lt;el-tree
    ref="permissionTree"
    :data="treeData"
    :props="treeProps"
    show-checkbox
    node-key="id"
    :default-expand-all="true"
    :check-strictly="false"
    @check-change="handleCheckChange"&gt;
    
    &lt;template #default="{ node, data }"&gt;
      &lt;span class="permission-node"&gt;
        &lt;i :class="data.icon || 'el-icon-document'"&gt;&lt;/i&gt;
        &lt;span&gt;{{ node.label }}&lt;/span&gt;
        &lt;span class="permission-code"&gt;{{ data.permissionCode }}&lt;/span&gt;
      &lt;/span&gt;
    &lt;/template&gt;
  &lt;/el-tree&gt;
&lt;/template&gt;

&lt;script&gt;
export default {
  data() {
    return {
      treeData: [],
      treeProps: {
        children: 'children',
        label: 'label'
      }
    };
  },
  methods: {
    // 加载权限树
    async loadPermissionTree(roleId) {
      const res = await this.$api.getUserPermissionTree(roleId);
      this.treeData = res.data;
    },
    
    // 获取选中的权限
    getCheckedPermissions() {
      const checkedNodes = this.$refs.permissionTree.getCheckedNodes();
      return checkedNodes.map(node => node.id);
    },
    
    // 设置选中的权限
    setCheckedPermissions(permissionIds) {
      this.$refs.permissionTree.setCheckedKeys(permissionIds);
    },
    
    // 级联选中处理
    handleCheckChange(data, checked) {
      if (checked) {
        // 选中时，自动选中所有父节点
        this.$refs.permissionTree.expandNode(data);
      } else {
        // 取消选中时，可选是否同时取消子节点
        // this.$refs.permissionTree.setChecked(data.id, false, true);
      }
    }
  }
};
&lt;/script&gt;
```

---

## 接口权限自动注册

### 扫描接口自动生成权限

```java
@Component
public class PermissionScanner {
    
    @Autowired
    private PermissionRepository permissionRepository;
    
    /**
     * 扫描所有 Controller，生成权限数据
     */
    public void scanAndGeneratePermissions() {
        RequestMappingHandlerMapping mapping = 
            applicationContext.getBean(RequestMappingHandlerMapping.class);
        
        Map&lt;RequestMappingInfo, HandlerMethod&gt; handlerMethods = mapping.getHandlerMethods();
        
        for (Map.Entry&lt;RequestMappingInfo, HandlerMethod&gt; entry : handlerMethods.entrySet()) {
            RequestMappingInfo mappingInfo = entry.getKey();
            HandlerMethod handlerMethod = entry.getValue();
            
            // 获取接口路径
            Set&lt;String&gt; patterns = mappingInfo.getPatternsCondition()
                .getPatterns();
            
            // 获取 HTTP 方法
            Set&lt;RequestMethod&gt; methods = mappingInfo.getMethodsCondition()
                .getMethods();
            
            // 获取权限注解
            RequirePermission permission = handlerMethod.getMethod()
                .getAnnotation(RequirePermission.class);
            
            if (permission != null) {
                // 自动生成权限记录
                savePermission(patterns, methods, permission);
            }
        }
    }
    
    private void savePermission(Set&lt;String&gt; patterns, 
                                Set&lt;RequestMethod&gt; methods,
                                RequirePermission requirePermission) {
        // 根据实际情况生成权限记录
        // ...
    }
}

// 自定义权限注解
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequirePermission {
    String name();
    String code();
    String type() default "BUTTON";
}
```

---

## 权限校验

### 方法级权限校验

```java
@Service
public class PermissionCheckService {
    
    @Autowired
    private PermissionRepository permissionRepository;
    
    /**
     * 检查用户是否有权限
     */
    public boolean hasPermission(Long userId, String permissionCode) {
        return permissionRepository.existsByUserIdAndPermissionCode(userId, permissionCode);
    }
    
    /**
     * 批量检查权限
     */
    public Map&lt;String, Boolean&gt; checkPermissions(Long userId, 
                                                   List&lt;String&gt; permissionCodes) {
        Map&lt;String, Boolean&gt; result = new HashMap&lt;&gt;();
        
        for (String code : permissionCodes) {
            result.put(code, hasPermission(userId, code));
        }
        
        return result;
    }
}
```

---

## 常见问题

### 问题一：如何处理权限树的选择？

```java
// 选中一个节点时，需要同时选中/取消所有子节点
// 取消选中一个节点时，需要同时取消所有子节点
// 取消选中一个节点时，可选是否同时取消父节点

public void handleTreeCheck(PermissionTreeNode node, boolean checked) {
    if (checked) {
        // 级联选中所有子节点
        selectChildren(node);
    } else {
        // 级联取消所有子节点
        deselectChildren(node);
        // 可选：同时取消父节点
        deselectParent(node);
    }
}
```

### 问题二：如何处理接口路径通配？

```java
// 接口路径支持通配符
// /api/users/* 匹配 /api/users/1, /api/users/2
// /api/users/** 匹配 /api/users/1/orders, /api/users/1/orders/2

public boolean matchPath(String pattern, String path) {
    AntPathMatcher matcher = new AntPathMatcher();
    return matcher.match(pattern, path);
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| 如何设计一个权限树的数据结构？ | 设计能力 | 本篇 |
| 权限树如何高效查询？ | SQL 能力 | 本篇 |
| 父子权限如何级联处理？ | 业务能力 | 本篇 |
| 如何自动生成接口权限？ | 自动化能力 | 本篇 |
| 权限变更后如何通知？ | 架构设计 | 本篇 |

---

## 总结

树状权限数据模型的核心要点：

1. **树路径字段**：使用 `tree_path` 存储完整路径，方便查询子树
2. **层级字段**：使用 `level` 存储深度，避免递归查询
3. **父子关联**：使用 `parent_id` 维护树状关系
4. **批量操作**：树选择时需要级联处理子节点
5. **自动注册**：可以扫描接口自动生成权限数据

好的数据模型设计，可以让权限管理变得简单直观。

---

## 下一步

- 想了解更多权限模型？→ [RBAC 权限模型](/framework/springsecurity/rbac)
- 想实现动态权限决策？→ [动态权限决策](/framework/springsecurity/access-decision)
- 想学习 Spring Security 认证？→ [认证与授权核心流程](/framework/springsecurity/core-flow)
