# GC 日志可视化：GCViewer、GCeasy、SmartJDK

GC 日志分析不仅仅是看数字和表格，**可视化**能让你一眼看出问题所在。

今天我们介绍几个强大的可视化工具和方法。

---

## 一、可视化的价值

### 1.1 为什么需要可视化？

数字分析的局限：

1. **不直观**：一堆数字很难形成直观印象
2. **难对比**：调整前后效果对比不直观
3. **难发现趋势**：短期数据波动 vs 长期趋势难区分
4. **难沟通**：给领导汇报时，图表比表格更有说服力

### 1.2 可视化类型

| 类型 | 展示内容 | 适用场景 |
|-----|---------|---------|
| **内存曲线** | 各代内存使用随时间变化 | 发现内存泄漏、GC 效果 |
| **停顿时间柱状图** | 各次 GC 停顿时间分布 | 发现异常停顿 |
| **GC 频率折线图** | GC 频率随时间变化 | 发现周期性问题 |
| **对象年龄直方图** | 对象年龄分布 | 优化晋升年龄 |

---

## 二、GCViewer 可视化

### 2.1 内存使用曲线

GCViewer 最核心的功能是展示内存使用曲线：

```
时间轴 ──────────────────────────────────────────────────────────>
│
▲ Heap Used                                           
│    ╱╲      ╱╲      ╱╲      ╱╲      ╱╲                 
│   ╱  ╲    ╱  ╲    ╱  ╲    ╱  ╲    ╱  ╲                  
│  ╱    ╲  ╱    ╲  ╱    ╲  ╱    ╲  ╱    ╲                 
│ ╱      ╲╱      ╲╱      ╲╱      ╲╱      ╲                
│                                                     
│ Tenured Used                                         
│         ╱╲          ╱╲          ╱╲                   
│        ╱  ╲        ╱  ╲        ╱  ╲                   
│       ╱    ╲      ╱    ╲      ╱    ╲                  
│──────╱──────╲────╱──────╲────╱──────╲──────           
│                                                          
│ Young Used                                             
│  ││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││   
│  │││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││   
│  │││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││││   
└───────────────────────────────────────────────────────────
```

### 2.2 GC 停顿时间图

GCViewer 的停顿时间图帮助你发现异常停顿：

```
停顿时间 (ms)                                             
▲                                                          
│              █                                          
│         █   █   █                                        
│    █   █   █   █   █   █                                 
│    █   █   █   █   █   █   █                              
│    █   █   █   █   █   █   █   █                           
│    █   █   █   █   █   █   █   █   █                        
│────█───█───█───█───█───█───█───█───█───█───────────────────
│                                                          
│  ▲ 这里出现了异常停顿（可能是 Full GC）                    
│                                                          
└───────────────────────────────────────────────────────────
```

### 2.3 图表交互功能

GCViewer 提供丰富的交互功能：

1. **缩放**：鼠标滚轮缩放时间轴
2. **平移**：拖拽移动视图
3. **标记**：点击标记重要时间点
4. **对比**：打开多个日志文件对比
5. **导出**：导出为 PNG 或 CSV

---

## 三、GCeasy 在线可视化

### 3.1 时间序列图

GCeasy 提供多种时间序列图：

#### 3.1.1 堆内存使用图

显示堆内存各代的实际使用情况。

#### 3.1.2 GC 停顿时间图

显示每次 GC 的停顿时间分布。

#### 3.1.3 GC 频率图

显示 GC 发生频率的变化趋势。

### 3.2 交互功能

GCeasy 的图表支持：

1. **悬停查看详情**：鼠标悬停查看具体数值
2. **时间范围选择**：选择特定时间段放大查看
3. **对比模式**：上传多个日志文件对比
4. **PDF 导出**：导出完整分析报告

### 3.3 与 GCViewer 对比

| 功能 | GCViewer | GCeasy |
|-----|---------|--------|
| 本地处理 | ✅ | ❌ |
| 交互性 | 一般 | 强 |
| 分享功能 | ❌ | ✅ |
| 新版日志 | 有限 | 完全支持 |
| 趋势分析 | ❌ | ✅ |

---

## 四、SmartJDK 可视化

### 4.1 概述

SmartJDK（也称为 Java Flight Recorder + JDK Mission Control）是 JDK 11+ 自带的性能分析工具。

### 4.2 启动飞行记录

```bash
# 启动带有飞行记录的 JVM
java -XX:StartFlightRecording=delay=60s,duration=300s,filename=recording.jfr,name=myrecording \
     -XX:FlightRecorderOptions=repository=/tmp/jfr \
     -jar myapp.jar

# 或者动态附加
jcmd <pid> JFR.start delay=60s duration=300s filename=recording.jfr
```

### 4.3 GC 页面分析

JDK Mission Control 的 GC 页面提供：

1. **GC 时间线**：可视化的 GC 事件时间线
2. **停顿分析**：每次停顿的原因和耗时分解
3. **堆内存分析**：GC 前后的内存变化
4. **分配分析**：各区域的分配速率

