# Full GC 问题排查与调优

凌晨 3 点，你被监控报警吵醒：服务响应时间暴涨，P99 延迟从 100ms 飙升到 30 秒。

你登录服务器，执行 `jstat -gcutil`，看到老年代占用 99%，Full GC 正在疯狂触发。

这就是每个 Java 工程师都可能遇到的 **Full GC 问题**。

但别慌——Full GC 不是无解的玄学，它有明确的触发条件、清晰的排查路径和成熟的调优方案。

## 什么时候会触发 Full GC

在调优之前，先搞清楚敌人的底细。Full GC 触发的场景：

### 1. 老年代空间不足

这是最常见的触发条件。

```
年轻代 → 对象晋升 → 老年代 → 空间不足 → Full GC
```

当对象需要分配到老年代，但老年代剩余空间不够时，触发 Full GC 尝试回收空间。

### 2. 方法区（元空间）空间不足（JDK 7 及之前 PermGen）

JDK 8 之后，方法区移到了元空间，使用本地内存，不再受 JVM 堆大小限制。

但如果元空间持续增长导致溢出，也会触发 Full GC 尝试清理。

### 3. System.gc() 调用

显式调用 `System.gc()` 或 `Runtime.getRuntime().gc()` 会触发 Full GC。

```java
System.gc();  // 提醒 JVM 进行垃圾回收，但不保证立即执行
```

注意：JIT 可能优化掉这个调用（`-XX:+DisableExplicitGC` 除外）。

### 4. 空间分配担保失败

Minor GC 之前，JVM 会检查老年代最大可用连续空间是否大于历代对象总大小。

```
Minor GC 前检查：
- 老年代可用空间 > 历代对象总大小？ → Minor GC 安全
- 否则 → 检查 HandlePromotionFailure
    - true：尝试 Full GC
    - false：直接 Full GC
```

### 5. CMS GC 失败（Concurrent Mode Failure）

使用 CMS 收集器时，如果老年代空间不足以容纳新对象，同时 CMS 还没完成并发清理阶段，就会触发 **concurrent mode failure**，导致一次 Full GC。

```
CMS 并发标记 → 预清理 → "还有新对象进来，老年代不够了"
→ concurrent mode failure → Full GC（Serial Old）
```

这是 CMS 最糟糕的情况——原本为了低停顿的 CMS，退化成了最慢的 Serial GC。

## 排查步骤

### 第一步：获取 GC 日志

这是排查的第一步，也是最重要的一步。

```bash
# 开启详细 GC 日志
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/path/to/gc.log

# 如果是生产环境，建议同时开启
-XX:+PrintGCApplicationStoppedTime  # GC 停顿时间
-XX:+PrintPromotionFailure         # 空间担保失败信息
```

GC 日志示例：

```
2024-01-15T03:12:34.567+0800: [Full GC (Allocation Failure) 
  [CMS: 4096K->4096K(8192K), 2.345s]
  [Metaspace: 128K->128K(256K)]
  8192K->4096K(8192K), 2.345s]
```

关键信息解读：

| 字段 | 含义 |
|-----|------|
| `Allocation Failure` | 分配失败导致 Full GC |
| `CMS: 4096K->4096K` | CMS 收集前后老年代使用量 |
| `(8192K)` | 老年代总容量 |
| `2.345s` | 这次 GC 停顿时间 |

### 第二步：分析堆使用情况

```bash
# 查看堆使用详情
jmap -heap <pid>

# 输出示例
Heap Configuration:
   MaxHeapSize              = 4294967296 (4096.0MB)
   NewSize                  = 1073741824 (1024.0MB)
   OldSize                  = 3221225472 (3072.0MB)
   SurvivorRatio            = 8

Heap Usage:
New Generation (Eden + 2 Survivor Spaces):
   Eden space:   855720960 -> 0KB
   From space:   106921984 -> 0KB
   Old Generation:   3220176896 -> 3220176896KB (98.9%)
```

