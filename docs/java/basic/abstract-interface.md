# 抽象类 vs 接口

如果你要设计一个「会飞的动物」系统，会怎么写？

```java
// 方案一：用抽象类
abstract class FlyingAnimal {
    abstract void fly();
}

// 方案二：用接口
interface Flyable {
    void fly();
}
```

看起来差不多，但实际上代表两种完全不同的设计哲学。

## 抽象类：是什么（is-a）

抽象类表示**「是什么」**，描述一个对象的本质特征：

```java
// 抽象类表示「是某种类型的动物」
abstract class Animal {
    protected String name;

    // 抽象方法：子类必须实现
    abstract void sound();

    // 具体方法：子类可以直接使用或重写
    public void eat() {
        System.out.println(name + " 正在吃东西");
    }
}

class Dog extends Animal {
    @Override
    void sound() {
        System.out.println("汪汪汪");
    }
}
```

**抽象类的特点**：
- 可以包含抽象方法（没有方法体）和具体方法（有方法体）
- 单继承：一个类只能继承一个抽象类
- 可以有构造方法（用于子类初始化）
- 可以有成员变量

## 接口：能做什么（can-do）

接口表示**「能做什么」**，描述对象的能力：

```java
// 接口表示「具有某种能力」
interface Flyable {
    void fly();
}

interface Swimmable {
    void swim();
}

// 一个类可以同时实现多个接口
class Duck implements Flyable, Swimmable {
    @Override
    public void fly() {
        System.out.println("鸭子飞起来了");
    }

    @Override
    public void swim() {
        System.out.println("鸭子在水里游泳");
    }
}
```

**接口的特点**：
- JDK 7 及之前，只能包含抽象方法
- JDK 8 开始，可以有 `default` 方法和 `static` 方法
- JDK 9 开始，可以有 `private` 方法
- 多实现：一个类可以实现多个接口
- 不能有构造方法
- 成员变量默认是 `public static final`（常量）

## 设计哲学对比

| 维度 | 抽象类 | 接口 |
|-----|-------|------|
| 设计层次 | 「是什么」（is-a） | 「能做什么」（can-do） |
| 继承/实现 | 单继承 | 多实现 |
| 字段 | 任意类型 | 只能是常量 |
| 方法 | 任意方法 | 抽象方法、default 方法（JDK 8+）|
| 构造方法 | 可以有 | 不能有 |
| 代码复用 | 支持 | 部分支持（default 方法） |

什么时候用抽象类，什么时候用接口？

```java
// 场景：设计一个游戏中的角色系统

// 「战士」是一种「游戏角色」—— 用抽象类
abstract class GameCharacter {
    protected int hp;
    protected int attack;

    abstract void attack();
}

class Warrior extends GameCharacter {
    @Override
    void attack() {
        System.out.println("近战攻击！");
    }
}

// 「能治疗」是一种能力—— 用接口
interface Healable {
    void heal(int amount);
}

// 「能隐身」是一种能力—— 用接口
interface Stealthable {
    void hide();
}

// 一个角色可以同时有多种能力
class Rogue extends GameCharacter implements Healable, Stealthable {
    @Override
    void attack() {
        System.out.println("潜行攻击！");
    }

    @Override
    public void heal(int amount) {
        this.hp += amount;
    }

    @Override
    public void hide() {
        System.out.println("隐身中...");
    }
}
```

## JDK 8 的 default 方法：解决了什么，引入了什么

在 JDK 8 之前，接口新增方法会导致所有实现类都要修改——这是一个灾难。

```java
interface Flyable {
    void fly();

    // JDK 8：添加 default 方法，实现类不需要强制实现
    default void checkWind() {
        System.out.println("检查风向...");
    }
}
```

有了 `default` 方法，**接口可以有方法实现**了。这解决了一个大问题：接口升级的兼容性。

### 但也带来了新问题

**问题一：菱形继承**

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

// 继承两个接口，都定义了 hello()
// class C implements A, B {}  // 编译错误！

class C implements A, B {
    @Override
    public void hello() {
        // 必须显式解决冲突
        A.super.hello();  // 调用 A 的 hello()
        B.super.hello();  // 或调用 B 的 hello()
    }
}
```

**问题二：优先级不直观**

```java
abstract class Parent {
    default void hello() {
        System.out.println("Parent");
    }
}

interface MyInterface {
    default void hello() {
        System.out.println("Interface");
    }
}

// 子类继承 Parent 同时实现 MyInterface
// 先继承，后实现——Parent 的 hello() 优先
class Child extends Parent implements MyInterface {
}

new Child().hello();  // 输出：Parent
```

子类继承的类优先级高于实现的接口，这是 JDK 的设计决策。

## 函数式接口

如果一个接口**只有一个抽象方法**，就是函数式接口：

```java
@FunctionalInterface  // 注解，编译期检查
interface Comparator&lt;T&gt; {
    int compare(T o1, T o2);

    // Object 的方法不算，default 方法也不算
    boolean equals(Object obj);
}
```

`@FunctionalInterface` 不是必需的，但加上它有两个好处：
1. 编译器检查是否符合函数式接口定义
2. javadoc 会明确标注这是函数式接口

函数式接口是 Lambda 表达式和方法引用的基础。

## 接口的静态方法

```java
interface MyInterface {
    static void helper() {
        // JDK 8+：接口可以有静态方法
        System.out.println("静态方法");
    }

    static MyInterface create() {
        // 静态工厂方法：接口自己的创建方式
        return new MyInterface() {};
    }
}

MyInterface.helper();
MyInterface instance = MyInterface.create();
```

接口的静态方法**不属于实现类**，只能通过 `接口名.方法名()` 调用。

## 留给你的思考题

```java
abstract class A {
    abstract void method();
}

interface B {
    default void method() {
        System.out.println("B");
    }
}

class C extends A implements B {
    // 必须实现 A 的抽象 method()
    // B 的 default method() 可以直接使用
}

new C().method();  // 输出什么？
```

答案是编译错误：`C` 继承 `A` 的抽象方法，必须实现 `method()`，但 `B` 也有 `method()`——这不算冲突，因为 `A` 的抽象方法没有方法体。

**真正的问题是**：如果 `A` 和 `B` 都有 `default` 方法 `method()`，而 `C` 只继承 `A`、实现 `B`，那 `C` 需要实现 `method()` 吗？

---

**面试追问方向：**

1. 为什么 Java 不允许多继承类但允许多实现接口？
2. `default` 方法有什么使用场景？有什么限制？
3. 抽象类和接口都可以有 default 方法吗？
4. 如果一个类同时继承 `A` 和实现 `B`，而 `A` 和 `B` 都有同名方法，会发生什么？
