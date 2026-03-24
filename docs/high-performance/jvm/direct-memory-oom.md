# 直接内存（堆外内存）溢出排查

线上报警：进程 RSS 内存持续增长，但堆内存使用正常。

等等，堆内存正常怎么会内存不够？

这就是**直接内存（Direct Memory）**溢出的问题。

直接内存（也叫堆外内存）不受 `-Xmx` 参数控制，使用不当会导致进程内存耗尽。

今天，我们就来彻底搞懂直接内存溢出的原因和排查方法。

---

## 一、什么是直接内存？

### 1.1 直接内存 vs 堆内存

| 维度 | 堆内存 | 直接内存 |
|-----|-------|---------|
| **分配方式** | new 对象 | ByteBuffer.allocateDirect() |
| **大小控制** | -Xms/-Xmx | -XX:MaxDirectMemorySize |
| **存储位置** | JVM 堆 | 本地内存（Native Memory）|
| **GC** | 受 GC 管理 | 不受 GC 管理（但会被 Cleaner 释放）|
| **I/O 性能** | 需要复制到内核缓冲区 | 直接写入内核缓冲区，性能更好 |

### 1.2 直接内存的使用场景

1. **NIO 零拷贝**：网络通信、文件传输
2. **Netty**：高性能网络框架，大量使用直接内存
3. **JNI**：本地代码分配的内存
4. **JVM 内部**：代码缓存、Metaspace（也是本地内存）

### 1.3 直接内存相关参数

```bash
# 最大直接内存大小（默认等于堆最大内存）
-XX:MaxDirectMemorySize=4g

# JDK 11+ 可以使用更灵活的配置
-XX:MaxRAM=8g
```

---

## 二、直接内存溢出的原因

### 2.1 常见原因一览

| 原因 | 典型场景 | 表现特征 |
|-----|---------|---------|
| **NIO 分配不当** | ByteBuffer 不释放 | 直接内存持续增长 |
| **Netty 泄漏** | ChannelHandler 未释放 | 连接泄漏导致内存泄漏 |
| **JNI 泄漏** | 本地代码分配内存 | 本地代码问题 |
| **代码缓存过大** | JIT 编译优化 | 代码缓存区膨胀 |
| **MaxDirectMemorySize 太小** | 参数设置不当 | 正常业务触发 OOM |

### 2.2 典型场景分析

**场景 1：Netty Channel 未释放**

```java
// 问题代码
public class MyServerHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        // 处理消息
        // 但没有释放 msg
    }
}
// Netty 中，ByteBuf 必须手动释放，否则导致直接内存泄漏
```

**场景 2：DirectByteBuffer 未释放**

```java
// 问题代码
public void processFile(String path) throws IOException {
    FileInputStream fis = new FileInputStream(path);
    FileChannel channel = fis.getChannel();
    // 分配直接内存
    MappedByteBuffer buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
    // 业务处理...
    // 没有关闭 channel 和 fis
    // MappedByteBuffer 不会被 GC 立即回收
}
```

**场景 3：MaxDirectMemorySize 未设置**

```bash
# 默认 MaxDirectMemorySize = -Xmx
# 如果堆 4GB，直接内存最多 4GB
# 总进程内存可能达到 8GB+（堆 + 直接内存 + Metaspace + JVM 本身）
```

### 2.3 直接内存 OOM 的特点

1. **堆内存正常**：` -Xmx` 设置的堆内存没问题
2. **进程 RSS 持续增长**：操作系统视角的内存使用
3. **jstat 看不到**：jstat 只能看到堆内存
4. **可能导致系统 OOM**：进程耗尽系统内存，被 OOM Killer 杀死

---

## 三、直接内存溢出排查流程

### 3.1 排查步骤

```
1. 确认是直接内存问题（非堆内存）
   ↓
2. 查看进程 RSS 内存
   ↓
3. 分析直接内存使用
   ↓
4. 使用诊断工具定位
   ↓
5. 定位泄漏点
```

### 3.2 确认问题类型

```bash
# 查看进程总内存
ps aux | grep java

# RSS: 实际物理内存使用（包括堆、直接内存、本地内存等）
# VSZ: 虚拟内存大小
```

### 3.3 查看直接内存使用

```bash
# JDK 8 使用 NMT（Native Memory Tracking）
java -XX:NativeMemoryTracking=detail -jar app.jar

# 运行时查看
jcmd <pid> VM.native_memory summary

# 或者
jcmd <pid> VM.native_memory baseline
# 稍后再次查看
jcmd <pid> VM.native_memory summary.diff
```

### 3.4 NMT 输出解读

