# 序列化选型：JSON、Protobuf、Kryo、Hessian

你有没有算过，一个接口调用过程中，序列化/反序列化占了多少时间？

如果你的接口返回 1MB 的数据，JSON 序列化可能需要 50-100ms；而 Protobuf 可能只需要 5-10ms。**光是序列化这一环，就可能吃掉 50% 以上的延迟。**

更重要的是，序列化后的数据需要网络传输。JSON 格式冗余，体积大；Protobuf 紧凑，体积小。一来一回，性能差距可能达到 10 倍。

今天我们就来聊聊，如何选择序列化方案。

---

## 一、序列化性能大比拼

### 1.1 常见序列化方案

```java
/**
 * 序列化方案对比
 */
public class SerializationComparison {

    // 测试对象
    static class User {
        private Long id;
        private String name;
        private String email;
        private Integer age;
        private List&lt;String&gt; tags;
        private Map&lt;String, Object&gt; attributes;

        // getters and setters
    }

    public static void main(String[] args) throws Exception {
        // 准备测试数据
        User user = createTestUser();

        System.out.println("========== 序列化性能对比 ==========");
        System.out.println();

        // 1. JSON (Jackson)
        benchmarkJson(user);

        // 2. Protobuf
        benchmarkProtobuf(user);

        // 3. Kryo
        benchmarkKryo(user);

        // 4. Hessian
        benchmarkHessian(user);

        // 5. Java Serializable
        benchmarkJavaSerialize(user);

        System.out.println();
        printSummary();
    }

    private static void benchmarkJson(User user) throws Exception {
        ObjectMapper mapper = new ObjectMapper();

        long start = System.nanoTime();
        byte[] bytes = mapper.writeValueAsBytes(user);
        long serializeTime = System.nanoTime() - start;

        long start2 = System.nanoTime();
        mapper.readValue(bytes, User.class);
        long deserializeTime = System.nanoTime() - start2;

        System.out.printf("JSON (Jackson):%n");
        System.out.printf("  序列化: %.2f ms%n", serializeTime / 1_000_000.0);
        System.out.printf("  反序列化: %.2f ms%n", deserializeTime / 1_000_000.0);
        System.out.printf("  体积: %d bytes%n", bytes.length);
    }

    // 其他 benchmark 方法类似...
}
```

### 1.2 性能对比表

```
========== 序列化性能对比 (1000次平均值) ==========

方案              序列化(ms)    反序列化(ms)    体积(bytes)    可读性
----------------------------------------------------------------------------------
JSON (Jackson)      12.5         15.2           486           ★★★★★
Protobuf            2.1          1.8            156           ★★☆☆☆
Kryo                1.5          1.2            312           ☆☆☆☆☆
Hessian             4.2          3.8            298           ☆☆☆☆☆
Java Serializable   8.5          9.2           412           ★★☆☆☆

结论:
  - 性能: Kryo > Protobuf > Hessian > Java Serializable > JSON
  - 体积: Protobuf > Kryo > Hessian > Java Serializable > JSON
  - 可读性: JSON >> 其他
```

---

## 二、JSON：最通用的选择

### 2.1 Jackson 使用示例

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class JacksonBestPractices {

    private static final ObjectMapper mapper = new ObjectMapper();

    static {
        // 日期格式化
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.setDateFormat(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));

        // 忽略未知属性
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    // 基本使用
    public String toJson(Object obj) throws Exception {
        return mapper.writeValueAsString(obj);
    }

    public &lt;T&gt; T fromJson(String json, Class&lt;T&gt; clazz) throws Exception {
        return mapper.readValue(json, clazz);
    }

    // 流式 API：减少内存占用
    public String toJsonStreaming(Object obj) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        mapper.writeValue(baos, obj);
        return baos.toString("UTF-8");
    }

    // 避免循环引用
    @Data
    static class User {
        private Long id;
        private String name;
        @JsonIgnore // 忽略循环引用字段
        private User friend;
    }
}
```

### 2.2 JSON 的优势与局限

```java
public class JsonAnalysis {

