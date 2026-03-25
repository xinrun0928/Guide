# 堆内存溢出排查：从日志到 MAT，让泄漏无处遁形

堆内存溢出是最常见的 OOM 类型。

但「堆内存溢出」不是终点，而是排查的起点。

---

## 堆溢出排查流程

```
┌─────────────────────────────────────────────────────────────┐
│  堆内存溢出排查流程                                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 复现问题                                               │
│     - 开启 OOM 时生成堆转储                                │
│     - 记录 OOM 发生时的场景                                │
│                                                              │
│  2. 分析堆转储                                             │
│     - MAT / VisualVM 分析                                  │
│     - 找到大对象和内存泄漏点                                │
│                                                              │
│  3. 代码审查                                               │
│     - 定位泄漏代码                                         │
│     - 修复问题                                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 第一步：复现问题

### 配置 OOM 时生成堆转储

```bash
# JVM 参数
java -XX:+UseG1GC \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/path/to/dump \
     -XX:HeapDumpBeforeFullGC \
     -Xmx1g -Xms1g \
     your.Application
```

### 关键参数

| 参数 | 说明 |
|-----|------|
| `-XX:+HeapDumpOnOutOfMemoryError` | OOM 时生成堆转储 |
| `-XX:HeapDumpPath` | 堆转储文件路径 |
| `-XX:HeapDumpBeforeFullGC` | Full GC 前生成堆转储 |
| `-XX:HeapDumpAfterFullGC` | Full GC 后生成堆转储 |

---

## 第二步：获取堆信息

### jmap：获取堆概览

```bash
# 查看堆内存使用情况
jmap -heap <pid>

# 输出
using thread-local object allocation.
Parallel GC with 4 thread(s)

Heap Configuration:
   MinHeapFreeRatio         = 0
   MaxHeapFreeRatio         = 100
   MaxHeapSize              = 1073741824 (1024.0MB)
   NewSize                  = 357564416 (341.0MB)
   MaxNewSize               = 357564416 (341.0MB)
   OldSize                  = 716177408 (683.0MB)
   NewRatio                 = 2
   SurvivorRatio            = 8
   MetaspaceSize            = 125829120 (120.0MB)
   CompressedClassSpaceSize = 117440512 (112.0MB)

Heap Usage:
PS Young Generation
Eden Space:
   capacity = 307023872 (292.8MB)
   used     = 302048256 (288.0MB)  ← Eden 区快满了
   free     = 4975616 (4.8MB)
   98.3% used
From Space:
   capacity = 42582016 (40.6MB)
   used     = 42582016 (40.6MB)    ← Survivor 区满了
   free     = 0 (0.0MB)
   100.0% used
To Space:
   capacity = 42582016 (40.6MB)
   used     = 0 (0.0MB)
   free     = 42582016 (40.6MB)
PS Old Generation
   capacity = 716177408 (683.0MB)
   used     = 650000000 (620.0MB)  ← 老年代使用率高
   free     = 66177408 (63.0MB)
   90.8% used
```

### jmap -histo：查看对象直方图

```bash
# 查看存活对象的数量和大小
jmap -histo <pid> | head -50

# 输出（按对象大小排序）
 num     #instances         #bytes  class name
