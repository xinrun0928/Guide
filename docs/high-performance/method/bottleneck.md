# 性能瓶颈分析方法：APM、火焰图、Arthas、jstack

系统又慢了？先别猜，先测量。

很多开发者的第一反应是「加缓存」「扩容」「换数据库」。但真相往往是：你根本不知道瓶颈在哪。

性能优化最怕的是什么？不是技术不够，是方向错了。

这篇文章介绍几种**定位瓶颈**的利器，让你的优化有的放矢。

## APM：全链路追踪

APM（Application Performance Monitoring）是性能诊断的「雷达」。它能追踪一个请求从网关到数据库的完整路径，告诉你每一层耗时多少。

### Skywalking

Skywalking 是 Apache 基金会的顶级项目，专门为分布式系统设计。

**核心能力：**

- 自动追踪：无需修改代码，自动埋点
- 链路追踪：清晰看到请求经过的每个节点
- 拓扑图：系统组件之间的依赖关系一目了然

```yaml
# docker-compose 快速部署
version: '3'
services:
  oap:
    image: apache/skywalking-oap-server:9.5.0
    ports:
      - "11800:11800"  # gRPC 端口
      - "12800:12800"  # HTTP 端口
  ui:
    image: apache/skywalking-ui:9.5.0
    ports:
      - "8080:8080"
    environment:
      - SW_OAP_ADDRESS=oap:12800
```

Skywalking 会自动生成这样的链路图：

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  Gateway │───▶│  User   │───▶│  Order  │───▶│  MySQL  │
│  12ms    │    │ Service │    │ Service │    │  85ms   │
└─────────┘    │  8ms    │    │  25ms   │    └─────────┘
               └─────────┘    └─────────┘

总耗时: 130ms → 数据库占了 65%
```

看，**瓶颈一目了然**。你花一周优化网关，从 12ms 降到 10ms，收益 2ms；但优化数据库，从 85ms 降到 20ms，收益 65ms。

### Pinpoint

Pinpoint 是韩国 NAVER 团队开发的 APM 工具，与 Skywalking 功能类似。

**与 Skywalking 的对比：**

| 特性 | Skywalking | Pinpoint |
|-----|-----------|----------|
| 埋点方式 | 字节码增强 | 字节码增强 |
| 链路展示 | 火焰图 + 拓扑图 | 拓扑图 + 时序图 |
| 数据库支持 | 广泛 | 广泛 |
| 社区活跃度 | 非常活跃 | 较活跃 |
| 中国企业使用 | 多（BAT 等） | 一般 |

## 火焰图：CPU 性能分析

火焰图（Flame Graph）是 Brendan Gregg 发明的一种性能分析可视化工具。它把 CPU 时间以火焰的形状展示出来，火焰越高，说明占用的 CPU 时间越多。

### async-profiler

async-profiler 是 Java 生态中最强大的 CPU 采样工具之一。

```bash
# 下载并启动
wget https://github.com/async-profiler/async-profiler/releases/download/v2.10/async-profiler-2.10-linux-x64.tar.gz
tar -xzf async-profiler-2.10-linux-x64.tar.gz

# 采样 60 秒，输出火焰图
./profiler.sh -d 60 -f flamegraph.html <pid>
```

### 火焰图解读

```
                            [jvm] java.lang.Thread.run()
                            │
                            ├── [jvm] com.example.Service.process()
                            │   │
                            │   ├── [jvm] HashMap.get()     ← 火焰较高，需要关注
                            │   │
                            │   └── [jvm] String.contains()
                            │
                            └── [jvm] List.forEach()
                                │
                                └── [sys] pthread_mutex_lock()
```

**怎么看火焰图：**

1. **从下往上看**：每一层都是调用栈
2. **从宽往窄看**：越宽的柱子，占用的 CPU 时间越多
3. **从尖顶找热点**：最顶端的窄火焰，可能是热点代码

**火焰图的类型：**

| 类型 | 用途 | 采样内容 |
|-----|------|---------|
| CPU 火焰图 | 定位 CPU 热点 | CPU time |
| 内存火焰图 | 定位内存分配 | 堆内存分配 |
| 锁火焰图 | 定位锁竞争 | 等待时间 |

### 用 Java 代码生成火焰图数据

```java
import java.lang.management.*;
import java.util.*;

public class CPUProfiler {

    private static final RuntimeMXBean runtime = ManagementFactory.getRuntimeMXBean();
    private static final OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
    private static final List&lt;GarbageCollectorMXBean&gt; gcBeans = ManagementFactory.getGarbageCollectorMXBeans();

