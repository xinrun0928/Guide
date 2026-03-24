# Full GC 频繁原因分析与排查

Minor GC 是「小打小闹」，Full GC 才是「伤筋动骨」。

一次 Full GC 的停顿时间可能是 Minor GC 的几十倍甚至上百倍。如果你的应用 Full GC 频繁，那问题可能就比较严重了。

今天我们来全面分析 Full GC 频繁的原因和排查方法。

---

## 一、Full GC vs Minor GC

### 1.1 基本区别

| 维度 | Minor GC | Full GC |
|-----|---------|---------|
| 回收区域 | 年轻代 | 年轻代 + 老年代 + 元空间 |
| 停顿时间 | 短（几十毫秒）| 长（几百毫秒到几秒）|
| 触发频率 | 较高 | 较低 |
| 算法 | 复制算法 | 标记-清除-压缩 |

### 1.2 Full GC 的触发条件

Full GC 有多种触发条件：

1. **老年代空间不足**：对象晋升时发现老年代空间不够
2. **元空间不足**：类加载过多导致元空间 OOM
3. **显式调用**：System.gc()（可能不触发，取决于 -XX:+DisableExplicitGC）
4. **分配担保失败**：Minor GC 时 Survivor 区空间不足
5. **CMS 失败**：并发标记失败或浮动垃圾过多
6. **自适应策略**：JVM 根据统计信息决定触发 Full GC

---

## 二、Full GC 频繁的原因分析

### 2.1 原因一：老年代空间不足

**症状**：Full GC 后老年代几乎没释放空间

**诊断**：

```
Full GC 日志显示：
Full GC (Ergonomics)
  [CMS: 524288K->524288K(524288K), 4.567 secs]
# 老年代 512MB -> 512MB，几乎没释放空间
```

**可能原因**：

1. 堆内存太小
2. 对象分配速率太高
3. 内存泄漏

**解决方案**：

```bash
# 增大堆内存
-Xms8g -Xmx8g -Xmn2g

# 或增大老年代
-XX:NewRatio=1  # 年轻代:老年代 = 1:1
```

### 2.2 原因二：对象晋升过快

**症状**：Minor GC 后大量对象晋升到老年代

**诊断**：

```
GC 日志显示：
0.123: [GC (Allocation Failure) 
  - age   1:   52428800 bytes,   52428800 total  # 50MB 对象晋升
]
# 一次 Minor GC 后 50MB 对象晋升到老年代
```

**可能原因**：

1. Survivor 区太小
2. 晋升年龄设置太小
3. 大对象直接分配

**解决方案**：

```bash
# 增大 Survivor 区
-XX:SurvivorRatio=4  # 减小比例，增大 Survivor

# 或增大年轻代
-Xmn2g

# 调整晋升年龄
-XX:MaxTenuringThreshold=15
```

### 2.3 原因三：内存泄漏

**症状**：堆内存持续增长，Full GC 后不回落

**诊断方法**：

1. 多次 Full GC 后堆内存对比
2. 使用 MAT 分析堆转储

**排查命令**：

```bash
# 生成堆转储
jmap -dump:format=b,file=heap.hprof <pid>

# 或使用 Arthas
heapdump --live /tmp/heap.hprof
```

**常见泄漏场景**：

- 静态集合类持有对象引用
- 未关闭的资源（连接、线程）
- 监听器未注销
- 缓存没有清理策略

```java
// 常见内存泄漏代码示例
public class MemoryLeakExample {
    // 静态集合持有引用，永不释放
    private static final Map&lt;String, Object&gt; cache = new HashMap&lt;&gt;();
    
    public void addToCache(String key, Object value) {
        cache.put(key, value);  // 只增不减，内存泄漏
    }
    
    // 正确的做法：使用 WeakHashMap 或设置过期
    private static final Map&lt;String, WeakReference&lt;Object&gt;&gt; weakCache = 
        new WeakHashMap&lt;&gt;();
}
```

### 2.4 原因四：元空间不足

**症状**：Full GC 日志显示 Metaspace 相关

```
Full GC (Metadata GC Threshold)
# 元空间达到阈值，触发 Full GC 清理类加载器
```

**诊断**：

```bash
jstat -gc <pid>
# 查看 Metaspace 使用情况
```

**解决方案**：

```bash
# 增大元空间
-XX:MetaspaceSize=512m -XX:MaxMetaspaceSize=1g

# 排查类加载器泄漏
```

### 2.5 原因五：显式 GC 调用

**症状**：频繁 Full GC，日志显示 Allocation Failure

**诊断**：

```bash
# 检查是否有代码调用 System.gc()
jinfo -flag +PrintGCDetails <pid>
# 查看日志中是否有 GC (System.gc())
```

