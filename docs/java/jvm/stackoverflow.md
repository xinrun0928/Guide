# 虚拟机栈溢出：递归调用的陷阱

栈溢出（StackOverflowError）是最容易被「制造」出来的 OOM。

一个没有正确退出条件的递归，就能让你的程序崩溃。

---

## 栈溢出的原因

### 递归调用没有正确退出条件

```java
public class StackOverflowDemo {
    public static void main(String[] args) {
        recursive();  // 无穷递归
    }

    private static void recursive() {
        recursive();  // 没有退出条件
    }
}
```

### 异常输出

```
Exception in thread "main" java.lang.StackOverflowError
    at StackOverflowDemo.recursive(StackOverflowDemo.java:9)
    at StackOverflowDemo.recursive(StackOverflowDemo.java:9)
    at StackOverflowDemo.recursive(StackOverflowDemo.java:9)
    ...（无限重复堆栈）
```

---

## 栈结构解析

### 虚拟机栈结构

```
┌─────────────────────────────────────────────────────────────┐
│  虚拟机栈（VM Stack）                                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  线程                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  栈帧 3（方法 C）                                    │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │ 局部变量表                                  │    │   │
│  │  │ 操作数栈                                    │    │   │
│  │  │ 动态链接                                   │    │   │
│  │  │ 返回地址                                   │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  栈帧 2（方法 B）                                    │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │ 局部变量表                                  │    │   │
│  │  │ 操作数栈                                    │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  栈帧 1（方法 A / main）                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 栈帧内容

```java
public class StackFrame {
    public int calc(int a, int b) {
        int c = a + b;  // 操作数栈 + 局部变量表
        return c;
    }
}
```

---

## 栈大小配置

### -Xss 参数

```bash
# 默认栈大小（JDK 8）
# 64 位系统：1024KB
# 32 位系统：320KB

# 手动设置栈大小
java -Xss512k your.Application    # 512KB
java -Xss256k your.Application    # 256KB
java -Xss1m your.Application       # 1MB
```

### 栈大小与递归深度

```java
public class StackDepth {
    // 估算：每个栈帧约占用 1KB（包含局部变量、操作数栈等）
    private static int count = 0;

    private static void recursive() {
        count++;
        recursive();  // 1MB / 1KB ≈ 1024 次
    }
    // 如果 -Xss512k，递归约 512 次后溢出
    // 如果 -Xss256k，递归约 256 次后溢出
}
```

---

## 常见栈溢出场景

### 场景 1：递归调用

```java
public class RecursiveStackOverflow {
    // 错误：没有退出条件的递归
    public int fibonacci(int n) {
        // 没有 if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
    }

    // 正确：
    public int fibonacciFixed(int n) {
        if (n <= 1) return n;
        return fibonacciFixed(n - 1) + fibonacciFixed(n - 2);
    }
}
```

### 场景 2：循环调用（间接递归）

```java
public class IndirectRecursion {
    public void methodA() {
        // ...
        methodB();
    }

    public void methodB() {
        // ...
        methodA();  // 形成闭环
    }
}
```

### 场景 3：大对象作为局部变量

```java
public class LargeLocalObject {
    public void process() {
        // 错误：大数组占满栈空间
        byte[] buffer = new byte[10 * 1024 * 1024];  // 10MB 数组
    }

    // 正确：大对象放堆里
    public void processFixed() {
        byte[] buffer = new byte[10 * 1024 * 1024];  // 10MB 数组
        // 实际上，局部变量表中只存储引用（4/8 字节）
        // 但如果数组在操作数栈上操作，可能占用栈空间
    }
}
```

### 场景 4：深层框架调用

```java
public class DeepFramework {
    // 某些框架的嵌套调用很深
    // Spring AOP、MyBatis 动态代理等
    // 如果配置不当，可能导致栈溢出
    public void invoke() {
        // AOP 代理链很深
        // Spring Security 过滤器链很长
        // ORM 嵌套查询很深
    }
}
```

---

## 栈溢出 vs 堆溢出

| 对比项 | 栈溢出 | 堆溢出 |
|-------|-------|-------|
| 错误类型 | StackOverflowError | OutOfMemoryError: Java heap space |
| 触发原因 | 栈帧过多或单个栈帧过大 | 对象过多或泄漏 |
| 常见场景 | 递归、循环调用 | 内存泄漏、大对象 |
| 排查工具 | jstack | jmap、MAT |
| 解决方案 | 改递归为循环、增大栈 | 修复内存泄漏、增大堆 |

---

## 排查与修复

### 排查命令

```bash
# 查看线程堆栈
jstack <pid>

