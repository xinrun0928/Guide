# MongoDB 用户角色与权限管理

MongoDB 的权限管理基于 **RBAC（基于角色的访问控制）** 模型。

这一篇，我们来全面了解如何管理用户和权限。

## 角色分类

### 数据库角色

| 角色 | 说明 |
|-----|------|
| `read` | 读取当前数据库的所有非系统集合 |
| `readWrite` | 读写当前数据库 |
| `dbAdmin` | 管理索引、集合（不含用户管理） |
| `dbOwner` | readWrite + dbAdmin + userAdmin |
| `userAdmin` | 管理当前数据库的用户 |

### 集群角色

| 角色 | 说明 |
|-----|------|
| `clusterAdmin` | 最高集群权限 |
| `clusterManager` | 集群管理（分片、副本集） |
| `clusterMonitor` | 只读集群监控 |
| `hostManager` | 管理服务器 |

### 备份角色

| 角色 | 说明 |
|-----|------|
| `backup` | 备份权限 |
| `restore` | 恢复权限 |

### 特殊角色

| 角色 | 说明 |
|-----|------|
| `root` | 超级管理员，所有权限 |
| `__system` | MongoDB 内部使用 |

## 用户管理

### 创建用户

```javascript
// 基本用户创建
use myapp

db.createUser({
  user: "app_user",
  pwd: "securePassword123",
  roles: [
    {role: "readWrite", db: "myapp"}
  ]
})
```

### 创建多角色用户

```javascript
// 用户拥有多个角色
db.createUser({
  user: "admin_user",
  pwd: "adminPassword",
  roles: [
    {role: "readWrite", db: "myapp"},
    {role: "read", db: "logs"},
    {role: "backup"}
  ]
})
```

### 查看用户

```javascript
// 查看当前数据库用户
use myapp
db.getUsers()

// 查看所有用户（admin 数据库）
use admin
db.system.users.find().pretty()

// 查看特定用户
db.getUser("app_user")

// 查看用户详细信息（含密码历史）
db.getUser("app_user", {showCredentials: true})
```

### 更新用户

```javascript
// 更新用户密码
db.changeUserPassword("app_user", "newSecurePassword")

// 为用户添加角色
db.grantRolesToUser("app_user", [
  {role: "read", db: "logs"}
])

// 移除用户角色
db.revokeRolesFromUser("app_user", [
  {role: "read", db: "logs"}
])

// 更新用户信息（MongoDB 4.0+）
db.updateUser("app_user", {
  roles: [
    {role: "readWrite", db: "myapp"},
    {role: "read", db: "analytics"}
  ]
})
```

### 删除用户

```javascript
// 删除用户
use myapp
db.dropUser("app_user")

// 删除所有用户
db.dropAllUsers()
```

## 角色管理

### 创建自定义角色

```javascript
use admin

// 创建角色
db.createRole({
  role: "orderManager",
  privileges: [
    // 允许对 orders 集合的 CRUD 操作
    {
      resource: {db: "myapp", collection: "orders"},
      actions: ["find", "insert", "update", "remove"]
    },
    // 允许对 products 集合只读
    {
      resource: {db: "myapp", collection: "products"},
      actions: ["find"]
    },
    // 允许执行 collStats
    {
      resource: {db: "myapp", collection: "orders"},
      actions: ["collStats"]
    }
  ],
  roles: []  // 不继承其他角色
})

// 创建继承其他角色的角色
db.createRole({
  role: "seniorDeveloper",
  privileges: [],
  roles: [
    {role: "orderManager", db: "myapp"},
    {role: "read", db: "logs"}
  ]
})
```

### 查看角色信息

```javascript
use admin

// 查看角色权限
db.getRole("orderManager")

// 查看角色（包含继承的角色）
db.getRole("seniorDeveloper", {showPrivileges: true})

// 查看所有自定义角色
db.system.roles.find().pretty()
```

### 删除角色

```javascript
use admin

db.dropRole("orderManager")
```

## 权限（Privilege）

### 资源（Resource）

```javascript
// 单个集合
{db: "myapp", collection: "orders"}

// 数据库所有集合
{db: "myapp", collection: ""}

// 所有数据库的特定集合
{db: "", collection: "orders"}

// 所有资源
{db: "", collection: ""}
```

### 操作（Action）

| 分类 | 操作 | 说明 |
|-----|------|------|
| **查询** | `find` | 查询文档 |
| **插入** | `insert` | 插入文档 |
| **更新** | `update` | 更新文档 |
| **删除** | `remove` | 删除文档 |
| **索引** | `createIndex`, `dropIndex` | 管理索引 |
| **集合** | `collStats`, `compact` | 集合操作 |
| **数据库** | `dbStats` | 数据库统计 |
| **用户** | `createUser`, `dropUser` | 用户管理 |

### 常用权限组合