**解决方案**：

```bash
# 禁用显式 GC（不推荐，除非确定不需要 Full GC）
-XX:+DisableExplicitGC
```

> 注意：某些框架（如 RMI、NIO）会使用显式 GC，禁用后可能导致其他问题

### 2.6 原因六：CMS 并发模式失败

**症状**：CMS GC 过程中，老年代空间不足

```
Full GC (Concurrent Mode Failure)
  [CMS: 524288K->524288K(524288K), 4.567 secs]
```

**原因**：CMS 并发标记期间，老年代持续分配对象，但来不及回收

**解决方案**：

```bash
# 降低 CMS 触发阈值，提前开始并发标记
-XX:CMSInitiatingOccupancyFraction=60  # 默认 68%

# 增大堆内存
-Xms8g -Xmx8g
```

---

## 三、Full GC 排查流程

### 3.1 排查步骤

```
1. 收集 GC 日志
   ↓
2. 分析 Full GC 触发原因
   ↓
3. 检查堆内存使用情况
   ↓
4. 生成堆转储分析
   ↓
5. 定位泄漏代码
   ↓
6. 修复问题
```

### 3.2 GC 日志分析

```bash
# 分析 Full GC 频率
grep "Full GC" gc.log | wc -l

# 分析触发原因
grep "Full GC" gc.log | awk '{print $4}'

# 分析 GC 前后内存
grep "Full GC" gc.log
```

### 3.3 使用 jstat 实时监控

```bash
# 持续监控 GC 情况
jstat -gcutil <pid> 1000

# 观察各代空间使用情况
# S0C, S1C, EC, OC, MC 等
```

---

## 四、Full GC 优化实战

### 4.1 案例一：老年代空间不足

**场景**：订单系统 Full GC 频繁

**分析**：

```bash
# 配置
-Xms4g -Xmx4g -Xmn1g
# 年轻代 1GB，老年代 3GB

# 问题
Full GC 频率：每 10 分钟一次
Full GC 耗时：3-5 秒
```

**优化方案**：

```bash
# 方案 1：增大堆内存
-Xms8g -Xmx8g -Xmn2g

# 方案 2：增大老年代比例
-Xms4g -Xmx4g -XX:NewRatio=1  # 年轻代:老年代 = 1:1

# 方案 3：优化代码，减少对象创建
```

### 4.2 案例二：CMS 并发模式失败

**场景**：使用 CMS 收集器，频繁 Full GC

**分析**：

```bash
# 配置
-XX:+UseConcMarkSweepGC \
-XX:CMSInitiatingOccupancyFraction=70

# 问题
Full GC (Concurrent Mode Failure)
频率：每小时 3-4 次
```

**优化方案**：

```bash
# 方案 1：降低触发阈值
-XX:CMSInitiatingOccupancyFraction=50

# 方案 2：使用 G1 替代 CMS
-XX:+UseG1GC -XX:MaxGCPauseMillis=200

# 方案 3：升级到 JDK 11+，使用 ZGC
```

### 4.3 案例三：类加载器泄漏

**场景**：Tomcat 反复部署后 Full GC 频繁

**分析**：

```bash
# 使用 MAT 分析堆转储
# 查找 ClassLoader 相关的泄漏
```

**解决方案**：

1. 升级 Tomcat 版本
2. 检查应用代码中的类加载器使用
3. 确保应用关闭时清理资源

---

## 五、Full GC 预防措施

### 5.1 监控告警

```yaml
# Prometheus 告警规则
- alert: FullGCFrequent
  expr: rate(jvm_gc_pause_seconds_count{type="full"}[1h]) > 5
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Full GC 频率过高"
    description: "过去 1 小时 Full GC 次数超过 5 次"
```

### 5.2 定期分析

1. 每天分析一次 GC 日志
2. 关注 Full GC 频率变化趋势
3. 堆转储分析（每周一次或发现问题立即分析）

### 5.3 代码规范

1. 避免使用 System.gc()
2. 使用合适的数据结构
3. 及时释放资源
4. 使用软引用/弱引用处理缓存

---

## 六、总结

Full GC 频繁的排查要点：

1. **分析触发原因**：从 GC 日志找到真相
2. **检查老年代空间**：是否空间不足
3. **分析对象晋升**：是否晋升过快
4. **排查内存泄漏**：堆转储 + MAT
5. **考虑收集器调优**：CMS 参数或更换 G1/ZGC

---

## 思考题

Full GC 频繁，但每次 Full GC 后老年代空间都释放了很多。这说明什么问题？

提示：考虑正常的老年代对象回收和异常的对象回收模式。
