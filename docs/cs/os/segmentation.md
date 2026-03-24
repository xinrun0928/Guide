# 分段机制：让程序说「人话」

你有没有想过，为什么程序里的代码和数据是分开放的？
为什么函数调用要用栈，局部变量存在栈里，全局变量存在数据段里？

这就是**分段机制**要解决的问题——让内存管理符合程序的**逻辑结构**。


## 为什么需要分段？

分页解决了外部碎片问题，但页是固定大小的，没有「意义」。
分段则是**按程序逻辑划分**的。

```
分页的视角（物理化）：
┌─────────────────────────────────────────────────────────┐
│ 虚拟地址空间（程序员的困惑）：                             │
│                                                          │
│ 0x0000 ┌────────────────┐                               │
│        │  代码 | 数据 |  │  ← 都混在一起，程序员不理解     │
│        │  堆   | 栈    │                                │
│ 0xFFFF └────────────────┘                               │
│                                                          │
│ 物理内存（硬件）：                                        │
│ 帧0 ┌────┐  帧1 ┌────┐  帧2 ┌────┐  帧3 ┌────┐        │
│     │ 页1 │     │ 页5 │     │ 页3 │     │ 页2 │        │
│     └────┘      └────┘      └────┘      └────┘        │
│     完全分散，物理上连续或不连续对程序员没有意义           │
└─────────────────────────────────────────────────────────┘

分段的视角（逻辑化）：
┌─────────────────────────────────────────────────────────┐
│ 程序的逻辑结构：                                          │
│                                                          │
│ 代码段  ┌─────────────────────┐  ← 只读、可执行          │
│        │ main() {...}        │                          │
│        │ function() {...}    │                          │
│        └─────────────────────┘                          │
│                                                          │
│ 数据段  ┌─────────────────────┐  ← 可读写、初始化        │
│        │ global_var = 100    │                          │
│        └─────────────────────┘                          │
│                                                          │
│ BSS段   ┌─────────────────────┐  ← 可读写、未初始化       │
│        │ uninitialized_data  │                          │
│        └─────────────────────┘                          │
│                                                          │
│ 堆      ┌─────────────────────┐  ← 可读写、动态分配      │
│        │ malloc()返回的内存   │                          │
│        └─────────────────────┘                          │
│              ↑                                          │
│             malloc                                       │
│                                                          │
│ 栈      ┌─────────────────────┐  ← 可读写、自动管理      │
│        │ function()的局部变量 │                          │
│        │ 返回地址             │                          │
│        └─────────────────────┘                          │
└─────────────────────────────────────────────────────────┘
```


## 分段 vs 分页

| 特性 | 分段 | 分页 |
|-----|-----|-----|
| 大小 | 变量大小 | 固定大小 |
| 视角 | 程序员视角（逻辑） | 硬件视角（物理） |
| 碎片 | 外部碎片 | 内部碎片 |
| 目的 | 逻辑分离、共享、安全 | 高效利用内存、简化分配 |
| 权限 | 可设不同权限（代码只读、数据可读写） | 通常统一管理 |


## 段表

每个进程有一个**段表**，记录每个段的基址和界限。

```
┌──────────────────────────────────────────────────────────┐
│                      段表结构                              │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  段号 │   基址(Base)   │  界限(Limit) │  权限  │ 说明    │
│  ───┼──────────────┼────────────┼──────┼─────────   │
│   0  │   0x0000    │   4KB      │  R/X │ 代码段     │
│   1  │   0x1000    │   8KB      │  R/W │ 数据段     │
│   2  │   0x3000    │   4KB      │  R/W │ BSS段      │
│   3  │   0x7000    │   动态    │  R/W │ 堆段       │
│   4  │   0xFF000   │   动态    │  R/W │ 栈段       │
│                                                          │
└──────────────────────────────────────────────────────────┘

段表基址寄存器（STBR）：指向段表在内存中的起始地址
段表长度寄存器（STLR）：记录段表有多少个段
```

### 地址转换

```
逻辑地址 = 段号 + 段内偏移

     ┌────────────────────────┐
     │     段号    │  段内偏移   │
     └─────────┬──┴────────────┘
               │
               ▼
     ┌────────────────────────┐
     │    检查段号 < STLR     │──否──→ 越界错误
     └─────────┬──────────────┘
               │是
               ▼
     ┌────────────────────────┐
     │  查段表：基址+界限检查  │──否──→ 越界错误
     └─────────┬──────────────┘
               │是
               ▼
     ┌────────────────────────┐
     │    物理地址 = 基址+偏移 │
     └────────────────────────┘
```

