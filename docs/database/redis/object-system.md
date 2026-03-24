# Redis 对象系统：SDS、ziplist、quicklist、intset、dict

「Redis 的 String 类型底层是什么？」

大多数人会回答「SDS」。

但面试官想听到的不只是三个字母，而是：**SDS 是什么？为什么不用 C 字符串？它解决了什么问题？**

## Redis 对象的层次结构

Redis 每创建一个 key-value 对，都会创建一个**对象**：

```c
// Redis 对象结构
typedef struct redisObject {
    unsigned type:4;        // 类型：String/Hash/List/Set/ZSet
    unsigned encoding:4;    // 编码：实际底层实现
    void *ptr;              // 指向底层数据结构的指针
    // ...
} robj;
```

同一数据类型，可能有多种底层实现：

```
┌──────────────────────────────────────────────────────────────┐
│                        数据类型                                │
├──────────────────────────────────────────────────────────────┤
│  String  ──→ [embstr / raw / int]                             │
│  Hash    ──→ [ziplist / hashtable]                           │
│  List    ──→ [ziplist / quicklist / linkedlist]              │
│  Set     ──→ [intset / hashtable]                             │
│  ZSet    ──→ [ziplist / skiplist + dict]                     │
└──────────────────────────────────────────────────────────────┘
```

Redis 会根据**数据特点和数量**自动选择最优编码，这叫做**编码转换**。

接下来，逐个解析底层数据结构。

## SDS：简单动态字符串

### 为什么 Redis 不用 C 字符串？

C 字符串的缺陷：

```c
// C 字符串
char str[] = "hello";
// 问题1：strlen() 需要遍历，O(n)
// 问题2：strcat() 可能缓冲区溢出
// 问题3：二进制数据（如图片）可能包含 \0，无法正确存储
```

SDS 的设计正是为了解决这些问题。

### SDS 的结构

```c
// SDS 结构
struct sdshdr {
    int len;        // 已使用长度（不含结尾 \0）
    int alloc;      // 总分配长度（不含结尾 \0）
    unsigned flags; // 标志位
    char[] buf;     // 实际存储
};

// 例如：存储 "hello"
sdshdr {
    len = 5,
    alloc = 10,     // 预分配了一些空间
    flags = 0,
    buf = "hello\0" // 末尾仍保留 \0，兼容 C 字符串函数
}
```

### SDS 的三大优势

#### 1. O(1) 获取长度

```java
/**
 * C 字符串：strlen 需要遍历
 * SDS：直接读取 len 字段
 */
public class SDSvsCString {
    
    // C 字符串：O(n)
    int strlen(char* s) {
        int len = 0;
        while (s[len] != '\0') len++;  // 逐字符遍历
        return len;
    }
    
    // SDS：O(1)
    int sdslen(sds s) {
        return ((struct sdshdr*) (s - sizeof(struct sdshdr)))->len;
    }
}
```

#### 2. 空间预分配 + 惰性释放

```java
/**
 * 空间预分配：
 * - 如果 len < 1MB，预分配 len + 1 + 1 字节
 * - 如果 len >= 1MB，预分配 1MB + 1 + 1 字节
 * 
 * 惰性释放：
 * - 删除数据时不立即释放空间，而是更新 len
 * - 下次 append 时可能直接使用已有空间
 * 
 * 这样减少了内存分配次数，提升性能
 */
```

#### 3. 二进制安全

SDS 可以存储任意二进制数据，因为**不依赖 `\0` 判断结束**：

```java
// 存储图片数据的二进制
byte[] imageData = loadImage("avatar.jpg");
sds s = sdsnewlen(imageData, imageData.length);
// SDS 不关心数据内容，可以存储 \0 和任意字节
```

### SDS 的五种类型

Redis 根据字符串长度使用不同的 SDS 结构（又称 sdshdr）：

```c
// 根据 alloc 大小使用不同结构
struct sdshdr5 { unsigned char flags; char[] buf; };  // 弃用
struct sdshdr8 { uint8_t len; uint8_t alloc; unsigned char flags; char[] buf; };
struct sdshdr16 { uint16_t len; uint16_t alloc; unsigned char flags; char[] buf; };
struct sdshdr32 { uint32_t len; uint32_t alloc; unsigned char flags; char[] buf; };
struct sdshdr64 { uint64_t len; uint64_t alloc; unsigned char flags; char[] buf; };
```

**这样设计是为了节省内存**：小字符串用小结构，大字符串用大结构。

## ziplist：压缩列表

### 什么是 ziplist？

ziplist 是一种**内存紧凑**的数据结构，用一片连续的内存存储数据：

