# StringBuilder vs StringBuffer vs String

写一个拼接 10000 次的循环，你会怎么写？

```java
// 方式一：String 拼接（灾难）
String s = "";
for (int i = 0; i < 10000; i++) {
    s += i;  // 每次都创建新对象
}

// 方式二：StringBuilder（正确）
StringBuilder sb = new StringBuilder();
for (int i = 0; i < 10000; i++) {
    sb.append(i);
}
String result = sb.toString();
```

方式一会创建 10000 个 String 对象，方式二只创建几个——这就是选择正确字符串工具的意义。

## String 的不可变性问题

String 不可变，所以每次「修改」都会创建新对象：

```java
String s = "Hello";
s.concat(" World");  // 返回新字符串
System.out.println(s);  // 仍然是 "Hello"
```

如果这样拼接：

```java
String result = "";
for (int i = 0; i < 10; i++) {
    result = result + i;
}
```

每次循环都会：
1. 创建一个新的 StringBuilder
2. 执行 append
3. 调用 toString() 转成 String

性能灾难。

## StringBuilder：非线程安全，高性能

```java
StringBuilder sb = new StringBuilder();

// 追加
sb.append("Hello");
sb.append(" ");
sb.append("World");

// 插入
sb.insert(0, "Start: ");

// 删除
sb.delete(0, 6);  // 删除 [0, 6)

// 反转
sb.reverse();

// 转为 String
String result = sb.toString();
```

### StringBuilder 的内部结构

```java
// StringBuilder 源码（JDK 8）
public final class StringBuilder
    extends AbstractStringBuilder
    implements java.io.Serializable, CharSequence {

    char[] value;  // 继承自 AbstractStringBuilder
    int count;      // 已使用的字符数

    public StringBuilder() {
        super(16);  // 默认容量 16
    }

    public StringBuilder(int capacity) {
        super(capacity);
    }

    public StringBuilder(String str) {
        super(str.length() + 16);  // 字符串长度 + 16
        append(str);
    }
}
```

### append() 的扩容机制

```java
// AbstractStringBuilder.ensureCapacityInternal()
private void ensureCapacityInternal(int minimumCapacity) {
    if (minimumCapacity - value.length > 0) {
        expandCapacity(minimumCapacity);
    }
}

void expandCapacity(int minimumCapacity) {
    // 新容量 = 旧容量 * 2 + 2
    int newCapacity = (value.length + 1) * 2;

    if (minimumCapacity - newCapacity > 0) {
        newCapacity = minimumCapacity;
    }

    value = Arrays.copyOf(value, newCapacity);  // 数组拷贝
}
```

扩容公式：`newCapacity = oldCapacity * 2 + 2`

```
初始容量 16 → 34 → 70 → 142 → ...
```

### 最佳实践：预分配容量

如果知道大概长度，提前分配可以避免多次扩容：

```java
// 不预分配：可能扩容多次
StringBuilder sb1 = new StringBuilder();
for (String s : largeList) {
    sb1.append(s);
}

// 预分配：一次到位
StringBuilder sb2 = new StringBuilder(expectedSize);
for (String s : largeList) {
    sb2.append(s);
}
```

怎么估算？`list.size() * averageLength`。

## StringBuffer：线程安全的版本

```java
StringBuffer sb = new StringBuffer();

synchronized(lock) {
    sb.append("Hello");
    sb.append(" World");
}
```

`StringBuffer` 的所有方法都加了 `synchronized`，所以**线程安全**。

### StringBuilder vs StringBuffer

| 特性 | StringBuilder | StringBuffer |
|-----|--------------|--------------|
| 线程安全 | 否 | 是 |
| 性能 | 高 | 较低（有同步开销）|
| 使用场景 | 单线程环境 | 多线程环境 |

**大部分情况下用 StringBuilder**，除非真的需要多线程共享同一个实例。

## String 的使用场景

String 不可变，适合以下场景：

```java
// 1. 字符串不会变化的地方
String VERSION = "1.0.0";  // 常量

// 2. 需要作为 HashMap/HashSet 的 key
Map&lt;String, User&gt; userMap = new HashMap&lt;&gt;();
userMap.put("Alice", user);

// 3. 多线程共享的字符串（天然线程安全）
public class Service {
    private String name;  // 不可变，线程安全
}
```

## 性能对比

```java
// 测试类
public class StringPerformanceTest {
    public static void main(String[] args) {
        int times = 100000;

        // String 拼接
        long start = System.currentTimeMillis();
        String s = "";
        for (int i = 0; i < times; i++) {
            s += "a";
        }
        System.out.println("String: " + (System.currentTimeMillis() - start) + "ms");

        // StringBuilder
        start = System.currentTimeMillis();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < times; i++) {
            sb.append("a");
        }
        sb.toString();
        System.out.println("StringBuilder: " + (System.currentTimeMillis() - start) + "ms");

        // StringBuffer
        start = System.currentTimeMillis();
        StringBuffer sbf = new StringBuffer();
        for (int i = 0; i < times; i++) {
            sbf.append("a");
        }
        sbf.toString();
        System.out.println("StringBuffer: " + (System.currentTimeMillis() - start) + "ms");
    }
}
```

典型结果（100000 次拼接）：
- String: ~5000ms
- StringBuilder: ~5ms
- StringBuffer: ~10ms

String 慢了 1000 倍。

## 常见误区

### 误区一：在循环中用 String 拼接

```java
// 错误
String result = "";
for (String item : items) {
    result += item + ",";  // 每次都创建新对象
}

// 正确
StringBuilder sb = new StringBuilder();
for (String item : items) {
    sb.append(item).append(",");
}
String result = sb.toString();
```

### 误区二：过度担心线程安全

```java
// 错误：以为 StringBuffer 更"好"，所以处处用它
StringBuffer sb = new StringBuffer();
sb.append(request.getParam1());
sb.append(request.getParam2());
// ... 大量字符串操作

// 大多数情况下 StringBuilder 足够
StringBuilder sb = new StringBuilder();
```

### 误区三：不预分配容量

```java
// 差的做法
StringBuilder sb = new StringBuilder();
for (String s : veryLargeList) {
    sb.append(s);
}

// 好的做法
StringBuilder sb = new StringBuilder(estimatedSize);
for (String s : veryLargeList) {
    sb.append(s);
}
```

## 留给你的思考题

```java
StringBuilder sb = new StringBuilder("abc");
String s1 = sb.toString();
String s2 = sb.toString();
System.out.println(s1 == s2);  // 输出什么？
```

**提示**：`toString()` 每次都返回新 String 对象。考虑为什么 StringBuilder 的 `toString()` 要这样设计？

---

**面试追问方向：**

1. StringBuilder 的扩容机制是什么？扩容因子是多少？
2. StringBuilder 和 StringBuffer 的区别是什么？
3. String 的 `+` 运算符在编译后是什么样的？
4. StringBuilder 在 JDK 9 之后有优化吗？使用了什么编码？
5. 如何优化 StringBuilder 的性能？
