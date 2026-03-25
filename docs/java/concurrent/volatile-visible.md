# volatile 可见性原理：内存屏障

你的代码里有这样一个标志位：

```java
volatile boolean running = true;

public void run() {
    while (running) {
        // 业务逻辑
    }
}

public void stop() {
    running = false;  // 线程 B 设置为 false
}
```

线程 A 在循环中执行，线程 B 调用 `stop()` 设置 `running = false`。

**问题是：线程 A 什么时候会看到 `running = false`？**

---

## 什么是可见性？

先理解一下什么是可见性问题。

```
没有 volatile 时的情况：

线程 A 的 CPU          线程 B 的 CPU          主内存
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│ running=true│       │ running=true│       │ running=true│
│ (缓存副本)   │       │ (缓存副本)   │       │             │
└─────────────┘       └─────────────┘       └─────────────┘
     ↑                     ↑                     │
     │                     │                     │
     └───────── 可能永远不一致 ─────────┘
     
线程 B 写了主内存 running=false
但线程 A 的缓存可能还是 running=true
循环永远不会停止！
```

**可见性**：一个线程对共享变量的修改，什么时候能被其他线程看到。

---

## volatile 写：Store Barrier

当线程执行 volatile 写操作时，CPU 会执行 **Store Barrier（写屏障）**：

```java
volatile boolean running = true;

// 线程 B 执行
running = false;  // volatile 写
// 自动插入 Store Barrier
```

**Store Barrier 做了什么？**

1. 强制将工作内存中的数据**刷新到主内存**
2. 发送信号，通知其他 CPU **invalid 它们的缓存行**

```
Store Barrier 执行后：

线程 A 的 CPU          线程 B 的 CPU          主内存
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│ running=true│  ──X──│ running=false│      │ running=false│
│ (缓存副本)   │ invalid    (缓存副本)   │       │             │
└─────────────┘       └─────────────┘       └─────────────┘
     │                      │
     │   下次读取时从主内存获取 │
     └──────────────────────┘
```

**X 表示缓存行被标记为无效**。线程 A 下次读取 `running` 时，发现缓存失效，只能从主内存重新读取，发现值已经变成 `false`。

---

## volatile 读：Load Barrier

当线程执行 volatile 读操作时，CPU 会执行 **Load Barrier（读屏障）**：

```java
// 线程 A 执行
while (running) {  // volatile 读
    // 自动插入 Load Barrier
}
```

**Load Barrier 做了什么？**

1. 强制**从主内存读取最新值**
2. 无效化工作内存中的缓存副本

```
Load Barrier 执行后：

读取 running 时：
1. 先执行 Load Barrier
2. 从主内存读取最新值
3. 更新工作内存缓存
4. 返回读取结果
```

---

## 完整的可见性保证

volatile 写和 volatile 读的组合保证了可见性：

```
时间线：

T0  线程A                    线程B
    while(running) {
        │
T1      │ ── Load Barrier ──→ 读取主内存 running=true
    │   │ ←───────────────  │ 返回 true
    │
    │   (继续循环)             │
    │                         │
    │                    running = false
T2  │                   ── Store Barrier ──→ 写入主内存
    │                                              │
    │                   发送 invalid 信号 ─────────→│
    │
T3  │ ── Load Barrier ──→ 读取主内存 running=false
    │ ←───────────────  │
    │ (发现 false，退出循环)  │
```

---

## 内存屏障的底层实现

### x86 架构

在 x86 架构下，不同的屏障有不同的指令：

| 屏障类型 | x86 指令 | 说明 |
|---------|---------|------|
| Store Barrier | `SFENCE` | 强制刷新 Store Buffer 到内存 |
| Load Barrier | `LFENCE` | 强制刷新 Load Buffer |
| Full Barrier | `MFENCE` | SFENCE + LFENCE |

**好消息**：x86 的 Store 操作本身就是顺序_store_（不会重排），所以 x86 上的 volatile 写开销比 volatile 读大。