```
┌──────────────────────────────────────────────────────────────┐
│  zlbytes │ zltail │ zllen │ entry1 │ entry2 │ ... │ zlend  │
│   4字节   │  4字节  │  2字节 │  可变   │  可变   │      │ 1字节 │
└──────────────────────────────────────────────────────────────┘

zlbytes: 整个 ziplist 占用的字节数
zltail: 最后一个元素到头部的偏移量
zllen: 元素数量
zlend: 固定值 0xFF，表示结束
```

每个 entry 的结构：

```
┌──────────────────────────┐
│ previous_entry_length │  │
│ encoding              │  │  content
│ content              │  │
└──────────────────────────┘

previous_entry_length: 前一个 entry 的长度（1 或 5 字节）
encoding: 编码方式（决定 content 如何解析）
content: 实际数据
```

### ziplist 的优势

1. **内存紧凑**：无指针开销，比 linkedlist 省 50%+ 内存
2. **缓存友好**：连续内存，CPU 缓存命中率高
3. **小数据友好**：元素少时性能很好

### ziplist 的劣势

1. **插入/删除代价高**：需要移动后续所有元素，O(n)
2. **连锁更新**：修改 previous_entry_length 可能触发级联扩展
3. **大数据不友好**：元素多或值大时，性能急剧下降

### 连锁更新问题

```java
/**
 * ziplist 存储连续字符串，每个 entry 的 previous_entry_length
 * 可能占用 1 字节或 5 字节：
 * - 如果前一个 entry 长度 < 254 字节，用 1 字节存储
 * - 否则，用 5 字节存储（1 字节标识 + 4 字节长度）
 * 
 * 连锁更新场景：
 * 假设 ziplist 存储一连串刚好 253 字节的字符串
 * 每个 previous_entry_length 都是 1 字节
 * 
 * 现在在头部插入一个 254 字节的字符串：
 * 第一个 entry 的 previous_entry_length 需要从 1 字节扩展到 5 字节
 * 这会导致后续所有 entry 位置移动
 * 后续 entry 的 previous_entry_length 又可能需要扩展
 * 一传十，十传百，O(n²) 的灾难
 */
```

### ziplist 适用场景

Redis 在以下情况使用 ziplist：

| 数据类型 | 条件 |
|---------|------|
| Hash | 字段数 ≤ 512 且每个值 < 64 字节 |
| List | 元素数 < 128 且每个值 < 64 字节 |
| ZSet | 元素数 < 128 且每个值 < 64 字节 |

## quicklist：快速列表

### 为什么需要 quicklist？

List 类型在 Redis 3.2 之前，用 ziplist 或 linkedlist 实现，各有优缺点：

| 实现 | 优势 | 劣势 |
|-----|------|------|
| ziplist | 内存紧凑 | 插入/删除 O(n)，连锁更新 |
| linkedlist | 插入/删除 O(1) | 内存开销大（前后指针） |

**quicklist = linkedlist of ziplist**，兼顾两者优点。

### quicklist 的结构

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│ ziplist │ ziplist │ ziplist │ ziplist │ ziplist │
│ (节点1) │ (节点2) │ (节点3) │ (节点4) │ (节点5) │
└─────────┴─────────┴─────────┴─────────┴─────────┘
     ▲                                              ▲
     └──────────── linkedlist 双向链表 ─────────────┘
```

每个 ziplist 称为一个**节点（quicklistNode）**，默认配置：

```bash
# 每个 ziplist 最大 8KB（可配置）
list-max-ziplist-size 8

# 节点两端不压缩（0 表示都不压缩）
list-compress-depth 0
```

### quicklist 的操作

```java
/**
 * LPUSH 操作：
 * - 找到头部的 ziplist
 * - 如果 ziplist 未满，直接插入，O(1)
 * - 如果 ziplist 满了，创建新的 ziplist 节点，O(1)
 * 
 * 整体复杂度是 O(1) 级别，性能很好
 */
```

## intset：整数集合

### 什么是 intset？

Set 类型在**所有元素都是整数且数量较少**时，使用 intset 实现：

```c
typedef struct intset {
    uint32_t encoding;    // 编码：16位、32位、64位整数
    uint32_t length;       // 元素数量
    int8_t contents[];     // 存储数组（从小到大排序）
} intset;
```

### intset 的特点

1. **内存紧凑**：无指针，每个元素按实际大小存储
2. **二分查找**：O(log n) 查询
3. **自动升级**：当插入更大的整数时，自动扩容 encoding

```java
/**
 * intset 升级过程：
 * 
 * 初始：encoding = INTSET_ENCODING_INT16
 * contents = [1, 2, 3, 4, 5]
 * 
 * 插入 100000：
 * - 100000 超出 int16_t 范围（-32768 ~ 32767）
 * - 自动升级 encoding 为 INTSET_ENCODING_INT32
 * - 重新分配内存，重新编码所有元素
 * - 插入新元素
 * 
 * 升级是单向的，不会降级
 */
