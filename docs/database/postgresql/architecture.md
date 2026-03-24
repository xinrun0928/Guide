# PostgreSQL 架构：连接管理器、查询引擎、存储引擎、索引机制

你用过 PostgreSQL，但你了解它内部是怎么工作的吗？

当你执行一条 SQL 语句时，PostgreSQL 内部经历了什么？

从客户端连接到返回结果，PostgreSQL 的各个组件是如何协作的？

今天，我们来揭开 PostgreSQL 架构的神秘面纱。

## PostgreSQL 架构概览

PostgreSQL 采用的是「进程模型」架构（虽然也可以配置为线程模型）：

```
                    ┌─────────────────────────────────────┐
                    │           PostgreSQL Server          │
                    │                                      │
┌──────────┐       │  ┌──────────┐  ┌─────────────────┐   │
│  Client   │──────│──│Postmaster│──│ Postgres Backend│   │
└──────────┘       │  │ (Daemon) │  │   (per query)   │   │
                  │  └──────────┘  └─────────────────┘   │
┌──────────┐       │       │                │            │
│  Client   │──────│       │                │            │
└──────────┘       │  ┌────┴────────────────┴────┐       │
                  │  │    Shared Memory         │       │
┌──────────┐       │  │ ┌──────┐ ┌───────────┐ │       │
│  Client   │──────│──│ │WAL   │ │bgwriter   │ │       │
└──────────┘       │  │ │Buffer│ │autovacuum │ │       │
                  │  │ └──────┘ └───────────┘ │       │
                  │  └─────────────────────────┘       │
                  └─────────────────────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │     Data Files      │
                    │   (PGDATA/base/)    │
                    └─────────────────────┘
```

关键进程：
- **Postmaster**：主进程，负责监听连接、分派任务
- **Backend Process**：每个连接对应一个后端进程
- **BGWriter**：后台写入进程
- **WalWriter**：预写日志写入进程
- **Autovacuum**：自动清理进程

## 连接管理器

### 连接建立过程

当客户端连接 PostgreSQL 时：

```
1. 客户端发送连接请求（TCP/Unix Socket）
         ↓
2. Postmaster 接收请求，验证用户名、密码、数据库
         ↓
3. 验证通过，fork 一个新的 Backend Process（或创建线程）
         ↓
4. Backend Process 执行查询
         ↓
5. 连接关闭，进程退出
```

这个「进程 per 连接」的模型让 PostgreSQL 非常稳定——一个连接崩溃不会影响其他连接。但代价是连接开销较大。

这就是为什么生产环境必须使用连接池！

### 连接池方案

| 方案 | 特点 | 适用场景 |
|------|------|---------|
| PgBouncer | 轻量级，事务模式连接池 | 高并发短连接场景 |
| Pgpool-II | 支持连接池、负载均衡、缓存 | 需要读写分离 |
| Odyssey | 现代连接池，事务级别池化 | 高性能需求 |

```java
// HikariCP 连接池配置
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:pgbouncer://localhost:6432/mydb");
config.setMaximumPoolSize(100);
config.setMinimumIdle(10);
```

### 连接参数调优

```sql
-- 查看当前连接数
SELECT count(*) FROM pg_stat_activity;

-- 查看最大连接数
SHOW max_connections;  -- 默认 100

-- 调整最大连接数（需要重启）
-- postgresql.conf
max_connections = 200

-- 推荐公式：
-- max_connections = (核心数 * 2) + 有效磁盘数
```

## 查询引擎

### 查询处理流程

当你执行 `SELECT * FROM users WHERE id = 1;` 时，PostgreSQL 内部：

```
1. Parser（解析）
   把 SQL 文本解析成解析树（Parse Tree）
         ↓
2. Rewriter（重写）
   应用规则（如视图、物化视图）
         ↓
3. Planner/Optimizer（计划）
   生成最优执行计划
         ↓
4. Executor（执行）
   按计划执行，返回结果
```

### Parser（解析器）

解析器将 SQL 转换为「解析树」：

```sql
SELECT name, email FROM users WHERE age > 18;

-- 解析后：
Table: users
Columns: name, email
Condition: age > 18
```

解析器只做语法检查，不做语义检查（如表是否存在）。

### Rewriter（重写器）

重写器应用规则系统：

