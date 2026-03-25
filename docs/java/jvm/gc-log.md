# GC 日志分析实战：从日志读懂 GC 行为

GC 日志是排查 GC 问题的第一手资料。

但面对一堆 `[GC` 和 `[Full GC` 的日志，你真的能读懂 GC 在做什么吗？

---

## GC 日志配置

### 基础配置

```bash
# JDK 8 及之前：经典配置
java -XX:+PrintGCDetails \
     -XX:+PrintGCDateStamps \
     -XX:+PrintTenuringDistribution \
     -Xloggc:/path/to/gc.log \
     -XX:+UseSerialGC \
     your.Application

# JDK 9+：统一日志配置（推荐）
java -Xlog:gc*:file=/path/to/gc.log:time,uptime,level,tags \
     -XX:+UseG1GC \
     your.Application
```

### JDK 8 vs JDK 9+ 日志格式

```bash
# JDK 8：可视化友好，但格式分散
-XX:+PrintGCDetails -XX:+PrintGCDateStamps

# 示例输出：
2024-01-15T10:30:00.123+0800: [GC [DefNew: 512K->0K(576K), 0.0012345 secs]
  [Times: user=0.01 sys=0.00, real=0.01 secs]

# JDK 9+：统一格式，可配置性强
-Xlog:gc*=info:file=gc.log:time,level,tags

# 示例输出：
[2024-01-15T10:30:00.123+0800] [gc] GC(0) Young GC 512K->0K(576K) 1.234ms
```

---

## 常见 GC 日志解读

### Serial GC 日志（JDK 8）

```text
2024-01-15T10:30:00.123: [GC (Allocation Failure)
    # GC 类型：Allocation Failure = Eden 分配失败 = Minor GC
    # Allocation Failure 不是错误，是正常的 GC 触发原因
    Before GC:
    # 年轻代信息（GC 前）
    def new generation   total 57600K, used 54000K
    # def new generation：年轻代（ParNew/Serial 年轻代也叫这个名字）
    # total：总容量
    # used：已使用
    eden space 51200K,   96% used
    # Eden 区：51MB，96% 使用率
    from space 6400K,    0% used
    # From Survivor 区
    to   space 6400K,    0% used
    # To Survivor 区
 After GC:
    # 年轻代信息（GC 后）
    def new generation   total 57600K, used 6400K
    # GC 后，存活对象在 From Survivor 中（64KB）
    eden space 51200K,   0% used
    # Eden 区被清空
    from space 6400K,    100% used
    # From Survivor 区满了
    to   space 6400K,    0% used
    # To Survivor 区是空的（交换角色）
 [Times: user=0.01 sys=0.00, real=0.02 secs]
    # user：用户态 CPU 时间
    # sys：内核态 CPU 时间
    # real：实际停顿时间
```

### Full GC 日志

```text
2024-01-15T10:30:05.456: [Full GC (Allocation Failure)
    # Full GC 触发原因：Allocation Failure
    # Allocation Failure = 老年代无法分配对象 = 老年代满
    [Tenured: 175104K->80000K(175104K), 2.5000000 secs]
    # Tenured = 老年代
    # 175104K->80000K：GC 前 175MB → GC 后 80MB
    # (175104K)：总容量 175MB
    # 2.5 secs：停顿 2.5 秒！
    [Times: user=10.00 sys=0.50, real=2.50 secs]
    # user=10s：10 倍 CPU 时间（多线程）
```

### CMS GC 日志

```text
# 初始标记
2024-01-15T10:30:00.123: [GC (CMS Initial Mark)
    [CMS-initial-mark: 102400K(204800K)] 102400K(204800K), 0.0012345 secs]
    # CMS Initial Mark：只标记 GC Roots 直接引用的对象
    # 老年代使用 100MB / 200MB

# 并发标记
2024-01-15T10:30:00.124: [CMS-concurrent-mark-start]
2024-01-15T10:30:00.234: [CMS-concurrent-mark: 0.110/0.110 secs]
    # 并发标记：0.11 秒（不 STW）

# 并发预清理
2024-01-15T10:30:00.234: [CMS-concurrent-preclean-start]
2024-01-15T10:30:00.244: [CMS-concurrent-preclean: 0.010/0.010 secs]

# 重新标记
2024-01-15T10:30:00.244: [CMS-remark]
    [CMS-initial-remark: 120000K(204800K)] 120000K(204800K), 0.0020000 secs]
    # 重新标记：修正并发期间的变动

# 并发清除
2024-01-15T10:30:00.246: [CMS-concurrent-sweep-start]
2024-01-15T10:30:00.346: [CMS-concurrent-sweep: 0.100/0.100 secs]

# 并发重置
2024-01-15T10:30:00.346: [CMS-concurrent-reset-start]
2024-01-15T10:30:00.356: [CMS-concurrent-reset: 0.010/0.010 secs]

# Concurrent Mode Failure
2024-01-15T10:35:00.000: [Full GC (Concurrent Mode Failure)
    # 并发模式失败！CMS 收集期间老年代满了
    [CMS: 204800K->150000K(204800K), 2.5000000 secs]
    # 触发 Serial Old Full GC
```

### G1 GC 日志

