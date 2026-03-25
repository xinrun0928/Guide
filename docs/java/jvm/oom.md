# OutOfMemoryError 全解析：各类型与原因分析

OOM 是 Java 开发者最不愿意看到的错误。

但 OOM 不是一种错误，而是一类错误的统称。不同的 OOM 类型，对应不同的原因和解决方案。

---

## OOM 类型一览

```
┌─────────────────────────────────────────────────────────────────────┐
│                     OutOfMemoryError 类型树                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                        OOM                                          │
│                         │                                           │
│         ┌───────────────┼───────────────┐                          │
│         ▼               ▼               ▼                           │
│    Java heap space   Metaspace      Direct buffer memory            │
│         │               │               │                           │
│    ┌────┴────┐     ┌────┴────┐     ┌────┴────┐                       │
│    │         │     │         │     │         │                       │
│    ▼         ▼     ▼         ▼     ▼         ▼                       │
│  GC         RMI   CGLIB    JSP   NIO       │
│  Overhead   ...   动态代理  模板                        │
│                                                                      │
│                        │                                           │
│                        ▼                                           │
│                  unable to create new native thread                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Java heap space

### 错误信息

```
java.lang.OutOfMemoryError: Java heap space
```

### 原因

堆内存不足以分配对象。

```java
public class HeapOOM {
    public static void main(String[] args) {
        // 不断创建对象，直到堆内存耗尽
        List<byte[]> list = new ArrayList<>();
        while (true) {
            // 每次分配 1MB
            list.add(new byte[1024 * 1024]);
        }
    }
}
```

### 触发条件

| 条件 | 说明 |
|-----|------|
| 对象分配过快 | 流量突增、内存泄漏 |
| 堆内存太小 | `-Xmx` 配置不当 |
| 内存泄漏 | 集合未清理、静态引用、监听器未注销 |
| Full GC 清理不掉 | 内存泄漏或大对象频繁创建 |

---

## Metaspace

### 错误信息

```
java.lang.OutOfMemoryError: Metaspace
```

### 原因

元空间（Metaspace）内存不足，主要是**类加载过多**。

```java
public class MetaspaceOOM {
    public static void main(String[] args) {
        // 不断生成类
        while (true) {
            // CGLIB 动态生成类
            Enhancer enhancer = new Enhancer();
            enhancer.setSuperclass(Object.class);
            enhancer.setUseCache(false);  // 禁用缓存
            enhancer.create();
        }
    }
}
```

### 触发条件

| 场景 | 说明 |
|-----|------|
| CGLIB 动态代理 | 每次生成新类，不清理 |
| JSP 频繁编译 | 每次请求编译新的 JSP 类 |
| 动态代理 | JDK 动态代理、反射 |
| 类加载器泄漏 | Web 容器热部署 |
| 大量第三方库 | 每个库加载大量类 |

### JDK 7 PermGen vs JDK 8 Metaspace

```
┌─────────────────────────────────────────────────────────────┐
│  JDK 7 PermGen vs JDK 8 Metaspace                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  JDK 7                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  堆内存                                              │   │
│  │  ┌───────────┬───────────┬─────────────┐           │   │
│  │  │ 年轻代    │ 老年代    │  PermGen    │           │   │
│  │  │           │           │ (类信息)    │           │   │
│  │  └───────────┴───────────┴─────────────┘           │   │
│  │                        ↑                            │   │
│  │                   容易 OOM                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  JDK 8+                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  堆内存                    本地内存                   │   │
│  │  ┌───────────┬───────────┐ ┌─────────────────┐     │   │
│  │  │ 年轻代    │ 老年代    │ │   Metaspace     │     │   │
│  │  │           │           │ │ (类信息)        │     │   │
│  │  └───────────┴───────────┘ └─────────────────┘     │   │
│  │                                          ↑          │   │
│  │                                    使用 OS 内存       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 参数配置

```bash
# JDK 8 元空间配置
-XX:MetaspaceSize=128m     # 初始元空间大小
-XX:MaxMetaspaceSize=512m   # 最大元空间大小

# JDK 11+ 推荐
-XX:MetaspaceSize=256m
-XX:MaxMetaspaceSize=1g
```

---

## Direct buffer memory

### 错误信息

```
java.lang.OutOfMemoryError: Direct buffer memory
```

### 原因

堆外内存（直接内存）不足。

```java
public class DirectBufferOOM {
    public static void main(String[] args) {
        // 不断分配直接内存
        List<ByteBuffer> buffers = new ArrayList<>();
        while (true) {
            // 每次分配 1MB 直接内存
            ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
            buffers.add(buffer);
        }
    }
}
```

### 触发条件

