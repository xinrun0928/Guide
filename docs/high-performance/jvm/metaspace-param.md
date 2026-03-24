# 元空间参数：-XX:MetaspaceSize、-XX:MaxMetaspaceSize

你有没有遇到过这种错误：

```
java.lang.OutOfMemoryError: Metaspace
```

堆内存明明还有空余，怎么就 OOM 了？

这是因为从 JDK 8 开始，JVM 把**永久代（PermGen）换成了元空间（Metaspace）**，而元空间使用的是**本地内存（Native Memory）**，不受 JVM 堆大小限制。

今天，我们就来彻底搞清楚元空间参数的配置方法。

---

## 一、PermGen vs Metaspace：一场内存革命

### 1.1 永久代的问题

JDK 7 及之前的 PermGen（永久代）有几个致命问题：

1. **固定大小**：必须在启动时指定，无法动态调整
2. **容易溢出**：类加载过多时容易 OOM
3. **内存碎片**：Full GC 时压缩效率低

### 1.2 元空间的解决方案

JDK 8 引入了 Metaspace（元空间），彻底解决了这些问题：

| 特性 | PermGen | Metaspace |
|-----|--------|-----------|
| 位置 | JVM 堆内存 | 本地内存（Native Memory） |
| 大小 | 固定，启动时指定 | 动态，可增长 |
| 溢出条件 | 空间不足 | 可用本地内存耗尽 |
| 类加载器 | 影响永久代大小 | 独立的 ClassLoader 区域 |
| GC | 触发 Full GC 才回收 | 满足条件时自动回收 |

### 1.3 元空间包含的内容

元空间存储了 JVM 运行时的**类元数据**：

- 类的结构信息（字段、方法、构造方法）
- 类的继承关系
- 类的修饰符（public、final 等）
- 常量池
- 方法字节码
- 编译后的代码缓存
- 符号表
- 动态生成的类（如动态代理、CGLIB 生成的类）

---

## 二、元空间参数详解

### 2.1 -XX:MetaspaceSize：初始元空间大小

```bash
# 设置元空间初始大小
-XX:MetaspaceSize=256m
```

**关键点**：这个参数既是初始大小，也是**触发第一次 Full GC（Metadata GC Threshold）**的阈值。

当元空间使用达到此值时，JVM 会触发一次 Full GC 来清理未使用的类加载器。

### 2.2 -XX:MaxMetaspaceSize：最大元空间大小

```bash
# 设置元空间最大大小（默认无限制）
-XX:MaxMetaspaceSize=512m
```

**为什么要限制？**

虽然元空间使用本地内存，但本地内存并不是无限的。如果不设置上限，可能导致：

1. **交换区（Swap）耗尽**：系统开始使用磁盘交换，性能暴跌
2. **本地内存泄漏**：类加载器泄漏导致元空间无限增长
3. **影响其他进程**：吃光本地内存，影响同一台机器上的其他服务

> 生产环境**强烈建议**设置此参数，防止元空间失控影响整台机器。

### 2.3 -XX:MinMetaspaceFreeRatio 和 -XX:MaxMetaspaceFreeRatio

```bash
# GC 后，元空间最小空闲比例，默认 40
-XX:MinMetaspaceFreeRatio=40

# GC 后，元空间最大空闲比例，默认 70
-XX:MaxMetaspaceFreeRatio=70
```

这些参数控制元空间的**动态调整策略**：

- GC 后，如果空闲比例 < 40%，JVM 会增加元空间大小
- GC 后，如果空闲比例 > 70%，JVM 会减少元空间大小

---

## 三、CompressedClassSpaceSize：类指针压缩空间

### 3.1 什么是类指针压缩？

JDK 8 引入了**压缩类指针（Compressed Class Pointers）**来优化元空间的使用：

- 每个类元数据包含一个指向 Klass 结构体的指针
- 在 64 位 JVM 中，这个指针默认使用 32 位（CompressedKlassPointerSize=32）
- 这允许 JVM 使用更少的空间存储类信息

### 3.2 相关参数

```bash
# 压缩类指针空间大小（JDK 8 默认 1GB）
-XX:CompressedClassSpaceSize=1g
```

**注意**：这个参数只有在以下条件同时满足时才生效：

1. JVM 是 64 位
2. 启用了类指针压缩（默认开启）
3. 堆内存小于 32GB（超过 32GB 后自动禁用）

### 3.3 类指针压缩的边界

如果类数量接近 CompressedClassSpaceSize 设置的上限，可能导致：

```
java.lang.OutOfMemoryError: Compressed class space
```

这种情况通常发生在：

1. **动态类加载过多**：大量使用动态代理、CGLIB、字节码生成
2. **类加载器泄漏**：自定义类加载器没有正确释放
3. **OSGi 框架**：OSGi 框架会创建大量类加载器

---

## 四、高频问题：Metaspace 为什么会 OOM？

### 4.1 元空间 OOM 的常见原因

1. **类加载器泄漏**

最常见的原因。常见于：
- 应用服务器（Tomcat、WildFly 等）反复部署应用
- 自定义类加载器未正确关闭
- 大量使用动态代理或字节码生成

