# 堆内存溢出（Heap Space OOM）排查流程

线上报警：`java.lang.OutOfMemoryError: Java heap space`

你的应用内存爆炸了。

堆内存溢出是最常见的 OOM 类型，也是最容易排查的一类。关键是：**你要在 OOM 发生的第一时间获取堆转储**，否则重启后就什么都没了。

今天，我们来完整梳理 Heap OOM 的排查流程。

---

## 一、Heap OOM 的典型原因

### 1.1 常见原因一览

| 原因类型 | 典型场景 | 表现特征 |
|---------|---------|---------|
| **内存泄漏** | 集合类无限增长 | 堆内存持续上升，不回落 |
| **一次性加载过多数据** | 一次查询返回百万条 | 瞬时 OOM |
| **大对象** | 加载大文件到内存 | 瞬时 OOM |
| **流量突增** | 秒杀活动 | 突发性 OOM |
| **代码 bug** | 递归无限创建对象 | 瞬时 OOM |

### 1.2 代码层面的典型问题

```java
// 问题 1：静态集合无限增长
public class MemoryLeakExample {
    private static final List&lt;Object&gt; cache = new ArrayList&lt;&gt;();
    
    public void addToCache(Object obj) {
        cache.add(obj);  // 只增不减，内存泄漏
    }
}

// 问题 2：字符串拼接创建大量临时对象
public String badExample(String[] data) {
    String result = "";
    for (String s : data) {
        result += s;  // 每次拼接都创建新 String 对象
    }
    return result;
}

// 问题 3：递归导致栈溢出（实际是 StackOverflow）
public int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);  // 递归过深
}
```

---

## 二、OOM 发生前的准备工作

### 2.1 开启 HeapDump

**这是最重要的一步！** 必须在 OOM 发生时就生成堆转储，否则重启后就什么都没了。

```bash
# 方案 1：OOM 时自动生成堆转储（JDK 8u45+ 推荐）
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/heapdump.hprof

# 方案 2：通过 JMX 动态开启
jinfo -flag +HeapDumpOnOutOfMemoryError <pid>

# 方案 3：使用 Arthas 手动触发
heapdump --live /tmp/heap.hprof
```

### 2.2 监控配置

```yaml
# Prometheus + JMX Exporter 示例
jmx:
  port: 9999
  rules:
    - pattern: 'java.lang<type=Memory><HeapMemoryUsage>(\w+)'
      name: jvm_heap_$1
```

### 2.3 告警配置

```yaml
# Prometheus 告警规则
- alert: HeapUsageHigh
  expr: jvm_heap_used / jvm_heap_max > 0.85
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "堆内存使用率超过 85%"
    
- alert: HeapOOM
  expr: jvm_oom_total > 0
  labels:
    severity: critical
  annotations:
    summary: "发生 OOM"
```

---

## 三、OOM 发生时的排查步骤

### 3.1 第一步：获取堆转储

如果已经配置了自动 HeapDump，文件会生成在指定路径：

```bash
# 查看堆转储文件
ls -lh /var/log/heapdump*.hprof

# 如果没有自动生成，手动获取
jmap -dump:format=b,file=/tmp/heap.hprof <pid>
```

### 3.2 第二步：分析 GC 日志

```bash
# 查看 OOM 前的 GC 情况
grep -A 5 "Full GC" gc.log | tail -50

# 查看内存变化趋势
grep "Full GC\|Allocation Failure" gc.log | head -100
```

### 3.3 第三步：使用 MAT 分析堆转储

下载 Eclipse MAT：https:// eclipse.org/mat/downloads.php

**常用功能**：

1. **Leak Suspects**：自动检测可疑的内存泄漏
2. **Histogram**：查看对象数量和大小
3. **Dominator Tree**：查看内存占用的树状结构
4. **Top Consumers**：查看最大的对象

### 3.4 MAT 分析实战

**Leak Suspects 报告解读**：

```markdown
## Leak Suspect 1

Problem: One instance of "java.util.HashMap" 
loaded by "jdk.internal.loader.ClassLoaders$AppClassLoader" 
occupies 1,234,567,890 bytes (45.67%) bytes.

The stack trace of where this allocation point is:
  at java/util/HashMap.&lt;init&gt;
  at com.example.Cache.&lt;init&gt;
  ...
```

**Histogram 使用**：

1. 打开 MAT，加载 `heapdump.hprof`
2. 点击 `Histogram`
3. 按 `Retained Heap` 排序
4. 查找异常大的对象

**OQL 查询**：

```sql
-- 查找所有大于 10MB 的 ArrayList
SELECT * FROM java.util.ArrayList WHERE @retainedHeapSize > 10485760

-- 查找包含特定字符串的 String 对象
SELECT * FROM java.lang.String WHERE toString().indexOf("specific_key") >= 0
```

---

## 四、典型案例分析

### 4.1 案例一：静态集合内存泄漏

**场景**：应用运行几天后 OOM

**GC 日志特征**：