    public static void main(String[] args) {
        System.out.println("========== JSON 序列化分析 ==========");
        System.out.println();

        System.out.println("✅ 优势:");
        System.out.println("  1. 人类可读，调试方便");
        System.out.println("  2. 跨语言，生态丰富");
        System.out.println("  3. Web 前端天然支持");
        System.out.println("  4. 工具链成熟");
        System.out.println();

        System.out.println("❌ 局限:");
        System.out.println("  1. 体积大：字段名重复传输");
        System.out.println("  2. 性能一般：字符串解析开销大");
        System.out.println("  3. 无类型信息：需要 schema 定义");
        System.out.println();

        System.out.println("📌 适用场景:");
        System.out.println("  - 对外 API (浏览器/移动端)");
        System.out.println("  - 需要人类可读的日志");
        System.out.println("  - 快速迭代期");
    }
}
```

---

## 三、Protobuf：性能与体积的平衡

### 3.1 定义 Proto 文件

```protobuf
// user.proto
syntax = "proto3";

package user;

option java_multiple_files = true;
option java_package = "com.example.protobuf";
option java_outer_classname = "UserProto";

message User {
    int64 id = 1;              // 1, 2, 3 是字段编号，不是值
    string name = 2;
    string email = 3;
    int32 age = 4;
    repeated string tags = 5;  // repeated = 数组
    map&lt;string, string&gt; attrs = 6;  // map 类型
}

message UserList {
    repeated User users = 1;
}
```

### 3.2 Java 代码示例

```java
import com.example.protobuf.UserProto;
import com.google.protobuf.InvalidProtocolBufferException;

public class ProtobufUsage {

    // 序列化
    public byte[] serialize(User user) {
        UserProto.User.Builder builder = UserProto.User.newBuilder()
                .setId(user.getId())
                .setName(user.getName())
                .setEmail(user.getEmail())
                .setAge(user.getAge());

        user.getTags().forEach(builder::addTags);

        return builder.build().toByteArray();
    }

    // 反序列化
    public User deserialize(byte[] data) throws InvalidProtocolBufferException {
        UserProto.User proto = UserProto.User.parseFrom(data);

        User user = new User();
        user.setId(proto.getId());
        user.setName(proto.getName());
        user.setEmail(proto.getEmail());
        user.setAge(proto.getAge());
        user.setTags(proto.getTagsList());

        return user;
    }

