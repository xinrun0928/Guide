# jmap、jhat、MAT 内存分析三件套

JVM 内存分析有三件套：jmap、jhat、MAT。

- **jmap**：生成堆转储
- **jhat**：分析堆转储（已被淘汰）
- **MAT**：Eclipse Memory Analyzer，强大的可视化分析工具

今天，我们来详细讲解这三件套的使用方法。

---

## 一、jmap：堆转储生成器

### 1.1 jmap 常用命令

```bash
# 查看内存映射信息
jmap -heap <pid>

# 输出示例：
Heap Configuration:
   MaxHeapSize              = 4294967296 (4.0GB)
   NewSize                  = 1073741824 (1024.0MB)
   OldSize                  = 3221225472 (3072.0MB)
   ...
Heap Usage:
   PS Young Generation
   Eden Space:
      capacity = 872415232 (832.0MB)
      used     = 423456789 (403.8MB)
      free     = 448958443 (428.2MB)
      48.51% used
   ...
```

```bash
# 查看对象统计信息
jmap -histo <pid>

# 输出示例：
num     #instances         #bytes  class name
----------------------------------------------
   1:         12345      123456789  [Ljava.lang.Object;
   2:         23456       8765432  java.lang.String
   3:         34567       4567890  java.util.HashMap$Node
```

```bash
# 生成堆转储文件
jmap -dump:format=b,file=/tmp/heap.hprof <pid>

# live 参数只转储活跃对象（推荐）
jmap -dump:live,format=b,file=/tmp/heap_live.hprof <pid>
```

### 1.2 常用参数组合

```bash
# 完整诊断命令
jmap -heap <pid>           # 查看堆配置和使用
jmap -histo:live <pid>      # 查看活跃对象统计
jmap -permstat <pid>       # JDK 8 查看永久代统计
jmap -finalizerinfo <pid>  # 查看等待 Finalizer 线程执行的对象
```

### 1.3 jmap 注意事项

1. **生产环境慎用**：jmap -dump 会触发 Full GC，谨慎使用
2. **使用 live 参数**：减少转储的数据量
3. **磁盘空间**：堆转储文件可能很大（数 GB），确保磁盘空间充足
4. **JDK 11+**：推荐使用 `jcmd <pid> GC.heap_dump`

---

## 二、jhat：堆转储分析器（已淘汰）

### 2.1 jhat 的历史

jhat 是 JDK 自带的堆转储分析工具，但从 JDK 9 开始被移除。原因是：

1. 功能太弱
2. 性能差
3. 有更好的替代工具（MAT、VisualVM）

### 2.2 为什么不推荐 jhat

```bash
# jhat 的使用
jhat /tmp/heap.hprof
# 然后在浏览器打开 http://localhost:7000
```

**问题**：
- 界面简陋
- 大文件分析很慢
- 无法进行深度分析
- 已被官方淘汰

### 2.3 替代工具

| 工具 | 优点 | 缺点 |
|-----|-----|-----|
| MAT | 功能强大、可视化好 | 需要独立下载 |
| VisualVM | JDK 自带、轻量级 | 功能相对较弱 |
| jconsole | JDK 自带、实时监控 | 无法分析堆转储 |

---

## 三、Eclipse MAT：专业堆分析工具

### 3.1 下载与安装

下载地址：https:// eclipse.org/mat/downloads.php

下载 `MemoryAnalyzer-*.zip`，解压即可使用。

### 3.2 打开堆转储文件

1. 启动 MAT
2. File → Open Heap Dump
3. 选择 `.hprof` 文件
4. 选择分析报告类型：
   - **Leak Suspects Report**：自动检测泄漏点
   - **Component Report**：按组件分析
   - **直接打开**：不生成报告

### 3.3 核心功能介绍

#### 3.3.1 Leak Suspects（泄漏怀疑点）

这是最重要的功能，MAT 会自动分析并报告可疑的内存泄漏点：

```markdown
## Leak Suspect 1

Problem Summary:
One instance of "java.util.HashMap" 
loaded by "com.example.MyClassLoader" 
occupies 1,234,567,890 bytes (45.67%) of 2,702,345,678 bytes total.

Short Priority:
The Garbage Collection statistics show that the heap usage is constantly increasing 
and almost all available space is used for HashMap entries.
```

#### 3.3.2 Histogram（直方图）

显示每个类的实例数量和内存占用：

1. 点击 `Window` → `Navigation View` → `Histogram`
2. 按 `Retained Heap` 排序
3. 可以按类名、包名过滤
4. 右键可以查看对象的引用链

#### 3.3.3 Dominator Tree（支配树）

显示内存占用的树状结构：

1. 对象的 Retained Heap = 对象本身 + 所有它引用的对象
2. Dominator Tree 帮助找到内存占用的根源

