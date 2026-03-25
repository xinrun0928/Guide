# Integer 缓存池与 IntegerCache

你知道吗：

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b);  // true

Integer c = 128;
Integer d = 128;
System.out.println(c == d);  // false
```

这背后的原因，是 **IntegerCache**。

## IntegerCache 的实现

```java
private static class IntegerCache {
    static final int low = -128;        // 缓存起始值
    static final int high;              // 缓存结束值（默认 127）
    static final Integer cache[];       // 缓存数组

    static {
        // 缓存上界默认 127，可通过 -XX:AutoBoxCacheMax 调整
        int h = 127;
        String sizeProperty = sun.misc.VM.getSavedProperty("java.lang.Integer.IntegerCache.high");
        if (sizeProperty != null) {
            h = Math.min(Integer.parseInt(sizeProperty), Integer.MAX_VALUE);
        }
        high = h;

        // 创建缓存数组：-128 到 high
        int size = high - low + 1;
        cache = new Integer[size];
        int offset = low;  // -128
        for (int i = 0; i < size; i++) {
            cache[i] = new Integer(i + offset);  // 创建 Integer 对象
        }
    }

    private IntegerCache() {}
}
```

**核心逻辑**：在类加载时，预先创建 `-128` 到 `127`（默认）的 Integer 对象，放入数组缓存。

## valueOf() 的调用路径

```java
public static Integer valueOf(int i) {
    if (i >= IntegerCache.low && i <= IntegerCache.high)
        return IntegerCache.cache[i + (-IntegerCache.low)];
    return new Integer(i);
}
```

```java
Integer i = 127;  // 自动装箱 → Integer.valueOf(127) → 命中缓存
Integer j = 128;  // 自动装箱 → Integer.valueOf(128) → 创建新对象
```

## 所有包装类的缓存

| 包装类 | 缓存范围 | 缓存值 |
|-------|---------|--------|
| `Boolean` | 全部 | `TRUE`, `FALSE` |
| `Byte` | 全部 | `-128 ~ 127` |
| `Short` | 部分 | `-128 ~ 127` |
| `Integer` | 部分 | `-128 ~ 127`（可调）|
| `Long` | 部分 | `-128 ~ 127` |
| `Float` | 无 | 无 |
| `Double` | 无 | 无 |
| `Character` | 部分 | `0 ~ 127` |

### Boolean

```java
public static Boolean valueOf(boolean b) {
    return b ? Boolean.TRUE : Boolean.FALSE;
}

// TRUE 和 FALSE 是静态常量
public static final Boolean TRUE = new Boolean(true);
public static final Boolean FALSE = new Boolean(false);
```

### Byte

```java
// Byte 完全缓存：只有 256 个值
private static class ByteCache {
    private ByteCache() {}
    static final Byte cache[] = new Byte[-(-128) + 127 + 1];
    static {
        for (int i = 0; i < cache.length; i++)
            cache[i] = new Byte((byte)(i - 128));
    }
}
```

### Character

```java
// 缓存 0~127（ASCII 字符）
private static class CharacterCache {
    static final Character cache[] = new Character[127 + 1];
    static {
        for (int i = 0; i < cache.length; i++)
            cache[i] = new Character((char)(i));
    }
}
```

### Short 和 Long

和 Integer 一样，默认缓存 `-128 ~ 127`：

```java
private static class ShortCache {
    private ShortCache() {}
    static final Short cache[] = new Short[-128 + 127 + 1];
    static {
        for (int i = 0; i < cache.length; i++)
            cache[i] = new Short((short)(i - 128));
    }
}
```

## 调整 Integer 缓存范围

```bash
# 设置缓存上界为 1000
java -XX:AutoBoxCacheMax=1000 MyClass

# 之后这段代码会命中缓存
Integer a = 1000;
Integer b = 1000;
System.out.println(a == b);  // true
```

```java
// 在代码中获取缓存上界
int max = Integer.getInteger("java.lang.Integer.IntegerCache.high", 127);
System.out.println("Integer cache range: -128 to " + max);
```

## 为什么只缓存一部分？

### 缓存的代价

每个缓存的 Integer 都是一个对象，需要占用堆内存。

- `-128 ~ 127`：256 个对象，轻量
- `-128 ~ 32767`（所有 Short）：32768 个对象，中等
- 如果缓存所有 int 值：2^32 = 42 亿个对象，不可能

### 收益的考量

缓存的价值在于**常用的小整数**：
- 循环计数器
- 数组索引
- 状态码
- 配置参数

这些场景频繁使用小整数，缓存能显著减少对象创建。

### 设计决策

- `-128 ~ 127` 是语言规范要求的**最小保证**
- 允许通过 JVM 参数扩展
- 大整数不值得缓存（使用频率低）

## 实战：利用缓存优化

### 场景一：枚举值用 Integer

```java
// 定义枚举
public class OrderStatus {
    public static final int PENDING = 1;
    public static final int PAID = 2;
    public static final int SHIPPED = 3;
    public static final int DELIVERED = 4;
}

// 使用：自动装箱命中缓存
OrderStatus status = OrderStatus.PENDING;  // Integer.valueOf(1)
```

### 场景二：HashMap 的 key

```java
Map&lt;Integer, String&gt; map = new HashMap&lt;&gt;();
// key 在 -128~127 范围内，引用相同，比较快
map.put(1, "pending");
map.put(2, "paid");
```

### 场景三：避免在循环中创建新对象

```java
// 不好：每次都创建新对象
for (int i = 0; i < 128; i++) {
    process(i);  // 自动装箱，128 及以下命中缓存
}

// 好：基本类型运算
for (int i = 0; i < 10000; i++) {
    process(i % 128);  // 对 128 取模，结果在缓存范围内
}
```

## 常见面试题

### Q1：为什么 Integer 比较用 == 有时对有时错？

```java
Integer a = 127;  // 缓存
Integer b = 127;  // 缓存
System.out.println(a == b);  // true

Integer c = 128;  // 新对象
Integer d = 128;  // 新对象
System.out.println(c == d);  // false
```

### Q2：new Integer(127) == Integer.valueOf(127) 吗？

```java
Integer a = new Integer(127);  // 永远创建新对象
Integer b = Integer.valueOf(127);  // 优先使用缓存
System.out.println(a == b);  // false
```

### Q3：自动装箱和 valueOf 一样吗？

```java
Integer a = 127;        // 自动装箱 → valueOf(127)
Integer b = valueOf(127);  // 直接调用
System.out.println(a == b);  // true
```

## 留给你的思考题

```java
Integer a = 127;
Integer b = new Integer(127);
Integer c = 127;

System.out.println(a == b);  // ?
System.out.println(a == c);  // ?
System.out.println(b == c);  // ?
System.out.println(127 == a);  // ?
```

**提示**：考虑 `new Integer()` 永远创建新对象，`==` 的自动拆箱，以及基本类型和包装类比较时的类型提升。

---

**面试追问方向：**

1. IntegerCache 的缓存范围是多少？如何调整？
2. 为什么 Boolean、Byte 完全缓存，而其他包装类只部分缓存？
3. 自动装箱和 `new Integer()` 有什么区别？
4. `-XX:AutoBoxCacheMax` 参数有什么作用？
5. 浮点数包装类（Float、Double）为什么不提供缓存？
