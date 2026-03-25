# 字符串常量池与 intern()

你知道吗，运行这段代码：

```java
String s1 = "Hello";
String s2 = "Hello";
System.out.println(s1 == s2);  // true
```

两个变量指向同一个对象。这就是**字符串常量池**的功劳。

## 字符串常量池的位置

### JDK 7 之前：永久代

JDK 7 之前，字符串常量池位于**永久代**（Method Area）：

```
┌─────────────────────────────────────┐
│             JVM 内存结构             │
│  ┌──────────┐                      │
│  │  堆内存   │  new String() 创建 │
│  └──────────┘                      │
│  ┌──────────┐                      │
│  │  永久代   │  字符串常量池（JDK 7前）│
│  └──────────┘                      │
└─────────────────────────────────────┘
```

### JDK 7：移到堆

JDK 7 将字符串常量池从永久代**移到了堆**：

```
┌─────────────────────────────────────┐
│             JVM 堆内存               │
│  ┌──────────┐  ┌──────────────┐   │
│  │ new 对象  │  │ 字符串常量池  │   │
│  └──────────┘  └──────────────┘   │
└─────────────────────────────────────┘
```

为什么要移动？因为永久代空间有限，容易 OutOfMemoryError，而堆空间更大更灵活。

### JDK 8：彻底移除永久代

JDK 8 用**元空间（Metaspace）**替代了永久代，字符串常量池继续留在堆中。

## String.intern() 的工作原理

`intern()` 方法的作用是：把字符串放入常量池，并返回池中的引用。

### JDK 7+ 的 intern() 行为

```java
String s1 = new String("abc");
String s2 = s1.intern();

System.out.println(s1 == s2);  // false
// s1 在堆中，s2 在常量池中
```

```java
String s3 = "abc";  // 字面量，直接从常量池获取
String s4 = s3.intern();

System.out.println(s3 == s4);  // true
// 都是常量池中的同一个引用
```

### intern() 的核心逻辑（JDK 7+）

1. 如果常量池中已经存在等于此 String 对象的字符串，返回常量池中的引用
2. 如果不存在，把此 String 对象的引用复制到常量池，返回常量池中的引用

```java
// intern() 执行过程
String s1 = new String("hello");
String s2 = s1.intern();

// intern() 发现常量池中没有 "hello"，于是把 s1 的引用复制到常量池
// 返回常量池中的引用给 s2
// 现在 s1 和 s2 都指向同一个对象（在常量池中）

String s3 = "hello";  // 直接从常量池获取
System.out.println(s2 == s3);  // true
```

## new String("abc") 创建了几个对象？

**这个问题是面试常客。**

```java
String s = new String("abc");
```

答案是：**1 个或 2 个**。

### 分解过程

```java
// "abc" 字面量 → 可能在常量池中创建一个 String 对象
// new String("abc") → 在堆中再创建一个 String 对象
```

具体分析：

```java
// 假设常量池中没有 "abc"
String s = new String("abc");

// 执行步骤：
// 1. 先在常量池中创建 "abc" 对象（字符串字面量）
// 2. 再在堆中创建 new String("abc") 对象
// 总共：2 个对象
```

```java
// 假设常量池中已经有 "abc"
String s = new String("abc");

// 执行步骤：
// 1. 从常量池直接引用已有的 "abc"，不再创建
// 2. 只在堆中创建 new String("abc") 对象
// 总共：1 个对象
```

## intern() 的使用场景

### 场景一：减少重复字符串的内存占用

```java
// 大量重复的字符串
String[] inputs = {"apple", "apple", "banana", "apple"};

// 如果不 intern，每个字符串都是独立对象
// 通过 intern()，相同的字符串共享同一个引用
Set&lt;String&gt; unique = new HashSet&lt;&gt;();
for (String input : inputs) {
    unique.add(input.intern());
}
```

### 场景二：字符串比较优化

```java
String s1 = new String("test");
String s2 = new String("test");

// 不用 intern：== 比较永远 false
System.out.println(s1 == s2);  // false

// 用 intern：== 比较变成可能
String s1Intern = s1.intern();
String s2Intern = s2.intern();
System.out.println(s1Intern == s2Intern);  // true
```

但注意：`intern()` 需要在常量池中查找和存储，如果字符串太多，会占用大量堆内存。

### 场景三：处理用户输入

```java
// 从网络/文件读取的大量字符串
public void process(String input) {
    // 输入可能包含大量重复的字符串
    String normalized = input.intern();

    if (normalized == "SUCCESS") {
        // ...
    }
}
```

## intern() 的陷阱

### 陷阱一：过度使用导致 OOM

```java
// 危险代码！
String largeData = readFromFile();  // 假设是 100MB 的文本
for (String line : largeData.split("\n")) {
    line.intern();  // 把所有行都放入常量池
}
// 常量池被撑爆
```

常量池虽然移到了堆，但空间也不是无限的。

### 陷阱二：JDK 6 和 JDK 7 行为不同

```java
// JDK 6 的 intern() 行为
String s = new String("abc");
s.intern();
String s2 = "abc";
System.out.println(s == s2);  // false（JDK 6：intern() 把字符串复制到常量池）

// JDK 7+ 的 intern() 行为
String s3 = new String("abc");
s3.intern();
String s4 = "abc";
System.out.println(s3 == s4);  // false（常量池中的引用 != 堆中的引用）
```

真正让 s == s2 变成 true 的是字面量顺序：

```java
String s1 = new String("abc");
String s2 = "abc";  // 字面量在 new 之后定义
System.out.println(s1 == s2);  // false

// 调换顺序试试？
String s3 = "abc";  // 字面量先定义
String s4 = new String("abc");
System.out.println(s3 == s4);  // false（常量池 != 堆）
```

### 陷阱三：常量池大小有限制

```java
// 大量不同字符串会导致常量池膨胀
for (int i = 0; i < 1000000; i++) {
    String s = "string_" + i;
    s.intern();  // 一百万个不同的字符串进入常量池
}
```

## 最佳实践

```java
// 推荐：直接使用字面量
String s1 = "Hello";
String s2 = "Hello";

// 避免：不必要的 new
String s3 = new String("Hello");  // 总是创建新对象

// 需要 intern 时
String userInput = getUserInput();
String normalized = userInput.intern();  // 只在必要时使用

// 如果重复使用率高，可以考虑 intern
if (shouldNormalize(userInput)) {
    normalized = userInput.intern();
}
```

## 留给你的思考题

```java
String s1 = new String("a") + new String("b");
s1.intern();
String s2 = "ab";
System.out.println(s1 == s2);  // 在 JDK 7+ 输出什么？
```

**提示**：考虑 JIT 编译优化和常量折叠的影响。`new String("a") + new String("b")` 在编译时不会直接变成 `"ab"` 字面量。

---

**面试追问方向：**

1. 字符串常量池在 JDK 6、7、8 中分别在哪里？为什么移动？
2. `String s = new String("abc")` 到底创建了几个对象？
3. `intern()` 适用于什么场景？有什么副作用？
4. 字符串常量池是如何判断两个字符串相等的？
5. String 的 `==` 和 `equals()` 有什么区别？
