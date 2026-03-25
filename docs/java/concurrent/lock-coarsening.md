# 锁消除与锁粗化：JVM 的自动优化

你知道吗？即使你的代码看起来需要同步，JIT 编译器可能在编译时把它「优化掉」。

这就是**锁消除**——JVM 判断一个锁不可能被多线程竞争，直接把它删掉。

而**锁粗化**则相反——把多个零散的加锁操作合并成一次。

---

## 锁消除：JIT 帮你「安全地偷懒」

### 什么是逃逸分析？

锁消除的前提是**逃逸分析**（Escape Analysis）。

逃逸分析研究的是：一个对象会不会「逃出」创建它的方法或线程。

```java
public class EscapeAnalysis {
    
    // 场景1：对象不逃逸
    public void method1() {
        StringBuilder sb = new StringBuilder();
        sb.append("a");
        sb.append("b");
        // sb 不会逃出 method1，可能被优化
    }
    
    // 场景2：对象逃逸
    public StringBuilder method2() {
        StringBuilder sb = new StringBuilder();
        sb.append("a");
        return sb;  // sb 逃逸了！
    }
    
    // 场景3：对象逃逸到线程
    public void method3() {
        list.add(new Object());  // 对象逃逸到其他线程
    }
}
```

### 逃逸分析的结论

| 逃逸范围 | 说明 | 优化可能 |
|---------|------|---------|
| 不逃逸 | 对象只在方法内使用 | 栈上分配、锁消除 |
| 方法逃逸 | 作为返回值或参数传出 | 不能栈上分配 |
| 线程逃逸 | 被其他线程访问 | 不能锁消除 |

### 锁消除的示例

```java
public class LockElisionDemo {
    
    // JIT 编译后，可能锁消除
    public String concat(String a, String b) {
        StringBuffer sb = new StringBuffer();
        sb.append(a);
        sb.append(b);
        return sb.toString();
    }
}
```

`StringBuffer` 的 `append()` 是 synchronized 的：

```java
// StringBuffer.append 源码（简化）
public synchronized StringBuffer append(String str) {
    super.append(str);
    return this;
}
```

但 JIT 编译后发现：
- `sb` 是方法内部创建的对象
- 没有 `return sb`
- 没有传给其他方法
- **sb 不会逃逸**

于是 JIT 会**消除这个 synchronized**！

```java
// JIT 优化后，实际执行的是
public String concat(String a, String b) {
    StringBuilder sb = new StringBuilder();  // StringBuffer → StringBuilder
    sb.append(a);
    sb.append(b);
    return sb.toString();
}
```

### 如何验证锁消除？

```java
public class LockEliminationTest {
    
    public static void main(String[] args) {
        long start = System.currentTimeMillis();
        
        // 循环足够多次，触发 JIT 编译
        for (int i = 0; i &lt; 100_000_000; i++) {
            concat("a", "b");
        }
        
        long end = System.currentTimeMillis();
        System.out.println("耗时: " + (end - start) + "ms");
    }
    
    public static String concat(String a, String b) {
        StringBuffer sb = new StringBuffer();
        sb.append(a);
        sb.append(b);
        return sb.toString();
    }
}
```

用 `-XX:+PrintCompilation` 可以看到编译日志，加 `-XX:-EliminateLocks` 可以禁用锁消除对比。

---

## 锁粗化：合并零散的锁

### 什么是锁粗化？

如果一个方法中有多次零散的 synchronized 调用，JIT 可能把它们合并成一次。

```java
// 优化前
public void process() {
    for (int i = 0; i &lt; 1000; i++) {
        synchronized (this) {
            counter++;
        }
    }
}

// JIT 优化后
public void process() {
    synchronized (this) {  // 只加锁一次
        for (int i = 0; i &lt; 1000; i++) {
            counter++;
        }
    }
}
```

### 为什么需要锁粗化？

加锁和解锁有开销：

```
每次 synchronized 的开销：
┌─────────────────────────────────────────────────┐
│  1. 获取锁（CAS 或系统调用）                      │
│  2. 执行临界区代码                               │
│  3. 释放锁                                       │
└─────────────────────────────────────────────────┘

1000 次小 synchronized vs 1 次大 synchronized：
前者开销是后者的 100 倍以上
```

### 锁粗化的边界

锁粗化不是无限制的，JIT 会在一个方法或循环范围内合并。

```java
// 不会粗化（方法边界）
public void methodA() {
    synchronized (this) { a++; }
}

public void methodB() {
    synchronized (this) { b++; }
}

// methodA() 和 methodB() 不会合并
```

---