```java
// 问题代码：每次调用都创建新的类加载器
public ClassLoader createNewClassLoader() {
    URL[] urls = {new File("lib/").toURI().toURL()};
    return new URLClassLoader(urls, getClass().getClassLoader());
    // 如果不调用 close() 或保持引用，会导致类加载器泄漏
}
```

2. **大量生成动态类**
- Spring AOP、CGLIB 代理
- JAXB、JAX-WS 运行时注解处理
- 大数据框架（Spark、Hive 等）
- JSP 编译产生的 servlet 类

3. **MetaspaceSize 设置过小**

初始值设置得过小，会导致频繁触发 Full GC 清理元空间，影响性能。

### 4.2 如何排查元空间 OOM？

```bash
# 1. 开启元空间 GC 日志
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:gc.log

# JDK 8 及之前
-XX:+TraceClassLoading -XX:+TraceClassUnloading

# JDK 9+ 使用统一日志
-Xlog:class+load=debug,class+unload=trace:file=class.log
```

```bash
# 2. 使用 jstat 查看元空间使用
jstat -gc <pid>

# 输出中 Metaspace 相关列：
# M    - 元空间当前大小
# CCM  - 压缩类空间当前大小
# CCS  - 压缩类空间使用比例
# MC   - 元空间最大大小（如果设置了的话）
# MU   - 元空间使用大小
```

### 4.3 典型场景分析

**场景 1：Tomcat 反复部署导致 OOM**

```bash
# 典型配置
-Xms512m -Xmx512m \
-XX:MetaspaceSize=256m \
-XX:MaxMetaspaceSize=512m \
-XX:+UseG1GC
```

**优化方案**：
1. 增加 MaxMetaspaceSize
2. 排查是否存在类加载器泄漏（检查 Spring 上下文是否正确关闭）
3. 考虑禁用 JSP 缓存

**场景 2：Spring Boot 启动很慢**

可能原因：
- MetaspaceSize 设置过小，频繁触发 Full GC
- 类加载数量远超预期（检查是否有不必要的自动配置）

```bash
# 优化配置
-XX:MetaspaceSize=512m \
-XX:MaxMetaspaceSize=1g
```

---

## 五、元空间调优实战

### 5.1 典型配置

```bash
# 保守配置（适合小应用）
-XX:MetaspaceSize=128m -XX:MaxMetaspaceSize=512m

# 标准配置（适合中等应用）
-XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=1g

# 大型应用配置
-XX:MetaspaceSize=512m -XX:MaxMetaspaceSize=2g \
-XX:CompressedClassSpaceSize=2g

# 激进配置（适合动态类生成场景）
-XX:MetaspaceSize=1g -XX:MaxMetaspaceSize=4g \
-XX:CompressedClassSpaceSize=4g
```

### 5.2 监控命令

```bash
# 查看元空间使用情况（JDK 8）
jstat -gcutil <pid> 1000

# JDK 11+
jcmd <pid> VM.native_memory summary

# 使用 Arthas
dashboard -d 1
# 查看 ClassLoader 统计
classloader
```

### 5.3 调优建议

1. **设置合理的 MaxMetaspaceSize**
   生产环境必须设置，防止元空间无限增长

2. **MetaspaceSize 初始值要足够大**
   避免启动阶段频繁触发 Full GC

3. **监控元空间使用趋势**
   如果持续增长，可能是类加载器泄漏

4. **结合 GC 日志分析**
   观察 Full GC 频率和元空间回收情况

---

## 六、元空间与堆内存的关系

### 6.1 两者的本质区别

| 维度 | 堆内存 | 元空间 |
|-----|-------|--------|
| 物理位置 | JVM 堆（Java Heap） | 本地内存（Native Memory） |
| 存储内容 | Java 对象 | 类元数据 |
| 管理方式 | GC 回收 | 类加载器生命周期 + GC |
| 溢出表现 | java.lang.OutOfMemoryError: Java heap space | java.lang.OutOfMemoryError: Metaspace |

### 6.2 完整配置示例

```bash
# 4核8GB 机器上的标准配置
-Xms4g -Xmx4g \                   # 堆内存 4GB
-XX:MetaspaceSize=512m \          # 元空间初始 512MB
-XX:MaxMetaspaceSize=1g \         # 元空间最大 1GB
-XX:+UseG1GC \                    # 使用 G1 收集器
-XX:MaxGCPauseMillis=200 \        # 最大停顿目标 200ms
-XX:+PrintGCDetails \            # 详细 GC 日志
-Xloggc:gc.log                    # GC 日志文件
```

---

## 总结

元空间调优的核心要点：

1. **理解本质**：元空间使用本地内存，不受堆大小限制
2. **设置上限**：MaxMetaspaceSize 必须设置，防止失控
3. **监控增长**：通过 jstat 监控元空间使用趋势
4. **排查泄漏**：类加载器泄漏是元空间 OOM 的主要原因

下一节，我们来学习 JVM 调试参数的配置。

---

## 思考题

为什么 JDK 8 把 PermGen 换成了 Metaspace？

提示：考虑永久代的固定大小限制、类加载器泄漏问题、以及对 JVM 调优的影响。
