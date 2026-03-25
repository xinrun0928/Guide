# MAT 内存分析工具：从堆转储到泄漏点

MAT（Memory Analyzer Tool）是分析堆转储文件的利器。

用它可以快速定位内存泄漏的根源。

---

## MAT 简介

### 下载与安装

```bash
# 下载地址：https://eclipse.org/mat/
# 独立版本无需安装，解压即用
unzip mat.zip
./mat/MemoryAnalyzer
```

### 打开堆转储文件

```bash
# 方法 1：命令行打开
./mat ParseHeapDump.sh /path/to/heap.hprof

# 方法 2：GUI 打开
./mat/MemoryAnalyzer &
# File → Open Heap Dump → 选择 .hprof 文件
```

---

## 核心概念

### Shallow Heap vs Retained Heap

```
┌─────────────────────────────────────────────────────────────┐
│  Shallow Heap vs Retained Heap                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Shallow Heap（浅堆）：                                      │
│  - 对象本身占用的内存                                        │
│  - int: 4 字节, 对象头: 12 字节, 引用: 4/8 字节             │
│                                                              │
│  Retained Heap（深堆）：                                     │
│  - 对象本身 + 所有可达对象的内存总和                         │
│  - A 持有 B、C，B 持有 D                                   │
│  - A 的 Retained = A + B + C + D                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  A (Shallow=100B)                                    │  │
│  │  ├── B (Shallow=100B)                               │  │
│  │  │   └── D (Shallow=50B)                            │  │
│  │  └── C (Shallow=100B)                               │  │
│  │                                                      │  │
│  │  A.retained = 100 + 100 + 50 + 100 = 350B           │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Dominator Tree

```
┌─────────────────────────────────────────────────────────────┐
│  Dominator Tree（支配树）                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  支配关系：如果所有到达 N 的路径都经过 M，则 M 支配 N       │
│                                                              │
│  原对象图：                    Dominator Tree：              │
│                                                              │
│       A ─┬─ B ─ D                 A                         │
│          │                         │                         │
│          ├─ C                     B ─ D                     │
│          │                         │                         │
│          └─ E ─ F                 C                         │
│                                    │                         │
│                                    E ─ F                     │
│                                                              │
│  A 是所有对象的支配者                                        │
│  B 支配 D，因为所有到 D 的路径都经过 B                      │
│  E 支配 F，因为所有到 F 的路径都经过 E                      │
│                                                              │
│  作用：找到内存泄漏的「根」                                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心功能

### 1. Histogram（直方图）

**作用**：查看所有类的实例数量和内存占用

```
操作步骤：
1. 点击工具栏 "Histogram"
2. 输入类名过滤（如：String、HashMap）
3. 按 Shallow Heap 或 Retained Heap 排序
4. 右键 → List Objects → 查看实例列表

示例：查找 String 对象
- 输入 "java.lang.String"
- 按 Retained Heap 排序
- 发现大量重复的 String
```

### 2. Dominator Tree（支配树）

**作用**：找到内存泄漏的根源

```
操作步骤：
1. 点击工具栏 "Dominator Tree"
2. 展开树结构
3. 找到占用内存最大的分支
4. 追溯到根节点（泄漏点）

示例：Cache 没有上限
- Cache 对象占用 80% 堆内存
- 展开 Cache → Map → Entry[] → Value
- 发现大量缓存对象
```

### 3. Leak Suspects（泄漏可疑点）

**作用**：自动分析内存泄漏

```
操作步骤：
1. 打开堆转储后，点击 "Leak Suspects"
2. MAT 自动分析
3. 查看报告中的可疑点

报告内容：
- Problem 1: 占用 XX% 堆内存的对象
- Shortest Paths to the Accumulation Point（到泄漏点的最短路径）
- See stacktrace（堆栈信息）
```

### 4. Top Consumers（最大的消费者）

**作用**：找出占用内存最多的类和包

```
操作步骤：
1. 点击工具栏 "Top Consumers"
2. 查看按包和类分组的大对象
3. 点击进入详情

用途：
- 快速定位哪个包/类占用最多内存
- 指导优化方向
```

### 5. OQL（对象查询语言）

**作用**：SQL 风格查询对象

