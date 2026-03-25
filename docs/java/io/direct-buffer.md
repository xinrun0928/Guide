# 直接内存（Direct Buffer）：高性能 IO 的秘密武器

你的服务器内存 16GB，JVM 堆分配了 8GB。

但运行一段时间后，突然 OOM 了。

奇怪，明明堆内存还有 3GB 没用，怎么就崩了？

答案可能是：**堆外内存泄漏**。

今天，我们聊聊直接内存（Direct Buffer）——高性能 IO 的幕后英雄。

---

## 什么是直接内存？

### 对比：堆内存 vs 直接内存

```
【堆内存（Heap）】

JVM 进程
┌─────────────────────────────────┐
│  ┌─────────────────────────┐    │
│  │        JVM 堆           │    │
│  │  [ByteBuffer 堆内存]    │    │
│  │  [其他 Java 对象]       │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │      直接内存（堆外）     │    │ ← 无法被 GC 直接管理
│  │  [Socket 缓冲区]        │    │
│  │  [文件映射]             │    │
│  └─────────────────────────┘    │
└─────────────────────────────────┘
```

**堆内存 ByteBuffer**：数据在 JVM 堆内

```java
ByteBuffer heap = ByteBuffer.allocate(1024);  // 堆内存
```

**直接内存 ByteBuffer**：数据在 JVM 堆外

```java
ByteBuffer direct = ByteBuffer.allocateDirect(1024);  // 直接内存
```

---

## 为什么需要直接内存？

### IO 操作的数据流

如果用堆内存 ByteBuffer 做网络 IO：

```
应用程序（堆内存）                    内核缓冲区
┌───────────────┐                  ┌───────────────┐
│               │   read() / write() │               │
│   [数据]      │ ────────────────→ │   [Socket     │
│               │      数据拷贝      │    缓冲区]    │
└───────────────┘                  └───────────────┘
```

**问题**：数据从堆内存到 Socket 缓冲区，需要额外一次拷贝（堆内→堆外）。

如果用直接内存 ByteBuffer：

```
应用程序（直接内存）                  内核缓冲区
┌───────────────┐                  ┌───────────────┐
│               │   read() / write() │               │
│   [数据]      │ ────────────────→ │   [Socket     │
│               │     零拷贝        │    缓冲区]    │
└───────────────┘                  └───────────────┘
```

**优势**：数据可以直接在应用程序和内核之间传输，无需额外拷贝。

### 零拷贝原理

零拷贝（Zero-Copy）避免了数据在用户态和内核态之间的多次复制：

| 拷贝次数 | 实现方式 |
|---------|---------|
| 4 次（传统） | 磁盘→内核缓冲区→用户缓冲区→Socket 缓冲区→网卡 |
| 2 次（直接内存） | 磁盘→内核缓冲区→Socket 缓冲区→网卡（用户态不参与） |
| 1 次（Linux splice） | 磁盘→Socket 缓冲区→网卡（完全在内核态） |

---

## 直接内存的优势与劣势

### 优势

1. **零拷贝**：减少内存复制，提升 IO 性能
2. **不受 GC 影响**：堆外内存不受 GC 暂停影响，适合低延迟场景
3. **适合大文件**：映射大文件到内存时，不会占用堆空间
4. **跨 JNI 调用**：减少 JNI 调用时的数据拷贝

### 劣势

1. **分配/释放慢**：比堆内存慢 5-10 倍
2. **不受 GC 控制**：需要手动管理或等待 GC 间接释放
3. **泄漏风险**：更容易导致堆外内存泄漏
4. **调试困难**：无法用堆分析工具（如 MAT）直接分析

---

## 核心配置参数

### -XX:MaxDirectMemorySize

控制最大直接内存大小。

```bash
# 默认值：-Xmx 的值（与堆大小相同）
java -XX:MaxDirectMemorySize=512m -Xmx2g MyApp
```

**默认值等于 -Xmx**：如果堆 2GB，直接内存最多也是 2GB。

如果直接内存用完但堆还有空间，会触发 Full GC 尝试回收。

### 监控直接内存

```java
// 获取直接内存使用信息（反射调用）
MBeanServer mbs = ManagementFactory.getPlatformMBeanServer();
ObjectName name = new ObjectName("java.nio:type=BufferPool,name=direct");
MBeanInfo info = mbs.getMBeanInfo(name);
// 获取当前使用量
Long usage = (Long) mbs.getAttribute(name, "MemoryUsed");
// 获取峰值
Long totalCapacity = (Long) mbs.getAttribute(name, "TotalCapacity");
```

---

## Netty 的池化直接内存

### 问题：频繁分配直接内存

普通直接内存的缺点：每次都要向操作系统申请和释放。

如果每秒创建 10 万个 ByteBuf，分配和释放的开销会非常可观。

### 解决方案：池化

Netty 实现了自己的内存池（PooledByteBufAllocator）：

