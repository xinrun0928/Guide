# 线程安全三大特性：原子性、可见性、有序性

面试官问：「线程安全是什么？需要保证哪些特性？」

这是 Java 并发中最基础的问题，但很多人只能答出皮毛。

今天彻底搞清楚。

---

## 线程不安全的根源

先看一个经典的线程不安全问题：

```java
public class UnsafeCounter {
    private int count = 0;
    
    public void increment() {
        count++;
    }
    
    public int getCount() {
        return count;
    }
}

// 启动 10 个线程，每个执行 1000 次
// 期望结果：10000
// 实际结果：往往是 < 10000
```

为什么 `count++` 不是线程安全的？因为它不是一个原子操作。

---

## 特性一：原子性

**原子性**：一个操作要么全部执行，要么全部不执行，中间不会有任何其他操作穿插。

### 原子操作 vs 非原子操作

```java
// 原子操作（只需要一步）
count = 1;              // 赋值是原子的
obj = new Object();     // 引用赋值是原子的（在 64 位 JVM）

// 非原子操作（需要多步）
count++;                // 读取 → 修改 → 写入
count = count + 1;     // 同上
list.add(obj);          // 可能触发扩容
map.put(k, v);          // 可能触发 rehash
```

### `count++` 的分解

```java
// count++ 在字节码层面分解为：
getstatic #2 <Counter.count>   // 1. 从主内存读取 count 到栈
iconst_1                        // 2. 常量 1 入栈
iadd                            // 3. 相加
putstatic #2 <Counter.count>   // 4. 结果写回主内存

// 问题：这四步之间可能被其他线程插入！
```

### 保证原子性的方式

| 方式 | 说明 |
|-----|------|
| synchronized | 阻塞式，加锁保证同一时刻只有一个线程执行 |
| ReentrantLock | 可重入锁，比 synchronized 更灵活 |
| AtomicInteger | CAS + 自旋，无锁方案 |
| volatile + 原子类 | 只能保证单个变量的原子性 |

---

## 特性二：可见性

**可见性**：一个线程对共享变量的修改，其他线程能立即看到。

### 可见性问题演示

```
场景：两个线程操作同一个变量

初始状态：count = 0
           主内存
        ┌─────────┐
        │ count=0 │
        └─────────┘
             ↑
    ┌────────┼────────┐
    ↓        ↓        ↓
线程A缓存  线程B缓存  其他缓存
 count=0   count=0   count=0

问题：线程 A 修改了 count=1，但线程 B 缓存中可能还是 count=0
```

### 可见性问题的原因

1. **CPU 缓存**：线程可能工作在自己的 CPU 缓存中
2. **编译器优化**：编译器可能重排指令
3. **CPU 重排序**：流水线下指令可能并行执行

### 保证可见性的方式

```java
// volatile：写后立即刷新，读前立即读取
private volatile int count = 0;

// synchronized：unlock 前刷新，lock 后失效缓存
synchronized (lock) {
    count++;
}

// final：在构造函数完成后立即可见（需正确发布）
private final int count = 1;
```

### Happens-Before 关系

JMM 通过 **happens-before** 规则保证可见性：

```java
// 线程 A
int a = 1;              // 操作1
synchronized (lock) {
    x = 10;             // 操作2
}

// 线程 B
synchronized (lock) {
    int y = x;          // 操作3：一定能看到操作2的结果
}

int b = a;              // 操作4：一定能看到操作1的结果（程序顺序）
```

---

## 特性三：有序性

**有序性**：程序执行的顺序与代码顺序一致。

### 有序性问题的原因

1. **编译器优化**：调整不相关语句的顺序
2. **CPU 重排序**：流水线并行执行指令
3. **内存重排序**：Store Buffer、Load Buffer 的异步操作

### 有序性问题的例子

```java
// 代码顺序
int a = 1;       // 1
int b = 2;       // 2
int c = a + b;   // 3

// 编译器优化后（单线程下结果一致）
int b = 2;       // 2（先执行）
int a = 1;       // 1（后执行）
int c = a + b;   // 3

// 但多线程下可能出问题！
```

### 经典问题：DCL 单例

```java
public class Singleton {
    private static Singleton instance;
    
    public static Singleton getInstance() {
        if (instance == null) {           // 1. 第一次检查
            synchronized (Singleton.class) {
                if (instance == null) {   // 2. 第二次检查
                    instance = new Singleton();  // 3. 问题在这里
                }
            }
        }
        return instance;
    }
}
```

