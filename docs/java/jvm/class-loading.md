# 类的主动加载与被动加载

你可能以为代码里写了 `new Object()` 才会触发类加载，但面试官问你：「`System.out.println(Child.count)` 会触发父类还是子类的加载？」

你确定能答对吗？

## 什么是类的加载时机

类的加载（Loading）是类加载过程中的第一步。但「类的加载」和「类的初始化」是两回事。

**加载**：将 `.class` 文件读入内存，创建 `Class` 对象
**初始化**：执行 `<clinit>()` 代码块，包括静态变量赋值和静态代码块

有些操作会触发加载，但不触发初始化；有些操作既不加载也不初始化。

## 主动加载：六种会触发初始化的场景

《Java 虚拟机规范》明确定义了六种必须立即初始化类的情况，称为**主动引用**：

### 1. new 对象

```java
new MyClass();  // 触发 MyClass 初始化
```

### 2. 访问类的静态字段

```java
int a = MyClass.value;  // 触发 MyClass 初始化
```

**注意**：访问 `final` 修饰的编译期常量不会触发，因为编译时已经被「内联」到引用处了。

### 3. 调用类的静态方法

```java
MyClass.doSomething();  // 触发 MyClass 初始化
```

### 4. 反射

```java
Class.forName("com.example.MyClass");  // 触发 MyClass 初始化
```

### 5. 初始化子类时，父类先初始化

```java
public class Parent {
    static { System.out.println("Parent init"); }
}

public class Child extends Parent {
    static { System.out.println("Child init"); }
}

// 触发父类 + 子类都初始化
new Child();
```

### 6. 主类（包含 main 方法的类）

```java
public class Main {
    public static void main(String[] args) {}
}
```

JVM 启动时，主类会被优先初始化。

## 被动加载：不触发初始化的场景

与主动引用相对的是**被动引用**，不会触发初始化，但会触发加载。

### 场景一：子类引用父类的静态字段

```java
class Parent {
    static int value = 123;
    static { System.out.println("Parent 初始化"); }
}

class Child extends Parent {
    static { System.out.println("Child 初始化"); }
}

// 通过子类引用父类的静态字段
System.out.println(Child.value);
```

输出：

```
Parent 初始化
123
```

**分析**：只触发了父类的初始化，子类**没有被初始化**。原因：静态字段属于父类，子类只是「借助」父类的字段，不需要初始化自己。

### 场景二：数组类

```java
Parent[] arr = new Parent[10];
```

这不会触发 `Parent` 的加载。数组类由 JVM 直接创建，不是通过类加载器。

真正创建的是**数组类** `[Lcom.example.Parent;`：

```java
System.out.println(arr.getClass());  // class [Lcom.example.Parent;
```

数组类的加载、验证、准备和初始化都由 JVM 自动处理，不需要显式类加载器。

### 场景三：编译期常量的访问

```java
class MyClass {
    static final int CONST = 100;  // 编译期常量
    static { System.out.println("MyClass 初始化"); }
}

// 访问编译期常量
int a = MyClass.CONST;
```

输出：**什么都没有**。

`static final` 修饰的变量如果是**编译期常量**（基本类型或 String 字面量），在编译时会被内联到使用处，根本不需要读取 `MyClass`。

但如果这样：

```java
static final int RANDOM = new Random().nextInt();  // 运行期赋值
```

这会触发初始化，因为编译器无法确定值。

### 场景四：Class.forName() 的第二个参数

```java
// 第二个参数 false：不执行初始化
Class&lt;?&gt; clazz = Class.forName("com.example.MyClass", false, loader);
```

只加载类，不初始化。

## 完整流程：加载 → 链接 → 初始化

```
┌─────────────────────────────────────────────────────────────┐
│                         加载 (Loading)                      │
│  读取 .class 文件字节流 → 方法区数据结构 → 堆中 Class 对象     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                         链接 (Linking)                        │
│  ┌───────────┐  ┌───────────┐  ┌───────────────────┐        │
│  │ 验证      │  │ 准备       │  │ 解析               │        │
│  │ 验证字节码 │  │ 分配内存   │  │ 符号引用→直接引用   │        │
│  │ 符合规范  │  │ 零值初始化  │  │                   │        │
│  └───────────┘  └───────────┘  └───────────────────┘        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      初始化 (Initialization)                 │
│  执行 &lt;clinit&gt;() 方法                                       │
│  - 静态变量赋值                                               │
│  - 静态代码块执行                                             │
│  - 父类 &lt;clinit&gt;() 先执行                                    │
└─────────────────────────────────────────────────────────────┘
```

