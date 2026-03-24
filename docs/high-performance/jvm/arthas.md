# Arthas 实战：dashboard、heapdump、ognl

Arthas（阿尔萨斯）是阿里巴巴开源的 JVM 诊断工具，被广泛应用于生产环境的问题排查。

相比 jmap、jstack 等传统工具，Arthas 最大的优势是**可以在线诊断**，不需要停止应用。

今天，我们来详细讲解 Arthas 的使用方法。

---

## 一、Arthas 概述

### 1.1 Arthas 是什么？

Arthas 是一款线上监控诊断产品，通过全局视角实时查看应用 load、内存、gc、线程的状态信息，无需运维人员敲命令，降低在线排查问题的门槛。

### 1.2 核心功能

| 功能 | 说明 |
|-----|------|
| **dashboard** | 实时查看系统运行状态 |
| **thread** | 查看线程状态 |
| **jvm** | 查看 JVM 信息 |
| **trace** | 方法内部调用路径和耗时 |
| **stack** | 输出方法调用路径 |
| **watch** | 观察方法执行的入参和返回值 |
| **tt** | 记录方法执行的每次调用 |
| **heapdump** | 生成堆转储文件 |
| **ognl** | 执行ognl表达式 |
| **sc** | 查看已加载的类信息 |
| **sm** | 查看已加载的方法信息 |
| **jad** | 反编译已加载的类 |
| **mc** | 内存编译器 |
| **classloader** | 查看类加载器信息 |

### 1.3 安装与启动

```bash
# 下载 arthas-boot.jar
curl -O https://arthas.aliyun.com/arthas-boot.jar

# 启动 arthas
java -jar arthas-boot.jar

# 选择要诊断的 Java 进程

# 如果已知道 PID
java -jar arthas-boot.jar <pid>
```

---

## 二、核心命令详解

### 2.1 dashboard：系统运行状态

```bash
# 进入 arthas 后，执行
dashboard
```

**输出内容**：

```
Dashboard 实时数据面板

┌─────────────────────────────┐
│        System Info          │
├─────────────────────────────┤
│ OS: Linux 4.19              │
│ CPUs: 8                      │
│ Threads: 45                  │
│ Heap: 2048M / 4096M          │
│ Non-Heap: 256M / 512M        │
│ Uptime: 3d 5h 12m            │
└─────────────────────────────┘

┌─────────────┬──────────┬───────┬───────┬──────────┬──────────┬───────────┐
│ ID         │ NAME     │ STATE │ %CPU  │ DELTA_T  │ TIME     │ INTERRUPT │
├─────────────┼──────────┼───────┼───────┼──────────┼──────────┼───────────┤
│ 1          │ main     │ TIMED │ 0.0   │ 0.000    │ 0:0      │ false     │
│ 33         │ pool-1-1 │ WAIT  │ 2.1   │ 0.015    │ 0:10     │ false     │
│ 68         │ Timer    │ TIMED │ 0.0   │ 0.000    │ 0:0      │ false     │
└─────────────┴──────────┴───────┴───────┴──────────┴──────────┴───────────┘

┌─────────────┬──────────┬───────────┬──────────┬──────────┬──────────┐
│ HEAP        │ eden     │ survivor0 │ survivor1│ old      │ metaspace│
│ capacity    │ 512M     │ 64M      │ 64M     │ 1408M    │ 256M     │
│ used        │ 400M     │ 30M      │ 45M     │ 800M     │ 150M     │
│ free        │ 112M     │ 34M      │ 19M     │ 608M     │ 106M     │
└─────────────┴──────────┴───────────┴──────────┴──────────┴──────────┘
```

**解读**：
- **Threads**：线程状态概览
- **Memory**：堆内存各区域使用情况
- **GC**：GC 统计信息

### 2.2 thread：线程分析

```bash
# 查看所有线程
thread

# 查看最忙的前 5 个线程
thread -n 5

# 查看指定线程
thread <thread_id>

# 查看阻塞的线程
thread -b

# 查看死锁
thread
```

### 2.3 jvm：JVM 信息

```bash
# 查看 JVM 信息
jvm
```

**输出内容**：

```
VM information:
Java HotSpot(TM) 64-Bit Server VM
  version: 11.0.15+10-LTS-186
  mode: server
  runtime: OpenJDK Runtime Environment
  ...

Runtime information:
 _pid: 12345
 _main class: com.example.Application
 _class path: ...
  ...
```

### 2.4 heapdump：堆转储

```bash
# 生成完整堆转储
heapdump /tmp/heap.hprof

# 只生成活跃对象的堆转储（推荐）
heapdump --live /tmp/heap.hprof

# 生成后下载到本地分析
# 在 Arthas 中无法直接分析，需要下载后用 MAT 分析
```

### 2.5 ognl：执行 OGNL 表达式

