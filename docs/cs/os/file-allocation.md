# 文件分配方式：连续、链接与索引

你知道文件是怎么存在磁盘上的吗？
磁盘上有没有「空洞」？删除文件后，空间是怎么回收的？

这一切都取决于**文件分配方式**。


## 三种分配方式

```
┌──────────────────────────────────────────────────────────┐
│                    文件分配方式                           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  连续分配:  文件占用连续磁盘块                            │
│            ┌────┬────┬────┬────┬────┬────┬────┐        │
│            │ F1 │ F1 │ F1 │ F2 │ F2 │ F3 │ F3 │        │
│            └────┴────┴────┴────┴────┴────┴────┘        │
│                                                          │
│  链接分配:  文件占用不连续的块，块间用指针链接               │
│            ┌────┐   ┌────┐   ┌────┐   ┌────┐          │
│            │ F1 │ → │ F1 │ → │ F2 │ → │ F3 │ → NULL   │
│            └────┘   └────┘   └────┘   └────┘           │
│                                                          │
│  索引分配:  文件有一个索引块，记录所有数据块位置            │
│            ┌────────┐                                   │
│            │索引块   │──→ [块1][块2][块3]...            │
│            └────────┘                                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```


## 连续分配

**最简单的方案——文件占据一组连续的磁盘块。**

### 工作原理

```
文件A，大小3块：从块5开始
文件B，大小2块：从块10开始
文件C，大小4块：从块15开始

磁盘块：
[0][1][2][3][4]│[5][6][7]│[8][9]│[10][11]│[12][13][14]│[15][16][17][18]│...
              文件A    文件B  文件B    文件C      文件C

目录项记录：文件名 + 起始块 + 长度
```

### 优缺点

```
优点:
- 顺序访问速度快（磁头移动少）
- 支持随机访问
- 简单高效

缺点:
- 外部碎片（删除文件后留下的空洞）
- 文件无法动态增长（除非后面有空间）
- 无法共享
```

```java
public class ContinuousAllocation {
    private int[] diskBlocks;  // 磁盘块状态：-1空闲，其他为文件ID
    private Map<Integer, Integer> fileStartBlock;  // 文件起始块
    private Map<Integer, Integer> fileLength;      // 文件长度

    // 分配连续空间
    public int allocate(String fileName, int size) {
        // 首次适配：找第一个足够大的连续空间
        for (int i = 0; i < diskBlocks.length; i++) {
            if (isFree(i, size)) {
                // 分配
                for (int j = 0; j < size; j++) {
                    diskBlocks[i + j] = getNextFileId();
                }
                fileStartBlock.put(getFileId(fileName), i);
                fileLength.put(getFileId(fileName), size);
                return i;  // 返回起始块号
            }
        }
        return -1;  // 分配失败
    }

    // 读取文件
    public byte[] read(String fileName, int offset, int length) {
        int start = fileStartBlock.get(getFileId(fileName));
        return readBlocks(start + offset, length);
    }

    // 问题：无法动态扩展
    public boolean extend(String fileName, int additionalSize) {
        int start = fileStartBlock.get(getFileId(fileName));
        int len = fileLength.get(getFileId(fileName));
        // 检查后面是否有足够空间
        if (isFree(start + len, additionalSize)) {
            // 扩展
            for (int i = len; i < len + additionalSize; i++) {
                diskBlocks[start + i] = getFileId(fileName);
            }
            fileLength.put(getFileId(fileName), len + additionalSize);
            return true;
        }
        return false;  // 后面空间不足
    }
}
```

### 外部碎片问题

```
删除文件A（3块）和文件C（2块）后：
[0][1][2][3][4]│    [F2 ][F2 ]│[5][6][7][8]│      [F3 ][F3 ][F3 ]
              空闲5块      文件B   空闲4块    文件D(4块)

现在需要分配一个新文件E（6块）：
- 总空闲空间 = 5 + 4 = 9块
- 但最大的连续空间只有5块（< 6块）
- 无法分配！
```

> 解决方案：**磁盘紧凑（Compaction）**——把所有文件挪到一起。但开销巨大，需要重定位所有文件。


## 链接分配

**每个块都有指向下一个块的指针，文件不需要连续。**

### 工作原理

```
文件F2的FAT表：
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ 0  │ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │ 7  │ 8  │ 9  │  ← 块号
├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
│-1  │-1  │ 5  │ 7  │ 6  │ 6  │ 3  │-1  │-1  │-1  │  ← FAT表值（下一块号，-1表示文件结束）
│ F1 │ F1 │ F2 │ F2 │ F2 │ F2 │ F2 │ F3 │ F3 │    │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
         起始块: 2
         读取顺序: 2 → 5 → 6 → 3 → 7 → 结束
```

