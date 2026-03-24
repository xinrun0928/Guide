# ThreadLocal 内存泄漏与优化使用

ThreadLocal 是 Java 开发中的「双刃剑」——用对了是神器，用错了就是内存泄漏的温床。

很多人知道 ThreadLocal 有内存泄漏风险，但具体是怎么回事？「弱引用保护」听起来很安全，为什么还会泄漏？

今天，我们来彻底搞清楚 ThreadLocal 的内存泄漏原理，以及正确的使用姿势。

## ThreadLocal 的基本原理

先来看 ThreadLocal 的结构：

```java
public class ThreadLocal&lt;T&gt; {
    // ThreadLocalMap 是 ThreadLocal 的内部类
    static class ThreadLocalMap {
        // Entry 继承自 WeakReference&lt;ThreadLocal&lt;?&gt;&gt;
        static class Entry extends WeakReference&lt;ThreadLocal&lt;?&gt;&gt; {
            Object value;
            Entry(ThreadLocal&lt;?&gt; k, Object v) {
                super(k);  // 弱引用 key
                value = v;  // 强引用 value
            }
        }

        private Entry[] table;
    }
}

// Thread 对象中持有 ThreadLocalMap
public class Thread {
    ThreadLocal.ThreadLocalMap threadLocals;
}
```

关系图如下：

```
Thread 对象
    ↓
threadLocals (ThreadLocalMap)
    ↓
table[] (Entry 数组)
    ↓
Entry: key(弱引用 ThreadLocal) + value(强引用)
```

## 为什么会内存泄漏？

问题的关键在于 **Entry 的 value 是强引用**。

假设这样的场景：

```java
public class ThreadLocalLeakDemo {
    private static ThreadLocal&lt;byte[]&gt; local = new ThreadLocal&lt;&gt;();
    private static final int MB = 1024 * 1024;

    public static void main(String[] args) {
        // 线程池场景
        ExecutorService pool = Executors.newFixedThreadPool(2);

        pool.submit(() -&gt; {
            // 设置一个大对象
            local.set(new byte[10 * MB]);  // 10MB

            // 业务逻辑
            doSomething();

            // 业务结束了，但 ThreadLocal 没有 remove
            // local.remove();  // 忘记调用
        });

        // 线程不会退出（核心线程），ThreadLocalMap 一直存在
        pool.shutdown();
    }
}
```

分析泄漏过程：

1. **ThreadLocal 对象使用完毕，栈上的局部变量 `local` 消亡**
2. **但 Thread 对象是线程池创建的，生命周期很长，不会消亡**
3. **ThreadLocalMap 中 Entry 的 key（ThreadLocal）因为是弱引用，下一次 GC 就会被回收**
4. **Entry 的 value 是强引用，依然指向 10MB 的数组**
5. **结果：key 没了，value 还在，这条 Entry 永远无法被清理**

```
Entry 的状态：
key: null (被 GC 回收了) → value: 10MB 数组 ← 无法访问，也无法回收！
```

这就是内存泄漏的**完整链条**。

## 弱引用保护了什么？

你可能会问：Entry 的 key 为什么要用弱引用？弱引用保护了什么？

弱引用的设计是为了保护 **ThreadLocal 对象本身**。如果没有弱引用，ThreadLocal 对象就会因为被 Entry 引用而无法被 GC，导致 ThreadLocal 对象本身泄漏（以及它引用的整个对象图）。

但弱引用只保护了 key，**没有保护 value**。value 依然需要手动 `remove()`。

## 为什么不直接用弱引用保护 value？

如果 Entry 的 value 也改成弱引用会怎样？

```java
// 假设的弱引用 value 设计
static class Entry extends WeakReference&lt;ThreadLocal&lt;?&gt;&gt; {
    WeakReference&lt;Object&gt; valueRef;  // value 也是弱引用
}
```

问题是：value 经常是有用的对象。如果 value 被 GC 回收了，ThreadLocal 的值就「莫名其妙」丢了，你拿到的可能是 null——这会引入更难排查的 bug。

所以 JDK 的设计是：**key 用弱引用保护 ThreadLocal，value 靠手动 remove**。

## ThreadLocalMap 的自动清理机制

JVM 也不是完全不管。ThreadLocalMap 有两个清理机制：

### 1. 探测式清理（expungeStaleEntry）

