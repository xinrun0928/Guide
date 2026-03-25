# Sealed Class 密封类

你有没有遇到过这种情况：

```java
public class Shape {
    // 子类可以随意扩展
}

public class Circle extends Shape { }
public class Rectangle extends Shape { }
public class Triangle extends Shape { }
public class Hexagon extends Shape { }
public class Pentagon extends Shape { }
public class MyCustomShape extends Shape { }  // 你不希望这个存在
```

Shape 的设计者希望只有特定的几何图形，不希望随意扩展。

JDK 17 的 sealed class 就是来解决这个问题的。

---

## Sealed Class 是什么？

### 基本定义

```java
// 使用 sealed 修饰，permits 列出所有允许的子类
public sealed class Shape permits Circle, Rectangle, Triangle { }

// Circle 必须是 final、sealed 或 non-sealed
public final class Circle extends Shape { }
public sealed class Rectangle extends Shape permits ColoredRectangle { }
public non-sealed class Triangle extends Shape { }
```

**子类的修饰符规则**：

| 修饰符 | 说明 | 能否继续被继承 |
|-------|------|---------------|
| `final` | 不能被继承 | 不能 |
| `sealed` | 只能被 permits 列表中的类继承 | 可以，但受限 |
| `non-sealed` | 可以被任意继承 | 可以 |

### 为什么需要这些修饰符？

```java
// Shape 的 permits 是：Circle, Rectangle, Triangle

// final：最严格，不能再继承
public final class Circle extends Shape { }
// Circle 不能被继承

// sealed：可以继承，但要明确列出
public sealed class Rectangle extends Shape permits ColoredRectangle { }
// Rectangle 只能被 ColoredRectangle 继承

// non-sealed：不限制
public non-sealed class Triangle extends Shape { }
// Triangle 可以被任意类继承
```

---

## 使用场景

### 场景一：有限状态机

```java
public sealed interface State permits Pending, Processing, Success, Failed {
    boolean isTerminal();
}

// 所有状态都明确列出
public final class Pending implements State {
    @Override
    public boolean isTerminal() { return false; }
}

public final class Processing implements State {
    @Override
    public boolean isTerminal() { return false; }
}

public final class Success implements State {
    @Override
    public boolean isTerminal() { return true; }
}

public final class Failed implements State {
    @Override
    public boolean isTerminal() { return true; }
}
```

### 场景二：计算几何

```java
public sealed interface Shape permits Circle, Rectangle, Triangle {
    double area();
    double perimeter();
}

public record Circle(double radius) implements Shape {
    @Override
    public double area() { return Math.PI * radius * radius; }
    @Override
    public double perimeter() { return 2 * Math.PI * radius; }
}

public record Rectangle(double width, double height) implements Shape {
    @Override
    public double area() { return width * height; }
    @Override
    public double perimeter() { return 2 * (width + height); }
}

public record Triangle(double a, double b, double c) implements Shape {
    @Override
    public double area() {
        double s = (a + b + c) / 2;
        return Math.sqrt(s * (s - a) * (s - b) * (s - c));
    }
    @Override
    public double perimeter() { return a + b + c; }
}
```

### 场景三：解析结果

```java
public sealed interface ParseResult permits Success, Error, PartialSuccess {
    T getValue() throws Exception;
}

public record Success&lt;T&gt;(T value) implements ParseResult {
    @Override
    public T getValue() { return value; }
}

public record Error&lt;T&gt;(Exception cause) implements ParseResult {
    @Override
    public T getValue() throws Exception {
        throw cause;
    }
}

public record PartialSuccess&lt;T&gt;(T value, List&lt;String&gt; warnings) implements ParseResult {
    @Override
    public T getValue() { return value; }
}
```

---

## 与 Pattern Matching 结合

这是 sealed class 最强大的用法。

### 穷尽性检查

```java
double calculateArea(Shape shape) {
    return switch (shape) {
        case Circle c -> c.area();
        case Rectangle r -> r.area();
        case Triangle t -> t.area();
        // 编译器检查：是否所有子类都被处理？
        // 如果 Shape 有新的子类但忘记处理，编译错误
    };
}
```

### 编译器的帮助

假设 Shape 原来有 3 个子类，你写了穷尽的 switch。

后来有人添加了第 4 个子类 `Hexagon`：

```java
public final class Hexagon extends Shape { }
```

