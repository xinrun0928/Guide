# JVM 调优经验总结与典型场景配置

经过这么多章节的学习，我们已经掌握了 JVM 调优的各个方面。

今天，我们来做一次全面的总结，并给出典型场景的配置方案。

---

## 一、JVM 调优核心原则

### 1.1 调优的三大目标

| 目标 | 含义 | 衡量指标 |
|-----|-----|---------|
| **吞吐量** | 单位时间内处理的任务数 | QPS、TPS |
| **延迟** | 单次请求的响应时间 | P99、P999 延迟 |
| **内存占用** | 运行时占用的内存大小 | 堆大小、RSS |

### 1.2 调优的基本原则

1. **先测后调**：通过数据驱动调优，不要凭感觉
2. **小步快跑**：每次只改一个参数，观察效果
3. **可逆性**：保留回滚能力，参数改动要可逆
4. **监控先行**：调优前先确保监控到位
5. **场景化**：不同场景使用不同配置

### 1.3 调优的顺序

```
1. 确认问题：延迟高？吞吐量低？内存泄漏？
   ↓
2. 收集数据：GC 日志、监控指标、线程 dump
   ↓
3. 分析根因：找到问题的根本原因
   ↓
4. 制定方案：选择合适的收集器和参数
   ↓
5. 实施验证：灰度发布，观察效果
   ↓
6. 持续优化：根据实际效果持续调整
```

---

## 二、典型场景配置方案

### 2.1 低延迟 Web 应用

**场景特点**：
- 高并发请求
- 响应时间敏感（P99 < 200ms）
- 不能容忍长停顿

**推荐收集器**：G1（JDK 9+）或 CMS（JDK 8）

```bash
# JDK 11/17/21 标准配置
-Xms8g -Xmx8g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=100 \
-XX:G1HeapRegionSize=8m \
-XX:InitiatingHeapOccupancyPercent=45 \
-XX:G1ReservePercent=15 \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/heapdump.hprof \
-Xlog:gc*=info:file=/var/log/myapp-gc.log:time,uptime,level,tags:filecount=10,filesize=10M
```

**JDK 8 配置**：

```bash
-Xms4g -Xmx4g -Xmn2g \
-XX:+UseParNewGC \
-XX:+UseConcMarkSweepGC \
-XX:CMSInitiatingOccupancyFraction=50 \
-XX:+UseCMSInitiatingOccupancyOnly \
-XX:MaxGCPauseMillis=100 \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/heapdump.hprof \
-verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps \
-Xloggc:/var/log/myapp-gc.log
```

**关键指标**：
- 吞吐量 > 90%
- 最大停顿 < 200ms
- Full GC 频率 < 1次/小时

### 2.2 高吞吐量批处理

**场景特点**：
- 大数据量处理
- 吞吐量优先
- 可以容忍较长停顿

**推荐收集器**：Parallel GC

```bash
# JDK 8/11/17/21 通用配置
-Xms16g -Xmx16g \
-XX:+UseParallelGC \
-XX:+UseParallelOldGC \
-XX:ParallelGCThreads=16 \
-XX:GCTimeRatio=99 \
-XX:+UseAdaptiveSizePolicy \
-XX:MaxGCPauseMillis=1000 \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/heapdump.hprof
```

**关键指标**：
- 吞吐量 > 98%
- Full GC 频率 < 1次/小时
- 允许较长的停顿时间（< 1秒）

### 2.3 大内存应用（> 32GB）

**场景特点**：
- 堆内存 > 32GB
- 传统 GC 停顿时间过长
- 需要可扩展的方案

**推荐收集器**：ZGC

```bash
# JDK 11+ ZGC 配置
-Xms64g -Xmx64g \
-XX:+UseZGC \
-XX:MaxGCPauseMillis=10 \
-XX:+ZGenerational \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/heapdump.hprof \
-Xlog:gc*=info:file=/var/log/myapp-gc.log
```

**JDK 21+ 分代 ZGC**：

```bash
# 分代 ZGC 进一步优化
-Xms64g -Xmx64g \
-XX:+UseZGC \
-XX:+ZGenerational \
-XX:MaxGCPauseMillis=5 \
-XX:+HeapDumpOnOutOfMemoryError
```

**G1 备选配置**：

```bash
# 如果 ZGC 不适用
-Xms64g -Xmx64g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=200 \
-XX:G1HeapRegionSize=32m \
-XX:InitiatingHeapOccupancyPercent=50 \
-XX:G1ReservePercent=20
```

