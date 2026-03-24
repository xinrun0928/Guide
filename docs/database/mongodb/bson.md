# BSON：MongoDB 的二进制数据格式

你知道吗？当你往 MongoDB 存入一个文档时，它并不是以 JSON 字符串的形式存储的。

MongoDB 内部用的是 **BSON（Binary JSON）**——JSON 的二进制表示。

那为什么要用 BSON？JSON 不香吗？

---

## 为什么需要 BSON？

JSON 很好，但它有几个问题：

1. **慢**：解析字符串需要时间
2. **大**：每个字段名都要重复存储
3. **类型少**：只有 string、number、boolean、null、array、object

BSON 就是来解决这些问题的：

| 特性 | JSON | BSON |
|-----|------|------|
| 解析速度 | 慢（字符串解析） | 快（二进制直接读取） |
| 体积 | 大（字段名重复） | 小（可优化） |
| 类型 | 6种 | 十几种 |
| 遍历 | 顺序扫描 | 可跳过头部 |

---

## BSON 数据类型一览

BSON 支持比 JSON 更多的数据类型：

### 常用类型

| 类型 | 值示例 | Java 中对应 |
|-----|-------|------------|
| Double | `3.14` | `Double` |
| String | `"hello"` | `String` |
| Boolean | `true / false` | `Boolean` |
| Null | `null` | `null` |
| Array | `[1, 2, 3]` | `List&lt;?&gt;` |
| Object | `{a: 1}` | `Document` |
| ObjectId | `ObjectId("...")` | `ObjectId` |
| Date | `ISODate("...")` | `Date` |
| Integer (32位) | `100` | `Integer` |
| Long (64位) | `9999999999` | `Long` |
| Timestamp | `Timestamp(123, 456)` | `Timestamp` |

### 特殊类型

```json
// ObjectId - MongoDB 自动生成的唯一ID
"_id": ObjectId("507f1f77bcf86cd799439011")

// Date - 存储 UTC 时间
"createdAt": ISODate("2024-01-15T10:30:00.000Z")

// Timestamp - 用于内部操作排序
"ts": Timestamp(1705312200, 1)

// Binary Data - 存储二进制
"file": BinData(0, "base64encoded...")

// Regular Expression - 正则
"pattern": /abc.*/i

// JavaScript Code - JS代码（不推荐）
"script": Code("function() { return 1; }")

// Decimal128 - 高精度小数（用于金融计算）
"amount": Decimal128("123.4567890123456789")

// Min/Max Keys - 比较边界
"_validAfter": MinKey
"_validUntil": MaxKey
```

---

## ObjectId：MongoDB 的默认主键

当你插入文档不指定 `_id` 时，MongoDB 会自动生成一个 ObjectId：

```json
{
  "_id": ObjectId("507f1f77bcf86cd799439011")
}
```

### ObjectId 的结构

ObjectId 是 12 字节的二进制数据：

```
| 0-3 字节    | 4-8 字节     | 9-11 字节 | 12 字节 |
| 时间戳      | 机器ID       | 进程ID    | 计数器  |
| 507f1f77    | bcf86cd7     | 99439011  | 01      |
```

**组成部分：**
- 4 字节：Unix 时间戳（秒）
- 5 字节：机器标识（主机名哈希 or 随机数）
- 3 字节：进程ID
- 3 字节：自增计数器

### ObjectId 的特点

```java
import org.bson.types.ObjectId;

// 创建新的 ObjectId
ObjectId id = new ObjectId();
System.out.println(id.toHexString());  // 507f1f77bcf86cd799439011

// 从字符串解析
ObjectId fromStr = new ObjectId("507f1f77bcf86cd799439011");

// 从时间戳反推
Date date = id.getDate();
System.out.println(date);  // Tue Jan 15 10:30:00 CST 2024

// ObjectId 之间可以比较（按时间顺序）
ObjectId id1 = new ObjectId("507f1f77bcf86cd799439011");
ObjectId id2 = new ObjectId("507f1f77bcf86cd799439012");
System.out.println(id1.compareTo(id2));  // -1 (id1 < id2)
```

