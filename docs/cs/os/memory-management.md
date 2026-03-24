# 内存管理：连续分配 vs 非连续分配

你有没有遇到过这种情况：打开一个100MB的游戏，但内存只有50MB。
系统是怎么运行的？

答案是**虚拟内存**——操作系统给你画了一个大饼，让你以为自己有无限的内存。
而这背后的核心，就是**内存管理**。


## 内存管理要解决什么问题？

```
┌──────────────────────────────────────────────────────────┐
│                    内存管理四大问题                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. 抽象问题：给进程一个独立的地址空间                     │
│     进程A: 0x0000 - 0xFFFF                              │
│     进程B: 0x0000 - 0xFFFF  ← 各自以为自己独占           │
│                                                          │
│  2. 保护问题：防止进程越界访问其他进程的内存               │
│     进程A越界 → 访问进程B → 系统崩溃？→ 必须阻止！        │
│                                                          │
│  3. 共享问题：多个进程如何共享同一段物理内存               │
│     动态库代码 → 多个进程共享 → 节省内存                  │
│                                                          │
│  4. 效率问题：如何高效利用有限的物理内存                   │
│     100个进程，4GB内存 → 每个进程分4MB？太浪费！          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```


## 连续内存分配

**最简单的方案——给每个进程分配一块连续的内存区域。**

### 方案一：单一连续分配

整个内存分成两部分：系统区和用户区。

```
┌─────────────────────┬─────────────────────┐
│      系统区         │       用户区          │
│   (操作系统)        │    (一个进程)        │
│    低地址           │    高地址            │
└─────────────────────┴─────────────────────┘
```

**问题**：一次只能运行一个进程，内存利用率极低。

### 方案二：固定分区分配

把内存划分成固定大小的分区，每个分区只能容纳一个进程。

```
┌─────┬─────┬─────┬─────┬─────┬─────────────────┐
│ 分区│ 分区│ 分区│ 分区│ 分区│      空闲       │
│  1  │  2  │  3  │  4  │  5  │                │
│10MB │10MB │10MB │10MB │10MB │    剩余空间      │
└─────┴─────┴─────┴─────┴─────┴─────────────────┘

问题：
1. 分区大小固定，小进程浪费（内部碎片）
2. 分区数量固定，并发进程数受限
3. 外部碎片：剩余空间可能很大，但无法分配给大进程
```

### 方案三：可变分区分配

根据进程实际需要分配内存，分区大小可变。

```
初始状态：
┌────────────────────────────────────────┐
│              空闲内存                    │
│                 100MB                   │
└────────────────────────────────────────┘

分配后：
┌───────┬──────────┬───────────┬──────────┐
│ P1    │   空闲    │    P2    │   空闲   │
│ 20MB  │   30MB   │   40MB   │   10MB   │
└───────┴──────────┴───────────┴──────────┘
```

#### 分配算法

```java
public class ContinuousAllocation {
    // 首次适配（First Fit）
    public Allocation firstFit(int processId, int size, List<Hole> holes) {
        for (int i = 0; i < holes.size(); i++) {
            Hole hole = holes.get(i);
            if (hole.size >= size) {
                // 分配
                int remaining = hole.size - size;
                hole.size = size;
                hole.processId = processId;
                // 如果有剩余空间，创建新的空洞
                if (remaining > 0) {
                    Hole newHole = new Hole(hole.start + size, remaining);
                    holes.set(i, hole);
                    holes.add(i + 1, newHole);
                }
                return new Allocation(processId, hole.start, size);
            }
        }
        return null;  // 分配失败
    }

    // 最佳适配（Best Fit）
    public Allocation bestFit(int processId, int size, List<Hole> holes) {
        Hole best = null;
        int bestIndex = -1;
        int minWaste = Integer.MAX_VALUE;

        for (int i = 0; i < holes.size(); i++) {
            Hole hole = holes.get(i);
            if (hole.size >= size) {
                int waste = hole.size - size;
                if (waste < minWaste) {
                    minWaste = waste;
                    best = hole;
                    bestIndex = i;
                }
            }
        }

        if (best != null) {
            allocateAt(bestIndex, processId, size, holes);
            return new Allocation(processId, best.start, size);
        }
        return null;
    }

    // 最差适配（Worst Fit）
    public Allocation worstFit(int processId, int size, List<Hole> holes) {
        Hole worst = null;
        int worstIndex = -1;
        int maxSize = -1;

        for (int i = 0; i < holes.size(); i++) {
            Hole hole = holes.get(i);
            if (hole.size >= size && hole.size > maxSize) {
                maxSize = hole.size;
                worst = hole;
                worstIndex = i;
            }
        }

        if (worst != null) {
            allocateAt(worstIndex, processId, size, holes);
            return new Allocation(processId, worst.start, size);
        }
        return null;
    }
}
```

