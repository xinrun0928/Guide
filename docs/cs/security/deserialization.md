# 反序列化漏洞：隐藏的危险

你的应用使用了 Redis 缓存：

```java
String userJson = redis.get("user:" + userId);
User user = deserialize(userJson);  // 反序列化
```

攻击者提前在 Redis 中植入了一个恶意对象。反序列化时，对象的 `readObject()` 方法自动执行——里面写着：`Runtime.getRuntime().exec("...")`

这就是**反序列化漏洞（Deserialization Vulnerability）**——把数据还原成对象时，对象中的恶意代码被执行。

## Java 序列化基础

### 什么是 Java 序列化

Java 序列化是把对象转换成字节流的技术，用于：
- 网络传输
- 持久化存储
- Session 存储（Redis/缓存）

```java
// 序列化：对象 → 字节流
User user = new User("Alice", 25);
ByteArrayOutputStream baos = new ByteArrayOutputStream();
ObjectOutputStream oos = new ObjectOutputStream(baos);
oos.writeObject(user);
byte[] data = baos.toByteArray();

// 反序列化：字节流 → 对象
ByteArrayInputStream bais = new ByteArrayInputStream(data);
ObjectInputStream ois = new ObjectInputStream(bais);
User restored = (User) ois.readObject();
```

### 反序列化触发点

```
┌─────────────────────────────────────────────────────────────┐
│                    反序列化触发点                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. RMI（远程方法调用）                                       │
│     Java RMI 使用序列化传输对象                               │
│                                                             │
│  2. JMX（Java Management Extensions）                        │
│     JMX 远程管理使用序列化                                    │
│                                                             │
│  3. JNLP（Java Web Start）                                   │
│     胖客户端下载和执行                                        │
│                                                             │
│  4. 自定义协议                                               │
│     自定义协议使用 ObjectInputStream                         │
│                                                             │
│  5. 缓存系统                                                 │
│     Redis、Memcached 反序列化存储的对象                       │
│                                                             │
│  6. ORM 框架                                                 │
│     Hibernate、Jackson 反序列化 JSON/XML                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 反序列化漏洞原理

### 攻击流程

```
攻击者 → 序列化恶意对象 → 发送到服务器 → 服务器反序列化 → 恶意代码执行
```

### 危险的反序列化链

Java 有很多类会在反序列化时自动执行代码：

```java
// Apache Commons Collections 反序列化链
// 入口：TrAXTransformer → InvokerTransformer → Runtime.exec()

// 恶意序列化数据
// 包含：HashMap → AnnotationInvocationHandler → 
//      LinkedHashSet → Transformer chain → Runtime.exec()
```

```java
//ysoserial 生成的 payload 结构
ObjectInputStream ois = new ObjectInputStream(input);
ois.readObject();  // 触发反序列化
// → 自动调用 readObject()
// → 自动调用恶意对象的构造函数或静态代码块
// → 执行恶意代码
```

### 真实攻击示例

```java
// 漏洞场景：Redis Session 存储
@Service
public class SessionService {
    
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;
    
    public User getSessionUser(String sessionId) {
        // 从 Redis 获取序列化的 Session
        Object obj = redisTemplate.opsForValue().get("session:" + sessionId);
        
        // ⚠️ 如果对象被恶意替换，反序列化时会执行恶意代码
        if (obj instanceof User) {
            return (User) obj;
        }
        return null;
    }
}
```

## 反序列化漏洞防御

### 1. 禁止使用 ObjectInputStream

```java
// ❌ 危险：直接使用 ObjectInputStream
public Object deserialize(byte[] data) {
    ByteArrayInputStream bais = new ByteArrayInputStream(data);
    ObjectInputStream ois = new ObjectInputStream(bais);
    return ois.readObject();  // 危险！
}

// ✅ 替代方案：使用 JSON
public User deserializeFromJson(byte[] data) {
    ObjectMapper mapper = new ObjectMapper();
    return mapper.readValue(data, User.class);
}
```

### 2. 自定义 ObjectInputStream

```java
/**
 * 受限的反序列化器：只允许反序列化白名单类
 */
public class SafeObjectInputStream extends ObjectInputStream {
    
    private static final Set<String> ALLOWED_CLASSES = Set.of(
        "com.example.model.User",
        "com.example.model.Order",
        "java.util.HashMap",
        "java.util.ArrayList"
    );
    
    public SafeObjectInputStream(InputStream in) throws IOException {
        super(in);
    }
    
