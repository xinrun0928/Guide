# 自动装箱与拆箱原理

看看这段代码，输出是什么？

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b);  // true

Integer c = 128;
Integer d = 128;
System.out.println(c == d);  // false
```

`==` 比较的是引用，为什么 127 是 true，128 是 false？

答案藏在**自动装箱**的机制里。

## 什么是自动装箱和拆箱？

### 装箱：基本类型 → 包装类型

```java
// 手动装箱（JDK 5 之前的方式）
Integer a = Integer.valueOf(127);

// 自动装箱（JDK 5+）
Integer b = 127;  // 编译器自动转换为 Integer.valueOf(127)
```

编译器实际做的转换：

```java
// 源代码
Integer i = 127;

// 编译后（等价代码）
Integer i = Integer.valueOf(127);
```

### 拆箱：包装类型 → 基本类型

```java
// 手动拆箱
int x = i.intValue();

// 自动拆箱
int y = i;  // 编译器自动转换为 i.intValue()
```

## valueOf() 的实现

```java
public static Integer valueOf(int i) {
    if (i >= IntegerCache.low && i <= IntegerCache.high)
        return IntegerCache.cache[i + (-IntegerCache.low)];
    return new Integer(i);
}
```

**关键**：如果值在缓存范围内（-128 ~ 127），直接返回缓存中的对象；否则创建新对象。

这就是为什么 `Integer a = 127` 和 `Integer b = 127` 指向同一个对象。

## 自动装箱的陷阱

### 陷阱一：Integer == int 比较

```java
Integer i = 127;
int j = 127;
System.out.println(i == j);  // true！
```

拆箱后再比较，所以是值的比较，不是引用比较。

```java
Integer i = 128;
int j = 128;
System.out.println(i == j);  // true

// 编译器做了：
// 1. i 自动拆箱为 int
// 2. 两个 int 比较
```

### 陷阱二：Integer == Integer 比较

```java
Integer i = 127;
Integer j = 127;
System.out.println(i == j);  // true（使用缓存）

Integer m = 128;
Integer n = 128;
System.out.println(m == n);  // false（超出缓存范围）
```

### 陷阱三：Integer == Integer（显式装箱）

```java
Integer i = new Integer(127);
Integer j = 127;
System.out.println(i == j);  // false！

// i 是 new 出来的，肯定不在缓存中
// j 是自动装箱，使用缓存
```

### 陷阱四：方法参数中的自动装箱

```java
public void test(Integer i) {
    System.out.println(i);
}

test(127);  // 自动装箱，命中缓存
test(128);  // 自动装箱，创建新对象
```

## 循环中的自动装箱问题

```java
// 陷阱代码：大量自动装箱，产生大量 Integer 对象
long start = System.currentTimeMillis();
long sum = 0;
for (int i = 0; i < 10000000; i++) {
    Long sumObject = sum;  // 每次都装箱
    sum = sumObject + i;
}
System.out.println(System.currentTimeMillis() - start);
```

正确做法：

```java
// 正确：用基本类型
long start = System.currentTimeMillis();
long sum = 0;
for (int i = 0; i < 10000000; i++) {
    sum += i;  // 基本类型运算，不需要装箱
}
System.out.println(System.currentTimeMillis() - start);
```

**教训**：能用基本类型就不要用包装类型，特别是在循环中。

## 所有包装类的装箱/拆箱方法

```java
// Integer
Integer.valueOf(int)      // 装箱
i.intValue()               // 拆箱

// Long
Long.valueOf(long)
l.longValue()

// Double
Double.valueOf(double)
d.doubleValue()

// Boolean
Boolean.valueOf(boolean)
b.booleanValue()

// Character
Character.valueOf(char)
c.charValue()

// Short
Short.valueOf(short)
s.shortValue()

// Byte
Byte.valueOf(byte)
b.byteValue()

// Float
Float.valueOf(float)
f.floatValue()
```

## null 拆箱的 NullPointerException

```java
Integer i = null;
int j = i;  // 自动拆箱 → NullPointerException！

// 编译器实际做的：
int j = i.intValue();  // NPE
```

**这是常见的 bug 来源**：把 Integer 传给期望 int 的方法时，没做 null 检查。

```java
// 错误
public int parse(Integer value) {
    return value + 1;  // 如果 value 是 null，抛 NPE
}

// 正确
public int parse(Integer value) {
    return value != null ? value + 1 : 0;
}
```

## 自动装箱的适用场景

### 适用

```java
// 1. 泛型参数（泛型不支持基本类型）
List&lt;Integer&gt; list = new ArrayList&lt;&gt;();

// 2. 方法参数需要 Object 类型
Object obj = 123;  // 自动装箱

// 3. 方法返回值
public Integer getId() {
    return id;  // 自动装箱
}
```

### 不适用

```java
// 1. 循环中的累加器
// 错误
Integer sum = 0;
for (int i : numbers) {
    sum += i;  // 每次都自动装箱
}

// 正确
int sum = 0;
for (int i : numbers) {
    sum += i;
}

// 2. 高频比较
if (count == 0) {  // 正确：基本类型
    // ...
}
```

## equals() vs ==

```java
Integer a = 127;
Integer b = 127;
Integer c = 128;
Integer d = 128;

System.out.println(a.equals(b));  // true
System.out.println(c.equals(d));  // true
System.out.println(a == b);       // true（缓存）
System.out.println(c == d);       // false（不缓存）
```

**结论**：比较包装类，**永远用 `equals()`**。

## 留给你的思考题

```java
Integer a = 1;
Integer b = 2;
Integer c = 3;
Integer d = 3;
Integer e = 321;
Integer f = 321;
Long g = 3L;

System.out.println(c == d);        // ?
System.out.println(e == f);       // ?
System.out.println(c == a + b);   // ?
System.out.println(c.equals(a + b));  // ?
System.out.println(g == (a + b)); // ?
System.out.println(g.equals(a + b));  // ?
```

**提示**：考虑自动拆箱和缓存机制。`a + b` 会发生什么？

---

**面试追问方向：**

1. 自动装箱的原理是什么？编译器做了什么转换？
2. Integer 缓存池的范围是多少？其他包装类有缓存吗？
3. `Integer == int` 比较会发生什么？
4. 循环中为什么要避免自动装箱？会产生什么问题？
5. 为什么 `Integer` 的 `equals()` 要比较类型？