#### 碎片问题

| 碎片类型 | 产生原因 | 解决方案 |
|---------|---------|---------|
| 内部碎片 | 分配了但没用到 | 减小分区粒度 |
| 外部碎片 | 空闲但不连续 | 紧凑（Compaction） |

> **紧凑（Compaction）**：把内存中的进程挪动位置，让空闲空间合并。但开销巨大，需要重定位所有进程。


## 非连续内存分配

**连续分配的致命问题：外部碎片**。解决思路：**允许物理内存不连续**。

### 核心思想

```
连续分配：
进程A: ┌────────────────┐    物理内存: 100个连续位置被占满
进程B: ┌────────────────┐         ↓
进程C: ┌────────────────┐    无法分配大进程

非连续分配：
进程A: ┌────┐  ┌────┐  ┌────┐    物理内存: 分散在各处，但加起来够用
      │ A1 │→│ A2 │→│ A3 │         ↓
      └────┘  └────┘  └────┘    通过页表映射访问
```

### 分页机制（Paging）

**把物理内存和虚拟内存都划分成固定大小的块。**

```
虚拟地址空间（进程看到的世界）：
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ V0 │ V1 │ V2 │ V3 │ V4 │ V5 │ V6 │ V7 │  ← 8个虚拟页
└────┴────┴────┴────┴────┴────┴────┴────┘
 页号      0    1    2    3    4    5    6    7

物理内存（实际硬件）：
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ P0 │ P1 │ P2 │ P3 │ P4 │ P5 │ P6 │ P7 │  ← 8个物理帧
└────┴────┴────┴────┴────┴────┴────┴────┘
 帧号     0    1    2    3    4    5    6    7

页表（映射关系）：
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ V0→P2│ V1→P5│ V2→P1│ V3→P7│ V4→│ V5→P3│ V6→│ V7→P6│
└────┴────┴────┴────┴────┴────┴────┴────┘
```

**地址转换：**

```java
// 虚拟地址 = 页号 + 页内偏移
// 物理地址 = 帧号 × 帧大小 + 页内偏移

public class PageTable {
    private static final int PAGE_SIZE = 4096;  // 4KB

    // 虚拟地址转物理地址
    public long translate(int virtualAddress, int[] pageTable) {
        int pageNumber = virtualAddress / PAGE_SIZE;      // 页号
        int offset = virtualAddress % PAGE_SIZE;           // 页内偏移

        int frameNumber = pageTable[pageNumber];           // 查页表
        if (frameNumber == -1) {
            throw new PageFaultException("页不在内存中");
        }

        int physicalAddress = frameNumber * PAGE_SIZE + offset;
        return physicalAddress;
    }

    // 示例
    public static void main(String[] args) {
        PageTable pt = new PageTable();

        // 假设页表：页0→帧3，页1→帧1，页2→→帧5（不存在）
        int[] pageTable = {3, 1, -1, 2, 0, 4};

        // 访问虚拟地址 2048 (页0，偏移0)
        long physAddr1 = pt.translate(2048, pageTable);
        System.out.println("虚拟地址2048 → 物理地址" + physAddr1);
        // 计算：页0→帧3，偏移0 → 3×4096+0 = 12288

        // 访问虚拟地址 8196 (页2，偏移4) → 触发缺页异常
        try {
            long physAddr2 = pt.translate(8196, pageTable);
        } catch (PageFaultException e) {
            System.out.println("缺页异常！需要从磁盘加载页2");
        }
    }
}
```

### 分段机制（Segmentation）