```java
// Netty 默认使用池化直接内存
ByteBuf buf = UnpooledByteBufAllocator.DEFAULT.buffer(1024);

// 或者使用堆内存池
ByteBuf heapBuf = UnpooledByteBufAllocator.DEFAULT.heapBuffer(1024);
```

**内存池的工作原理**：

1. **预分配**：启动时预分配一块大内存（arena）
2. **分块复用**：切割成小块（chunk），按需分配
3. **线程本地缓存**：每个线程有自己的缓存（tiny / small / normal / large）
4. **按大小分类**：不同大小的请求分配到不同的池（pool）

### 池 vs 非池对比

| 特性 | 池化（Pooled） | 非池化（Unpooled） |
|-----|--------------|-------------------|
| 分配速度 | 快（复用） | 慢（每次新建） |
| 内存占用 | 固定池大小 | 按需分配 |
| 碎片化 | 低 | 可能产生碎片 |
| 适用场景 | 高频分配/释放 | 低频或一次性使用 |

---

## 堆外内存泄漏：排查与解决

### 典型场景

1. **ByteBuf 未释放**：使用 Netty 后忘记 release()
2. **DirectByteBuffer 被老年代持有**：被缓存的大对象引用
3. **NIO 误用**：在循环中频繁创建直接内存缓冲区

### 排查工具

```bash
# 使用 Native Memory Tracking（NMT）查看
java -XX:NativeMemoryTracking=summary -Xmx2g -XX:MaxDirectMemorySize=1g MyApp

# 运行时查看
jcmd <pid> VM.native_memory summary
```

输出示例：

```
Native Memory Tracking:
Total: reserved=1573MB, committed=573MB
-                  Locking Elaboration: 3MB
-                      Internal: 12MB
-                    Direct buffer: 512MB    ← 直接内存使用量
-                        GC Heap: 1024MB
```

### 解决思路

1. **升级 Netty 版本**：新版本有更好的内存管理
2. **添加 CompoundHandler**：处理通道关闭时的资源释放
3. **使用 ReferenceCounted**：Netty 的 ByteBuf 是引用计数的，正确调用 release() 就能释放
4. **限制池大小**：通过 -Dio.netty.allocator.numDirectArenas 控制

---

## 面试追问方向

### 追问一：直接内存是否越大越好？

**不是**。

1. 直接内存不在 JVM 堆内，但属于 JVM 进程内存
2. 操作系统内存有限，过大的直接内存会影响其他进程
3. 分配和释放开销大，过大的单个 Buffer 会放大这个缺点
4. 建议：直接内存大小应该是期望使用的峰值，而不是随便设一个很大的值

### 追问二：为什么 Netty 默认使用直接内存而不是堆内存？

Netty 主要用于高性能网络 IO。

1. **零拷贝**：Socket 读写时直接内存不需要额外拷贝
2. **避免 GC 暂停**：直接内存不受 Minor GC 影响，避免长生命周期 Buffer 频繁复制
3. **池化优化**：Netty 的池化机制使分配/释放开销可控

但 Netty 也支持堆内存 Buffer（heapBuffer），如果业务逻辑简单、不追求极致性能，堆内存反而更省心。

### 追问三：Full GC 为什么能回收直接内存？

虽然 GC 不直接管理直接内存，但 DirectByteBuffer 对象本身在堆内。

```java
// 构造方法
DirectByteBuffer(int cap) {
    // ...
    // 创建一个 Cleaner，用于在对象被 GC 时释放堆外内存
    cleaner = Cleaner.create(this, new Deallocator(address, cap));
}
```

当 DirectByteBuffer 被 GC 回收时，Cleaner 的 run() 方法会被调用，释放堆外内存。

但如果 DirectByteBuffer 被老年代长期持有（长生命周期对象引用），堆外内存就会泄漏。

### 追问四：堆外内存泄漏和堆内存泄漏有什么区别？

| 特性 | 堆内存泄漏 | 堆外内存泄漏 |
|-----|----------|------------|
| 监控工具 | MAT、JProfiler | NMT、pmap |
| 表现 | OOM 异常（堆） | OOM 异常（进程） |
| GC 影响 | 频繁 Full GC | Full GC 也无法回收 |
| 排查难度 | 较低 | 较高 |

---

## 留给你的思考题

我们讲了直接内存的优势、配置、池化，以及泄漏问题。

但还有一个问题：

如果你的应用创建了大量的 ByteBuf，但每次都用完了就扔（不池化）。

现在你要优化它，选择池化还是非池化？

考虑以下场景：

1. **场景 A**：每秒 10 万次短连接，每次传输 1KB 数据
2. **场景 B**：每秒 100 次长连接，每次传输 100MB 大文件
3. **场景 C**：每秒 1 次请求，每次处理 10KB 数据

这三个场景，应该分别怎么选择？

> 提示：考虑分配频率、数据大小、连接特性。
