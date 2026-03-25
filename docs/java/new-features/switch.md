# Switch 表达式增强

switch 一直是 Java 里「能用但不优雅」的存在。

```java
// JDK 12 之前
int dayOfWeek;
switch (day) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
        dayOfWeek = 1;  // 工作日
        break;
    case 6:
        dayOfWeek = 2;  // 周六
        break;
    case 7:
        dayOfWeek = 3;  // 周日
        break;
    default:
        dayOfWeek = 0;
}
```

JDK 12 引入箭头语法，JDK 13 引入 yield，JDK 17 引入 Pattern Matching for switch……

switch 终于从「能用」变成了「好用」。

---

## Switch 表达式基础

### 箭头语法（JDK 12+）

```java
// 传统 switch
int dayOfWeek;
switch (day) {
    case 1:
        dayOfWeek = 1;
        break;
    case 2:
        dayOfWeek = 1;
        break;
    // ...
}

// 箭头语法
int dayOfWeek = switch (day) {
    case 1 -> 1;
    case 2 -> 1;
    case 3 -> 1;
    case 4 -> 1;
    case 5 -> 1;
    case 6 -> 2;
    case 7 -> 3;
    default -> 0;
};
```

**箭头语法的特点**：
- 不需要 `break`
- 每个分支直接返回值
- 更简洁，不易出错

### 多值合并

```java
// 多个 case 可以合并
int dayOfWeek = switch (day) {
    case 1, 2, 3, 4, 5 -> 1;  // 工作日
    case 6 -> 2;
    case 7 -> 3;
    default -> 0;
};
```

---

## yield 关键字（JDK 13+）

### 问题：复杂逻辑怎么办？

箭头语法适合简单表达式，但复杂逻辑需要代码块：

```java
// 简单情况
case 1 -> 1;

// 复杂情况需要代码块
case 1 -> {
    // 做一些计算
    int result = 0;
    for (int i = 0; i &lt; 10; i++) {
        result += i;
    }
    // 如何返回值？用 yield
    yield result;
}
```

### yield 的作用

```java
int dayType = switch (day) {
    case 1, 2, 3, 4, 5 -> 1;  // 工作日
    case 6, 7 -> {
        // 复杂逻辑：判断是否周末
        boolean isHoliday = checkHoliday(day);
        yield isHoliday ? 2 : 3;  // 节日 or 普通周末
    }
    default -> 0;
};
```

**关键点**：
- `yield` 用于从代码块中返回值
- `break` 在传统 switch 中使用，不能在表达式 switch 中使用

### 对比：break vs yield

```java
// 传统 switch：用 break
switch (day) {
    case 1:
        dayOfWeek = 1;
        break;  // 跳出 switch
    case 2:
        dayOfWeek = 1;
        break;
}

// 表达式 switch：用 yield
int dayOfWeek = switch (day) {
    case 1, 2, 3, 4, 5 -> 1;
    case 6, 7 -> {
        // 复杂逻辑
        yield 2;
    }
    default -> 0;
};
```

---

## Pattern Matching for switch（JDK 17+）

这是 switch 最强大的升级，可以**根据类型和结构匹配**。

### 基本用法

```java
// 传统写法
String describe(Object obj) {
    if (obj instanceof Integer) {
        Integer i = (Integer) obj;
        return "Integer: " + i;
    } else if (obj instanceof String) {
        String s = (String) obj;
        return "String: " + s;
    } else if (obj instanceof Double) {
        Double d = (Double) obj;
        return "Double: " + d;
    } else {
        return "Unknown";
    }
}

// Pattern Matching for switch
String describe(Object obj) {
    return switch (obj) {
        case Integer i -> "Integer: " + i;
        case String s -> "String: " + s;
        case Double d -> "Double: " + d;
        default -> "Unknown";
    };
}
```

### 卫语句（Guard Patterns）

可以用 `when` 添加条件：

```java
String describe(Object obj) {
    return switch (obj) {
        case Integer i when i > 0 -> "Positive integer: " + i;
        case Integer i when i &lt; 0 -> "Negative integer: " + i;
        case Integer i -> "Zero";
        case String s when s.length() > 10 -> "Long string";
        case String s -> "Short string";
        default -> "Unknown";
    };
}
```

### null 的处理

