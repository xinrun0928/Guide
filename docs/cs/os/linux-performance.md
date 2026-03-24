# Linux性能分析：top、vmstat、iostat、netstat

凌晨3点，你的服务器CPU 100%，用户开始投诉。
你打开终端，敲了几个命令，5分钟后找到了问题。

这就是**性能分析**的力量。


## 性能分析基础

### 四大资源

```
┌─────────────────────────────────────────────────────────────┐
│                    系统四大资源                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. CPU                                                     │
│     - 利用率                                                │
│     - 运行队列长度                                           │
│     - 上下文切换                                            │
│                                                             │
│  2. 内存                                                    │
│     - 物理内存使用                                           │
│     - 交换空间（swap）                                       │
│     - 缓存/缓冲区                                            │
│                                                             │
│  3. I/O                                                     │
│     - 磁盘I/O                                               │
│     - 文件系统                                              │
│                                                             │
│  4. 网络                                                    │
│     - 带宽使用                                              │
│     - 连接数                                                │
│     - 丢包率                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 性能分析工具链

```bash
# CPU分析
top, htop          # 实时CPU监控
vmstat             # 虚拟内存和CPU统计
mpstat             # 每CPU核心统计
pidstat            # 进程级CPU统计

# 内存分析
free -h            # 内存使用概览
vmstat             # 虚拟内存统计
pmap               # 进程内存映射
slabtop            # 内核对象缓存

# I/O分析
iostat             # 磁盘I/O统计
iotop              # 进程I/O监控
lsof               # 打开的文件
df                 # 磁盘空间

# 网络分析
netstat, ss        # 网络连接统计
iftop              # 实时带宽监控
tcpdump            # 网络抓包
```


## top：系统监控利器

### 基础用法

```bash
top
# 按P：按CPU排序
# 按M：按内存排序
# 按N：按PID排序
# 按T：按运行时间排序
# 按q：退出
# 按1：显示每个CPU核心
# 按c：显示完整命令
# 按k：杀死进程
```

### top界面解读

```
top - 14:32:01 up 45 days, 3:22,  2 users,  load average: 0.58, 0.42, 0.38
Tasks: 245 total,   1 running, 244 sleeping,   0 stopped,   0 zombie
%Cpu(s): 12.5 us,  3.2 sy,  0.0 ni, 84.0 id,  0.0 wa,  0.0 hi,  0.3 si,  0.0 st
MiB Mem :  32768.0 total,   8456.2 free,  18234.5 used,   6077.3 buff/cache
MiB Swap:   8192.0 total,   8192.0 free,      0.0 used.  12834.3 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
12345 java      20   0 16.156g 4.235g  123456 S  45.2  13.3   1234:56 java
23456 redis     20   0   1234m  456.7m   45.2m S  12.3   1.4   456:78 redis-server
```

### top进阶用法

```bash
# 只看某个用户的进程
top -u www-data

# 只看某个进程（及其线程）
top -p 12345
top -Hp 12345   # 显示线程

# 高亮变化列
top
# 按x：高亮排序列
# 按b：高亮运行中的进程

# 批量模式（用于脚本）
top -b -n 5 -d 1 > top_output.txt

# 实时高亮
watch -n 1 'top -b -n 1 | head -20'
```


## vmstat：虚拟内存统计

### 基础用法

```bash
vmstat 1 5   # 每秒一次，共5次
vmstat 2     # 每2秒一次（无限）
```

### 输出解读

```
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs  us  sy  id  wa  st
 2  0      0 8456123    123 4567890    0    0     0     0   123  456   5   2  93   0   0
```

| 列 | 含义 |
|---|-----|
| r | 运行队列中的进程数（等待CPU的进程） |
| b | 阻塞的进程数 |
| swpd | 使用的虚拟内存（swap） |
| free | 空闲内存 |
| si/so | 每秒从swap读入/写入的内存（不为0说明内存不足） |
| bi/bo | 每秒块设备读取/写入的块数 |
| us/sy/id | CPU用户态/内核态/空闲时间百分比 |

### vmstat分析场景

```bash
# CPU瓶颈
vmstat 1
# 如果r列 > CPU核心数，说明CPU队列过长

# 内存瓶颈
vmstat 1
# 如果si/so列持续不为0，说明在用swap（内存不足）

# I/O瓶颈
vmstat 1
# 如果wa列持续很高，说明I/O是瓶颈
```


## iostat：磁盘I/O统计

### 基础用法

```bash
iostat -x 1 3   # 每秒一次，显示扩展统计
iostat -dxk 2   # 显示设备统计，KB为单位
```

### 输出解读

```
Linux 5.4.0 (hostname)     03/24/2026     _x86_64_        (8 CPU)

