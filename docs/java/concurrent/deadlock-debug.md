# 死锁定位与排查方法

生产环境突然卡死了？

日志不再输出，接口全部超时，CPU 却不高...

大概率是**死锁**。

今天讲怎么定位和排查。

---

## 死锁的典型表现

```bash
# 症状：
# 1. 进程没有挂掉，但所有线程都不工作
# 2. CPU 使用率不高（不是死循环）
# 3. 线程 dump 显示多个线程在等待锁
# 4. 程序无法恢复，只能重启
```

---

## 方法一：jstack 定位死锁（推荐）

`jstack` 是 JDK 自带的线程堆栈分析工具，最简单有效。

### 基本用法

```bash
# 1. 找到 Java 进程 PID
jps -l
# 输出：
# 12345 com.example.MyApplication

# 2. 生成线程 dump
jstack 12345 > thread_dump.txt

# 3. 查看是否有死锁
jstack -l 12345 > thread_dump.txt
```

### 死锁信息

`jstack` 会自动检测死锁，并输出 `Found one Java-level deadlock`：

```
Found one Java-level deadlock:
=========================

"Thread-1":
  waiting for monitor entry [0x00007f8a4c000000]
  (java/lang/Object@0x00000000d8b00000),
  (a/DeadLockDemo$1@0x00000000d8b00000)
  at com.example.DeadLockDemo.lambda$0(DeadLockDemo.java:18)
  - waiting to lock <0x00000000d8b00000> (a java/lang/Object)
  - locked <0x00000000d8c00000> (a java/lang/Object)

"Thread-2":
  waiting for monitor entry [0x00007f8a4c000000]
  (a/DeadLockDemo$1@0x00000000d8c00000)
  at com.example.DeadLockDemo.lambda$1(DeadLockDemo.java:34)
  - waiting to lock <0x00000000d8c00000> (a java/lang/Object)
  - locked <0x00000000d8b00000> (a java/lang/Object)

Java stack information for the threads listed above:
==================================================
"Thread-1":
        at com.example.DeadLockDemo.lambda$0(DeadLockDemo.java:18)
        - waiting to lock <0x00000000d8b00000> (a java/lang/Object)
        - locked <0x00000000d8c00000> (a java/lang/Object)
        at java.lang.Thread.run(Thread.java:750)

"Thread-2":
        at com.example.DeadLockDemo.lambda$1(DeadLockDemo.java:34)
        - waiting to lock <0x00000000d8c00000> (a java/lang/Object)
        - locked <0x00000000d8b00000> (a java/lang/Object)
        at java.lang.Thread.run(Thread.java:750)

Found 1 deadlock.
```

**关键信息解读**：

```
Thread-1:
  waiting to lock <0x00000000d8b00000>  ← 想要这个锁
  locked <0x00000000d8c00000>           ← 已持有这个锁

Thread-2:
  waiting to lock <0x00000000d8c00000>  ← 想要这个锁
  locked <0x00000000d8b00000>           ← 已持有这个锁

→ Thread-1 等 Thread-2 持有的锁
→ Thread-2 等 Thread-1 持有的锁
→ 死锁！
```

---

## 方法二：VisualVM 图形化分析

`jvisualvm` 是 JDK 自带的图形化监控工具。

### 启动

```bash
# 命令行启动
jvisualvm
```

### 功能

```
┌─────────────────────────────────────────────────┐
│              VisualVM 界面                       │
├─────────────────────────────────────────────────┤
│                                                 │
│  左侧：线程列表                                  │
│  ├─ Thread-1  [RUNNABLE]                       │
│  ├─ Thread-2  [BLOCKED]  ← 被阻塞               │
│  └─ main      [WAITING]                        │
│                                                 │
│  右侧：线程 Dump                               │
│  └─ 点击「线程 Dump」查看详细堆栈                │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 查看线程状态

- **Runnable**：正在运行
- **Blocked**：等待获取监视器锁
- **Waiting**：等待某个条件
- **Timed Waiting**：限时等待

---

## 方法三：JConsole

```bash
jconsole
```

### 连接进程

```
┌─────────────────────────────────────────────────┐
│        连接到一个本地 Java 进程                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  [√] 本机 Java 进程                              │
│                                                 │
│  进程列表：                                       │
│    12345 com.example.MyApplication              │
│    67890 org.jetbrains.idea...                  │
│                                                 │
│  [连接]                                          │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 查看死锁检测

JConsole 的「线程」标签页有「检测死锁」按钮：

```
┌─────────────────────────────────────────────────┐
│  线程                              [检测死锁]   │
├─────────────────────────────────────────────────┤
│                                                 │
│  检测到 1 个死锁                                 │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ Thread-1                                │   │
│  │   waiting for: Object@0x000000           │   │
│  │   held by: Thread-2                      │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ Thread-2                                │   │
│  │   waiting for: Object@0x000000           │   │
│  │   held by: Thread-1                      │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 方法四：Arthas（生产环境推荐）

`Arthas` 是阿里巴巴开源的线上诊断工具，特别适合生产环境。

### 安装和启动

```bash
# 下载 arthas
java -jar arthas-boot.jar