ognl 是 Apache Commons OGNL 项目，可以用来动态执行表达式、修改对象属性等。

```bash
# 查看静态属性
ognl '@com.example.Config@value'

# 查看系统属性
ognl '@java.lang.System@getProperty("java.version")'

# 调用静态方法
ognl '@com.example.MathUtils@sum(1, 2)'

# 查看对象的属性
ognl #object.getName()

# 修改对象的属性（危险，生产环境慎用）
ognl #object.setName('newName')
```

### 2.6 trace：方法调用追踪

```bash
# 追踪方法调用
trace com.example.Service process

# 追踪并过滤耗时大于 100ms 的调用
trace com.example.Service process '#cost > 100'

# 追踪方法内部的多个调用
trace com.example.Service *
```

### 2.7 watch：观察方法执行

```bash
# 观察方法入参和返回值
watch com.example.Service process '{params, returnObj}'

# 只观察入参
watch com.example.Service process '{params}'

# 只观察返回值
watch com.example.Service process '{returnObj}'

# 观察方法执行前
watch com.example.Service process '{params}' -x 2
```

### 2.8 tt：方法执行记录

tt（Time Tunnel）记录方法每次调用的详细信息，可以回放任意一次调用。

```bash
# 记录所有调用
tt -t com.example.Service process

# 查看调用记录
tt -l

# 回放指定调用
tt -i <index>

# 删除记录
tt --delete-all
```

### 2.9 sc/sm：类和方法信息

```bash
# 查看已加载的类
sc com.example.*

# 查看类的详细信息
sc -d com.example.Service

# 查看类的方法
sm com.example.Service

# 查看方法的详细信息
sm -d com.example.Service process
```

### 2.10 jad：反编译

```bash
# 反编译指定类
jad com.example.Service

# 只反编译指定方法
jad com.example.Service process
```

---

## 三、实战案例

### 3.1 案例一：CPU 高占用排查

```bash
# 1. 使用 dashboard 查看整体情况
dashboard

# 2. 查看最忙的线程
thread -n 5

# 3. 查看线程堆栈
thread <thread_id>

# 4. 使用 trace 追踪耗时方法
trace com.example.Service *
```

### 3.2 案例二：内存泄漏排查

```bash
# 1. 查看内存使用
dashboard

# 2. 查看对象数量
# 使用 sc 查找可疑的集合类
sc -d com.example.Cache

# 3. 生成堆转储
heapdump --live /tmp/heap.hprof

# 4. 下载到本地用 MAT 分析
```

### 3.3 案例三：方法响应慢排查

```bash
# 1. 使用 trace 追踪方法
trace com.example.Service process '#cost > 50'

# 2. 使用 watch 查看入参
watch com.example.Service process '{params}' -x 2

# 3. 使用 tt 记录完整调用
tt -t com.example.Service process
```

---

## 四、Arthas 与其他工具对比

| 工具 | Arthas | jmap | jstack | MAT |
|-----|--------|------|--------|-----|
| 实时诊断 | ✅ | ❌ | ❌ | ❌ |
| 无侵入 | ✅ | ❌ | ❌ | ❌ |
| 堆转储 | ✅ | ✅ | ❌ | ❌ |
| 线程分析 | ✅ | ❌ | ✅ | ❌ |
| 方法追踪 | ✅ | ❌ | ❌ | ❌ |
| 堆分析 | ❌ | ❌ | ❌ | ✅ |

### 4.1 最佳使用场景

- **Arthas**：在线诊断、实时分析
- **jmap**：生成堆转储
- **MAT**：深度堆分析
- **jstack**：快速线程 dump

---

## 五、生产环境使用建议

### 5.1 安全建议

1. **不要在生产环境使用 ognl 修改数据**
2. **heapdump 可能导致应用卡顿**，建议使用 --live 参数
3. **trace 可能产生大量日志**，设置条件过滤

### 5.2 性能影响

- **dashboard**：轻微
- **trace**：轻微到中等（取决于调用频率）
- **heapdump**：中等（类似 Full GC）
- **tt**：中等（记录每次调用）

### 5.3 使用规范

```bash
# 生产环境使用建议

# 1. 先用 dashboard 查看整体
# 2. 使用 thread -n 5 定位问题线程
# 3. 使用 trace 追踪方法，设置耗时过滤
# 4. 使用 heapdump 生成堆转储后下载分析
```

---

## 总结

Arthas 是 JVM 诊断利器：

1. **dashboard**：实时查看系统状态
2. **thread**：线程分析
3. **trace/watch/tt**：方法追踪
4. **heapdump**：生成堆转储
5. **ognl**：动态表达式执行

---

## 思考题

在生产环境中使用 Arthas 时，heapdump 命令和 jmap -dump 有什么区别？各自有什么优缺点？