**编译错误**：

```
error: switch statement is not exhaustive
found: Hexagon
missing: Hexagon
```

编译器会强制你处理所有情况。

### 完整示例：JSON 序列化

```java
public sealed interface JsonValue permits JsonObject, JsonArray, JsonString, JsonNumber, JsonNull {
    default String toJson() {
        return switch (this) {
            case JsonNull() -> "null";
            case JsonString(String s) -> "\"" + s + "\"";
            case JsonNumber(Number n) -> n.toString();
            case JsonArray(List&lt;JsonValue&gt; list) -> {
                StringJoiner joiner = new StringJoiner(", ", "[", "]");
                for (JsonValue v : list) {
                    joiner.add(v.toJson());
                }
                yield joiner.toString();
            }
            case JsonObject(Map&lt;String, JsonValue&gt; map) -> {
                StringJoiner joiner = new StringJoiner(", ", "{", "}");
                for (var entry : map.entrySet()) {
                    joiner.add("\"" + entry.getKey() + "\": " + entry.getValue().toJson());
                }
                yield joiner.toString();
            }
        };
    }
}
```

---

## Sealed Interface

接口同样可以用 sealed 修饰：

```java
// sealed interface
public sealed interface Command permits StartCommand, StopCommand, ResetCommand {
    void execute();
}

public final class StartCommand implements Command {
    @Override
    public void execute() { /* ... */ }
}

public final class StopCommand implements Command {
    @Override
    public void execute() { /* ... */ }
}

public final class ResetCommand implements Command {
    @Override
    public void execute() { /* ... */ }
}
```

### 接口的实现规则

| 子类修饰符 | 能实现的接口 |
|-----------|------------|
| `final` | 只能实现 sealed interface |
| `sealed` | 只能实现 sealed interface |
| `non-sealed` | 可以实现 sealed interface |

---

## 隐藏类（Hidden Class）

JDK 16 引入了隐藏类，但不能成为 sealed class 的子类。

```java
// 隐藏类
class HiddenClass {
    // ...
}

// 这个不能被 sealed class permits
```

---

## 与枚举的区别

### 枚举

```java
public enum Color {
    RED, GREEN, BLUE;

    // 枚举是 sealed 的，但子类是 final 的单例
}
```

| 特性 | Sealed Class | Enum |
|-----|--------------|------|
| 子类数量 | 固定，但可以扩展 | 固定，不可扩展 |
| 子类类型 | 类或记录 | 必须是枚举常量 |
| 状态 | 可以有实例字段 | 通常无状态 |
| 实现 | 可以实现接口 | 可以实现接口 |
| switch | 需要穷尽检查 | 默认穷尽 |

### 什么时候用哪个？

```java
// 用枚举：当状态是固定的、简单的单例
public enum Status {
    PENDING, APPROVED, REJECTED
}

// 用 sealed class：当状态可能扩展，或者需要复杂状态
public sealed interface Result permits Success, Failure {
    // 可以有复杂的状态
}

public final class Success implements Result {
    private final Object data;
    private final Timestamp timestamp;
    // ...
}
```

---

## 实际应用场景

### 1. API 设计

```java
// API 定义方
public sealed interface Response permits SuccessResponse, ErrorResponse {
    int statusCode();
}

// API 实现方
public final class SuccessResponse implements Response { }
public final class ErrorResponse implements Response { }

// API 使用方
Response resp = api.call();
return switch (resp) {
    case SuccessResponse s -> handleSuccess(s);
    case ErrorResponse e -> handleError(e);
};
```

### 2. 插件系统

```java
public sealed interface Plugin permits ImagePlugin, AudioPlugin, VideoPlugin {
    String name();
    void initialize(Context context);
}

// 框架内置插件
public final class ImagePlugin implements Plugin { }
public final class AudioPlugin implements Plugin { }
public final class VideoPlugin implements Plugin { }

// 第三方插件
public final class CustomPlugin implements Plugin { }  // 错误：不在 permits 中
```

### 3. 解析器

```java
public sealed interface Expr permits NumberExpr, AddExpr, MulExpr, VarExpr {
    &lt;R&gt; R accept(ExprVisitor&lt;R&gt; visitor);
}

public interface ExprVisitor&lt;R&gt; {
    R visit(NumberExpr expr);
    R visit(AddExpr expr);
    R visit(MulExpr expr);
    R visit(VarExpr expr);
}
```

