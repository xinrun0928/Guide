# Arthas 诊断工具：线上问题排查神器

Arthas 是阿里开源的 Java 诊断工具，可以在线上无需重启应用，直接排查问题。

---

## 安装与启动

### 快速安装

```bash
# 一键安装
curl -L https://arthas.aliyun.com/install.sh | sh

# 或下载 arthas-boot.jar
java -jar arthas-boot.jar
```

### 启动 Arthas

```bash
# 启动并连接 Java 进程
java -jar arthas-boot.jar

# 或直接 attach 到进程
java -jar arthas-boot.jar <pid>

# 指定进程
java -jar arthas-boot.jar 12345
```

### Web Console

```bash
# 启动后访问
# http://127.0.0.1:8563/

# 或在终端中使用
as.sh
```

---

## 核心命令

### dashboard：实时监控面板

```bash
# 查看系统整体情况
dashboard

# 输出
┌─────────────────────────────────────────────────────────────┐
│  Dashboard                                                    │
├─────────────────────────────────────────────────────────────┤
│  Name           PID     CPU%  Thread   GC    Duty          │
│  arthas-server  12345   0.5   5        0     0%           │
│  http-nio-8080  12346   2.3   50       0     0%           │
│  ....                                                          │
├─────────────────────────────────────────────────────────────┤
│  Memory           used    total    max    usage            │
│  heap            256MB    512MB    1024MB  25.00%          │
│  direct          32MB     -        -       -               │
│  metaspace       128MB   128MB    512MB   25.00%          │
├─────────────────────────────────────────────────────────────┤
│  GC                count    time                           │
│  YGC                 123    1.234s                         │
│  FGC                   0    0.000s                         │
└─────────────────────────────────────────────────────────────┘
```

### thread：线程分析

```bash
# 查看所有线程
thread

# 查看指定线程
thread <tid>

# 查看 CPU 占用最高的线程
thread -n 10

# 查看阻塞线程
thread -b

# 查找死锁
thread -d
```

### jad：反编译

```bash
# 反编译类
jad com.example.MyClass

# 反编译方法
jad com.example.MyClass main

# 反编译并保存
jad -o com.example.MyClass > MyClass.java
```

### watch：方法监控

```bash
# 监控方法入参和返回值
watch com.example.MyClass methodName "{params, returnObj}"

# 监控方法执行时间
watch com.example.MyClass methodName "{method, returnObj}" -x 3

# 监控异常
watch com.example.MyClass methodName "{params, throwExp}" -e

# 监控条件
watch com.example.MyClass methodName "{params, returnObj}" "params[0] > 100"
```

### trace：方法调用链路

```bash
# 追踪方法调用
trace com.example.MyClass methodName

# 追踪并显示调用深度
trace com.example.MyClass methodName -n 5

# 只显示超过指定时间的调用
trace com.example.MyClass methodName '#cost > 10'

# 追踪多个方法
trace com.example.MyClass *  -n 5
```

### stack：方法调用栈

```bash
# 查看方法调用栈
stack com.example.MyClass methodName

# 只显示前 5 次
stack com.example.MyClass methodName -n 5

# 按条件过滤
stack com.example.MyClass methodName 'params[0] == "test"'
```

### monitor：方法调用统计

```bash
# 统计方法调用
monitor -c 5 com.example.MyClass methodName

# 输出
 timestamp         class           method      total  success  fail  avg-rt(ms)  fail-rate
--------------------------------------------------------------------------------------------------
 2024-01-15 10:30  MyClass        methodName     100     99      1      12.34       1.00%
```

### profiler：性能分析

```bash
# 启动 profiler
profiler start

# 停止并生成火焰图
profiler stop --format html --file /tmp/arthas-output.svg

# 查看采样数据
profiler getSamples

# 指定采样时间
profiler start --duration 60
```

---

## 实战场景

### 场景 1：定位 CPU 占用高

```bash
# 1. 查看 CPU 占用最高的线程
thread -n 5

# 2. 追踪该线程的调用栈
thread <tid>

# 3. 使用 profiler 采样
profiler start --duration 30

# 4. 生成火焰图
profiler stop --format html --file /tmp/flame.html
```

### 场景 2：定位接口响应慢

```bash
# 1. 追踪接口方法
trace com.example.Controller methodName '#cost > 100'

# 2. 查看方法调用链路
trace com.example.Service methodName -n 10

# 3. 监控方法执行
monitor -c 10 com.example.Service methodName
```

### 场景 3：定位内存泄漏

```bash
# 1. 查看对象增长
heapdump

# 2. 监控对象创建
watch com.example.Cache put '{params, @java.lang.System@nanoTime()}' -x 2

# 3. 查看类加载
sc -d com.example.MyClass

# 4. 多次采样对比
memory | grep heap
```

### 场景 4：查看方法入参和返回值

```bash
# 监控方法调用
watch com.example.Service methodName '{params, returnObj}' -x 2

# 输出
ts=2024-01-15 10:30:00; [cost=1.234ms] params=[arg1, arg2] return=result
```

### 场景 5：动态修改日志级别

```bash
# 查看所有 logger
logger

# 修改日志级别
logger --name com.example --level debug

# 恢复
logger --name com.example --level info
```

---

## 高级用法

### 火焰图

```bash
# 使用 arthas 生成火焰图
profiler start --event cpu
profiler stop --format html --file /tmp/arthas-output.html

# 使用火焰图分析
# 打开 /tmp/arthas-output.html 查看
# 每个柱子代表一个调用栈
# 柱子越宽，该路径占用时间越多
```

### 多线程分析

```bash
# 查看线程状态
thread --state BLOCKED

# 查看死锁
thread -d

# 查看等待锁的线程
thread -b
```

### Arthas 脚本

```bash
# 使用 arthas-batch 文件批量执行
# my-commands.txt 内容：
# thread -n 3
# memory
# gc()

# 执行
as.sh < my-commands.txt
```

---

## 与其他工具对比

| 工具 | Arthas | jstack | jmap | MAT |
|-----|--------|--------|------|-----|
| 实时性 | 在线，无需重启 | 快照 | 快照 | 离线分析 |
| 火焰图 | 支持 | 不支持 | 不支持 | 需插件 |
| 方法追踪 | 支持 | 不支持 | 不支持 | 不支持 |
| 热修改 | 支持 | 不支持 | 不支持 | 不支持 |
| 堆分析 | 部分 | 不支持 | 支持 | 完整 |

---

## 面试追问方向

- Arthas 和 jstack/jmap 有什么区别？为什么需要 Arthas？
- Arthas 的 watch 和 trace 命令有什么区别？
- 如何用 Arthas 生成火焰图？火焰图怎么看？
- Arthas 如何定位内存泄漏？和 MAT 有什么区别？
- Arthas 可以热修改代码吗？原理是什么？
- Arthas 的 profiler 使用了什么技术来采样 CPU？
