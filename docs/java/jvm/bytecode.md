# 字节码：JVM 的「方言」

你有没有想过，当你在 IDEA 里写下一行 `System.out.println("Hello")`，JVM 看到的是什么？

不是 Java 代码，不是汇编指令，而是一串「指令码」——这就是字节码。

如果说 Java 是一门「一次编写，到处运行」的语言，那字节码就是这套承诺的技术基石。它是介于源代码和机器码之间的中间表示，既保留了 Java 的语义，又足够接近机器指令，能被 JVM 快速执行。

理解字节码，你就能看透代码背后的执行逻辑；理解字节码，面试中问到的 synchronized 原理、泛型类型擦除、方法调用机制，都能给出让人眼前一亮的答案。

## 字节码的本质

Java 源代码经过编译器（javac）编译后，生成 `.class` 文件。这个文件里装的，就是字节码。

```
.java 源文件 --javac编译--> .class 字节码文件 --> JVM 执行
```

字节码文件是二进制格式的，但我们可以借助工具把它「翻译」成人类可读的形式。这就是接下来要讲的 `javap` 工具。

## 常用字节码指令分类

JVM 定义了约 200 条字节码指令，分为以下几大类：

### 加载与存储指令

负责在局部变量表和操作数栈之间搬运数据。

| 指令 | 说明 |
|-----|-----|
| `iload` / `istore` | 加载/存储 int 类型 |
| `lload` / `lstore` | long 类型 |
| `aload` / `astore` | 引用类型（对象、数组） |
| `dup` | 复制栈顶元素 |

```java
public int loadExample() {
    int a = 10;      // istore_1（存储到局部变量槽1）
    int b = 20;      // istore_2
    return a + b;    // iload_1, iload_2, iadd
}
```

### 运算指令

执行基本的算术运算。

```java
public int calc(int a, int b) {
    return a + b;    // iadd
}

public int complex() {
    int a = 10;
    int b = 3;
    return a / b;    // idiv
}
```

| 指令族 | 说明 |
|-------|-----|
| `iadd` / `isub` / `imul` / `idiv` | int 的加减乘除 |
| `fadd` / `fsub` / `fmul` / `fdiv` | float 运算 |
| `iinc` | 局部变量自增（for 循环常用） |

### 类型转换指令

不同数值类型之间的转换。

```java
public long intToLong(int a) {
    return a;        // i2l（int to long）
}

public double intToDouble(int a) {
    return a;        // i2d（int to double）
}
```

| 指令 | 说明 |
|-----|-----|
| `i2l` / `i2f` / `i2d` | int 转 long/float/double |
| `l2i` / `f2d` 等 | 其他类型转换 |

### 对象创建与访问

创建对象、访问字段、调用方法。

```java
public class Person {
    private String name;
    public Person(String name) {
        this.name = name;
    }
}
```

对应的构造器字节码简化版：

```java
public Person(java.lang.String);
  aload_0              // 加载 this 引用
  invokespecial #1     // 调用父类 Object 构造器
  aload_0              // 加载 this
  aload_1              // 加载参数 name
  putfield #2          // 将 name 赋值给 this.name
  return               // 返回
```

| 指令 | 说明 |
|-----|-----|
| `new` | 创建对象 |
| `newarray` | 创建数组 |
| `getfield` / `putfield` | 访问实例字段 |
| `getstatic` / `putstatic` | 访问静态字段 |

### 方法调用指令

这是面试中的重点，需要区分四种指令：

| 指令 | 触发场景 | 能否重写 |
|-----|---------|---------|
| `invokevirtual` | 普通实例方法（虚方法调用） | 能 |
| `invokespecial` | 构造器、私有方法、父类方法 | 不能 |
| `invokestatic` | 静态方法 | 不能 |
| `invokeinterface` | 接口方法调用 | 能 |

```java
public interface Drawable {
    void draw();
}

public class Circle implements Drawable {
    @Override
    public void draw() { }  // invokeinterface
}

public class Shape {
    public void display() { }  // invokevirtual
    
    public static void print() { }  // invokestatic
    
    private void init() { }  // invokespecial
}
```

### 控制转移指令

相当于代码中的 if/else、for、while。

```java
public boolean compare(int a, int b) {
    if (a > b) {
        return true;
    }
    return false;
}
```

| 指令 | 说明 |
|-----|-----|
| `ifeq` / `ifne` | 等于/不等于零跳转 |
| `if_icmpgt` / `if_icmplt` | int 比较跳转 |
| `goto` | 无条件跳转 |
| `lookupswitch` | switch-case（稀疏） |
| `tableswitch` | switch-case（密集） |

### 同步指令

与 synchronized 关键字对应。

```java
public synchronized void method() {
    // do something
}
```

编译后会生成 `monitorenter` 和 `monitorexit` 指令：

- `monitorenter`：获取 monitor（锁）
- `monitorexit`：释放 monitor（锁）

synchronized 代码块会生成两条 monitorexit——一条正常退出，一条异常退出。这是 JVM 帮你加的保险。

## 查看字节码

使用 JDK 自带的 `javap` 工具：

```bash
javap -c ClassName        # 显示字节码指令
javap -v ClassName       # 详细信息（常量池、局部变量表）
javap -p ClassName       # 显示私有成员
javap -c -verbose ClassName  # 最完整输出
```

示例代码：

```java
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
```

查看字节码：

```bash
javap -c Calculator
```

输出：

```
public int add(int, int);
  Code:
     0: iload_1        // 加载局部变量 a
     1: iload_2        // 加载局部变量 b
     2: iadd           // 相加
     3: ireturn        // 返回 int 结果
```

## 实战：分析 synchronized 字节码

```java
public class SyncDemo {
    private final Object lock = new Object();
    
    public void doSync() {
        synchronized (lock) {
            System.out.println("Hello");
        }
    }
}
```

对应的字节码：

```
public void doSync();
  Code:
     0: aload_1           // 加载 lock 对象引用
     1: dup                // 复制一份（后面 monitorexit 用）
     2: astore_2          // 存到局部变量槽2
     3: monitorenter      // 进入同步块，获取锁
     4: getstatic #2      // 获取 System.out
     7: ldc #3            // 加载字符串 "Hello"
     9: invokevirtual #4  // 调用 println
    12: aload_2           // 加载 lock 引用
    13: monitorexit       // 退出同步块，释放锁
    14: goto 21            // 跳到 21，正常结束
    17: aload_2           // 异常路径：加载 lock
    18: monitorexit       // 退出锁（确保异常时也能释放）
    19: athrow            // 重新抛出异常
    21: return
```

可以看到，编译器自动为异常退出路径加了 `monitorexit`，确保锁一定能被释放。

## 面试追问方向

1. **虚方法调用 invokevirtual 的查找过程是怎样的？**

提示：涉及方法表（vtable）、接口方法表（itable）、运行时类型检查。

2. **为什么 synchronized 能保证可见性？**

提示：不只是 monitorenter/monitorexit 的互斥特性，还有内存屏障的作用。

3. **构造器中的 this 逃逸是什么？如何在字节码层面理解？**

提示：看构造器里 return 之前是否有逸出 this 的操作。

---

## 留给你的思考题

synchronized 代码块里面如果抛出异常，锁会怎样？

想想看：`try-catch` 包裹的 synchronized 块，和 synchronized 块内部的 try-catch，行为一样吗？
