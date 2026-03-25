# ByteBuffer：分类与使用陷阱

写 NIO 代码，ByteBuffer 是天天见面的老朋友。

但这个「老朋友」，坑可不少。

flip() 忘写了、position 越界了、堆内存和直接内存搞混了……这些问题，十个 NIO 新手九个踩过。

今天，我们把这些坑一个一个排掉。

---

## ByteBuffer 的三种创建方式

### allocate()：堆内存缓冲区

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);
```

在 JVM 堆上分配内存，速度快，但数据需要拷贝到堆外才能进行 IO 操作。

**特点**：
- GC 管理，内存自动回收
- 分配速度快
- 适合普通业务逻辑

### allocateDirect()：直接内存缓冲区

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024);
```

在堆外（操作系统内存）分配，**零拷贝**——数据直接参与 IO 操作，不需要 JVM 堆和堆外之间的拷贝。

**特点**：
- 不受 GC 直接管理（依赖 GC 回收或手动释放）
- 分配和释放开销较大
- 适合高性能 IO 场景

### wrap()：包装已有数组

```java
byte[] array = new byte[1024];
ByteBuffer buffer = ByteBuffer.wrap(array);
```

包装一个已有的字节数组，底层还是堆内存。

```java
// 包装并指定偏移量和长度
ByteBuffer buffer = ByteBuffer.wrap(array, 5, 10);
```

---

## 三个核心属性：position、limit、capacity

这是理解 ByteBuffer 的关键。

```
┌─────────────────────────────────────────────────────┐
│                   capacity                         │
│  [ 0 ──────────────────────────────── max ]        │
│      ↑                              ↑              │
│   position                      limit               │
│   (当前索引)                    (有效数据边界)        │
└─────────────────────────────────────────────────────┘
```

| 属性 | 含义 | 说明 |
|-----|------|------|
| capacity | 容量 | 缓冲区的最大容量，创建后不可改变 |
| position | 位置 | 下一个读写操作的索引位置 |
| limit | 限制 | 第一个不可读/不可写的位置 |

### 状态变化图解

```
【初始状态】
capacity: [                        ]
position: 0
limit:    1024

【写入 "ABC"（3字节）后】
capacity: [ABC                     ]
position: 3
limit:    1024

【flip() 后（切换为读模式）】
capacity: [ABC                     ]
position: 0
limit:    3        ← 关键变化！

【读取 1 个字节后】
capacity: [ABC                     ]
position: 1
limit:    3

【compact() 后（压缩，保留未读数据 "BC"）】
capacity: [BC          ABC         ]
position: 2
limit:    1024
```

---

## flip()：写模式 → 读模式

flip() 是 ByteBuffer 中最容易被忽略、也是最容易出问题的操作。

```java
// 写入数据
buffer.put("Hello".getBytes());

// flip() 把 limit 设置为当前 position，position 归零
// 这样 read() 就只会读到写入的数据
buffer.flip();

// 现在可以读取了
while (buffer.hasRemaining()) {
    System.out.print((char) buffer.get());
}
```

**flip() 到底做了什么？**

```java
public Buffer flip() {
    limit = position;  // limit 设为 position
    position = 0;      // position 归零
    return this;
}
```

**为什么要 flip()？**

因为写数据时 position 前进，读数据时从 position 开始。如果不 flip()，读的位置就是数据末尾，读不到任何东西。

---

## clear()：读模式 → 写模式

clear() 把 Buffer 重置为写模式，但**不删除数据**。

```java
// 读完数据后，准备重新写入
buffer.clear();

// 再次写入（会覆盖原有数据）
buffer.put("World".getBytes());
```

**clear() 到底做了什么？**

```java
public Buffer clear() {
    position = 0;    // position 归零
    limit = capacity; // limit 设为 capacity
    mark = -1;       // 清除 mark
    return this;
}
```

> **注意**：clear() 只是重置指针，不删除数据。旧数据还在，只是被「覆盖」了。

---

## compact()：压缩并保留未读数据

这是最容易被误用的方法。

假设 Buffer 里写入了 "HelloWorld"，已读 "Hello"（5字节），还想继续写：

