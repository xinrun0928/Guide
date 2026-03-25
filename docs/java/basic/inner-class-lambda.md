# 内部类与 lambda 表达式

你有没有想过，为什么 Java 要设计内部类？

想象这个场景：你写了一个 `Queue` 类，但 `Node` 节点只会被 `Queue` 使用，完全没必要单独创建一个文件。这时候，内部类就是最佳选择。

## 内部类的四种形式

### 1. 成员内部类

```java
public class Outer {
    private String outerField = "外部类字段";

    // 成员内部类：作为外部类的成员
    public class Inner {
        private String innerField = "内部类字段";

        public void access() {
            // 内部类可以访问外部类的所有成员（包括 private）
            System.out.println(outerField);
            System.out.println(Outer.this.outerField);  // 显式引用
        }
    }
}
```

```java
// 创建内部类对象
Outer outer = new Outer();
Outer.Inner inner = outer.new Inner();
```

特点：
- 依赖于外部类实例，不能单独存在
- 可以访问外部类的所有成员（包括 `private`）
- 编译后生成 `Outer$Inner.class`

### 2. 静态内部类

```java
public class Outer {
    private static String staticField = "静态字段";

    // 静态内部类：不依赖外部类实例
    public static class StaticInner {
        public void access() {
            // 只能访问外部类的静态成员
            System.out.println(staticField);
            // System.out.println(outerField);  // 编译错误
        }
    }
}
```

```java
// 创建静态内部类对象
Outer.StaticInner inner = new Outer.StaticInner();
```

特点：
- 不依赖外部类实例，可以直接创建
- 只能访问外部类的静态成员
- 什么时候用？如果内部类不需要访问外部类实例，用 `static` 修饰

### 3. 局部内部类

```java
public class Outer {
    public void method() {
        // 在方法内部定义的类
        class LocalInner {
            private String field = "局部内部类字段";

            public void hello() {
                System.out.println("Hello from LocalInner");
            }
        }

        // 只能在方法内部创建和使用
        LocalInner local = new LocalInner();
        local.hello();
    }
}
```

特点：
- 作用域限定在方法内部
- 可以访问外部类的成员和 `final` 或「 effectively final」的局部变量
- JDK 8 开始，如果局部变量没被修改，实际上是 final 的

### 4. 匿名内部类

```java
public interface Callback {
    void onSuccess();
    void onError(Exception e);
}

// 使用匿名内部类
Callback callback = new Callback() {
    @Override
    public void onSuccess() {
        System.out.println("成功！");
    }

    @Override
    public void onError(Exception e) {
        System.out.println("失败：" + e.getMessage());
    }
};
```

**匿名内部类是语法糖**，本质是创建了一个**实现接口或继承父类的匿名子类**。

## lambda 表达式：简化匿名内部类

当匿名内部类只实现一个方法时，可以用 lambda 表达式简化：

```java
// 匿名内部类
Callback callback = new Callback() {
    @Override
    public void onSuccess() {
        System.out.println("成功！");
    }
};

// lambda 表达式（JDK 8+）
Callback callback = () -> System.out.println("成功！");
```

### lambda 的基本语法

```java
// 无参数
() -> System.out.println("Hello")

// 一个参数（括号可省略）
x -> x * 2
(String x) -> x.length()

// 多个参数
(int x, int y) -> x + y

// 多行语句（需要大括号）
(x, y) -> {
    int sum = x + y;
    return sum;
}
```

### lambda 的使用前提

**必须是函数式接口**：只有一个抽象方法的接口。

```java
// 正确的函数式接口
@FunctionalInterface
interface Function&lt;T, R&gt; {
    R apply(T t);
}

// 错误：有多个抽象方法
interface WrongInterface {
    void method1();
    void method2();
}
```

### lambda vs 匿名内部类的区别

