# CPU 高占用分析：Arthas trace 与火焰图

线上服务突然变慢，接口响应时间飙升——大多数人的第一反应是「数据库慢」或「网络抖动」。

但真正的原因可能就藏在你的代码里：一个死循环、一个低效的递归、或者一个被频繁调用的 Heavy 方法。

这一节，教你用最少的工具，在最短时间内把 CPU 占用最高的代码定位出来。

---

## 排查思路：四步定位法

```
top 命令找到 Java 进程
         ↓
top -Hp 找到高 CPU 线程
         ↓
jstack 导出线程堆栈
         ↓
Arthas trace 定位耗时方法
```

---

## 第一步：top 定位 Java 进程

```bash
top -c
```

找到 Java 进程的 PID（最后一列 `COMMAND` 显示完整命令）。

```
  PID USER      PR  NI  VIRT  RES  SHR  %CPU %MEM    TIME+  COMMAND
12345 root      20   0  8.0g  2.1g  56m  98.5  12.0   1:23.45 java -jar app.jar
```

如果机器上有多个 Java 进程，可以用 `-p` 指定进程：

```bash
top -p 12345
```

---

## 第二步：top -Hp 定位高 CPU 线程

```bash
top -Hp 12345
```

`-H` 显示线程视角，`-p` 指定进程。找到 `%CPU` 最高的那几个线程，记下它们的线程 ID（nid）。

```
  PID USER      PR  NI  %CPU  COMMAND
12666 root      20   0  85.3%  VM Thread
12667 root      20   0  12.1%  VM Thread
12668 root      20   0   2.3%  C2 CompilerThread
```

这里看到 nid = 12666 的线程 CPU 占用高达 85.3%，基本可以确定是问题线程。

**注意**：top 显示的线程 ID 是十进制，jstack 中的是十六进制，需要转换：

```bash
# 十进制转十六进制
printf '%x\n' 12666
# 输出: 317a
```

---

## 第三步：jstack 导出线程堆栈

```bash
jstack 12345 > /tmp/jstack.log
```

然后在日志中搜索刚才的十六进制线程 ID：

```bash
grep -A 20 "nid=0x317a" /tmp/jstack.log
```

输出类似：

```
"main" #1 prio=5 os_prio=0 tid=0x00007f8a9c01a000 nid=0x317a runnable [0x00007f8a9c000000]
   java.lang.Thread.dumpThreads(Native Method)
   com.example.HeavyService.process(HeavyService.java:42)
   com.example.Controller.handle(Controller.java:28)
   ...
```

这段堆栈直接指出了问题代码：`HeavyService.process()` 方法。

---

## 第四步：Arthas trace 精确定位耗时方法

jstack 只能看到调用栈，但如果方法执行很快、调用次数很多，定位起来就不够精准了。

Arthas 的 `trace` 命令可以追踪方法内部每一步的耗时，把「慢在哪」精确到行。

### 启动 Arthas

```bash
# 方式一：attach 到已有进程
java -jar arthas-boot.jar
# 然后选择目标进程

# 方式二：直接启动（测试环境）
java -jar arthas-boot.jar -p 12345
```

### trace 命令

```bash
# 追踪指定类的方法执行时间（默认只显示耗时 > 10ms 的）
trace com.example.HeavyService process

# 限制耗时阈值（显示 > 1ms 的）
trace com.example.HeavyService process '#cost > 1'

# 同时追踪多个方法
trace com.example.*Service *

# 追踪方法内部调用链
trace com.example.Controller handle -n 5
```

`-n 5` 表示只记录前 5 次调用，防止输出太多。

### trace 输出解读

```
`---[1542ms] com.example.HeavyService:process()
    +---[23ms] com.example.HeavyService:methodA()
    |   `---[21ms] com.example.DBService:query()
    +---[1501ms] com.example.HeavyService:methodB()
        `---[1498ms] com.example.CacheService:get()
```

从输出中一目了然：`methodB()` 占了 1501ms，其中 `CacheService.get()` 占了 1498ms——问题就出在这里。

### 异步 trace

如果方法执行很快、调用次数很多，trace 可能漏掉大量短调用。此时可以开启 `-m 100` 限制输出行数，同时用 `--skipJDKMethod false` 包含 JDK 方法：

```bash
trace java.lang.String * -m 50
```

---

## 进阶：火焰图（Flame Graph）

火焰图是 CPU 性能分析的终极武器，能够可视化地展示 CPU 时间在各个方法中的分布。

### 使用 Arthas profiler

```bash
# 启动 profiler（默认采集 CPU 采样）
profiler start