---

## 与反射的配合

```java
public sealed class Shape permits Circle, Rectangle { }

// 获取所有子类
public static List&lt;Class&lt;? extends Shape&gt;&gt; getSubclasses() {
    return Arrays.stream(Shape.class.getPermittedSubclasses())
        .map(Class::cast)
        .collect(Collectors.toList());
}

// 在反序列化时使用
public static Shape deserialize(String type, Object data) {
    return switch (type) {
        case "circle" -> new Circle((Double) data);
        case "rectangle" -> new Rectangle((Double) data, ((Double) data) * 2);
        default -> throw new IllegalArgumentException("Unknown type: " + type);
    };
}
```

---

## 最佳实践

### 1. 放在同一文件或同一模块

```java
// 方式一：同一个文件（简单情况）
public sealed class Shape permits Circle, Rectangle, Triangle {
    public record Circle(double radius) implements Shape { }
    public record Rectangle(double w, double h) implements Shape { }
    public record Triangle(double a, double b, double c) implements Shape { }
}

// 方式二：同一模块（推荐复杂情况）
// module-info.java
module com.example.shapes {
    exports com.example.shapes;
}
```

### 2. 优先使用 record

```java
// 推荐
public sealed interface Shape permits Circle, Rectangle {
    record Circle(double radius) implements Shape { }
    record Rectangle(double w, double h) implements Shape { }
}

// 如果子类有复杂逻辑，用 class
public sealed interface Command permits StartCommand, StopCommand {
    final class StartCommand implements Command {
        @Override
        public void execute() { /* 复杂逻辑 */ }
    }
}
```

### 3. 谨慎使用 non-sealed

```java
// 只有当确实需要开放扩展时，才使用 non-sealed
public sealed interface Event permits ClickEvent, KeyEvent {
    // 大部分事件是固定的
}

public non-sealed interface CustomEvent extends Event {
    // 但允许第三方定义自定义事件
}
```

---

## 面试追问方向

### 追问一：sealed class 和 abstract class 有什么区别？

| 特性 | Sealed Class | Abstract Class |
|-----|--------------|----------------|
| 子类限制 | 必须在 permits 列表 | 任意子类 |
| 编译检查 | 强制穷尽检查 | 无 |
| 子类修饰符 | 必须 final/sealed/non-sealed | 无限制 |
| 目的 | 限制扩展 | 定义抽象行为 |

### 追问二：sealed class 是怎么实现的？

编译器和 JVM 协作：

1. **编译时**：检查 permits 列表的完整性
2. **Class 文件**：`ACC_SEALED` 和 `PermittedSubclasses` 属性
3. **运行时**：JVM 验证子类的合法性

```java
// 编译后的 Shape.class 包含
public final class Shape {
    // ACC_SEALED = 0x1000
    // PermittedSubclasses = [Circle, Rectangle]
}
```

### 追问三：sealed class 适合什么场景？

**适合**：
- 有限状态机
- 解析结果
- API 响应类型
- 领域模型的有限分支

**不适合**：
- 开放世界的类（如 `Object` 不能是 sealed）
- 需要任意扩展的框架
- 插件系统（除非明确限制）

### 追问四：sealed class 和模式匹配有什么关系？

sealed class + switch = **编译器保证的穷尽性**

```java
sealed interface Result permits Success, Failure {}

double calculate(Response resp) {
    return switch (resp) {
        case Success s -> s.value();
        case Failure f -> f.errorCode();
        // 如果忘记处理某个类型，编译错误
    };
}
```

这是 TypeScript 的 `never` 类型和 Rust 的 `match` 的类似设计。

---

## 留给你的思考题

我们讲了 sealed class。

但有一个问题：

**sealed class 限制了子类的扩展，这是好事还是坏事？**

考虑：

1. **可扩展性**：你的代码需要被继承吗？
2. **维护性**：新增子类时，sealed class 的穷尽检查是帮助还是麻烦？
3. **框架集成**：Jackson、Gson 等能正确处理 sealed class 吗？
4. **第三方扩展**：如果有人想扩展你的 sealed class，你能接受吗？

> 提示：sealed class 是「关闭的」，适合稳定的 API；open class 是「开放的」，适合需要扩展的框架。
>
> 没有绝对的好坏，只有适合不适合。
