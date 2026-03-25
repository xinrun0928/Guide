# 面向对象：封装、继承、多态

凌晨 2 点，你在排查一个线上 bug。日志显示某个订单金额变成了负数。

你找到代码：

```java
public class Order {
    public double amount;
}
```

一个 `public` 字段，被业务代码随意修改。这就是**封装缺失**的代价。

面向对象的三大特性——封装、继承、多态——不是书上的概念，而是工程实践中的救命设计。

## 封装：把东西装进盒子里

封装的核心是**访问控制**。Java 提供了四个访问修饰符：

| 修饰符 | 同类 | 同包 | 子类 | 其他 |
|-------|------|------|------|------|
| `private` | ✓ | | | |
| `protected` | ✓ | ✓ | ✓ | |
| (默认) | ✓ | ✓ | | |
| `public` | ✓ | ✓ | ✓ | ✓ |

```java
public class Order {
    // private：只有 Order 类内部能访问
    private double amount;

    // protected：子类和同包可以访问
    protected String orderId;

    // public：任何地方都能访问
    public String customerName;

    // 默认（包级私有）：只有同包能访问
    String status;

    // 提供 public 方法访问 private 字段
    public double getAmount() {
        return amount;
    }

    public void setAmount(double amount) {
        // 在 setter 中添加校验，这就是封装的威力
        if (amount < 0) {
            throw new IllegalArgumentException("金额不能为负数");
        }
        this.amount = amount;
    }
}
```

### 为什么要用 getter/setter 而不是直接 public 字段？

表面上看是一样的：

```java
order.amount = -100;          // 直接赋值
order.setAmount(-100);       // 通过方法赋值
```

但方法的威力在于**可以在访问时增加逻辑**：

```java
public void setAmount(double amount) {
    if (amount < 0) {
        throw new IllegalArgumentException("金额不能为负数");
    }
    if (amount > 1000000) {
        log.warn("大额订单：{}", amount);
    }
    this.amount = amount;
}
```

这样，无论谁、从哪里、用什么方式修改金额，都会经过这个「关卡」。

## 继承：子承父业

继承让你可以复用已有类的代码：

```java
// 父类
public class Animal {
    protected String name;

    public void eat() {
        System.out.println(name + " 在吃东西");
    }
}

// 子类
public class Dog extends Animal {
    public void bark() {
        System.out.println(name + " 在汪汪叫");
    }
}
```

```java
Dog dog = new Dog();
dog.name = "旺财";
dog.eat();   // 继承自 Animal
dog.bark();  // Dog 自己的方法
```

### 单继承的局限

Java **只支持单继承**，一个类只能有一个直接父类：

```java
// 错误！Java 不支持多继承
public class A extends B, C {
}
```

为什么这样设计？因为多继承会产生「菱形继承」问题——如果 B 和 C 都定义了同一个方法，A 继承谁的呢？

```java
// 菱形继承问题示意
class B { void run() {} }
class C { void run() {} }
class A extends B, C {}  // 到底继承哪个 run()？
```

Java 选择用**接口**来解决多继承的场景需求。

### 方法覆盖（Override）

子类可以重写父类的方法：

```java
public class Animal {
    public void sound() {
        System.out.println("动物叫声");
    }
}

public class Cat extends Animal {
    @Override  // 注解，用于检查是否正确覆盖
    public void sound() {
        System.out.println("喵喵喵");
    }
}
```

`@Override` 不是必需的，但加上它有两个好处：
1. 编译器会检查是否真的在覆盖（拼写错误会报错）
2. 代码可读性更好

## 多态：同一个动作，不同的表现

多态让同一个类型的实例，在不同情况下表现出不同的行为。

### 向上转型（自动）

子类的引用可以赋给父类类型：

```java
Animal animal = new Dog();  // 向上转型，安全
animal.sound();             // 输出：汪汪汪
```

编译时看的是**左边的类型**（Animal），运行时执行的是**右边的实际类型**（Dog）。

### 向下转型（强制，需要小心）

父类引用转回子类类型，需要强制转换：

```java
Animal animal = new Dog();
Dog dog = (Dog) animal;  // 向下转型，安全，因为 animal 本来就是 Dog

Animal animal2 = new Cat();
// Dog dog2 = (Dog) animal2;  // 运行时ClassCastException！
```

### instanceof：安全检查

转型前先检查，避免 ClassCastException：

```java
public void makeSound(Animal animal) {
    if (animal instanceof Dog) {
        Dog dog = (Dog) animal;
        dog.bark();
    } else if (animal instanceof Cat) {
        Cat cat = (Cat) animal;
        cat.meow();
    }
}
```

JDK 14 之后，可以用**模式匹配**简化：

```java
public void makeSound(Animal animal) {
    if (animal instanceof Dog dog) {
        dog.bark();  // 直接使用 dog，无需强制转型
    }
}
```

## 重载 vs 重写

| 特性 | 重载 (Overload) | 重写 (Override) |
|-----|----------------|----------------|
| 发生位置 | 同一个类 | 父子类之间 |
| 方法名 | 必须相同 | 必须相同 |
| 参数列表 | 必须不同 | 必须相同 |
| 返回类型 | 可以不同 | 必须相同或协变 |
| 访问修饰符 | 无要求 | 不能更严格 |

```java
// 重载：同一个类，同名方法，不同参数
public class MathUtil {
    public int add(int a, int b) {
        return a + b;
    }

    public double add(double a, double b) {
        return a + b;
    }

    public int add(int a, int b, int c) {
        return a + b + c;
    }
}
```

```java
// 重写：子类覆盖父类方法
public class Child extends Parent {
    @Override
    public void method() {
        // 子类实现
    }
}
```

## this 和 super：两个指针

```java
public class Person {
    private String name;
    private int age;

    public Person(String name, int age) {
        this.name = name;   // this 指向当前实例，区分成员变量和参数
        this.age = age;
    }
}
```

```java
public class Student extends Person {
    private int score;

    public Student(String name, int age, int score) {
        super(name, age);   // super 调用父类构造函数，必须在第一行
        this.score = score;
    }

    @Override
    public String toString() {
        return super.toString() + ", score=" + score;
        // super.toString() 调用父类的 toString()
    }
}
```

**关键区别**：
- `this` 指向当前对象，可以调用本类的其他构造函数（`this(args)`）
- `super` 指向父类对象，可以调用父类的方法和构造函数（`super(args)`）

## 留给你的思考题

```java
public class A {
    public void method() {
        System.out.println("A");
    }
}

public class B extends A {
    @Override
    public void method() {
        System.out.println("B");
    }

    public void test() {
        method();        // 输出什么？
        this.method();   // 输出什么？
        super.method();  // 输出什么？
    }
}

A a = new B();
a.method();  // 输出什么？
```

答案分别是 B、B、A。但问题是：**如果 `B` 没有重写 `method()`，那么 `a.method()` 和 `super.method()` 的效果一样吗？**

---

**面试追问方向：**

1. 为什么 Java 不支持多继承？接口是如何解决这个问题的？
2. `this` 和 `super` 可以在 static 方法中使用吗？为什么？
3. 构造方法能被继承吗？能被重写吗？
4. `private` 方法能被重写吗？`final` 方法呢？
