# MongoDB 认证与授权：SCRAM、x.509 证书、LDAP

生产环境的 MongoDB 必须开启认证，否则数据完全暴露。

这一篇，我们来全面了解 MongoDB 的认证机制。

## 认证方式概览

| 认证方式 | 说明 | 适用场景 |
|---------|------|---------|
| **SCRAM** | 用户名密码认证，默认推荐 | 大多数场景 |
| **x.509 证书** | 证书认证 | 高安全环境 |
| **LDAP** | 企业统一认证 | 企业内网 |
| **Kerberos** | GSSAPI 认证 | 大型企业的 AD 集成 |

## SCRAM 认证

### SCRAM 是什么？

SCRAM（Salted Challenge Response Authentication Mechanism）是 MongoDB 默认的认证方式，类似于 HTTP Digest 认证。

### 启用 SCRAM 认证

#### 1. 创建管理员用户

```javascript
// 连接到 MongoDB（未开启认证前）
use admin

// 创建管理员用户
db.createUser({
  user: "admin",
  pwd: "yourSecurePassword",
  roles: [
    {role: "root", db: "admin"}
  ]
})
```

#### 2. 修改配置文件

```yaml
# mongod.conf
security:
  authorization: enabled

net:
  port: 27017
  bindIp: 127.0.0.1
```

#### 3. 重启 MongoDB

```bash
# 重启服务
systemctl restart mongod

# 或命令行启动
mongod --auth --config /etc/mongod.conf
```

#### 4. 连接认证

```javascript
// MongoDB Shell 认证连接
mongosh --host localhost:27017 -u admin -p --authenticationDatabase admin

// 进入后切换数据库
use myapp

// 查看当前用户
db.runCommand({connectionStatus: 1})
```

### SCRAM 机制详解

```
┌─────────┐                      ┌──────────────┐
│ Client  │                      │   MongoDB    │
└────┬────┘                      └──────┬───────┘
     │                                 │
     │  1. 发送用户名                    │
     │ ──────────────────────────────▶ │
     │                                 │
     │  2. 服务器返回 salt + 迭代次数     │
     │ ◀────────────────────────────── │
     │                                 │
     │  3. 客户端计算认证响应             │
     │ ──────────────────────────────▶ │
     │                                 │
     │  4. 服务器验证响应               │
     │ ◀────────────────────────────── │
     │                                 │
     │  5. 认证成功                    │
     │ ◀────────────────────────────── │
```

## 创建应用用户

### 为应用创建用户

```javascript
// 创建应用数据库用户
use myapp

db.createUser({
  user: "app_user",
  pwd: "appSecurePassword",
  roles: [
    {role: "readWrite", db: "myapp"},
    {role: "dbAdmin", db: "myapp"}
  ]
})
```

### 预定义角色

| 角色 | 说明 |
|-----|------|
| `read` | 读取当前数据库 |
| `readWrite` | 读写当前数据库 |
| `dbAdmin` | 数据库管理（索引、集合） |
| `userAdmin` | 用户管理 |
| `clusterAdmin` | 集群管理 |
| `root` | 超级管理员 |

### 自定义角色

```javascript
// 创建自定义角色
use admin

db.createRole({
  role: "appReader",
  privileges: [
    {
      resource: {db: "myapp", collection: "orders"},
      actions: ["find"]
    },
    {
      resource: {db: "myapp", collection: "products"},
      actions: ["find"]
    }
  ],
  roles: []
})

// 为用户分配自定义角色
use myapp
db.grantRolesToUser("app_user", ["appReader"])
```

## x.509 证书认证

### 适用场景

- 双向 SSL 认证
- 高安全要求环境
- 替代 SCRAM 密码认证

### 生成证书

```bash
# 1. 创建 CA 私钥
openssl genrsa -out ca.key 4096

# 2. 创建 CA 自签名证书
openssl req -x509 -new -nodes -key ca.key -days 3650 -out ca.crt

# 3. 为 MongoDB 生成私钥
openssl genrsa -out server.key 4096

# 4. 创建证书签名请求
openssl req -new -key server.key -out server.csr

# 5. 使用 CA 签发证书
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

# 6. 合并证书和私钥
cat server.crt server.key > server.pem
```

### 配置 x.509 认证

```yaml
# mongod.conf
net:
  port: 27017
  bindIp: 0.0.0.0
  tls:
    mode: requireTLS
    certificateKeyFile: /path/to/server.pem
    CAFile: /path/to/ca.crt

security:
  authorization: enabled
  clusterAuthMode: x509
```

### 创建 x.509 用户

```javascript
// 从证书获取用户信息
// 证书的 CN (Common Name) 字段作为用户名
use admin

db.createUser({
  user: "CN=myapp,O=myorg",
  roles: [
    {role: "readWrite", db: "myapp"}
  ]
})
```

### 客户端连接

