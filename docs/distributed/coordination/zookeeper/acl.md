# ZooKeeper ACL 权限控制

你有没有想过这个问题：

你在公司内网部署了一套 ZooKeeper 给微服务做注册中心，结果发现：只要知道 IP 地址，谁都能读写所有节点。

服务 A 能删掉服务 B 的注册信息，服务 C 能改掉服务 A 的配置。

这是因为 ZooKeeper **默认不开启权限控制**。

今天，我们来看看 ZooKeeper 的 ACL 机制。

## ACL 的三要素

ZooKeeper 的权限控制由三个要素组成：**Who、How、What**

```java
// ACL = Scheme:ID + Permission
// Who：谁（Scheme + ID）
// How：有什么权限（Permission）
// What：对什么生效（节点路径）
```

### Scheme：认证方式

| Scheme | 说明 | ID 格式 |
|--------|------|---------|
| world | 所有人 | anyone（固定值） |
| auth | 已认证用户 | 无（使用当前会话的用户） |
| digest | 用户名:密码 | username:BASE64(SHA1(password)) |
| ip | IP 地址 | IP 地址或 CIDR |
| super | 超级用户 | 需要特殊编译 |

### Permission：权限类型

| 权限 | 字符 | 说明 |
|------|------|------|
| CREATE | c | 创建子节点 |
| READ | r | 读取节点数据和子节点列表 |
| WRITE | w | 更新节点数据 |
| DELETE | d | 删除子节点 |
| ADMIN | a | 设置权限 |

注意：**CREATE 和 DELETE 是子节点权限，不是当前节点**。

## 常用 ACL 配置

### world:anyone（默认）

```java
// 默认权限：任何人都有所有权限
client.setACL("/", Ids.OPEN_ACL_UNSAFE, -1);
// 等价于
// world:anyone:cdrwa
```

### digest:username:password

```java
// digest 认证：需要用户名和密码
List<ACL> acl = new ArrayList<>();
ACL readAcl = new ACL(Ids.READ_ACL_UNSAFE);
// 或
ACL digestAcl = new ACL(Perms.READ, new Id("digest",
    DigestAuthenticationProvider.generateDigest("admin:admin123")));

client.setACL("/config", acl, -1);
```

### ip:192.168.1.100

```java
// 只允许指定 IP 访问
ACL ipAcl = new ACL(Perms.ALL, new Id("ip", "192.168.1.100"));
client.setACL("/internal", Collections.singletonList(ipAcl), -1);

// IP 段控制
ACL ipRangeAcl = new ACL(Perms.READ, new Id("ip", "192.168.1.0/24"));
```

### auth（已认证用户）

```java
// 添加认证信息
client.addAuthInfo("digest", "admin:admin123".getBytes());

// 设置 auth 权限
ACL authAcl = new ACL(Perms.ALL, new Id("auth", "admin:admin123"));
client.setACL("/secure", Collections.singletonList(authAcl), -1);
```

## Curator ACL API

Curator 提供了更便捷的 ACL 操作方式。

### 设置默认 ACL

```java
// 创建客户端时设置默认 ACL
CuratorFramework client = CuratorFrameworkFactory.builder()
    .connectString("localhost:2181")
    .defaultACL(Ids.READ_ACL_UNSAFE)  // 默认读权限
    .authorization("digest", "admin:admin123".getBytes())
    .retryPolicy(new ExponentialBackoffRetry(1000, 3))
    .build();
```

### 创建节点时指定 ACL

```java
// 创建带 ACL 的节点
List<ACL> aclList = new ArrayList<>();
aclList.add(new ACL(Perms.ALL, new Id("auth", "admin:admin123")));
aclList.add(new ACL(Perms.READ, new Id("ip", "192.168.1.0/24")));

client.create()
    .withMode(CreateMode.PERSISTENT)
    .withACL(aclList)
    .forPath("/protected", "secret".getBytes());
```

### 认证登录

```java
// 客户端添加认证信息
client.addAuthInfo("digest", "admin:admin123".getBytes());
client.start();

// 之后所有操作都会携带认证信息
byte[] data = client.getData().forPath("/protected"); // 有权限
```

## ACL 的继承性

ZooKeeper 的 ACL **不继承**。

子节点不会自动继承父节点的权限，每个节点需要单独设置。

```java
// 创建父节点，带 ACL
client.create()
    .withACL(Ids.READ_ACL_UNSAFE)
    .forPath("/parent");

// 创建子节点，ACL 是默认的 OPEN_ACL_UNSAFE
client.create()
    .forPath("/parent/child");  // 没有继承父节点权限！

// 如果想继承，需要在创建子节点时显式指定
client.create()
    .withACL(Ids.READ_ACL_UNSAFE)
    .forPath("/parent/child");
```

这个设计看起来反直觉，但 ZooKeeper 团队认为：显式授权更安全。

## 多租户隔离场景

一个常见的场景：多租户环境下，不同 namespace 的数据需要隔离。

```java
// 方案一：每个租户一个 ZooKeeper 集群（成本高）
// 方案二：使用 ACL 隔离同一集群中的不同租户

// 租户 A 的 namespace
clientA.addAuthInfo("digest", "tenant-a:password-a".getBytes());
clientA.create()
    .withACL(Collections.singletonList(
        new ACL(Perms.ALL, new Id("auth", "tenant-a"))))
    .forPath("/tenant-a/config");

// 租户 B 的 namespace
clientB.addAuthInfo("digest", "tenant-b:password-b".getBytes());
clientB.create()
    .withACL(Collections.singletonList(
        new ACL(Perms.ALL, new Id("auth", "tenant-b"))))
    .forPath("/tenant-b/config");
```

不同租户用自己的认证信息访问自己的数据，互不干扰。

## ACL 注意事项

### 超级用户（super）

如果忘记密码，可以通过超级用户权限重置：

```properties
# zoo.cfg 配置超级用户
authProvider.1=org.apache.zookeeper.server.auth.DigestAuthenticationProvider
jaasLoginKey=super
```

但 ZooKeeper 默认不开启 super 模式，需要特殊编译。

### ACL 检查时机

ACL 检查发生在**每个操作前**，不是创建时。

即使创建时没设置权限，后来加上的权限也会生效。

### CuratorException

权限不足时会抛出 CuratorException：

```java
try {
    client.getData().forPath("/protected");
} catch (NoAuthException e) {
    System.out.println("权限不足，无法访问该节点");
}
```

## 总结

ZooKeeper 的 ACL 机制，为分布式系统提供了基础的安全保障：

- **三要素**：Scheme（认证方式）、ID（身份）、Permission（权限）
- **五种 Scheme**：world、auth、digest、ip、super
- **五种权限**：CREATE、READ、WRITE、DELETE、ADMIN
- **不继承**：每个节点需要单独设置 ACL
- **Curator 封装**：简化认证和 ACL 操作

理解 ACL，才能在生产环境中安全地使用 ZooKeeper。

**面试追问方向：**
- ACL 的五种 Scheme 分别适用什么场景？
- world:anyone 和 auth:anyone 有什么区别？
- 如果一个节点没有设置 ACL，谁可以访问它？
- ZooKeeper 的 ACL 和 Linux 文件权限有什么本质区别？