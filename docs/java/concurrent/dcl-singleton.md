# DCL 单例模式与 volatile

你一定见过这样的单例模式代码：

```java
public class Singleton {
    private static Singleton instance;
    
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

面试官问：「这个单例模式安全吗？」

你说安全？可能只对了一半。

---

## 什么是 DCL？

**DCL（Double-Checked Locking，双重检查锁定）** 是一种延迟初始化的技术，目的是：

1. **减少同步开销**：只在第一次创建对象时加锁，之后直接返回
2. **保证线程安全**：通过 synchronized 保证只有一个线程创建对象

看起来很完美，对吧？

---

## DCL 的问题在哪里？

问题出在这行代码：

```java
instance = new Singleton();
```

这不是一个原子操作！它分解成三个步骤：

```java
// 步骤 1：分配内存
memory = allocate(Singleton.class);

// 步骤 2：调用构造函数
constructor(memory);

// 步骤 3：把引用赋值给 instance
instance = memory;
```

**重排序可能让步骤 3 先于步骤 2 执行！**

```
正常执行顺序：               重排序后的顺序：
1. allocate()               1. allocate()
2. constructor()            2. instance = memory  ← 先赋值！
3. instance = memory        3. constructor()     ← 后构造

结果差异：
- 正常情况下，instance 指向一个完整构造的对象
- 重排序后，instance 指向一个「未构造」的对象
```

---

## 问题场景演示

```
时间线：

T0  线程 A                    线程 B
    │                         │
    │  进入 getInstance()     │
    │  获取锁                  │
    │  判断 instance == null  │
    │                         │
T1  │  instance = new Singleton()
    │  (可能被重排序)          │
    │                         │
    │  分配内存 ✓              │
    │  instance = 内存地址    │  ← 先赋值！
    │  构造函数？             │
    │                         │
T2  │  释放锁                  │
    │                         │  进入 getInstance()
    │                         │  判断 instance != null ✓
    │                         │  return instance ← 返回不完整对象！
    │                         │
T3  │                         │  访问 instance 的方法
    │                         │  ← 可能触发 NPE 或读到垃圾值！
```

**线程 B 返回了一个「对象地址非 null，但对象未初始化」的不安全对象！**

---

## 为什么重排序会发生？

### 编译器重排序

JIT 编译器为了优化性能，可能调整指令顺序：

```java
instance = new Singleton();
// 编译器可能优化成：
temp = allocate();
instance = temp;
constructor(temp);  // 构造函数被移到最后
```

### CPU 流水线优化

现代 CPU 有多条流水线并行执行指令：

```
流水线：
Cycle 1    Cycle 2    Cycle 3    Cycle 4
[分配内存]  [赋值引用]  [构造对象]  [其他操作]
           ↑
           CPU 发现这行代码不依赖前面的结果，提前执行
```

### 硬件层面

CPU 的 Load 和 Store 单元可能重新排序 memory 操作。

---

## 为什么 synchronized 不能解决问题？

你可能会问：不是说 synchronized 保证可见性和有序性吗？

```java
synchronized (Singleton.class) {
    if (instance == null) {
        instance = new Singleton();
    }
}
```

**synchronized 只保证临界区内部的可见性和有序性，不保证临界区外的重排序！**

```
synchronized 只保证：

┌─────────────────────────┐
│      临界区内            │   ← 里面的操作不会被重排到外面
│  synchronized 保护      │   ← 外面的操作不会被重排到里面
└─────────────────────────┘

