# Serial：单线程王者，Client 模式的默认收集器

Serial，一个听起来「古老」的名字，却是 JVM 最早的垃圾收集器。

它只用一条线程，Stop The World，却在一些场景下表现出人意料的好效果。

---

## Serial 的工作原理

### 核心特点

```
┌─────────────────────────────────────────────────────────────┐
│                      Serial 收集器                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  单线程执行                                                  │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Stop The World                          │   │
│  │                                                      │   │
│  │    用户线程 ──全部暂停──► ████████████               │   │
│  │                       ↑                              │   │
│  │                  Serial 开始工作                     │   │
│  │                       ↓                              │   │
│  │         用户线程 ◄──继续执行──████████████           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  复制算法（年轻代）                                         │
│  标记-整理算法（老年代）                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 年轻代 Serial 收集流程

```java
public class SerialYoungGC {

    // Serial 年轻代收集 = 复制算法
    // 过程：Eden + From Survivor → To Survivor

    public void gc() {
        // 1. 标记：从 GC Roots 出发，标记存活对象
        mark();

        // 2. 复制：将存活对象复制到 To Survivor 区
        copy();

        // 3. 清理：清空 Eden 和 From Survivor
        clear();

        // 4. 交换：From Survivor ↔ To Survivor
        swap();
    }

    // 复制算法示意
    private void copy() {
        // To Survivor 区是空的
        // Eden + From Survivor 的存活对象 → To Survivor
        // 年龄 +1
        // 超过阈值的对象 → 老年代
    }
}
```

### 老年代 Serial Old 收集流程

```java
public class SerialOldGC {

    // Serial Old 收集 = 标记-整理算法
    // 用于 Full GC 或老年代收集

    public void gc() {
        // 1. 标记：从 GC Roots 出发，标记存活对象
        mark();

        // 2. 整理：将存活对象向一端移动
        compact();

        // 3. 清理：清空边界外的区域
        clear();
    }
}
```

---

## 适用场景

### Serial 的优势

| 优势 | 说明 |
|-----|------|
| 无线程切换开销 | 单线程执行，无需同步 |
| 简单高效 | 算法简单，无额外开销 |
| 内存占用低 | 无需维护线程上下文 |

### 为什么 Serial 在某些场景下反而更快？

```
场景：小型堆（如 100MB）+ 少量对象

┌─────────────────────────────────────────────────────────────┐
│  串行 vs 并行：谁更快？                                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  并行收集的开销：                                            │
│  - 线程创建和销毁                                           │
│  - 线程同步（CAS）                                          │
│  - 线程上下文切换                                           │
│                                                              │
│  当堆很小、对象很少时：                                      │
│  - GC 时间本身就很短（可能 < 10ms）                         │
│  - 并行开销可能比 GC 时间还长！                             │
│                                                              │
│  结论：小堆场景下，Serial 反而可能更快                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 实际测试数据

```java
// 测试场景：小内存应用
// 配置：-Xmx64m -Xms64m
// 负载：每秒创建 1000 个对象，存活率 5%

/*
Serial:      GC 停顿 ~5ms
ParNew:      GC 停顿 ~8ms  (包含线程开销)
Parallel:    GC 停顿 ~10ms (吞吐量优先，但停顿不优化)

结论：小内存下，Serial 完胜
*/
```

---

## JVM 参数配置

```bash
# 启用 Serial + Serial Old 组合
java -XX:+UseSerialGC your.Application

# 年轻代参数
-XX:NewSize=64m        # 年轻代初始大小
-XX:MaxNewSize=64m     # 年轻代最大大小
-XX:SurvivorRatio=8    # Eden : Survivor = 8 : 1

# 老年代参数
-XX:OldSize=128m       # 老年代初始大小
-XX:MaxTenuringThreshold=15  # 晋升年龄阈值
```

---

## 监控与排查

### GC 日志解读

```bash
# 开启 GC 日志
java -XX:+UseSerialGC \
     -XX:+PrintGCDetails \
     -XX:+PrintGCDateStamps \
     -Xloggc:gc.log \
     your.Application
```

```text
# Serial 年轻代 GC 日志
2024-01-15T10:30:00.123+0800: [GC (Allocation Failure)
 Before GC:
   def new generation   total 57600K, used 54000K [...]
   eden space 51200K,   96% used
   from space 6400K,    0% used
   to   space 6400K,    0% used
 After GC:
   def new generation   total 57600K, used 6400K
   eden space 51200K,   0% used
   from space 6400K,    100% used
   to   space 6400K,    0% used
 [Times: user=0.01 sys=0.00, real=0.02 secs]
 # user=0.01: 用户态 CPU 时间
 # sys=0.00:  内核态 CPU 时间
 # real=0.02: 实际停顿时间

# Serial 老年代 Full GC 日志
2024-01-15T10:30:05.456+0800: [Full GC (Allocation Failure)
 Before GC:
   tenured generation   total 175104K, used 150000K
 After GC:
   tenured generation   total 175104K, used 80000K
 [Times: user=0.15 sys=0.00, real=0.18 secs]
```

### jstat 监控

```bash
# 监控 Serial GC
jstat -gcutil <pid> 1000

# 输出示例
S0C    S1C    S0U    S1U      EC       EU        OC         OU       YGC     YGCT    FGC    FGCT     GCT
6400.0 6400.0  0.0   6400.0 51200.0  32000.0  175104.0   80000.0    150    2.500  5      0.900   3.400

# YGC: Young GC 次数
# FGC: Full GC 次数
# YGCT: Young GC 总时间
# FGCT: Full GC 总时间
```

---

## Serial vs 其他收集器对比

| 收集器 | 线程数 | STW | 吞吐量 | 适用场景 |
|-------|-------|-----|-------|---------|
| Serial | 1 | 长 | 低-中 | 小内存、Client 模式 |
| ParNew | 多 | 中 | 高 | CMS 的年轻代 |
| Parallel Scavenge | 多 | 中 | 最高 | 后台批处理 |
| CMS | 多 | 短（并发）| 高 | 低延迟服务 |
| G1 | 多 | 可控 | 高 | JDK 9+ 通用 |

---

## Serial 的时代意义

Serial 虽然古老，但它的设计理念影响了后续所有收集器：

1. **复制算法**：被 ParNew、Parallel Scavenge 继承
2. **标记-整理**：被 Serial Old、Parallel Old 继承
3. **简单优先**：在某些场景下，简单就是快

> 面试官问：「既然 Serial 这么慢，为什么还要用？」
>
> 回答：「Serial 适合小内存、低并发场景。在容器化和微服务的今天，很多服务的堆内存控制在 512MB 以下，Serial 的单线程开销反而成为优势。」

---

## 面试追问方向

- Serial 是单线程的，为什么还能存活到现在？
- Serial 的「简单高效」在哪些具体场景下体现？
- 复制算法需要两个 Survivor 区，但 Serial 年轻代只用了一个，怎么实现的？
- 在容器环境（Docker）下，Serial 的表现有什么变化？
- 如何判断当前 JVM 是否在使用 Serial？