# 运行一段时间后（比如 30 秒）
sleep 30

# 停止并生成火焰图
profiler stop --format html --file /tmp/flamegraph.html
```

生成的 HTML 文件可以用浏览器打开，看到类似这样的火焰图：

```
                            [hot]
                              |
                         [queryDB]
                              |
                       [handleRequest]
                              |
                        [doGet/post]
                              |
                             main
```

火焰图的每一层是一个方法，宽度表示该方法占用 CPU 的比例。**越「尖」的部分（宽度越宽），越是性能瓶颈。**

### 读取火焰图的技巧

- **顶尖是热点**：最上面的方法是被直接调用的热点
- **宽度代表 CPU 占比**：方框越宽，CPU 占用越高
- **从下往上看**：从根到尖的路径就是调用栈
- **比较模式**：生产环境新旧版本对比，差异一目了然

### 火焰图的其他采样模式

```bash
# CPU 采样（默认）
profiler start --event cpu

# 内存分配采样（排查 GC 频繁）
profiler start --event alloc

# lock 争用采样
profiler start --event lock
```

---

## 常见 CPU 高占用场景

### 场景一：死循环

```java
// 反例：没有终止条件的 while
while (true) {
    if (condition) {
        break;  // condition 永远不满足
    }
    process();
}
```

特征：单个线程 CPU 100%，jstack 显示线程一直停在同一个方法上。

### 场景二：正则表达式灾难

```java
// 反例：每次匹配都编译正则
for (String line : lines) {
    Pattern p = Pattern.compile("^\\d+-[a-z]+-\\d+$");  // 每次循环都编译！
    Matcher m = p.matcher(line);
}
```

特征：CPU 高但 GC 正常，问题在 Pattern.compile()。

**改进**：把 Pattern 提到循环外。

### 场景三：频繁 GC 导致 CPU 飙升

```java
// 反例：在循环中不断创建大对象
for (int i = 0; i < 100000; i++) {
    List&lt;String&gt; list = new ArrayList&lt;&gt;(10000);  // 每次循环都创建
    process(list);
}
```

特征：CPU 高，GC 日志显示频繁 Full GC。此时要看 `jstat -gcutil`：

```bash
jstat -gcutil 12345 1000
```

### 场景四：加密/压缩等 CPU 密集型操作

特征：CPU 高但耗时稳定，通常是业务需求而非 bug。可以考虑：
- 异步处理
- 分布式计算
- 硬件加速（AES-NI）

---

## 一站式命令脚本

以下是一个快速定位脚本，适用于大多数场景：

```bash
#!/bin/bash
PID=$1
THREAD_CNT=10  # 显示前 N 个高 CPU 线程

echo "=== 1. 找到高 CPU 线程 ==="
top -b -n 1 -p $PID -c | awk -v cnt=$THREAD_CNT '
NR>7 && cnt-->0 { print $1, $9 }'

echo ""
echo "=== 2. 高 CPU 线程的堆栈 ==="
top -b -n 1 -p $PID -H | awk 'NR>7 {
    printf "0x%x\n", $1
}' | while read nid; do
    echo "--- Thread nid=$nid ---"
    jstack $PID | grep -A 15 "nid=$nid"
done
```

---

## 面试追问方向

- **Arthas 的 trace 和 profiler 有什么区别？**
  - trace：运行时织入字节码，记录方法调用耗时，主动采样
  - profiler：基于 JVMTI 或采样，对运行时零侵入，生成火焰图

- **火焰图和 jstack 的本质区别是什么？**
  - jstack 是快照，抓的是某一个时刻的调用栈
  - 火焰图是时间累积，横轴代表 CPU 时间，纵轴是调用栈聚合

- **在容器环境（K8s）中如何定位 CPU 问题？**
  - `docker stats` 查看容器 CPU 占用
  - `kubectl top pod` 查看 Pod 级别
  - 容器内进程看到的 CPU 时间可能被 cgroup 限制影响

- **JIT 编译热点导致的 CPU 飙升怎么处理？**
  - Warm-up 期间 JIT 编译消耗大量 CPU 正常
  - 预热策略：用流量预热后再切到生产流量
  - 分层编译（Tiered Compilation）：`-XX:+TieredCompilation`