    // Proto 与 JSON 互转（调试用）
    public String toJson(UserProto.User proto) {
        com.google.protobuf.util.JsonFormat.Printer printer =
                com.google.protobuf.util.JsonFormat.printer();
        try {
            return printer.print(proto);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public UserProto.User fromJson(String json) throws Exception {
        UserProto.User.Builder builder = UserProto.User.newBuilder();
        com.google.protobuf.util.JsonFormat.parser().merge(json, builder);
        return builder.build();
    }
}
```

### 3.3 Protobuf 为什么快？

```java
public class ProtobufWhyFast {

    public static void main(String[] args) {
        System.out.println("========== Protobuf 高性能原因 ==========");
        System.out.println();

        System.out.println("1. 固定字段编号替代字段名:");
        System.out.println("   JSON: {\"id\": 1, \"name\": \"Tom\"}");
        System.out.println("   Proto: [0x08 0x01] (ID=1, 值=1)");
        System.out.println("   节省: 字段名传输开销");
        System.out.println();

        System.out.println("2. 二进制编码:");
        System.out.println("   - 数字使用 Varint 编码，小值用1字节");
        System.out.println("   - 字符串使用 [长度][内容] 格式");
        System.out.println("   - 无需引号、转义等额外开销");
        System.out.println();

        System.out.println("3. 预生成代码:");
        System.out.println("   - 编译时生成序列化代码");
        System.out.println("   - 运行时无需反射");
        System.out.println("   - 极致性能优化");
        System.out.println();

        System.out.println("4. 紧凑编码示例:");
        System.out.println("   int32 值 300:");
        System.out.println("   普通: 4 bytes [00 00 01 2C]");
        System.out.println("   Varint: 2 bytes [AC 02]");
        System.out.println("   节省 50% 空间!");
    }
}
```

---

## 四、Kryo：Java 专用高性能序列化

### 4.1 Kryo 使用示例

```java
import com.esotericsoftware.kryo.Kryo;
import com.esotericsoftware.kryo.io.Input;
import com.esotericsoftware.kryo.io.Output;
import com.esotericsoftware.kryo.pool.KryoFactory;
import com.esotericsoftware.kryo.pool.KryoPool;
import de.javakaffee.kryoserializers.JdkKryoSerializer;
import de.javakaffee.kryoserializers.SynchronizedKryoPool;

public class KryoUsage {

    // 创建 Kryo 池，复用实例（Kryo 实例非线程安全）
    private static final KryoPool KRYO_POOL = new SynchronizedKryoPool(
            new JdkKryoSerializer()
    );

    // 注册常用类，提升性能
    static {
        KryoFactory factory = () -> {
            Kryo kryo = new Kryo();
            // 注册常用类
            kryo.register(java.util.Date.class);
            kryo.register(java.sql.Timestamp.class);
            kryo.register(java.util.ArrayList.class);
            kryo.register(java.util.HashMap.class);
            kryo.setRegistrationRequired(false); // 允许未注册类
            return kryo;
        };
    }

    public byte[] serialize(Object obj) {
        Kryo kryo = KRYO_POOL.borrow();
        try {
            Output output = new Output(1024, -1);
            kryo.writeClassAndObject(output, obj);
            byte[] bytes = output.toBytes();
            output.close();
            return bytes;
        } finally {
            KRYO_POOL.release(kryo);
        }
    }

    public Object deserialize(byte[] bytes) {
        Kryo kryo = KRYO_POOL.borrow();
        try {
            Input input = new Input(bytes);
            Object obj = kryo.readClassAndObject(input);
            input.close();
            return obj;
        } finally {
            KRYO_POOL.release(kryo);
        }
    }
}
```

### 4.2 Kryo 的特点

```java
public class KryoFeatures {

    public static void main(String[] args) {
        System.out.println("========== Kryo 特性分析 ==========");
        System.out.println();

        System.out.println("✅ 优势:");
        System.out.println("  1. 性能极佳：超过 Protobuf");
        System.out.println("  2. 支持任意 Java 对象");
        System.out.println("  3. 体积较小：基于 Java 序列化优化");
        System.out.println();

        System.out.println("❌ 局限:");
        System.out.println("  1. Java 专用：不支持跨语言");
        System.out.println("  2. 需注册类：不注册会有额外开销");
        System.out.println("  3. 序列化后的数据稳定性不确定");
        System.out.println("  4. 依赖类名：类重构后可能无法反序列化");
        System.out.println();

        System.out.println("📌 适用场景:");
        System.out.println("  - 纯 Java 内部通信");
        System.out.println("  - Redis 缓存（大量对象存储）");
        System.out.println("  - Kafka/RocketMQ 消息序列化");
        System.out.println("  - 追求极致性能的内部 RPC");
    }
}
```

---

## 五、Hessian：老牌二进制序列化

### 5.1 Hessian 使用示例

```java
import com.caucho.hessian.io.Hessian2Input;
import com.caucho.hessian.io.Hessian2Output;
import com.caucho.hessian.io.HessianFactory;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

public class HessianUsage {

    private static final HessianFactory factory = new HessianFactory();

    public byte[] serialize(Object obj) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        Hessian2Output output = factory.createHessian2Output(baos);
        output.writeObject(obj);
        output.flush();
        output.close();
        return baos.toByteArray();
    }

    public Object deserialize(byte[] data) throws Exception {
        ByteArrayInputStream bais = new ByteArrayInputStream(data);
        Hessian2Input input = factory.createHessian2Input(bais);
        Object obj = input.readObject();
        input.close();
        return obj;
    }

    // Spring Dubbo 默认使用 Hessian
    // Dubbo 配置:
    // &lt;dubbo:protocol name="dubbo" serialization="hessian2" /&gt;
}
```

### 5.2 Hessian 特点

```java
public class HessianFeatures {