Device  r/s    w/s    rkB/s   wkB/s  rrqm/s  wrqm/s  %rrqm  wrqm %util
sda     12.34  45.67  123.45  678.90    1.23    4.56   9.12  8.92  45.00
```

| 列 | 含义 |
|---|-----|
| r/s, w/s | 每秒读写次数 |
| rkB/s, wkB/s | 每秒读写KB数 |
| %util | 设备利用率（接近100%说明饱和） |
| await | 平均I/O等待时间（毫秒） |
| avgqu-sz | 平均队列长度 |
| svctm | 平均服务时间（毫秒） |

### iostat分析场景

```bash
# 查看CPU和设备
iostat -c 1 3   # 只看CPU
iostat -d -k 2  # 只看设备，KB为单位

# 查看特定设备
iostat -p sda 1 3

# 分析
iostat -x 1
# 如果%util接近100%且await很高 → I/O饱和
# 如果avgqu-sz很高 → 请求队列过长
```


## netstat/ss：网络统计

### netstat基础用法

```bash
# 查看所有连接
netstat -anp

# 查看监听端口
netstat -tulnp

# 查看TCP连接状态
netstat -tan | awk '{print $6}' | sort | uniq -c | sort -rn

# 查看网络统计
netstat -s
```

### ss：更现代的替代

```bash
# ss比netstat更快
ss -tan                     # TCP所有连接
ss -tulnp                   # 监听端口
ss -tan state established   # 已建立连接

# 连接统计
ss -s                      # 摘要统计

# 连接详细信息
ss -ti dst 192.168.1.100   # 到指定IP的连接详情
ss -tp                     # 显示进程信息
```

### 网络分析场景

```bash
# 大量TIME_WAIT
ss -tan state time-wait | wc -l
# 原因：短连接、没开启tcp_tw_reuse
# 解决：tcp_tw_reuse、连接池、长连接

# 大量连接等待
ss -tan | grep ESTAB | wc -l
# 原因：高并发、服务器处理不过来
# 解决：扩容、优化代码、增加连接池

# 端口被占用
ss -tulnp | grep :80
# 查看哪个进程占用了端口
```


## 综合性能分析

### 快速定位问题

```bash
# 1. 先看整体负载
uptime
# load average: 0.58, 0.42, 0.38
# 如果1分钟负载 > CPU核心数 → 有瓶颈

# 2. CPU使用
vmstat 1
# 看us/sy/id比例

# 3. 内存使用
free -h
# 看available vs total

# 4. I/O使用
iostat -x 1
# 看%util

# 5. 网络
ss -s
# 看连接数和状态分布
```

### 常见性能问题模式

```
┌─────────────────────────────────────────────────────────────┐
│                    问题模式识别                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CPU瓶颈：                                                  │
│  - load > CPU核心数                                         │
│  - us%很高                                                  │
│  → top找到高CPU进程，jstack分析                             │
│                                                             │
│  内存瓶颈：                                                  │
│  - si/so不为0                                              │
│  - available < used                                       │
│  → 减少内存使用、增加内存、优化GC                            │
│                                                             │
│  I/O瓶颈：                                                  │
│  - iostat %util接近100%                                    │
│  - wa%很高                                                  │
│  → 优化I/O模式、增加缓存、使用SSD                           │
│                                                             │
│  网络瓶颈：                                                  │
│  - 连接数爆炸                                               │
│  - 大量TIME_WAIT                                            │
│  → 优化连接、tcp_tw_reuse                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


## 实战：Java应用性能分析

```bash
# 1. 找到Java进程
jps -mlv
# 或
ps aux | grep java

# 2. 查看线程CPU使用
top -Hp <pid>
# 找到高CPU的线程，记录PID（16进制）

# 3. 查看Java线程堆栈
jstack <pid> > thread_dump.txt
# 将线程PID转为16进制，找到对应的nid

# 4. 查看GC情况
jstat -gc <pid> 1000
# 或
jstat -gcutil <pid> 1000

# 5. 查看堆内存使用
jmap -heap <pid>

# 6. 生成堆dump
jmap -dump:format=b,file=heap.hprof <pid>
# 用MAT分析
```


## 面试追问方向

- **load average很高但CPU idle也很高，说明什么？**
  提示：可能是I/O等待。
- **如何判断是CPU瓶颈还是I/O瓶颈？**
  提示：vmstat的r列、wa列。
- **ss和netstat的区别是什么？**
  提示：ss直接从内核获取，netstat解析/proc。
- **如何分析Java应用的CPU占用高的问题？**
  提示：top → jstack → 分析线程堆栈。