**ObjectId 的优势：**
1. 唯一性：包含时间戳+机器+进程+计数器，几乎不会重复
2. 有序性：后生成的 ObjectId 字典序更大
3. 本地生成：不需要数据库生成，减少网络延迟

---

## Java 中的 BSON 类型映射

使用 MongoDB Java Driver 时，BSON 类型会自动映射为 Java 类型：

```java
import org.bson.*;
import java.util.Date;
import java.util.List;
import java.util.UUID;

// MongoDB 文档（BSON）
Document doc = new Document()
    .append("string", "hello")
    .append("number", 42)
    .append("double", 3.14)
    .append("boolean", true)
    .append("null", null)
    .append("date", new Date())
    .append("objectId", new ObjectId())
    .append("list", List.of(1, 2, 3))
    .append("nested", new Document("key", "value"))
    .append("binary", new byte[]{1, 2, 3})
    .append("uuid", UUID.randomUUID())
    .append("decimal", new Decimal128("123.456"));

// 读取时自动转换
String str = doc.getString("string");
int num = doc.getInteger("number");  // 返回 Integer
double d = doc.getDouble("double");
Date date = doc.getDate("date");
ObjectId oid = doc.getObjectId("objectId");
List&lt;Integer&gt; list = doc.getList("list", Integer.class);
Document nested = doc.get("nested", Document.class);
```

---

## Decimal128：金融计算的首选

MySQL 的 DECIMAL 和 Java 的 BigDecimal 一样，都支持高精度小数。

但 MongoDB 默认的 Double 有精度问题：

```java
// ❌ Double 有精度问题
Document doc = new Document("amount", 0.1 + 0.2);
System.out.println(doc.getDouble("amount"));  // 0.30000000000000004

// ✅ Decimal128 精确
Document doc = new Document("amount", new Decimal128("0.1"));
// 加法需要用聚合管道，这里只是示例
```

**什么时候用 Decimal128？**
- 货币金额（钱不能算错）
- 科学计算（需要高精度）
- 统计数据（累加误差不可接受）

---

## 日期与时区处理

BSON 的 Date 是 UTC 毫秒时间戳，存储和读取要注意时区：

```java
// 创建 UTC 时间
Date now = new Date();  // 当前时间，默认是系统时区

// 设置为 UTC
Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
Date utcNow = utc.getTime();

// 存储到 MongoDB
Document doc = new Document("createdAt", utcNow);

// 读取后转换时区
Date stored = doc.getDate("createdAt");
SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
sdf.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
System.out.println(sdf.format(stored));
```

**注意**：MongoDB Shell 显示的日期是本地时区，但存储的是 UTC。

---

## 二进制数据存储

图片、文件等二进制数据用 `BinData` 存储：

```java
import org.bson.types.Binary;

// 存储二进制
byte[] imageBytes = Files.readAllBytes(Paths.get("photo.jpg"));
Document doc = new Document()
    .append("filename", "photo.jpg")
    .append("data", new Binary(imageBytes))
    .append("contentType", "image/jpeg");

collection.insertOne(doc);

// 读取二进制
Document saved = collection.find(eq("filename", "photo.jpg")).first();
Binary binary = saved.get("data", Binary.class);
byte[] bytes = binary.getData();
```

**限制**：单个 BinData 最大 16MB，更大的文件用 GridFS。

---

## 总结

BSON 是 MongoDB 的核心，了解它能帮你：

1. 选择合适的数据类型（比如 Decimal128 for 金融场景）
2. 理解 ObjectId 的生成规则和优势
3. 正确处理时区和二进制数据

记住：**JSON 是给人看的，BSON 是给机器用的**。

---

## 面试追问方向

- ObjectId 和 UUID 有什么区别？各自适用什么场景？
- MongoDB 存储 16MB 的文件，怎么处理？
- BSON 的 Date 是如何存储的？为什么会有时区问题？