### FAT文件系统

```java
public class FATFileSystem {
    private int[] fat;  // 文件分配表
    private static final int EOF = -1;

    // 分配新块
    public int allocateBlock(int fileId) {
        for (int i = 0; i < fat.length; i++) {
            if (fat[i] == 0) {  // 空闲块
                fat[i] = EOF;  // 标记为文件结束
                return i;
            }
        }
        return -1;
    }

    // 添加块到文件末尾
    public void appendBlock(int lastBlock, int newBlock) {
        fat[lastBlock] = newBlock;  // 更新前一块的指针
        fat[newBlock] = EOF;         // 新块是末尾
    }

    // 读取文件所有块
    public List<Integer> getFileBlocks(int startBlock) {
        List<Integer> blocks = new ArrayList<>();
        int current = startBlock;
        while (current != EOF) {
            blocks.add(current);
            current = fat[current];
        }
        return blocks;
    }
}
```

### 优缺点

```
优点:
- 无外部碎片
- 文件可以动态增长
- 简单

缺点:
- 随机访问慢（需要从起始块遍历）
- 指针占用磁盘空间
- 指针损坏导致文件丢失
- FAT表需要常驻内存
```


## 索引分配

**每个文件有一个索引块，记录所有数据块的位置。**

### 工作原理

```
索引分配：
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  文件A的索引块:                                          │
│  ┌─────────┬─────────┬─────────┬─────────┐            │
│  │ 块号: 5 │ 块号: 12 │ 块号: 23 │ 块号: 45 │            │
│  └─────────┴─────────┴─────────┴─────────┘            │
│                                                          │
│  读取文件A的第2块 → 查索引块 → 块号12 → 读取块12          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 多级索引

文件很大时，一个索引块可能不够。

```java
public class MultiLevelIndex {
    private static final int POINTERS_PER_BLOCK = 1024;  // 假设块大小4KB，指针4字节

    // 二级索引
    public int translate(int fileId, int logicalBlock) {
        int[] outerIndex = readOuterIndex(fileId);  // 外层索引
        int innerIndexBlock = outerIndex[logicalBlock / POINTERS_PER_BLOCK];
        int[] innerIndex = readBlock(innerIndexBlock);
        int dataBlock = innerIndex[logicalBlock % POINTERS_PER_BLOCK];
        return dataBlock;
    }
}
```

### 优缺点

```
优点:
- 无外部碎片
- 支持随机访问
- 索引块可以保护（如复制）
- 文件恢复相对容易

缺点:
- 索引块占用额外空间
- 大文件访问需要多次磁盘I/O
- 小文件也至少需要1个索引块
```


## 三种方式对比

| 特性 | 连续分配 | 链接分配 | 索引分配 |
|-----|---------|---------|---------|
| 外部碎片 | 有 | 无 | 无 |
| 随机访问 | 快 | 慢 | 中等 |
| 扩展性 | 差 | 好 | 好 |
| 磁盘I/O | 少 | 多 | 中等 |
| 可靠性 | 差（指针易坏）| 一般 | 好 |
| 实现复杂度 | 简单 | 简单 | 复杂 |


## 实际案例：Ext4的Extent

Ext4使用**Extent（区间）**代替传统的块指针，大幅减少元数据。

```
Ext3（传统块指针）：
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ 5  │ 6  │ 7  │ 8  │ 12 │ 13 │ 14 │ 20 │ 21 │ 22 │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
需要10个条目！

Ext4（Extent）：
┌────────────────────────────────────────────────┐
│  [起始块: 5, 长度: 4] → 块5-8                 │
│  [起始块: 12, 长度: 3] → 块12-14              │
│  [起始块: 20, 长度: 3] → 块20-22              │
└────────────────────────────────────────────────┘
只需要3个条目！
```

```c
// Ext4的extent结构
struct ext4_extent {
    __le32  ee_block;   // 逻辑块号
    __le16  ee_len;     // 区间长度
    __le16  ee_start_hi; // 物理块号高16位
    __le32  ee_start_lo; // 物理块号低32位
};
```


## 面试追问方向

- **连续分配为什么会有外部碎片？如何解决？**
  提示：删除文件后留下空洞，紧凑操作。
- **FAT文件系统的FAT表为什么要常驻内存？**
  提示：每次访问都需要查FAT表。
- **索引分配中，大文件为什么访问慢？**
  提示：多级索引导致多次磁盘I/O。
- **Extent相比传统的块指针有什么优势？**
  提示：减少元数据开销，提高大文件性能。