**重点关注**：
- 老年代占用比例是否接近 100%
- 新生代/老年代比例是否合理
- Eden 区大小是否适中

### 第三步：分析对象分布

```bash
# 按对象大小排序，查看占用最多的类
jmap -histo:live <pid> | head -50

# 输出
 num     #instances         #bytes  class name
----------------------------------------------
   1:          12345      123456789  [Ljava.lang.Object;
   2:           6789       98765432  java.lang.String
   3:           4321       56789012  com.example.MyClass
```

如果发现某个类的实例数量异常多，很可能是**内存泄漏**的线索。

### 第四步：堆转储分析

当 GC 问题严重时，需要堆转储来精确定位泄漏：

```bash
# 生成堆转储文件
jmap -dump:format=b,file=heap.hprof <pid>

# 然后用 MAT 打开分析
# 下载地址：https://eclipse.org/mat/
```

MAT 分析要点：
- **Leak Suspects**：自动识别可能的内存泄漏
- **Histogram**：按类统计对象数量
- **Dominator Tree**：找出持有大量引用的对象链

## 常见原因与解决方案

### 原因 1：内存泄漏

**症状**：老年代持续增长，Full GC 后内存不下降。

**排查**：
```bash
# 多次执行，对比对象数量变化
jmap -histo:live <pid> | grep MyClass
```

如果 `MyClass` 实例数量持续增长，说明代码中有地方不断创建对象但没有释放。

**常见泄漏场景**：

```java
// 场景 1：静态集合无限增长
static List<Object> cache = new ArrayList<>();

public void addToCache(Object obj) {
    cache.add(obj);  // 只增不减，内存爆炸
}

// 场景 2：监听器未注销
button.addActionListener(e -> { ... });
// 按钮销毁时没有 removeActionListener

// 场景 3：ThreadLocal 未清理
ThreadLocal<byte[]> buffer = ThreadLocal.withInitial(() -> new byte[1024*1024]);
// 线程池复用时，ThreadLocal 中的大对象不释放
```

### 原因 2：大对象直接进入老年代

**症状**：频繁 Full GC，但年轻代并不满。

**排查**：

```java
// 检查代码中是否有大数组、大集合
byte[] largeData = new byte[10 * 1024 * 1024];  // 10MB 对象

// 或者
List<Object> list = new ArrayList<>();
list.add(new byte[10 * 1024 * 1024]);
```

**解决**：
- 避免一次性分配大对象
- 调整 `-XX:PretenureSizeThreshold`（大对象阈值，默认 0，即所有对象都在 Eden 区分配）
- 如果业务确实需要大对象，考虑对象池化或分批处理

### 原因 3：短期对象生命周期过长

**症状**：大量本该在 Minor GC 被回收的对象，晋升到了老年代。

**排查**：

```java
// 检查是否有这种写法
public String process(List<String> items) {
    String result = "";  // StringBuilder 更优
    for (String item : items) {
        result += item;  // 每次拼接都创建新 String 对象
    }
    return result;
}
```

**解决**：
- 使用 `StringBuilder` 替代字符串拼接
- 降低 `-XX:MaxTenuringThreshold`（对象晋升老年代的年龄阈值，默认 15）
- 扩大年轻代比例

### 原因 4：Metaspace 持续增长（JDK 8+）

**症状**：元空间占用不断增长，最终 OOM。

**排查**：

```bash
jstat -gc <pid>

# 查看 Metaspace 使用情况
# MGCMN: 元空间最小容量
# MGCMX: 元空间最大容量
# MGC: 当前元空间容量
# MCC: 当前元空间已用容量
```

**解决**：
- 设置合理的元空间大小：`-XX:MaxMetaspaceSize=256m`
- 排查动态类生成（代理、反射、字节码增强）
- 升级到更高版本的 JDK

## 调优策略

### 策略 1：扩大堆内存

最直接的方案，但也要合理：

