# 序列化：对象的持久化与传输

---

你在内存中创建了一个用户对象：

```java
User user = new User();
user.setId(1L);
user.setName("张三");
user.setPassword("123456");
```

现在你面临一个问题：如何把它的状态保存下来？

- 保存到磁盘？下次程序启动时读取？
- 发送到另一台服务器？
- 缓存到 Redis？

这三种场景，都涉及**序列化（Serialization）**——把对象的状态转换成可以存储或传输的格式。

## Serializable 接口：标记接口

Java 序列化只需要让类实现 `Serializable` 接口：

```java
public class User implements Serializable {
    private static final long serialVersionUID = 1L;

    private Long id;
    private String name;
    private String password;
}
```

`Serializable` 是**标记接口**，没有任何方法。它的作用是告诉 JVM：「这个类的对象可以被序列化」。

### serialVersionUID 的作用

```java
private static final long serialVersionUID = 1L;
```

这是序列化版本号，用于验证序列化和反序列化时类的版本是否一致：

- **一致**：正常反序列化
- **不一致**：抛出 `InvalidClassException`

如果类没有显式声明 `serialVersionUID`，Java 会**自动生成一个**。这很危险——任何类的修改都会导致自动生成的 UID 变化，从而导致反序列化失败。

**最佳实践**：始终显式声明 `serialVersionUID`。

### serialVersionUID 的演进策略

| 版本变化 | UID 策略 |
|---|---|
| 字段增删 | 保持不变 |
| 字段类型变化 | UID 必须变化 |
| 字段名变化 | UID 必须变化 |
| 方法签名变化 | 通常不变（不参与序列化） |

## transient 关键字：不序列化的字段

不想让某些字段参与序列化？用 `transient`：

```java
public class User implements Serializable {
    private static final long serialVersionUID = 1L;

    private Long id;
    private String name;
    private transient String password; // 不会被序列化
    private transient String sessionToken; // 不会被序列化
}
```

**常见用途**：

| 字段类型 | 为什么不序列化 |
|---|---|
| 密码 | 安全考虑 |
| Session Token | 临时数据 |
| 缓存数据 | 可以从其他来源恢复 |
| 日志对象 | 无法序列化 |
| 数据库连接 | 连接状态无法跨 JVM 传递 |

**注意**：`static` 字段也不会被序列化，因为它属于类而非对象。

## 自定义序列化：writeObject / readObject

有时候需要在序列化前后做特殊处理：

```java
public class User implements Serializable {
    private static final long serialVersionUID = 1L;

    private Long id;
    private String name;
    private transient String password;

    // 序列化时调用
    private void writeObject(ObjectOutputStream out) throws IOException {
        out.defaultWriteObject(); // 默认序列化行为
        // 自定义：加密密码后再写入
        out.writeObject(encrypt(password));
    }

    // 反序列化时调用
    private void readObject(ObjectInputStream in)
            throws IOException, ClassNotFoundException {
        in.defaultReadObject(); // 默认反序列化行为
        // 自定义：解密密码
        this.password = decrypt((String) in.readObject());
    }

    private String encrypt(String password) {
        // 加密逻辑
        return Base64.getEncoder().encodeToString(password.getBytes());
    }

    private String decrypt(String encrypted) {
        // 解密逻辑
        return new String(Base64.getDecoder().decode(encrypted));
    }
}
```

### 关键点

1. `private void writeObject(ObjectOutputStream out)` 是特殊方法，签名必须完全一致
2. 先调用 `defaultWriteObject()` 保证默认行为
3. `readObject` 必须严格按照 `writeObject` 的顺序读取

## Externalizable 接口：完全自定义序列化

`Externalizable` 继承自 `Serializable`，但需要手动实现序列化逻辑：

```java
public class User implements Externalizable {

    private Long id;
    private String name;
    private transient String password;

    // 必须有无参构造函数（反序列化时用到）
    public User() {
    }

    @Override
    public void writeExternal(ObjectOutput out) throws IOException {
        out.writeLong(id);
        out.writeUTF(name);
        // 不写入 password
    }

    @Override
    public void readExternal(ObjectInput in)
            throws IOException, ClassNotFoundException {
        this.id = in.readLong();
        this.name = in.readUTF();
        // password 保持 null 或从其他方式恢复
    }
}
```