```javascript
// 只读权限
privileges: [
  {
    resource: {db: "myapp", collection: ""},
    actions: ["find"]
  }
]

// 读写权限
privileges: [
  {
    resource: {db: "myapp", collection: ""},
    actions: ["find", "insert", "update", "remove"]
  }
]

// 管理员权限
privileges: [
  {
    resource: {db: "myapp", collection: ""},
    actions: ["find", "insert", "update", "remove", "createIndex",
              "dropIndex", "collStats", "dbStats"]
  },
  {
    resource: {db: "myapp", collection: "system.indexes"},
    actions: [" CollateralAction "]
  },
  {
    resource: {db: "myapp", collection: "system.js"},
    actions: [" CollateralAction "]
  }
]
```

## 最佳实践

### 用户分类

| 用途 | 角色 | 说明 |
|-----|------|------|
| 应用读写 | readWrite | 普通应用使用 |
| 应用只读 | read | 报表系统 |
| 管理员 | userAdmin | 管理用户 |
| 备份 | backup | 备份工具 |
| 监控 | clusterMonitor | 监控工具 |

### 最小权限原则

```javascript
// 差：一个用户拥有太多权限
db.createUser({
  user: "app_user",
  pwd: "password",
  roles: ["root"]  // 太危险！
})

// 好：按需分配权限
db.createUser({
  user: "app_user",
  pwd: "password",
  roles: [
    {role: "readWrite", db: "myapp"},
    {role: "read", db: "logs"}
  ]
})
```

### 多租户隔离

```javascript
// 每个租户一个数据库，一个用户
// 租户 A
use tenant_a_db
db.createUser({
  user: "tenant_a_app",
  pwd: "password",
  roles: [{role: "readWrite", db: "tenant_a_db"}]
})

// 租户 B
use tenant_b_db
db.createUser({
  user: "tenant_b_app",
  pwd: "password",
  roles: [{role: "readWrite", db: "tenant_b_db"}]
})
```

### 开发/生产环境隔离

```javascript
// 开发环境用户
use dev_db
db.createUser({
  user: "dev_user",
  pwd: "dev_password",
  roles: [
    {role: "readWrite", db: "dev_db"},
    {role: "dbAdmin", db: "dev_db"}
  ]
})

// 生产环境用户（更严格的权限）
use prod_db
db.createUser({
  user: "prod_app",
  pwd: "prod_password",
  roles: [
    {role: "readWrite", db: "prod_db"}
  ]
  // 不给 dbAdmin，避免删除集合
})
```

## 权限验证

### 验证用户权限

```javascript
// 查看用户有效权限
use admin
db.runCommand({
  rolesInfo: "app_user",
  showPrivileges: true
})

// 验证用户能否执行特定操作
db.runCommand({
  rolesInfo: 1,
  showPrivileges: true,
  filter: {
    "privileges.resource": {db: "myapp", collection: "orders"}
  }
})
```

### 审计

```javascript
// 开启审计（企业版）
// mongod.conf
auditLog:
  destination: file
  path: /var/log/mongodb/audit.log
  format: JSON

// 审计用户操作
// 查看审计日志中的用户管理操作
```

## Java 权限管理

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.model.CreateRoleOptions;
import com.mongodb.client.model.Privilege;
import com.mongodb.client.model.ResourcePrivilege;
import org.bson.Document;
import java.util.Arrays;

public class RoleManagement {
    public static void main(String[] args) {
        try (MongoClient client = MongoClients.create()) {
            MongoDatabase admin = client.getDatabase("admin");

            // 创建自定义角色
            admin.runCommand(new Document("createRole", "dataAnalyst")
                .append("privileges", Arrays.asList(
                    new Document("resource",
                        new Document("db", "myapp").append("collection", "orders"))
                        .append("actions", Arrays.asList("find")),
                    new Document("resource",
                        new Document("db", "myapp").append("collection", "products"))
                        .append("actions", Arrays.asList("find"))
                ))
                .append("roles", Arrays.asList())
            );

            // 创建用户并分配角色
            admin.runCommand(new Document("createUser", "analyst_user")
                .append("pwd", "password")
                .append("roles", Arrays.asList(
                    new Document("role", "dataAnalyst").append("db", "admin")
                ))
            );

            // 查看用户信息
            Document userInfo = admin.runCommand(
                new Document("usersInfo", "analyst_user")
                    .append("showPrivileges", true)
            ).getDocument("users").get(0);

            System.out.println("用户信息: " + userInfo.toJson());
        }
    }
}
```

## 总结

权限管理核心要点：

| 概念 | 说明 |
|-----|------|
| 用户 | 认证主体，绑定到数据库 |
| 角色 | 权限的集合 |
| 权限 | 对资源的操作许可 |
| 资源 | 数据库或集合 |

**最佳实践**：
1. 遵循最小权限原则
2. 按用途分类创建用户
3. 生产环境禁用高权限用户
4. 定期审查用户和权限
5. 使用自定义角色精确控制权限

---

**下一步，你可以：**

- 学习 [MongoDB 数据备份与恢复](/database/mongodb/backup)
- 了解 [MongoDB vs MySQL vs Redis 选型](/database/mongodb/compare)
- 掌握 [MongoDB 面试高频问题汇总](/database/mongodb/interview-summary)
