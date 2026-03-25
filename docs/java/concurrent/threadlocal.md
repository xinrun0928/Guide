# ThreadLocal 原理与内存泄漏

`ThreadLocal` 是 Java 并发编程中常用的工具，用于实现线程隔离。

但它也是内存泄漏的「重灾区」，很多人用错了却不自知。

今天彻底搞清楚。

---

## ThreadLocal 是什么？

`ThreadLocal` 提供了**线程本地变量**——每个线程访问的都是自己的独立副本，互不干扰。

```
┌─────────────────────────────────────────────────────────────┐
│                     ThreadLocal 工作原理                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   线程 A                    线程 B                    线程 C│
│   ┌─────────┐              ┌─────────┐              ┌─────────┐
│   │ ThreadLocal │          │ ThreadLocal │          │ ThreadLocal │
│   │ ┌─────┐   │          │ ┌─────┐   │          │ ┌─────┐   │
│   │ │ A的值 │   │          │ │ B的值 │   │          │ │ C的值 │   │
│   │ └─────┘   │          │ └─────┘   │          │ └─────┘   │
│   └─────────┘              └─────────┘              └─────────┘
│                                                             │
│   每个线程只能看到自己的值！                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 基本使用

```java
public class ThreadLocalDemo {
    // 创建 ThreadLocal
    private static final ThreadLocal<String> threadLocal = 
        ThreadLocal.withInitial(() -> "默认值");
    
    public static void main(String[] args) {
        // 主线程设置
        threadLocal.set("主线程的值");
        System.out.println(threadLocal.get());  // 主线程的值
        
        // 子线程访问（默认没有继承父线程的值）
        new Thread(() -> {
            System.out.println(threadLocal.get());  // 默认值
        }).start();
    }
}
```

---

## 源码解析

### ThreadLocalMap

每个 `Thread` 对象内部都有一个 `ThreadLocalMap`：

```java
public class Thread implements Runnable {
    // ThreadLocal 的数据结构存储在这里
    ThreadLocal.ThreadLocalMap threadLocals = null;
}
```

`ThreadLocalMap` 是 `ThreadLocal` 的内部类，使用 Entry 数组存储数据：

```java
static class ThreadLocalMap {
    // Entry 继承 WeakReference<ThreadLocal<?>>
    // key 是弱引用，value 是强引用
    static class Entry extends WeakReference<ThreadLocal<?>> {
        Object value;
        Entry(ThreadLocal<?> k, Object v) {
            super(k);
            value = v;
        }
    }
    
    private Entry[] table;
}
```

### 关键结构图

```
┌─────────────────────────────────────────────────────────────┐
│                    ThreadLocal 内存结构                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Thread 对象                                               │
│   ┌─────────────────────────────────────────────────┐     │
│   │ ThreadLocalMap threadLocals                      │     │
│   │ ┌─────────────────────────────────────────────┐ │     │
│   │ │ Entry[] table                               │ │     │
│   │ │ ┌────────┐ ┌────────┐ ┌────────┐          │ │     │
│   │ │ │ Entry  │ │ Entry  │ │ Entry  │ ...       │ │     │
│   │ │ │ key   │ │ key   │ │ key   │          │ │     │
│   │ │ │ (弱引用)│ │ (弱引用)│ │ (弱引用)│          │ │     │
│   │ │ │value  │ │value  │ │value  │          │ │     │
│   │ │ │(强引用)│ │(强引用)│ │(强引用)│          │ │     │
│   │ │ └────────┘ └────────┘ └────────┘          │ │     │
│   │ └─────────────────────────────────────────────┘ │     │
│   └─────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 内存泄漏的根源

### 为什么会泄漏？

**关键点**：
- `Entry` 的 key（`ThreadLocal` 对象）是**弱引用**
- `Entry` 的 value 是**强引用**

```
弱引用 vs 强引用：

┌─────────────────────────────────────────────────────────────┐
│  弱引用（WeakReference）                                    │
│  └─ 当对象只有弱引用时，GC 会回收                          │
│  └─ ThreadLocal 对象没有其他强引用时，GC 会回收             │
│  └─ 但 Entry 的 value 仍然是强引用！                        │
└─────────────────────────────────────────────────────────────┘
```

### 泄漏场景

