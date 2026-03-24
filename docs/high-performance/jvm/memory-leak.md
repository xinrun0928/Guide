# 内存泄漏分析：OQL 对象查询语言

OQL（Object Query Language）是 MAT 提供的一种类 SQL 查询语言，用于在堆转储中查询对象。

当你用 Histogram 找不到问题时，OQL 可以帮你精准定位。

今天，我们来详细讲解 OQL 的使用方法。

---

## 一、OQL 基础语法

### 1.1 基本结构

```sql
SELECT * FROM [ INSTANCEOF ] <class_name> [ WHERE <condition> ] [ ORDER BY <properties> ]
```

### 1.2 简单查询

```sql
-- 查询所有 String 对象
SELECT * FROM java.lang.String

-- 查询所有 HashMap
SELECT * FROM java.util.HashMap

-- 查询所有 ArrayList
SELECT * FROM java.util.ArrayList
```

### 1.3 使用 WHERE 子句

```sql
-- 查询长度大于 100 的字符串
SELECT * FROM java.lang.String s WHERE s.count > 100

-- 查询大小大于 1000 的 HashMap
SELECT * FROM java.util.HashMap WHERE size > 1000

-- 查询数组长度大于 100 的 byte[]
SELECT * FROM byte[] WHERE length > 100
```

### 1.4 选择特定字段

```sql
-- 只返回字符串的值
SELECT s.toString() FROM java.lang.String s WHERE s.count > 100

-- 返回 HashMap 的大小和负载因子
SELECT h.size, h.loadFactor FROM java.util.HashMap h WHERE h.size > 100
```

---

## 二、常用查询示例

### 2.1 查找大对象

```sql
-- 查找所有大于 10MB 的对象
SELECT * FROM java.lang.Object WHERE @retainedHeapSize > 10485760

-- @retainedHeapSize 是对象保留的内存大小（对象本身 + 所有引用）
```

### 2.2 查找特定字符串

```sql
-- 查找包含特定内容的字符串
SELECT s.toString() FROM java.lang.String s WHERE s.toString().indexOf("config") >= 0

-- 查找以特定前缀开头的字符串
SELECT s.toString() FROM java.lang.String s WHERE s.toString().matches("user_.*")
```

### 2.3 查找集合内容

```sql
-- 查找 HashMap 中的所有 key
SELECT k.toString() FROM java.util.HashMap h, 
     IN(h.table) t WHERE t.key != null

-- 查找 ArrayList 中的所有元素
SELECT e FROM java.util.ArrayList a, IN(a.elementData) e
```

### 2.4 查找特定类加载器

```sql
-- 查找所有自定义类加载器
SELECT * FROM java.lang.ClassLoader WHERE class.getName().indexOf("custom") >= 0

-- 查找加载类数量最多的类加载器
SELECT cl.loadedClassCount, cl.parent FROM java.lang.ClassLoader cl 
WHERE cl.loadedClassCount > 1000
```

### 2.5 分析线程

```sql
-- 查找所有线程
SELECT * FROM java.lang.Thread

-- 查找阻塞的线程
SELECT t.name, t.blockedTime FROM java.lang.Thread t WHERE t.blockedTime > 0

-- 查找持有锁的线程
SELECT t.name, t.lockedMonitors FROM java.lang.Thread t 
WHERE t.lockedMonitors.length > 0
```

### 2.6 分析异常栈

```sql
-- 查找所有异常对象
SELECT * FROM java.lang.Throwable

-- 查找特定类型的异常
SELECT * FROM java.lang.RuntimeException
```

---

## 三、进阶查询技巧

### 3.1 使用对象属性

```sql
-- 访问对象的属性
SELECT objectid, heapSize, GcRoots FROM java.lang.String 
WHERE count > 100

-- 使用 @ 前缀的元属性
-- @objectid: 对象的唯一 ID
-- @heapSize: 对象的堆大小
-- @retainedHeapSize: 对象的保留大小
-- @class: 对象的类
-- @gcreacheroots: 是否是 GC Root
```

### 3.2 使用函数

```sql
-- 使用 count 函数
SELECT COUNT(*) FROM java.lang.String

-- 使用 sum 函数
SELECT SUM(@heapSize) FROM java.lang.String

-- 使用 group by
SELECT toString().substring(0,10) as prefix, COUNT(*) as cnt 
FROM java.lang.String GROUP BY toString().substring(0,10) 
ORDER BY cnt DESC
```

### 3.3 使用子查询

