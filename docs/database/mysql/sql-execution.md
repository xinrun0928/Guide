# SQL 执行过程：从客户端到结果返回

你有没有想过，一条 `SELECT * FROM users WHERE id = 1` 到底在 MySQL 内部经历了什么？

很多人会说「执行 SQL」，但追问下去：连接怎么管理？查询缓存还在吗？优化器怎么生成执行计划？存储引擎怎么读写数据？

今天，我们把 SQL 执行的全链路拆解清楚。

---

## SQL 执行的两条路径

MySQL 处理 SQL 有两种不同的路径：

### 预编译语句（Prepared Statement）

```java
// 预编译：SQL 结构固定，参数值变化
// 好处：一次编译，多次执行，避免 SQL 注入
PreparedStatement ps = connection.prepareStatement(
    "SELECT * FROM users WHERE id = ?"
);
ps.setInt(1, 1);  // 第一次执行
ps.setInt(1, 2);  // 第二次执行
```

### 普通语句（Dynamic SQL）

```sql
-- 每条 SQL 都需要完整解析
SELECT * FROM users WHERE id = 1;
SELECT * FROM users WHERE id = 2;
SELECT * FROM users WHERE id = 3;
-- 每次都要解析，增加开销
```

---

## 完整执行流程

```
客户端
  │
  │ 1. 建立连接
  ▼
┌─────────────────────────────┐
│       连接层                 │
│  - 连接认证                   │
│  - 线程分配                   │
│  - 权限验证                   │
└─────────────────────────────┘
  │
  │ 2. 发送 SQL
  ▼
┌─────────────────────────────┐
│       服务层                  │
│  ┌─────────────────────────┐ │
│  │   查询缓存 (MySQL 8.0-)  │ │
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │   解析器                 │ │
│  │   - 词法分析              │ │
│  │   - 语法分析              │ │
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │   预处理器               │ │
│  │   - 语义检查              │ │
│  │   - 别名解析              │ │
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │   优化器                 │ │
│  │   - 成本估算              │ │
│  │   - 生成执行计划          │ │
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │   执行器                 │ │
│  │   - 调用存储引擎          │ │
│  │   - 结果集处理            │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
  │
  │ 3. 调用存储引擎
  ▼
┌─────────────────────────────┐
│       存储引擎层              │
│  - Buffer Pool 缓存读写      │
│  - 数据页 I/O                │
│  - 锁管理                    │
│  - 事务控制                  │
└─────────────────────────────┘
  │
  │ 4. 返回结果
  ▼
客户端
```

---

## 第一步：连接管理

### 连接建立

```java
// JDBC 连接示例
Connection conn = DriverManager.getConnection(
    "jdbc:mysql://localhost:3306/test",
    "root",
    "password"
);

// MySQL 连接过程（简化版）
// 1. TCP 三次握手建立连接
// 2. 验证用户名、密码、来源 IP
// 3. 分配服务线程
// 4. 设置连接参数（字符集、事务模式等）
```

### 连接池的必要性

```java
// ❌ 每次查询创建新连接（短连接）
Connection conn = DriverManager.getConnection(url, user, pwd);
query();
conn.close();  // 连接创建和销毁开销巨大

// ✅ 使用连接池（长连接复用）
HikariDataSource ds = new HikariDataSource();
// 连接从池中获取，用完归还
Connection conn = ds.getConnection();
query();
conn.close();  // 归还到连接池，不真正关闭
```

### 连接参数调优

```sql
-- 最大连接数
SHOW VARIABLES LIKE 'max_connections';  -- 默认 151

-- 连接超时时间
SHOW VARIABLES LIKE 'connect_timeout';  -- 默认 10 秒

-- 等待超时时间（MySQL 端）
SHOW VARIABLES LIKE 'wait_timeout';  -- 默认 8 小时
```

---

## 第二步：查询缓存（MySQL 8.0 前）

> MySQL 8.0 已移除查询缓存，这部分内容适用于 5.7 及之前版本。