```java
private int expungeStaleEntry(int staleSlot) {
    Entry[] tab = table;
    int len = tab.length;

    // 删除 stale Slot
    tab[staleSlot].value = null;
    tab[staleSlot] = null;
    size--;

    // 重新哈希，清理沿途遇到的其他 stale Entry
    Entry e = tab[nextIndex(staleSlot, len)];
    while (e != null) {
        int index = e.get().hashCode() & (len - 1);
        if (index != staleSlot) {
            // 当前 slot 不是正确的位置
            tab[index] = null;  // 删除旧位置的引用
            rehash(e);           // 重新插入
        }
        e = nextEntry(e);
    }
    return staleSlot;
}
```

### 2. 延迟清理（cleanSomeSlots）

```java
private boolean cleanSomeSlots(int i, int n) {
    boolean removed = false;
    do {
        i = nextIndex(i, len);
        Entry e = tab[i];
        if (e != null &amp;&amp; e.get() == null) {  // key 被 GC 了
            expungeStaleEntry(i);
            removed = true;
        }
        n &gt;&gt;= 1;  // 只扫描 log(n) 个位置
    } while (n != 0);
    return removed;
}
```

**但问题是**：这些清理是「惰性」的，只在特定操作（如 get、set）时触发。如果 ThreadLocal 只是创建了但从未使用过，清理机制永远不会运行。

## 正确使用 ThreadLocal

### 原则一：用完必 remove

```java
public class CorrectUsage {
    private static final ThreadLocal&lt;SimpleDateFormat&gt; dateFormat =
        ThreadLocal.withInitial(() -&gt; new SimpleDateFormat("yyyy-MM-dd"));

    public String formatDate(Date date) {
        try {
            return dateFormat.get().format(date);
        } finally {
            dateFormat.remove();  // 无论如何都要 remove
        }
    }
}
```

### 原则二：在 finally 块中清理

```java
public class UserContextFilter implements Filter {
    private static final ThreadLocal&lt;User&gt; currentUser = new ThreadLocal&lt;&gt;();

    @Override
    public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain)
            throws IOException, ServletException {
        try {
            User user = authenticate(req);
            currentUser.set(user);  // 设置用户上下文
            chain.doFilter(req, resp);
        } finally {
            currentUser.remove();  // 请求结束后清理
        }
    }
}
```

### 原则三：使用 try-with-resources 自动清理

```java
public class ThreadLocalHolder&lt;T&gt; implements AutoCloseable {
    private final ThreadLocal&lt;T&gt; threadLocal;

    public ThreadLocalHolder(ThreadLocal&lt;T&gt; threadLocal, T value) {
        this.threadLocal = threadLocal;
        threadLocal.set(value);
    }

    public T get() {
        return threadLocal.get();
    }

    @Override
    public void close() {
        threadLocal.remove();
    }
}

// 使用
try (ThreadLocalHolder&lt;Connection&gt; holder = new ThreadLocalHolder&lt;&gt;(connectionHolder, conn)) {
    Connection conn = holder.get();
    conn.execute();
} // 自动 remove
```

### 原则四：线程池场景更要小心

```java
public class ThreadPoolUsage {
    private static final ThreadLocal&lt;byte[]&gt; buffer = ThreadLocal.withInitial(() -&gt; new byte[1024]);

    public void process() {
        try {
            byte[] buf = buffer.get();
            // 业务逻辑
        } finally {
            buffer.remove();  // 线程会被复用，必须清理
        }
    }
}
```

## 内存泄漏的排查

如果已经产生了内存泄漏，可以用以下方式排查：

```java
// 方式 1: 通过 Thread dump 查看 ThreadLocal
jstack -l &lt;pid&gt; | grep ThreadLocal

// 方式 2: MAT 分析堆内存
// 导出堆: jmap -dump:format=b,file=heap.hprof &lt;pid&gt;
// 用 MAT 打开，查看 ThreadLocalMap 中的 Entry
```

## 总结

ThreadLocal 内存泄漏的完整链条：

```
ThreadLocal 对象创建
    ↓
Entry&lt;key, value&gt; 加入 ThreadLocalMap
    ↓
ThreadLocal 对象使用完毕，无强引用
    ↓
弱引用 key 在 GC 时被回收
    ↓
value 依然是强引用，无法回收
    ↓
Thread 不结束，ThreadLocalMap 一直存在
    ↓
内存泄漏！
```

**避免泄漏的方法**：
- **用完必 remove**（最重要）
- 在 finally 块中清理
- 线程池场景更要小心
- 定期检查和监控

ThreadLocal 是工具，不是银弹。用对了简化代码，用错了制造泄漏。

---

## 留给你的问题

InheritableThreadLocal 可以让子线程继承父线程的值，但 InheritableThreadLocal 也有内存泄漏风险吗？如果有，和普通 ThreadLocal 有什么区别？

提示：考虑 InheritableThreadLocal 的实现方式和线程继承的场景。