## JIT 优化的完整流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    代码执行与 JIT 优化流程                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  源代码                                                           │
│     │                                                              │
│     ▼                                                              │
│  字节码（解释执行）                                                │
│     │                                                              │
│     ▼                                                              │
│  ┌─────────────────┐                                             │
│  │  方法调用计数器  │  ─── 热点代码阈值（默认 10000 次）           │
│  └────────┬────────┘                                             │
│           │ 达到阈值                                               │
│           ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    JIT 编译（后台进行）                   │    │
│  │                                                         │    │
│  │  ┌──────────────┐                                       │    │
│  │  │  逃逸分析     │ ──▶ 锁消除、栈上分配                   │    │
│  │  └──────────────┘                                       │    │
│  │  ┌──────────────┐                                       │    │
│  │  │  锁粗化分析   │ ──▶ 合并相邻 synchronized              │    │
│  │  └──────────────┘                                       │    │
│  │  ┌──────────────┐                                       │    │
│  │  │  内联优化     │ ──▶ 小方法直接内联                     │    │
│  │  └──────────────┘                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│           │                                                       │
│           ▼                                                       │
│  编译后的机器码（直接执行）                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 标量替换：更大的优化

锁消除往往和**标量替换**配合使用，效果更好。

### 什么是标量替换？

- **Scalar（标量）**：基本类型或不可拆分的对象（如 int、Object 引用）
- **Aggregate（聚合量）**：可以拆分的对象（如 Point{x, y}）

```java
// 标量替换前
public Point createPoint() {
    Point p = new Point(x, y);
    return p;
}

// 标量替换后（对象被拆散）
public int createPoint_x() {
    return x;
}

public int createPoint_y() {
    return y;
}
```

### 配合锁消除的效果

```java
public void process() {
    for (int i = 0; i &lt; 1000; i++) {
        synchronized (new Object()) {  // 每个循环都是新对象
            counter++;
        }
    }
}
```

这里每个循环都创建新对象，但由于：
1. 对象不逃逸
2. 每个对象只用一次

JIT 可以完全消除对象创建和锁操作！

---

## 实战注意事项

### 1. StringBuffer vs StringBuilder

```java
// 单线程环境下，StringBuilder 比 StringBuffer 更快
// 因为 StringBuffer 的 synchronized 不会被消除（可能被其他线程访问）
// 而 StringBuilder 没有锁开销

String s = "hello" + "world";  // 编译器优化为 StringBuilder
```

### 2. 不要手动「优化」同步代码

```java
// 有人会这样做
public void process() {
    Object lock = new Object();
    synchronized (lock) {  // 每次循环创建新锁
        // ...
    }
}

// 以为这样更快，但实际上：
// 1. 锁对象本身创建有开销
// 2. JIT 逃逸分析可能发现锁不逃逸，直接消除
// 3. 锁对象创建反而是浪费
```

### 3. 不要过度担心性能

JVM 的 JIT 优化已经非常成熟：

| 场景 | JIT 能做什么 |
|-----|------------|
| 单线程 | 消除所有不必要的锁 |
| 线程安全类内部 | 消除内部锁 |
| 对象不逃逸 | 栈上分配 + 锁消除 |
| 零散加锁 | 合并为粗锁 |

---

## 面试追问方向

1. **逃逸分析在哪些情况下会失败？**
   对象作为返回值、传给其他方法、存入静态字段、放入集合被其他线程访问等情况。

2. **锁消除和锁粗化可以同时生效吗？**
   可以。比如一个循环中的 synchronized 被锁粗化合并，然后整体被锁消除。

3. **为什么说 synchronized 性能已经不错了？**
   因为 JIT 会做逃逸分析、锁消除、锁粗化优化。在大多数场景下，synchronized 和 ReentrantLock 性能差距不大。

4. **有哪些 JIT 参数可以控制这些优化？**
   `-XX:+DoEscapeAnalysis` 开启逃逸分析，`-XX:+EliminateLocks` 开启锁消除，`-XX:+EliminateAllocations` 开启标量替换。

---

## 留给你的思考题

假设这样一个代码：

```java
public class OptimizationTest {
    
    // 单线程方法
    public long compute() {
        long sum = 0;
        for (int i = 0; i &lt; 10_000_000; i++) {
            sum += i;
        }
        return sum;
    }
    
    // 使用 StringBuffer
    public String build() {
        StringBuffer sb = new StringBuffer();
        for (int i = 0; i &lt; 10_000; i++) {
            sb.append(i);
        }
        return sb.toString();
    }
    
    public static void main(String[] args) {
        OptimizationTest test = new OptimizationTest();
        
        // 预热 JIT
        for (int i = 0; i &lt; 10; i++) {
            test.compute();
            test.build();
        }
        
        // 计时
        long start = System.nanoTime();
        for (int i = 0; i &lt; 10_000; i++) {
            test.compute();
        }
        System.out.println("compute 耗时: " + (System.nanoTime() - start) / 1_000_000 + "ms");
    }
}
```

**问题**：
1. `compute()` 方法中的 `sum` 变量会被 JIT 优化掉吗？
2. `build()` 中的 StringBuffer 锁会被消除吗？最终会用什么替代？
3. 如果把 `StringBuffer` 改成 `StringBuilder`，性能会有区别吗？为什么？