```
Native Memory Tracking:

Total: reserved=6291456KB, committed=4194304KB

-                 Java Heap (reserved=4194304KB, committed=4194304KB)
                        -> malloc: 4194304KB # 堆内存

-                     Class (reserved=512000KB, committed=256000KB)
                        -> malloc: 256000KB # 元空间

-                    Thread (reserved=51200KB, committed=51200KB)
                        -> malloc: 51200KB # 线程栈

-                      Code (reserved=102400KB, committed=51200KB)
                        -> malloc: 51200KB # 代码缓存

-                        GC (reserved=204800KB, committed=204800KB)
                        -> malloc: 204800KB # GC 相关（堆外）

-                  Internal (reserved=204800KB, committed=102400KB)
                        -> malloc: 102400KB # 直接内存等
```

### 3.5 使用 Arthas 排查

```bash
# Arthas 可以帮助定位直接内存泄漏
# 查看内存使用
dashboard -d 1

# 查找 DirectByteBuffer
sc -d java.nio.DirectByteBuffer

# 查看类加载器
classloader
```

---

## 四、典型案例分析与解决

### 4.1 案例一：Netty 直接内存泄漏

**问题**：

```
进程 RSS 持续增长，堆内存正常，直接内存泄漏
```

**排查步骤**：

1. 使用 NMT 查看直接内存分配
2. 使用 Arthas 查找未释放的 Channel
3. 查看 ChannelHandler 代码

**解决方案**：

```java
// 问题代码
public class MyHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        // 处理消息
        // 问题：没有释放 msg
    }
}

// 解决后
public class MyHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        try {
            // 处理消息
        } finally {
            // 必须释放 ByteBuf
            ReferenceCountUtil.release(msg);
        }
    }
}
```

### 4.2 案例二：JVM 代码缓存过大

**问题**：

```
代码缓存占用过多内存
```

**排查**：

```bash
# NMT 显示 Code 占用很大
jcmd <pid> VM.native_memory
```

**解决方案**：

```bash
# 减小代码缓存
-XX:ReservedCodeCacheSize=128m

# JDK 9+
-XX:InitialCodeCacheSize=8m -XX:ReservedCodeCacheSize=128m
```

### 4.3 案例三：NIO FileChannel 未关闭

**问题**：

```
MappedByteBuffer 未释放
```

**排查**：

```bash
# 使用 Arthas 查找
sc -d java.nio.channels.FileChannel
sc -d java.nio.MappedByteBuffer
```

**解决方案**：

```java
// 正确关闭
public void processFile(String path) throws IOException {
    try (FileInputStream fis = new FileInputStream(path);
         FileChannel channel = fis.getChannel()) {
        MappedByteBuffer buffer = channel.map(...);
        // 处理...
    } // 自动关闭
}

// 或者主动释放
public void releaseBuffer(MappedByteBuffer buffer) {
    // 反射调用 Cleaner
    try {
        Field cleanerField = buffer.getClass().getDeclaredField("cleaner");
        cleanerField.setAccessible(true);
        Cleaner cleaner = (Cleaner) cleanerField.get(buffer);
        if (cleaner != null) {
            cleaner.clean();
        }
    } catch (Exception e) {
        // ...
    }
}
```

---

## 五、预防措施

### 5.1 参数配置

```bash
# 设置直接内存上限
-XX:MaxDirectMemorySize=2g

# 限制代码缓存
-XX:ReservedCodeCacheSize=256m
```

### 5.2 代码规范

1. **Netty ByteBuf 必须释放**
2. **FileChannel 要正确关闭**
3. **使用 try-with-resources**
4. **避免直接分配大内存**

### 5.3 监控配置

```yaml
# 监控进程 RSS 内存
- alert: ProcessMemoryHigh
  expr: process_resident_memory_bytes{job="myapp"} / 1024 / 1024 > 8192
  annotations:
    summary: "进程 RSS 超过 8GB"
```

---

## 六、诊断工具对比

| 工具 | 用途 | 特点 |
|-----|-----|-----|
| NMT | JVM 本地内存跟踪 | JDK 内置，需开启 |
| Arthas | 在线诊断 | 功能丰富 |
| pmap | 系统层内存分析 | 查看进程内存映射 |
| valgrind | 内存泄漏检测 | 重量级，深度分析 |
| async-profiler | 内存分配分析 | 可追踪 allocations |

---

## 总结

直接内存溢出的排查要点：

1. **理解直接内存**：不受 -Xmx 控制，使用本地内存
2. **使用 NMT**：Native Memory Tracking 是关键工具
3. **关注进程 RSS**：堆内存正常不代表没问题
4. **代码规范**：Netty ByteBuf、FileChannel 要正确释放
5. **设置上限**：MaxDirectMemorySize 防止失控

---

## 思考题

堆内存使用正常，GC 也很健康，但进程 RSS 持续增长。这种情况最可能的原因是什么？

提示：考虑本地内存的使用，包括直接内存、Metaspace、代码缓存等。
