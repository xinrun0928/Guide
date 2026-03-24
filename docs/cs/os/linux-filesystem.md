# Linux文件系统：Ext4与inode

你知道Linux中「一切皆文件」意味着什么吗？
磁盘、键盘、网络连接、进程信息——都统一用文件表示。
这种优雅的设计，离不开Ext4文件系统和inode机制。


## Linux文件系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    VFS（虚拟文件系统）                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  Ext4    │ │   XFS    │ │ Btrfs   │ │  vfat   │      │
│  │  文件系统 │ │  文件系统 │ │  文件系统 │ │ 文件系统  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│                     ↓ 操作接口统一化                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  super_block  │  inode  │  dentry  │  file          │ │
│  │  超级块       │  索引节点│  目录项  │  文件          │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### VFS的核心数据结构

```c
// 超级块：整个文件系统的元信息
struct super_block {
    struct list_head s_list;           // 超级块链表
    unsigned long s_blocksize;          // 块大小
    unsigned long long s_maxbytes;      // 最大文件大小
    struct inode *s_root;              // 根目录inode
    struct super_operations *s_op;       // 超级块操作
    // ...
};

// inode：文件的元信息
struct inode {
    unsigned long i_ino;                // inode编号
    umode_t i_mode;                     // 文件类型和权限
    unsigned int i_nlink;                // 硬链接数
    loff_t i_size;                       // 文件大小
    struct timespec i_atime;            // 访问时间
    struct timespec i_mtime;            // 修改时间
    struct timespec i_ctime;            // 状态改变时间
    struct inode_operations *i_op;       // inode操作
    struct super_block *i_sb;           // 所属超级块
    union {
        struct ext4_inode_info *ext4_i;  // Ext4专用
        // 其他文件系统专用数据...
    };
    // ...
};
```


## Ext4文件系统结构

```
┌─────────────────────────────────────────────────────────────┐
│                    Ext4磁盘布局                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  引导块 │      块组0      │      块组1      │   ...   │ 块组N│
│  (Boot) │                │                │         │       │
│  1024B  │ ┌────────────┐  │ ┌────────────┐  │         │       │
│         │ │  超级块    │  │ │  超级块副本  │  │         │       │
│         │ ├────────────┤  │ ├────────────┤  │         │       │
│         │ │  块组描述符 │  │ │ 块组描述符副本│ │         │       │
│         │ ├────────────┤  │ ├────────────┤  │         │       │
│         │ │ 数据块位图  │  │ │ 数据块位图副本│ │         │       │
│         │ ├────────────┤  │ ├────────────┤  │         │       │
│         │ │ inode位图  │  │ │ inode位图副本│ │         │       │
│         │ ├────────────┤  │ ├────────────┤  │         │       │
│         │ │ inode表    │  │ │ inode表    │  │         │       │
│         │ ├────────────┤  │ ├────────────┤  │         │       │
│         │ │ 数据块      │  │ │ 数据块      │  │         │       │
│         │ └────────────┘  │ └────────────┘  │         │       │
│         └─────────────────┴─────────────────┴─────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Ext4的特点

| 特性 | 说明 |
|-----|-----|
| 日志（Journal） | 记录元数据操作，保证一致性 |
| Extent | 用区间代替块指针，减少元数据 |
| 延迟分配 | 优化写入性能 |
| 块组 | 将磁盘分成块组，减少碎片 |
| 碎片整理 | 支持在线碎片整理 |


## inode详解

### inode的存储

```c
// Ext4 inode结构
struct ext4_inode {
    __le16  i_mode;         // 文件类型和权限
    __le16  i_uid;          // UID
    __le32  i_size_lo;      // 文件大小低32位
    __le32  i_atime;        // 访问时间
    __le32  i_ctime;        // 创建时间
    __le32  i_mtime;        // 修改时间
    __le32  i_dtime;        // 删除时间
    __le16  i_gid;          // GID
    __le16  i_links_count;  // 硬链接数
    __le32  i_blocks_lo;    // 占用的块数（512字节单位）
    __le32  i_flags;        // 文件标志
    union {
        struct {
            __le32  l_i_version;
        } linux1;
        // ...
    };
    __le32  i_block[15];    // 块指针数组！
    // ...
};
```

### Extent存储（Ext4改进）

```c
// Ext4 extent结构
struct ext4_extent {
    __le32  ee_block;   // 逻辑块号
    __le16  ee_len;     // 区间长度（连续块数）
    __le16  ee_start_hi; // 物理块号高16位
    __le32  ee_start_lo; // 物理块号低32位
};

