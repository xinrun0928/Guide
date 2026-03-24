# 目录实现：文件系统如何组织文件

你有没有想过，`/home/user/documents/report.pdf` 这个路径是怎么找到的？
操作系统从根目录开始，一层一层往下找。

目录，这个看似简单的数据结构，其实是文件系统的核心。


## 目录的本质

**目录也是一种文件**——它的内容是其他文件（或目录）的索引。

```
┌──────────────────────────────────────────────────────────┐
│                    目录的本质                             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  普通文件的内容: 二进制数据                                │
│  目录的内容: 目录项列表                                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 目录文件                                            │   │
│  │ ┌────────────┬────────────┬────────────┐         │   │
│  │ │ 目录项1    │ 目录项2    │ 目录项3    │         │   │
│  │ │ (file.txt) │ (doc.pdf)  │ (subdir/)  │         │   │
│  │ │ inode: 15  │ inode: 23  │ inode: 8   │         │   │
│  │ └────────────┴────────────┴────────────┘         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 目录的实现方式

```
1. 线性列表：目录项顺序存储
   - 查找：O(n)
   - 添加/删除：O(n)
   - 简单

2. 哈希表：目录项通过哈希存储
   - 查找：O(1)平均
   - 添加/删除：O(1)平均
   - 复杂，有哈希冲突

3. B+树：目录项按文件名排序存储
   - 查找：O(log n)
   - 添加/删除：O(log n)
   - 适合大型目录
```


## 目录项的设计

### 固定长度目录项

```
Unix风格（早期）：
┌──────────────────────────────────────────────────────────┐
│  ┌──────────┬──────────┬──────────┐                    │
│  │ inode号  │ 文件名    │ 目录项长度 │                    │
│  │ (4字节)  │ (14字节)  │ (2字节)    │                    │
│  └──────────┴──────────┴──────────┘                    │
│  总共20字节                                             │
│                                                          │
│  问题：文件名最长14字节，不够用！                         │
└──────────────────────────────────────────────────────────┘

Unix风格（现代Ext2/3/4）：
┌──────────────────────────────────────────────────────────┐
│  ┌──────────┬──────────┐                                │
│  │ inode号  │ 文件名    │                                 │
│  │ (4字节)  │ (最多255字节，可变长)                       │
│  └──────────┴──────────┘                                │
│                                                          │
│  使用name_len变长记录文件名长度                           │
└──────────────────────────────────────────────────────────┘

FAT风格：
┌──────────────────────────────────────────────────────────┐
│  ┌──────────┬──────────┬──────────┐                    │
│  │ 文件名    │ 扩展名    │ 起始簇号  │                    │
│  │ (8字节)  │ (3字节)  │ (2字节)  │                    │
│  └──────────┴──────────┴──────────┘                    │
│  总共11字节                                             │
│  缺陷：文件名最多8个字符                                  │
└──────────────────────────────────────────────────────────┘
```

### 目录项的内容

```java
public class DirectoryEntry {
    // Ext2/3/4风格的目录项
    private int inodeNumber;   // inode编号（0表示空目录项）
    private short recordLength; // 本目录项长度
    private byte nameLength;    // 文件名长度
    private byte fileType;      // 文件类型
    private String name;        // 文件名（1-255字符）

    public boolean isEmpty() {
        return inodeNumber == 0;
    }
}
```


## 路径解析

### 从路径到inode

```
路径: /home/user/documents/report.pdf

解析过程：

┌──────────────────────────────────────────────────────────┐
│                                                          │
│  1. 从根目录"/"开始                                      │
│     - 根目录的inode编号是固定的（通常是2）                 │
│                                                          │
│  2. 在根目录中查找"home"                                 │
│     - 读取根目录的数据块                                  │
│     - 遍历目录项，找到name="home"                         │
│     - 得到home的inode编号: 1337                          │
│                                                          │
│  3. 在/home中查找"user"                                 │
│     - 读取inode 1337对应的数据块                         │
│     - 遍历目录项，找到name="user"                        │
│     - 得到user的inode编号: 2048                         │
│                                                          │
│  4. 在/home/user中查找"documents"                        │
│     - 读取inode 2048对应的数据块                         │
│     - 遍历目录项，找到name="documents"                    │
│     - 得到documents的inode编号: 3377                     │
│                                                          │
│  5. 在/home/user/documents中查找"report.pdf"             │
│     - 读取inode 3377对应的数据块                         │
│     - 遍历目录项，找到name="report.pdf"                   │
│     - 得到report.pdf的inode编号: 9988                    │
│                                                          │
│  6. 返回inode 9988，这就是文件的inode                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

