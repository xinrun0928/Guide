# 异常体系：理解 Throwable 的家族族谱

---

想象一下，如果 Java 只有一个通用的 `Exception` 类，程序员 A 可能用 `Exception` 表示「文件不存在」，程序员 B 可能用它表示「密码错误」，程序员 C 可能用它表示「服务器宕机」。

代码会变成什么样？

```java
try {
    doSomething();
} catch (Exception e) {
    // 到底是哪种异常？不知道，只能笼统处理
}
```

混乱，对吧？所以 Java 从一开始就设计了**层次分明的异常体系**。理解这个体系，是写出健壮代码的前提。

## Throwable 家族族谱

Java 的异常体系是一个严格的树形结构：

```
Throwable
├── Error（错误）
│   ├── OutOfMemoryError
│   ├── StackOverflowError
│   ├── NoClassDefFoundError
│   └── ...
│
└── Exception（异常）
    ├── RuntimeException（非受检异常）
    │   ├── NullPointerException
    │   ├── ArrayIndexOutOfBoundsException
    │   ├── ClassCastException
    │   ├── IllegalArgumentException
    │   └── ...
    │
    └── 其他异常（受检异常）
        ├── IOException
        ├── SQLException
        └── ...
```

**两条设计哲学**：

- `Error`：程序无法处理的严重问题，发生了就让它崩吧
- `Exception`：程序可以处理的异常，需要捕获并处理

## Error：程序无法承受之重

`Error` 代表 JVM 或硬件层面的严重问题，应用程序不应该尝试捕获。

### 常见 Error

**OutOfMemoryError（OOM）**：内存耗尽

```java
// 无限创建对象，触发 OOM
List&lt;Object&gt; list = new ArrayList&lt;&gt;();
while (true) {
    list.add(new byte[1024 * 1024]); // 每次分配 1MB
}
```

**StackOverflowError**：栈溢出，通常是递归没写出口

```java
// 递归没有终止条件
public int infiniteRecursion() {
    return infiniteRecursion() + 1;
}
```

**NoClassDefFoundError**：找不到类定义

```java
// 编译时有这个类，运行时却没了
public class A {
    B b; // 编译通过，运行时可能找不到 B
}
```

**ThreadDeath**：线程被强行停止（已废弃）

---

**为什么 Error 不应该被捕获？**

因为捕获了也没用。想象一下：如果 JVM 堆内存都耗尽了，你还能做什么？大部分操作都需要内存，而内存已经没有了。

```java
try {
    // 这里发生了 OOM
} catch (OutOfMemoryError e) {
    // 你想释放一些对象腾出空间？
    // 但 new 任何对象都需要内存，可能连 catch 块都进不去
}
```

## Exception：程序可以处理的异常

`Exception` 代表程序运行中发生的各种异常情况，理论上应该被捕获和处理。

### RuntimeException：非受检异常

`RuntimeException` 及其子类被称为「非受检异常」或「运行时异常」，编译器不强制要求处理。

```java
// NullPointerException：空指针访问
String str = null;
System.out.println(str.length()); // NPE

// ArrayIndexOutOfBoundsException：数组越界
int[] arr = new int[5];
int x = arr[10]; // 越界

// ClassCastException：类型转换错误
Object obj = "hello";
Integer num = (Integer) obj; // ClassCastException

// IllegalArgumentException：参数非法
Thread t = new Thread();
t.setPriority(100); // 有效范围是 1-10，这是非法参数
```

### 其他受检异常

受检异常（Checked Exception）是编译器强制要求处理的：

```java
// IOException：需要显式处理
try {
    FileReader reader = new FileReader("file.txt");
    reader.read();
} catch (IOException e) {
    // 必须捕获或声明抛出
}

// SQLException：JDBC 中常见
try {
    Connection conn = DriverManager.getConnection(url);
} catch (SQLException e) {
    // 数据库操作必须处理 SQL 异常
}
```

## 异常链：追溯问题的根源

当一个异常导致另一个异常时，应该保留完整的异常链：