### 查询缓存工作原理

```
SQL 查询
    │
    ▼
计算 SQL 的哈希值
    │
    ▼
在缓存中查找
    │
    ├── 命中 ──→ 直接返回缓存结果
    │
    └── 未命中 ──→ 执行查询 ──→ 存入缓存 ──→ 返回结果
```

### 查询缓存的问题

```sql
-- 问题 1：任何表数据变更，相关缓存全部失效
UPDATE users SET name = 'new' WHERE id = 1;
-- users 表的所有缓存全部清空！

-- 问题 2：缓存命中率低
-- 写入频繁时，缓存形同虚设

-- 问题 3：内存碎片
-- 缓存管理本身消耗资源
```

### MySQL 8.0 的改变

```sql
-- MySQL 8.0 执行这个语句会报错
SHOW VARIABLES LIKE 'query_cache_type';

-- ERROR: Unknown system variable 'query_cache_type'

-- 原因：8.0 直接移除了查询缓存
-- 推荐：在应用层用 Redis 做缓存，更可控
```

---

## 第三步：解析器

解析器把 SQL 字符串转换成数据库能理解的执行结构。

### 词法分析

```sql
SELECT id, name, email FROM users WHERE age > 18 AND status = 1;
```

**词法分析器**把它拆成 Token：

```
SELECT   -- 关键字
id       -- 列名
,        -- 逗号
name     -- 列名
,        -- 逗号
email    -- 列名
FROM     -- 关键字
users    -- 表名
WHERE    -- 关键字
age      -- 列名
>        -- 运算符
18       -- 字面量
AND      -- 关键字
status   -- 列名
=        -- 运算符
1        -- 字面量
;        -- 结束符
```

### 语法分析

词法分析的结果交给**语法分析器**，构建**抽象语法树（AST）**：

```
        SELECT
       /    |    \
    列信息    FROM    WHERE
      │        │        │
  [id,      users   AND
   name,              /      \
   email]            >        =
                   age       18  status  1
```

### 预处理器

解析后的 AST 交给预处理器，做语义检查：

1. **表存在性检查**：users 表是否存在？
2. **列存在性检查**：id、name、email、age、status 列是否都存在？
3. **权限检查**：当前用户能否 SELECT users 表？
4. **别名解析**：如果写了别名，替换回去

---

## 第四步：优化器

优化器是 MySQL 的大脑，它根据**成本模型**选择最优执行计划。

### 成本模型考虑的因素

```sql
-- 同样查 age > 18，有多种执行方式

-- 方式 1：全表扫描
-- 成本 = 读取所有数据行

-- 方式 2：走 age 索引
-- 成本 = 索引扫描 + 回表

-- 方式 3：走 status 索引
-- 成本 = 索引扫描 + 回表（可能更慢）
```

### 优化器决策依据

| 因素 | 说明 |
|-----|-----|
| 表统计信息 | 行数、数据分布 |
| 索引统计 | 索引选择性、深度 |
| 条件选择性 | 满足条件的行数估算 |
| 硬件成本 | 内存、磁盘 I/O、CPU |

### 查看优化结果

```sql
-- 使用 EXPLAIN 查看优化器生成的执行计划
EXPLAIN SELECT * FROM users WHERE age > 18;

-- 输出关键字段：
-- type: 访问类型（ALL=全表, ref=索引, range=范围...）
-- key: 实际使用的索引
-- rows: 预估扫描行数
-- Extra: 额外信息（Using index, Using filesort...）
```

---

## 第五步：执行器

执行器根据优化器生成的执行计划，调用存储引擎完成数据访问。

### 执行流程

```java
// 伪代码：SELECT * FROM users WHERE age > 18 的执行过程
public List<Row> executeSelect() {
    List<Row> result = new ArrayList<>();
    
    // 1. 调用存储引擎获取数据
    // 根据优化器决策，可能走全表扫描或索引扫描
    Iterator<Row> iterator = storageEngine.scan(tableRef);
    
    // 2. 过滤每一条记录
    while (iterator.hasNext()) {
        Row row = iterator.next();
        
        // WHERE 条件过滤
        if (row.getInt("age") > 18) {
            result.add(row);
        }
    }
    
    return result;
}
```

