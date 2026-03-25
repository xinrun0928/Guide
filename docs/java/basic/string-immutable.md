# String 不可变性与实现原理

你知道吗？

```java
String s1 = "Hello";
String s2 = "Hello";
String s3 = new String("Hello");

System.out.println(s1 == s2);  // true
System.out.println(s1 == s3);  // false
System.out.println(s1.equals(s3));  // true
```

这个结果背后，隐藏着 Java 对 String 不可变性的精心设计。

## String 真的不可变吗？

先看源码（JDK 8）：

```java
public final class String
    implements java.io.Serializable, Comparable&lt;String&gt;, CharSequence {
    // String 类是 final 的——不能被继承

    private final char value[];  // final 数组，引用不可变
    private final int offset;
    private final int count;

    // 存储字符串的 char 数组是 private final
    // 没有提供 setter 方法修改这个数组
}
```

String 的不可变体现在三个层面：

1. **类声明 `final`**：String 不能被继承，防止子类破坏其行为
2. **`char[] value` 是 `final`**：数组引用不可变
3. **没有 `setValue()` 方法**：外部无法修改内部数组

## 为什么 String 要设计成不可变的？

### 1. 字符串常量池的实现基础

如果 String 是可变的，那字符串池中的字符串被修改后，会影响所有引用它的地方：

```java
String s1 = "Java";   // 字符串池中创建 "Java"
String s2 = "Java";   // 直接复用 s1 的引用
System.out.println(s1 == s2);  // true

// 如果 String 可变：
s2.concat(" is great");  // 返回新字符串，不修改 s2
System.out.println(s1);  // 仍然是 "Java"（因为 concat 不改变原字符串）
```

正是因为 String 不可变，字符串池才能安全地共享字符串实例。

### 2. 线程安全

不可变对象天然线程安全——多个线程可以同时访问同一个 String，无需同步：

```java
// 线程 A
String shared = "Hello";

// 线程 B
System.out.println(shared.length());  // 绝对安全，不需要锁

// 线程 C
String modified = shared.toUpperCase();  // 返回新字符串，shared 不变
```

### 3. 安全性

```java
// 假设 String 是可变的：
void process(String username) {
    // 验证 username
    if (username.equals("admin")) {
        // ...
    }
    // 恶意用户可能在验证后修改字符串
    username.append("hacked");  // 如果 String 可变，这会成功
}
```

不可变的 String 保证了参数在传递过程中不会被篡改。

### 4. 哈希缓存

String 的 `hashCode()` 可以被缓存：

```java
public int hashCode() {
    int h = hash;  // 缓存字段
    if (h == 0 && value.length > 0) {
        // 计算一次后缓存，以后直接返回
        h = computeHash();
    }
    return h;
}
```

如果 String 可变，`hashCode()` 就不能缓存，因为每次都可能是不同值。

## String 的内部结构

### JDK 8：char[]

```java
private final char value[];
```

每个字符占 2 字节（UTF-16）。一个英文字符占 2 字节（实际只需 1 字节），造成内存浪费。

### JDK 9+：byte[] + coder

```java
private final byte[] value;
private final byte coder;  // LATIN1(0) 或 UTF16(1)
```

根据字符串内容选择编码：
- 纯 Latin-1 字符：1 字节/字符（节省 50% 空间）
- 含其他字符：2 字节/字符

这叫 **Compact Strings**（紧凑字符串），通过 `-XX:+CompactStrings` 控制（JDK 9 默认开启）。

```java
// 验证 String 的内部结构
String ascii = "Hello";      // Latin-1，coder=0
String chinese = "你好";     // UTF-16，coder=1

// JDK 9+ 的 unsafe API 可以查看（仅演示，不要在实际代码中使用）
Class&lt;?&gt; stringClass = String.class;
Field valueField = stringClass.getDeclaredField("value");
valueField.setAccessible(true);
byte[] value = (byte[]) valueField.get(ascii);
System.out.println(value.length);  // 5 字节（Latin-1）
```

## 不可变性带来的一些「陷阱」

### 1. 字符串拼接的效率问题

```java
String result = "";
for (int i = 0; i < 1000; i++) {
    result += i;  // 每次都创建新对象，产生 1000 个中间 String
}
```

正确的做法是用 `StringBuilder`：

```java
StringBuilder sb = new StringBuilder();
for (int i = 0; i < 1000; i++) {
    sb.append(i);
}
String result = sb.toString();
```

### 2. 修改 List&lt;String&gt; 中的元素

```java
List&lt;String&gt; list = new ArrayList&lt;&gt;();
list.add("a");
list.add("b");

// 获取元素，修改（不影响 list）
String s = list.get(0);
s = "c";  // 只是改变了局部变量 s 的引用

System.out.println(list.get(0));  // 仍然是 "a"

list.set(0, "c");  // 直接修改 list
System.out.println(list.get(0));  // "c"
```

### 3. 反射可以修改 String（但别这么做）

```java
String s = "Hello";
// 反射可以绕过不可变性的保护（强烈不推荐！）
Field valueField = String.class.getDeclaredField("value");
valueField.setAccessible(true);
char[] value = (char[]) valueField.get(s);
value[0] = 'X';

System.out.println(s);  // "Xello"
System.out.println("Hello");  // 字符串常量池也被影响了！灾难！
```

这说明 String 的不可变性的确可以被破坏——但这是未定义行为，不要在生产代码中使用。

## String 的常用操作

```java
String s = "Hello, World!";

// 长度
s.length();  // 13

// 截取（返回新字符串）
s.substring(0, 5);  // "Hello"

// 查找
s.indexOf("World");  // 7
s.contains("World");  // true

// 替换（返回新字符串，原字符串不变）
s.replace("World", "Java");  // "Hello, Java!"

// 分割
"a,b,c".split(",");  // ["a", "b", "c"]

// 大小写
s.toUpperCase();  // "HELLO, WORLD!"
s.toLowerCase();  // "hello, world!"

// 去除首尾空白
"  hi  ".trim();       // "hi"（JDK 11 之前）
"  hi  ".strip();      // "hi"（JDK 11+，支持 Unicode）
```

## 留给你的思考题

```java
String s1 = new String("abc");
String s2 = new String("abc");

System.out.println(s1 == s2);  // false
System.out.println(s1.intern() == s2.intern());  // true?
```

`intern()` 方法做了什么？为什么上面的结果是 `true`？

**提示**：字符串常量池的位置在 JDK 7 前后发生了变化，这对 `intern()` 的行为有什么影响？

---

**面试追问方向：**

1. String 为什么被设计成 final？能不能通过继承来「修改」它？
2. String 的不可变性和字符串常量池是什么关系？
3. String s = new String("abc") 创建了几个对象？
4. JDK 9 为什么把 char[] 改成了 byte[]？Compact Strings 是什么？
5. String、StringBuilder、StringBuffer 有什么区别？什么时候用哪个？