```

### intset 适用条件

```bash
# 配置条件（超过则转为 hashtable）
set-max-intset-entries 512
```

## dict：字典

### 什么是 dict？

dict 是 Redis 内部实现**哈希表**的基础，Set 和 Hash 的 hashtable 编码都用它：

```c
typedef struct dict {
    dictType *type;        // 类型特定函数
    void *privdata;        // 私有数据
    dictEntry **ht_table;   // 哈希表数组（两个，用于 rehash）
    long ht_used[2];        // 已使用节点数
    long rehashidx;        // rehash 进度，-1 表示未进行
} dict;

typedef struct dictEntry {
    void *key;             // 键
    union {
        void *val;         // 值
        uint64_t u64;
        int64_t s64;
    } v;
    dictEntry *next;        // 下一个节点（解决哈希冲突）
} dictEntry;
```

### 渐进式 rehash

Redis 的 dict 使用**渐进式 rehash**，避免一次性 rehash 带来的阻塞：

```java
/**
 * 渐进式 rehash 过程：
 * 
 * dict 有两个哈希表：ht[0] 和 ht[1]
 * 正常情况下只用 ht[0]
 * 
 * rehash 开始时：
 * - ht[1] 分配更大的空间
 * - 每次增删改查，顺便把 ht[0] 的一个桶迁移到 ht[1]
 * - rehashidx 记录进度
 * 
 * 全部迁移完成后：
 * - ht[0] 和 ht[1] 交换
 * - 释放旧的 ht[0]
 * 
 * 这样每次只迁移一个桶，不会长时间阻塞
 */
```

### 哈希函数

Redis 使用 **MurmurHash2** 作为哈希函数：

```java
/**
 * MurmurHash2 的特点：
 * - 分布均匀，碰撞概率低
 * - 计算速度快
 * - 非加密哈希，适用于哈希表
 * 
 * 对比：
 * - MD5、SHA1：加密哈希，慢
 * - MurmurHash、FNV：非加密哈希，快
 */
```

## 编码转换时机

Redis 根据数据特点**自动转换编码**：

### String 类型

| 条件 | 编码 |
|-----|------|
| 能用 long 表示的整数 | int |
| 短字符串（≤ 39 字节） | embstr |
| 其他 | raw |

```java
/**
 * embstr vs raw：
 * 
 * embstr：嵌入式字符串，将 RedisObject 和 SDS 分配在同一块内存
 * - 优点：减少内存分配次数，缓存友好
 * - 限制：只用于短字符串
 * 
 * raw：独立 SDS，RedisObject 和 SDS 分别分配
 * - 优点：SDS 可以独立扩展
 * - 缺点：两次内存分配
 * 
 * "hello" → embstr
 * "这是一段很长的字符串，超过39个字节了" → raw
 */
```

### Hash 类型

| 条件 | 编码 |
|-----|------|
| 字段数 ≤ hash-max-ziplist-entries 且每个值 < hash-max-ziplist-value | ziplist |
| 其他 | hashtable |

### List 类型

| 条件 | 编码 |
|-----|------|
| Redis 3.2 前：元素数 ≤ list-max-ziplist-entries 且每个值 < list-max-ziplist-value | ziplist |
| Redis 3.2 后 | quicklist |

### Set 类型

| 条件 | 编码 |
|-----|------|
| 全整数且元素数 ≤ set-max-intset-entries | intset |
| 其他 | hashtable |

### ZSet 类型

| 条件 | 编码 |
|-----|------|
| 元素数 ≤ zset-max-ziplist-entries 且每个值 < zset-max-ziplist-value | ziplist |
| 其他 | skiplist + dict |

## 总结：为什么这样设计？

Redis 底层数据结构的选型，核心思想是**因地制宜**：

| 场景 | 选择 | 原因 |
|-----|------|------|
| 小数据、元素少 | ziplist | 内存紧凑，缓存友好 |
| 大数据、频繁增删 | linkedlist/quicklist | O(1) 操作 |
| 全整数、小集合 | intset | 内存极省，支持二分 |
| 需要排序 | skiplist | O(log n) 有序操作 |
| 通用场景 | dict | O(1) 平均复杂度 |

## 面试追问方向

| 问题 | 考察点 |
|-----|-------|
| SDS 相比 C 字符串的优势？ | 长度获取、二进制安全、空间预分配 |
| ziplist 的连锁更新是什么？ | 边界条件理解 |
| quicklist 为什么能兼顾性能和内存？ | 数据结构设计思想 |
| dict 的 rehash 为什么是渐进式的？ | 大数据量下的性能考量 |
| 为什么 ZSet 同时用跳表和哈希表？ | 不同操作的时间复杂度 |

## 留给你的问题

Redis 4.0 引入了 **ziplist 节点压缩**（LZF），可以在 ziplist 内部对不活跃的节点进行压缩。

**你觉得压缩 ziplist 节点会带来什么新的问题？什么时候应该启用这个特性？**
