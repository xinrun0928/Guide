# 枚举：不仅是常量集合

---

你有没有见过这样的代码？

```java
public class OrderStatus {
    public static final int PENDING = 0;
    public static final int PAID = 1;
    public static final int SHIPPED = 2;
    public static final int COMPLETED = 3;
}
```

然后在代码里到处写 `if (status == 1)`，或者 `switch (status)`。

某天产品经理说：「我们加一个状态：已取消。」

你找到所有使用这些常量的地方，一个一个改。好不容易改完了，测试发现有个地方 `status == 2` 写成了 `status == 3`——这两个状态搞混了。

这种 bug，编译器帮不了你。但如果你用枚举：

```java
public enum OrderStatus {
    PENDING, PAID, SHIPPED, COMPLETED
}
```

编译器会帮你检查所有 `switch` 和 `if` 语句是否遗漏了新的枚举值。这种约束，是枚举最朴素的价值。

## 枚举的本质：继承自 Enum 的类

你以为 `enum` 是 Java 的新语法？实际上，枚举就是一个**继承自 `java.lang.Enum` 的类**。

```java
// 你写的
public enum Season {
    SPRING, SUMMER, AUTUMN, WINTER
}

// 编译器帮你生成的（等价于）
public final class Season extends Enum&lt;Season&gt; {
    public static final Season SPRING = new Season("SPRING", 0);
    public static final Season SUMMER = new Season("SUMMER", 1);
    public static final Season AUTUMN = new Season("AUTUMN", 2);
    public static final Season WINTER = new Season("WINTER", 3);

    private Season(String name, int ordinal) {
        super(name, ordinal);
    }
}
```

### Enum 类提供了哪些方法？

| 方法 | 说明 |
|---|---|
| `name()` | 返回枚举常量的名称，如 `"SPRING"` |
| `ordinal()` | 返回枚举常量的序数，从 0 开始 |
| `valueOf(Class&lt;E&gt; enumType, String name)` | 根据名称获取枚举常量 |
| `values()` | 返回所有枚举常量的数组（编译器生成） |
| `compareTo(E o)` | 比较顺序 |
| `equals(Object o)` | 比较引用 |
| `hashCode()` | 返回 hashCode |
| `toString()` | 默认返回 name() |

```java
Season spring = Season.SPRING;
System.out.println(spring.name());      // SPRING
System.out.println(spring.ordinal());   // 0
System.out.println(Season.valueOf("SPRING"));  // SPRING

Season[] seasons = Season.values();
for (Season s : seasons) {
    System.out.println(s);
}
// SPRING, SUMMER, AUTUMN, WINTER
```

## 枚举实现接口：所有枚举值都继承行为

枚举可以实现接口，让每个枚举值都具备某种能力：

```java
public interface Describable {
    String getDescription();
}

public enum Operation implements Describable {
    PLUS("+") {
        @Override
        public double apply(double x, double y) {
            return x + y;
        }
    },
    MINUS("-") {
        @Override
        public double apply(double x, double y) {
            return x - y;
        }
    },
    TIMES("*") {
        @Override
        public double apply(double x, double y) {
            return x * y;
        }
    },
    DIVIDE("/") {
        @Override
        public double apply(double x, double y) {
            if (y == 0) throw new ArithmeticException("Division by zero");
            return x / y;
        }
    };

    private final String symbol;

    Operation(String symbol) {
        this.symbol = symbol;
    }

    @Override
    public String getDescription() {
        return "Operation: " + symbol;
    }

    public abstract double apply(double x, double y);
}
```

使用：

```java
System.out.println(Operation.PLUS.apply(2, 3));        // 5.0
System.out.println(Operation.DIVIDE.apply(10, 3));    // 3.333...
System.out.println(Operation.PLUS.getDescription()); // Operation: +
```

**每个枚举值都可以有自己的实现**——这在策略模式中特别有用。

## 枚举的高级用法：枚举属性

枚举可以有属性（字段）和方法：

