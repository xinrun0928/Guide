# 数据类型与类型转换

你知道 Java 中 `float f = 1.1;` 会导致编译错误，但 `float f = 1.1f;` 却能正常通过吗？

这不是什么奇怪的语法规则，而是 Java 类型系统的基本逻辑——理解了这一层，你就能彻底掌握 Java 的数据类型体系。

## 八种基本数据类型

Java 有 8 种基本数据类型，分为四类：

### 整数类型

| 类型 | 占用空间 | 取值范围 |
|-----|---------|---------|
| `byte` | 1 字节 | -128 ~ 127 |
| `short` | 2 字节 | -32768 ~ 32767 |
| `int` | 4 字节 | -2³¹ ~ 2³¹-1（约 ±21 亿）|
| `long` | 8 字节 | -2⁶³ ~ 2⁶³-1 |

```java
byte b = 127;        // OK，byte 最大值
short s = 32767;     // OK，short 最大值
int i = 2147483647;  // OK，int 最大值
long l = 9223372036854775807L;  // 需要加 L 后缀
```

### 浮点类型

| 类型 | 占用空间 | 有效位数 |
|-----|---------|---------|
| `float` | 4 字节 | 约 6-7 位 |
| `double` | 8 字节 | 约 15-16 位 |

```java
float f1 = 3.14f;    // 必须加 f 或 F 后缀
float f2 = 3.14F;    // 等价于上面
double d = 3.14;     // double 不需要后缀（默认小数类型）
```

**为什么 `float f = 1.1;` 会报错？**

因为 `1.1` 是 `double` 类型字面量，直接赋给 `float` 会丢失精度。Java 对此强制要求明确声明——要么加 `f` 后缀，要么强制转型：

```java
float f1 = 1.1f;           // 推荐方式
float f2 = (float) 1.1;    // 强制转型，警告：可能丢失精度
```

### 字符类型

```java
char c1 = 'A';         // 单引号包裹单个字符
char c2 = '\u0041';    // Unicode 编码
char c3 = 65;           // ASCII 码值
```

### 布尔类型

```java
boolean flag = true;
boolean result = false;
```

注意：`boolean` 在 JVM 实现中通常是 1 字节，但理论上可以是 1 位。

## 基本类型 vs 引用类型

这是 Java 初学者最容易混淆的地方：

```java
// 基本类型：直接存储值
int a = 10;
int b = a;
b = 20;
System.out.println(a);  // 输出 10，a 不受影响

// 引用类型：存储对象地址
int[] arr1 = {1, 2, 3};
int[] arr2 = arr1;
arr2[0] = 99;
System.out.println(arr1[0]);  // 输出 99，arr1 也被修改
```

| 特性 | 基本类型 | 引用类型 |
|-----|---------|---------|
| 存储位置 | 栈内存 | 堆内存（地址在栈） |
| 默认值 | 有默认值（0/false 等） | 默认值是 null |
| 比较方式 | `==` 比较值 | `==` 比较地址 |
| 传递方式 | 值传递 | 引用传递（本质还是值传递） |

## 类型转换规则

### 隐式转换（自动转换）

小类型 → 大类型，编译器自动完成：

```
byte → short → int → long → float → double
                  ↑
              char → int
```

```java
byte b = 100;
int i = b;    // 自动转换：byte → int
long l = i;   // 自动转换：int → long
double d = l; // 自动转换：long → double
```

为什么可以自动转换？因为大步长不会丢失数据（从取值范围小的转到大的）。

### 强制转换（显式转换）

大类型 → 小类型，需要手动强制转换：

```java
double d = 3.14;
int i = (int) d;    // 强制转换：double → int
System.out.println(i);  // 输出 3，小数部分被截断
```

**注意**：强制转换可能丢失数据，就像把大杯子里的水倒进小杯子——装不下就溢出了。

### 常见面试题：short 的陷阱

```java
short s1 = 1;
// s1 = s1 + 1;      // 编译错误！
s1 += 1;             // 编译通过
```

为什么 `s1 = s1 + 1;` 会编译错误？

因为 `s1 + 1` 运算时，`s1` 会自动提升为 `int` 类型，结果也是 `int`。把 `int` 赋给 `short`，需要强制转换：

```java
s1 = (short) (s1 + 1);  // 正确写法
```

而 `s1 += 1` 是复合赋值运算符，**编译器会自动处理类型提升**，相当于 `s1 = (short) (s1 + 1);`。

这个规则适用于所有整数类型：

```java
byte b = 1;
// b = b + 1;       // 编译错误
b += 1;              // OK
```

## Integer 包装类的比较问题

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b);  // true

Integer c = 128;
Integer d = 128;
System.out.println(c == d);  // false
```

这涉及到 Integer 缓存池，下一篇会详细讲解。现在只需要记住：**整数包装类比较要用 `equals()`**。

## 数值溢出问题

```java
int i = Integer.MAX_VALUE;  // 2147483647
System.out.println(i + 1);   // 输出 -2147483648（变成负数）
```

整数溢出不会抛出异常，是静默发生的。这是一道经典的面试题：

```java
// 这是一个死循环！
for (int i = 0; i < Integer.MAX_VALUE; i++) {
    // i 达到最大值后会变成负数，继续循环
}
```

正确做法：

```java
for (int i = 0; i < Integer.MAX_VALUE - 1; i++) {
    // 确保不会溢出
}
```

## 留给你的思考题

```java
int i = 1;
double d = 1.0;
System.out.println(i == d);  // 输出什么？
```

答案是 `true`。`int` 会自动提升为 `double` 进行比较。这引出了一个问题：**在进行数值比较时，是用 `==` 还是用 `equals()`？**

对于基本类型，用 `==`；对于包装类，`==` 比较的是地址，`equals()` 比较的是值。但如果你写成 `new Integer(1).equals(1.0)`，结果又是什么呢？

---

**面试追问方向：**

1. `1.0` 和 `1` 在 Java 中有什么区别？它们分别是什么类型？
2. 为什么浮点数比较不适合用 `==`？应该如何比较两个浮点数？
3. `short s1 = 1; s2 = s1 + 1;` 和 `short s1 = 1; s1++;` 有什么区别？
4. Java 的基本类型存储在栈还是堆？JVM 是如何分配的？