```sql
-- 创建一个规则：当查询 view_users 时，转换为查询 users
CREATE RULE view_users AS ON SELECT TO view_users
DO INSTEAD SELECT * FROM users WHERE active = true;

-- 查询视图
SELECT * FROM view_users;

-- 重写后实际执行：
SELECT * FROM users WHERE active = true;
```

### Planner（规划器）

这是 PostgreSQL 最复杂的组件之一。它生成执行计划，选择最优路径。

```sql
-- 查看执行计划
EXPLAIN SELECT * FROM users WHERE email = 'alice@example.com';

-- 更详细的分析
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM users WHERE email = 'alice@example.com';
```

执行计划可能包括：

| 操作 | 说明 |
|------|------|
| Seq Scan | 全表扫描 |
| Index Scan | 索引扫描 |
| Index Only Scan | 仅索引扫描 |
| Nested Loop | 嵌套循环连接 |
| Hash Join | 哈希连接 |
| Merge Join | 归并连接 |
| Sort | 排序 |
| Aggregate | 聚合 |
| Limit | 限制返回行数 |

### 成本估算模型

PostgreSQL 使用「成本模型」选择执行计划：

```
总成本 = CPU 成本 + I/O 成本

成本常量（可通过 postgresql.conf 调整）：
- seq_page_cost = 1.0           -- 顺序页面读取成本
- random_page_cost = 4.0        -- 随机页面读取成本
- cpu_tuple_cost = 0.01        -- 每行 CPU 成本
- cpu_index_tuple_cost = 0.005 -- 索引行 CPU 成本
```

成本越低，执行计划越优。

## 存储引擎

### 数据文件结构

PostgreSQL 的数据存储在 `$PGDATA/base/` 目录下：

```
$PGDATA/
├── base/
│   ├── 1/           -- template0
│   ├── 13169/       -- template1 (OID = 13169)
│   └── 13170/       -- mydb (每次创建数据库分配新 OID)
├── global/         -- 系统表（如 pg_database）
├── pg_wal/         -- 预写日志
├── pg_xact/        -- 事务状态
└── pg_multixact/   -- 多事务状态
```

每个表对应一个或多个文件（超过 1GB 自动分裂）：

```
表文件：{table_oid}.{fork}
- {table_oid}.1  -- 主数据 fork
- {table_oid}_fsm  -- 空闲空间映射
- {table_oid}_vm  -- 可见性映射
- {table_oid}_init  -- 初始化 fork（用于未初始化数据）
```

### Page（页面）结构

PostgreSQL 使用 8KB 的页面（Page）作为基本存储单元：

```
┌─────────────────────────────────────┐
│            Page Header (24 bytes)    │
│  - pd_lsn: 最后修改的 WAL 日志位置     │
│  - pd_tli: 最后修改的时间线            │
│  - pd_flags: 页面标志                  │
│  - pd_lower: 空闲空间起始位置          │
│  - pd_upper: 空闲空间结束位置          │
│  - pd_special: 特殊空间起始位置        │
└─────────────────────────────────────┘
│           ItemIdData (每行 4 bytes)   │
│  - 指向 Item 的偏移量和长度            │
├─────────────────────────────────────┤
│              Items                   │
│  - 实际数据行                         │
│  - 每行前有 Header：                  │
│    - t_xmin: 创建版本的事务 ID        │
│    - t_xmax: 删除/更新版本的事务 ID   │
│    - t_ctid: 指向新版本的指针          │
└─────────────────────────────────────┘
```

### 元组（Tuple）结构

每行数据在 PostgreSQL 内部表示为元组：

```c
// PostgreSQL 内部元组结构（简化）
typedef struct HeapTupleData {
    uint32      t_len;           // 元组长度
    Oid         t_tableOid;      // 表 OID
    ItemPointerData t_tid;       // 元组位置
    uint16      t_infomask;      // 信息标志
    uint8       t_infomask2;     // 信息标志 2
    HeapTupleHeader t_data;      // 实际数据
} HeapTupleData;
```

## MVCC 实现

### xmin/xmax 机制

PostgreSQL 的 MVCC 核心是元组头部的两个字段：

| 字段 | 含义 |
|------|------|
| xmin | 创建此元组版本的事务 ID |
| xmax | 删除/更新此元组的事务 ID（0 表示未删除） |

