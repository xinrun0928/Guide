# 分页机制：虚拟内存的基石

想象你有一本超级厚的字典，但书架只能放10本。
你不可能把整本字典背下来，但你可以只带当前在用的那几页。
用完再换。

操作系统的分页机制，就是这个原理——把内存当成「书架」，把程序当成「字典」。


## 为什么需要分页？

连续分配的致命问题：**外部碎片**。

```
连续分配的问题：
┌────┐    ┌────┐    ┌────┐    ┌────┐    ┌────┐
│ P1 │    │ P2 │    │ P3 │    │ P4 │    │ P5 │
│20MB│    │10MB│    │15MB│    │8MB │    │12MB│
└────┘    └────┘    └────┘    └────┘    └────┘

P2和P4退出后：
┌────┐          ┌────┐    ┌────┐          ┌────┐
│ P1 │  空闲    │ P3 │    │ P5 │        │P6  │
│20MB│  18MB   │15MB│    │12MB│        │30MB│
└────┘          └────┘    └────┘          └────┘
        ↑
   空闲总空间18MB，但无法分配30MB的P6！
```

**分页的解决方案：把内存分成固定大小的小块，按需分配。**

```
分页后：
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ P1 │ P1 │ P1 │ P1 │ P3 │ P5 │ P3 │ P5 │ P3 │ P5 │
│4KB │4KB │4KB │4KB │4KB │4KB │4KB │4KB │4KB │4KB │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
 帧0   帧1   帧2   帧3   帧4   帧5   帧6   帧7   帧8   帧9

P2和P4退出后（留下分散的小块）：
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ P1 │ P1 │    │ P1 │ P3 │ P5 │    │ P5 │ P3 │ P5 │
│4KB │4KB │空闲│4KB │4KB │4KB │空闲│4KB │4KB │4KB │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘

P6（8页）来了，只需找到8个空闲帧：
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ P1 │ P1 │ P6 │ P1 │ P3 │ P5 │ P6 │ P5 │ P3 │ P5 │
│4KB │4KB │4KB │4KB │4KB │4KB │4KB │4KB │4KB │4KB │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
        ↑
   完全不需要连续空间！
```


## 分页的核心概念

```
┌─────────────────────────────────────────────────────────┐
│                    分页相关术语                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  页（Page）：虚拟地址空间中的固定大小块                   │
│           通常是4KB（可配置）                            │
│                                                         │
│  帧（Frame）：物理内存中的固定大小块                      │
│           大小与页相同                                   │
│                                                         │
│  页表（Page Table）：页号→帧号的映射表                    │
│           每个进程有自己的页表                            │
│                                                         │
│  TLB（Translation Lookaside Buffer）：页表的缓存          │
│           硬件级加速查找                                  │
│                                                         │
│  页表项（PTE）：页表中的每一行                            │
│           包含帧号和权限位                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 页表项结构

```
┌──────────────────────────────────────────────────────────┐
│                    页表项结构（32位系统）                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────┬────┬────┬────┬────┬────┬────┬────────────────┬───┐│
│  │有效│读/写│用户│访问│脏位│交换│  保留  │    帧号     │   ││
│  │ 位 │    │ /  │  位 │    │ 位 │      │             │   ││
│  │    │    │系统│    │    │    │      │             │   ││
│  │ 1位│ 1位│ 1位│ 1位│ 1位│ 1位│  6位  │   20位     │ 4位││
│  └────┴────┴────┴────┴────┴────┴────┴────────────────┴───┘│
│                                                          │
│  有效位(V): 页是否在内存中                                │
│  读/写位(R/W): 权限控制                                  │
│  用户/系统位(U/S): 用户态能否访问                         │
│  访问位(A): 页是否被访问过（用于置换算法）                 │
│  脏位(D): 页是否被修改过（需要写回）                       │
│  交换位: 页是否在磁盘交换区                               │
│  帧号: 页对应的物理帧号                                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```


## 地址转换

### 一级页表

```
虚拟地址格式（32位，4KB页）：
┌────────────────┬────────────┐
│    页号(20位)   │  页内偏移(12位) │
└────────────────┴────────────┘

转换过程：
虚拟地址 VA = 页号 × 页大小 + 页内偏移
            ↓
    页表基址寄存器（PTBR）+ 页号 × PTE大小
            ↓
        读取页表项
            ↓
    从页表项获取帧号
            ↓
