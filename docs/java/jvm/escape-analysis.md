# 逃逸分析：对象的「旅行地图」

你有没有想过这个问题：

Java 创建的对象，一定在堆上分配吗？

大多数人脱口而出：**「是！」**

但这个答案并不完整。在 JDK 6 之后，JVM 引入了一项**逃逸分析（Escape Analysis）**技术，可以在特定条件下，把对象从堆分配变成栈分配，甚至完全消除对象分配。

这不只是理论——它是真实的优化手段，直接影响你代码的性能。

## 逃逸分析是什么

逃逸分析是 JIT 编译器在**运行时**分析对象动态作用域的技术。

它的核心问题是：**这个对象会「逃逸」出创建它的方法吗？**

### 三种逃逸状态

| 逃逸状态 | 说明 | 示例 |
|---------|------|------|
| 不逃逸（NotEscape） | 对象只在创建它的方法内使用 | 方法内 new 了一个对象，用完就丢 |
| 参数逃逸（ArgEscape） | 对象作为参数传递给其他方法 | `method(obj)` 中 obj 被传递 |
| 全局逃逸（GlobalEscape） | 对象逃逸到方法或线程外部 | 对象作为返回值、静态变量、逸出到其他线程 |

### 分析示例

```java
public class EscapeDemo {
    
    // 全局逃逸：作为返回值
    public Object createGlobal() {
        Object obj = new Object();
        return obj;  // 逃逸
    }
    
    // 参数逃逸：传给其他方法
    public void passToOther(Object obj) {
        System.out.println(obj.toString());  // 逃逸
    }
    
    // 不逃逸：只在这个方法内使用
    public int compute() {
        int a = 10;
        int b = 20;
        return a + b;  // 基本类型，不涉及对象
    }
    
    // 不逃逸：对象创建后立即消费
    public void localScope() {
        String s = new String("temp");
        System.out.println(s.length());
    }
}
```

## 三大优化手段

逃逸分析的价值在于，它能触发三项重要优化。

### 1. 标量替换（Scalar Replacement）

**标量**：基本数据类型和不可拆分的值（如 int、long、double）
**聚合量**：对象

**原理**：如果对象不逃逸，JIT 会把对象的成员变量拆解为独立的局部变量（标量），根本**不创建对象**。

```java
// 优化前
public Point createPoint() {
    Point p = new Point();
    p.x = 10;
    p.y = 20;
    return p;
}

// JIT 优化后（等效）
public int[] createPoint() {
    // 根本不需要创建 Point 对象
    // x 和 y 直接作为返回值的一部分
    return new int[]{10, 20};
}
```

这样做的结果是：
- **不需要分配堆内存**
- **不需要 GC 回收**
- **减少了内存访问**

### 2. 栈上分配（Stack Allocation）

如果对象不逃逸，直接在**栈帧**上分配，而不是堆上。

```java
public void method() {
    // 如果不逃逸，对象在栈上分配
    Node node = new Node();
    node.value = 1;
    process(node);
    // 方法结束，栈帧出栈，对象自动销毁
}
```

栈上分配的优势：

| 特性 | 堆分配 | 栈上分配 |
|-----|-------|---------|
| 分配速度 | 慢（需要 GC 管理） | 快（类似局部变量） |
| 回收方式 | GC 回收 | 栈帧出栈自动销毁 |
| 内存释放 | 不确定 | 确定（方法结束即释放） |

**重要提醒**：HotSpot 虚拟机实际上没有直接实现栈上分配，而是通过**标量替换**间接实现相同效果。

### 3. 同步消除（Lock Elision）

如果锁对象不逃逸，synchronized 根本不需要。

```java
public void syncDemo() {
    Object lock = new Object();
    synchronized (lock) {
        // 如果 lock 不逃逸，这个 synchronized 可以完全消除
        doSomething();
    }
}
```

为什么能消除？因为如果对象不会逃逸到其他线程，就不存在多线程竞争的问题，锁完全是多余的。

## 查看逃逸分析日志

### 开启逃逸分析

```bash
# 开启逃逸分析（默认开启）
-XX:+DoEscapeAnalysis

# 关闭逃逸分析（测试用）
-XX:-DoEscapeAnalysis

# 打印逃逸分析日志
-XX:+PrintEscapeAnalysis

# 打印标量替换日志
-XX:+PrintScalarReplacement
```

### 分析示例输出

开启 `-XX:+PrintEscapeAnalysis` 后，你会看到类似：

```
[Escape Analysis] State: NotEscape for NEW Object @ ...
[Escape Analysis] State: GlobalEscape for NEW Object @ ...
```

## 逃逸分析的限制

逃逸分析不是万能的：

| 限制 | 说明 |
|-----|------|
| 分析开销 | 分析本身需要时间，不一定合算 |
| 复杂场景 | 动态加载、反射可能破坏分析结果 |
| 保守策略 | JVM 倾向于保守，宁可不优化也不能出错 |
| 对象太大 | 栈空间有限，大对象不适合栈上分配 |

## 实战：逃逸分析的影响

### 场景：StringBuilder vs String

```java
// 场景 1：StringBuilder 不逃逸
public String buildString() {
    StringBuilder sb = new StringBuilder();
    sb.append("Hello");
    sb.append(" World");
    return sb.toString();  // toString() 返回新 String，不返回 sb
}
// JIT 可能直接优化成：return "Hello World";
```

```java
// 场景 2：StringBuilder 逃逸了
public StringBuilder buildAndReturn() {
    StringBuilder sb = new StringBuilder();
    sb.append("Hello");
    return sb;  // 返回 sb 对象本身，逃逸
}
```

### 场景：循环中的对象创建

```java
// 优化前：每次循环都创建 List
public List<Integer> badPattern() {
    List<Integer> list = new ArrayList<>();
    for (int i = 0; i < 100; i++) {
        list.add(process());  // process() 返回的对象可能逃逸
    }
    return list;
}

// 优化后：JIT 可能对内部循环做逃逸分析优化
```

## 面试追问方向

1. **HotSpot 虚拟机实际上没有实现栈上分配，那它是怎么达到类似效果的？**

提示：答案在标量替换。对象被拆成标量后，标量直接在栈上分配。

2. **逃逸分析可以消除 synchronized，这是否意味着写 synchronized 是浪费时间？**

提示：不是。JIT 的逃逸分析是基于运行时的，如果逃逸分析发现不逃逸，会优化；如果逃逸了，该加的锁还是得加。

3. **逃逸分析和 GC 有什么关系？逃逸分析优化后，还需要 GC 吗？**

提示：减少堆分配，减少 GC 压力，但 GC 仍然需要（处理其他真正需要堆分配的对象）。

---

## 留给你的思考题

考虑这样一个场景：

```java
public class EscapeTest {
    static List<Object> list = new ArrayList<>();
    
    public static void add(Object obj) {
        list.add(obj);  // obj 作为参数传入，会逃逸吗？
    }
    
    public static void main(String[] args) {
        Object local = new Object();
        add(local);
        // 此时 local 对象是什么逃逸状态？
    }
}
```

对象 `local` 作为参数传给 `add()` 方法，它会变成什么逃逸状态？答案会决定 JIT 是否会对它做优化。

提示：关键是看**引用**是否逃逸，不是看对象本身在哪里创建。