```bash
# 通用配置（4核8G机器，建议分配 4G 给 JVM）
-Xms4g -Xmx4g

# 注意：-Xms 和 -Xmx 建议设为相同，避免动态扩容的开销
```

### 策略 2：调整年轻代/老年代比例

根据业务特点选择比例：

```bash
# 默认比例 NewRatio=2，表示 老年代:年轻代 = 2:1
# 如果短期对象多，降低 NewRatio（年轻代更大）
-XX:NewRatio=1  # 老年代:年轻代 = 1:1

# 或者直接指定年轻代大小
-Xmn2g

# 调整 Survivor 比例（默认 8，表示 Eden:Survivor = 8:1）
-XX:SurvivorRatio=4
```

### 策略 3：选择合适的 GC 收集器

| 应用场景 | 推荐收集器 |
|---------|-----------|
| 吞吐量优先（后台批处理） | Parallel GC |
| 低延迟优先（在线服务） | G1 / ZGC / Shenandoah |
| 追求极致低延迟 | ZGC |
| 内存 < 4G，延迟敏感 | CMS（已不推荐，新项目用 G1） |

```bash
# 使用 G1
-XX:+UseG1GC -XX:MaxGCPauseMillis=200

# 使用 ZGC（JDK 11+）
-XX:+UseZGC -XX:MaxGCPauseMillis=200

# 使用 Shenandoah（JDK 12+）
-XX:+UseShenandoahGC
```

### 策略 4：CMS 专项调优

```bash
-XX:+UseConcMarkSweepGC

# 触发 CMS 初始标记的阈值（老年代使用比例）
-XX:CMSInitiatingOccupancyFraction=70

# 启用自动调整
-XX:+UseCMSInitiatingOccupancyOnly

# 预清理次数
-XX:CMSParallelRemarkEnabled
```

### 策略 5：G1 专项调优

G1 是 JDK 9+ 的默认收集器，调优相对简单：

```bash
-XX:+UseG1GC

# 目标停顿时间
-XX:MaxGCPauseMillis=200

# 堆比例（G1Region 大小自动计算）
-XX:G1NewSizePercent=5
-XX:G1MaxNewSizePercent=60

# 混合回收阈值
-XX:InitiatingHeapOccupancyPercent=45
```

## Full GC 调优检查清单

当 Full GC 频发时，按这个清单逐项排查：

| 检查项 | 命令 | 正常范围 |
|-------|-----|---------|
| 老年代占用 | `jstat -gc` | < 80% |
| Full GC 频率 | 分析 GC 日志 | < 每小时 1-2 次 |
| Full GC 耗时 | 分析 GC 日志 | < 1 秒 |
| 元空间使用 | `jstat -gc` | 稳定，不持续增长 |
| 对象分配速率 | 分析 GC 日志 | 与业务请求量匹配 |
| 存活对象大小 | `jmap -histo` | 无异常大的类 |

## 面试追问方向

1. **CMS 在并发阶段用户线程也在运行，如果新对象进入老年代怎么处理？**

提示：浮动垃圾（Floating Garbage）、卡片标记（Card Marking）机制。

2. **G1 的 Full GC 为什么性能很差？JDK 12+ 有什么改进？**

提示：G1 原本依赖混合回收避免 Full GC，但一旦触发会很慢。JDK 12 引入了 `-XX:G1EagerReclaimHumongousObjects`。

3. **ZGC 为什么能做到极低延迟？它的「着色指针」是什么原理？**

提示：染色指针、读屏障、并发重定位。

---

## 留给你的思考题

一个服务频繁 Full GC，你分析日志发现每次 Full GC 后，老年代占用率几乎不变，但 Minor GC 很频繁。

这说明什么？

- 对象晋升年龄太小？
- Survivor 区太小导致对象提前晋升？
- 还是说根本不是老年代的问题？

结合 GC 日志中的晋升记录，你能判断真正的原因吗？

提示：关注 GC 日志中的 `Desired survivor size`、`age` 字段。
