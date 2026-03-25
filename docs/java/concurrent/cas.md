# CAS 原理与三大问题

在并发编程中，如果你不想用锁，还有什么办法保证原子性？

答案是 **CAS（Compare-And-Swap）**。

---

## CAS 是什么？

**CAS（Compare-And-Swap）**，即比较并交换，是一种无锁算法。

核心思想：**三个参数（内存位置、期望值、新值），如果内存位置的值等于期望值，就更新为新值。**

```java
// CAS 的语义
public class CASOperation {
    // 伪代码
    public boolean compareAndSwap(int[] value, int expected, int newValue) {
        if (value[0] == expected) {
            value[0] = newValue;
            return true;
        }
        return false;
    }
}
```

---

## CAS 的底层实现

CAS 由 CPU 提供支持，在 x86 架构下是 `lock cmpxchg` 指令：

```asm
; CAS 的汇编实现
lock cmpxchg [esi], edi

; 语义：
; 如果 [esi] == eax，则 [esi] = edi
; 否则 eax = [esi]
; 返回比较结果
```

**关键点**：`lock` 前缀保证操作的原子性——在多核 CPU 上，它会锁定总线或缓存行，确保其他 CPU 无法同时访问。

```
lock cmpxchg 执行过程：

CPU 0                              CPU 1
   │                                  │
   ├─ 锁定总线 ──────────────────────→│
   │                                  │
   ├─ 比较 value 和 expected          │
   │                                  │
   ├─ 如果相等，value = newValue      │
   │                                  │
   ├─ 解锁总线 ──────────────────────→│
   │                                  │
   ▼                                  ▼
```

---

## CAS 在 Java 中的使用

Java 通过 `Unsafe` 类提供 CAS 支持：

```java
import sun.misc.Unsafe;

public class CASCounter {
    private static final Unsafe unsafe = Unsafe.getUnsafe();
    private static final long valueOffset;
    
    private volatile int value = 0;
    
    static {
        try {
            valueOffset = unsafe.objectFieldOffset(CASCounter.class.getDeclaredField("value"));
        } catch (NoSuchFieldException e) {
            throw new Error(e);
        }
    }
    
    public void increment() {
        int current;
        do {
            current = unsafe.getIntVolatile(this, valueOffset);
            // CAS：期望值是 current，新值是 current + 1
        } while (!unsafe.compareAndSwapInt(this, valueOffset, current, current + 1));
    }
    
    public int get() {
        return unsafe.getIntVolatile(this, valueOffset);
    }
}
```

**为什么 `increment()` 里面是循环？** 因为 CAS 可能失败，需要**自旋**重试。

---

## CAS 的执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                      CAS 执行流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   线程 A 执行 increment()                                    │
│                                                             │
│   1. 读取 value = 0                                         │
│                                                             │
│   2. CAS(value, 0, 1)                                       │
│      ┌─────────────────────────┐                           │
│      │ 比较：0 == 0 ？          │                           │
│      │ 是！→ 更新 value = 1     │                           │
│      │ 返回 true                │                           │
│      └─────────────────────────┘                           │
│                                                             │
│   3. 成功，退出循环                                         │
│                                                             │
│   ─────────────────────────────────────────────              │
│                                                             │
│   线程 B 执行 increment()（同时）                             │
│                                                             │
│   1. 读取 value = 0（此时 A 还没写回）                        │
│                                                             │
│   2. CAS(value, 0, 1)                                       │
│      ┌─────────────────────────┐                           │
│      │ 比较：0 == 0 ？          │                           │
│      │ 否！（value 已是 1）      │                           │
│      │ 返回 false               │                           │
│      └─────────────────────────┘                           │
│                                                             │
│   3. 失败，进入下一轮循环                                    │
│   4. 读取 value = 1                                         │
│   5. CAS(value, 1, 2) → 成功！                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## CAS 的三大问题

### 问题一：ABA 问题

**问题描述**：线程 A 和线程 B 同时读取 value = A，线程 A 将 value 改为 B 再改回 A，线程 B 发现 value 还是 A，就认为没人改过。

```
ABA 问题演示：

初始状态：value = A

T0  线程 A                    线程 B
    │                         │
    │  读取 value = A          │  读取 value = A
    │                         │
T1  │  CAS(value, A → B) ✓    │
    │                         │
T2  │  CAS(value, B → A) ✓    │
    │                         │
T3  │                         │  CAS(value, A → C)
    │                         │  ← 成功！但 A 已经历了 B
```

**危害**：ABA 问题在某些场景下会导致逻辑错误。比如栈的 `push`/`pop` 操作，ABA 可能导致「看似正常的」数据结构实际已经损坏。