物理地址 PA = 帧号 × 帧大小 + 页内偏移
```

```java
public class SingleLevelPaging {
    private static final int PAGE_SIZE = 4096;           // 4KB
    private static final int PAGE_BITS = 12;             // 页内偏移位数
    private static final int PAGE_ENTRIES = 1 << 20;     // 2^20 = 1M个页表项

    private int[] pageTable;  // 简化的页表，实际是帧号或-1
    private int ptbr;         // 页表基址寄存器

    // 虚拟地址转物理地址
    public int translate(int virtualAddress) {
        // 1. 提取页号和页内偏移
        int pageNumber = virtualAddress >>> PAGE_BITS;
        int offset = virtualAddress & (PAGE_SIZE - 1);

        // 2. 检查TLB（先不实现）
        // int frame = tlb.lookup(pageNumber);
        // if (frame != -1) return frame * PAGE_SIZE + offset;

        // 3. 页表查找
        int frameNumber = pageTable[pageNumber];
        if (frameNumber == -1) {
            // 缺页异常
            throw new PageFaultException(pageNumber);
        }

        // 4. 更新TLB（略）

        // 5. 组合物理地址
        return (frameNumber << PAGE_BITS) | offset;
    }

    // 模拟分页分配
    public void allocateProcess(int[] virtualPages, int[] physicalFrames) {
        for (int i = 0; i < virtualPages.length; i++) {
            int vpn = virtualPages[i];
            int pfn = physicalFrames[i];
            pageTable[vpn] = pfn;  // 映射
        }
    }
}
```

### 二级页表

一级页表的问题：**1M个页表项，每个进程就要4MB的页表**。
解决思路：**用索引思想，构建多级页表**。

```
32位地址，4KB页 → 20位页号 + 12位偏移

一级页表的问题：
2^20 个页表项 × 4字节 = 4MB（每个进程！）
即使只用了10个页，也要4MB。

解决方案：二级页表
┌──────────────────┬────────────┬────────────┐
│ 一级页号(10位)   │ 二级页号(10位)│ 页内偏移(12位) │
└──────────────────┴────────────┴────────────┘
                    ↓              ↓
              外层页表索引      页表索引

外层页表: 2^10 = 1024项 → 4KB（按需分配）
每个二级页表: 2^10个页表项 → 4KB（按需分配）

如果只用了10个虚拟页：
外层页表: 4KB + 10个二级页表: 40KB = 44KB（大幅减少！）
```

```java
public class TwoLevelPaging {
    private static final int OUTER_BITS = 10;
    private static final int INNER_BITS = 10;
    private static final int OFFSET_BITS = 12;

    private int[][] outerPageTable;  // 外层页表（二级页表的基址）
    private int[] innerPageTables;    // 二级页表数组

    public int translate(int virtualAddress) {
        // 1. 分解虚拟地址
        int outerIndex = virtualAddress >>> (INNER_BITS + OFFSET_BITS);
        int innerIndex = (virtualAddress >>> OFFSET_BITS) & ((1 << INNER_BITS) - 1);
        int offset = virtualAddress & ((1 << OFFSET_BITS) - 1);

        // 2. 查外层页表
        if (outerPageTable[outerIndex] == -1) {
            throw new PageFaultException(outerIndex);
        }

        // 3. 查内层页表
        int[] innerTable = innerPageTables[outerPageTable[outerIndex]];
        int frameNumber = innerTable[innerIndex];
        if (frameNumber == -1) {
            throw new PageFaultException(virtualAddress >>> OFFSET_BITS);
        }

        // 4. 组合物理地址
        return (frameNumber << OFFSET_BITS) | offset;
    }
}
```


## TLB：硬件级加速

页表在内存中，每次地址转换都要访问内存，太慢了！
**TLB（Translation Lookaside Buffer）是CPU中的一个硬件缓存**，专门缓存最近用过的页表项。

```
无TLB：
虚拟地址 → 访问内存(页表) → 访问内存(数据) = 2次内存访问

有TLB：
虚拟地址 → TLB查找 → TLB命中 → 访问内存(数据) = 1次内存访问
                ↓
            TLB未命中 → 访问内存(页表) → 更新TLB → 访问内存(数据) = 2次内存访问