```
时间线：

T0  ThreadLocal 对象被创建，存入 ThreadLocalMap
    ┌─────────────────────────────────────────┐
    │ Entry                                   │
    │ ┌───────────┐     ┌───────────┐        │
    │ │ ThreadLocal│ ──→ │  Value   │ ←─┐   │
    │ │ (强引用)   │     │ (强引用)  │   │   │
    │ └───────────┘     └───────────┘   │   │
    └─────────────────────────────────────────┘
                                              │
T1  ThreadLocal 对象不再被使用（无强引用）     │
    ┌─────────────────────────────────────────┐
    │ Entry                                   │
    │ ┌───────────┐     ┌───────────┐        │
    │ │ ThreadLocal│ ──→ │  Value   │ ←─┐   │
    │ │ (只剩弱引用)│   │ (强引用)  │   │   │
    │ └───────────┘     └───────────┘   │   │
    └─────────────────────────────────────────┘
                                              │
T2  GC 发生，ThreadLocal 对象被回收            │
    ┌─────────────────────────────────────────┐
    │ Entry                                   │
    │ ┌───────────┐     ┌───────────┐        │
    │ │ null      │     │  Value   │ ←─┐   │
    │ │ (key 变 null)│   │ (强引用，仍存在)│   │
    │ └───────────┘     └───────────┘   │   │
    └─────────────────────────────────────────┘
                                              │
T3  但 Entry 不会被清理！                      │
    value 无法访问，又无法被 GC 回收            │
    → 内存泄漏！                               │
```

### 为什么 Entry 不清理？

`ThreadLocalMap` 的 `get()` 和 `set()` 方法会**偶尔**清理过期的 Entry（key == null），但不是每次都清理。

---

## 最佳实践：手动 remove()

**唯一正确的做法**：使用完 ThreadLocal 后，调用 `remove()` 方法。

```java
public class ThreadLocalSafeUsage {
    private static final ThreadLocal<User> userHolder = 
        new ThreadLocal<>();
    
    public static void main(String[] args) {
        try {
            User user = new User();
            userHolder.set(user);
            
            // 业务逻辑
            doSomething();
            
        } finally {
            // 关键！使用完毕后必须 remove
            userHolder.remove();
        }
    }
}
```

### try-finally 模式

```java
ThreadLocal<List<String>> listHolder = new ThreadLocal<>();

try {
    List<String> list = new ArrayList<>();
    listHolder.set(list);
    
    // 业务逻辑
    process(list);
    
} finally {
    listHolder.remove();  // 清理
}
```

### try-with-resources 模式（Java 9+）

```java
public class AutoCleanThreadLocal<T> implements AutoCloseable {
    private final ThreadLocal<T> delegate = new ThreadLocal<>();
    
    public void set(T value) {
        delegate.set(value);
    }
    
    public T get() {
        return delegate.get();
    }
    
    @Override
    public void close() {
        delegate.remove();
    }
}

// 使用
try (AutoCleanThreadLocal<List<String>> holder = new AutoCleanThreadLocal<>()) {
    holder.set(new ArrayList<>());
    // 业务逻辑
    // 自动清理
}
```

---

## 线程池 + ThreadLocal 的坑

这是最容易出错的地方。

### 问题场景

```java
public class ThreadPoolDemo {
    private static final ThreadLocal<Integer> counter = 
        ThreadLocal.withInitial(() -> 0);
    
    public static void main(String[] args) {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        
        // 任务 1
        executor.submit(() -> {
            counter.set(100);
            System.out.println("任务1: " + counter.get());
            // 注意：没有 remove()！
        });
        
        // 任务 2（可能复用线程1）
        executor.submit(() -> {
            // 期望输出 0（初始值）
            // 实际可能输出 100（任务1的值）！
            System.out.println("任务2: " + counter.get());
        });
    }
}
```

### 为什么会这样？

```
线程复用场景：

线程池中的线程不会销毁，会被复用

任务 1 执行：
  Thread-1: counter.set(100)
  Thread-1: System.out.println(counter.get()) → 100
  任务结束，但 ThreadLocal 的值没有清理！

任务 2 分配到同一个线程：
  Thread-1: counter.get() → 100（脏数据！）

期望是 0（初始值），实际是 100
```

### 解决方案

```java
// 方案一：每次使用后 remove
executor.submit(() -> {
    try {
        counter.set(100);
        System.out.println(counter.get());
    } finally {
        counter.remove();  // 必须！
    }
});

// 方案二：使用包装类
public class SafeThreadLocal<T> {
    private final ThreadLocal<T> delegate = new ThreadLocal<>();
    
    public void set(T value) {
        delegate.set(value);
    }
    
    public T get() {
        return delegate.get();
    }
    
    // 在入口处自动清理
    public void beforeExecute() {
        delegate.remove();
    }
}
```

---

## InheritableThreadLocal

`ThreadLocal` 默认不继承父线程的值，但可以用 `InheritableThreadLocal` 实现继承。