**解决方案**：使用**版本号（时间戳）**，每次修改不仅更新值，还更新版本号。

```java
// AtomicStampedReference 解决 ABA 问题
import java.util.concurrent.atomic.AtomicStampedReference;

AtomicStampedReference<Integer> ref = new AtomicStampedReference<>(100, 0);

int stamp = ref.getStamp();
int[] holder = new int[1];
int value = ref.get(holder);

// 期望值是 100，期望版本是 stamp，期望新值 200，期望新版本 stamp+1
ref.compareAndSet(value, 200, holder[0], stamp + 1);
```

---

### 问题二：循环开销（自旋）

**问题描述**：高并发下，CAS 失败率很高，线程会一直自旋重试，消耗 CPU。

```
CAS 失败场景（竞争激烈时）：

线程 A  ──CAS──→  失败 ──重试──→  失败 ──重试──→  成功
                   ↑               ↑
              线程 B 抢占了       线程 C 抢占了

线程 B  ──CAS──→  失败 ──重试──→  成功
                   ↑
              线程 A 又抢占了
```

**解决方案**：
1. **限制自旋次数**：超过一定次数后改用其他策略
2. **自适应自旋**：JVM 根据最近成功次数动态调整自旋次数
3. **分散操作**：使用 LongAdder 分散竞争

---

### 问题三：范围限制

**问题描述**：CAS 只能操作单个变量，不能操作一组相关的变量。

```java
// 场景：需要同时更新两个相关变量
// CAS 无能为力
if (balance >= amount) {
    balance -= amount;
    transactionCount++;
    // 这两个操作必须是原子的！
}

// 普通 CAS 只能保证单个变量的原子性
unsafe.compareAndSwapInt(this, balanceOffset, oldBalance, newBalance);
// transactionCount 的更新无法保证原子性
```

**解决方案**：
1. 使用 **synchronized**（简单粗暴）
2. 使用 **锁**（ReentrantLock）
3. 将多个变量**封装成对象**，使用 **AtomicReference**

```java
// 封装成对象，用 AtomicReference 保证原子性
class AccountState {
    final int balance;
    final int transactionCount;
    
    AccountState(int balance, int transactionCount) {
        this.balance = balance;
        this.transactionCount = transactionCount;
    }
}

class AtomicAccount {
    private AtomicReference<AccountState> state;
    
    public void transfer(int amount) {
        state.updateAndGet(current -> 
            new AccountState(current.balance - amount, current.transactionCount + 1)
        );
    }
}
```

---

## CAS vs Synchronized

| 特性 | CAS | synchronized |
|-----|-----|--------------|
| 原理 | 无锁（硬件支持） | 有锁（OS 互斥） |
| 性能 | 高（无阻塞） | 低（线程阻塞/唤醒） |
| 复杂度 | 高（需处理失败） | 低（自动重试） |
| 公平性 | 非公平 | 可公平可非公平 |
| 范围 | 单变量 | 任意代码块 |
| 死锁风险 | 无 | 有（如果使用不当） |

---

## 面试实战

**面试官问**：「CAS 是什么？有什么问题？」

**参考回答**：
> CAS（Compare-And-Swap）是 CPU 提供的原子指令，通过三个参数实现无锁同步。Java 中的 `Unsafe.compareAndSwapInt()` 就是 CAS 的封装。
>
> CAS 有三个经典问题：
>
> **第一，ABA 问题**。线程 A 将 value 从 A 改成 B 再改回 A，线程 B 看到的还是 A，以为没人改过。解决方案是用版本号（AtomicStampedReference）。
>
> **第二，循环开销**。高并发下 CAS 失败率很高，线程会一直自旋重试，消耗 CPU。JVM 会自适应调整自旋次数。
>
> **第三，范围限制**。CAS 只能操作单个变量，不能保证多个相关变量的原子性。解决方案是将多个变量封装，用 AtomicReference 保证原子性。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                      CAS 核心要点                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  原理：三个参数（位置、期望值、新值），相等则更新              │
│                                                             │
│  优势：                                                       │
│    - 无锁设计，性能高                                        │
│    - 不会死锁                                               │
│    - 硬件指令支持                                           │
│                                                             │
│  问题：                                                       │
│    - ABA 问题（用版本号解决）                                │
│    - 循环开销（高并发下 CPU 浪费）                           │
│    - 范围限制（只能单变量）                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

假设有 1000 个线程同时对一个 `AtomicInteger` 执行 `incrementAndGet()`，最终结果一定是 1000 吗？

如果改成 1 个线程执行 1000 次，其他 999 个线程各执行 1 次呢？

（提示：考虑 CAS 的原子性和多线程竞争的影响）