```text
# Young GC
2024-01-15T10:30:00.123: [GC pause (G1 Evacuation Pause) (young)
    # G1 年轻代回收
    # Evacuation Pause：复制/疏散阶段
    # (young)：年轻代 Region
    (Eden: 1320.0M(1320.0M)->0.0B(1180.0M)
    # Eden 区：使用 1.3GB → 0，使用 0 → 变成 1.18GB（重新计算）
    Survivors: 15.0M->35.0M
    # Survivor 区：15MB → 35MB（对象晋升）
    Heap: 2548.0M(4096.0M)->1323.0M(4096.0M)]
    # 堆使用：2.5GB → 1.3GB（总容量 4GB）
    [Times: user=0.80 sys=0.10, real=0.15 secs]
    # 停顿 150ms

# Mixed GC
2024-01-15T10:35:00.000: [GC pause (G1 Evacuation Pause) (mixed)
    # 混合回收
    (Eden: 1100.0M(1200.0M)->0.0B(1150.0M)
    Survivors: 35.0M->40.0M
    Heap: 3200.0M(4096.0M)->1800.0M(4096.0M)]
    # 包含老年代 Region 的回收
```

### ZGC 日志（JDK 11+）

```text
[2024-01-15T10:30:00.123+0800] [gc] GC(0) Young GC 256M->0M(1024M) 0.521ms
    # GC(0)：第 0 次 GC
    # Young GC：年轻代收集
    # 256M->0M：256MB → 0MB
    # (1024M)：堆容量
    # 0.521ms：停顿 0.5ms

[2024-01-15T10:30:01.000+0800] [gc] GC(1) Relocation 512M->256M(1024M) 0.831ms
    # Relocation：重定位
    # 对象移动后的修复

# 分代 ZGC（JDK 15+）
[gc] GC(2) Young GC 128M->0M 0.5ms
[gc] GC(3) Old GC 512M->256M 0.3ms
```

---

## GC 问题分析

### 问题 1：频繁 Young GC

```
症状：YGC 次数过多（如每秒 10+ 次）
```

```bash
# 排查命令
grep "Young GC" gc.log | wc -l    # 统计 Young GC 次数
grep "Young GC" gc.log | tail -20  # 查看最近的 Young GC

# 原因分析
1. Eden 区太小
   表现：Eden 使用率迅速达到 100%
   解决：-Xmn256m 或 -XX:NewSize=256m

2. 对象分配太快
   表现：Eden 使用率高，且每次 GC 存活对象多
   解决：检查代码，排查内存泄漏

3. Survivor 区太小
   表现：存活对象直接晋升老年代
   解决：-XX:MaxTenuringThreshold 调整
```

### 问题 2：Full GC 频繁

```
症状：FGC 次数增长，停顿时间长
```

```bash
# 排查命令
grep "Full GC" gc.log | wc -l          # Full GC 次数
grep "Full GC" gc.log | tail -20        # 查看 Full GC 日志
grep "concurrent mode failure" gc.log  # CMS 并发模式失败

# 原因分析
1. 老年代空间不足
   表现：Old 区使用率持续 > 90%
   解决：-Xmx 增大堆，或优化对象生命周期

2. 内存泄漏
   表现：Old 区使用率持续增长，不回落
   解决：jmap -heap 分析，或 MAT 分析堆转储

3. CMS 并发模式失败
   表现：出现 "Concurrent Mode Failure"
   解决：-XX:CMSInitiatingOccupancyFraction 调低
```

### 问题 3：GC 停顿时间过长

```
症状：GC 停顿超过预期（如 G1 超过 MaxGCPauseMillis）
```

```bash
# 排查命令
grep "Times:" gc.log | awk '{print $NF}' | sort -n | tail -10
# 找出停顿最长的 10 次 GC

# 原因分析
1. 堆太大
   表现：GC 线程遍历时间长
   解决：减小堆大小，或换用 ZGC

2. 对象太多
   表现：存活对象多，复制时间长
   解决：减少对象创建，优化数据结构

3. 跨代引用
   表现：GC 时间随堆使用率增长
   解决：G1 的 RSet 优化，或使用 ZGC
```

---

## GC 日志分析工具

### GCEasy（在线工具）

```bash
# 上传 gc.log 到 https://gceasy.io
# 自动分析：
# - GC 吞吐量
# - 停顿时间
# - GC 频率
# - 内存趋势
# - 问题建议
```

### GCViewer

```bash
# 下载：https://github.com/chewiebug/GCViewer
java -jar gcviewer.jar gc.log
```

### 日志命令分析

```bash
# 统计 GC 次数
grep -c "Young GC" gc.log    # Young GC 次数
grep -c "Full GC" gc.log     # Full GC 次数

# 统计 GC 时间
grep "Young GC" gc.log | awk -F'real=' '{print $2}' | awk '{sum+=$1} END {print sum}'
grep "Full GC" gc.log | awk -F'real=' '{print $2}' | awk '{sum+=$1} END {print sum}'

# 查看 GC 频率趋势
grep "Young GC" gc.log | awk '{print $1}' | uniq -c
```

---

## 面试追问方向

- 如何从 GC 日志判断 Young GC 和 Full GC 的触发原因？
- CMS 的「Concurrent Mode Failure」是什么意思？如何在日志中发现？
- G1 的 Mixed GC 和 Young GC 有什么区别？
- ZGC 的日志有什么特点？如何判断 ZGC 是否正常工作？
- 如果 Full GC 频繁，但 Old 区使用率不高，可能是什么原因？
- 如何根据 GC 日志计算应用的吞吐量？
