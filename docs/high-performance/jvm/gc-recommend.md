# GC 参数组合推荐：不同业务场景的配置方案

GC 参数配置没有标准答案，必须根据业务场景来选择。

今天我们就来总结一下不同业务场景下的 GC 参数配置方案。

---

## 一、业务场景分类

### 1.1 场景分类

| 场景类型 | 特点 | 核心目标 |
|---------|-----|---------|
| **低延迟 Web 应用** | 高并发、响应时间敏感 | 减少停顿 |
| **批处理/离线计算** | 大数据量、吞吐量优先 | 提高吞吐 |
| **大内存应用** | 堆内存 > 32GB | 控制停顿 + 可扩展 |
| **微服务** | 容器化、内存受限 | 稳定可靠 |
| **低延迟金融** | 毫秒级敏感 | 极致低延迟 |

### 1.2 选择收集器的原则

```
堆内存 < 4GB → G1
堆内存 4-32GB → G1（低延迟）或 Parallel（高吞吐）
堆内存 > 32GB → ZGC 或 Shenandoah
延迟敏感 → G1 / ZGC
吞吐优先 → Parallel
JDK 8 → CMS 或 G1（JDK 8u40+）
JDK 11+ → G1 或 ZGC
JDK 21+ → ZGC 或分代 ZGC
```

---

## 二、低延迟 Web 应用配置

### 2.1 场景特点

- 高并发请求
- 响应时间敏感
- Minor GC 频繁但要求停顿短
- 不能容忍长停顿

### 2.2 推荐配置：G1

```bash
# JDK 8
-Xms4g -Xmx4g -Xmn2g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=100 \
-XX:G1HeapRegionSize=4m \
-XX:InitiatingHeapOccupancyPercent=45 \
-XX:G1ReservePercent=15 \
-XX:+PrintGCDetails -XX:+PrintGCDateStamps \
-Xloggc:/var/log/myapp-gc.log \
-XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles=10 -XX:GCLogFileSize=10M
```

### 2.3 JDK 9+ 配置

```bash
# JDK 11/17/21
-Xms4g -Xmx4g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=100 \
-XX:G1HeapRegionSize=4m \
-XX:InitiatingHeapOccupancyPercent=45 \
-XX:G1ReservePercent=15 \
-Xlog:gc*=info:file=/var/log/myapp-gc.log:time,uptime,level,tags:filecount=10,filesize=10M
```

### 2.4 CMS 配置（JDK 8 备选）

```bash
# JDK 8 CMS（已废弃，仅作了解）
-Xms4g -Xmx4g -Xmn2g \
-XX:+UseConcMarkSweepGC \
-XX:+UseParNewGC \
-XX:CMSInitiatingOccupancyFraction=50 \
-XX:+UseCMSInitiatingOccupancyOnly \
-XX:MaxGCPauseMillis=100
```

---

## 三、批处理/离线计算配置

### 3.1 场景特点

- 大数据量处理
- 吞吐量优先
- 可以容忍较长的停顿
- 长时间运行

### 3.2 推荐配置：Parallel GC

```bash
# JDK 8/11/17/21 通用
-Xms8g -Xmx8g \
-XX:+UseParallelGC \
-XX:+UseParallelOldGC \
-XX:ParallelGCThreads=8 \
-XX:GCTimeRatio=99 \
-XX:+UseAdaptiveSizePolicy \
-XX:MaxGCPauseMillis=1000
```

### 3.3 参数说明

| 参数 | 含义 | 建议值 |
|-----|-----|-------|
| GCTimeRatio | GC 时间占总时间比例 | 99 表示 1% |
| MaxGCPauseMillis | 最大停顿时间（软目标）| 1000ms |
| ParallelGCThreads | 并行 GC 线程数 | CPU 核心数 |
| UseAdaptiveSizePolicy | 自动调整各代大小 | 开启 |

---

## 四、大内存应用配置

### 4.1 场景特点

- 堆内存 > 32GB
- 传统 GC 停顿时间过长
- 需要可扩展的 GC

### 4.2 推荐配置：ZGC

```bash
# JDK 11+ 推荐
-Xms64g -Xmx64g \
-XX:+UseZGC \
-XX:MaxGCPauseMillis=10 \
-XX:+ZGenerational
```

### 4.3 G1 配置（备选）

```bash
# JDK 11/17/21
-Xms64g -Xmx64g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=200 \
-XX:G1HeapRegionSize=32m \
-XX:InitiatingHeapOccupancyPercent=50 \
-XX:G1ReservePercent=20
```

### 4.4 Shenandoah 配置

```bash
# JDK 12+ 支持
-Xms64g -Xmx64g \
-XX:+UseShenandoahGC \
-XX:MaxGCPauseMillis=20
```

### 4.5 大内存配置对比

| 收集器 | 最大停顿 | 吞吐量 | JDK 版本 |
|-------|---------|--------|---------|
| G1 | < 200ms | 高 | 9+ |
| ZGC | < 10ms | 中 | 11+ |
| Shenandoah | < 20ms | 中 | 12+ |

---

## 五、微服务容器化配置

### 5.1 场景特点

- 容器化部署
- 内存受限（CPU/内存限制）
- 需要快速启动
- 多实例部署

### 5.2 推荐配置