**坏消息**：x86 不提供原生的 Load Barrier 指令，所以 Load Barrier 通过缓存失效协议实现。

### ARM/RISC-V 架构

ARM 架构使用内存屏障指令 `DMB`（Data Memory Barrier）：

```asm
# volatile 写后插入
DMB ST   ; 等待 Store 完成后才能继续

# volatile 读前插入
DMB LD   ; 等待 Load 完成后才能继续

# 全屏障
DMB SY   ; 全部操作完成后才能继续
```

ARM 的内存模型比 x86 弱，屏障开销更大。

---

## 缓存一致性协议

Store Barrier 触发的缓存失效，依赖 **MESI 协议**（或它的变体）：

```
MESI 状态：

M (Modified)  - 已修改，数据与主内存不一致
E (Exclusive) - 独占，数据与主内存一致
S (Shared)    - 共享，多个缓存都有副本
I (Invalid)   - 无效，数据不在缓存中

当线程 B 执行 volatile 写时：
1. 发送 Invalidate 消息给所有持有该缓存行的 CPU
2. 其他 CPU 回复 Invalidate Acknowledge
3. 线程 B 将数据写入缓存行并标记为 Modified
4. 线程 A 下次读取时发现 Invalid，从主内存获取新数据
```

---

## volatile 可见性示意

```java
public class VisibleDemo {
    // 普通变量：可能不可见
    boolean running = true;
    
    // volatile 变量：保证可见
    volatile boolean flag = true;
}
```

```
┌────────────────────────────────────────────────────────────────┐
│                      内存屏障的作用                              │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   volatile 写 = Store Barrier + 缓存失效通知                     │
│                    ↓                                           │
│              强制刷新到主内存 + 通知其他 CPU 缓存失效               │
│                                                                │
│   volatile 读 = Load Barrier                                   │
│                    ↓                                           │
│              强制从主内存读取 + 无效化本地缓存                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 面试实战

**面试官问**：「volatile 是怎么保证可见性的？」

**普通回答**：
> volatile 通过内存屏障保证可见性。

**让面试官眼前一亮的回答**：
> volatile 可见性的实现依赖两部分：
>
> **第一，Store Barrier（写屏障）**：volatile 写会强制将数据刷新到主内存，并且发送 Invalidate 信号给其他 CPU，让它们缓存行失效。
>
> **第二，Load Barrier（读屏障）**：volatile 读会强制从主内存读取数据，无效化本地缓存。
>
> 这背后的功臣是 MESI 缓存一致性协议。当线程 B 修改 volatile 变量时，会通过总线广播 Invalidate 消息，其他 CPU 必须 Acknowledge 并清空自己的缓存行，线程 A 下次读取时发现缓存失效，只能从主内存读取，从而看到最新值。
>
> 需要注意的是，x86 架构下 Store 操作本身不会重排，所以 volatile 写的开销更大；而 ARM 架构下内存模型更弱，需要显式的 DMB 指令。

---

## 总结

| 操作 | 内存屏障 | 作用 |
|-----|---------|------|
| volatile 写 | Store Barrier | 强制刷新到主内存，Invalidate 其他 CPU 缓存 |
| volatile 读 | Load Barrier | 强制从主内存读取，Invalidate 本地缓存 |

**重要提醒**：volatile 只保证可见性和有序性，**不保证原子性**！`i++` 这种复合操作，volatile 无法保证。

---

## 留给你的思考题

下面代码有什么问题？

```java
public class Counter {
    private volatile int count = 0;
    
    public void increment() {
        count++;  // 是原子操作吗？
    }
    
    public int getCount() {
        return count;
    }
}
```

如果两个线程同时调用 `increment()`，`getCount()` 最终一定是 2 吗？

（提示：`count++` 分解成哪几个操作？volatile 能保证这几个操作是原子的吗？）