```

```java
public class TLB {
    private static final int TLB_SIZE = 64;  // 64个条目
    private Map<Integer, Integer> entries = new LinkedHashMap<>();
    // 使用LRU策略

    public Integer lookup(int pageNumber) {
        if (entries.containsKey(pageNumber)) {
            // 命中，更新LRU位置
            Integer frame = entries.remove(pageNumber);
            entries.put(pageNumber, frame);
            return frame;
        }
        return -1;  // 未命中
    }

    public void insert(int pageNumber, int frameNumber) {
        if (entries.size() >= TLB_SIZE) {
            // 淘汰最旧的条目
            entries.remove(entries.keySet().iterator().next());
        }
        entries.put(pageNumber, frameNumber);
    }

    // TLB特性：
    // 1. 全相联映射（任何页可以放在任何TLB槽）
    // 2. 并行比较（同时比较所有TLB条目）
    // 3. 命中率极高（程序局部性原理）
}
```


## 缺页异常

当访问的页不在内存中时，会触发**缺页异常（Page Fault）**。

```
缺页处理流程：

1. CPU执行虚拟地址访问
         ↓
2. MMU查页表，发现有效位=0
         ↓
3. 触发缺页异常（Page Fault）
         ↓
4. OS处理缺页异常：
   a. 检查页是否合法（进程地址空间内？）
   b. 选择一个物理帧（可能需要页置换）
   c. 如果被选中帧有脏位，需要写回磁盘
   d. 从磁盘加载所需页到物理帧
   e. 更新页表
   f. 返回用户程序，重新执行该指令
```

```java
public class PageFaultHandler {
    public void handlePageFault(int pageNumber) {
        // 1. 检查页是否在交换区
        if (!isInSwapSpace(pageNumber)) {
            throw new SegFaultException("非法内存访问");
        }

        // 2. 分配或选择一个物理帧
        int frameNumber = allocateFrame();

        // 3. 如果帧被占用，先换出
        if (frameNumber == -1) {
            int victimPage = selectVictim();  // LRU/Clock算法
            int victimFrame = getFrameOfPage(victimPage);

            if (isDirty(victimPage)) {
                // 写回磁盘
                swapOut(victimPage, victimFrame);
            }

            // 标记无效
            invalidatePage(victimPage);
            frameNumber = victimFrame;
        }

        // 4. 从磁盘加载页到物理帧
        swapIn(pageNumber, frameNumber);

        // 5. 更新页表
        updatePageTable(pageNumber, frameNumber, true);

        // 6. 返回，继续执行指令
        returnFromPageFault();
    }
}
```


## 分页的性能问题

| 问题 | 原因 | 解决方案 |
|-----|------|---------|
| 两次内存访问 | 页表在内存中 | TLB |
| 页表太大 | 32位地址需要4MB页表 | 多级页表、反向页表 |
| 频繁缺页 | 工作集超出物理内存 | 增大物理内存、优化工作集 |


## 实际案例：Java的内存分页

JVM在操作系统分页的基础上，又做了一层分页：

```java
public class JVMPaging {
    public static void main(String[] args) {
        // JVM的分页与操作系统的关系：
        //
        // 应用程序看到的虚拟地址
        //     ↓
        // 操作系统页表（4KB页）
        //     ↓
        // 物理内存（可能是虚拟的）
        //     ↓
        // 硬件MMU + TLB

        // JVM使用大页（HugePages）优化
        // - 减少TLB条目数
        // - 提高TLB命中率
        // - 减少页表大小

        // JVM参数：
        // -XX:+UseLargePages
        // -XX:LargePageSizeInBytes=2m

        // 查看TLB效果
        // Linux: cat /proc/cpuinfo | grep tlb
        // Windows: wmic MEMORYCHIP get Capacity, Speed
    }
}
```


## 面试追问方向

- **为什么需要多级页表？一级页表有什么问题？**
  提示：内存占用、稀疏地址空间。
- **TLB的命中率一般是多少？受什么因素影响？**
  提示：程序局部性、TLB大小、工作集。
- **缺页异常和普通异常有什么区别？**
  提示：缺页是内存管理特有的，可以恢复。
- **如何计算一个进程的页表大小？**
  提示：地址空间大小 / 页大小 × 页表项大小。
