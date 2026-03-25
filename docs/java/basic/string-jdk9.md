# JDK 8 vs JDK 9+ String 实现差异

一个简单的字符串 "Hello"，在 JDK 8 和 JDK 9 中，占用的内存竟然不同。

这是 Java 对字符串存储的一次重大优化。

## JDK 8：char[] 实现

```java
public final class String
    implements java.io.Serializable, Comparable&lt;String&gt;, CharSequence {

    private final char value[];  // UTF-16 编码
}
```

每个字符占 2 字节（UTF-16）。无论内容是什么，都用 2 字节存储。

```
"Hello" = 5 个字符 = 10 字节
"你好" = 2 个字符 = 4 字节
```

## JDK 9+：byte[] + coder 实现

```java
public final class String
    implements java.io.Serializable, Comparable&lt;String&gt;, CharSequence {

    private final byte[] value;  // 根据内容选择编码
    private final byte coder;     // 编码器：LATIN1(0) 或 UTF16(1)
}
```

### 编码器（coder）的选择

```java
// Compact Strings 核心逻辑
// LATIN1：1 字节/字符
// UTF16：2 字节/字符

String ascii = "Hello";   // 全部是 Latin1 字符 → coder = LATIN1
String chinese = "你好";  // 包含非 Latin1 字符 → coder = UTF16
String mixed = "Hello你好";  // 混合 → coder = UTF16
```

### 如何判断使用哪种编码？

```java
// StringConcatHelper 中的逻辑
static String newString(byte[] bytes, int coder) {
    return new String(bytes, coder, ISO_8859_1);  // LATIN1
}

static boolean isLatin1(String str) {
    return str.coder == LATIN1;  // coder 字段判断
}
```

## 内存节省效果

| 字符串 | JDK 8 (char[]) | JDK 9+ (byte[]) | 节省 |
|-------|---------------|----------------|-----|
| "Hello" | 10 字节 | 5 字节 | 50% |
| "Java" | 8 字节 | 4 字节 | 50% |
| "你好" | 4 字节 | 4 字节 | 0% |
| "Hello World" | 22 字节 | 11 字节 | 50% |

**结论**：纯英文/数字字符串，内存占用减半！

## Compact Strings 功能控制

```bash
# 开启 Compact Strings（JDK 9+ 默认开启）
-XX:+CompactStrings

# 关闭 Compact Strings（全部使用 UTF-16）
-XX:-CompactStrings
```

## 对代码的影响

### 1. 内部 API 变化

```java
// JDK 8：访问 char[]
char[] chars = string.value;

// JDK 9+：访问 byte[]
byte[] bytes = string.value;
byte coder = string.coder;
```

如果代码使用反射访问 `String.value` 字段，可能需要调整：

```java
public class StringUtils {
    public static void printStringInfo(String s) {
        try {
            Field valueField = String.class.getDeclaredField("value");
            valueField.setAccessible(true);
            Object value = valueField.get(s);

            if (value instanceof char[]) {
                System.out.println("JDK 8 style: " + ((char[]) value).length + " chars");
            } else if (value instanceof byte[]) {
                System.out.println("JDK 9+ style: " + ((byte[]) value).length + " bytes");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

### 2. 字符串操作 API 的变化

```java
String s = "Hello";

// JDK 8：charAt 返回 char
char c = s.charAt(0);

// JDK 9+：charAt 仍然返回 char，但内部处理不同
char c2 = s.charAt(0);
```

虽然 API 没变，但底层实现已经优化。

### 3. 编码相关 API

```java
// getBytes() 行为可能不同
String s = "Hello";
byte[] bytes1 = s.getBytes(StandardCharsets.UTF_8);  // 不受影响
byte[] bytes2 = s.getBytes(StandardCharsets.ISO_8859_1);  // 可能有差异
```

## StringCoding 内部类

JDK 9+ 新增了 `StringCoding` 内部类来处理编码：

```java
final class StringCoding {
    // 根据 coder 选择对应的字节数组
    static String newString(byte[] bytes, int off, int len, Charset charset) {
        // LATIN1 时：1 byte = 1 char
        // UTF16 时：2 bytes = 1 char
    }

    // 编码检测：自动选择最省内存的编码
    static Result encode(byte[] coder, char[] value) {
        if (isASCII(value)) {
            // 纯 ASCII → LATIN1
            return encodeLatin1(value);
        } else {
            // 含其他字符 → UTF16
            return encodeUTF16(value);
        }
    }
}
```

## 性能影响

### 内存优化

```java
// 假设有 100 万个平均长度 20 的英文字符串
// JDK 8：100万 × 20 × 2 = 40 MB
// JDK 9+：100万 × 20 × 1 = 20 MB

// 节省：20 MB（50%）
```

### GC 压力降低

字符串是 GC 的主要对象之一。字符串内存减半，意味着：
- 堆内存压力降低
- GC 频率可能降低
- 应用整体吞吐量提升

### CPU 开销

增加了编码检测的开销：
- 检测字符串是否全是 ASCII/Latin1
- 如果是，用更紧凑的编码
- 但这个开销很小，收益远大于成本

## 兼容性

### 源代码层面：完全兼容

```java
String s = "Hello";  // 无论 JDK 8 还是 JDK 9+，代码一样
```

### 二进制层面：不兼容

- JDK 8 编译的 class 文件中的字符串常量
- 在 JDK 9+ 运行
- 需要 StringConstantPool 等机制处理

### 反射层面：可能不兼容

```java
// JDK 8
Field f = String.class.getDeclaredField("value");
// f.getType() == char[].class

// JDK 9+
// f.getType() == byte[].class
```

如果代码中有这样的反射，需要适配。

## 留给你的思考题

```java
// 两种写法，创建的 String 一样吗？
String s1 = "Hello";
String s2 = new String(new char[]{'H', 'e', 'l', 'l', 'o'});

// 哪种在 JDK 8 和 JDK 9+ 的内存占用不同？
```

**提示**：考虑字符串常量池和 new String 的区别。字面量 "Hello" 一定会进入常量池，但通过 char[] 数组创建的 String 有不同的路径。

---

**面试追问方向：**

1. 为什么 JDK 9 要把 char[] 改成 byte[]？
2. Compact Strings 是怎么判断使用 LATIN1 还是 UTF16 的？
3. String 的 hashCode 在 JDK 9 之后有变化吗？
4. StringCoding 类在 JDK 9 中起什么作用？
5. `-XX:+CompactStrings` 参数在什么场景下可以关闭？
