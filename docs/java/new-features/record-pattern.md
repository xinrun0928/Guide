# Record 类型与模式匹配

你还在写这样的类吗？

```java
public class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public int x() { return x; }
    public int y() { return y; }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }

    @Override
    public int hashCode() {
        return Objects.hash(x, y);
    }

    @Override
    public String toString() {
        return "Point{x=" + x + ", y=" + y + "}";
    }
}
```

JDK 14 之后，一行代码搞定。

---

## Record 是什么？

### 定义

**Record** 是 JDK 14 引入的特殊类，用于表示「不可变数据载体」。

```java
// 一行顶 50 行
public record Point(int x, int y) { }
```

编译器自动生成：
- 私有 final 字段：`x`、`y`
- 构造方法
- getter 方法（名为 `x()`、`y()`，不是 `getX()`）
- `equals()`、`hashCode()`、`toString()`

### 使用示例

```java
// 创建
Point p = new Point(3, 4);

// 访问（getter 方法名就是字段名）
int x = p.x();
int y = p.y();

// toString
System.out.println(p);
// Point[x=3, y=4]

// equals
Point p1 = new Point(1, 2);
Point p2 = new Point(1, 2);
System.out.println(p1.equals(p2));  // true
```

### Record vs 普通类

| 特性 | 普通类 | Record |
|-----|-------|--------|
| 字段 | 需手动定义 | 自动生成 |
| 构造 | 需手动定义 | 自动生成 |
| getter | `getX()` | `x()` |
| equals | 需手动实现 | 自动生成 |
| hashCode | 需手动实现 | 自动生成 |
| toString | 需手动实现 | 自动生成 |
| 可变性 | 可变 | **不可变** |
| 可继承 | 可继承其他类 | 可实现接口 |

---

## Record 的细节

### 构造函数

默认构造函数接收所有字段：

```java
public record Point(int x, int y) {
    // 编译器生成：public Point(int x, int y)
}

// 使用
Point p = new Point(1, 2);
```

可以自定义紧凑构造函数（不常用）：

```java
public record Point(int x, int y) {
    // 紧凑构造函数：参数列表为空，字段赋值由编译器完成
    public Point {
        // 可以在赋值前做验证
        if (x &lt; 0 || y &lt; 0) {
            throw new IllegalArgumentException("Coordinates must be non-negative");
        }
    }
}
```

### 静态成员

```java
public record Point(int x, int y) {
    // 静态字段
    public static Point ORIGIN = new Point(0, 0);

    // 静态方法
    public static Point of(int x, int y) {
        return new Point(x, y);
    }

    // 实例方法
    public double distanceFromOrigin() {
        return Math.sqrt(x * x + y * y);
    }
}

// 使用
Point origin = Point.ORIGIN;
Point p = Point.of(3, 4);
double dist = p.distanceFromOrigin();
```

### 实现接口

```java
public record Point(int x, int y) implements Shape {
    @Override
    public double area() {
        return x * y;  // 矩形的面积
    }
}

public interface Shape {
    double area();
}
```

### 不能做的事

```java
public record Point(int x, int y) {
    // 错误：Record 不能扩展其他类
    // extends SomeClass

    // 错误：不能添加实例字段
    // private int z;

    // 错误：不能修改现有字段
    // public void setX(int x) { this.x = x; }
}
```

**Record 天生是不可变的**。

---

## Pattern Matching for instanceof

JDK 16 正式引入 `instanceof` 的模式匹配。

### 传统写法

```java
// JDK 16 之前
if (obj instanceof String) {
    // 需要强制类型转换
    String s = (String) obj;
    if (s.length() > 5) {  // 使用
        // ...
    }
}
```

### 模式匹配写法

```java
// JDK 16+
if (obj instanceof String s) {
    // s 直接可用，无需转换
    if (s.length() > 5) {
        // ...
    }
}
```

### 作用域规则

```java
// 重要：变量 s 只在条件为 true 时生效
if (!(obj instanceof String s)) {
    // 这里不能用 s
    return;
}
// 这里可以用 s
System.out.println(s.length());
```

### 结合逻辑运算

```java
// && 运算符
if (obj instanceof String s && s.length() > 5) {
    // s 在这里可用
}

// || 运算符
if (!(obj instanceof String s) || s.length() &lt; 5) {
    // obj 不是 String 或 s.length() &lt; 5
}
```

---

## Record Pattern（重点）

JDK 21 正式引入 Record Pattern，可以**解构** Record 的组件。

### 基本用法

```java
// 传统写法
Object obj = new Point(3, 4);
if (obj instanceof Point) {
    Point p = (Point) obj;  // 需要手动转换
    int x = p.x();
    int y = p.y();
    System.out.println(x + ", " + y);
}

// Record Pattern
if (obj instanceof Point(int x, int y)) {
    // x, y 直接可用，自动解构
    System.out.println(x + ", " + y);
}
```

### 嵌套 Record Pattern

```java
public record City(String name, Point coordinates) {}
public record Point(int x, int y) {}

// 解构嵌套的 Record
Object city = new City("Beijing", new Point(39, 116));

if (city instanceof City(String name, Point(int x, int y))) {
    System.out.println(name + ": " + x + ", " + y);
}
```

### 在 switch 中使用

```java
String describe(Object obj) {
    return switch (obj) {
        case null -> "null";
        case Point(int x, int y) when x == 0 && y == 0 -> "Origin";
        case Point(int x, int y) when x == y -> "On diagonal";
        case Point(int x, int y) -> "Point(" + x + ", " + y + ")";
        case String s -> "String: " + s;
        case int[] arr -> "Array of length " + arr.length;
        default -> "Something else";
    };
}
```

