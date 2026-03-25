# JVM 参数配置与调优经验

JVM 调优是 Java 开发者的必备技能。

但调优不是玄学，是有章可循的。

---

## JVM 参数分类

```
┌─────────────────────────────────────────────────────────────┐
│                    JVM 参数分类                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  标准参数（- 开头）                                          │
│  -version -server -client -help                            │
│  例：java -server -Xmx512m App                              │
│                                                              │
│  非标准参数（-X 开头）                                       │
│  -Xms -Xmx -Xss -Xmn                                       │
│  例：java -Xms256m -Xmx512m -Xss256k App                    │
│                                                              │
│  不稳定参数（-XX 开头）                                      │
│  -XX:+UseG1GC -XX:MetaspaceSize=128m                       │
│  例：java -XX:+UseG1GC -XX:MaxGCPauseMillis=200 App         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 内存参数

### 堆内存配置

```bash
# 基本配置
-Xms256m           # 初始堆大小
-Xmx512m           # 最大堆大小
-Xms512m -Xmx512m  # 建议设置为相同，避免动态扩展

# 年轻代配置
-Xmn128m           # 年轻代大小
-XX:NewSize=128m  # 年轻代初始大小
-XX:MaxNewSize=128m # 年轻代最大大小

# 老年代配置（使用 NewRatio）
-XX:NewRatio=2    # 年轻代 : 老年代 = 1 : 2（默认）

# Survivor 区配置
-XX:SurvivorRatio=8  # Eden : Survivor = 8 : 1（默认）
```

### 元空间配置

```bash
# JDK 8
-XX:MetaspaceSize=128m    # 初始元空间大小
-XX:MaxMetaspaceSize=512m # 最大元空间大小

# JDK 11+
-XX:MetaspaceSize=256m
-XX:MaxMetaspaceSize=1g
```

### 直接内存配置

```bash
-XX:MaxDirectMemorySize=512m
# 默认：等于 -Xmx（Java 10+）
# 默认：64MB（Java 10 之前）
```

---

## GC 参数

### 收集器选择

```bash
# Serial（客户端/小型应用）
-XX:+UseSerialGC

# Parallel / Parallel Old（吞吐量优先）
-XX:+UseParallelGC
-XX:+UseParallelOldGC

# CMS（低延迟，JDK 8 及之前）
-XX:+UseConcMarkSweepGC

# G1（可预测停顿，JDK 9+ 默认）
-XX:+UseG1GC

# ZGC（JDK 11+，亚毫秒停顿）
-XX:+UseZGC
-XX:+ZGenerational  # JDK 15+ 分代 ZGC
```

### G1 专用参数

```bash
-XX:MaxGCPauseMillis=200      # 停顿时间目标
-XX:G1HeapRegionSize=4m        # Region 大小
-XX:InitiatingHeapOccupancyPercent=45  # 触发 Mixed GC 阈值
-XX:G1HeapWastePercent=5       # 允许的垃圾比例
```

### GC 日志配置

```bash
# JDK 8
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/path/to/gc.log

# JDK 9+（推荐）
-Xlog:gc*:file=/path/to/gc.log:time,level,tags

# 详细配置
-Xlog:gc*=debug,file=gc.log:time,level,tags:filecount=5,filesize=10M
```

### OOM 处理

```bash
-XX:+HeapDumpOnOutOfMemoryError      # OOM 时生成堆转储
-XX:HeapDumpPath=/path/to/dump       # 堆转储路径
-XX:+HeapDumpBeforeFullGC            # Full GC 前生成
-XX:+HeapDumpAfterFullGC             # Full GC 后生成
```

---

## 线程参数

### 栈大小

```bash
-Xss256k    # 栈大小（默认 1MB）
-Xss512k
-Xss1m
```

### 线程池配置（Tomcat 为例）

```bash
# Tomcat
-Djava.util.concurrent.ThreadPoolExecutor.corePoolSize=200
-Djava.util.concurrent.ThreadPoolExecutor.maxPoolSize=400

# HikariCP
-Dspring.datasource.hikari.maximumPoolSize=20
-Dspring.datasource.hikari.minimumIdle=5
```

---

## 调试参数

```bash
# 显示最终-XX 参数
-XX:+PrintCommandLineFlags

# 显示 GC 总结
-XX:+PrintGC

# 显示所有系统参数
-XX:+PrintSystemProperties

