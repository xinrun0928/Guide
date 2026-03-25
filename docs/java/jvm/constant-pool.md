# 运行时常量池与字符串常量池

"abc" 和 new String("abc") 有什么区别？

这个问题困扰了很多 Java 开发者。要回答这个问题，你需要理解运行时常量池和字符串常量池的区别。

---

## 一、class 文件中的常量池

每个 class 文件都有一个**常量池表（Constant Pool Table）**，用于存储：

- **字面量**：字符串字面量、final 常量值
- **符号引用**：类/接口的全限定名、字段名和描述符、方法名和描述符

```
Class 文件结构
┌─────────────────────────────────────┐
│ Magic Number                        │
├─────────────────────────────────────┤
│ Version                             │
├─────────────────────────────────────┤
│ 常量池 (Constant Pool)               │
│  - 字面量：1, "abc", 3.14           │
│  - 符号引用：com.example.User        │
├─────────────────────────────────────┤
│ 类信息、字段表、方法表               │
├─────────────────────────────────────┤
│ ...                                 │
└─────────────────────────────────────┘
```

这些常量在编译时确定，它们是 class 文件的一部分。

---

## 二、运行时常量池

运行时常量池（Runtime Constant Pool）是**方法区的一部分**（JDK 8 之前在 PermGen，JDK 8 在 Metaspace）。

当 class 文件被加载时，class 文件常量池中的内容会被加载到运行时常量池中。

运行时常量池相对于 class 文件常量池的一个重要区别是：
- **class 文件常量池**：静态的，编译时确定
- **运行时常量池**：动态的，运行期间也可以添加新的常量（如 String.intern()）

### 2.1 符号引用到直接引用

class 文件中使用的是**符号引用**（Symbolic Reference），在运行时需要解析为**直接引用**（Direct Reference）：

```java
public class User {
    public String name;
    public void sayHello() { }
}
```

编译后，`sayHello` 方法只是一个符号引用（如"sayHello:()V"）。类加载时，这个符号引用会被解析为指向方法区的直接引用。

### 2.2 String.intern()

`String.intern()` 是运行时常量池的一个重要操作。

它的作用是：将字符串添加到常量池，并返回常量池中的字符串引用。

```java
String s1 = new String("abc");
String s2 = "abc";
String s3 = s1.intern();  // 返回常量池中的字符串引用

System.out.println(s2 == s3);  // true（JDK 6/7/8 结果相同）
System.out.println(s1 == s2);  // false（s1 在堆，s2 在常量池）
```

---

## 三、字符串常量池

字符串常量池（String Pool）是**专门用于存储字符串实例**的区域。

但它的位置经历了变迁：JDK 6 在 PermGen，JDK 7/8 移到了堆中。

### 3.1 位置变迁

```
JDK 6：
┌───────────────────────────────────────┐
│  JVM 堆                               │
│  ┌─────────────┐  ┌───────────────┐ │
│  │   PermGen   │  │   其他堆区域   │ │
│  │  ┌────────┐ │  └───────────────┘ │
│  │  │字符串常量池│ │                 │
│  │  └────────┘ │                   │
│  └─────────────┘                   │
└───────────────────────────────────────┘

JDK 7/8：
┌───────────────────────────────────────┐
│  JVM 堆                               │
│  ┌─────────────┐  ┌───────────────┐ │
│  │   字符串常量池│  │   其他堆区域   │ │
│  │  (String Pool)│  └───────────────┘ │
│  └─────────────┘                     │
│  ┌───────────────────────────────────┐│
│  │  Metaspace（本地内存）            ││
│  │  - 类元数据                        ││
│  └───────────────────────────────────┘│
└───────────────────────────────────────┘
```

为什么要把字符串常量池从 PermGen 移到堆？

1. **PermGen 容易 OOM**：大量字符串会填满 PermGen
2. **GC 复杂**：PermGen 的 GC 效率低
3. **更合理的内存管理**：字符串是运行时产生的，应该在堆中管理

### 3.2 String.intern() 的 JDK 版本差异