### Serializable vs Externalizable

| 特性 | Serializable | Externalizable |
|---|---|---|
| 实现方式 | 自动/自定义 | 手动 |
| 代码量 | 少 | 多 |
| 性能 | 较慢 | 较快 |
| 灵活性 | 一般 | 高 |
| 无参构造函数 | 不需要 | 必须 |

## readResolve()：单例与序列化

序列化可能破坏单例模式：

```java
public class Singleton implements Serializable {
    public static final Singleton INSTANCE = new Singleton();
    private Singleton() { }
}
```

序列化后反序列化，会创建新的对象：

```java
Singleton s1 = Singleton.INSTANCE;
Singleton s2 = (Singleton) deserialize(serialize(s1));
System.out.println(s1 == s2); // false！不再是单例
```

解决方案：`readResolve()` 方法：

```java
public class Singleton implements Serializable {
    public static final Singleton INSTANCE = new Singleton();
    private Singleton() { }

    // 反序列化时返回单例实例
    private Object readResolve() {
        return INSTANCE;
    }
}
```

**原理**：反序列化创建新对象后，`readResolve()` 返回的对象会替代新创建的对象。

## 序列化安全问题

### 密码字段的安全问题

```java
public class User implements Serializable {
    private Long id;
    private String username;
    private String password; // 敏感信息！
}
```

如果 User 被序列化到磁盘或网络传输，密码是明文的。

**解决方案**：

1. **用 `transient` 排除**：密码不应该被序列化
2. **自定义序列化**：加密后存储
3. **使用安全库**：如 jasypt

### 反序列化安全漏洞

反序列化不可信的数据可能导致远程代码执行（RCE）：

```java
// 危险！
Object obj = deserialize(untrustedData);
```

**防护措施**：

1. **使用白名单**：`ObjectInputStream` 可以设置 `enableCheck` 方法
2. **使用替代方案**：JSON、Protocol Buffers（更安全）
3. **验证输入**：反序列化前验证数据合法性

## 常见序列化方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|---|---|---|---|
| Java 原生 | JDK 内置，简单 | 性能差，跨语言难 | 临时序列化 |
| JSON (Jackson) | 跨语言，文本格式 | 体积大，类型丢失 | REST API |
| Protocol Buffers | 高性能，跨语言 | 二进制，需要定义 schema | 高性能 RPC |
| Kryo | 高性能 | Java 专用 | 内部系统 |
| FST | 高性能 | Java 专用 | 内部系统 |

### JSON 序列化示例

```java
// Jackson
ObjectMapper mapper = new ObjectMapper();
String json = mapper.writeValueAsString(user);
User user2 = mapper.readValue(json, User.class);
```

### Protocol Buffers 示例

```protobuf
// user.proto
message User {
    int64 id = 1;
    string name = 2;
    string password = 3;
}
```

## 面试追问方向

- 为什么 `transient` 字段不能被序列化？
- 序列化后的对象在反序列化时，构造函数会被调用吗？
- 如何实现一个自定义的序列化协议？
- `readResolve()` 和 `writeReplace()` 有什么区别？

## 留给你的思考题

假设你在设计一个分布式缓存系统，需要把 User 对象缓存到 Redis 中：

```java
public class User implements Serializable {
    private static final long serialVersionUID = 1L;

    private Long id;
    private String name;
    private String password;
    private Date createTime;
    private Date lastLoginTime;
}
```

请思考以下问题：

1. 哪些字段应该被序列化缓存？哪些不应该？
2. 如果 password 必须参与业务逻辑但不应该明文存储在缓存中，你怎么设计？
3. 如果 User 类后来增加了新字段，旧缓存的数据如何兼容？
4. 序列化到 Redis 和从 Redis 反序列化，有什么安全风险需要注意？

这道题综合了序列化的核心概念和实战中的安全问题。