| 场景 | 说明 |
|-----|------|
| NIO 使用 | `ByteBuffer.allocateDirect()` |
| Netty 堆外内存 | 未正确释放 `ByteBuf` |
| JNI 堆外内存 | 本地代码分配的内存 |
| 频繁大文件 I/O | 缓冲区未复用 |

### 参数配置

```bash
# 直接内存最大大小
-XX:MaxDirectMemorySize=512m

# 默认：等于 -Xmx（Java 10+）
# 默认：64MB（Java 10 之前）
```

---

## unable to create new native thread

### 错误信息

```
java.lang.OutOfMemoryError: unable to create new native thread
```

### 原因

系统无法创建新的线程（受限于进程的最大线程数或系统资源）。

```java
public class ThreadOOM {
    public static void main(String[] args) {
        // 不断创建线程
        int count = 0;
        while (true) {
            new Thread(() -> {
                try {
                    Thread.sleep(Long.MAX_VALUE);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }).start();
            System.out.println("创建线程：" + (++count));
        }
    }
}
```

### 触发原因分析

```
┌─────────────────────────────────────────────────────────────┐
│  无法创建线程的原因                                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 线程数达到上限                                           │
│     - 系统最大线程数：ulimit -u                              │
│     - 进程最大线程数：/proc/[pid]/limits                    │
│                                                              │
│  2. 内存不足                                                 │
│     - 每个线程默认栈大小 1MB（-Xss）                        │
│     - 1000 线程 = 1GB 栈内存                                │
│                                                              │
│  3. 进程数达到上限                                           │
│     - PID 上限：/proc/sys/kernel/pid_max                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 解决方向

```bash
# 1. 减少线程栈大小
java -Xss=512k your.Application

# 2. 使用线程池
java -XX:+UseParallelGC your.Application  # 并行 GC 线程更少

# 3. 使用异步编程
CompletableFuture.supplyAsync(...)

# 4. 使用协程（Java 19+ Virtual Thread）
Thread.startVirtualThread(() -> {});
```

---

## GC overhead limit exceeded

### 错误信息

```
java.lang.OutOfMemoryError: GC overhead limit exceeded
```

### 原因

GC 消耗了太多时间，但回收的内存很少。

```java
public class GCOverheadOOM {
    public static void main(String[] args) {
        // 创建大量对象，且大部分是弱引用
        Map<String, byte[]> map = new HashMap<>();
        int i = 0;
        while (true) {
            // 对象很快变成垃圾，但不断创建
            map.put(String.valueOf(i++), new byte[1024]);
            if (i % 1000 == 0) {
                map.clear();  // 不断清理又不断创建
            }
        }
    }
}
```

### 触发条件

```
JVM 参数：-XX:+UseGCOverheadLimit
触发条件：
- GC 时间占比 > 98%
- 且回收的内存 < 2%

本质：防止应用程序用太多时间做 GC，却回收不了多少内存
```

### 解决方向

```bash
# 1. 增大堆内存
java -Xmx2g your.Application

# 2. 关闭限制（不推荐）
java -XX:-UseGCOverheadLimit your.Application

# 3. 排查内存泄漏
jmap -heap <pid>
jmap -dump:format=b,file=heap.hprof <pid>
```

---

## OOM 排查通用流程

```
┌─────────────────────────────────────────────────────────────┐
│  OOM 排查流程                                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 获取基本信息                                             │
│     - OOM 类型                                               │
│     - 发生时间                                               │
│     - 堆转储文件（-XX:+HeapDumpOnOutOfMemoryError）         │
│                                                              │
│  2. 分析堆转储                                               │
│     - MAT / VisualVM / Java Mission Control                 │
│     - 查找大对象                                            │
│     - 查找内存泄漏（Dominator Tree）                        │
│                                                              │
│  3. 分析 GC 日志                                             │
│     - GC 频率                                               │
│     - 内存使用趋势                                          │
│     - Full GC 原因                                          │
│                                                              │
│  4. 代码审查                                                 │
│     - 集合未清理                                            │
│     - 静态集合持有引用                                      │
│     - 监听器/回调未注销                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 自动生成堆转储

```bash
# OOM 时自动生成堆转储
java -XX:+UseG1GC \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/path/to/dump \
     -Xmx1g your.Application
```

---

## 面试追问方向

- 什么情况下会出现 `OutOfMemoryError` 而不是正常的对象分配失败？
- JDK 8 为什么去掉 PermGen？换成 Metaspace 有什么好处？
- `Direct buffer memory` OOM 和 `Java heap space` OOM 有什么区别？
- 什么情况下会触发 `GC overhead limit exceeded`？为什么 JVM 要设置这个限制？
- `unable to create new native thread` 和堆内存有什么关系？
- 如何配置 JVM 参数，让 OOM 时自动生成堆转储文件？