## 示例：验证类的加载与初始化

```java
class Single {
    static { System.out.println("Single 初始化"); }
}

class Parent {
    static { System.out.println("Parent 初始化"); }
}

class Child extends Parent {
    static { System.out.println("Child 初始化"); }
}

// 1. 创建数组 - 不触发任何加载
Single[] arr = new Single[0];
System.out.println("---");

// 2. Class.forName(false) - 加载但不初始化
try {
    Class&lt;?&gt; c = Class.forName("Single", false, Child.class.getClassLoader());
    System.out.println("Single 已加载但未初始化");
} catch (ClassNotFoundException e) {}
System.out.println("---");

// 3. 访问子类的父类静态字段 - 只初始化父类
System.out.println(Child.value);  // 假设 Parent 有 value 字段
System.out.println("---");

// 4. new Child() - 父类 + 子类都初始化
new Child();
```

可能的输出：

```
---
Single 已加载但未初始化
---
Parent 初始化
0
---
Parent 初始化
Child 初始化
```

## 面试高频问题

**Q1：什么情况下会触发类的初始化？**

主动引用的六种情况：new、访问静态字段/方法、反射、初始化子类、main 方法启动。

**Q2：子类继承父类，初始化子类时，父类一定初始化吗？**

一定。JVM 规定初始化子类前必须先初始化父类。

**Q3：访问 `static final` 常量会触发类加载吗？**

编译期常量不会触发类加载（因为被内联了）；运行期常量会触发。

**Q4：Class.forName() 和 ClassLoader.loadClass() 的区别？**

`Class.forName()` 默认会执行类初始化；`ClassLoader.loadClass()` 不会触发初始化（除非调用 `resolveClass()`）。

**Q5：静态内部类和普通内部类在加载时的区别？**

静态内部类不会触发外类的初始化；普通内部类持有外类引用，会导致外类被加载。

```java
public class Outer {
    static { System.out.println("Outer init"); }

    public static class StaticInner {
        static { System.out.println("StaticInner init"); }
    }

    public class Inner {
        static final int X = 1;  // 必须是 final 才能有静态字段
        { System.out.println("Inner instance init"); }
    }
}

// 触发 StaticInner 初始化（Outer 可能被加载，也可能不）
new Outer.StaticInner();

// 触发 Outer 初始化（因为创建 Inner 需要外类实例）
new Outer().new Inner();
```

## 实战应用

### 1. 延迟加载：先加载不初始化

用于按需加载模块：

```java
public class LazyLoader {

    public static Class&lt;?&gt; loadWithoutInit(String className) {
        try {
            // false = 不初始化
            return Class.forName(className, false,
                Thread.currentThread().getContextClassLoader());
        } catch (ClassNotFoundException e) {
            throw new RuntimeException(e);
        }
    }
}
```

### 2. 类的预检：检查类是否已加载

```java
public class ClassCheck {

    public static boolean isLoaded(String className) {
        ClassLoader cl = Thread.currentThread().getContextClassLoader();
        Class&lt;?&gt; c = cl.loadClass(className);
        return c != null;
    }
}
```

### 3. SPI 机制：ServiceLoader

JDBC、JNDI 等 SPI 机制利用类加载但不初始化的特性，按需加载实现类：

```java
ServiceLoader&lt;Driver&gt; loader = ServiceLoader.load(Driver.class);
// 遍历时才真正加载和初始化
for (Driver driver : loader) {
    // 使用 driver
}
```

## 总结

| 操作 | 加载？ | 初始化？ |
|-----|-------|---------|
| new 对象 | ✓ | ✓ |
| 访问 static 字段（非 final） | ✓ | ✓ |
| 调用 static 方法 | ✓ | ✓ |
| 反射 Class.forName() | ✓ | ✓ |
| 初始化子类（父类先） | ✓ | ✓ |
| 子类引用父类 static 字段 | ✓ | ✗ |
| 数组类创建 | ✗ | ✗ |
| 访问编译期常量 | ✗ | ✗ |
| Class.forName(false) | ✓ | ✗ |

理解主动加载与被动加载的区别，对于理解类加载机制、排查类加载异常、以及设计模块化架构都非常重要。

---

**留给你的思考题：**

```java
public class StaticTest {
    public static void main(String[] args) {
        System.out.println(StaticNested.COUNT);
    }
}

class StaticNested {
    static final int COUNT = new Random().nextInt(100);
    static { System.out.println("StaticNested 初始化"); }
}
```

运行结果是什么？`COUNT` 前的 `final` 修饰符有什么影响？

提示：考虑「编译期常量」的定义。
