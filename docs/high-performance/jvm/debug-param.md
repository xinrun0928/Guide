# JVM 调试参数：-XX:+PrintGC、-XX:+PrintGCDetails、-XX:+PrintGCTimeStamps

你有没有遇到过这种情况：线上应用突然变慢了，你排查了半天不知道原因。

然后有人问你：「GC 日志开了吗？」

你说：「没有……」

那一刻，你深刻体会到：**GC 日志是 JVM 调优的「黑匣子」**，没有它，你就是在盲人摸象。

今天，我们就来彻底搞清楚 JVM 调试参数的配置方法。

---

## 一、为什么 GC 日志如此重要？

GC 日志记录了 JVM 内存管理的每一个细节：

1. **GC 原因分析**：什么触发了 GC？
2. **GC 频率分析**：GC 是否太频繁？
3. **GC 时长分析**：GC 停顿时长是否可接受？
4. **内存分布分析**：各代空间使用情况
5. **OOM 预警**：提前发现内存问题

> 生产环境**必须开启 GC 日志**，这是最基本的运维要求。

---

## 二、旧版 GC 日志参数（JDK 8 及之前）

### 2.1 基础参数

```bash
# 开启基本 GC 日志（JDK 9 前）
-verbose:gc

# 等效于
-XX:+PrintGC
```

### 2.2 详细参数

```bash
# 开启详细 GC 日志
-verbose:gc -XX:+PrintGCDetails

# 打印 GC 发生的时间戳（相对于 JVM 启动时间）
-XX:+PrintGCTimeStamps

# 打印 GC 发生时的日期时间
-XX:+PrintGCDateStamps
```

### 2.3 日志输出

```bash
# 输出到文件
-Xloggc:/var/log/myapp-gc.log

# 日志文件滚动
-XX:+UseGCLogFileRotation \
-XX:NumberOfGCLogFiles=10 \
-XX:GCLogFileSize=10M
```

### 2.4 典型旧版配置

```bash
-Xms4g -Xmx4g -Xmn2g \
-verbose:gc -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -XX:+PrintGCDateStamps \
-Xloggc:/var/log/myapp-gc.log \
-XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles=5 -XX:GCLogFileSize=10M
```

---

## 三、新版 GC 日志参数（JDK 9+）

JDK 9 统一了 GC 日志系统，引入了新的配置方式。

### 3.1 新的日志语法

```bash
# JDK 9+ 统一日志格式
-Xlog:[selector]=[level],[output],[tags],[options]
```

- **selector**：选择要记录的日志类型
- **level**：日志级别（error/warning/info/debug/trace）
- **output**：输出目标（stdout/file:filename）
- **tags**：标签过滤
- **options**：额外选项（time、uptime 等）

### 3.2 常用配置

```bash
# 记录所有 GC 日志（等价于旧版的 -verbose:gc）
-Xlog:gc*=info

# 记录所有 GC 日志，带时间戳
-Xlog:gc*=info:file=gc.log:time,uptime,level,tags

# 记录详细 GC 日志
-Xlog:gc*=debug:file=gc-debug.log

# 记录 GC 停顿时间
-Xlog: safepoint,gc*=info

# 分类记录
-Xlog:gc=info:file=gc.log
-Xlog:class+load=trace:file=class.log
-Xlog:exceptions=warning:file=exceptions.log
```

### 3.3 标签详解

| 标签 | 含义 |
|-----|------|
| `gc` | 通用 GC 事件 |
| `gc/start`、`gc/end` | GC 开始/结束 |
| `gc/heap` | 堆相关信息 |
| `gc/metaspace` | 元空间信息 |
| `gc/ref` | 引用处理 |
| `gc/task` | GC 任务线程 |
| `gc/coops` | 类指针压缩 |
| `gc/ergo` | GC 决策信息 |

### 3.4 典型新版配置

```bash
# 标准生产配置
-Xms8g -Xmx8g \
-Xlog:gc*=info:file=/var/log/myapp-gc.log:time,uptime,level,tags:filecount=10,filesize=10M

# 调试配置
-Xlog:gc*=debug:file=/var/log/myapp-gc-debug.log:time,uptime,level,tags:filecount=10,filesize=10M

# 精简配置（仅记录关键信息）
-Xlog:gc=info:file=/var/log/myapp-gc.log:filecount=5,filesize=10M
```

### 3.5 `-Xlog` 参数速查

```bash
# 常用组合速查

# 等价于旧版 -verbose:gc
-Xlog:gc

# 等价于旧版 -verbose:gc -XX:+PrintGCDetails
-Xlog:gc*

# 等价于旧版 -XX:+PrintGCTimeStamps
-Xlog:gc*:time

# 等价于旧版 -XX:+PrintGCDateStamps
-Xlog:gc*:time,uptime

# 日志文件滚动
-Xlog:gc*:file=gc.log:filecount=10,filesize=10M
```