    public static void main(String[] args) throws InterruptedException {
        // 采样间隔 10ms，持续 30 秒
        int intervalMs = 10;
        int durationSec = 30;

        Map<String, Long> hotspots = new HashMap<>();

        for (int i = 0; i < durationSec * 1000 / intervalMs; i++) {
            Thread.sleep(intervalMs);

            // 获取当前线程
            Map<Thread, StackTraceElement[]> allStacks = Thread.getAllStackTraces();

            for (Map.Entry<Thread, StackTraceElement[]> entry : allStacks.entrySet()) {
                Thread thread = entry.getKey();
                if (thread.getState() != Thread.State.RUNNABLE) {
                    continue;
                }

                for (StackTraceElement frame : entry.getValue()) {
                    String key = frame.getClassName() + "." + frame.getMethodName();
                    hotspots.merge(key, 1L, Long::sum);
                }
            }
        }

        // 输出热点方法
        System.out.println("=== CPU 热点方法 ===");
        hotspots.entrySet().stream()
            .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
            .limit(20)
            .forEach(e -> System.out.printf("%s: %d (%.2f%%)%n",
                e.getKey(),
                e.getValue(),
                e.getValue() * 100.0 / hotspots.values().stream().mapToLong(Long::longValue).sum()));
    }
}
```

## Arthas：在线诊断神器

Arthas 是阿里巴巴开源的 Java 诊断工具，最大的特点是**在线诊断，无需重启**。

### 常用命令

```bash
# 启动 Arthas
java -jar arthas-boot.jar

# 查看 Dashboard（实时监控面板）
dashboard

# 查看某个方法的调用统计
watch com.example.Service process '{params, returnObj, throwExp}' -x 3

# 追踪方法调用链路
trace com.example.Service process '#cost > 10'

# 查看线程状态
thread

# 查看线程堆栈
thread -n 5

# 反编译类
jad com.example.Service
```

### 用 Arthas 分析性能问题

假设你的接口响应时间很慢，怀疑是某个 SQL 查询的问题：

```bash
# 1. 先看整体情况
$ dashboard

# 2. 找到慢的调用
$ trace com.example.OrderService createOrder '#cost > 100'

# 3. 查看具体是哪个方法慢
$ trace com.example.OrderService createOrder -n 5

# 4. 如果是数据库问题，查看 SQL
$ monitor -c com.example.OrderService createOrder
```

### Arthas 命令详解

```java
// dashboard 输出示例
Thread                   CPU Usage   Blocked   Waiting
────────────────────────────────────────────────────────
main                     0.12%       0         0
http-nio-8080-exec-1     15.23%      0         0        ← 请求处理线程
http-nio-8080-exec-2     0.08%       0         0
GC                       0.00%       0         0

Memory                   Used    Max      Usage
────────────────────────────────────────────
heap                     256MB   512MB    50.00%
non-heap                 128MB   -1       -
```

## jstack：线程堆栈分析

jstack 是 JDK 自带的工具，专门用来分析线程状态。

```bash
# 抓取线程堆栈
jstack <pid> > thread_dump.txt

# 查找死锁
jstack -l <pid>

# 查找 CPU 占用最高的线程
jstack -l <pid> | grep -A 10 " nid=0x" | head -50
```

### 线程状态分析

```java
// jstack 输出示例
"http-nio-8080-exec-10" #50 daemon prio=5 os_prio=31 tid=0x00007f8a5c01a800 nid=0x6e23 waiting on condition [0x0000700010c4f000]
   java.lang.Thread.State: WAITING (parking)
    - java.util.concurrent.SynchronousQueue.transfer(???) @bci=0 (Interpreted frame)
    - java.util.concurrent.ThreadPoolExecutor.getTask() @bci=85 (Interpreted frame)
    - java.util.concurrent.ThreadPoolExecutor.runWorker() @bci=26 (Interpreted frame)
    - java.util.concurrent.ThreadPoolExecutor$Worker.run() @bci=0 (Interpreted frame)
```

**线程状态含义：**

| 状态 | 说明 | 排查方向 |
|-----|------|---------|
| RUNNABLE | 正在运行 | CPU 占用、计算密集 |
| BLOCKED | 等待获取锁 | 锁竞争 |
| WAITING | 等待被唤醒 | wait/notify、LockSupport |
| TIMED_WAITING | 带超时的等待 | sleep、wait with timeout |
| NEW | 刚创建 | 正常状态 |
| TERMINATED | 已结束 | 正常状态 |

### 快速定位死锁

```bash
# jstack -l 会自动检测死锁
jstack -l <pid> | grep -A 20 "Found one Java-level deadlock"
```

输出会包含死锁涉及的线程、锁信息、以及完整的调用栈。

## 诊断流程建议

```
1. APM 看整体
   └── 链路追踪，找到耗时最长的节点

2. 火焰图看 CPU
   └── 定位 CPU 热点函数

3. Arthas 看细节
   └── trace/watch，找到具体的方法

4. jstack 看线程
   └── 线程状态、死锁排查
```

## 总结

性能瓶颈分析是系统工程：

- **APM** 是雷达，帮你看到全局
- **火焰图** 是放大镜，帮你看到 CPU 热点
- **Arthas** 是手术刀，帮你精准定位
- **jstack** 是听诊器，帮你诊断线程状态

记住：优化之前先诊断，不要凭直觉猜测。

---

## 思考题

1. 你的团队现在用的是什么性能诊断工具？如果还没有 APM 工具，最想上哪一个？为什么？

2. 假设你用火焰图发现某个方法的 CPU 占用很高，但这个方法是 JDK 自带的——你该怎么办？

3. jstack 显示线程处于 BLOCKED 状态，但代码里明明没有 synchronized——还有哪些可能导致线程阻塞？