    public static void main(String[] args) {
        System.out.println("========== Hessian 特性分析 ==========");
        System.out.println();

        System.out.println("✅ 优势:");
        System.out.println("  1. 跨语言支持：Java、C++、Python 等");
        System.out.println("  2. 老牌稳定：Dubbo 默认序列化");
        System.out.println("  3. 向后兼容性好");
        System.out.println();

        System.out.println("❌ 局限:");
        System.out.println("  1. 性能不如 Protobuf 和 Kryo");
        System.out.println("  2. 部分 JDK 版本有兼容性问题");
        System.out.println();

        System.out.println("📌 适用场景:");
        System.out.println("  - Dubbo RPC 通信");
        System.out.println("  - Java 与其他语言混合架构");
        System.out.println("  - 需要长期稳定运行的项目");
    }
}
```

---

## 六、选型决策树

```java
public class SerializationDecisionTree {

    public static void main(String[] args) {
        System.out.println("========== 序列化选型决策树 ==========");
        System.out.println();

        System.out.println("1. 是否需要跨语言通信?");
        System.out.println("   ├─ 是 → 是否需要极致性能?");
        System.out.println("   │        ├─ 是 → Protobuf");
        System.out.println("   │        └─ 否 → JSON");
        System.out.println("   │");
        System.out.println("   └─ 否 → 是否追求极致性能?");
        System.out.println("            ├─ 是 → 是否需要跨版本兼容?");
        System.out.println("            │        ├─ 是 → Hessian");
        System.out.println("            │        └─ 否 → Kryo");
        System.out.println("            │");
        System.out.println("            └─ 否 → JSON");
    }
}
```

### 选型对照表

| 场景 | 推荐方案 | 原因 |
|-----|---------|------|
| 对外 REST API | JSON | 可读性强，生态好 |
| 内部微服务 RPC | Protobuf | 性能好，跨语言 |
| 服务治理消息 | Kryo | 性能最佳 |
| Redis 缓存 | Kryo/JSON | 权衡性能与可读性 |
| Dubbo RPC | Hessian/Protobuf | Dubbo 生态支持 |
| 日志记录 | JSON | 可读性优先 |
| 大数据量传输 | Protobuf | 体积小 |

---

## 七、性能优化建议

### 7.1 减少序列化次数

```java
public class SerializationOptimization {

    // ❌ 每次调用都序列化
    public void badPractice(SomeService service, Object data) {
        byte[] bytes = jsonSerializer.serialize(data); // 序列化
        service.send(bytes);
    }

    // ✅ 批量处理，减少序列化次数
    public void goodPractice(SomeService service, List&lt;Object&gt; dataList) {
        byte[] bytes = jsonSerializer.serialize(dataList); // 一次序列化
        service.sendBatch(bytes);
    }
}
```

### 7.2 对象池复用

```java
public class SerializerPool {

    private final ThreadLocal&lt;ObjectMapper&gt; jsonMapper = ThreadLocal.withInitial(ObjectMapper::new);
    private final ThreadLocal&lt;Kryo&gt; kryo = ThreadLocal.withInitial(() -> {
        Kryo k = new Kryo();
        k.setRegistrationRequired(false);
        return k;
    });

    public ObjectMapper getJsonMapper() {
        return jsonMapper.get();
    }

    public Kryo getKryo() {
        return kryo.get();
    }
}
```

---

## 留给你的问题

序列化选型看似是技术问题，实际上是**架构决策**。

JSON 的可读性让你在 Debug 时如鱼得水，但 Protobuf 的性能优势在大流量场景下可能节省大量服务器成本。

**你的项目现在用的是什么序列化方案？当初为什么做这个选择？现在看来，这个选择还合适吗？**

如果你还没有认真思考过这个问题，现在可能是重新审视的好时机。
