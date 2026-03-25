# Java 新特性演进：JDK 8 到 JDK 21

---

2014 年 3 月，Java 8 发布。这是 Java 历史上变化最大的版本之一。

lambda 表达式、Stream API、Optional、新的日期 API……这些新特性彻底改变了 Java 的编程风格。

从那以后，Java 进入了一个快速迭代的时代。JDK 9、JDK 10、JDK 11……每隔六个月就有新版本，每个版本都有值得关注的新特性。

本篇文章，带你梳理 JDK 8 到 JDK 21 的核心变化。

## JDK 8（2014）：现代 Java 的起点

这是 Java 史上最重要的版本，没有之一。

### Lambda 表达式

```java
// 之前
new Thread(new Runnable() {
    @Override
    public void run() {
        System.out.println("Hello");
    }
}).start();

// 之后
new Thread(() -> System.out.println("Hello")).start();

// 方法引用
List&lt;String&gt; names = Arrays.asList("张三", "李四", "王五");
names.stream()
     .map(String::toUpperCase) // 方法引用
     .forEach(System.out::println);
```

### Stream API

```java
List&lt;User&gt; users = getUsers();

// 之前：命令式编程
List&lt;String&gt; names = new ArrayList&lt;&gt;();
for (User user : users) {
    if (user.getAge() &gt; 18) {
        names.add(user.getName().toUpperCase());
    }
}

// 之后：声明式编程
List&lt;String&gt; names = users.stream()
    .filter(u -&gt; u.getAge() &gt; 18)
    .map(User::getName)
    .map(String::toUpperCase)
    .collect(Collectors.toList());
```

### Optional

```java
// 之前：NullPointerException 高发区
String city = user.getAddress().getCity().getName();

// 之后
String city = Optional.ofNullable(user)
    .map(User::getAddress)
    .map(Address::getCity)
    .map(City::getName)
    .orElse("未知");
```

### 新的日期 API

```java
// 之前：Date 既可变又难用
Date date = new Date();
SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");

// 之后：不可变，线程安全
LocalDate today = LocalDate.now();
LocalDateTime now = LocalDateTime.now();
LocalDateTime dateTime = LocalDateTime.of(2024, 3, 25, 10, 30, 0);
String formatted = dateTime.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));

// 计算日期
LocalDate nextWeek = today.plusWeeks(1);
LocalDate lastMonth = today.minusMonths(1);
```

### 接口 default 方法

```java
public interface Logger {
    void log(String message);

    // default 方法：接口可以有默认实现
    default void logInfo(String message) {
        log("[INFO] " + message);
    }

    default void logError(String message) {
        log("[ERROR] " + message);
    }
}
```

### 并行数组

```java
int[] array = new int[10_000_000];
Arrays.parallelSort(array);
Arrays.parallelPrefix(array, (a, b) -&gt; a + b);
```

## JDK 9（2017）：模块化时代

### 模块化系统（Jigsaw）

```java
// module-info.java
module com.example.app {
    requires com.example.library;
    exports com.example.api;

    opens com.example.internal to com.example.tool; // 反射访问
}
```

### 集合工厂方法

```java
// 之前
List&lt;String&gt; list = new ArrayList&lt;&gt;();
list.add("a");
list.add("b");
list.add("c");

// 之后
List&lt;String&gt; list = List.of("a", "b", "c");
Set&lt;Integer&gt; set = Set.of(1, 2, 3);
Map&lt;String, Integer&gt; map = Map.of("a", 1, "b", 2);
```

**注意**：这些集合是**不可变**的。

### Stream 增强

```java
// takeWhile: 满足条件时取元素，一旦不满足就停止
List.of(1, 2, 3, 4, 1, 2)
    .stream()
    .takeWhile(n -&gt; n &lt; 3) // [1, 2]
    .toList();

// dropWhile: 跳过满足条件的元素，一旦不满足就取后面的
List.of(1, 2, 3, 4, 1, 2)
    .stream()
    .dropWhile(n -&gt; n &lt; 3) // [3, 4, 1, 2]
    .toList();

// ofNullable: 避免 NPE
Stream.ofNullable(null)
      .forEach(System.out::println); // 不抛 NPE
```

### var 局部变量推断

```java
// 之前：必须声明类型
String name = "张三";
ArrayList&lt;String&gt; list = new ArrayList&lt;&gt;();

// 之后：编译器推断类型
var name = "张三";
var list = new ArrayList&lt;String&gt;();
```

