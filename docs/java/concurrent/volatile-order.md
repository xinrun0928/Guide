# volatile 有序性原理：禁止指令重排序

看下面这段代码：

```java
public class Singleton {
    private static Singleton instance;
    
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();  // 关键
                }
            }
        }
        return instance;
    }
}
```

这是 DCL 单例模式，看似完美。

**但它真的安全吗？**

---

## 什么是重排序？

**重排序**：编译器或 CPU 为了优化性能，调整了指令的执行顺序。

重排序分两种：

| 类型 | 发生阶段 | 责任方 |
|-----|---------|-------|
| 编译器重排序 | 编译时期 | JVM 编译器 |
| CPU 重排序 | 运行时期 | 处理器 |

**重要前提**：重排序不会影响**单线程**程序的执行结果。

```java
int a = 1;      // 指令1
int b = 2;      // 指令2
int c = a + b;  // 指令3

// 单线程下，无论执行顺序如何，c 一定是 3
// 编译器可能重排序成：b=2 → a=1 → c=3
// 结果不变
```

但在**多线程**环境下，重排序可能导致问题。

---

## volatile 有序性：内存屏障

volatile 通过插入**内存屏障**来禁止重排序。

### 四种内存屏障

| 屏障类型 | 作用 |
|---------|------|
| LoadLoad | 禁止上面的 Load 和下面的 Load 重排 |
| StoreStore | 禁止上面的 Store 和下面的 Store 重排 |
| LoadStore | 禁止上面的 Load 和下面的 Store 重排 |
| StoreLoad | 禁止上面的 Store 和下面的 Load 重排 |

**最全面的是 StoreLoad**，它同时具备其他三种屏障的效果，但开销也最大。

### volatile 读写的屏障插入规则

```
volatile 读操作后插入 LoadLoad + LoadStore 屏障：

普通读 ── volatile 读 ──┬── LoadLoad 屏障 ── 后续普通读/写
                       │
                       └── LoadStore 屏障 ── 后续写操作

volatile 写操作前插入 StoreStore 屏障：

普通写 ── volatile 写 ──┬── StoreStore 屏障 ── 后续写操作
                       │
                       └── StoreLoad 屏障 ── 后续读操作
```

---

## 具体示例

### volatile 写之前

```java
a = 1;              // 普通写
b = 2;               // 普通写
volatileWriteFlag;   // volatile 写 ←─ 插入 StoreStore 屏障
x = b;               // 后续写操作
```

**屏障效果**：a=1 和 b=2 不能重排到 volatile 写**之后**。

### volatile 写之后

```java
volatileWriteFlag;   // volatile 写
y = a;               // 后续读 ←─ 插入 StoreLoad 屏障
z = b;               // 后续写
```

**屏障效果**：volatile 写不能重排到 y=a **之后**。

### volatile 读之前

```java
x = b;               // 普通读
volatileReadFlag;    // volatile 读 ←─ 插入 LoadLoad 屏障
y = a;               // 后续读
z = c;               // 后续写
```

**屏障效果**：x=b 不能重排到 volatile 读**之后**。

### volatile 读之后

```java
volatileReadFlag;    // volatile 读
y = a;               // 后续读 ←─ 插入 LoadStore 屏障
z = c;               // 后续写
```

**屏障效果**：volatile 读不能重排到 y=a **之后**。

---

## DCL 单例的问题

回到开头的 DCL 单例模式：

```java
instance = new Singleton();
```

这条语句在 CPU 层面可能分解为三个操作：

```java
// 1. 分配内存
memory = allocate();

// 2. 调用构造函数
constructor(memory);

// 3. 将引用赋值给 instance
instance = memory;
```

**问题**：由于重排序，第 3 步可能先于第 2 步执行！

```
时序问题：

正常顺序：              重排序后的顺序：
1. 分配内存             1. 分配内存
2. 调用构造函数          2. instance = memory  ← 先赋值！
3. instance = memory    3. 调用构造函数        ← 后执行

在重排序情况下：
- 线程 A 执行完步骤 2（instance 指向对象）
- 线程 B 发现 instance != null，直接返回
- 但此时对象还没有完成构造！
- 线程 B 拿到的是一个「未初始化完成」的对象
```