### 4.4 与 GCViewer 对比

| 功能 | GCViewer | JDK Mission Control |
|-----|---------|---------------------|
| 数据来源 | GC 日志 | JFR 记录 |
| 实时监控 | ❌ | ✅ |
| 方法级分析 | ❌ | ✅ |
| 线程分析 | ❌ | ✅ |
| IO 分析 | ❌ | ✅ |

---

## 五、Python + Matplotlib 自定义可视化

### 5.1 解析 GC 日志

```python
import re
import matplotlib.pyplot as plt
from datetime import datetime

def parse_gc_log(filename):
    """解析 GC 日志"""
    events = []
    with open(filename, 'r') as f:
        for line in f:
            # 匹配 Minor GC
            minor_match = re.search(
                r'(\d+\.\d+): \[GC.*(\d+)K->(\d+)K\((\d+)K\), ([\d.]+) secs\]',
                line
            )
            if minor_match:
                events.append({
                    'time': float(minor_match.group(1)),
                    'type': 'Minor GC',
                    'before': int(minor_match.group(2)),
                    'after': int(minor_match.group(3)),
                    'total': int(minor_match.group(4)),
                    'pause': float(minor_match.group(5))
                })
                
            # 匹配 Full GC
            full_match = re.search(
                r'(\d+\.\d+): \[Full GC.*(\d+)K->(\d+)K\((\d+)K\), ([\d.]+) secs\]',
                line
            )
            if full_match:
                events.append({
                    'time': float(full_match.group(1)),
                    'type': 'Full GC',
                    'before': int(full_match.group(2)),
                    'after': int(full_match.group(3)),
                    'total': int(full_match.group(4)),
                    'pause': float(full_match.group(5))
                })
    return events

def visualize_gc(events):
    """可视化 GC 事件"""
    times = [e['time'] for e in events]
    pauses = [e['pause'] * 1000 for e in events]  # 转换为毫秒
    
    plt.figure(figsize=(12, 6))
    plt.scatter(times, pauses, c=['red' if 'Full' in e['type'] else 'blue' for e in events])
    plt.xlabel('Time (s)')
    plt.ylabel('GC Pause (ms)')
    plt.title('GC Pause Time Distribution')
    plt.grid(True, alpha=0.3)
    plt.show()

if __name__ == '__main__':
    events = parse_gc_log('gc.log')
    visualize_gc(events)
```

### 5.2 内存使用曲线

```python
def visualize_memory(events):
    """可视化内存使用"""
    times = [e['time'] for e in events]
    after_gc = [e['after'] / 1024 for e in events]  # 转换为 MB
    total = [e['total'] / 1024 for e in events]  # 转换为 MB
    
    plt.figure(figsize=(12, 6))
    plt.plot(times, after_gc, label='Used after GC')
    plt.plot(times, total, label='Total', linestyle='--')
    plt.fill_between(times, after_gc, total, alpha=0.3)
    plt.xlabel('Time (s)')
    plt.ylabel('Memory (MB)')
    plt.title('Memory Usage Over Time')
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.show()
```

---

## 六、可视化最佳实践

### 6.1 图表选择原则

| 数据类型 | 推荐图表 |
|---------|---------|
| 内存趋势 | 面积图、折线图 |
| 停顿时间 | 柱状图、散点图 |
| GC 频率 | 折线图、热力图 |
| 对象年龄 | 直方图 |

### 6.2 图表设计要点

1. **标题清晰**：一眼看出图表要表达的内容
2. **坐标轴标注**：单位要明确
3. **颜色对比**：不同类型用不同颜色区分
4. **图例说明**：复杂图表需要图例
5. **标注异常点**：发现异常要标注出来

### 6.3 报告模板

一个完整的 GC 分析报告应包含：

1. **概要信息**：应用基本信息、分析时间范围
2. **核心指标**：吞吐量、GC 次数、总停顿时间
3. **可视化图表**：内存曲线、停顿分布
4. **问题诊断**：发现的问题及建议
5. **优化建议**：具体的参数调整建议

---

## 七、工具选择建议

| 场景 | 推荐工具 |
|-----|---------|
| 快速查看 | GCeasy |
| 深度分析 | GCViewer |
| 实时监控 | JDK Mission Control |
| 自定义需求 | Python + Matplotlib |
| 团队协作 | GCeasy + PDF 导出 |

---

## 总结

GC 日志可视化的核心要点：

1. **可视化比数字更直观**：一眼看出问题所在
2. **GCViewer**：功能全面的本地工具
3. **GCeasy**：便捷的在线工具
4. **JDK Mission Control**：实时监控 + 深度分析
5. **自定义可视化**：满足特殊需求

---

## 思考题

如果你需要给团队做一次 GC 优化的汇报，你会选择哪些可视化图表来展示效果？

提示：考虑汇报的目标受众（技术团队 vs 领导），以及需要展示的核心信息（问题 vs 效果）。