```java
public class Segmentation {
    private static final int SEGMENT_COUNT = 5;

    // 段表项
    private static class SegmentTableEntry {
        int base;       // 基址
        int limit;      // 界限
        int rights;     // 权限 (R/W/X)
        boolean valid;  // 是否有效
    }

    private SegmentTableEntry[] segmentTable;
    private int stbr;   // 段表基址寄存器
    private int stlr;   // 段表长度寄存器

    public Segmentation() {
        segmentTable = new SegmentTableEntry[SEGMENT_COUNT];
        for (int i = 0; i < SEGMENT_COUNT; i++) {
            segmentTable[i] = new SegmentTableEntry();
        }
    }

    // 初始化典型段
    public void initializeProcess(int codeSize, int dataSize, int bssSize) {
        int currentBase = 0;

        // 代码段
        segmentTable[0].valid = true;
        segmentTable[0].base = currentBase;
        segmentTable[0].limit = codeSize;
        segmentTable[0].rights = 0b101;  // 读+执行
        currentBase += codeSize;

        // 数据段
        segmentTable[1].valid = true;
        segmentTable[1].base = currentBase;
        segmentTable[1].limit = dataSize;
        segmentTable[1].rights = 0b011;  // 读+写
        currentBase += dataSize;

        // BSS段
        segmentTable[2].valid = true;
        segmentTable[2].base = currentBase;
        segmentTable[2].limit = bssSize;
        segmentTable[2].rights = 0b011;  // 读+写

        stlr = 3;  // 只有3个段
    }

    // 地址转换
    public int translate(int segmentNumber, int offset) throws SegFaultException {
        // 1. 检查段号是否有效
        if (segmentNumber >= stlr || !segmentTable[segmentNumber].valid) {
            throw new SegFaultException("Invalid segment: " + segmentNumber);
        }

        SegmentTableEntry seg = segmentTable[segmentNumber];

        // 2. 检查偏移是否越界
        if (offset < 0 || offset >= seg.limit) {
            throw new SegFaultException("Offset out of bounds: " + offset);
        }

        // 3. 物理地址 = 基址 + 偏移
        return seg.base + offset;
    }

    // 检查权限
    public boolean hasPermission(int segmentNumber, int requiredRights) {
        return (segmentTable[segmentNumber].rights & requiredRights)
               == requiredRights;
    }
}
```


## 分段的保护与共享

### 段级保护

```java
public class SegmentProtection {
    public void accessMemory(int segmentNumber, int offset, String operation) {
        int requiredRights = 0;

        switch (operation) {
            case "read":
                requiredRights = 0b001;  // 读权限
                break;
            case "write":
                requiredRights = 0b010;  // 写权限
                break;
            case "execute":
                requiredRights = 0b100;  // 执行权限
                break;
        }

        if (!hasPermission(segmentNumber, requiredRights)) {
            throw new SecurityException("Permission denied: " + operation);
        }
    }
}
```

### 段级共享

**代码段可以被多个进程共享，节省内存。**

```
进程A:                              进程B:
┌────────────────────┐               ┌────────────────────┐
│ 代码段A (共享)     │◄─────────────►│ 代码段B (共享)     │
│                    │   同一物理帧   │                    │
└────────────────────┘               └────────────────────┘
         ↑                                   ↑
    段表A指向帧3                         段表B指向帧3

各自的数据段独立：
┌────────────────────┐               ┌────────────────────┐
│ 数据段A            │               │ 数据段B            │
│ (独立副本)         │               │ (独立副本)         │
└────────────────────┘               └────────────────────┘
```


## 段页式管理

分段和分页各有优缺点，于是有了**段页式**——先分段，再分页。

### 为什么需要段页式？

| 纯分段 | 纯分页 |
|-------|-------|
| ✅ 逻辑清晰 | ✅ 无外部碎片 |
| ✅ 便于共享和保护 | ✅ 分配简单 |
| ❌ 外部碎片 | ❌ 权限管理不灵活 |
| ❌ 内存分配复杂 | ❌ 不符合逻辑视图 |

### 段页式的工作原理