// extent_idx: extent树节点
struct ext4_extent_idx {
    __le32  ei_block;     // 子树覆盖的逻辑块号
    __le32  ei_leaf_lo;   // 子树物理块号低32位
    __le16  ei_leaf_hi;   // 子树物理块号高16位
    __le16  ei_unused;
};
```

```
Extent vs 传统块指针：

传统（假设文件占4个块）：
[块5][块12][块23][块45] → 4个指针

Extent：
[起始块:5, 长度:4] → 1个extent（块5-8）
节省了3个指针空间！
```


## 文件操作流程

### 打开文件

```bash
# strace跟踪文件打开过程
strace -e open,openat cat /etc/passwd

# 输出示例：
# openat(AT_FDCWD, "/etc/passwd", O_RDONLY) = 3
```

### 读取文件

```
用户程序: read(fd, buffer, size)
         ↓
VFS: sys_read()
         ↓
Ext4: ext4_file_read_iter()
         ↓
Page Cache: 读取缓存页
         ↓
物理磁盘: 从Ext4读取数据块
```

### 创建文件

```c
// 内核源码中的文件创建
long do_sys_open(int dfd, const char *filename, int flags, umode_t mode) {
    struct path path;
    struct file *f;

    // 1. 解析路径
    path = do_file_open_root(dfd, filename, flags, mode);

    // 2. 分配file结构
    f = alloc_empty_file(flags, current_cred());

    // 3. 关联到fd
    fd = get_unused_fd_flags(flags);
    fd_install(fd, f);

    return fd;
}
```


## 文件系统的一致性

### 日志（Journal）

```bash
# 查看文件系统日志选项
dumpe2fs -h /dev/sda1 | grep -i journal

# 输出示例：
# Journal inode:        8
# Journal backup:       inode blocks
# Journal size:         128M
# Journal features:      (include)
```

```
日志的三种模式：

1. writeback模式：只记录元数据操作，不记录数据
   - 速度快，可能丢失数据

2. ordered模式：元数据操作前先提交数据
   - 平衡速度和安全性

3. journal模式：记录所有操作
   - 最安全，最慢
```

### fsck文件系统检查

```bash
# 卸载后检查文件系统
umount /dev/sda1
fsck.ext4 -p /dev/sda1   # 自动修复
fsck.ext4 -f /dev/sda1   # 强制检查

# 在线检查（不推荐）
e2fsck /dev/sda1
```


## 实用命令

```bash
# 查看文件类型
file /bin/bash

# 查看inode信息
stat /etc/passwd

# 查看文件inode编号
ls -li /etc/passwd

# 查找特定inode的文件
find / -inum 123456

# 查看磁盘使用
df -h

# 查看文件系统的inode使用
df -i

# 查看目录大小
du -sh /var/log

# 查看文件系统的块大小
tune2fs -l /dev/sda1 | grep "Block size"
```

### 查看文件系统详细信息

```bash
# 查看Ext4文件系统信息
dumpe2fs /dev/sda1 | head -50

# 查看挂载的文件系统
mount | grep ext4

# 查看文件系统的UUID
blkid /dev/sda1
```


## 实际案例：日志文件系统的工作原理

```c
// 日志文件系统的基本流程
void journaled_write(struct file* file, const char* data, size_t size) {
    // 1. 将操作记录写入日志
    struct journal_entry* entry = allocate_journal_entry();
    entry->operation = WRITE;
    entry->data = data;
    entry->inode = file->inode;
    journal_write_entry(entry);

    // 2. 执行实际写入
    write_data_to_disk(file->inode, data, size);

    // 3. 标记日志条目为已提交
    journal_commit_entry(entry);

    // 4. 将提交标记写入磁盘
    write_commit_block();

    // 如果系统在步骤2和4之间崩溃
    // 重启后，journal会检测到未提交的操作
    // 要么回滚，要么重做
}
```


## 面试追问方向

- **Ext4和Ext3的主要区别是什么？**
  提示：Extent存储、延迟分配、日志校验。
- **inode存储了哪些信息？为什么一个文件系统有inode数量限制？**
  提示：元数据、文件属性、块指针。
- **什么是日志文件系统？它如何保证一致性？**
  提示：两阶段提交、检查点。
- **硬链接和软链接的区别是什么？**
  提示：inode是否共享、是否可以跨文件系统。
