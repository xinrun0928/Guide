# JVM 诊断工具全家桶：jps/jstat/jinfo/jmap/jstack/jcmd

排查 JVM 问题，这些命令行工具是标配。

它们都是 JDK 自带的，无需额外安装。

---

## 工具概览

```
┌─────────────────────────────────────────────────────────────┐
│                    JVM 诊断工具全家桶                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  jps      │  查看 Java 进程                                 │
│  jstat    │  查看 GC 和类加载统计                           │
│  jinfo    │  查看和修改 JVM 参数                            │
│  jmap     │  查看堆内存和生成堆转储                         │
│  jstack   │  查看线程堆栈                                   │
│  jcmd     │  综合工具（万能）                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## jps：查看 Java 进程

### 基本用法

```bash
# 列出当前用户的所有 Java 进程
jps

# 输出
12345 Jps
12340 Application
12320 Launcher

# 显示完整类名
jps -l

# 输出
12345 sun.tools.jps.Jps
12340 com.example.Application
12320 org.jetbrains.intellij.utils.JvmDetector

# 显示传递给 JVM 的参数
jps -v
```

### 常用参数

| 参数 | 说明 |
|-----|------|
| `-l` | 显示完整类名 |
| `-m` | 显示传递给 main 方法的参数 |
| `-v` | 显示 JVM 参数 |
| `-V` | 不显示传递给 JVM 的参数 |

---

## jstat：GC 和类加载统计

### 基本用法

```bash
# 查看 GC 统计（每 1 秒刷新）
jstat -gcutil <pid> 1000

# 常用列说明
S0C    S1C    S0U    S1U      EC       EU        OC         OU       MC     MU    CCSC   CCSU   YGC     YGCT    FGC    FGCT     GCT
8704.0 8704.0  0.0   2560.0 65536.0  32768.0  262144.0   131072.0  48128.0 46848.0 6144.0  5952.0    156    2.345   0    0.000    2.345
  S0C    S1C    S0U    S1U      EC       EU        OC         OU       MC     MU    CCSC   CCSU   YGC     YGCT    FGC    FGCT     GCT
 Survivor0 Survivor1 Survivor0 Survivor1 Eden容量 Eden使用 Old容量 Old使用 Metaspace Metaspace 压缩类 压缩类   YoungGC YoungGC FullGC FullGC   GC总
  容量    容量    使用    使用     (KB)     (KB)      (KB)      (KB)     容量   使用   容量   使用   次数   时间(s) 次数   时间(s) 时间(s)
```

### 详细 GC 信息

```bash
# 查看详细 GC 信息
jstat -gccapacity <pid>

# 输出
 NGCMN    NGCMX     NGC     S0C   S1C       EC      OGCMN      OGCMX      OGC     OC       MCMN     MCMX      MC     CCSC    CCSU   YGC    FGC
 87552.0 87552.0 87552.0  8704.0 8704.0  65536.0      0.0   175104.0 175104.0 175104.0      0.0 109568.0 48128.0 6144.0  5952.0    156     0
   年轻代    年轻代   年轻代  Survivor0 Survivor1  Eden    老年代    老年代   老年代 老年代  Metaspace Metaspace Metaspace 压缩类 压缩类
   最小      最大    当前    容量    容量     容量    最小      最大      当前   容量    最小     最大     容量    容量   容量
```

### 类加载统计

```bash
# 查看类加载信息
jstat -class <pid>

# 输出
Loaded  Bytes  Unloaded  Bytes     Time
  12543  24000.0       125     1800.0      15.32
   已加载   已加载字节   已卸载   已卸载字节   总耗时
```

### 编译统计

```bash
# 查看 JIT 编译信息
jstat -compiler <pid>

# 输出
Compiled Failed Invalid   Time   FailedType FailedMethod
   12543       0       0    125.32       0
    编译数    失败     无效   总耗时    失败类型
```

---

## jinfo：查看和修改 JVM 参数

### 基本用法

```bash
# 查看 JVM 参数
jinfo <pid>

# 查看指定参数
jinfo -flag MaxHeapSize <pid>
jinfo -flag PrintGCDetails <pid>

# 动态修改参数（部分参数支持）
jinfo -flag +PrintGCDetails <pid>    # 开启
jinfo -flag -PrintGCDetails <pid>    # 关闭
```

### 查看所有可管理参数

```bash
# JDK 8
jinfo -flags <pid>

# JDK 9+
jcmd <pid> VM.flags
```

---

## jmap：堆内存分析

### 基本用法

```bash
# 查看堆概览
jmap -heap <pid>

# 查看对象直方图
jmap -histo <pid> | head -30

# 输出
 num     #instances         #bytes  class name
