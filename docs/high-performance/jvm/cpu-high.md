# CPU 高占用分析：top、jstack、perf、async-profiler、火焰图

线上报警：CPU 使用率 100%，应用响应超时。

这种情况怎么处理？

今天我们介绍完整的 CPU 高占用分析流程。

---

## 一、CPU 高占用的常见原因

### 1.1 常见原因一览

| 原因 | 典型场景 | 表现特征 |
|-----|---------|---------|
| **死循环** | 代码 bug，while(true) 没有退出条件 | 单线程 CPU 100% |
| **频繁 GC** | 内存分配过快，GC 线程占用 CPU | 所有线程 CPU 都很高 |
| **频繁 Young GC** | 年轻代太小 | GC 线程占用 CPU |
| **正则表达式** | 复杂正则、回溯 | CPU 突然飙升 |
| **序列化/反序列化** | 大对象序列化 | CPU 飙升 |
| **加密/解密** | RSA、AES 计算密集 | CPU 飙升 |

### 1.2 快速定位思路

```
CPU 高占用
    ↓
是单线程还是多线程？
    ↓                     ↓
单线程              多线程
    ↓                     ↓
查看线程堆栈         查看各线程堆栈
找到问题代码         找到热点代码
```

---

## 二、分析工具概览

### 2.1 工具对比

| 工具 | 用途 | 特点 |
|-----|-----|-----|
| **top** | 查看进程 CPU 使用率 | 系统自带 |
| **pidstat** | 查看线程 CPU 使用率 | 需要安装 sysstat |
| **jstack** | 导出线程堆栈 | JDK 自带 |
| **perf** | 系统级性能分析 | Linux 内置 |
| **async-profiler** | Java 专用性能分析 | 功能强大 |
| **async-profiler** | 生成火焰图 | 可视化展示 |

### 2.2 工具获取

```bash
# perf（Linux 内置）
perf --version

# async-profiler（需要下载）
# https://github.com/jvm-profiling-tools/async-profiler
```

---

## 三、分析流程

### 3.1 第一步：定位进程

```bash
# 查看 Java 进程
ps aux | grep java

# 或使用 top
top
```

### 3.2 第二步：定位线程

```bash
# 查看线程 CPU 使用
top -Hp <pid>

# 或使用 pidstat
pidstat -p <pid> -t 1
```

### 3.3 第三步：获取线程堆栈

```bash
# 导出线程堆栈
jstack <pid> > thread_dump.txt

# 查看特定线程
jstack <pid> | grep -A 20 <thread_id>
```

### 3.4 第四步：使用 async-profiler 分析

```bash
# 如果已安装 async-profiler
./profiler.sh -d 60 -e cpu <pid>  # CPU 采样 60 秒
./profiler.sh -d 60 -e alloc <pid>  # 内存分配采样 60 秒

# 生成 flamegraph.html
./profiler.sh -d 60 -e cpu <pid> --format=jfr -o flamegraph.html
```

---

## 四、async-profiler 使用详解

### 4.1 安装

```bash
# 下载
wget https://github.com/jvm-profiling-tools/async-profiler/releases/download/v2.9/async-profiler-2.9-linux-x64.tar.gz

# 解压
tar -xzf async-profiler-2.9-linux-x64.tar.gz
```

### 4.2 基本用法

```bash
# CPU 采样
./profiler.sh -d 30 <pid>

# 指定采样时间
./profiler.sh -d 60 -f output.html <pid>

# 生成火焰图
./profiler.sh -d 60 --format=flamegraph -o flamegraph.html <pid>

# 内存分配采样
./profiler.sh -d 60 -e alloc <pid>

# 锁争用采样
./profiler.sh -d 60 -e lock <pid>
```

### 4.3 输出格式

```bash
# 文本格式
./profiler.sh -d 30 <pid>

# 输出示例
--- 97.72% ---
    97.72%  1234ms  com/example/Service.process (Service.java:45)
    65.43%  823ms   com/example/Util.compute (Util.java:89)
    32.29%  406ms   java/util/HashMap.get (HashMap.java:408)
```

### 4.4 生成火焰图

```bash
# 使用 FlameGraph 工具生成火焰图
git clone https://github.com/brendangregg/FlameGraph.git

# 生成火焰图
./profiler.sh -d 60 <pid> | ./FlameGraph/flamegraph.pl > flamegraph.svg

# 或者直接生成 HTML
./profiler.sh -d 60 --format=html -o flamegraph.html <pid>
```

---

## 五、火焰图解读

### 5.1 火焰图结构

```
                             ___cpu100%___
                            /              \
                      ___cpu70%___        cpu30%
                     /            \           \
                cpu50%           cpu20%    |
               /      \           |         |
            cpu30%   cpu20%     cpu20%     cpu10%
           /    \     |          |           |
        cpu15% cpu15% cpu10%   cpu10%     cpu10%
        /|\   /|\   /|\        /|\        /|\
       a b c d e f g h i     j k l      m n

       每个方块代表一个采样点
       方块越宽表示该方法占用的 CPU 越多
```

