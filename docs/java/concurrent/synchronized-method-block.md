# synchronized 修饰方法 vs 代码块：选对才高效

见过这样的代码吗？

```java
public class Demo {
    
    // 整个方法加锁
    public synchronized void methodA() {
        doSomething();
        doOtherThing();
    }
    
    // 只给需要同步的部分加锁
    public void methodB() {
        doPrepare();
        synchronized (this) {
            doSync();  // 只有这里需要同步
        }
        doCleanup();
    }
}
```

`methodA` 和 `methodB` 都实现了同步，但性能可能差好几倍。

---

## synchronized 的四种用法

### 1. 修饰实例方法

```java
public class Counter {
    private int count = 0;
    
    // 锁的是 this（当前实例对象）
    public synchronized void increment() {
        count++;
    }
    
    public synchronized int getCount() {
        return count;
    }
}
```

**特点**：
- 锁的是当前 `this` 对象
- 同一个实例的两个方法会互斥
- 不同实例之间不会互斥

```java
Counter c1 = new Counter();
Counter c2 = new Counter();

c1.increment();  // 锁的是 c1
c2.increment();  // 锁的是 c2，互不影响
```

### 2. 修饰静态方法

```java
public class Cache {
    private static Map&lt;String, Object&gt; cache = new HashMap&lt;&gt;();
    
    // 锁的是 Class 对象（整个类）
    public static synchronized void put(String key, Object value) {
        cache.put(key, value);
    }
    
    public static synchronized Object get(String key) {
        return cache.get(key);
    }
}
```

**特点**：
- 锁的是 `Cache.class` 对象
- 所有实例共享同一把锁
- 相当于全局锁

```java
Cache c1 = new Cache();
Cache c2 = new Cache();

// c1.put() 和 c2.put() 会互斥
// 因为锁的是同一个 Class 对象
```

### 3. 修饰代码块（锁指定对象）

```java
public class OrderService {
    private final Object lock = new Object();  // 专用锁对象
    private int orderId = 0;
    
    public void createOrder() {
        // 只锁 increment 操作的锁对象
        synchronized (lock) {
            orderId++;
            // 生成订单逻辑...
        }
    }
}
```

**特点**：
- 锁的是指定的对象
- 锁粒度由你控制
- 更灵活，性能更好

### 4. 修饰代码块（锁 this）

```java
public class UserService {
    
    public synchronized void login() { }  // 锁 this
    
    public void update() {
        synchronized (this) {            // 也是锁 this
            // ...
        }
    }
}
```

`methodA` 和 `methodB` 实际上**是同一把锁**，会互斥。

---

## 场景对比：什么时候用哪种？

### 场景一：简单粗暴——修饰方法

```java
// 小方法，整个方法都要同步
public synchronized boolean equals(Object obj) {
    return this == obj;
}
```

**适用**：同步代码简单、方法执行时间短。

### 场景二：精细控制——锁代码块

```java
public class DataProcessor {
    private Map&lt;String, Data&gt; cache = new HashMap&lt;&gt;();
    private volatile boolean initialized = false;
    
    public void process(String key) {
        // 耗时操作不需要锁
        prepare(key);
        analyze(key);
        
        // 只锁缓存访问
        synchronized (cache) {
            cache.get(key);  // 可能耗时的读操作
        }
        
        // 其他耗时操作
        saveResult(key);
    }
}
```

**适用**：方法中有耗时操作不希望被阻塞。

### 场景三：不同业务——用不同的锁

```java
public class AccountService {
    private final Object balanceLock = new Object();
    private final Object transactionLock = new Object();
    
    private volatile double balance = 0.0;
    private List&lt;Transaction&gt; transactions = new ArrayList&lt;&gt;();
    
    // 余额操作用 balanceLock
    public void deposit(double amount) {
        synchronized (balanceLock) {
            balance += amount;
        }
    }
    
    // 交易记录用 transactionLock（两者互不影响）
    public void addTransaction(Transaction t) {
        synchronized (transactionLock) {
            transactions.add(t);
        }
    }
}
```

**适用**：不同业务需要并行处理，但同类业务需要互斥。

### 场景四：静态方法——锁 Class

```java
public class IdGenerator {
    private static int nextId = 0;
    
    // 静态方法锁 Class，保证全局唯一
    public static synchronized int nextId() {
        return nextId++;
    }
}
```

**等价写法**：

```java
public class IdGenerator {
    private static int nextId = 0;
    private static final Object LOCK = IdGenerator.class;
    
    public static int nextId() {
        synchronized (LOCK) {
            return nextId++;
        }
    }
}
```

---

## 代码块 vs 方法：性能差距有多大？

### 方法级 synchronized 的问题

```java
public class BadExample {
    private int counter = 0;
    
    // 问题：整个方法加锁，但大部分代码不需要同步
    public synchronized void doWork() {
        prepare();              // 耗时1秒，不需要同步
        synchronized (this) {
            counter++;          // 只需要10毫秒，但整个方法被阻塞
        }
        cleanup();              // 耗时1秒，不需要同步
    }
}
```

### 改进：使用代码块

```java
public class GoodExample {
    private int counter = 0;
    
    public void doWork() {
        prepare();              // 1秒，不阻塞
        synchronized (this) {
            counter++;          // 10毫秒
        }
        cleanup();              // 1秒，不阻塞
    }
}
```

**时间对比**：

| 方案 | 总耗时 | synchronized 阻塞时间 |
|-----|-------|---------------------|
| 修饰方法 | 2+ 秒 | 2+ 秒 |
| 修饰代码块 | 2+ 秒 | 10 毫秒 |

锁粒度从 2 秒缩小到 10 毫秒，性能提升 **200 倍**。

---

## 常见误区

### 误区1：String 作为锁对象

```java
// 危险！String 常量池会导致不同位置的 "lock" 其实是同一对象
synchronized ("lock") {
    // 可能和其他代码互斥！
}

// 正确：使用 new String() 或专用对象
private final Object lock = new Object();
synchronized (lock) {
    // ...
}
```

### 误区2：Integer 作为锁对象

```java
private Integer count = 0;  // 自动装箱可能产生新对象！

synchronized (count) {  // count++ 后，count 可能变成新对象！
    count++;            // 锁失效
}
```

**正确做法**：用 `final` 修饰锁对象，或使用 `private final Object lock = new Object();`

### 误区3：锁方法内部的对象

```java
public void method() {
    List&lt;String&gt; list = new ArrayList&lt;&gt;();
    synchronized (list) {  // 每次都是新对象，锁无效！
        // ...
    }
}
```

---

## 总结：选型建议

| 场景 | 推荐方式 |
|-----|---------|
| 简单方法，逻辑都在同步块内 | `synchronized` 方法 |
| 方法中有耗时操作不希望阻塞 | 代码块锁 `this` |
| 多业务并行，相同业务互斥 | 代码块锁不同对象 |
| 全局唯一性保证 | 静态方法或 `synchronized(Class)` |

**核心原则**：锁的粒度要尽可能小，但前提是**锁的对象要正确**。

---

## 留给你的思考题

假设有这样一个场景：

```java
public class Singleton {
    private static Singleton instance;
    private final Object lock = new Object();
    
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (lock) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

这里用了三处同步：
1. 锁 `lock` 对象
2. 双重检查
3. `volatile`（隐含，但这段代码没加）

**问题**：如果去掉 `volatile`，为什么可能会有问题？new Singleton() 的时候发生了什么？