```java
public enum Planet {
    MERCURY(3.303e+23, 2.4397e6),
    VENUS(4.869e+24, 6.0518e6),
    EARTH(5.976e+24, 6.37814e6),
    MARS(6.421e+23, 3.3972e6),
    JUPITER(1.9e+27, 7.1492e7),
    SATURN(5.688e+26, 6.0268e7),
    URANUS(8.686e+25, 2.5559e7),
    NEPTUNE(1.024e+26, 2.4746e7);

    private final double mass;   // 质量 (kg)
    private final double radius; // 半径 (m)

    Planet(double mass, double radius) {
        this.mass = mass;
        this.radius = radius;
    }

    // 计算表面重力
    public double surfaceGravity() {
        double G = 6.673e-11; // 万有引力常数
        return G * mass / (radius * radius);
    }

    // 计算物体在行星表面的重量
    public double surfaceWeight(double otherMass) {
        return otherMass * surfaceGravity();
    }
}
```

使用：

```java
double earthWeight = 80; // kg
for (Planet p : Planet.values()) {
    System.out.printf("%s: %.2f kg on Earth = %.2f kg%n",
        p, earthWeight, p.surfaceWeight(earthWeight));
}
```

## 枚举与 switch 配合使用

枚举在 `switch` 语句中表现出色，编译器会检查是否处理了所有情况：

```java
public class EnumSwitchDemo {

    public String describe(Season season) {
        switch (season) {
            case SPRING:
                return "春暖花开";
            case SUMMER:
                return "烈日炎炎";
            case AUTUMN:
                return "秋高气爽";
            case WINTER:
                return "冰天雪地";
            default:
                return "未知季节"; // 理论上不会执行到这里
        }
    }
}
```

**注意**：JDK 7 之前的 switch 只支持枚举常量名称（`case SPRING:`），JDK 7 开始支持字符串。

## 枚举实现单例模式（Effective Java 推荐）

枚举是实现单例模式最简洁的方式：

```java
public enum Singleton {
    INSTANCE;

    private String name;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

**优点**：

1. **线程安全**：JVM 保证绝对只实例化一次
2. **防反射攻击**：`Constructor.newInstance()` 会抛异常
3. **防序列化攻击**：JVM 保证枚举实例唯一
4. **简洁**：不需要双重检查锁定

```java
// 使用
Singleton s1 = Singleton.INSTANCE;
Singleton s2 = Singleton.INSTANCE;
System.out.println(s1 == s2); // true
```

## 枚举在实战中的应用

### 替代 int 常量

```java
// 不好：类型不安全
public void process(int status) {
    if (status == 0) { ... }
    if (status == 1) { ... }
}

// 好：类型安全
public void process(OrderStatus status) {
    switch (status) {
        case PENDING: ...
        case PAID: ...
        // 编译器会警告：缺少 SHIPPED 和 COMPLETED
    }
}
```

### 表示状态机

```java
public enum TrafficLight {
    RED {
        @Override
        public TrafficLight next() {
            return GREEN;
        }
    },
    GREEN {
        @Override
        public TrafficLight next() {
            return YELLOW;
        }
    },
    YELLOW {
        @Override
        public TrafficLight next() {
            return RED;
        }
    };

    public abstract TrafficLight next();
}
```

### 策略模式

```java
public enum Discount {
    NONE {
        @Override
        public BigDecimal apply(BigDecimal price) {
            return price;
        }
    },
    TEN_PERCENT {
        @Override
        public BigDecimal apply(BigDecimal price) {
            return price.multiply(new BigDecimal("0.9"));
        }
    },
    FIFTY_PERCENT {
        @Override
        public BigDecimal apply(BigDecimal price) {
            return price.multiply(new BigDecimal("0.5"));
        }
    };

    public abstract BigDecimal apply(BigDecimal price);
}

// 使用
BigDecimal discountedPrice = Discount.TEN_PERCENT.apply(originalPrice);
```

## 面试追问方向

- 枚举的 ordinal() 有什么坑？
- 枚举为什么不能继承其他类？
- 枚举在数据库中如何存储？

## 留给你的思考题

假设你需要实现一个订单状态流转系统，有以下状态：

- 待支付 (PENDING)
- 已支付 (PAID)
- 已发货 (SHIPPED)
- 已完成 (COMPLETED)
- 已取消 (CANCELLED)

请设计：

1. 如何确保状态流转是合法的（比如不能从 PENDING 直接跳到 COMPLETED）？
2. 如何在枚举中实现状态流转的验证逻辑？
3. 如果某个状态流转需要触发特定动作（如发短信、发邮件），如何设计？

提示：考虑枚举的方法和抽象方法的使用方式。
