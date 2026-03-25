# 直接内存：堆外内存与 NIO 高性能秘密

你可能见过这样的报错：

```
java.lang.OutOfMemoryError: Direct buffer memory
```

也可能在监控工具里看到 JVM 进程的实际物理内存占用，比 `-Xmx` 设置的堆内存大了不少。

这些多出来的内存，就是**直接内存**（Direct Memory），也叫**堆外内存**（Off-Heap Memory）。

---

## 什么是直接内存？

直接内存不是 JVM 堆的一部分，而是**直接向操作系统申请的内存**，位于本地内存（Native Memory）中。

```java
// 堆内内存：JVM 堆中分配
ByteBuffer heapBuffer = ByteBuffer.allocate(1024);

// 直接内存：堆外内存，OS 直接分配
ByteBuffer directBuffer = ByteBuffer.allocateDirect(1024);
```

`allocateDirect()` 创建的 `DirectByteBuffer`，底层调用的是 `unsafe.allocateMemory()`，直接在本地内存中分配。

---

## 为什么需要直接内存？

### 传统 I/O 的两次拷贝

以文件读取为例，传统 BIO 的数据流：

```
磁盘 → 内核缓冲区 → 用户缓冲区（JVM 堆）→ 应用程序
         ↑                            ↑
      第一次拷贝                   第二次拷贝
```

数据需要经历：
1. **内核态到用户态的拷贝**：数据从内核缓冲区复制到 JVM 堆
2. **GC 压力**：JVM 堆中的缓冲区会被 GC 管理

### NIO 的零拷贝优化

使用直接内存后：

```
磁盘 → 内核缓冲区 → 直接内存（Socket Buffer）→ 网络
                    ↑
                 无需拷贝
```

数据路径变成：
1. 内核缓冲区 → **直接内存**：一次 DMA 拷贝
2. 直接内存 → **Socket Buffer**：由操作系统直接完成，无需经过 JVM

**核心优势**：
- 减少一次内存拷贝
- 减少 GC 压力（不受 JVM 堆管理）
- 在频繁 I/O 场景下显著提升性能

---

## 直接内存的内部结构

`DirectByteBuffer` 的结构：

```java
public class DirectByteBuffer extends MappedByteBuffer {

    // 堆内持有引用（弱引用，不影响 GC）
    private final Cleaner cleaner;

    // 本地内存地址
    private final long address;

    // 容量
    private final int capacity;
}
```

关键点：
- `DirectByteBuffer` 对象本身在 JVM 堆中（只有几十字节）
- 实际数据存储在本地内存中
- 持有 `Cleaner`，用于 GC 时释放本地内存

---

## 直接内存与本地 I/O

### 文件复制示例

```java
public class DirectMemoryDemo {

    // 传统方式：使用堆内缓冲区
    public void copyWithHeapBuffer(String src, String dest) throws IOException {
        try (InputStream in = new FileInputStream(src);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) != -1) {
                out.write(buffer, 0, len);
            }
        }
    }

    // 高性能方式：使用直接内存
    public void copyWithDirectBuffer(String src, String dest) throws IOException {
        try (FileChannel in = FileChannel.open(Path.of(src), StandardOpenOption.READ);
             FileChannel out = FileChannel.open(Path.of(dest),
                 StandardOpenOption.WRITE, StandardOpenOption.CREATE)) {
            // 传输到直接内存
            long size = in.size();
            long transferred = 0;
            while (transferred < size) {
                transferred += in.transferTo(transferred, size - transferred, out);
            }
        }
    }
}
```

`FileChannel.transferTo()` 内部会利用操作系统的零拷贝机制，在支持 `sendfile()` 的系统上实现高效传输。

---

## 直接内存的配置与限制

### JVM 参数

| 参数 | 说明 | 默认值 |
|-----|------|-------|
| `-XX:MaxDirectMemorySize` | 直接内存最大容量 | 等于 `-Xmx`（Java 10+ 行为）|
| `-XX:+UseDirectMemoryNotification` | 启用直接内存通知（JDK 10+）| |

```bash
# 设置直接内存最大 512MB
java -XX:MaxDirectMemorySize=512m -Xmx2g your.Application
```

### 监控直接内存

```bash
# 查看 JVM 进程的直接内存使用
jcmd <pid> VM.native_memory summary

# 使用 NMT（Native Memory Tracking）
java -XX:NativeMemoryTracking=summary -XX:MaxDirectMemorySize=512m your.Application
```

---

## 直接内存的 GC 回收

`DirectByteBuffer` 对象本身会被 GC 回收，但本地内存的释放依赖 `Cleaner` 机制：

```java
// Cleaner 的创建
cleaner = Cleaner.create(this, new Deallocator(address, capacity, cap));
```

当 `DirectByteBuffer` 被 GC 回收后，`Cleaner` 会被加入 ReferenceQueue，**后台线程**会异步调用 `Deallocator` 释放本地内存。

这意味着：
- 本地内存释放**不是同步**的，有延迟
- 高并发场景下可能出现本地内存还没释放，但已达上限的情况

---

## 常见 OOM 原因分析

### 场景 1：NIO 使用不当

```java
// 错误示例：频繁创建直接缓冲区
while (processing) {
    ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);  // 1MB
    // 处理...
}
// 每次循环创建 1MB 直接内存，没有及时释放
```

**正确做法**：复用 `DirectByteBuffer`

```java
// 复用缓冲区
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
while (processing) {
    buffer.clear();  // 复用而非重新分配
    // 处理...
}
```

### 场景 2：Netty 堆外内存泄漏

Netty 默认使用直接内存，如果不正确释放 `ByteBuf`，会导致堆外内存泄漏：

```java
// 错误：没有释放 ByteBuf
public void handle(ByteBuf buf) {
    // 业务处理...
    // 忘记调用 buf.release()
}

// 正确：try-with-resources 或手动释放
public void handle(ByteBuf buf) {
    try {
        // 业务处理...
    } finally {
        buf.release();
    }
}
```

---

## 直接内存 vs 堆内内存对比

| 特性 | 直接内存 | 堆内内存 |
|-----|---------|---------|
| 分配位置 | 本地内存（OS） | JVM 堆 |
| 分配速度 | 较慢 | 快（JVM 优化） |
| I/O 性能 | 高（零拷贝） | 低（多次拷贝） |
| GC 影响 | 无 | 有（Stop The World） |
| 控制方式 | `-XX:MaxDirectMemorySize` | `-Xmx` |
| 内存溢出表现 | `Direct buffer memory` | `Java heap space` |

---

## 使用场景建议

### 适合使用直接内存的场景

- 高并发网络 I/O（Netty、RPC 框架）
- 大文件传输
- 频繁的磁盘读写
- 需要减少 GC 频率的大缓存

### 不适合的场景

- 小数据量、低频 I/O（开销大于收益）
- 需要频繁创建/销毁的小缓冲区
- 内存资源有限的容器环境

---

## 面试追问方向

- 直接内存的 `allocateDirect()` 底层是怎么实现的？
- `DirectByteBuffer` 的 `Cleaner` 是如何工作的？为什么需要额外线程释放内存？
- JDK 14 引入的 `MemoryPoolMXBean` 能否监控直接内存？
- 在容器环境（Docker/K8s）下，直接内存和 JVM 堆内存如何协调？