```java
// 写入 "HelloWorld"
buffer.put("HelloWorld".getBytes());
buffer.flip();

// 读取 "Hello"
buffer.get(new byte[5]);

// 现在想继续写入 "ABC"
// compact() 会把未读的 "World" 移到 Buffer 开头
buffer.compact();  // 结果：[World        ABC]

buffer.put("ABC".getBytes());
// 结果：[WorldABC     ]
```

**compact() 做了什么？**

1. 把未读数据（position 到 limit 之间的数据）复制到 Buffer 开头
2. position 设为未读数据之后的位置
3. limit 设为 capacity

**对比 clear() 和 compact()**：

| 方法 | 未读数据 | position | limit | 适用场景 |
|-----|---------|----------|-------|---------|
| `clear()` | 丢弃 | 0 | capacity | 全部读完，要重新写 |
| `compact()` | 保留 | 未读数据之后 | capacity | 读完一部分，还要继续写 |

---

## mark() 和 reset()：书签功能

mark() 打个书签，reset() 回到书签位置。

```java
buffer.put("Hello".getBytes());
buffer.flip();

// 在位置 3 打个书签
buffer.get();
buffer.get();
buffer.get();
buffer.mark();  // 书签在 position=3 的位置

// 继续读取
buffer.get();
buffer.get();

// 回到书签位置，重新读
buffer.reset();
```

---

## 常用方法一览

### 读写方法

```java
// 写入
buffer.put((byte) 1);                    // 写入单个字节
buffer.put(byteArray);                   // 写入字节数组
buffer.putInt(123);                      // 写入 int
buffer.putLong(456L);                    // 写入 long
buffer.putChar('A');                     // 写入 char

// 读取
byte b = buffer.get();                   // 读取单个字节
buffer.get(byteArray);                   // 读取到字节数组
int i = buffer.getInt();                 // 读取 int
long l = buffer.getLong();               // 读取 long
char c = buffer.getChar();               // 读取 char

// 其他
buffer.flip();                           // 切换到读模式
buffer.clear();                          // 切换到写模式
buffer.compact();                        // 压缩并保留未读数据
buffer.mark();                           // 打书签
buffer.reset();                          // 回到书签
buffer.rewind();                         // position 归零，可重新读
buffer.remaining();                      // 剩余可读/可写字节数
buffer.hasRemaining();                   // 是否还有剩余
```

### 视图方法

```java
// slice()：创建从当前 position 开始的视图（共享数据）
ByteBuffer original = ByteBuffer.allocate(10);
original.position(3).limit(7);
ByteBuffer slice = original.slice();  // 新 Buffer 容量为 4

// duplicate()：创建整个 Buffer 的副本（独立游标，共享数据）
ByteBuffer dup = original.duplicate();

// asReadOnlyBuffer()：创建只读副本
ByteBuffer readOnly = original.asReadOnlyBuffer();
```

---

## 四大陷阱：踩一个都是泪

### 陷阱一：flip() 后忘记调用

这是最常见的坑。

```java
// 错误代码
buffer.put("Hello".getBytes());
// 没有 flip() 就开始读
while (buffer.hasRemaining()) {
    System.out.print((char) buffer.get());  // 读不到任何东西！
}
```

**正确写法**：

```java
buffer.put("Hello".getBytes());
buffer.flip();  // 别忘了这一行！
while (buffer.hasRemaining()) {
    System.out.print((char) buffer.get());
}
```

---

### 陷阱二：position 越界

读写超过 limit，会抛出异常。

```java
ByteBuffer buffer = ByteBuffer.allocate(5);
buffer.put("HelloWorld".getBytes());  // BufferOverflowException！
```

或者读取时：

```java
ByteBuffer buffer = ByteBuffer.allocate(5);
buffer.put("Hi".getBytes());
buffer.flip();
buffer.get();
buffer.get();
buffer.get();  // BufferUnderflowException！只有 2 个字节
```

**解决方法**：先检查 `hasRemaining()` 或 `remaining()`。

```java
if (buffer.remaining() >= 4) {
    buffer.getInt();  // 安全
}
```

---

### 陷阱三：compact() vs clear() 傻傻分不清

