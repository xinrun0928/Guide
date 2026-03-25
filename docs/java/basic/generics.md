# 泛型：类型参数化的威力

---

假设你需要一个容器类，用来存放元素。早期的 Java 程序员会这样写：

```java
public class Container {
    private Object element;

    public void set(Object element) {
        this.element = element;
    }

    public Object get() {
        return element;
    }
}
```

使用时：

```java
Container c = new Container();
c.set("hello");
String s = (String) c.get(); // 需要强制类型转换
```

问题来了：如果不小心存了 Integer，却按 String 取呢？

```java
c.set(123);
String s = (String) c.get(); // 运行时 ClassCastException
```

编译器管不了这种错误，只能靠程序员的自律。但泛型的出现改变了这一切：

```java
public class Container&lt;T&gt; {
    private T element;

    public void set(T element) {
        this.element = element;
    }

    public T get() {
        return element;
    }
}
```

使用时：

```java
Container&lt;String&gt; c = new Container&lt;&gt;();
c.set("hello");
String s = c.get(); // 无需强制类型转换
c.set(123); // 编译错误！类型安全
```

这就是泛型的核心价值：**编译时类型检查 + 类型自动转换**。

## 泛型的本质：类型擦除

这里有个惊人的事实：Java 的泛型是**伪泛型**——运行时的泛型信息被擦除了。

```java
// 源代码
List&lt;String&gt; stringList = new ArrayList&lt;&gt;();
List&lt;Integer&gt; intList = new ArrayList&lt;&gt;();

// 运行时
System.out.println(stringList.getClass() == intList.getClass()); // true
```

两个 List 在运行时是同一个类，泛型信息被擦除了。

### 擦除到哪里了？

```java
public class Container&lt;T&gt; {
    private T element;

    public T get() {
        return element;
    }
}
```

编译后变成：

```java
public class Container {
    private Object element; // T 被替换为 Object

    public Object get() {
        return element;
    }
}
```

**擦除规则**：

- 如果 T 没有上限，替换为 Object
- 如果 T 有上限（如 `<T extends Number>`），替换为上限类型

```java
public class Container&lt;T extends Number&gt; {
    private T element;

    public T get() {
        return element;
    }
}
```

编译后变成：

```java
public class Container {
    private Number element; // T 被替换为 Number

    public Number get() {
        return element;
    }
}
```

## 通配符：灵活的泛型

### 无界通配符 `<?>`

表示「我不知道是什么类型」：

```java
public void printList(List&lt;?&gt; list) {
    for (Object element : list) {
        System.out.println(element);
    }
}
```

### 上界通配符 `<? extends T>`

表示「T 或 T 的子类」：

```java
// 只能读取，不能写入（除了 null）
List&lt;? extends Number&gt; numbers = new ArrayList&lt;Integer&gt;();

// numbers.add(new Integer(1)); // 编译错误！
// numbers.add(new Double(1.0)); // 编译错误！
Number n = numbers.get(0); // 可以读取
```

### 下界通配符 `<? super T>`

表示「T 或 T 的父类」：

```java
// 只能保证能写入 T 或 T 的子类
List&lt;? super Integer&gt; numbers = new ArrayList&lt;Number&gt;();
numbers.add(new Integer(1)); // 可以写入
// numbers.add(new Double(1.0)); // 编译错误！
Object o = numbers.get(0); // 读取返回 Object
```

## PECS 原则

**P**roducer **E**xtends, **C**onsumer **S**uper

- 如果**只读取**数据，用 `extends`（生产者）
- 如果**只写入**数据，用 `super`（消费者）
- 如果既读又写，不要用通配符

```java
// 生产者：提供数据
public double sum(List&lt;? extends Number&gt; list) {
    double sum = 0;
    for (Number n : list) {
        sum += n.doubleValue(); // 只读取
    }
    return sum;
}

// 消费者：消费数据
public void addNumbers(List&lt;? super Integer&gt; list) {
    list.add(1); // 写入
    list.add(2);
}

// 读写兼备：不要用通配符
public void copy(List&lt;Object&gt; dest, List&lt;Object&gt; src) {
    for (Object item : src) {
        dest.add(item);
    }
}
```

## 泛型方法

```java
public class Utils {

    // 静态泛型方法
    public static &lt;T&gt; void swap(T[] array, int i, int j) {
        T temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }

    // 非静态泛型方法
    public &lt;T&gt; T getFirst(List&lt;T&gt; list) {
        if (list == null || list.isEmpty()) {
            return null;
        }
        return list.get(0);
    }
}

// 使用
String[] arr = {"a", "b", "c"};
Utils.swap(arr, 0, 2);
```

## 泛型数组的限制

不能直接创建泛型数组：

```java
T[] array = new T[10]; // 编译错误！

// 原因：运行时类型被擦除，无法确定数组元素类型
```

解决方法：

```java
// 方法一：使用反射
T[] array = (T[]) Array.newInstance(clazz, capacity);

// 方法二：让调用者传入数组
public &lt;T&gt; T[] toArray(T[] a) {
    return a;
}

// 方法三：使用 Object 数组 + 类型转换（不推荐）
Object[] objArray = new Object[10];
T[] array = (T[]) objArray; // 有警告但不报错
```

## 泛型与反射结合

由于类型擦除，很多泛型信息在运行时丢失了。但通过反射可以获取：

```java
public class GenericReflection {
    public static void main(String[] args) throws Exception {
        ArrayList&lt;String&gt; list = new ArrayList&lt;&gt;();
        list.add("hello");

        // 获取泛型类型
        Class&lt;? extends ArrayList&gt; clazz = list.getClass();
        Method addMethod = clazz.getMethod("add", Object.class);
        addMethod.invoke(list, 123); // 可以添加 Integer！

        System.out.println(list); // [hello, 123]
    }
}
```

**这就是类型安全可以被绕过的地方**。反射是泛型的天敌。

## 泛型接口

```java
public interface Container&lt;T&gt; {
    T get();
    void set(T element);
}

// 实现时可以选择具体类型
class StringContainer implements Container&lt;String&gt; {
    private String element;

    @Override
    public String get() {
        return element;
    }

    @Override
    public void set(String element) {
        this.element = element;
    }
}

// 或者继续是泛型
class GenericContainer&lt;T&gt; implements Container&lt;T&gt; {
    private T element;

    @Override
    public T get() {
        return element;
    }

    @Override
    public void set(T element) {
        this.element = element;
    }
}
```

## 面试追问方向

- 类型擦除后，如何获取泛型的实际类型信息？
- 为什么不能创建泛型数组？
- `<T>` 和 `<?>` 有什么区别？

## 留给你的思考题

考虑以下代码：

```java
public static &lt;T&gt; void copy(List&lt;T&gt; dest, List&lt;? extends T&gt; src) {
    for (T element : src) {
        dest.add(element);
    }
}

List&lt;Number&gt; numbers = new ArrayList&lt;&gt;();
List&lt;Integer&gt; integers = Arrays.asList(1, 2, 3);
copy(numbers, integers); // 为什么可以？
```

以及一个更有挑战性的问题：

```java
class A { }
class B extends A { }
class C extends B { }

// 以下调用哪个能编译，哪个不能？
List&lt;A&gt; aList = new ArrayList&lt;&gt;();
List&lt;B&gt; bList = new ArrayList&lt;&gt;();
List&lt;C&gt; cList = new ArrayList&lt;&gt;();

copy(aList, bList); // ？
copy(bList, cList); // ？
copy(cList, aList); // ？
copy(cList, bList); // ？
```

解释为什么。理解了这个，你就真正掌握了泛型的核心概念。
