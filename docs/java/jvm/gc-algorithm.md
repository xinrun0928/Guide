# GC 判断对象存活：引用计数 vs 可达性分析

想象一个场景：

> 深夜，你打开一个内存分析工具，发现一个对象明明已经「没有人用了」，但它还活着。

这背后，是两种截然不同的**对象存活判断算法**在起作用。

---

## 引用计数法：简单但有致命缺陷

### 原理

每个对象都有一个**引用计数器**，记录被引用的次数：

- 对象被引用 → 计数器 +1
- 引用失效 → 计数器 -1
- 计数器为 0 → 对象已死，可回收

```java
// 引用计数示意
Object a = new Object();  // count = 1
Object b = a;              // count = 2
b = null;                  // count = 1
a = null;                  // count = 0，可回收
```

### 优点

- 判定简单，回收即时（计数器归零立即回收）
- 不需要 Stop The World

### 致命缺陷：循环引用

```java
public class CyclicReference {
    CyclicReference other;

    public static void main(String[] args) {
        CyclicReference obj1 = new CyclicReference();  // refCount = 1
        CyclicReference obj2 = new CyclicReference();  // refCount = 1

        obj1.other = obj2;  // obj1.count = 2
        obj2.other = obj1;  // obj2.count = 2

        obj1 = null;  // obj1.count = 1（还持有 obj2 的引用）
        obj2 = null;  // obj2.count = 1（还持有 obj1 的引用）
    }
}
```

两个对象互相引用，外部已经没有任何引用通路，但计数器都是 1，永远不会被回收。

**这就是为什么主流 JVM（HotSpot、ZGC 等）都不用引用计数法。**

---

## 可达性分析：JVM 的选择

### 原理

通过一系列 **GC Roots** 对象作为起始点，向下搜索。当一个对象到 GC Roots 没有任何引用链相连时，说明该对象不可达，可以回收。

```
        GC Roots
           │
     ┌─────┴─────┐
     ▼           ▼
  [A]          [B]
     │           │
     ▼           ▼
  [C]          [D] ←──┐
     │               │  循环引用
     ▼               │
  [E]  ←─────────────┘
```

上图中，D 和 E 循环引用，但都不与 GC Roots 相连，所以都是不可达的。

### GC Roots 包括哪些对象？

```
┌─────────────────────────────────────────────────────────────┐
│                      GC Roots                                │
├─────────────────────────────────────────────────────────────┤
│  1. 虚拟机栈（栈帧中的本地变量表）                           │
│     - 方法中引用的对象                                        │
│     - 方法参数、局部变量                                      │
│                                                             │
│  2. 方法区中的静态属性引用                                   │
│     - 类的 static 字段引用的对象                             │
│     - 类的常量引用                                           │
│                                                             │
│  3. JNI（Java Native Interface）引用的对象                   │
│     - 本地方法中引用的对象                                    │
│                                                             │
│  4. 同步锁持有的对象                                         │
│     - synchronized 锁住的对象                                 │
│                                                             │
│  5. 虚拟机内部的引用                                         │
│     - 常驻对象：Class 对象、类加载器                          │
│     - 异常对象：NullPointerException、OutOfMemoryError        │
│                                                             │
│  6. 跨代引用（用于 GC 算法的优化）                           │
│     - Old 区对 Young 区的引用                                │
└─────────────────────────────────────────────────────────────┘
```

### 可达性分析的完整流程

```java
public class GCProcess {

    // 1. 第一次标记：从 GC Roots 开始标记
    //    找出所有可达对象，标记为"活的"

    // 2. 筛选：检查对象是否重写了 finalize()
    //    - 没重写：直接回收
    //    - 重写了：放入 F-Queue

    // 3. 第二次标记：执行 finalize() 后再次检查
    //    - 如果对象在 finalize() 中建立了引用链 → 逃脱
    //    - 否则 → 回收

    // 4. 对象彻底死亡
}

// 逃兽游戏
public class EscapeDemo {
    static EscapeDemo SAVE_HOOK = null;

    @Override
    protected void finalize() throws Throwable {
        super.finalize();
        System.out.println("finalize 被调用了！");
        // 在 finalize 中建立引用链
        SAVE_HOOK = this;
    }

    public static void main(String[] args) throws InterruptedException {
        SAVE_HOOK = new EscapeDemo();

        // 第一次回收：触发 finalize
        SAVE_HOOK = null;
        System.gc();
        Thread.sleep(500);

        // 第二次回收：对象已死
        if (SAVE_HOOK != null) {
            System.out.println("对象逃脱了！");
        } else {
            System.out.println("对象终于死了");
        }
    }
}
```

> 注意：`finalize()` 只会被调用一次，第二次 GC 时对象必死无疑。

---

## 引用计数 vs 可达性分析

| 对比项 | 引用计数 | 可达性分析 |
|-------|---------|-----------|
| 实现复杂度 | 简单 | 复杂 |
| 内存开销 | 需要计数器 | 需要额外数据结构 |
| 循环引用 | 无法处理 | 可以处理 |
| 实时性 | 高（立即回收） | 依赖 GC 停顿 |
| 准确性 | 可能误判 | 准确 |
| 主流 JVM 使用 | 不用 | 全部使用 |

---

## 对象引用链的四种状态

可达性分析后，对象处于不同的「生存状态」：

```
                    GC Roots
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
    可达（Reachable）           不可达（Unreachable）
         │                             │
    ┌────┴────┐                ┌────────┴────────┐
    ▼         ▼                ▼                 ▼
  finalizer   可回收     只等 finalize()      直接回收
  逃脱者
```

---

## 跨代引用：GC 的优化

一个实际的问题：

> Old 区的对象如何发现 Young 区的对象？

简单方案：扫描整个 Old 区 → 太慢！

**解决方案：跨代引用**

- 在 Old 区维护一个 **Remembered Set**（记忆集）
- 记录哪些 Old 区对象引用了 Young 区对象
- GC Young 时，只扫描 Remembered Set 中的 Old 对象，而不是整个 Old 区

```java
// 跨代引用示意
public class CrossGenerationReference {
    // Young 对象
    private Object youngObject = new Object();

    // Old 对象持有 Young 对象的引用
    private Object oldObject = new Object();

    // 当 oldObject 持有 youngObject 引用时
    // Old 区的 Remembered Set 会记录这个关系
}
```

---

## 面试追问方向

- 哪些对象可以作为 GC Roots？本地变量表中的变量可以作为 GC Roots 吗？
- 如果一个对象的 `finalize()` 方法执行时间很长，会影响 GC 吗？
- 为什么主流 JVM 不使用引用计数法？Python 用的是引用计数 + 循环引用检测，有什么区别？
- 在 G1 中，Remembered Set 的实现原理是什么？Card Table 和 RSet 的关系？