# 输出
"main" #1 prio=5 os_prio=31 tid=0x00007f8a18008800 nid=0x1703 runnable
    at StackOverflowDemo.recursive(StackOverflowDemo.java:9)
    at StackOverflowDemo.recursive(StackOverflowDemo.java:9)
    at StackOverflowDemo.recursive(StackOverflowError.java:9)
    ...

# 查找最深的堆栈
jstack <pid> | grep "at " | wc -l
```

### 修复方案

#### 方案 1：改递归为循环

```java
public class RecursiveToLoop {
    // 递归版本
    public int fibonacciRecursive(int n) {
        if (n <= 1) return n;
        return fibonacciRecursive(n - 1) + fibonacciRecursive(n - 2);
    }

    // 循环版本（推荐）
    public int fibonacciLoop(int n) {
        if (n <= 1) return n;
        int a = 0, b = 1;
        for (int i = 2; i <= n; i++) {
            int temp = a + b;
            a = b;
            b = temp;
        }
        return b;
    }
}
```

#### 方案 2：尾递归优化

```java
public class TailRecursion {
    // 尾递归：返回值只涉及递归调用
    public int factorialTail(int n, int result) {
        if (n == 1) return result;
        return factorialTail(n - 1, n * result);
    }
    // JVM 不支持尾递归优化（需要手动改循环）
    // Java 编译器不会优化尾递归
}
```

#### 方案 3：增大栈大小（临时方案）

```bash
# 不推荐：增大栈大小只是延缓问题
java -Xss2m your.Application
# 真正的问题没解决，只是栈更深了
```

#### 方案 4：使用显式栈

```java
public class ExplicitStack {
    // 用数组模拟栈，避免虚拟机栈溢出
    public void traverseWithExplicitStack(Node root) {
        if (root == null) return;
        Stack<Node> stack = new Stack<>();
        stack.push(root);
        while (!stack.isEmpty()) {
            Node node = stack.pop();
            // 处理节点
            if (node.right != null) stack.push(node.right);
            if (node.left != null) stack.push(node.left);
        }
    }
}
```

---

## 实战：定位栈溢出问题

### 步骤 1：复现问题

```bash
# 开启详细错误信息
java -XX:+ShowMessageBoxOnError -Xss256k your.App
# 发生 StackOverflowError 时会弹窗显示堆栈
```

### 步骤 2：分析堆栈

```bash
# 查看完整的堆栈信息
jstack <pid> > stack.log

# 分析：
# 1. 找出循环调用的入口
# 2. 确定递归深度
# 3. 找到没有正确退出的方法
```

### 步骤 3：代码修复

```java
// 修复前
public void processAll(Node node) {
    if (node == null) return;
    processAll(node.left);
    processAll(node.right);  // 如果 node 为环形结构，无限递归
}

// 修复后：添加访问标记
public void processAll(Node node) {
    if (node == null) return;
    if (node.visited) return;  // 防止环形结构
    node.visited = true;
    processAll(node.left);
    processAll(node.right);
}
```

---

## 面试追问方向

- StackOverflowError 和 OutOfMemoryError 有什么关系？
- `-Xss` 设置的栈大小是每个线程还是所有线程的总和？
- 递归调用为什么容易导致栈溢出？有没有不死递归的方法？
- 什么是尾递归？为什么 Java 不支持尾递归优化？
- 如果线上出现 StackOverflowError，如何快速定位问题代码？
- 大对象作为局部变量会导致栈溢出吗？为什么？