# 或在线安装
curl -L https://arthas.aliyun.com/arthas-boot.jar -o arthas-boot.jar
java -jar arthas-boot.jar
```

### 使用 thread 命令

```bash
# 查看所有线程
thread

# 查看死锁
thread -b

# 查看阻塞线程
thread --state BLOCKED

# 查看持有指定锁的线程
thread -i 1000 -n 5
```

### 输出示例

```
[arthas@12345]$ thread -b
"Thread-1" Id=16 WAITING
    at sun.misc.Unsafe.park(Native Method)
    - waiting on <0x00000000d8b00000> (a java/lang/Object)
    - locked <0x00000000d8c00000> (a java/lang/Object)
    at com.example.DeadLockDemo.lambda$0(DeadLockDemo.java:18)

"Thread-2" Id=17 WAITING
    at sun.misc.Unsafe.park(Native Method)
    - waiting on <0x00000000d8c00000> (a java/lang/Object)
    - locked <0x00000000d8b00000> (a java/lang/Object)
    at com.example.DeadLockDemo.lambda$1(DeadLockDemo.java:34)

Found 1 deadlock.
```

---

## 方法五：代码层面排查

### 监控锁的等待时间

```java
public class LockMonitor {
    private final Object lock = new Object();
    private final long timeoutMs = 5000;
    
    public void doWithLock() throws TimeoutException {
        long start = System.currentTimeMillis();
        boolean acquired = false;
        
        while (!acquired) {
            synchronized (lock) {
                acquired = true;
            }
            
            if (!acquired) {
                long elapsed = System.currentTimeMillis() - start;
                if (elapsed >= timeoutMs) {
                    throw new TimeoutException("获取锁超时");
                }
                try {
                    Thread.sleep(10);  // 短暂等待
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException(e);
                }
            }
        }
    }
}
```

### 使用 ThreadMXBean 检测死锁

```java
import java.lang.management.*;
import java.util.concurrent.*;

public class DeadLockDetector {
    public static void main(String[] args) {
        ThreadMXBean threadMXBean = ManagementFactory.getThreadMXBean();
        
        // 开启死锁检测
        ScheduledExecutorService executor = Executors.newScheduledThreadPool(1);
        executor.scheduleAtFixedRate(() -> {
            long[] deadlockedThreads = threadMXBean.findDeadlockedThreads();
            
            if (deadlockedThreads != null) {
                ThreadInfo[] infos = threadMXBean.getThreadInfo(deadlockedThreads);
                System.out.println("检测到死锁！");
                for (ThreadInfo info : infos) {
                    System.out.println("线程: " + info.getThreadName());
                    System.out.println("持有锁: " + info.getLockName());
                    System.out.println("等待锁: " + info.getLockOwnerName());
                }
            }
        }, 0, 5, TimeUnit.SECONDS);
    }
}
```

---

## 快速排查清单

```
遇到疑似死锁，按这个顺序排查：

1. 先别重启！第一时间保留现场
   └─ jstack <pid> > dump.txt

2. 分析 dump 文件
   └─ 搜索 "waiting for" 和 "locked"

3. 定位死锁的代码位置
   └─ 对比行号和类名

4. 分析等待关系
   └─ 谁持有锁？等谁的锁？

5. 制定修复方案
   └─ 见「如何避免死锁」文档
```

---

## 面试实战

**面试官问**：「线上出现死锁，你怎么排查？」

**参考回答**：
> **第一步，保留现场**。第一时间用 `jstack <pid>` 生成线程 dump，不要重启应用。
>
> **第二步，分析 dump**。查找 `Found one Java-level deadlock`，分析每个线程持有的锁和等待的锁。
>
> **第三步，定位代码**。根据堆栈信息和行号，定位到具体代码。
>
> **第四步，分析原因**。结合业务逻辑，分析为什么会出现循环等待。
>
> **第五步，修复验证**。修复后重新压测，确认问题解决。
>
> 日常也可以用 Arthas 的 `thread -b` 命令实时检测死锁。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                  死锁排查工具一览                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  工具           │ 适用场景              │ 特点               │
│  ─────────────────────────────────────────────────────────│
│  jstack         │ 快速定位              │ JDK 内置，最常用   │
│  VisualVM       │ 图形化分析            │ 直观，但需桌面     │
│  JConsole       │ 简单监控              │ 轻量，但功能有限   │
│  Arthas         │ 生产环境              │ 在线诊断，功能强大  │
│  ThreadMXBean   │ 代码监控              │ 可集成到监控系统   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

假设你已经用 `jstack` 定位到死锁，输出如下：

```
"pool-1-thread-1" Id=25 waiting for monitor entry
  - locked <0x00000000e0a060d8> (java/lang/Object)
  - waiting to lock <0x00000000e0a060e8> (java/lang/Object)
  at com.example.Account.transfer(Account.java:45)

"pool-1-thread-2" Id=26 waiting for monitor entry
  - locked <0x00000000e0a060e8> (java/lang/Object)
  - waiting to lock <0x00000000e0a060d8> (java/lang/Object)
  at com.example.Account.transfer(Account.java:45)
```

你能推断出：
1. 两个线程分别持有什么锁？
2. 两个线程分别在等什么锁？
3. 最可能的代码问题是什么？
4. 怎么修复？