**分页是固定大小的块，分段是逻辑上的大小。**

```
进程的视角（分段）：
┌──────────────────────────┐
│        代码段（Text）      │  ← 大小由代码决定
├──────────────────────────┤
│        数据段（Data）      │  ← 大小由全局变量决定
├──────────────────────────┤
│        堆（Heap）          │  ← 大小由malloc决定
├──────────────────────────┤
│        栈（Stack）         │  ← 大小由递归深度决定
└──────────────────────────┘

段表：
┌──────┬────────┬────────┬────────┐
│段号  │  基址   │ 界限   │ 权限   │
├──────┼────────┼────────┼────────┤
│  0   │ 0x1000 │  4KB   │  只读   │ ← 代码段
│  1   │ 0x2000 │  8KB   │  读写   │ ← 数据段
│  2   │ 0x5000 │  动态  │  读写   │ ← 堆
│  3   │ 0x9000 │  1MB   │  读写   │ ← 栈
└──────┴────────┴────────┴────────┘
```

### 段页式管理

**结合段和页的优点——先分段（逻辑），再分页（物理）。**

```
逻辑地址: 段号 + 段内地址
         ↓
段表查找: 得到段基址 + 段限长
         ↓
段内地址分解: 页号 + 页内偏移
              ↓
页表查找: 得到帧号 + 帧内偏移
         ↓
物理地址: 帧号 × 帧大小 + 帧内偏移
```


## 内存管理方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|-----|-----|-----|---------|
| 单一连续 | 简单 | 内存利用率极低 | 早期单任务系统 |
| 固定分区 | 简单 | 内部碎片、并发受限 | 早期批处理 |
| 可变分区 | 无内部碎片 | 外部碎片 | 越来越少用 |
| 分页 | 无外部碎片、共享方便 | 内部碎片（尾部） | 现代操作系统 |
| 分段 | 符合逻辑视图、共享 | 外部碎片 | 需要逻辑视图的场景 |
| 段页式 | 兼具两者优点 | 复杂度高 | 大型系统 |


## Java中的内存管理

Java的内存管理完全由JVM负责，对程序员透明：

```java
public class MemoryManagement {
    public static void main(String[] args) {
        // JVM内存结构
        // ┌─────────────────────────────────────┐
        // │           堆（Heap）               │
        // │  ┌─────────────┬─────────────┐    │
        // │  │   Survivor   │   Survivor   │    │
        // │  │     S0       │     S1       │    │
        // │  ├─────────────┴─────────────┤    │
        // │  │         Eden               │    │
        // │  └───────────────────────────┘    │
        // │  ┌───────────────────────────┐    │
        // │  │        Old Generation      │    │
        // │  └───────────────────────────┘    │
        // ├─────────────────────────────────────┤
        // │       元空间（Metaspace）           │
        // ├─────────────────────────────────────┤
        // │         虚拟机栈（Stack）           │
        // ├─────────────────────────────────────┤
        // │       本地方法栈（Native Stack）     │
        // └─────────────────────────────────────┘

        // JVM的分页优化：使用大页（HugePages）减少TLBmiss
        // JVM的内存分配：TLAB（Thread Local Allocation Buffer）
        // - 每个线程在堆中预分配一块区域用于对象分配
        // - 减少多线程竞争，提高分配效率

        // 查看JVM内存参数
        Runtime rt = Runtime.getRuntime();
        System.out.println("最大堆内存: " + rt.maxMemory() / 1024 / 1024 + " MB");
        System.out.println("总堆内存: " + rt.totalMemory() / 1024 / 1024 + " MB");
        System.out.println("空闲堆内存: " + rt.freeMemory() / 1024 / 1024 + " MB");
    }
}
```


## 面试追问方向

- **内部碎片和外部碎片的区别是什么？**
  提示：分配单元内部 vs 分配单元之间。
- **分页和分段的核心区别是什么？**
  提示：固定vs可变大小、视角（物理vs逻辑）。
- **段页式管理是如何工作的？**
  提示：先查段表，再查页表。
- **JVM的内存管理和操作系统的内存管理有什么关系？**
  提示：JVM在操作系统之上又做了一层封装。
