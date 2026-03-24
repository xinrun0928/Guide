# GC 日志分析：GCViewer、gceasy.io 在线分析

你有没有这种经历：GC 日志打开一看，满屏的数字和术语，完全不知道该看什么。

或者用 Excel 硬扛了半天，还是分析不出个所以然。

今天介绍两个 GC 日志分析的利器，让你从「看天书」变成「看报告」。

---

## 一、GC 日志分析工具概览

### 1.1 为什么需要专用工具？

手动分析 GC 日志的痛点：

1. **数据量巨大**：生产环境 GC 日志动不动几十 MB
2. **格式复杂**：各种 GC 类型、时间戳、内存变化混在一起
3. **计算困难**：吞吐率、停顿时间、GC 频率需要大量计算
4. **对比困难**：调整参数前后效果对比没有量化指标

### 1.2 主流工具对比

| 工具 | 类型 | 特点 | 适用场景 |
|-----|-----|-----|---------|
| **GCViewer** | 桌面工具 | 开源免费、功能全面 | 本地分析、离线场景 |
| **gceasy.io** | 在线工具 | 无需安装、智能分析 | 快速定位、团队共享 |
| **GCPlot** | 在线工具 | 可视化强 | 持续监控趋势 |
| **IBM PMAT** | 桌面工具 | 专注 IBM JVM | 特殊场景 |

---

## 二、GCViewer：本地分析利器

### 2.1 安装与运行

GCViewer 是一个开源的 Java 桌面应用，支持 JDK 8 及之前的旧版 GC 日志格式。

**下载地址**：

```bash
# GitHub releases
https://github.com/chewiebug/GCViewer/releases

# 下载最新的 gcviewer-1.XX.jar
```

**运行方式**：

```bash
# 直接运行（需要 JRE）
java -jar gcviewer-1.34.jar

# 或者双击 jar 文件
```

### 2.2 核心界面解读

GCViewer 的主界面包含以下区域：

```
┌─────────────────────────────────────────────────────────────┐
│  File  View  Data  Help                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Memory Usage Chart                      │    │
│  │   堆内存使用曲线图                                    │    │
│  │   - 红色：老年代使用                                  │    │
│  │   - 蓝色：年轻代使用                                  │    │
│  │   - 绿色：永久代/元空间                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────┐  ┌────────────────────────────┐  │
│  │     Summary           │  │     Chart Configuration     │  │
│  │  ┌────────────────┐  │  │  □ Show Heap               │  │
│  │  │ Summary Data    │  │  │  □ Show Young Gen          │  │
│  │  │                 │  │  │  □ Show Tenured Gen        │  │
│  │  └────────────────┘  │  │  □ Show Permanent Gen      │  │
│  └──────────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 关键指标解读

GCViewer 提供的核心指标：

| 指标 | 含义 | 健康范围 |
|-----|-----|---------|
| **Throughput** | 应用运行时间占比（不含 GC 时间）| > 95% |
| **GC Time** | 总 GC 耗时 | 越低越好 |
| **Pauses** | 总停顿时间 | 越低越好 |
| **Longest Pause** | 最长单次停顿 | < 200ms（G1）|
| **Full GC** | Full GC 次数和耗时 | 越少越好 |
| **Minor GC** | Minor GC 次数和耗时 | 次数适中 |
| **Memory max** | 堆内存最大值 | 接近 -Xmx |

### 2.4 典型问题诊断

通过 GCViewer 的图表，可以快速定位问题：

**问题 1：锯齿状内存曲线**

```
症状：堆内存反复升降，像锯齿一样
原因：频繁 Minor GC，对象晋升速度太快
建议：增大年轻代或 Survivor 区
```

**问题 2：堆内存持续上升**

```
症状：内存曲线只升不降
原因：内存泄漏或类加载器泄漏
建议：使用 MAT 分析堆转储
```

**问题 3：Flat GC 后的尖峰**

```
症状：周期性出现内存尖峰后立即 GC
原因：TLAB 分配失败或大对象分配
建议：调整 TLAB 大小或 PretenureSizeThreshold
```

### 2.5 生成报告

GCViewer 支持导出分析报告：

```bash
# 导出为 CSV
Data → Export to CSV