# 遇到错误时弹出对话框
-XX:+ShowMessageBoxOnError
```

---

## 调优原则

### 原则 1：先诊断后调优

```
┌─────────────────────────────────────────────────────────────┐
│  调优步骤                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 监控基准                                                │
│     - GC 日志                                               │
│     - jstat 监控                                           │
│     - Arthas profiler                                       │
│                                                              │
│  2. 识别问题                                                │
│     - GC 停顿时间过长？                                     │
│     - 内存占用过高？                                        │
│     - Full GC 频繁？                                        │
│                                                              │
│  3. 分析根因                                                │
│     - 对象分配过快？                                        │
│     - 内存泄漏？                                            │
│     - GC 参数不当？                                         │
│                                                              │
│  4. 针对性调优                                              │
│     - 调整参数                                             │
│     - 或修复代码                                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 原则 2：吞吐量优先 vs 延迟优先

```
┌─────────────────────────────────────────────────────────────┐
│  选择策略                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  吞吐量优先（后台批处理）                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 目标：最大化单位时间内的处理量                        │   │
│  │ 参数：                                              │   │
│  │ -XX:+UseParallelGC                                 │   │
│  │ -XX:+UseParallelOldGC                              │   │
│  │ -XX:GCTimeRatio=19  # 吞吐量 95%                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  延迟优先（在线服务）                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 目标：减少 GC 停顿时间                               │   │
│  │ 参数：                                              │   │
│  │ -XX:+UseG1GC                                       │   │
│  │ -XX:MaxGCPauseMillis=200                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  超低延迟（金融交易、游戏）                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 目标：停顿时间 < 1ms                                │   │
│  │ 参数：                                              │   │
│  │ -XX:+UseZGC                                        │   │
│  │ -XX:+ZGenerational                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 场景化配置

### 场景 1：高并发 API 服务

```bash
# 目标：低延迟，高响应
java -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:+UseStringDeduplication \
     -Xmx4g -Xms4g -Xmn2g \
     -XX:SurvivorRatio=8 \
     -XX:MetaspaceSize=256m \
     -XX:MaxMetaspaceSize=512m \
     -Xlog:gc*:file=gc.log:time,level,tags \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/tmp/dump \
     your.Application
```

### 场景 2：后台批处理

```bash
# 目标：高吞吐量
java -XX:+UseParallelGC \
     -XX:+UseParallelOldGC \
     -XX:GCTimeRatio=19 \
     -XX:MaxGCPauseMillis=500 \
     -XX:+UseAdaptiveSizePolicy \
     -Xmx8g -Xms8g -Xmn4g \
     -XX:SurvivorRatio=4 \
     -Xlog:gc*:file=gc.log:time,level,tags \
     your.Application
```

### 场景 3：大内存服务（JDK 11+）

```bash
# 目标：16GB+ 大堆，低延迟
java -XX:+UseZGC \
     -XX:+ZGenerational \
     -XX:MaxGCPauseMillis=1 \
     -Xmx32g -Xms32g \
     -XX:MetaspaceSize=512m \
     -XX:MaxMetaspaceSize=1g \
     -Xlog:gc*:file=gc.log:time,level,tags \
     -XX:+HeapDumpOnOutOfMemoryError \
     your.Application
```

### 场景 4：容器环境

```bash
# 目标：适配容器资源限制
java -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=200 \
     -XX:+UseContainerSupport \
     -XX:MaxRAMPercentage=75 \
     -XX:InitialRAMPercentage=50 \
     -Xlog:gc*:file=gc.log \
     your.Application

# 注意：JDK 10+ 支持容器感知
# -XX:+UseContainerSupport 自动启用
```

---

## 常见问题与解决方案

| 问题 | 原因 | 解决方案 |
|-----|------|---------|
| Young GC 频繁 | Eden 区太小 | 增大年轻代 `-Xmn` |
| Full GC 频繁 | 老年代不足或内存泄漏 | 增大堆或排查泄漏 |
| GC 停顿过长 | 堆太大或收集器不当 | 换用 G1/ZGC |
| Metaspace OOM | 类加载过多 | 增大 Metaspace 或修复代码 |

---

## 面试追问方向

- `-Xms` 和 `-Xmx` 设置为相同的值有什么好处？
- G1 的 `MaxGCPauseMillis` 是硬性保证吗？它是如何工作的？
- 吞吐量和延迟是矛盾的吗？如何权衡？
- 为什么 `-XX:NewRatio` 和 `-Xmn` 不能同时使用？
- 容器环境下如何配置 JVM 参数？
- 如何验证 JVM 参数是否生效？