**注意**：`var` 只用于局部变量，不能用于字段、方法参数、返回值。

### HTTP Client（Incubator）

```java
// JDK 9-10: 孵化阶段
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com"))
    .build();
HttpResponse&lt;String&gt; response = client.send(request,
    HttpResponse.BodyHandlers.ofString());
```

## JDK 10（2018）：var 正式登场

### 局部变量类型推断增强

`var` 从 JDK 10 开始正式可用。

### 集合 copyOf

```java
List&lt;String&gt; immutableList = List.copyOf(originalList);
Set&lt;Integer&gt; immutableSet = Set.copyOf(originalSet);
Map&lt;String, Integer&gt; immutableMap = Map.copyOf(originalMap);
```

## JDK 11 LTS（2018）：长期支持版本

### HTTP Client 正式版

JDK 9-10 的 HTTP Client 从孵化器升级为正式 API。

### 字符串增强

```java
// 判断是否为空或空白
"".isBlank(); // true
"  ".isBlank(); // true
"\t\n".isBlank(); // true

// 去首尾空白
"  hello  ".strip(); // "hello"
"  hello  ".stripLeading(); // "hello  "
"  hello  ".stripTrailing(); // "  hello"

// 行数
"line1\nline2\nline3".lines().count(); // 3

// 重复
"ab".repeat(3); // "ababab"
```

### Files 增强

```java
// 读写字符串
String content = Files.readString(Path.of("file.txt"));
Files.writeString(Path.of("file.txt"), "content");
```

### 移除 Java EE 和 CORBA 模块

`java.xml.ws`、`javax.xml.bind` 等模块被移除（需要单独添加依赖）。

## JDK 12~16（2019~2021）：快速迭代

### Switch 表达式（Preview → Final）

```java
// 之前
int dayOfWeek;
switch (day) {
    case MONDAY:
    case FRIDAY:
    case SUNDAY:
        dayOfWeek = 6;
        break;
    case TUESDAY:
        dayOfWeek = 7;
        break;
    // ...
}

// 之后
int dayOfWeek = switch (day) {
    case MONDAY, FRIDAY, SUNDAY -&gt; 6;
    case TUESDAY -&gt; 7;
    case THURSDAY, SATURDAY -&gt; 8;
    case WEDNESDAY -&gt; 9;
    default -&gt; 0;
};
```

### Records（Preview → Final in 16）

```java
// 之前：写一堆 getter/setter/equals/hashCode/toString
public class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public int x() { return x; }
    public int y() { return y; }
    // ... equals, hashCode, toString
}

// 之后：一行搞定
public record Point(int x, int y) { }
```

### Sealed Classes（Preview → Final in 17）

```java
// 限制类的继承层次
public sealed class Shape permits Circle, Rectangle, Square { }

// Circle, Rectangle, Square 必须声明为:
// - final：不能被继承
// - sealed：允许被继承但有限制
// - non-sealed：允许被任意继承
public final class Circle extends Shape { }
public sealed class Rectangle extends Shape permits Square { }
public non-sealed class Square extends Rectangle { }
```

### 文本块（Preview → Final in 15）

```java
// 之前：转义字符噩梦
String json = "{\n" +
              "  \"name\": \"张三\",\n" +
              "  \"age\": 18\n" +
              "}";

// 之后：所见即所得
String json = """
              {
                  "name": "张三",
                  "age": 18
              }
              """;
```

### instanceof 模式匹配（Preview → Final in 16）

```java
// 之前
if (obj instanceof String) {
    String s = (String) obj;
    System.out.println(s.length());
}

// 之后：一步到位
if (obj instanceof String s) {
    System.out.println(s.length()); // s 已转型
}
```

## JDK 17 LTS（2021）：长期支持版本

### Sealed Classes 正式版

Sealed Classes 从预览版变为正式版。

### Pattern Matching for switch（Preview）

```java
static String formatter(Object obj) {
    return switch (obj) {
        case Integer i when i &gt; 0 -&gt; "正整数: " + i;
        case Integer i                 -&gt; "其他整数: " + i;
        case String s                  -&gt; "字符串: " + s;
        case null, default             -&gt; "其他";
    };
}
```

### Foreign Function API（Incubator）