# 导出为 Summary
Data → Show Summary
```

导出的 CSV 可以进一步用 Excel 或 Python 分析。

---

## 三、gceasy.io：在线智能分析

### 3.1 使用方法

gceasy.io 是一个免费的在线 GC 日志分析工具，无需安装。

**访问地址**：

```
https://www.gceasy.io
```

**使用方法**：

1. 打开网站
2. 上传 GC 日志文件（或粘贴日志内容）
3. 自动生成分析报告
4. 可导出 PDF 或分享链接

### 3.2 报告结构解读

gceasy.io 的报告包含以下部分：

#### 3.2.1 关键指标概览

```
┌────────────────────────────────────────────────┐
│  Key Metrics                                   │
├────────────────────────────────────────────────┤
│  Throughput                      94.5%         │
│  GC Duration                     12.34 mins    │
│  Avg GC Pause                    45 ms         │
│  Max GC Pause                    234 ms        │
│  Total GC                        2,345         │
│    - Minor GC                    2,300         │
│    - Full GC                     45            │
└────────────────────────────────────────────────┘
```

#### 3.2.2 GC 原因分析

```
┌────────────────────────────────────────────────┐
│  GC Cause Statistics                           │
├────────────────────────────────────────────────┤
│  Allocation Failure          2,300    (97.9%)   │
│  Ergonomics                      30    (1.3%) │
│  Metaspace GC                    15    (0.6%) │
│  Allocation Failure (promotion)    0    (0.0%) │
└────────────────────────────────────────────────┘
```

#### 3.2.3 内存分布图

```
┌────────────────────────────────────────────────┐
│  Heap Memory Visualization                     │
├────────────────────────────────────────────────┤
│                                                 │
│  Young Gen:  ████████████░░░░░░  65% used     │
│  Old Gen:    ██████████░░░░░░░░░  55% used     │
│  Meta Space: ████████░░░░░░░░░░  45% used     │
│                                                 │
└────────────────────────────────────────────────┘
```

#### 3.2.4 对比图

gceasy.io 会生成时间线图表：

- **堆内存使用曲线**：显示各代内存使用情况
- **GC 停顿时间分布**：直方图显示停顿时间分布
- **GC 频率趋势**：折线图显示 GC 频率变化

### 3.3 问题检测与建议

gceasy.io 的核心价值是**自动检测问题并给出建议**：

```
┌─────────────────────────────────────────────────────────────┐
│  PROBLEMS DETECTED                                          │
├─────────────────────────────────────────────────────────────┤
│  ⚠️ High GC Frequency                                       │
│     Minor GC happens every 0.5 seconds                      │
│     → Recommendation: Increase Young Gen size              │
│                                                              │
│  ⚠️ Long Minor GC Pause                                      │
│     Average pause: 150ms                                    │
│     → Recommendation: Consider using G1 GC                 │
│                                                              │
│  ✓ No Full GC Issues                                       │
│     Full GC frequency is acceptable                        │
└─────────────────────────────────────────────────────────────┘
```

### 3.5 与 GCViewer 的对比

| 维度 | GCViewer | gceasy.io |
|-----|---------|-----------|
| 安装 | 需要下载 jar | 无需安装 |
| 隐私 | 本地处理 | 上传到云端 |
| 新日志格式 | 有限支持 | 全面支持（JDK 9+）|
| 报告分享 | 不支持 | 支持分享链接 |
| 持续监控 | 不支持 | 支持趋势分析 |
| 离线使用 | 支持 | 不支持 |

---

## 四、实战：分析一个 GC 日志案例

### 4.1 日志样本

假设有以下 GC 日志片段：

```
0.123: [GC [PSYoungGen: 65536K->8704K(76288K)] 131072K->131072K(262144K), 0.0456789 secs]
0.789: [Full GC [PSYoungGen: 8704K->0K(76288K)] [ParOldGen: 130048K->129536K(186368K)] 138752K->129536K(262144K), 0.1234567 secs]
1.234: [GC [PSYoungGen: 120K->120K(76288K)] 129656K->129656K(262144K), 0.0012345 secs]
```

### 4.2 上传分析

将上述日志保存为 `gc.log`，上传到 gceasy.io，得到的分析结果：

**问题诊断**：

```
1. Heap Occupancy After GC: Old Gen not freeing up memory
   - Old gen usage before GC: 130MB
   - Old gen usage after GC: 129MB
   - GC freed only 1MB in old gen
   
2. High Memory Allocation Rate
   - Allocation rate: 450 MB/sec
   - This is extremely high!
```

**建议**：

```
To improve this situation:
1. Consider increasing heap size
2. Review object allocation patterns
3. Check for potential memory leaks
```

---

## 五、日志格式适配

### 5.1 JDK 8 及之前（Parallel GC + PrintGCDetails）

```bash
-XX:+PrintGCDetails -XX:+PrintGCTimeStamps -XX:+PrintGCDateStamps -Xloggc:gc.log
```

GCViewer 和 gceasy.io 都能很好支持。

### 5.2 JDK 9+（统一日志格式）

```bash
-Xlog:gc*=info:file=/var/log/myapp-gc.log:time,uptime,level,tags:filecount=10,filesize=10M
```

gceasy.io 完全支持，GCViewer 支持有限。

### 5.3 日志格式转换

如果日志格式不兼容，可以使用工具转换：

```bash
# 使用 GCLogConverter
# https://github.com/crunchtechnologies/gclogconverter
java -jar gclogconverter.jar \
  --input gc.log \
  --output gc_converted.log \
  --type gcviz
```

---

## 六、分析的最佳实践

### 6.1 分析时机

1. **日常巡检**：每天分析一次 GC 日志趋势
2. **版本发布前**：确保 GC 指标正常
3. **性能问题排查**：结合 APM 和 GC 日志
4. **容量规划**：根据 GC 指标调整堆大小

### 6.2 分析频率

| 环境 | 频率 | 关注重点 |
|-----|-----|---------|
| 开发环境 | 按需 | 基本指标 |
| 测试环境 | 每次压测后 | 吞吐量和停顿时间 |
| 生产环境 | 每日巡检 | Full GC 频率、异常停顿 |

### 6.3 关键阈值建议

| 指标 | 告警阈值 | 严重阈值 |
|-----|---------|---------|
| 吞吐量 | < 95% | < 90% |
| Full GC 频率 | > 1次/小时 | > 1次/10分钟 |
| 最大停顿时间 | > 500ms | > 1000ms |
| 堆内存使用 | > 85% | > 95% |

---

## 总结

GC 日志分析工具的核心价值：

1. **GCViewer**：本地分析，功能全面，支持离线
2. **gceasy.io**：在线智能分析，自动发现问题和建议
3. **定期分析**：日常巡检的重要组成部分
4. **关注指标**：吞吐量、GC 频率、停顿时间

下一节，我们来学习 GC 日志可视化的更多方法。

---

## 思考题

如果你发现 GC 日志分析显示吞吐量只有 85%，但应用响应时间并没有明显变慢，可能是什么原因？

提示：考虑 GC 时间是否集中在低峰期，以及吞吐量和响应时间的关系。