```java
String describe(Object obj) {
    return switch (obj) {
        case null -> "Null value";  // 显式处理 null
        case Integer i -> "Integer: " + i;
        case String s -> "String: " + s;
        default -> "Other";
    };
}
```

**注意**：
- JDK 17 之前，switch 不能接受 null（抛 NPE）
- JDK 17+，可以显式匹配 null

### Record Pattern

结合 Record 使用，解构数据：

```java
public record Point(int x, int y) {}

String describe(Object obj) {
    return switch (obj) {
        case Point(int x, int y) when x == 0 && y == 0 -> "Origin";
        case Point(int x, int y) when x == y -> "On diagonal";
        case Point(int x, int y) -> "Point(" + x + ", " + y + ")";
        case String s -> "String: " + s;
        default -> "Other";
    };
}
```

### 穷尽性检查

编译器确保 switch 覆盖所有情况：

```java
// sealed class + switch = 编译器保证穷尽
public sealed interface Shape permits Circle, Rectangle, Triangle {}

String describe(Shape s) {
    return switch (s) {
        case Circle c -> "Circle with radius " + c.radius();
        case Rectangle r -> "Rectangle " + r.width() + "x" + r.height();
        case Triangle t -> "Triangle with base " + t.base() + " and height " + t.height();
        // 编译器确保所有子类型都被处理
    };
}
```

如果忘记处理某个类型，编译错误：

```java
// 假设新增了 Hexagon
public non-sealed class Hexagon implements Shape {}

// 编译器错误：switch 不覆盖 Hexagon
```

---

## 完整示例

### 计算器

```java
sealed interface Expr permits Number, Add, Subtract, Multiply, Divide {}

record Number(int value) implements Expr {}
record Add(Expr left, Expr right) implements Expr {}
record Subtract(Expr left, Expr right) implements Expr {}
record Multiply(Expr left, Expr right) implements Expr {}
record Divide(Expr left, Expr right) implements Expr {}

int eval(Expr expr) {
    return switch (expr) {
        case Number(int n) -> n;
        case Add(Expr left, Expr right) -> eval(left) + eval(right);
        case Subtract(Expr left, Expr right) -> eval(left) - eval(right);
        case Multiply(Expr left, Expr right) -> eval(left) * eval(right);
        case Divide(Expr left, Expr right) -> eval(left) / eval(right);
    };
}

// 使用
Expr e = new Divide(new Add(new Number(10), new Number(20)), new Number(5));
// (10 + 20) / 5 = 6
System.out.println(eval(e));  // 6
```

### JSON 解析

```java
sealed interface JsonValue permits JsonObject, JsonArray, JsonString, JsonNumber, JsonNull {}

record JsonObject(Map&lt;String, JsonValue&gt; map) implements JsonValue {}
record JsonArray(List&lt;JsonValue&gt; list) implements JsonValue {}
record JsonString(String value) implements JsonValue {}
record JsonNumber(double value) implements JsonValue {}
record JsonNull() implements JsonValue {}

String toPrettyString(JsonValue json, int indent) {
    String pad = "  ".repeat(indent);
    return switch (json) {
        case JsonNull() -> "null";
        case JsonString(String s) -> "\"" + s + "\"";
        case JsonNumber(double d) -> (d == (long) d) ? String.valueOf((long) d) : String.valueOf(d);
        case JsonArray(List&lt;JsonValue&gt; list) -> {
            if (list.isEmpty()) yield "[]";
            StringBuilder sb = new StringBuilder("[\n");
            for (int i = 0; i &lt; list.size(); i++) {
                sb.append(pad).append("  ").append(toPrettyString(list.get(i), indent + 1));
                if (i &lt; list.size() - 1) sb.append(",");
                sb.append("\n");
            }
            sb.append(pad).append("]");
            yield sb.toString();
        }
        case JsonObject(Map&lt;String, JsonValue&gt; map) -> {
            if (map.isEmpty()) yield "{}";
            StringBuilder sb = new StringBuilder("{\n");
            var iter = map.entrySet().iterator();
            while (iter.hasNext()) {
                var entry = iter.next();
                sb.append(pad).append("  \"").append(entry.getKey())
                  .append("\": ").append(toPrettyString(entry.getValue(), indent + 1));
                if (iter.hasNext()) sb.append(",");
                sb.append("\n");
            }
            sb.append(pad).append("}");
            yield sb.toString();
        }
    };
}
```

