# 堆内存参数：-Xms、-Xmx、-Xmn、-XX:NewRatio

你有没有注意过这种现象：Java 应用刚启动时，响应特别慢，但运行一段时间后就稳定了。

或者反过来：应用运行得很平稳，突然某次请求变慢了，然后又恢复正常。

这很可能是**堆内存配置不当**导致的。堆内存是 Java 应用的「生命线」——对象在这里分配，垃圾在这里回收。配置好了，应用如丝般顺滑；配置差了，各种卡顿、OOM 随之而来。

今天，我们就来彻底搞清楚堆内存参数的配置方法。

---

## 一、堆内存参数全景图

在开始之前，先建立对 JVM 堆内存的整体认知。堆内存的结构大致如下：

```
┌─────────────────────────────────────────────────────────────┐
│                        Heap Memory                          │
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────┐│
│  │   Young Generation  │    │      Old Generation        ││
│  │                     │    │                             ││
│  │  ┌───┬───┬───────┐  │    │                             ││
│  │  │Eden│S0 │  S1  │  │    │                             ││
│  │  │    │   │      │  │    │                             ││
│  │  └───┴───┴───────┘  │    │                             ││
│  └─────────────────────┘    └─────────────────────────────┘│
│     ↑                           ↑                          │
│   新对象                       老对象                       │
│   分配处                       晋升处                       │
└─────────────────────────────────────────────────────────────┘
```

### 堆内存的核心区域

1. **Eden 区**：新对象分配的默认位置，大多数对象在这里创建后很快就成为垃圾
2. **Survivor 区（S0/S1）**：用于存放在 Eden 区幸存的年轻对象
3. **Old 区（老年代）**：长期存活的对象或大对象会晋升到这里

---

## 二、基本堆内存参数

### 2.1 -Xms 和 -Xmx：堆大小的「保底」与「上限」

```bash
# 初始堆大小（minimum）
-Xms4g

# 最大堆大小（maximum）
-Xmx4g
```

**关键区别**：
- `-Xms` 是 JVM 启动时申请的堆内存大小
- `-Xmx` 是堆内存可以达到的最大值

当 `-Xms` < `-Xmx` 时，JVM 会根据需要动态调整堆大小，这个过程叫**堆扩容/缩容**。

### 为什么要让 -Xms 和 -Xmx 相等？

生产环境中的**最佳实践**是将两者设置为相同的值，原因如下：

1. **避免堆抖动**：动态扩容会带来额外的系统调用和内存碎片
2. **减少 GC 压力**：扩容时可能触发额外的 GC
3. **可预测性**：内存使用变得可预测，便于监控和容量规划

> 堆抖动（Heap Thrashing）是指堆内存反复扩容缩容，导致频繁 GC，系统大部分时间都在进行垃圾回收而非实际业务处理。

### 2.2 -Xmn：年轻代大小

```bash
# 设置年轻代大小为 256MB
-Xmn256m
```

年轻代大小直接影响 GC 的频率和持续时间：

- **年轻代越大**：Minor GC 频率降低，但每次 Minor GC 时间可能增加
- **年轻代越小**：Minor GC 频率增加，但老年代空间压力增大，可能导致 Full GC 增多

### 2.3 -XX:NewRatio：年轻代与老年代的比率

```bash
# 设置老年代:年轻代 = 2:1，即年轻代占堆的 1/3
-XX:NewRatio=2

# JDK 8 默认值是 2，意味着年轻代:老年代 = 1:2
```

**注意**：`-XX:NewRatio` 和 `-Xmn` 同时指定时，`-Xmn` 优先生效。

```bash
# 这个配置中，-Xmn256m 优先生效
-Xmn256m -XX:NewRatio=2
# 最终年轻代 = 256m，老年代自动计算
```

### 2.4 -XX:NewSize 和 -XX:MaxNewSize：年轻代的上下限

```bash
# 年轻代最小值
-XX:NewSize=128m

# 年轻代最大值
-XX:MaxNewSize=512m
```

这对参数允许年轻代在指定范围内动态调整，比单一的 `-Xmn` 更灵活。

---

## 三、Survivor 区参数

Survivor 区是年轻代中最容易被忽视的区域，但它对 GC 效果有重要影响。

### 3.1 -XX:SurvivorRatio：Eden 与 Survivor 的比率

```bash
# 设置 Eden:Survivor = 8:1（每个 Survivor 占年轻代的 1/10）
# JVM 默认值是 8
-XX:SurvivorRatio=8
```

年轻代的默认布局：`Eden : S0 : S1 = 8 : 1 : 1`

```bash
# 年轻代总大小 256MB 时的分布
-Xmn256m -XX:SurvivorRatio=8
# Eden = 204MB，S0 = 26MB，S1 = 26MB
```

### 为什么要两个 Survivor 区？

两个 Survivor 区（S0 和 S1）交替使用，确保在 Minor GC 后有足够的空间进行对象复制：