**关键指标**：
- 最大停顿 < 10ms（ZGC）
- 吞吐量 > 85%
- 支持 TB 级堆内存

### 2.4 微服务容器化

**场景特点**：
- 容器化部署
- 内存受限
- 需要快速启动

**推荐收集器**：G1

```bash
# Docker/Kubernetes 配置
-Xms2g -Xmx2g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=100 \
-XX:G1HeapRegionSize=2m \
-XX:InitiatingHeapOccupancyPercent=45 \
-XX:+UseContainerSupport \
-XX:-PreferContainerQuotaForCPUCount \
-XX:MaxRAMPercentage=75.0 \
-XX:InitialRAMPercentage=75.0 \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/tmp/heapdump.hprof
```

**关键指标**：
- 容器内存限制的 75%
- 最大停顿 < 100ms
- 启动时间 < 30秒

### 2.5 极致低延迟（金融交易）

**场景特点**：
- 毫秒级延迟敏感
- 超高并发
- 不能容忍任何长停顿

**推荐收集器**：ZGC

```bash
# JDK 15+ 分代 ZGC 极致配置
-Xms32g -Xmx32g \
-XX:+UseZGC \
-XX:+ZGenerational \
-XX:+ZProactive \
-XX:MaxGCPauseMillis=1 \
-XX:+HeapDumpOnOutOfMemoryError
```

**关键指标**：
- 最大停顿 < 1ms
- P99 延迟 < 5ms
- P999 延迟 < 10ms

---

## 三、参数配置速查表

### 3.1 按 JDK 版本

| JDK 版本 | 推荐收集器 | 备注 |
|---------|-----------|------|
| JDK 8 | G1（JDK 8u40+）或 CMS | CMS 已废弃 |
| JDK 11 | G1 或 ZGC | G1 默认 |
| JDK 17 | G1 或 ZGC | ZGC 成熟 |
| JDK 21 | G1 或分代 ZGC | 分代 ZGC 成熟 |

### 3.2 按堆内存大小

| 堆内存 | 推荐收集器 | 备注 |
|-------|-----------|------|
| < 1GB | Serial | 小内存更高效 |
| 1-4GB | G1 | 配置简单 |
| 4-32GB | G1 | 最佳平衡 |
| 32-64GB | ZGC | 低延迟首选 |
| > 64GB | ZGC | 可扩展方案 |

### 3.3 按业务场景

| 场景 | 推荐收集器 | 核心参数 |
|-----|-----------|---------|
| Web 应用 | G1 | MaxGCPauseMillis=100 |
| API 服务 | G1 | MaxGCPauseMillis=200 |
| 批处理 | Parallel | GCTimeRatio=99 |
| 实时计算 | ZGC | MaxGCPauseMillis=5 |
| 金融交易 | ZGC | MaxGCPauseMillis=1 |
| 大数据 | ZGC | MaxGCPauseMillis=10 |

---

## 四、调优检查清单

### 4.1 上线前检查

- [ ] GC 收集器选择正确
- [ ] 堆内存大小设置合理
- [ ] GC 日志已开启
- [ ] HeapDump 已配置
- [ ] 监控告警已配置
- [ ] 压测验证已完成

### 4.2 生产巡检

- [ ] GC 指标正常
- [ ] 堆内存使用率 < 80%
- [ ] Full GC 频率正常
- [ ] 无异常停顿
- [ ] OOM 告警检查

### 4.3 问题排查

- [ ] Minor GC 频率是否正常
- [ ] Full GC 频率是否正常
- [ ] 对象晋升率是否过高
- [ ] Survivor 区使用情况
- [ ] 元空间使用情况

---

## 五、常见问题与解决方案

### 5.1 GC 频繁

| 问题 | 原因 | 解决方案 |
|-----|-----|---------|
| Minor GC 频繁 | 年轻代太小 | 增大 -Xmn |
| Full GC 频繁 | 老年代太小 | 增大堆内存 |
| 元空间 GC 频繁 | MetaspaceSize 太小 | 增大 MetaspaceSize |

### 5.2 停顿时间长

| 问题 | 原因 | 解决方案 |
|-----|-----|---------|
| Minor GC 停顿长 | 年轻代太大 | 减小 -Xmn |
| Full GC 停顿长 | 堆太大 | 使用 G1/ZGC |
| GC 停顿不稳定 | 参数设置不当 | 调整收集器参数 |

### 5.3 内存泄漏