----------------------------------------------
   1:          12345     52428800  [Ljava.lang.Object;
   2:         234567      18829376  com.example.MyCache
   3:          45678       9437184  [B (byte 数组)
   4:         123456       5924864  java.lang.String
   5:          89012       3412480  java.util.HashMap$Node
   ...
```

---

## 第三步：分析堆转储文件

### 生成堆转储文件

```bash
# 手动生成堆转储
jmap -dump:format=b,file=heap.hprof <pid>

# 或者通过 jcmd
jcmd <pid> GC.heap_dump /path/to/heap.hprof
```

### MAT 分析

**下载地址**：https:// eclipse.org/mat/

#### Histogram 视图：查看对象数量

```
操作：Leak Suspects → Histogram
- 输入类名过滤
- 按 #instances 排序
- 查看对象数量是否异常
```

#### Dominator Tree：查找内存泄漏

```
操作：Leak Suspects → Dominator Tree
- 查找占用内存最多的大树
- 树的根节点是泄漏点
```

### 泄漏可疑分析

MAT 的 Leak Suspects 功能会自动分析：

```
┌─────────────────────────────────────────────────────────────┐
│  Leak Suspects 报告示例                                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Problem 1: 57.44% of the heap is used by 4,356 objects    │
│                                                              │
│  com.example.CacheManager.cache                             │
│    └─ HashMap<String, List&lt;Object&gt;>                    │
│          └─ ArrayList<Object> × 10000                      │
│                                                              │
│  Root cause: Cache 没有设置上限，持续增长                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 常见内存泄漏场景

### 场景 1：静态集合持有引用

```java
public class StaticCollectionLeak {
    // 错误：静态集合无限增长
    private static final Map<String, Object> cache = new HashMap<>();

    public void put(String key, Object value) {
        cache.put(key, value);  // 永不清理
    }

    // 正确：使用 WeakHashMap 或设置过期
    private static final Map<String, WeakReference<Object>> weakCache =
        new WeakHashMap<>();
}
```

### 场景 2：监听器未注销

```java
public class ListenerLeak {
    private final List<Listener> listeners = new ArrayList<>();

    public void addListener(Listener listener) {
        listeners.add(listener);  // 添加但从不删除
    }

    // 正确：提供移除方法
    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }
}
```

### 场景 3：ThreadLocal 未清理

```java
public class ThreadLocalLeak {
    private static final ThreadLocal<Object> tl = new ThreadLocal<>();

    public void process() {
        tl.set(new Object());
        // 业务处理
        // 错误：没有清理
    }

    // 正确：finally 中清理
    public void processFixed() {
        try {
            tl.set(new Object());
            // 业务处理
        } finally {
            tl.remove();  // 手动清理
        }
    }
}
```

### 场景 4：连接池泄漏

```java
public class ConnectionPoolLeak {
    private DataSource ds;

    public void query() throws SQLException {
        Connection conn = ds.getConnection();
        // 错误：没有关闭连接
        // return conn;  // 忘记关闭
    }

    // 正确：try-with-resources
    public void queryFixed() throws SQLException {
        try (Connection conn = ds.getConnection()) {
            // 业务处理
        }
    }
}
```

---

## 实战案例

### 案例：缓存没有上限

```java
// 内存泄漏代码
public class UserCache {
    private static final Map<String, User> cache = new HashMap<>();

    public static User getUser(String userId) {
        User user = cache.get(userId);
        if (user == null) {
            user = loadFromDB(userId);
            cache.put(userId, user);  // 永不清理
        }
        return user;
    }
}
```

### 排查过程

```bash
# 1. OOM 时生成堆转储
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/dump

# 2. MAT 打开 heap.hprof
# 3. Histogram 搜索 User
# 4. Dominator Tree 查看引用链
# 5. 发现 UserCache.cache 持有大量 User 对象
```

### 修复方案

```java
// 方案 1：LRU 缓存
public class UserCache {
    private static final Map<String, User> cache =
        new LinkedHashMap<>(1000, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry eldest) {
                return size() > 1000;  // 超过 1000 条时清理最老的
            }
        };
}

// 方案 2：Guava Cache
LoadingCache<String, User> cache = CacheBuilder.newBuilder()
    .maximumSize(1000)
    .expireAfterWrite(10, TimeUnit.MINUTES)
    .build(new CacheLoader<String, User>() {
        @Override
        public User load(String key) {
            return loadFromDB(key);
        }
    });
```

---

## 面试追问方向

- jmap -histo 和 jmap -dump 有什么区别？什么场景下用哪个？
- MAT 的 Dominator Tree 和 Histogram 有什么区别？各自适合什么场景？
- 如何判断一个对象是「内存泄漏」还是「内存溢出」（真正需要更多内存）？
- WeakHashMap 和普通 HashMap 的区别是什么？什么场景下用 WeakHashMap？
- 如果线上出现 OOM，如何快速定位问题？
- LinkedHashMap 如何实现 LRU 缓存？