---

## 与传统 switch 的区别

| 特性 | 传统 switch | 表达式 switch |
|-----|------------|--------------|
| 用途 | 控制流语句 | 返回值表达式 |
| break | 需要（防止贯穿） | 不需要 |
| yield | 不支持 | 支持（从代码块返回值） |
| 默认行为 | 可选 | **必须**（穷尽性） |
| null | 抛 NPE | 可以显式处理 |

```java
// 传统 switch（语句）
switch (day) {
    case 1:
        System.out.println("Monday");
        break;
    // ...
}

// 表达式 switch（返回结果）
int type = switch (day) {
    case 1, 2, 3, 4, 5 -> 1;
    case 6, 7 -> 2;
    default -> 0;
};
```

---

## 最佳实践

### 1. 优先使用箭头语法

```java
// 好
return switch (status) {
    case PENDING -> "待处理";
    case APPROVED -> "已批准";
    case REJECTED -> "已拒绝";
    default -> "未知状态";
};

// 避免
switch (status) {
    case PENDING: return "待处理";  // 传统语法
    // ...
}
```

### 2. 保持分支简洁

```java
// 好：卫语句保持简洁
case Order o when o.isVip() -> applyVipDiscount(o);

// 不好：复杂逻辑写在 case 里
case Order o -> {
    if (o.isVip()) {
        yield o.getPrice() * 0.8;
    } else if (o.hasCoupon()) {
        yield o.getPrice() * 0.9;
    } else {
        yield o.getPrice();
    }
}
```

### 3. 避免 default 滥用

```java
// sealed class + switch = 不需要 default
return switch (shape) {
    case Circle c -> c.area();
    case Rectangle r -> r.area();
    // 如果 Shape 只有这两个子类，不需要 default
};

// 非 sealed class 才需要 default
return switch (obj) {
    case Integer i -> i.toString();
    case String s -> s;
    default -> "unsupported";  // 必须有
};
```

### 4. 注意 null 安全

```java
// JDK 17+
String result = switch (str) {
    case null -> "null string";
    case "" -> "empty string";
    default -> str;
};

// JDK 17 之前，需要提前检查
if (str == null) {
    return "null string";
}
```

---

## 面试追问方向

### 追问一：switch 表达式和 switch 语句有什么区别？

**switch 语句**：
- 用于控制流程
- 不需要 default
- 可以只有部分 case
- 返回值需要变量

**switch 表达式**：
- 用于产生值
- **必须有 default**（除非 sealed 类型）
- 必须覆盖所有情况
- 直接返回值

### 追问二：为什么 switch 表达式必须穷尽？

```java
// sealed class
sealed interface Shape permits Circle, Rectangle {}

// 这个 switch 是穷尽的，不需要 default
String describe(Shape s) {
    return switch (s) {
        case Circle c -> "Circle";
        case Rectangle r -> "Rectangle";
    };
}
```

编译器保证：如果 Shape 新增了子类但忘记处理，编译错误。

### 追问三：yield 和 return 有什么区别？

```java
return switch (obj) {
    case Integer i -> {
        // 不能用 return
        // return i;  // 错误
        yield i;  // 正确
    }
};
```

**yield 的限制**：
- 只能在 switch 表达式中使用
- 只能在代码块中使用
- 跳出的是 switch，不是方法

### 追问四：Pattern Matching for switch 和 instanceof Pattern Matching 有什么关系？

```java
// instanceof Pattern Matching
if (obj instanceof String s) {
    // s 可用
}

// Pattern Matching for switch
return switch (obj) {
    case String s -> s;  // 同样是模式匹配
    default -> "other";
};
```

核心机制相同：
- 自动类型转换
- 变量作用域受限
- 支持卫语句（`when`）

---

## 留给你的思考题

我们讲了 switch 表达式的演进。

但有一个问题：

**Pattern Matching for switch + sealed class 看起来很美好，但实际项目中 sealed class 用得多吗？**

考虑：

1. 团队成员是否熟悉 sealed class？
2. 类的演化：新增子类时，编译器的「帮助」是否真的有帮助？
3. 框架集成：Jackson、Gson 等能识别 sealed class 吗？
4. 是否有更好的替代方案（如枚举）？

> 提示：sealed class 适合「有限状态机」，不适合「开放世界」。