    @Override
    protected Class<?> resolveClass(ObjectStreamClass desc) 
            throws IOException, ClassNotFoundException {
        
        String className = desc.getName();
        
        // 白名单检查
        if (!ALLOWED_CLASSES.contains(className)) {
            throw new SecurityException("禁止反序列化类: " + className);
        }
        
        return super.resolveClass(desc);
    }
}

// 使用
public Object safeDeserialize(byte[] data) throws IOException, ClassNotFoundException {
    ByteArrayInputStream bais = new ByteArrayInputStream(data);
    SafeObjectInputStream soiss = new SafeObjectInputStream(bais);
    return soiss.readObject();
}
```

### 3. 使用 SerialKiller

```java
// 引入 SerialKiller 库
// 配置白名单/黑名单
public Object deserializeWithSerialKiller(byte[] data) throws Exception {
    ByteArrayInputStream bais = new ByteArrayInputStream(data);
    
    SerialKiller sk = new SerialKiller(
        bais, 
        "serialkiller.conf"  // 配置文件
    );
    return sk.readObject();
}
```

```xml
<!-- serialkiller.conf -->
<serialkiller>
    <!-- 白名单 -->
    <whiteList>
        <regex>com\.example\.model\..*</regex>
        <regex>java\.util\..*</regex>
    </whiteList>
    
    <!-- 黑名单 -->
    <blackList>
        <regex>sun\.reflect\..*</regex>
        <regex>java\.lang\.invoke\..*</regex>
        <regex>org\.apache\.commons\.collections\.transformer.*</regex>
        <regex>org\.apache\.commons\.collections\.functors.*</regex>
    </blackList>
</serialkiller>
```

### 4. Spring Security 反序列化防护

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public RedisTemplate<String, Object> redisTemplate() {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        
        // ⚠️ 禁用 JDK 序列化，使用 JSON
        template.setValueOperations(new GenericJackson2JsonRedisSerializer());
        template.setHashValueOperations(new GenericJackson2JsonRedisSerializer());
        
        // 或显式配置
        Jackson2JsonRedisSerializer<Object> serializer = 
            new Jackson2JsonRedisSerializer<>(Object.class);
        
        ObjectMapper mapper = new ObjectMapper();
        // 防止反序列化未知类
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        // 设置可以识别的类
        mapper.registerModules(new JavaTimeModule());
        
        template.setValueSerializer(serializer);
        template.setHashValueSerializer(serializer);
        
        return template;
    }
}
```

### 5. RMI/JNDI 防护

```java
// Java 17+ 禁用危险协议
// 在启动参数中：
// --add-opens java.base/java.lang=ALL-UNNAMED
// --add-opens java.base/java.io=ALL-UNNAMED

// 或在代码中
System.setProperty("trustStore", "...");

// 禁用 JNDI 注入
System.setProperty("com.sun.jndi.rmi.object.trustURLCodebase", "false");
System.setProperty("com.sun.jndi.ldap.object.trustURLCodebase", "false");
```

## JSON 反序列化安全

Jackson 等 JSON 库也可能存在反序列化漏洞：

```java
@Configuration
public class JacksonConfig {
    
    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        
        // 禁用不安全的配置
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        mapper.configure(MapperFeature.DEFAULT_VIEW_INCLUSION, false);
        
        // 使用 PolymorphicTypeValidator 限制类型
        mapper.setPolymorphicTypeValidator(
            BasicPolymorphicTypeValidator.builder()
                .allowIfBaseType(User.class)  // 只允许 User 及其子类
                .allowIfSubType(Map.class)
                .allowIfSubType(Collection.class)
                .build()
        );
        
        return mapper;
    }
}
```

## 检测反序列化漏洞

```bash
# 使用工具检测
# 1. SerialKiller 配置审计
# 2. 扫描代码中的 ObjectInputStream 使用
grep -r "ObjectInputStream" --include="*.java" src/

# 3. ysoserial 测试
java -jar ysoserial.jar CommonsCollections6 "touch /tmp/pwned" > payload.ser
```

## 面试追问方向

1. **反序列化漏洞的根本原因？** —— 反序列化时，对象的构造函数、readObject() 等自动执行，攻击者利用这个特性注入恶意代码
2. **为什么 JSON 反序列化更安全？** —— JSON 只反序列化基本类型和数据结构，不会有代码执行
3. **ysoserial 是什么？** —— 生成恶意序列化 payload 的工具，测试反序列化漏洞
4. **JNDI 注入和反序列化的关系？** —— JNDI 注入可以在反序列化时触发远程类加载
5. **Spring Session Redis 为什么安全？** —— 使用 JSON 序列化，不依赖 Java 序列化

> "Java 反序列化是历史上最危险的安全漏洞类型之一。理解它的原理和防御，是每个 Java 工程师的必修课。"