| 维度 | 匿名内部类 | lambda |
|-----|----------|--------|
| 本质 | 创建了一个新的类文件 | 语法糖，编译成 invokestatic |
| `this` 关键字 | 指向匿名内部类实例 | 指向包围它的类的实例 |
| 编译产物 | 生成 `ClassName$1.class` | 生成 `ClassName$$Lambda$1.class` |
| 变量访问 | 访问 final 或 effectively final | 访问 final 或 effectively final |
| 适用范围 | 任何接口 | 只能用于函数式接口 |

```java
public class Test {
    private String field = "Outer";

    public void run() {
        Runnable anon = new Runnable() {
            private String field = "Anonymous";

            @Override
            public void run() {
                // this 指向匿名内部类
                System.out.println(this.field);  // Anonymous
            }
        };

        Runnable lambda = () -> {
            // this 指向 Test 本身
            System.out.println(this.field);  // Outer
        };
    }
}
```

## 方法引用：lambda 的极致简化

当 lambda 体的内容只是一个方法调用时，可以进一步简化：

```java
List&lt;String&gt; names = Arrays.asList("Alice", "Bob", "Charlie");

// lambda 表达式
names.forEach(name -> System.out.println(name));

// 方法引用： println 是 println(String) 的方法引用
names.forEach(System.out::println);
```

### 方法引用的四种形式

```java
// 1. 静态方法引用：ClassName::staticMethod
Function&lt;String, Integer&gt; parser = Integer::parseInt;
Integer result = parser.apply("123");  // 123

// 2. 实例方法引用：instance::instanceMethod
String str = "Hello";
Predicate&lt;String&gt; checker = str::contains;
boolean exists = checker.test("ell");  // true

// 3. 特定对象的方法引用：instance::instanceMethod（绑定）
List&lt;String&gt; words = Arrays.asList("apple", "banana");
words.stream()
    .map(String::toUpperCase)  // 每个元素调用 toUpperCase()
    .forEach(System.out::println);

// 4. 构造方法引用：ClassName::new
Supplier&lt;ArrayList&lt;String&gt;&gt; listFactory = ArrayList::new;
ArrayList&lt;String&gt; list = listFactory.get();

// 带参数的构造方法引用
Function&lt;Integer, String[]&gt; arrayFactory = String[]::new;
String[] array = arrayFactory.apply(10);  // 创建长度为 10 的数组
```

## 实战：选择合适的写法

```java
// 场景：创建一个线程

// 方式一：匿名内部类（啰嗦）
new Thread(new Runnable() {
    @Override
    public void run() {
        System.out.println("Hello");
    }
}).start();

// 方式二：lambda 表达式（简洁）
new Thread(() -> System.out.println("Hello")).start();

// 方式三：方法引用（最优雅）
new Thread(System.out::println).start();
```

什么时候用 lambda，什么时候用方法引用？
- 能用方法引用就用方法引用（更简洁）
- 方法引用解决不了的，用 lambda
- lambda 体超过几行的，考虑抽取为方法

## 留给你的思考题

```java
interface A {
    default void hello() {
        System.out.println("A");
    }
}

interface B {
    default void hello() {
        System.out.println("B");
    }
}

// 匿名内部类同时实现两个接口
A a = new A() {};  // 这能编译吗？
B b = new B() {};  // 这能编译吗？
```

答案是都能编译。匿名内部类只实现了一个接口，不是同时实现两个。

**但问题是**：如果我这样写：

```java
A a = new A() {
    @Override
    public void hello() {
        System.out.println("Anonymous A");
    }
};
a.hello();  // 输出什么？
```

这创建的是 `A` 接口的匿名实现类，而不是匿名内部类（因为 `A` 是接口，不是抽象类）。

---

**面试追问方向：**

1. 内部类为什么能访问外部类的成员？编译后是什么样的？
2. 静态内部类和成员内部类的区别是什么？
3. lambda 表达式的 `this` 指向哪里？为什么？
4. 为什么局部内部类和匿名内部类访问的外部变量必须是 final 的？