`instance = new Singleton()` 可能被重排序成：

```java
memory = allocate();      // 1. 分配内存
instance = memory;        // 2. 赋值（先！）
constructor(memory);      // 3. 构造（后！）
```

### 保证有序性的方式

| 方式 | 说明 |
|-----|------|
| synchronized | 保证临界区内不重排序 |
| volatile | 写前的操作不重排到写后，读后的操作不重排到读前 |
| Lock | 同 synchronized |

---

## 三大特性的关系

```
┌─────────────────────────────────────────────────────────────┐
│                    线程安全三大特性                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  原子性 ─────────────────────────────────────────────────   │
│  │                                                        │
│  │  保证方式：synchronized、Lock、AtomicInteger            │
│  │                                                        │
│  ▼                                                        │
│  可见性 ─────────────────────────────────────────────────   │
│  │                                                        │
│  │  保证方式：synchronized、volatile                       │
│  │                                                        │
│  ▼                                                        │
│  有序性 ─────────────────────────────────────────────────   │
│                                                             │
│  保证方式：synchronized、volatile、Lock                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 对比表格

| 特性 | 含义 | 被破坏的场景 | 保证方式 |
|-----|------|------------|---------|
| 原子性 | 操作不可分割 | 线程切换 | synchronized、Lock、Atomic* |
| 可见性 | 修改对其他线程可见 | CPU 缓存、编译器优化 | volatile、synchronized、final |
| 有序性 | 执行顺序与代码顺序一致 | 编译优化、CPU 重排 | volatile、synchronized、Lock |

---

## synchronized 全能保证

`synchronized` 是唯一能同时保证**原子性 + 可见性 + 有序性**的方式：

```java
synchronized (lock) {
    count++;  // 原子操作
}

// 相当于：
// 1. 获取锁
// 2. 可见性：线程间共享变量立即可见
// 3. 有序性：临界区内的代码不重排序
// 4. 释放锁（同时刷新缓存）
```

---

## volatile 的能力边界

```java
// volatile 保证：
// 1. 可见性：写后其他线程立即可见
// 2. 有序性：禁止指令重排序

// volatile 不保证：
// 1. 原子性：count++ 这样的复合操作不是原子的

volatile int count = 0;

// 这个不安全！
public void increment() {
    count++;  // ⚠️ 不是原子操作
}

// 这些安全
public void set() {
    count = 100;  // ✅ 赋值是原子操作
}

public int get() {
    return count;  // ✅ 读取是原子操作
}
```

---

## 面试实战

**面试官问**：「synchronized 能保证线程安全的哪些特性？」

**参考回答**：
> synchronized 能同时保证**原子性、可见性和有序性**。
>
> **原子性**：同一时刻只有一个线程能进入临界区，其他线程阻塞等待。
>
> **可见性**：线程进入 synchronized 会 invalid 其他线程的缓存，退出时会刷新写缓存到主内存。
>
> **有序性**：synchronized 内部的代码不会被重排序到临界区外部。
>
> 而 volatile 只能保证可见性和有序性，不能保证原子性。

**追问**：「volatile 和 synchronized 怎么选？」

**参考回答**：
> **volatile 适用场景**：
> - 只有一个线程写，多个线程读
> - 状态标志
> - 不涉及复合操作
>
> **synchronized 适用场景**：
> - 涉及多个变量的复合操作
> - 需要强一致性
> - 需要原子性的读-改-写操作

---

## 总结

```
线程安全 = 原子性 + 可见性 + 有序性

┌────────────┬───────────────────────────────────────────┐
│   特性      │                  说明                      │
├────────────┼───────────────────────────────────────────┤
│   原子性    │  操作不可分割，要么全执行，要么全不执行       │
│   可见性    │  一个线程的修改，其他线程立即可见             │
│   有序性    │  执行顺序与代码顺序一致                      │
└────────────┴───────────────────────────────────────────┘
```

---

## 留给你的思考题

下面代码是线程安全的吗？为什么？

```java
public class Question {
    private int value = 0;
    private volatile boolean ready = false;
    
    public void writer() {
        value = 42;        // 1
        ready = true;      // 2 volatile 写
    }
    
    public void reader() {
        if (ready) {       // 3 volatile 读
            System.out.println(value);  // 4
        }
    }
}
```

如果线程 A 调用 `writer()`，线程 B 调用 `reader()`，线程 B 一定能输出 42 吗？

（提示：考虑 happens-before 关系）