---

## 四、GC 日志实战解读

### 4.1 触发 Minor GC

```java
public class GCLogDemo {
    public static void main(String[] args) throws InterruptedException {
        // 模拟大量对象分配
        List&lt;byte[]&gt; list = new ArrayList&lt;&gt;();
        for (int i = 0; i < 100; i++) {
            // 每次分配 1MB
            list.add(new byte[1024 * 1024]);
            Thread.sleep(100);
        }
        
        // 模拟长期存活对象
        Map&lt;String, Object&gt; cache = new HashMap&lt;&gt;();
        for (int i = 0; i < 1000; i++) {
            cache.put("key" + i, new byte[1024]);
        }
        
        Thread.sleep(1000);
    }
}
```

运行命令：

```bash
java -Xms100m -Xmx100m -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -Xloggc:gc.log GCLogDemo
```

### 4.2 日志解读

**Minor GC 日志**：

```
0.185: [GC (Allocation Failure) 
  Desired survivor size 5242880 bytes, new threshold 1 (max 15)
  - age   1:   8234560 bytes,   8234560 total
  : 61166K->36166K(92160K), 0.0234567 secs] 2024-01-15T10:30:45.123+0800
```

关键信息解读：

| 字段 | 含义 |
|-----|------|
| `0.185` | JVM 启动后的相对时间（秒） |
| `Allocation Failure` | GC 触发原因（Eden 区满） |
| `61166K->36166K` | GC 前内存 -> GC 后内存 |
| `(92160K)` | 年轻代总大小 |
| `0.0234567 secs` | GC 停顿时间 |

**Full GC 日志**：

```
1.234: [Full GC (Ergonomics) 
  [CMS: 81920K->81920K(92160K), 4.567 secs]
  92160K->81920K(102400K), 4.567 secs]
```

关键信息解读：

| 字段 | 含义 |
|-----|------|
| `Full GC` | 完整垃圾回收 |
| `Ergonomics` | JVM 自适应调节触发 |
| `CMS: 81920K->81920K` | CMS 老年代的内存变化 |

### 4.3 日志分析工具

| 工具 | 特点 | 获取方式 |
|-----|-----|---------|
| **GCViewer** | 开源可视化工具，图形化展示 GC 指标 | GitHub / SourceForge |
| **gceasy.io** | 在线分析，无需安装 | https://gceasy.io |
| **IBM PMAT** | IBM 官方工具 | IBM Support |
| **GCPlot** | 在线可视化 | https://gcplot.com |

---

## 五、配置的最佳实践

### 5.1 开发环境

```bash
# 简洁输出到控制台
-Xlog:gc=info:stdout
```

### 5.2 生产环境

```bash
# 完整配置
-Xms8g -Xmx8g \
-Xlog:gc*=info:file=/var/log/myapp-gc.log:time,uptime,level,tags:filecount=10,filesize=10M
```

### 5.3 问题排查

```bash
# 详细调试
-Xlog:gc*=debug:file=/var/log/myapp-gc-debug.log
```

### 5.4 常见问题诊断

通过 GC 日志可以诊断以下问题：

| 症状 | 可能原因 | 排查方向 |
|-----|---------|---------|
| Minor GC 频繁 | 年轻代太小、Eden/Survivor 比例不当 | 增大年轻代或调整 SurvivorRatio |
| Full GC 频繁 | 老年代空间不足、Metaspace 溢出 | 分析对象晋升情况 |
| GC 时间过长 | 堆太大、收集器不适合 | 考虑更换收集器 |
| 元空间持续增长 | 类加载器泄漏 | 检查类加载器是否正确释放 |

---

## 六、日志管理建议

1. **日志轮转**：必须开启，防止单文件过大
2. **磁盘监控**：定期检查 GC 日志所在磁盘的使用情况
3. **保留周期**：建议保留最近 7 天的日志便于回溯
4. **日志压缩**：历史日志可以考虑 gzip 压缩节省空间

---

## 总结

GC 日志配置的核心要点：

1. **JDK 8 使用旧参数**：`PrintGCDetails`、`PrintGCTimeStamps`、`Xloggc`
2. **JDK 9+ 使用新参数**：统一的 `-Xlog` 配置
3. **生产环境必须开启**：日志轮转 + 文件输出
4. **持续监控**：定期分析 GC 日志，提前发现问题

下一节，我们来深入了解 G1 GC 的详细参数配置。

---

## 思考题

GC 日志中显示 Minor GC 很频繁（每分钟几十次），但 Full GC 很少。这种情况下，你会如何分析问题并调整参数？

提示：考虑年轻代大小、Eden 与 Survivor 的比例、以及对象的晋升情况。