```
Full GC 频率：每 10 分钟一次 → 每 5 分钟一次 → 每 1 分钟一次
堆内存使用：每次 Full GC 后不回落到原点
```

**MAT 分析**：

1. Histogram 中按 Retained Heap 排序
2. 发现 `java.util.HashMap` 占用了 80% 的堆
3. 进一步查看是哪个类持有的 HashMap
4. 发现是静态的 `Cache` 类

**代码定位**：

```java
// 定位到的代码
public class CacheService {
    private static Map&lt;String, Object&gt; cache = new HashMap&lt;&gt;();
    
    public void put(String key, Object value) {
        cache.put(key, value);  // 只增不减
    }
}
```

**解决方案**：

```java
// 方案 1：使用 WeakHashMap
private static Map&lt;String, WeakReference&lt;Object&gt;&gt; cache = new WeakHashMap&lt;&gt;();

// 方案 2：添加清理机制
private static final int MAX_SIZE = 10000;
private static LinkedHashMap&lt;String, Object&gt; cache = new LinkedHashMap&lt;&gt;() {
    @Override
    protected boolean removeEldestEntry(Map.Entry eldest) {
        return size() > MAX_SIZE;
    }
};

// 方案 3：定期清理
@Scheduled(fixedRate = 3600000)
public void clearCache() {
    cache.clear();
}
```

### 4.2 案例二：一次查询加载过多数据

**场景**：用户点击导出按钮，应用 OOM

**GC 日志特征**：

```
OOM 发生前：
[GC (Allocation Failure) ...]
[GC (Allocation Failure) ...]
java.lang.OutOfMemoryError: Java heap space
```

**MAT 分析**：

1. 发现大量 `byte[]` 对象
2. 这些对象都在同一个 ArrayList 中
3. 追溯到代码：导出功能一次性加载所有数据到内存

**代码定位**：

```java
// 问题代码
public void exportData() {
    List&lt;Report&gt; allData = reportService.getAllReport();  // 一次性加载全部数据
    // 内存中拼接 Excel...
}

// 解决后
public void exportData() {
    // 分页导出
    int page = 0;
    int pageSize = 1000;
    List&lt;Report&gt; data;
    while ((data = reportService.getReportPage(page, pageSize)).size() > 0) {
        writeToExcel(data);
        page++;
    }
}
```

### 4.3 案例三：大对象直接加载

**场景**：导入一个大 Excel 文件，OOM

**GC 日志特征**：

```
[GC (Allocation Failure) 
  : 65MB -> 65MB(65MB), 0.0500000 secs]
java.lang.OutOfMemoryError: Java heap space
```

**MAT 分析**：

1. 发现多个大于 50MB 的 `byte[]` 对象
2. 这些是 Excel 文件内容

**解决方案**：

```java
// 方案 1：使用流式处理
try (InputStream is = new FileInputStream("large.xlsx")) {
    Workbook workbook = WorkbookFactory.create(is);  // POI 流式读取
    // 流式处理...
}

// 方案 2：分片上传和处理
@PostMapping("/upload")
public void upload(@RequestParam("file") MultipartFile file) {
    // 保存到临时文件
    Path tempFile = Files.createTempFile("upload_", ".xlsx");
    file.transferTo(tempFile);
    
    // 异步处理
    excelProcessingService.processAsync(tempFile);
}
```

---

## 五、预防措施

### 5.1 代码规范

1. **禁止在静态集合中存储可变对象**
2. **大文件使用流式处理**
3. **数据库查询使用分页**
4. **使用合适的数据结构**

### 5.2 JVM 参数配置

```bash
# 设置合理的堆大小
-Xms4g -Xmx4g

# OOM 时自动生成堆转储
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/heapdump.hprof

# 设置元空间上限（防止 Metaspace OOM）
-XX:MaxMetaspaceSize=512m
```

### 5.3 监控告警

- 堆内存使用率 > 80% 告警
- Full GC 频率突然增加告警
- OOM 事件告警

---

## 六、排查工具总结

| 工具 | 用途 | 获取方式 |
|-----|-----|---------|
| jmap | 生成堆转储 | JDK 自带 |
| MAT | 分析堆转储 | eclipse.org/mat |
| VisualVM | 本地分析 | JDK 自带 |
| Arthas | 在线诊断 | alibaba.github.io/arthas |
| GCEasy | 分析 GC 日志 | gceasy.io |

---

## 总结

Heap OOM 排查的核心要点：

1. **事前准备**：开启 HeapDumpOnOutOfMemoryError
2. **事中抓取**：第一时间获取堆转储
3. **事后分析**：使用 MAT 分析堆转储
4. **定位根因**：找到泄漏的代码或不合理的使用方式
5. **预防复发**：修复代码 + 配置监控告警

---

## 思考题

应用运行几天后才出现 OOM，而刚启动时内存使用正常。这种情况最可能的原因是什么？

提示：考虑内存泄漏的特点，以及如何通过 GC 日志来判断。