#### 3.3.4 Top Consumers（最大的对象）

显示占用内存最多的类和包：

1. 点击 `Navigate` → `Go to`
2. 选择 `Top Consumers`
3. 显示占用内存最多的类

#### 3.3.5 OQL（对象查询语言）

类似 SQL 的查询语言：

```sql
-- 查找所有大于 10MB 的 HashMap
SELECT * FROM java.util.HashMap WHERE @retainedHeapSize > 10485760

-- 查找包含特定字符串的 String 对象
SELECT * FROM java.lang.String WHERE toString().indexOf("specific_key") >= 0

-- 查找特定类的所有实例
SELECT * FROM com.example.MyCache WHERE objectid = 12345
```

### 3.4 常用分析技巧

#### 3.4.1 查找内存泄漏

1. 打开 Histogram
2. 按 Retained Heap 排序
3. 找到占用最大的对象
4. 右键 → `Path To GC Roots` → `exclude weak/soft references`
5. 分析引用链，找到泄漏点

#### 3.4.2 查找重复字符串

1. Histogram 中选择 `java.lang.String`
2. 右键 → `Merge Shallow to GC Roots` → `with duplicate strings`
3. 找出重复的字符串

#### 3.4.3 分析集合类

1. 查找 `HashMap`、`ArrayList` 等
2. 查看其 `table` 或 `elementData` 字段
3. 分析集合中的内容

#### 3.4.4 分析类加载器泄漏

1. 查找 `ClassLoader` 对象
2. 查看其加载的所有类
3. 分析是否有类加载器未释放

### 3.5 MAT 高级技巧

#### 3.5.1 比较两个堆转储

如果有两个时间点的堆转储，可以比较差异：

```bash
# 1. 使用 ParseHeapDump.sh 比较
$MAT_HOME/plugins/org.eclipse.mat.api_*/sumn
```

#### 3.5.2 使用自定义解析器

MAT 支持插件扩展：

```xml
<!-- parsers.xml -->
&lt;parser class="org.eclipse.mat.parser.SnapshotFactory" 
        classVersion="HPROF_J2SE_1.5" uri="hprof"
        description="HPROF Heap Dump"
        version="1.0.2"/&gt;
```

#### 3.5.3 导出分析结果

```
File → Export → To CSV
```

导出的 CSV 可以用 Excel 进一步分析。

---

## 四、实战案例

### 4.1 场景

应用运行几天后 OOM，我们需要分析堆转储。

### 4.2 完整分析流程

```bash
# 1. 生成堆转储（应用已 OOM，可以直接复制）
ls -lh /var/log/heapdump*.hprof

# 如果没有自动生成
jmap -dump:format=b,file=/tmp/heap.hprof <pid>

# 2. 复制到本地
scp user@server:/var/log/heapdump.hprof .

# 3. 使用 MAT 分析
./MemoryAnalyzer /path/to/heapdump.hprof
```

### 4.3 MAT 分析步骤

1. **打开 Leak Suspects 报告**
2. **查看 Leak Suspect 1**：通常是最可疑的泄漏点
3. **点击 "see stacktrace"**：查看创建泄漏对象的代码路径
4. **点击 "Accumulation Point"**：查看对象累积的地方
5. **进一步分析**：如果不够明确，使用 Histogram 或 Dominator Tree

---

## 五、工具选择建议

### 5.1 工具对比

| 工具 | 适用场景 | 优点 | 缺点 |
|-----|---------|-----|-----|
| jmap | 生成堆转储 | JDK 内置 | 仅生成 |
| MAT | 深度分析 | 功能强大 | 需要独立下载 |
| VisualVM | 轻量分析 | JDK 内置 | 功能较弱 |
| Arthas | 在线诊断 | 无需停止服务 | 无法深度分析 |

### 5.2 最佳实践

1. **日常监控**：使用 Arthas 在线观察
2. **问题排查**：使用 jmap 生成堆转储 + MAT 分析
3. **内存泄漏**：优先使用 MAT 的 Leak Suspects
4. **容量规划**：使用 Histogram 统计对象分布

---

## 总结

JVM 内存分析三件套的核心要点：

1. **jmap**：生成堆转储，生产环境谨慎使用
2. **MAT**：专业分析工具，Leak Suspects 是利器
3. **OQL**：类似 SQL 的对象查询语言
4. **分析流程**：生成转储 → 打开 Leak Suspects → 定位问题
5. **工具配合**：jmap + MAT 是最佳组合

---

## 思考题

使用 jmap -dump:live 生成堆转储时，JVM 会先触发一次 Full GC。这意味着什么？在生产环境中使用需要注意什么？

提示：考虑 Full GC 对应用的影响，以及如何避免这个问题。