```sql
-- 查找持有大 HashMap 的对象
SELECT * FROM java.lang.Object o WHERE 
    EXISTS (SELECT * FROM java.util.HashMap h WHERE h = o)

-- 查找被多个对象引用的字符串
SELECT s.toString(), COUNT(SELECT * FROM java.lang.Object o WHERE @contains(o.ref, s)) as refCount
FROM java.lang.String s 
WHERE refCount > 10
```

### 3.4 正则表达式

```sql
-- 匹配特定模式
SELECT * FROM java.lang.String s 
WHERE s.toString().matches("^user_\\d+$")

-- 使用 like
SELECT * FROM java.lang.String s 
WHERE s.toString().like(".*error.*")
```

---

## 四、实战案例

### 4.1 案例一：查找内存泄漏的缓存

**问题**：静态 HashMap 持续增长导致 OOM

```sql
-- 首先查找最大的 HashMap
SELECT * FROM java.util.HashMap ORDER BY @retainedHeapSize DESC

-- 查看 HashMap 的 key
SELECT k.toString(), h.get(k) FROM java.util.HashMap h, 
     IN(h.table) t WHERE t.key != null
```

### 4.2 案例二：查找重复字符串

**问题**：大量重复的字符串占用内存

```sql
-- 查找重复字符串
SELECT s.toString(), COUNT(*) as cnt 
FROM java.lang.String 
GROUP BY s.toString() 
HAVING cnt > 1
ORDER BY cnt DESC
```

### 4.3 案例三：查找类加载器泄漏

**问题**：Tomcat 反复部署后类加载器未释放

```sql
-- 查找所有类加载器
SELECT cl, cl.loadedClassCount FROM java.lang.ClassLoader cl

-- 查找加载类数量异常的类加载器
SELECT * FROM java.lang.ClassLoader cl 
WHERE cl.loadedClassCount > 5000
```

### 4.4 案例四：查找大数组

**问题**：某个数组占用了大量内存

```sql
-- 查找所有 byte[] 数组
SELECT @heapSize, @length FROM byte[] ORDER BY @heapSize DESC

-- 查找所有 Object[] 数组
SELECT @heapSize, @length FROM java.lang.Object[] ORDER BY @heapSize DESC
```

---

## 五、OQL 与其他工具的配合

### 5.1 OQL 与 Histogram 配合

1. 使用 Histogram 初步查看内存分布
2. 发现可疑类型后，使用 OQL 深入分析
3. 查看对象的引用关系

### 5.2 OQL 与 Dominator Tree 配合

1. OQL 查找特定对象
2. Dominator Tree 分析对象间的引用关系
3. 定位内存泄漏的根源

### 5.3 OQL 与线程分析配合

```sql
-- 查找线程相关的对象
SELECT t.name, t.stackTrace FROM java.lang.Thread t
WHERE t.name LIKE "pool-.*-thread-.*"
```

---

## 六、常见问题

### 6.1 查询太慢

如果查询结果太多，可以：

1. 添加 WHERE 条件限制
2. 使用 LIMIT
3. 先用 Histogram 筛选类型

### 6.2 语法错误

MAT OQL 语法与标准 SQL 有些不同：

- 使用 `FROM class_name obj` 而不是 `FROM obj IN class_name`
- 对象属性访问使用 `.` 而不是 `[]`
- 布尔值使用 `=` 而不是 `IS`

### 6.3 找不到对象

检查类名是否正确：

```sql
-- 查看所有包含 "Map" 的类
SELECT * FROM ".*Map.*"
```

---

## 七、OQL 快捷键和技巧

1. **Ctrl + F**：打开 OQL 控制台
2. **Ctrl + Enter**：执行查询
3. **Ctrl + L**：清除结果
4. **双击结果**：查看对象详情
5. **右键 → Path To GC Roots**：查看引用链

---

## 总结

OQL 是 MAT 中强大的查询语言：

1. **基本语法**：`SELECT * FROM class WHERE condition`
2. **常用查询**：大对象、特定字符串、集合内容、类加载器
3. **进阶技巧**：聚合、排序、子查询
4. **实战应用**：配合 Histogram 和 Dominator Tree 使用
5. **优化建议**：添加条件限制，避免查询过慢

---

## 思考题

使用 OQL 查找内存泄漏时，`@retainedHeapSize` 和 `@heapSize` 有什么区别？为什么分析内存泄漏时应该关注 `@retainedHeapSize`？

提示：考虑一个对象被多个引用持有时的情况。