```sql
-- 查询所有大 String
SELECT * FROM java.lang.String
WHERE toString().length() > 1000

-- 查询特定类的对象
SELECT * FROM com.example.MyClass
WHERE fieldName = 'specificValue'

-- 查询超过某大小的集合
SELECT * FROM java.util.HashMap
WHERE size() > 1000

-- 查询持有特定对象引用的类
SELECT * FROM java.lang.Object
WHERE objects.@ containing /pattern/
```

---

## 实战案例

### 案例 1：静态集合内存泄漏

```java
// 问题代码
public class StaticMapLeak {
    private static final Map<String, Object> cache = new HashMap<>();
    public void add(String key, Object value) {
        cache.put(key, value);  // 永不清理
    }
}
```

### MAT 分析过程

```
1. 打开堆转储
   File → Open Heap Dump → heap.hprof

2. 打开 Leak Suspects
   → 发现 "Problem 1: 85% of the heap is used by one object"

3. 查看支配树
   → StaticMapLeak.cache → HashMap → HashMap.Entry[] → 大量对象

4. 右键 → Path to GC Roots → exclude weak/soft references
   → 发现是 static 字段持有引用

5. 结论：StaticMapLeak.cache 是内存泄漏点
```

### 案例 2：ThreadLocal 未清理

```java
// 问题代码
public class ThreadLocalLeak {
    private static final ThreadLocal<Object> tl = new ThreadLocal<>();
    public void process() {
        tl.set(new Object());
        // 没有 remove()
    }
}
```

### MAT 分析过程

```
1. 打开堆转储
2. 搜索 ThreadLocal
   Histogram → 搜索 "ThreadLocal"
3. 查看实例
   List Objects → with outgoing references
4. 展开 ThreadLocalMap
   → Entry[] → Entry.key（ThreadLocal）
   → Entry.value（我们放入的对象）
5. Path to GC Roots
   → 找到持有引用的 Thread
```

### 案例 3：连接池泄漏

```java
// 问题代码
public class ConnectionLeak {
    private DataSource ds;
    public List<Object> query() throws SQLException {
        Connection conn = ds.getConnection();
        // 忘记关闭连接
        return executeQuery(conn);
    }
}
```

### MAT 分析过程

```
1. 打开堆转储
2. 搜索 Connection
   Histogram → 搜索 "Connection"
3. 发现大量未关闭的 Connection
4. Path to GC Roots
   → 追溯到 ConnectionLeak.query() 方法
5. 查看对象引用链
   → Connection → LinkedBlockingQueue → DataSource
```

---

## 常用技巧

### 找出重复的 String

```
Histogram → java.lang.String → 按 Retained Heap 排序
→ 找出占用内存最多的 String
→ 查看是否可以通过 String.intern() 优化
```

### 找出大数组

```
Histogram → 选择 "array" 类
→ 按 Retained Heap 排序
→ 找出占用内存最大的数组
→ 确认是否是必要的大数组
```

### 找出类加载器泄漏

```
Histogram → 搜索 ClassLoader
→ 查看有多少 ClassLoader 实例
→ 按 Retained Heap 排序
→ 检查是否有旧的 ClassLoader 没有卸载
```

### 导出分析报告

```bash
# 命令行生成报告
./ParseHeapDump.sh heap.hprof org.eclipse.mat.api:suspects
# 生成 Leak Suspects 报告

./ParseHeapDump.sh heap.hprof org.eclipse.mat.api:top_components
# 生成 Top Components 报告
```

---

## 与其他工具对比

| 工具 | 优点 | 缺点 |
|-----|------|------|
| MAT | 功能强大，免费开源 | 需要导出堆转储 |
| VisualVM | JDK 自带，集成性好 | 功能相对简单 |
| JProfiler | 商业软件，功能全面 | 需要付费 |
| async-profiler | CPU/内存采样，无需堆转储 | 不能精确分析对象引用 |

---

## 面试追问方向

- MAT 的 Dominator Tree 和 Histogram 有什么区别？
- 什么是 Shallow Heap 和 Retained Heap？它们的关系是什么？
- 如何用 MAT 找出内存泄漏的根源？
- ThreadLocal 内存泄漏在 MAT 中是什么表现？
- OQL 是什么？如何用它做高级查询？
- 如果堆转储文件很大，MAT 如何处理？