| 问题 | 排查方法 |
|-----|---------|
| 堆内存泄漏 | MAT 分析堆转储 |
| 元空间泄漏 | Arthas 分析类加载 |
| 直接内存泄漏 | NMT 分析 |

---

## 六、监控告警配置

### 6.1 核心告警

```yaml
# Prometheus 告警规则
groups:
  - name: jvm-alerts
    rules:
      - alert: JVMHeapUsageHigh
        expr: jvm_heap_used / jvm_heap_max > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "JVM 堆内存使用率超过 85%"

      - alert: JVMFullGCFrequent
        expr: increase(jvm_gc_pause_seconds_count{type="full"}[1h]) > 5
        labels:
          severity: critical
        annotations:
          summary: "过去 1 小时 Full GC 次数超过 5 次"

      - alert: JVMGCPauseHigh
        expr: jvm_gc_pause_seconds_max > 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "GC 停顿时间超过 1 秒"

      - alert: JVMMetaspaceUsageHigh
        expr: jvm_metaspace_used / jvm_metaspace_max > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Metaspace 使用率超过 80%"
```

### 6.2 监控指标

| 指标 | 说明 | 告警阈值 |
|-----|-----|---------|
| jvm_heap_used | 堆内存使用量 | > 85% |
| jvm_heap_max | 堆内存最大值 | - |
| jvm_gc_pause_seconds | GC 停顿时间 | > 1s |
| jvm_gc_pause_seconds_count | GC 次数 | > 阈值 |
| jvm_metaspace_used | 元空间使用量 | > 80% |
| jvm_threads_started_total | 启动线程数 | - |
| jvm_threads_deadlocked | 死锁线程数 | > 0 |

---

## 七、调优案例集锦

### 案例 1：电商秒杀系统

**场景**：大促期间，瞬时流量巨大

**问题**：Minor GC 频繁，响应延迟增加

**分析**：
- Minor GC 频率：每分钟 30 次
- 停顿时间：80ms
- 对象晋升率：45%

**解决方案**：
```bash
-Xms16g -Xmx16g -Xmn8g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=50 \
-XX:G1HeapRegionSize=8m
```

**效果**：
- Minor GC 频率：每分钟 8 次
- 停顿时间：30ms
- 响应延迟 P99：降低 40%

### 案例 2：数据处理服务

**场景**：24 小时不间断数据处理

**问题**：内存持续增长，Full GC 后不回落到原点

**分析**：
- 静态 HashMap 缓存无限增长
- 没有清理机制

**解决方案**：
```java
// 添加 LRU 清理机制
private static final int MAX_CACHE_SIZE = 10000;
private static LinkedHashMap<String, Object> cache = 
    new LinkedHashMap<String, Object>(MAX_CACHE_SIZE, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry eldest) {
            return size() > MAX_CACHE_SIZE;
        }
    };
```

**效果**：内存使用稳定，Full GC 后回落到原点

### 案例 3：低延迟交易系统

**场景**：金融交易系统，要求 P99 < 5ms

**问题**：使用 G1，停顿时间偶尔超过 100ms

**分析**：
- Mixed GC 收集了太多 Old Region
- 堆内存 32GB

**解决方案**：
```bash
-Xms32g -Xmx32g \
-XX:+UseZGC \
-XX:+ZGenerational \
-XX:+ZProactive \
-XX:MaxGCPauseMillis=1
```

**效果**：
- 最大停顿：< 5ms
- P99 延迟：3ms
- P999 延迟：8ms

---

## 八、学习路径建议

### 8.1 初学者

1. 理解 JVM 内存模型
2. 掌握 GC 基本算法
3. 学习常用 GC 收集器
4. 理解核心参数含义

### 8.2 进阶

1. 深入理解 GC 日志
2. 掌握调优工具（MAT、Arthas）
3. 学习常见问题排查
4. 理解收集器原理

### 8.3 高级

1. 深入理解 ZGC/Shenandoah
2. 性能分析与火焰图
3. 容器化 JVM 调优
4. 自定义 GC 算法

---

## 总结

JVM 调优的核心要点：

1. **明确目标**：吞吐量、延迟、内存占用
2. **场景化配置**：不同场景使用不同方案
3. **数据驱动**：通过监控和日志分析
4. **持续优化**：调优是迭代过程
5. **工具配合**：MAT、Arthas、async-profiler

---

## 思考题

如果让你为一个日活千万的电商应用设计 JVM 配置，你会考虑哪些因素？请列出具体的配置方案。

提示：考虑流量特征、数据量级、延迟要求、容器化部署等因素。