### 权限检查时机

```java
// 执行器执行前，还会检查用户权限
public void executeWithPermissionCheck(String sql) {
    // 解析 SQL 得到需要访问的表和列
    List<TableRef> tables = parseSQL(sql);
    
    // 检查用户对这些表是否有对应权限
    for (TableRef table : tables) {
        if (!hasPermission(user, table, Permission.SELECT)) {
            throw new PermissionDeniedException();
        }
    }
    
    // 权限检查通过，才真正执行
    execute(sql);
}
```

---

## 第六步：存储引擎

存储引擎是真正读写数据的地方，InnoDB 是最常用的存储引擎。

### InnoDB 读取流程

```
执行器请求数据
    │
    ▼
┌─────────────────────────────┐
│     Buffer Pool（内存缓存）    │
│                              │
│  数据页 1 ──→ 数据页 2 ──→ 数据页 3 │
│     │           │           │
│     └── 命中？───┴─── 未命中 │
│         │                 │
│         ▼                   ▼
│      直接返回          从磁盘加载
│                              │
└─────────────────────────────┘
    │
    ▼
返回给执行器
```

### 数据读取示例

```sql
-- 查询 id = 1 的用户
SELECT * FROM users WHERE id = 1;

-- InnoDB 执行过程：
-- 1. id 是主键，直接走主键索引
-- 2. 主键索引是聚簇索引，叶子节点直接存储行数据
-- 3. 直接返回这条数据

-- 查询 age = 18 的用户
SELECT * FROM users WHERE age = 18;

-- InnoDB 执行过程：
-- 1. age 是普通索引，需要走二级索引
-- 2. 二级索引叶子节点存储主键值
-- 3. 根据主键值回表查完整数据
-- 4. 返回结果（可能有多条）
```

---

## UPDATE 语句的特殊之处

UPDATE 语句比 SELECT 多了两个关键步骤：**写 redo log** 和 **加锁**。

```sql
UPDATE users SET name = 'new' WHERE id = 1;
```

```
1. 读取 id = 1 的数据到内存
    │
2. 修改数据（Buffer Pool 中的页标记为脏页）
    │
3. 写入 Redo Log（事务日志）
    │
4. 获取行锁（防止其他事务同时修改）
    │
5. 事务提交
    │
6. 异步刷脏页（由后台线程完成）
```

---

## 面试高频追问

### Q1：MySQL 8.0 为什么移除查询缓存？

三个主要原因：

1. **写操作导致缓存失效**：任何对表的修改都清空缓存
2. **缓存管理开销大**：元数据管理、内存碎片
3. **应用层缓存更优**：Redis 等专业缓存更可控

### Q2：优化器一定能选到最优执行计划吗？

不能。优化器基于统计信息做决策，但：

- 统计信息可能不准确
- 无法预知实际执行时的数据分布
- 有些优化策略（如Join重排序）是启发式的

> 如果你发现优化器选错了计划，可以用 `STRAIGHT_JOIN` 或 `FORCE INDEX` 强制指定。

### Q3：一条 UPDATE 语句的执行流程和 SELECT 有什么不同？

| 步骤 | SELECT | UPDATE |
|-----|--------|--------|
| 读取数据 | ✅ | ✅ |
| 写 redo log | ❌ | ✅ |
| 加行锁 | ❌ | ✅（防止并发修改） |
| 修改数据 | ❌ | ✅ |
| 标记脏页 | ❌ | ✅ |

---

## 总结

SQL 执行全链路：

1. **连接层**：认证、分配线程
2. **服务层**：解析、优化、执行
3. **存储引擎层**：读写数据、事务控制

理解这个流程，才能在面试中回答「MySQL 怎么执行 SQL」这样的问题。