```java
public class PathResolver {
    // 解析绝对路径
    public int resolvePath(String path) {
        // 从根目录开始
        int currentInode = ROOT_INODE;
        String[] components = path.split("/");

        for (String name : components) {
            if (name.isEmpty()) continue;  // 跳过空组件

            // 读取当前目录的inode
            Inode inode = readInode(currentInode);

            // 在当前目录中查找下一级
            currentInode = lookupInDirectory(inode, name);

            if (currentInode == -1) {
                throw new FileNotFoundException("Path not found: " + path);
            }
        }

        return currentInode;
    }

    // 在目录中查找特定名称
    private int lookupInDirectory(Inode dirInode, String name) {
        List<DirectoryEntry> entries = readDirectoryEntries(dirInode);

        for (DirectoryEntry entry : entries) {
            if (entry.getName().equals(name)) {
                return entry.getInodeNumber();
            }
        }

        return -1;  // 没找到
    }
}
```

### 当前目录和相对路径

```java
public class CurrentDirectory {
    private int cwdInode;  // 当前工作目录的inode

    // 解析相对路径
    public int resolveRelativePath(String path) {
        if (path.startsWith("/")) {
            return resolvePath(path);  // 绝对路径
        } else {
            // 从当前目录开始解析
            return resolveFrom(cwdInode, path);
        }
    }

    // 从指定目录开始解析路径
    private int resolveFrom(int startInode, String path) {
        int currentInode = startInode;
        String[] components = path.split("/");

        for (String name : components) {
            if (name.isEmpty() || name.equals(".")) {
                continue;  // 跳过空和当前目录
            }
            if (name.equals("..")) {
                // 返回父目录
                currentInode = getParentInode(currentInode);
            } else {
                currentInode = lookupInDirectory(readInode(currentInode), name);
            }
        }

        return currentInode;
    }
}
```


## 文件系统一致性

目录结构必须保持一致性，否则会导致文件系统损坏。

### 问题一：循环目录

```
目录A包含目录B，目录B又包含目录A → 死循环

解决方案：禁止硬链接目录
```

### 问题二：孤零零项

```
目录项指向不存在的inode → 文件"失联"

解决方案：定期检查并修复
```

### 问题三：悬挂引用

```
inode被删除，但还有目录项指向它 → 访问无效

解决方案：引用计数（links_count）
```

```java
public class ConsistencyChecker {
    // 模拟fsck检查
    public void check(FileSystem fs) {
        // 1. 扫描所有目录
        Map<Integer, List<String>> inodeToNames = new HashMap<>();
        for (int inode : fs.getAllInodes()) {
            inodeToNames.put(inode, new ArrayList<>());
        }

        // 2. 建立inode到目录项的映射
        for (Directory dir : fs.getAllDirectories()) {
            for (DirectoryEntry entry : dir.getEntries()) {
                inodeToNames.get(entry.getInode()).add(entry.getName());
            }
        }

        // 3. 检查问题
        for (Map.Entry<Integer, List<String>> entry : inodeToNames.entrySet()) {
            Inode inode = fs.getInode(entry.getKey());

            if (entry.getValue().isEmpty() && inode.getLinksCount() == 0) {
                // 孤零零项：没有目录项指向它
                System.out.println("Orphan inode: " + entry.getKey());
            }

            if (inode.getLinksCount() != entry.getValue().size()) {
                // 链接数不一致
                System.out.println("Link count mismatch for inode: " + entry.getKey());
            }
        }
    }
}
```


## 实际案例：Linux的/proc文件系统

`/proc`是一个特殊的文件系统，内容是运行时系统信息。

```
/proc目录：
┌──────────────────────────────────────────────────────────┐
│  /proc/1/         →  PID 1进程的目录                      │
│  /proc/1/cmdline  →  进程命令行                           │
│  /proc/1/mem      →  进程的内存映像                       │
│  /proc/cpuinfo    →  CPU信息                             │
│  /proc/meminfo    →  内存信息                            │
│  /proc/uptime     →  系统运行时间                         │
└──────────────────────────────────────────────────────────┘

/proc是怎么实现的？
- 不是真正的磁盘文件
- 文件内容是内核动态生成的
- 读取/proc/cpuinfo时，内核生成CPU信息返回给用户
```

```java
public class ProcFileSystem {
    // /proc是一种"伪文件系统"
    // 文件内容不是存储在磁盘上
    // 而是在读取时由内核代码动态生成

    // 实现原理：
    // 1. 注册procfs到VFS
    // 2. 实现readdir()读取目录项
    // 3. 实现read()读取文件内容
    // 4. 内核代码填充缓冲区

    // 类似Java中的动态内容生成
    // response.setContentType("text/html");
    // out.println("当前时间: " + new Date());
}
```


## 面试追问方向

- **目录的本质是什么？为什么说目录也是一种文件？**
  提示：目录内容是目录项列表。
- **硬链接目录有什么问题？为什么禁止？**
  提示：循环引用导致死循环。
- **fsck是什么？它检查哪些问题？**
  提示：孤零零项、链接数不一致、坏块。
- **/proc文件系统是怎么实现的？**
  提示：伪文件系统，内容由内核动态生成。