```bash
# 容器内存限制 2GB
-Xms2g -Xmx2g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=100 \
-XX:G1HeapRegionSize=2m \
-XX:InitiatingHeapOccupancyPercent=45 \
-XX:+UseContainerSupport \
-XX:-PreferContainerQuotaForCPUCount
```

### 5.3 容器配置注意事项

1. **启用容器感知**：`-XX:+UseContainerSupport`
2. **容器 CPU 配额**：`XX:-PreferContainerQuotaForCPUCount`
3. **容器内存限制**：使用 `-XX:MaxRAMPercentage` 代替硬编码

```bash
# 动态配置
-XX:MaxRAMPercentage=75.0
-XX:InitialRAMPercentage=75.0
```

### 5.4 Docker 启动示例

```bash
docker run -m 2g \
  -e JAVA_OPTS="-XX:+UseG1GC -XX:MaxGCPauseMillis=100" \
  myapp:latest
```

---

## 六、低延迟金融场景配置

### 6.1 场景特点

- 毫秒级延迟敏感
- 超高并发
- 交易、风控等核心系统
- 不能容忍任何长停顿

### 6.2 推荐配置：ZGC

```bash
# JDK 15+ 分代 ZGC
-Xms32g -Xmx32g \
-XX:+UseZGC \
-XX:MaxGCPauseMillis=5 \
-XX:+ZGenerational
```

### 6.3 参数调优

```bash
# 极致低延迟配置
-Xms32g -Xmx32g \
-XX:+UseZGC \
-XX:MaxGCPauseMillis=1 \
-XX:+ZGenerational \
-XX:+ZProactive
# ZProactive：主动触发 GC，减少被动 Full GC
```

### 6.4 生产验证清单

- [ ] 压力测试验证停顿时间
- [ ] 灰度发布验证稳定性
- [ ] 监控告警配置
- [ ] GC 日志分析
- [ ] 定期 Review GC 指标

---

## 七、特殊场景配置

### 7.1 超大并发（百万连接）

```bash
-Xms16g -Xmx16g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=50 \
-XX:G1HeapRegionSize=8m \
-XX:MaxTenuringThreshold=10
```

### 7.2 大量定时任务

```bash
-Xms8g -Xmx8g \
-XX:+UseG1GC \
-XX:MaxGCPauseMillis=200 \
-XX:G1ReservePercent=20
```

### 7.3 大量大对象场景

```bash
-Xms32g -Xmx32g \
-XX:+UseG1GC \
-XX:G1HeapRegionSize=16m \
-XX:G1HeapRegionSize=8m  # 大 Region 减少 Humongous
```

### 7.4 内存敏感场景（低配置机器）

```bash
-Xms512m -Xmx512m \
-XX:+UseSerialGC
# 小内存场景 Serial GC 更高效
```

---

## 八、配置验证流程

### 8.1 上线前验证

1. **本地压测**：模拟真实业务场景
2. **GC 日志分析**：确保指标符合预期
3. **监控告警**：配置 Prometheus 告警

### 8.2 压测关键指标

| 指标 | 低延迟场景 | 吞吐优先场景 |
|-----|-----------|-------------|
| 吞吐量 | > 90% | > 98% |
| 最大停顿 | < 100ms | < 1000ms |
| 平均停顿 | < 20ms | < 200ms |
| Full GC 频率 | < 1次/天 | < 1次/小时 |

### 8.3 灰度发布

```yaml
# Kubernetes 滚动更新
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 25%
    maxUnavailable: 25%
```

---

## 九、快速配置速查表

### 9.1 按 JDK 版本

| JDK 版本 | 默认收集器 | 推荐 |
|---------|-----------|-----|
| JDK 8 | Parallel | G1（低延迟）或 Parallel（吞吐）|
| JDK 11 | G1 | G1 或 ZGC |
| JDK 17 | G1 | G1 或 ZGC |
| JDK 21 | G1 | G1 或 ZGC（分代）|

### 9.2 按堆内存大小

| 堆内存 | 推荐收集器 | 配置复杂度 |
|-------|-----------|-----------|
| < 1GB | Serial | 低 |
| 1-4GB | G1 | 中 |
| 4-32GB | G1 | 中 |
| 32-64GB | ZGC | 低 |
| > 64GB | ZGC / G1 | 低/中 |

### 9.3 按业务场景

| 场景 | 推荐收集器 | 核心参数 |
|-----|-----------|---------|
| Web 应用 | G1 | MaxGCPauseMillis=100 |
| 批处理 | Parallel | GCTimeRatio=99 |
| 金融低延迟 | ZGC | MaxGCPauseMillis=5 |
| 容器化 | G1 | MaxRAMPercentage |

---

## 总结

GC 参数配置没有标准答案，核心要点：

1. **明确业务目标**：低延迟 vs 高吞吐
2. **选择合适收集器**：根据 JDK 版本和堆内存大小
3. **参考推荐配置**：根据场景选择对应模板
4. **压测验证**：上线前必须压测验证
5. **持续监控**：生产环境持续关注 GC 指标

---

## 思考题

为什么说 ZGC 的分代模式（ZGenerational）是 JDK 21 之后的最佳选择？

提示：考虑 ZGC 的特点和分代 ZGC 的优势。