```
时间线：
T1: BEGIN; UPDATE users SET name = 'Bob' WHERE id = 1;
T2: SELECT * FROM users WHERE id = 1;  -- 看到什么？

事务 T1 执行前（原始数据）：
┌──────────────────────────────────────┐
│ id=1, name='Alice'                   │
│ xmin=T1, xmax=0                      │
└──────────────────────────────────────┘

事务 T1 执行 UPDATE（创建新版本）：
┌──────────────────────────────────────┐
│ id=1, name='Alice'                   │  ← 旧版本（xmax=T1）
│ xmin=T1, xmax=T1                     │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ id=1, name='Bob'                     │  ← 新版本（xmin=T1）
│ xmin=T1, xmax=0                      │
└──────────────────────────────────────┘

T2 的 SELECT：
- 在 Read Committed 下：看到 name='Bob'（T1 已提交）
- 在 Repeatable Read 下：看到 name='Alice'（快照在事务开始时创建）
```

### 可见性判断规则

PostgreSQL 通过以下规则判断元组是否对当前事务可见：

```
对于元组 (xmin, xmax)：
1. 如果 xmin 对应的事务未提交，不可见
2. 如果 xmin 对应的事务在当前事务之后开始，不可见
3. 如果 xmax = 0，或者 xmax 对应的事务未提交，可见（未删除版本）
4. 如果 xmax 对应的事务已提交，且隔离级别不是 Serializable，可见
5. 其他情况，根据隔离级别和事务状态综合判断
```

## 索引机制

### PostgreSQL 索引结构

PostgreSQL 支持多种索引结构：

| 索引类型 | 底层结构 | 适用场景 |
|---------|---------|---------|
| B-Tree | B+ Tree | 默认，等值查询、范围查询 |
| Hash | 动态哈希表 | 等值查询，不支持范围 |
| GiST | R-Tree、堆叠 B-Tree | 几何数据、全文搜索 |
| GIN | 倒排索引 | 数组、JSON、全文搜索 |
| BRIN | 块范围索引 | 物理顺序相关的大表 |

### B-Tree 索引

PostgreSQL 默认的索引类型，适用于大多数场景：

```sql
CREATE INDEX idx_users_email ON users(email);

-- 查看索引
\d users  -- 显示表结构，包括索引

-- 查看索引定义
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users';
```

B-Tree 索引支持的操作：
- 等值查询：`WHERE email = 'alice@example.com'`
- 范围查询：`WHERE age >= 18 AND age <= 30`
- 排序：`ORDER BY email DESC`
- 前缀匹配：`WHERE email LIKE 'alice%'`

### 索引相关命令

```sql
-- 创建索引
CREATE INDEX idx_name ON table(column);

-- 创建联合索引
CREATE INDEX idx_name ON table(col1, col2);

-- 创建表达式索引
CREATE INDEX idx_lower_email ON users(LOWER(email));

-- 创建部分索引
CREATE INDEX idx_active_users ON users(created_at) WHERE active = true;

-- 查看索引使用情况
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public';

-- 重建索引
REINDEX INDEX idx_name;

-- 删除索引
DROP INDEX idx_name;
```

## 面试高频问题

### Q1: PostgreSQL 的架构分为哪几层？

**考察点**：架构理解

**参考答案**：
1. **连接层**：Postmaster 主进程、Backend 进程、连接池
2. **查询处理层**：Parser、Rewriter、Planner/Optimizer、Executor
3. **存储层**：Buffer Pool、Page、Tuple、MVCC
4. **索引层**：多种索引结构（B-Tree、Hash、GiST、GIN、BRIN）
5. **日志层**：WAL（预写日志）

### Q2: PostgreSQL 如何处理并发？

**考察点**：并发控制机制

**参考答案**：
1. MVCC 实现读写不阻塞
2. 多种锁机制（表级锁、行级锁、 advisory lock）
3. 事务隔离级别控制可见性
4. 死锁检测机制

### Q3: 为什么 PostgreSQL 需要 VACUUM？

**考察点**：MVCC 理解

**参考答案**：
1. PostgreSQL 的 MVCC 不使用回滚段，旧版本直接存在表中
2. 被更新/删除的元组不会立即回收
3. 这些「死元组」会占用空间、影响性能
4. VACUUM 清理死元组，维护统计信息

## 总结

PostgreSQL 的架构设计体现了几个核心原则：

1. **稳定性优先**：进程模型让每个连接独立运行
2. **标准至上**：严格遵循 SQL 标准
3. **功能完整**：支持丰富的数据类型和索引类型
4. **可扩展**：通过扩展机制支持 PostGIS、pgvector 等

理解 PostgreSQL 的架构，对性能调优和问题排查至关重要。