| 版本 | 常量池位置 | intern() 行为 |
|-----|----------|--------------|
| JDK 6 | PermGen | 把字符串复制到 PermGen 常量池 |
| JDK 7 | 堆 | 把字符串引用放到堆中的常量池（不复制） |
| JDK 8 | 堆 | 同 JDK 7 |

**JDK 6 示例**：

```java
String s1 = new String("abc");
String s2 = s1.intern();
String s3 = "abc";

System.out.println(s1 == s2);  // false（s1 在堆，s2 在 PermGen）
System.out.println(s2 == s3);  // true
```

**JDK 7/8 示例**：

```java
String s1 = new String("abc");
String s2 = s1.intern();
String s3 = "abc";

System.out.println(s1 == s2);  // false
System.out.println(s2 == s3);  // true（相同引用）
```

---

## 四、intern() 的实际应用

### 4.1 节省内存

```java
String s1 = "hello";
String s2 = "hello";
// s1 和 s2 指向同一个常量池对象，节省内存
System.out.println(s1 == s2);  // true
```

### 4.2 大量重复字符串场景

```java
// 如果需要存储大量相同字符串
String[] arr = new String[100000];
for (int i = 0; i < 100000; i++) {
    arr[i] = "common_string".intern();
}
```

### 4.3 模拟数据库连接池

```java
public class ConnectionPool {
    private static final String POOL_PREFIX = "connection_pool_";

    public static String getConnection(String name) {
        return (POOL_PREFIX + name).intern();
    }
}
```

---

## 五、运行时常量池的溢出

运行时常量池属于方法区，受方法区大小限制（JDK 7 及之前是 PermGen，JDK 8 是 Metaspace）。

```java
// 模拟常量池溢出（JDK 7 及之前 PermGen OOM）
public class ConstantPoolOOM {
    public static void main(String[] args) {
        List<String> list = new ArrayList<>();
        int i = 0;
        while (true) {
            list.add(String.valueOf(i++).intern());
        }
    }
}
```

**JDK 8 中**，由于 Metaspace 使用本地内存且可以动态扩展，类似的代码不太容易导致 Metaspace 溢出——除非创建了太多不同的类。

---

## 六、面试高频问题

### 问题 1：运行时常量池和字符串常量池的区别？

| | 运行时常量池 | 字符串常量池 |
|--|------------|-------------|
| 存储内容 | 各种字面量 + 符号引用 | 仅字符串实例 |
| 位置（JDK 7+） | Metaspace | 堆 |
| 内容来源 | class 文件 + 运行时 | 字符串字面量 + String.intern() |

### 问题 2：String s = new String("abc") 创建了几个对象？

最多创建两个：
- 如果"abc"已经在字符串常量池中，只创建 1 个（堆中的对象）
- 如果"abc"不在常量池中，创建 2 个（1 个在堆，1 个在常量池）

```java
String s = new String("abc");
// "abc" 字面量在编译时生成，先检查常量池
// 如果不存在，在常量池创建一个
// new String() 再在堆创建一个
```

### 问题 3：intern() 有什么作用？

把字符串放入常量池，返回池中的引用。在大量使用相同字符串的场景下，可以节省内存。

### 问题 4：为什么 JDK 7 要把字符串常量池移到堆？

主要原因是 PermGen 太小，容易 OOM。字符串是运行时大量产生的，放在堆中更合理，可以充分利用堆的 GC 机制。

---

## 留给你的问题

我们讲了运行时常量池和字符串常量池的区别，以及 intern() 的用法。

你有没有想过：**String s1 = new String("abc") 和 String s2 = "abc" 到底有什么区别？**

表面上看，s1 和 s2 都是 String 类型。但 s1 在堆中创建了一个对象，而 s2 直接引用字符串常量池中的对象。

这就引出了一个性能问题：**如果你的代码中有大量这样的字符串比较操作，使用 intern() 可以提升比较效率吗？**

答案是肯定的。因为 `==` 比较的是引用，而 `equals()` 需要逐字符比较。如果所有相同字符串都指向同一个引用（常量池中的对象），`==` 就可以直接判断相等性，跳过 `equals()` 的遍历。

但这也不是银弹——过度使用 intern() 会占用常量池空间，反而可能引发 Metaspace OOM（JDK 8）。