```java
// 调用 C 语言函数
MemorySegment segment = MemorySegment.allocateNative(100);
```

## JDK 18~20（2022~2023）

### UTF-8 默认编码

从 JDK 18 开始，UTF-8 成为默认字符集。

### Foreign Function & Memory API（Evolution）

```java
// 继续演进的外部函数接口
try (Arena arena = Arena.openConfined()) {
    MemorySegment segment = arena.allocate(100);
    // ...
}
```

### Virtual Thread（Preview → Final in 21）

```java
// 之前：线程是重量级的
ExecutorService executor = Executors.newFixedThreadPool(100);
executor.submit(() -&gt; {
    // 每个任务一个线程，线程数量受限
});

// 之后：虚拟线程，轻量级
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
executor.submit(() -&gt; {
    // 百万级虚拟线程成为可能
});
```

### Record Pattern（Preview → Final in 21）

```java
// Record + instanceof + Pattern Matching
record Point(int x, int y) {}

void printSum(Object obj) {
    if (obj instanceof Point(int x, int y)) {
        System.out.println(x + y);
    }
}
```

## JDK 21 LTS（2023）：集大成者

### Virtual Thread 正式版

```java
// 创建虚拟线程
Thread vt = Thread.ofVirtual().start(() -&gt; {
    System.out.println("Running in virtual thread");
});

// 虚拟线程工厂
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
```

### Sequenced Collections

```java
// 新增接口：有序且有确定顺序的集合
interface SequencedCollection&lt;E&gt; extends Collection&lt;E&gt; {
    E getFirst();
    E getLast();
    void addFirst(E);
    void addLast(E);
    SequencedCollection&lt;E&gt; reversed();
}

// List 和 Deque 已实现
List&lt;String&gt; list = new ArrayList&lt;&gt;();
list.addFirst("first");
list.addLast("last");
String first = list.getFirst();
```

### Pattern Matching for switch 正式版

```java
static String formatterPatternMatching(Object obj) {
    return switch (obj) {
        case null     -&gt; "null";
        case String s -&gt; "字符串: " + s;
        case int[] a  -&gt; "int数组，长度: " + a.length;
        default       -&gt; "其他";
    };
}
```

### String Templates（Preview）

```java
// 预览特性
String name = "张三";
int age = 25;

// 模板表达式
String message = STR."你好，\{name}！你今年 \{age} 岁了。";
// "你好，张三！你今年 25 岁了。"

// 支持多行
String html = STR."""
    &lt;html&gt;
        &lt;body&gt;
            &lt;p&gt;Hello, \{name}!&lt;/p&gt;
        &lt;/body&gt;
    &lt;/html&gt;
    """;
```

### unnamed Patterns and Variables (Preview)

```java
// 用 _ 表示不关心的值
switch (shape) {
    case Circle(_, _)            -&gt; "圆形";
    case Rectangle(_, _)        -&gt; "矩形";
    default                     -&gt; "其他图形";
}

// 忽略 lambda 参数
list.stream()
    .filter(Car::isElectric)
    .forEach((_, price) -&gt; System.out.println("价格: " + price));
```

## 版本选择建议

| 场景 | 推荐版本 | 理由 |
|---|---|---|
| 新项目 | JDK 21 LTS | 最新 LTS，功能最全 |
| 迁移项目 | JDK 17 LTS | 成熟稳定，大量生产验证 |
| 保守项目 | JDK 11 LTS | 经典 LTS，企业首选 |
| 学习 | JDK 21 | 包含所有新特性 |

## 面试追问方向

- Java 8 的 Stream 和 Java 9+ 的 Stream 有什么区别？
- Virtual Thread 和普通线程有什么区别？适用于什么场景？
- Sealed Classes 解决了什么问题？
- Records 和普通类的区别是什么？

## 留给你的思考题

假设你正在开发一个新项目，技术选型时面临以下选择：

1. 继续用 JDK 8（保守）
2. 升级到 JDK 11 LTS（稳妥）
3. 升级到 JDK 17 LTS（平衡）
4. 升级到 JDK 21 LTS（激进）

请分析每个选择的：

1. **优势**：能获得哪些新特性？
2. **风险**：可能遇到哪些兼容性问题？
3. **成本**：升级需要做哪些工作？

结合你们团队的技术栈和项目特点，你会选择哪个版本？为什么？