但 instance = new Singleton() 的内部重排序，
synchronized 是管不了的！
```

---

## 解决方案：volatile

给 `instance` 加 `volatile` 修饰符：

```java
public class Singleton {
    // 关键：加 volatile
    private static volatile Singleton instance;
    
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

---

## volatile 如何解决重排序问题？

### JDK 5+ 的 volatile 语义

JDK 5 增强了 volatile 的语义：**volatile 的读写具有happens-before 关系**。

```
volatile 写 = StoreStore 屏障 + StoreLoad 屏障

volatile 读 = LoadLoad 屏障 + LoadStore 屏障
```

### 屏障作用

```
instance = new Singleton();
          ↑
          │
          └── StoreStore 屏障：禁止上面的操作重排到此处
                                分配内存必须在赋值之前
                                
volatile 写本身（赋值）：
          ↓
          └── StoreLoad 屏障：禁止下面的操作重排到此处
                                赋值必须在构造完成之前
```

### 结果

```
volatile 后，instance = new Singleton() 的执行顺序：

1. allocate()          // 分配内存
2. constructor()       // 调用构造函数（在屏障保护下，不能重排）
3. instance = memory   // 赋值（不能重排到构造之前）

线程 B 看到 instance != null 时，对象一定是完整构造的！
```

---

## DCL 完整解析

```java
public class Singleton {
    // 1. volatile 禁止重排序
    private static volatile Singleton instance;
    
    private int value;  // 演示用字段
    
    // 2. 私有构造函数
    private Singleton() {
        this.value = 42;
    }
    
    public static Singleton getInstance() {
        // 第一次检查：减少同步开销（大部分场景跳过 synchronized）
        if (instance == null) {
            synchronized (Singleton.class) {
                // 第二次检查：确保只创建一个实例
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
    
    public int getValue() {
        return value;
    }
}
```

**为什么需要两次检查？**

| 检查 | 必要性 | 原因 |
|-----|-------|------|
| 外层 if | ✅ 必须 | 避免每次调用都竞争锁 |
| 内层 if | ✅ 必须 | 多个线程同时通过外层检查时，只有一个能创建 |

---

## 面试追问：为什么 volatile 能禁止重排序？

**标准回答**：
> volatile 写会在指令前后插入 StoreStore 和 StoreLoad 内存屏障。StoreStore 屏障禁止前面的写操作重排到 volatile 写之后，StoreLoad 屏障禁止 volatile 写和后面的读操作重排。这保证了对象构造一定在引用赋值之前完成。

**深入回答**：
> 从 CPU 层面看，StoreLoad 屏障会触发 Store Buffer 刷新到 L1/L2 缓存，并发送 Invalidate 信号。这个过程是串行的，保证了一定的前后顺序。
>
> 从 JMM 层面看，volatile 写和 volatile 读之间有 happens-before 关系。这不仅是编译器的约束，也是硬件的约束。在 x86 下，虽然 Store 操作不会重排，但其他架构（ARM/RISC-V）下是可能重排的，所以 volatile 必须加上屏障。

---

## DCL 的替代方案

### 方案一：静态内部类（推荐）

```java
public class Singleton {
    private Singleton() {}
    
    private static class Holder {
        static final Singleton INSTANCE = new Singleton();
    }
    
    public static Singleton getInstance() {
        return Holder.INSTANCE;
    }
}
```

**原理**：类的初始化由 JVM 的类加载机制保证线程安全，延迟加载。

### 方案二：枚举单例（最简洁）

```java
public enum Singleton {
    INSTANCE;
    
    public void doSomething() {}
}
```

**原理**：Java 规范保证枚举的实例化是线程安全的，且防反射、防反序列化。

### 方案三：直接用 synchronized（简单粗暴）

```java
public class Singleton {
    private static Singleton instance;
    
    public static synchronized Singleton getInstance() {
        if (instance == null) {
            instance = new Singleton();
        }
        return instance;
    }
}
```

**缺点**：每次调用都加锁，性能开销大。

---

## 面试实战

**面试官问**：「DCL 单例为什么要加 volatile？」

**参考回答**：
> DCL 的 `instance = new Singleton()` 不是原子操作，分解成三步：分配内存、调用构造函数、赋值引用。
>
> 在 JIT 编译优化和 CPU 流水线的作用下，赋值操作可能先于构造函数执行。这导致其他线程可能看到一个「引用非 null，但对象未构造」的不安全状态。
>
> 加 volatile 后，通过 StoreStore 屏障保证构造函数一定在赋值之前执行，通过 StoreLoad 屏障保证其他线程在读到非 null 引用时，对象一定已经构造完成。
>
> 这是 JDK 5 引入的改进，在 JDK 5 之前，即使加 volatile 也不安全。

---

## 总结

| 方案 | 线程安全 | 延迟加载 | 性能 | 推荐度 |
|-----|---------|---------|------|-------|
| DCL + volatile | ✅ | ✅ | ✅ 高 | ⭐⭐⭐⭐ |
| 静态内部类 | ✅ | ✅ | ✅ 高 | ⭐⭐⭐⭐⭐ |
| 枚举 | ✅ | ❌ | ✅ 高 | ⭐⭐⭐⭐ |
| synchronized | ✅ | ✅ | ❌ 低 | ⭐⭐⭐ |

---

## 留给你的思考题

下面这个 DCL 单例有问题吗？

```java
public class Singleton {
    private static Singleton instance;
    
    // 去掉 synchronized，只靠 volatile
    public static Singleton getInstance() {
        if (instance == null) {
            // 没有 synchronized
            instance = new Singleton();
        }
        return instance;
    }
}
```

（提示：两个线程同时判断 `instance == null` 并同时执行创建操作，会发生什么？）