### 5.2 如何阅读

1. **从下往上看**：最下面是入口方法
2. **从上往下看**：显示调用栈
3. **方块宽度**：表示 CPU 占用比例
4. **顶部尖峰**：通常是热点方法

### 5.3 火焰图类型

| 类型 | 分析目标 | 采样事件 |
|-----|---------|---------|
| **CPU 火焰图** | 分析 CPU 热点 | cpu cycles |
| **内存火焰图** | 分析内存分配 | alloc |
| **锁火焰图** | 分析锁争用 | lock |
| **堆栈火焰图** | 分析堆内存 | heap |

### 5.4 生成各类火焰图

```bash
# CPU 火焰图
./profiler.sh -d 60 -e cpu <pid> --format=flamegraph -o cpu.svg

# 内存分配火焰图
./profiler.sh -d 60 -e alloc <pid> --format=flamegraph -o alloc.svg

# 锁争用火焰图
./profiler.sh -d 60 -e lock <pid> --format=flamegraph -o lock.svg
```

---

## 六、实战案例

### 6.1 案例一：死循环导致 CPU 100%

**场景**：某个接口响应很慢，CPU 100%

**分析**：

```bash
# 1. top 查看 CPU 使用
top -Hp <pid>
# 发现线程 ID 1234 CPU 占用 100%

# 2. 查看该线程堆栈
jstack <pid> | grep -A 20 0x4d2
# 发现热点代码：
# "pool-1-thread-1" #12 prio=5 os_prio=0 tid=0x00007f8c12345678 nid=0x4d2 runnable
#    at com.example.Service.process (Service.java:45)
#    at com.example.Service.lambda$0(Service.java:30)
#    at com.example.Controller.handle(Controller.java:20)

# 3. 查看代码
# Service.java:45 行存在死循环
```

**结果**：找到问题代码，死循环修复后正常。

### 6.2 案例二：正则表达式回溯

**场景**：某个接口偶尔 CPU 飙升

**分析**：

```bash
# 1. 使用 async-profiler 采样
./profiler.sh -d 60 -e cpu <pid> -f output.html

# 2. 打开 output.html
# 发现热点：
#    at java/util/regex/Pattern$Curly.match (Pattern.java:...)
#    at java/util/regex/Pattern$GroupHead.match (Pattern.java:...)

# 3. 查看代码
# Pattern: ".*a.*b.*c.*d.*e.*f.*g.*h.*i.*"
# 问题：.* 贪婪匹配导致大量回溯
```

**结果**：优化正则表达式后正常。

### 6.3 案例三：GC 频繁导致 CPU 高

**场景**：GC 线程占用大量 CPU

**分析**：

```bash
# 1. 使用 async-profiler 采样
./profiler.sh -d 60 -e cpu <pid>

# 2. 发现：
# G1 ConcurrentMark::remark() 30%
# G1 ConcurrentMark::scanPhantomRefs() 20%
# JVM 的 GC 线程占用大量 CPU

# 3. 查看 GC 日志
# GC 频率：每分钟 30 次 Minor GC

# 4. 解决方案
# 增大年轻代：-Xmn2g
```

**结果**：增大年轻代后，GC 频率降低，CPU 恢复正常。

---

## 七、常用命令速查

### 7.1 快速定位

```bash
# 1. 找到 Java 进程
ps aux | grep java

# 2. 查看线程 CPU
top -Hp <pid>

# 3. 导出堆栈
jstack <pid> > thread_dump.txt

# 4. 使用 async-profiler
./profiler.sh -d 60 <pid>
```

### 7.2 async-profiler 常用命令

```bash
# CPU 采样
./profiler.sh -d 60 -e cpu <pid>

# 内存分配采样
./profiler.sh -d 60 -e alloc <pid>

# 生成火焰图
./profiler.sh -d 60 --format=flamegraph -o flamegraph.html <pid>
```

---

## 八、预防措施

### 8.1 监控告警

```yaml
# Prometheus 告警
- alert: HighCPU
  expr: rate(process_cpu_seconds_total[5m]) > 0.8
  annotations:
    summary: "CPU 使用率超过 80%"
```

### 8.2 代码规范

1. **避免死循环**
2. **合理使用正则表达式**
3. **减少不必要的对象创建**
4. **使用合适的算法复杂度**

### 8.3 定期分析

1. 定期使用 async-profiler 分析
2. 发现热点代码及时优化
3. 关注 GC 频率和耗时

---

## 总结

CPU 高占用分析的核心要点：

1. **top + jstack**：快速定位问题
2. **async-profiler**：深度分析热点
3. **火焰图**：可视化展示调用栈
4. **分析流程**：定位进程 → 定位线程 → 采样分析 → 找到热点
5. **预防为主**：代码规范 + 监控告警

---

## 思考题

使用火焰图分析时，发现某个方法的 CPU 占用比例很高，但该方法本身逻辑很简单（只有几行代码）。这种情况可能是什么原因？

提示：考虑调用栈、被调用次数、以及其他可能的原因。