```java
// 场景：写入 10 字节，读了 3 字节，还想继续写

// 错误：用 clear()
buffer.put(data10);  // 写入 10 字节
buffer.flip();
buffer.get(bytes3);  // 读了 3 字节
buffer.clear();      // 错误！未读的 7 字节被丢弃了

// 正确：用 compact()
buffer.put(data10);
buffer.flip();
buffer.get(bytes3);
buffer.compact();    // 保留未读的 7 字节
```

---

### 陷阱四：堆内存和直接内存混淆

allocate() 和 allocateDirect() 的区别：

```java
// allocate() - 堆内存
ByteBuffer heap = ByteBuffer.allocate(1024);

// allocateDirect() - 直接内存（堆外）
ByteBuffer direct = ByteBuffer.allocateDirect(1024);
```

**常见混淆点**：

1. **分配速度**：heap 快，direct 慢
2. **回收**：heap 由 GC 回收，direct 需要 GC 间接回收或手动清理
3. **IO 效率**：heap 数据需要拷贝到堆外，direct 可以直接参与 IO（零拷贝）
4. **判断方法**：

```java
buffer.isDirect();  // true = 直接内存，false = 堆内存
```

---

## 实际应用示例

### 读写 int 类型数据

```java
public void writeAndReadInt() {
    ByteBuffer buffer = ByteBuffer.allocate(16);

    // 写入多个 int
    buffer.putInt(100);
    buffer.putInt(200);
    buffer.putInt(300);

    // flip 后读取
    buffer.flip();

    System.out.println(buffer.getInt());  // 100
    System.out.println(buffer.getInt());  // 200
    System.out.println(buffer.getInt());  // 300
}
```

### 粘包/半包处理

```java
public class MessageDecoder {
    private static final int HEADER_SIZE = 4;  // 消息头存储长度

    public ByteBuffer decode(ByteBuffer buffer) {
        buffer.flip();
        int readable = buffer.remaining();

        if (readable < HEADER_SIZE) {
            return null;  // 数据不完整，等待更多数据
        }

        // 读取消息长度
        buffer.mark();  // 标记消息头位置
        int length = buffer.getInt();

        if (readable < HEADER_SIZE + length) {
            buffer.reset();  // 数据不完整，恢复到消息头
            return null;
        }

        // 读取完整消息
        byte[] body = new byte[length];
        buffer.get(body);

        ByteBuffer message = ByteBuffer.allocate(length);
        message.put(body);
        message.flip();
        return message;
    }
}
```

---

## 面试追问方向

### 追问一：ByteBuffer 和 Netty 的 ByteBuf 有什么区别？

| 特性 | ByteBuffer | ByteBuf |
|-----|-----------|---------|
| 内存管理 | 需要手动 flip/clear | 自动管理，引用计数 |
| 池化 | 不支持 | 支持池化，减少分配开销 |
| 容量 | 固定 | 可以动态扩展 |
| 读写索引 | 共用一个 position | 分开（readerIndex/writeReader） |
| 零拷贝 | 不支持 | 支持 CompositeByteBuf、slice |

### 追问二：ByteBuffer 的线程安全吗？

**不安全**。

ByteBuffer 是非线程安全的，多线程环境下需要自行加锁，或者每个线程使用独立的 Buffer。

### 追问三：allocateDirect 的内存什么时候释放？

直接内存不受 GC 直接管理。

当 ByteBuffer 被 GC 回收后，对象的 `cleaner()` 会被调用，释放堆外内存。

但如果 ByteBuffer 一直被引用（被长生命周期对象持有），即使 GC 频繁运行，直接内存也不会释放——这就是堆外内存泄漏。

**建议**：使用 `-XX:MaxDirectMemorySize` 限制直接内存大小，监控 `DirectByteBuffer` 的创建。

---

## 留给你的思考题

我们讲了 ByteBuffer 的三种创建方式、核心属性、常用方法，还有四大陷阱。

但还有一个问题：

当你从网络读取数据时，数据可能不是一次性到达的——第一次读到 "Hel"，第二次读到 "loWorld"。

这叫做「**半包问题**」。

如果你的协议是：消息头 4 字节表示消息长度，后面是消息体。

```
第一次读到: "Hel" + "loWo"  (7字节)
第二次读到: "rld"           (3字节)
```

你怎么用 ByteBuffer 组装完整的消息？

> 提示：注意 `remaining()` 的使用，以及 `compact()` 的时机。