```java
try {
    // 业务操作
    doBusiness();
} catch (IOException e) {
    // 方式一：保留原异常作为 cause
    throw new BusinessException("业务处理失败", e);

    // 方式二：直接抛出原异常（不推荐）
    throw new RuntimeException(e);
}
```

### 如何获取异常链？

```java
public class ExceptionChainDemo {

    public void level1() {
        try {
            level2();
        } catch (Exception e) {
            // 获取原始异常
            System.out.println("原始异常：" + e.getCause());

            // 获取完整的异常链
            printChain(e);
        }
    }

    private void printChain(Throwable t) {
        System.out.println("异常链：");
        Throwable current = t;
        int level = 0;
        while (current != null) {
            System.out.println("  Level " + level + ": " + current.getClass().getName());
            System.out.println("    Message: " + current.getMessage());
            current = current.getCause();
            level++;
        }
    }
}
```

输出：

```
异常链：
  Level 0: BusinessException
    Message: 业务处理失败
  Level 1: IOException
    Message: 文件不存在
```

## 常见面试问题辨析

### Error vs Exception

| 特性 | Error | Exception |
|---|---|---|
| 处理必要性 | 不需要处理 | 需要处理 |
| 编译器检查 | 不检查 | 可能受检 |
| 发生场景 | JVM/硬件故障 | 业务逻辑错误 |
| 示例 | OOM, StackOverflow | NPE, IOException |

### RuntimeException vs 受检异常

| 特性 | RuntimeException | 受检异常 |
|---|---|---|
| 编译器检查 | 不检查 | 检查 |
| 处理要求 | 不强制 | 必须 try-catch 或 throws |
| 产生原因 | 通常是编程错误 | 外部因素 |
| 示例 | NPE, ClassCast | IOException, SQLException |

### 都是 RuntimeException 的一定是运行时异常吗？

不一定！继承自 RuntimeException 的是运行时异常，但所有 Error 也都是「运行时」才发生的，但这不代表 Error 是 RuntimeException。

```java
// Error 不是 RuntimeException
OutOfMemoryError instanceof RuntimeException // false

// 但它们都是 Throwable 的子类
OutOfMemoryError instanceof Throwable // true
```

## 异常处理的反模式

### 反模式一：捕获并吞掉异常

```java
// 错误：异常被吞掉，不知道发生了什么
try {
    doSomething();
} catch (Exception e) {
    // 什么都不做，或者只是 log 一行
    e.printStackTrace();
}

// 正确：要么处理，要么重新抛出
try {
    doSomething();
} catch (SpecificException e) {
    log.error("操作失败", e);
    throw new BusinessException("操作失败", e);
}
```

### 反模式二：捕获通用 Exception

```java
// 错误：模糊的异常处理
catch (Exception e) {
    // 你知道你捕获了什么吗？
}

// 正确：精确捕获
catch (FileNotFoundException e) {
    // 处理文件不存在
} catch (IOException e) {
    // 处理其他 IO 错误
}
```

### 反模式三：用异常做流程控制

```java
// 错误：异常用于正常流程
try {
    int value = map.get(key); // key 不存在会抛异常
    // ... 使用 value
} catch (NullPointerException e) {
    // key 不存在，设置为默认值
}

// 正确：用 containsKey 或 getOrDefault
Integer value = map.getOrDefault(key, defaultValue);
```

## 面试追问方向

- 为什么 `Error` 被设计成不需要捕获？
- 异常链的 `initCause()` 和构造函数传递 `cause` 有什么区别？
- 如何设计一个好的异常体系？

## 留给你的思考题

某大型项目中有这样一段代码：

```java
public void process() {
    try {
        doTask();
    } catch (Exception e) {
        log.error("任务处理失败", e);
    }
}
```

review 时，架构师说这个 catch 块写得很烂。

请问架构师的批评合理吗？如果你是代码作者，你会怎么改进？

提示：考虑异常类型的具体化、异常信息的完整性、是否需要向上传播等问题。