```
1. 逻辑地址：段号 + 段内偏移

2. 查段表：
   段号 → 段描述符（包含段基址和段限长）
   
3. 段内偏移分成：页号 + 页内偏移

4. 查页表：
   页号 → 帧号
   
5. 物理地址：帧号 + 页内偏移

┌─────────────────────────────────────────────────────────┐
│                    段页式地址转换                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  逻辑地址:  ┌────────┬────────────────────────┐          │
│            │ 段号    │      段内偏移           │          │
│            │ (8位)   │      (24位)            │          │
│            └────────┴────────────┬─────────────┘          │
│                                  │                        │
│                                  ▼                        │
│                         ┌───────────────┐                 │
│                         │  段表查找     │                 │
│                         │ 基址+界限检查 │                 │
│                         └───────┬───────┘                 │
│                                 │                        │
│                                 ▼                        │
│  段内偏移:  ┌────────┬────────────┐                      │
│            │ 页号    │  页内偏移   │                      │
│            │ (12位)  │   (12位)   │                      │
│            └────────┴─────┬──────┘                       │
│                            │                             │
│                            ▼                             │
│                   ┌───────────────┐                      │
│                   │  页表查找     │                      │
│                   │  帧号         │                      │
│                   └───────┬───────┘                      │
│                           │                             │
│                           ▼                             │
│  物理地址:  ┌────────┬────────────┐                      │
│            │ 帧号    │  页内偏移   │                      │
│            │ (20位) │   (12位)   │                      │
│            └────────┴────────────┘                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

```java
public class SegmentedPaging {
    private static final int PAGE_SIZE = 4096;

    // 段表项（包含指向页表的基址）
    private static class SegmentDescriptor {
        int pageTableBase;   // 页表基址
        int segmentLimit;    // 段界限（页数）
        int rights;          // 权限
    }

    // 页表项
    private static class PageTableEntry {
        int frameNumber;
        boolean valid;
        boolean dirty;
        boolean referenced;
    }

    private SegmentDescriptor[] segmentTable;
    private PageTableEntry[][] pageTables;  // 每个段有自己的页表

    public int translate(int segmentNumber, int offset) throws Exception {
        // 1. 检查段号
        if (segmentNumber >= segmentTable.length) {
            throw new Exception("Invalid segment");
        }

        SegmentDescriptor seg = segmentTable[segmentNumber];

        // 2. 分解页号和页内偏移
        int pageNumber = offset / PAGE_SIZE;
        int pageOffset = offset % PAGE_SIZE;

        // 3. 检查页号是否越界
        if (pageNumber >= seg.segmentLimit) {
            throw new Exception("Offset out of segment");
        }

        // 4. 查页表
        int pageTableIndex = seg.pageTableBase + pageNumber;
        PageTableEntry pte = pageTables[segmentNumber][pageNumber];

        if (!pte.valid) {
            throw new PageFaultException("Page not in memory");
        }

        // 5. 组合物理地址
        return (pte.frameNumber << 12) | pageOffset;
    }
}
```


## 实际案例：Linux的段页式

Linux对x86架构做了特殊的段页式处理：

```c
// Linux的段表（简化）
// 代码段和数据段分开
// 用户态和内核态分开

// GDT (Global Descriptor Table)
// 4个重要的段描述符：

// 1. 内核代码段
//    Base: 0x00000000
//    Limit: 0xFFFFFFFF
//    Type: Code, Read/Execute

// 2. 内核数据段
//    Base: 0x00000000
//    Limit: 0xFFFFFFFF
//    Type: Data, Read/Write

// 3. 用户代码段
//    Base: 0x00000000
//    Limit: 0xFFFFFFFF
//    Type: Code, Read/Execute
//    DPL: 3 (用户态)

// 4. 用户数据段
//    Base: 0x00000000
//    Limit: 0xFFFFFFFF
//    Type: Data, Read/Write
//    DPL: 3 (用户态)
```

> **Linux的秘密**：Linux虽然使用了段机制，但所有段的基址都是0，界限都是4GB。
> 这意味着**段不起实际作用**，真正管理内存的是分页机制。
> 这是因为x86架构必须配置段寄存器，但Linux选择「绕过」它。


## 面试追问方向

- **段页式管理和纯分段相比，有什么优势？**
  提示：结合两者优点，消除外部碎片。
- **Linux为什么选择让所有段的基址都是0？**
  提示：简化设计、统一内存管理。
- **段的界限检查和页的界限检查有什么不同？**
  提示：段界限是字节级别，页界限是页对齐的。
- **如何实现段的动态增长？**
  提示：类似堆的扩展机制。