```java
public class InheritableDemo {
    private static final InheritableThreadLocal<String> inheritable = 
        new InheritableThreadLocal<>();
    
    public static void main(String[] args) {
        inheritable.set("父线程的值");
        
        new Thread(() -> {
            // 子线程可以获取父线程的值
            System.out.println(inheritable.get());  // 父线程的值
        }).start();
    }
}
```

### 注意事项

`InheritableThreadLocal` 也有内存泄漏风险，而且**线程池场景下继承特性可能失效**：

```java
public class InheritableThreadPoolDemo {
    private static final InheritableThreadLocal<Integer> value = 
        new InheritableThreadLocal<>();
    
    public static void main(String[] args) {
        ExecutorService executor = Executors.newFixedThreadPool(1);
        
        // 任务 1：设置值
        executor.submit(() -> {
            value.set(100);
        });
        
        // 任务 2：读取值（可能复用线程）
        executor.submit(() -> {
            // 线程池中的线程从未创建过子线程
            // 所以没有「父线程」的概念
            // value.get() 可能是 null 或 旧值
            System.out.println(value.get());
        });
    }
}
```

---

## 面试实战

**面试官问**：「ThreadLocal 怎么实现线程隔离的？」

**参考回答**：
> 每个 Thread 对象内部都有一个 `ThreadLocalMap`，它是一个 Entry 数组。
>
> `ThreadLocal.set(value)` 时，会以 `ThreadLocal` 对象本身为 key，存入当前线程的 `ThreadLocalMap`。
>
> `ThreadLocal.get()` 时，会从当前线程的 `ThreadLocalMap` 中，用 `ThreadLocal` 对象作为 key 查找。
>
> 因为每个线程有自己的 `ThreadLocalMap`，所以互不干扰。

**追问**：「ThreadLocal 有什么内存泄漏风险？」

**深入回答**：
> `ThreadLocalMap` 的 Entry 继承 `WeakReference<ThreadLocal<?>>`，key 是弱引用，value 是强引用。
>
> 当 `ThreadLocal` 对象不再被使用时，GC 会回收它（因为只剩弱引用），但 Entry 的 value 仍然是强引用，无法被清理。
>
> 如果线程是长生命周期（如线程池中的线程），这些「脏 Entry」就会一直存在，造成内存泄漏。
>
> **解决方案**：使用完 `ThreadLocal` 后，手动调用 `remove()` 方法清理。

**追问**：「线程池场景下使用 ThreadLocal 有什么坑？」

**参考回答**：
> 线程池中的线程会被复用，如果任务执行后没有清理 `ThreadLocal`，下一个任务可能读到上一个任务的脏数据。
>
> 比如 Web 框架中用 `ThreadLocal` 存储用户信息，请求结束后不清理，下一个请求可能读到上一个用户的信息。
>
> **解决方案**：每次使用后 `remove()`，或者使用带有自动清理功能的包装类。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                   ThreadLocal 要点                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  原理：                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Thread.threadLocals: ThreadLocalMap                 │   │
│  │  Entry[].key = ThreadLocal (弱引用)                  │   │
│  │  Entry[].value = 值 (强引用)                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  内存泄漏原因：                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ThreadLocal 被 GC 回收 → key = null               │   │
│  │  但 value 仍被强引用 → 无法回收                      │   │
│  │  线程池线程不销毁 → Entry 永久存在                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  最佳实践：                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  try {                                              │   │
│  │      threadLocal.set(value);                        │   │
│  │      // 业务逻辑                                    │   │
│  │  } finally {                                        │   │
│  │      threadLocal.remove();  // 必须！                │   │
│  │  }                                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

分析以下代码的内存泄漏风险：

```java
public class MemoryLeakDemo {
    private static final ThreadLocal<List<Object>> cache = 
        new ThreadLocal<>();
    
    public static List<Object> getCache() {
        List<Object> list = cache.get();
        if (list == null) {
            list = new ArrayList<>();
            cache.set(list);
        }
        return list;
    }
    
    public static void main(String[] args) {
        // 线程池执行多个任务
        ExecutorService executor = Executors.newFixedThreadPool(4);
        
        for (int i = 0; i < 100; i++) {
            final int taskId = i;
            executor.submit(() -> {
                List<Object> list = getCache();
                list.add(new byte[1024 * 1024]);  // 每次添加 1MB
                
                // 任务结束，但没有 remove()
                // 线程复用会导致缓存越来越大
            });
        }
    }
}
```

1. 这个代码有什么问题？
2. 会发生什么泄漏？
3. 怎么修复？
