# JVM 参数分类：标准参数、非标准参数、高级选项

你有没有遇到过这种情况：线上服务器 OOM 了，你想去调整 JVM 参数优化一下，结果对着满屏的参数一脸懵。

`-Xms`、`-Xmx`、`-XX:+UseG1GC`、`-XX:NewRatio`……这些参数到底有什么区别？什么时候该用哪个？

别急，今天我们就来彻底搞清楚 JVM 参数的分类体系。

---

## 一、JVM 参数的三层分类

JVM 参数可以分为三大类，从稳定到不稳定，从标准到非标准：

| 分类 | 前缀 | 稳定性 | 兼容性保证 | 示例 |
|-----|-----|-------|-----------|-----|
| **标准参数** | `-` | 高 | 始终兼容 | `-version`、`-help` |
| **非标准参数** | `-X` | 中 | 可能变更 | `-Xms`、`-Xmx` |
| **高级选项** | `-XX` | 低 | 不保证兼容 | `-XX:+UseG1GC` |

### 1.1 标准参数（Standard Options）

以单个 `-` 开头，这类参数是最稳定的，跨 JDK 版本基本保持兼容。

```bash
# 查看 Java 版本
java -version

# 查看所有标准参数
java -help

# 设置运行目录
java -Dapp.home=/opt/app -jar application.jar

# 设置类路径
java -cp /lib/*:./classes MainClass
```

标准参数的特点：**无论如何都不会出问题**，是 JVM 的「基础设施」。

### 1.2 非标准参数（Non-Standard Options）

以 `-X` 开头，主要用于控制 JVM 的运行时行为，比如内存大小、编译模式等。

```bash
# 堆内存初始大小
-Xms512m

# 堆内存最大大小
-Xmx2048m

# 线程栈大小
-Xss1m

# 年轻代大小
-Xmn256m

# 初始年轻代/老年代比例（JDK 7 及之前有效）
-Xmn256m -Xmn1024m -Xratio=2

# 禁用类共享（JDK 8 移除）
-Xshare:off

# 启用类共享（JDK 8 已移除）
-Xshare:auto
```

> 注意：JDK 8 移除了永久代（PermGen），部分旧参数如 `-XX:PermSize` 已经失效。

### 1.3 高级选项（Advanced Options）

以 `-XX` 开头，用于更细粒度的 JVM 调优。这类参数稳定性最低，可能在 JDK 版本升级时发生变化甚至被移除。

高级选项又分为两种形式：

```bash
# 布尔类型：+ 表示开启，- 表示关闭
-XX:+UseG1GC        # 启用 G1 垃圾收集器
-XX:-UseConcMarkSweepGC  # 禁用 CMS 垃圾收集器

# 键值类型：= 赋值
-XX:MaxGCPauseMillis=200  # 最大 GC 暂停时间目标（毫秒）
-XX:G1HeapRegionSize=4m   # G1 区域大小
```

---

## 二、如何查看所有 JVM 参数

### 2.1 查看当前 JVM 支持的参数

```bash
# 查看所有标准参数
java -help

# 查看所有非标准和高级选项
java -X

# 查看所有高级选项（非常长！）
java -XX:+PrintFlagsFinal -version
```

### 2.2 理解参数的输出格式

`java -XX:+PrintFlagsFinal` 的输出包含几列关键信息：

```bash
$ java -XX:+PrintFlagsFinal -version 2>&1 | head -20
[Global flags]
      bool UseG1GC                          = false            {product}
      bool UseSerialGC                      = false            {product}
      intx G1HeapRegionSize                 = 1048576          {product}
     size MaxGCPauseMillis                  = 4294967295       {product}
```

列的含义：
- `bool` / `intx` / `size`：参数类型
- `=` 后的值：当前默认值
- `{}` 里的值：参数的类别（`product`、`manageable`、`develop` 等）

参数类别说明：