---

## DCL 的解决方案：volatile

给 `instance` 加 `volatile`：

```java
private static volatile Singleton instance;

public static Singleton getInstance() {
    if (instance == null) {
        synchronized (Singleton.class) {
            if (instance == null) {
                instance = new Singleton();  // 现在安全了
            }
        }
    }
    return instance;
}
```

**为什么 volatile 能解决？**

```
volatile 写 = StoreStore 屏障 + StoreLoad 屏障

StoreStore 屏障保证：
  分配内存 和 调用构造函数 不会重排到 volatile 写（instance = memory）之后

StoreLoad 屏障保证：
  volatile 写 不会重排到 后续读取 之前

结果：
  构造函数一定在 instance 赋值之前完成
  其他线程看到 instance != null 时，对象一定是初始化完成的
```

---

## 单例模式的演进

```java
// 方案 1：饿汉式（线程安全，但可能浪费资源）
class HungrySingleton {
    private static final HungrySingleton INSTANCE = new HungrySingleton();
    private HungrySingleton() {}
    public static HungrySingleton getInstance() { return INSTANCE; }
}

// 方案 2：DCL + volatile（JDK 5+，推荐）
class DCLSingleton {
    private static volatile DCLSingleton INSTANCE;
    private DCLSingleton() {}
    public static DCLSingleton getInstance() {
        if (INSTANCE == null) {
            synchronized (DCLSingleton.class) {
                if (INSTANCE == null) {
                    INSTANCE = new DCLSingleton();
                }
            }
        }
        return INSTANCE;
    }
}

// 方案 3：静态内部类（JDK 5+，利用类加载机制，推荐）
class StaticInnerSingleton {
    private StaticInnerSingleton() {}
    private static class Holder {
        static final StaticInnerSingleton INSTANCE = new StaticInnerSingleton();
    }
    public static StaticInnerSingleton getInstance() {
        return Holder.INSTANCE;  // 只有调用时才加载
    }
}

// 方案 4：枚举（最简洁，线程安全，防反射和反序列化）
enum EnumSingleton {
    INSTANCE;
    public void doSomething() {}
}
```

---

## 面试实战

**面试官问**：「volatile 是怎么保证有序性的？」

**普通回答**：
> volatile 通过内存屏障禁止指令重排序。

**深入回答**：
> volatile 的有序性通过在读写操作前后插入内存屏障实现。JMM 定义了四种屏障：LoadLoad、StoreStore、LoadStore、StoreLoad。
>
> volatile 写操作会在前面插入 StoreStore 屏障（防止上面的写重排到写之后），在后面插入 StoreLoad 屏障（防止写重排到后续读之前）。
>
> volatile 读操作会在后面插入 LoadLoad 和 LoadStore 屏障（防止后续读写重排到读之前）。
>
> 这些屏障组合起来，就形成了一个「有序性围墙」，把 volatile 变量的读写操作「固定」在特定位置，从而防止编译器和 CPU 的重排序优化。

---

## 总结

| 屏障位置 | 插入的屏障 | 作用 |
|---------|----------|------|
| volatile 写之前 | StoreStore | 禁止前面的写重排到写之后 |
| volatile 写之后 | StoreLoad | 禁止写重排到后续读之前 |
| volatile 读之后 | LoadLoad + LoadStore | 禁止后续读写重排到读之前 |

**volatile 保证**：对 volatile 变量的操作，既不能重排到它之前，也不能重排到它之后。

---

## 留给你的思考题

下面代码会输出什么？

```java
public class OrderDemo {
    private int a = 0;
    private int b = 0;
    private volatile int x = 0;
    private volatile int y = 0;
    
    public void write() {
        a = 1;      // 1
        b = 2;      // 2
        x = 10;     // 3 volatile 写
        y = 20;     // 4 volatile 写
    }
    
    public void read() {
        // 线程 B 读取
    }
}
```

线程 A 执行 `write()`，线程 B 执行 `read()`。线程 B 最多能读到哪些组合的值？

（提示：考虑重排序和内存屏障的约束）