### 数组解构

```java
int[] arr = {1, 2, 3};

// 传统
if (arr instanceof int[] a) {
    System.out.println(a.length);
}

// 数组模式
if (arr instanceof int[] {int first, int second, int third}) {
    System.out.println(first + second + third);
}
```

### 类型推断

```java
// 编译器自动推断类型
var p = new Point(3, 4);

// 完整写法
if (p instanceof Point(int x, int y)) { }

// 局部变量声明
if (p instanceof Point(var x, var y)) { }
```

---

## 实际应用场景

### DTO / 数据传输对象

```java
// 传统 DTO
public class UserDTO {
    private final String name;
    private final int age;
    // 50 行代码...

    public String getName() { return name; }
    public int getAge() { return age; }
}

// Record DTO
public record UserDTO(String name, int age) { }
```

### 复合键

```java
public record Pair&lt;K, V&gt;(K key, V value) { }

// 使用
Pair&lt;String, Integer&gt; entry = new Pair&lt;&gt;("score", 100);
String key = entry.key();
Integer value = entry.value();
```

### 方法返回值

```java
// 返回多个值
public record DivisionResult(int quotient, int remainder) { }

public DivisionResult divide(int dividend, int divisor) {
    return new DivisionResult(dividend / divisor, dividend % divisor);
}

// 使用
var result = divide(10, 3);
System.out.println("商=" + result.quotient() + ", 余数=" + result.remainder());
```

### 模式匹配 + 序列化

```java
// JSON 反序列化
ObjectMapper mapper = new ObjectMapper();

JsonNode json = mapper.readTree("{\"x\":3,\"y\":4}");

// 传统
if (json.has("x") && json.has("y")) {
    Point p = new Point(json.get("x").asInt(), json.get("y").asInt());
}

// 使用 Jackson 的 Record 支持
Point p = mapper.readValue("{\"x\":3,\"y\":4}", Point.class);
```

---

## 与 Sealed Class 结合

Record 可以和密封类结合，实现强大的类型系统：

```java
public sealed interface Shape permits Circle, Rectangle {
    double area();
}

public record Circle(double radius) implements Shape {
    @Override
    public double area() { return Math.PI * radius * radius; }
}

public record Rectangle(double width, double height) implements Shape {
    @Override
    public double area() { return width * height; }
}

// 穷尽检查
double totalArea(Shape[] shapes) {
    double sum = 0;
    for (Shape s : shapes) {
        sum += switch (s) {
            case Circle(double r) -> Math.PI * r * r;
            case Rectangle(double w, double h) -> w * h;
            // 编译器保证穷尽
        };
    }
    return sum;
}
```

---

## 性能考虑

### 内存

```java
public record Point(int x, int y) { }

// 创建 100 万个 Point
// 每个 Point 的内存：对象头 + 2个int = 24 字节
// 总计：24MB
```

### equals / hashCode

Record 自动生成的 `equals()` 和 `hashCode()`：
- 比较所有字段
- 递归处理嵌套 Record
- 性能与手写相当

### 不变性

Record 的不可变性带来：
- **线程安全**：天然线程安全，无需同步
- **可预测性**：状态不会变化，更容易推理
- **缓存友好**：可以安全地放入 HashMap/HashSet

---

## 面试追问方向

### 追问一：Record 和 Lombok 的 @Data 有什么区别？

| 特性 | Record | @Data |
|-----|--------|------|
| 不可变性 | 天生不可变 | 需要手动设置 |
| 构造函数 | 自动生成 | 生成全参 + 无参 |
| getter 命名 | `x()` | `getX()` |
| equals/hashCode | 自动生成 | 自动生成 |
| 需要编译时注解 | 否 | 是 |
| 可扩展 | 受限 | 可以继承 |

### 追问二：什么时候用 Record，什么时候用普通类？

**用 Record**：
- 数据载体，不包含业务逻辑
- 需要 equals/hashCode/toString
- 需要不可变性
- DTO、返回值、复合键

**用普通类**：
- 包含业务逻辑
- 需要可变状态
- 需要继承
- 需要复杂的构造函数逻辑

### 追问三：Record 可以被继承吗？

Record 不能被继承，但可以实现接口：

```java
// 错误：Record 不能被继承
public record ColoredPoint(int x, int y, Color c) extends Point(x, y) { }

// 正确：Record 可以实现接口
public record ColoredPoint(int x, int y, Color c) implements Colored { }
```

### 追问四：Record Pattern 和 Deconstruction 有什么区别？

Record Pattern 就是 Record 的解构（Deconstruction）：

```java
Point p = new Point(3, 4);

// 解构：提取组件
int x = p.x();
int y = p.y();

// Record Pattern：模式匹配 + 解构
if (p instanceof Point(int a, int b)) {
    // a = 3, b = 4
}
```

---

## 留给你的思考题

我们讲了 Record 和 Record Pattern。

但有一个问题：

**Record 的不可变性是绝对的，还是有办法突破？**

```java
public record MutableWrapper&lt;T&gt;(T value) {
    // 这里有个陷阱
}
```

如果 T 是一个引用类型，比如 List，Record 能保护 List 本身不被修改吗？

```java
MutableWrapper&lt;List&lt;String&gt;&gt; wrapper = new MutableWrapper&lt;&gt;(new ArrayList&lt;&gt;());
wrapper.value().add("hello");  // 这能成功吗？

// Record 保护的是「引用」，不是「引用指向的对象」
```

> 提示：考虑防御性拷贝、深不可变性等问题。