```bash
# 使用证书连接
mongosh --tls --tlsCertificateKeyFile /path/to/client.pem \
        --tlsCAFile /path/to/ca.crt \
        --host hostname:27017 \
        -u "CN=myapp,O=myorg" \
        --authenticationDatabase '$external' \
        --authenticationMechanism MONGODB-X509
```

## LDAP 认证

### 适用场景

- 企业统一身份认证
- 多系统单点登录
- LDAP/Active Directory 集成

### 配置 LDAP

```yaml
# mongod.conf
security:
  authorization: "enabled"
  authenticationMechanisms: ["PLAIN"]

setParameter:
  authenticationAuthorizationEnabled: true

ldap:
  servers: "ldap.example.com:389"
  bind:
    method: "simple"
    queryUser: "cn=admin,dc=example,dc=com"
    queryPassword: "ldapPassword"
  userToDNMapping:
    - match: "(.+)"
      ldapQuery: "dc=example,dc=com??one?(userPrincipalName={0})"
```

### 授权 LDAP 用户

```javascript
use admin

// 为 LDAP 用户/组授予角色
db.grantRolesToUser("user@example.com", [
  {role: "readWrite", db: "myapp"}
])

// 为 LDAP 组授权
db.grantRolesToRole("cn=developers,ou=groups,dc=example,dc=com", [
  {role: "readWrite", db: "myapp"}
])
```

## Java 认证连接

### SCRAM 认证

```java
import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;

// 方式 1：连接字符串
String connectionString = "mongodb://app_user:appSecurePassword@localhost:27017/myapp";
MongoClient client = MongoClients.create(connectionString);

// 方式 2：MongoClientSettings
MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(new ConnectionString(
        "mongodb://localhost:27017/myapp"))
    .credential(MongoCredential.createScramSha256Credential(
        "app_user",
        "myapp",
        "appSecurePassword".toCharArray()
    ))
    .applyToSslSettings(builder ->
        builder.applyToEnabledSettings(s -> s.enable(true))
    )
    .build();

MongoClient client = MongoClients.create(settings);
```

### x.509 认证

```java
import com.mongodb.MongoCredential;
import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;

MongoCredential credential = MongoCredential.createMongoX509Credential(
    "CN=myapp,O=myorg"
);

MongoClientSettings settings = MongoClientSettings.builder()
    .credential(credential)
    .applyConnectionString(new ConnectionString("mongodb://localhost:27017"))
    .applyToSslSettings(builder -> {
        builder.applyToEnabledSettings(s -> s.enable(true));
        builder.applyToTrustStoreSettings(s -> s.setPath("/path/to/truststore.jks"));
        builder.applyToKeyStoreSettings(s -> s.setPath("/path/to/keystore.jks"));
    })
    .build();

MongoClient client = MongoClients.create(settings);
```

## 密码安全

### 密码强度要求

```javascript
// MongoDB 4.2+ 默认密码复杂度要求
// 可以配置密码复杂度验证
db.adminCommand({
  setParameter: 1,
  passwordHistory: 5  // 记录最近 5 个密码
})
```

### 密码验证

```javascript
// 更新密码
db.changeUserPassword("app_user", "newSecurePassword")

// 验证用户密码
db.adminCommand({
  usersInfo: "app_user",
  showCredentials: true
})
```

## 常见问题

### 问题 1：认证失败

```javascript
// 检查用户是否存在
use admin
db.getUser("app_user")

// 检查认证信息
db.runCommand({connectionStatus: 1})
// 查看 authInfo 了解认证失败原因
```

### 问题 2：连接字符串特殊字符

```java
// 密码中的特殊字符需要 URL 编码
// 例如：密码为 p@ssword#123
// 需要编码为 p%40ssword%23123
String password = "p@ssword#123";
String encodedPassword = URLEncoder.encode(password, StandardCharsets.UTF_8);
String connectionString = "mongodb://user:" + encodedPassword + "@host:27017/db";
```

### 问题 3：副本集认证

```yaml
# 副本集所有节点使用相同密钥文件
security:
  keyFile: /path/to/keyfile  # 权限必须是 600

net:
  port: 27017
  bindIp: 0.0.0.0
```

## 总结

认证方式对比：

| 认证方式 | 安全性 | 复杂度 | 适用场景 |
|---------|-------|--------|---------|
| SCRAM-SHA-256 | 高 | 低 | 大多数场景，推荐 |
| x.509 | 很高 | 高 | 高安全环境 |
| LDAP | 高 | 高 | 企业统一认证 |

**安全建议**：
1. 生产环境必须开启认证
2. 使用 SCRAM-SHA-256（SCRAM-SHA-1 已废弃）
3. 密码强度符合要求
4. 限制用户权限，最小权限原则
5. 定期轮换密码
6. 敏感环境使用 x.509 或 LDAP

---

**下一步，你可以：**

- 了解 [MongoDB 用户角色与权限管理](/database/mongodb/auth)
- 学习 [MongoDB 数据备份与恢复](/database/mongodb/backup)
- 掌握 [MongoDB vs MySQL vs Redis 选型](/database/mongodb/compare)