1. 对象在 Eden + 正在使用的 Survivor 区分配
2. Minor GC 时，存活对象复制到另一个 Survivor 区
3. 两个 Survivor 区角色互换

### 3.2 -XX:InitialSurvivorRatio 和 -XX:MinSurvivorRatio

```bash
# 初始 Survivor 区比率
-XX:InitialSurvivorRatio=8

# 最小 Survivor 区比率
-XX:MinSurvivorRatio=3
```

当 Survivor 区利用率持续低于最小比率时，JVM 可能缩减 Survivor 区空间。

### 3.3 -XX:+UseAdaptiveSizePolicy：自适应大小策略

JDK 8 默认开启此策略，JVM 会自动调整各代大小：

```bash
# 开启（默认）
-XX:+UseAdaptiveSizePolicy

# 关闭（需要手动调优时使用）
-XX:-UseAdaptiveSizePolicy
```

---

## 四、大对象参数

### 4.1 -XX:PretenureSizeThreshold：大对象直接进入老年代

```bash
# 超过 1MB 的对象直接在老年代分配
-XX:PretenureSizeThreshold=1m
```

**使用场景**：
- 已知某些大对象生命周期很长，直接进老年代避免在年轻代反复复制
- 避免大对象在 Survivor 区反复复制消耗性能

### 4.2 -XX:MaxTenuringThreshold：对象晋升年龄阈值

```bash
# 对象经过多少次 Minor GC 后晋升到老年代
-XX:MaxTenuringThreshold=15
```

JDK 8 默认值是 15（对应对象头中的 4 bits）。但实际晋升年龄还受 Survivor 区占用情况影响。

```java
// 晋升年龄的动态调整
if (Survivor 区使用率超过 TargetSurvivorRatio) {
    // 降低晋升年龄阈值，加快对象晋升
    target_age = MIN(MaxTenuringThreshold, age_of_youngest_object + 1);
}
```

### 4.3 -XX:TargetSurvivorRatio：Survivor 区目标使用率

```bash
# Survivor 区使用率达到 50% 时，调整晋升年龄
-XX:TargetSurvivorRatio=50
```

---

## 五、典型配置示例

### 5.1 小内存应用（堆 512MB）

```bash
-Xms512m -Xmx512m \
-XX:NewRatio=2 \
-XX:SurvivorRatio=8
# 年轻代 ≈ 170MB（512/3），Eden ≈ 136MB，每个 Survivor ≈ 17MB
```

### 5.2 中等内存应用（堆 4GB）

```bash
-Xms4g -Xmx4g \
-Xmn2g \
-XX:SurvivorRatio=8 \
-XX:MaxTenuringThreshold=15 \
-XX:+UseAdaptiveSizePolicy
# 年轻代固定 2GB，Eden = 1.6GB，S0 = S1 = 200MB
```

### 5.3 大内存应用（堆 32GB，G1）

```bash
-Xms32g -Xmx32g \
-XX:NewRatio=2 \
-XX:SurvivorRatio=8 \
-XX:PretenureSizeThreshold=2m
```

> G1 收集器下，对象不一定严格按照这个比率分布，因为 G1 以 Region 为单位管理内存。

---

## 六、内存占用估算

### 6.1 最小堆内存估算公式

应用正常运行需要的最小堆内存 ≈ 活跃对象大小 × (1 + 增长系数 + GC 预留空间)

```bash
# 假设活跃对象 2GB，增长系数 20%，GC 预留 30%
最小堆 ≈ 2GB × 1.5 = 3GB
```

### 6.2 年轻代大小估算

根据 Minor GC 频率和对象晋升率来调整：

- 如果 Minor GC 频率太高 → 增大年轻代
- 如果对象晋升太快导致 Full GC → 减小年轻代或调整晋升阈值

---

## 七、监控与调优建议

### 7.1 通过 GC 日志观察

开启 GC 日志，观察各代内存使用情况：

```bash
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:gc.log
```

### 7.2 调优原则

1. **先稳定再优化**：确保 -Xms = -Xmx，避免堆抖动
2. **监控优先**：根据 GC 日志和监控数据调整，而非盲目尝试
3. **渐进式调整**：每次只改一个参数，观察效果
4. **留有余量**：堆内存不要设置得太紧，建议预留 10-20% 的 buffer

---

## 总结

堆内存参数的核心要点：

1. **-Xms/-Xmx**：设置堆大小的下限和上限，生产环境建议相等
2. **-Xmn/-XX:NewRatio**：控制年轻代大小
3. **-XX:SurvivorRatio**：控制 Eden 与 Survivor 的比例
4. **-XX:PretenureSizeThreshold**：大对象直接进老年代
5. **-XX:MaxTenuringThreshold**：控制对象晋升年龄

---

## 思考题

如果你的应用 Minor GC 很频繁（比如每分钟几十次），但 Full GC 很少，你会如何调整堆内存参数？

提示：考虑是年轻代太小，还是 Eden 与 Survivor 的比例不合理，或者晋升年龄设置不当。