----------------------------------------------
   1:          12345     52428800  [Ljava.lang.Object;
   2:         234567      18829376  com.example.MyCache
   3:          45678       9437184  [B
   4:         123456       5924864  java.lang.String
```

### 生成堆转储

```bash
# 生成堆转储文件
jmap -dump:format=b,file=heap.hprof <pid>

# 或者
jcmd <pid> GC.heap_dump /path/to/heap.hprof

# 定时生成堆转储
jmap -dump:live,format=b,file=heap_live.hprof <pid>
# live 参数：只保存存活对象（触发 Full GC）
```

### 查看类加载器信息

```bash
# 查看类加载器统计
jmap -clstats <pid>

# 输出
Index  Super  InstBytes  KlassBytes  class loader (Java)
     1  null   4809536    12345    <bootstrap>
     2     1     204800      890   sun.misc.Launcher$AppClassLoader@12345678
     3     2      102400      780   sun.misc.Launcher$ExtClassLoader@23456789
```

---

## jstack：线程堆栈分析

### 基本用法

```bash
# 查看线程堆栈
jstack <pid>

# 查看带锁信息的线程堆栈
jstack -l <pid>

# 查看完整堆栈（包括 native frames）
jstack -F <pid>
```

### 线程状态解读

```text
# jstack 输出示例
"main" #1 prio=5 os_prio=31 tid=0x00007f8a18008800 nid=0x1703 waiting on condition
    java.lang.Thread.State: TIMED_WAITING (parking)
        at java.lang.Object.wait(Native Method)
        at java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(...)
        at com.example.Main.lambda$main$0(Main.java:18)
        ...

# 线程状态说明
NEW              - 线程刚创建
RUNNABLE         - 正在运行或等待 CPU
BLOCKED          - 等待获取锁
WAITING          - 无限期等待
TIMED_WAITING    - 限时等待
TERMINATED       - 线程结束
```

### 查找死锁

```bash
# 查找死锁
jstack -l <pid> | grep -A 10 "Found one Java-level deadlock"

# 或者
jcmd <pid> Thread.print | grep -A 10 "Found one Java-level deadlock"
```

### 常见问题定位

```bash
# 查找 CPU 占用最高的线程
top -Hp <pid>
# 或
ps -p <pid> -L -o pid,tid,pcpu,time

# 将线程 ID 转为十六进制
printf "%x\n" <tid>

# 查找该线程的堆栈
jstack <pid> | grep -A 20 <hex_tid>
```

---

## jcmd：综合工具

### 基本用法

```bash
# 列出可用命令
jcmd <pid> help

# 输出
The following commands are available:
PerfCounter.print
GC.class_histogram
GC.heap_dump
GC.run_finalization
GC.run
VM.native_memory
VM.flags
VM.system_properties
VM.version
VM.command_line
VM.print_touched_objects
JFR.stop
JFR.start
JFR.dump
JFR.check
thread.print
...
```

### 常用命令

```bash
# 查看线程堆栈
jcmd <pid> Thread.print > thread.log

# 生成堆转储
jcmd <pid> GC.heap_dump /path/to/heap.hprof

# 查看类直方图
jcmd <pid> GC.class_histogram > class_histogram.log

# 运行 GC
jcmd <pid> GC.run

# 查看 JVM 标志
jcmd <pid> VM.flags

# 查看 Native Memory Tracking
jcmd <pid> VM.native_memory summary
```

---

## 工具组合使用

### 排查 CPU 高占用

```bash
# 1. 找到 CPU 占用最高的线程
top -Hp <pid>

# 2. 转换线程 ID
printf "%x\n" <tid>

# 3. 查看线程堆栈
jstack <pid> | grep -A 30 <hex_tid>
```

### 排查内存泄漏

```bash
# 1. 多次采样 Metaspace
jstat -gc <pid> 1000

# 2. 生成堆转储
jcmd <pid> GC.heap_dump /tmp/heap.hprof

# 3. 使用 MAT 分析
mat.sh /tmp/heap.hprof
```

### 排查 GC 问题

```bash
# 1. 开启 GC 日志
jcmd <pid> VM.log output=file=/tmp/gc.log,gc*=info

# 2. 监控 GC 统计
jstat -gcutil <pid> 1000

# 3. 查看 GC 原因
jcmd <pid> GC.run_finalization
```

---

## 面试追问方向

- jps 和 ps 都能看到 Java 进程，它们有什么区别？
- jstat -gc 和 jstat -gcutil 有什么区别？
- jmap -dump 和 jcmd GC.heap_dump 有什么区别？
- 如何用 jstack 定位死锁？
- jcmd 是 JDK 8 之后才有的吗？它能替代其他工具吗？
- 如何用这些工具快速定位 CPU 占用最高的代码？