| 类别 | 说明 | 生产环境可用性 |
|-----|-----|--------------|
| `product` | 正式发布的参数 | 推荐使用 |
| `manageable` | 可运行时修改 | 可用于生产调优 |
| `develop` | 开发阶段参数 | 仅开发调试用 |
| `diagnostic` | 诊断用参数 | 需要加 `-XX:+UnlockDiagnosticVMOptions` 才能使用 |

### 2.3 查看特定参数的当前值

```bash
# 使用 jinfo 查看某个进程的实际参数
jinfo -flag MaxHeapSize <pid>

# 查看所有参数
jinfo -flags <pid>
```

---

## 三、参数的优先级与覆盖关系

当存在冲突的参数时，JVM 按以下优先级生效（高优先级覆盖低优先级）：

```
命令行参数 > 环境变量 > 配置文件 > 默认值
```

```bash
# 命令行直接指定
java -Xmx4g -XX:MaxMetaspaceSize=512m -jar app.jar

# 等效的环境变量（通过 JAVA_TOOL_OPTIONS）
export JAVA_TOOL_OPTIONS="-Xmx4g -XX:MaxMetaspaceSize=512m"
```

> 实际生产中，**推荐通过命令行参数直接指定**，不要依赖环境变量——环境变量容易被其他进程或脚本覆盖。

---

## 四、常见参数组合示例

### 4.1 最小化配置（开发环境）

```bash
java -Xms256m -Xmx512m -jar application.jar
```

### 4.2 生产环境标准配置

```bash
java \
  -Xms4g -Xmx4g \                    # 固定堆大小，避免动态扩容
  -Xmn2g \                           # 年轻代大小（可选）
  -XX:MetaspaceSize=256m \           # 元空间初始大小
  -XX:MaxMetaspaceSize=512m \        # 元空间最大大小
  -XX:+UseG1GC \                    # 使用 G1 收集器
  -XX:MaxGCPauseMillis=200 \        # 最大 GC 暂停目标
  -XX:+PrintGCDetails \             # 打印详细 GC 日志
  -XX:+PrintGCDateStamps \          # GC 日志带时间戳
  -Xlog:gc*:file=gc.log \           # JDK 9+ 日志格式
  -jar application.jar
```

### 4.3 低延迟配置（G1 + ZGC 对比）

```bash
# G1 配置（平衡型）
java -XX:+UseG1GC -XX:MaxGCPauseMillis=100 -XX:G1HeapRegionSize=16m

# ZGC 配置（超低延迟）
java -XX:+UseZGC -XX:MaxGCPauseMillis=10 -XX:+ZProactive
```

---

## 五、参数命名约定

理解参数命名约定，可以帮助你「望名知意」：

| 前缀/模式 | 含义 | 示例 |
|----------|-----|-----|
| `-XX:+UseXXX` | 启用某个特性 | `-XX:+UseStringDeduplication` |
| `-XX:-UseXXX` | 禁用某个特性 | `-XX:-UseAdaptiveSizePolicy` |
| `NewSize` / `MaxNewSize` | 年轻代尺寸 | `-XX:NewSize=512m` |
| `OldSize` | 老年代尺寸 | `-XX:OldSize=2g` |
| `Ratio` | 比例关系 | `-XX:NewRatio=2` 表示年轻代:老年代=1:2 |
| `Size` | 大小 | `-XX:G1HeapRegionSize=4m` |
| `Threshold` | 阈值 | `-XX:G1HeapWastePercent=5` |
| `Percent` | 百分比 | `-XX:InitiatingHeapOccupancyPercent=45` |

---

## 总结

今天我们了解了 JVM 参数的三层分类体系：

1. **标准参数（`-`）**：最稳定，跨版本兼容
2. **非标准参数（`-X`）**：中等稳定，控制内存和运行时行为
3. **高级选项（`-XX`）**：细粒度调优，稳定性最低

下一节，我们深入讲解堆内存相关的参数配置。

---

## 思考题

面试中经常被问到：**-Xms 和 -Xmx 设置成一样有什么好处？**

提示：考虑内存动态扩容的开销，以及对内存碎片的影响。结合生产环境中「内存抖动」的问题来思考。
