# MariaDB vs MySQL：核心差异对比

你的应用正在使用 MySQL 5.7，产品经理说：「换个 MariaDB 吧，开源社区更活跃。」

你心里打鼓：代码要改吗？数据能迁移吗？性能会变吗？

**好消息是：MariaDB 的设计目标就是「尽可能兼容 MySQL」。坏消息是：差异比你想象的多。**

---

## 历史渊源：从同一个祖先说起

```
MySQL ────────────────────────────────────────────────────────►
   │
   ├── MySQL 5.5 ─────────────────────────────────────────────►
   │                                                              │
   │                                                              ▼
   │                                                         MySQL 5.6
   │                                                              │
   │    ┌─────────────────────────────────────────────────────────┘
   │    │
   └───►│
        │
        ▼
   MariaDB 5.5 ───► MariaDB 10.0 ───► MariaDB 10.2 ───► MariaDB 10.6+
   
   共同起点                    分叉发展
```

关键时间点：
- **2010 年**：MariaDB 5.5 发布，与 MySQL 5.5 完全兼容
- **2012 年**：MariaDB 10.0，引入了大量新特性
- **2018 年**：MySQL 8.0 发布，两个项目特性开始分化

---

## 架构层面的差异

### 服务端组件对比

| 组件 | MySQL 8.0 | MariaDB 10.6 |
|------|-----------|--------------|
| 查询解析器 | MySQL Parser | MariaDB Parser |
| 优化器 | MySQL Optimizer | MariaDB Optimizer (改进) |
| 插件接口 | ✅ | ✅ (兼容 + 扩展) |
| 存储引擎接口 | InnoDB 为主 | 多引擎并存 |

### 默认存储引擎

```sql
-- MySQL 8.0
SELECT @@default_storage_engine;
-- 结果：InnoDB

-- MariaDB 10.6
SELECT @@default_storage_engine;
-- 结果：InnoDB (MariaDB 自己的 InnoDB)
```

注意：MariaDB 使用的是 MariaDB 自己维护的 InnoDB 分支，而非 Oracle 的 MySQL InnoDB。

---

## SQL 语法差异

### 1. 系统变量命名

```sql
-- MySQL 8.0
SELECT @@sql_mode;
SELECT @@version;
SELECT @@character_set_server;

-- MariaDB 10.x
-- MariaDB 也支持上述写法，但有自己的变量
SELECT @@sql_mode;
SELECT @@version;
SELECT @@version_mysql;
```

### 2. GTID（全局事务 ID）

```sql
-- MySQL 8.0
SET @@GLOBAL.gtid_mode = ON;

-- MariaDB 10.x
-- MariaDB 支持两种 GTID 模式
SET GLOBAL gtid_domain_id = 1;
SET GLOBAL gtid_pos_engines = 'innodb';
```

### 3. 日期时间函数

```sql
-- MariaDB 特有的函数
SELECT DAYOFWEEK('2024-01-01');           -- 返回星期几（1=周日）
SELECT WEEKDAY('2024-01-01');            -- 返回工作日（0=周一）
SELECT MAKEDATE(2024, 1);                 -- 创建日期
SELECT TIMEDIFF('2024-01-02', '2024-01-01');  -- 时间差

-- MariaDB 特有的聚合函数
SELECT JSON_ARRAYAGG(column) FROM t;      -- JSON 数组聚合
SELECT JSON_OBJECTAGG(key, value) FROM t; -- JSON 对象聚合
```

### 4. 窗口函数

两个数据库都支持，但实现有细微差异：

```sql
-- 两者都支持的基本窗口函数
SELECT 
    name,
    department,
    salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) as rank,
    AVG(salary) OVER (PARTITION BY department) as dept_avg,
    SUM(salary) OVER (ORDER BY salary ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) as moving_sum
FROM employees;
```

**差异**：MariaDB 10.2+ 支持，`ROWS BETWEEN` 在 MariaDB 中有更好的优化。

---

## 存储引擎差异

### MySQL 8.0 存储引擎

| 引擎 | 支持 | 默认 |
|------|------|------|
| InnoDB | ✅ | ✅ |
| MyISAM | ✅ | ❌ |
| Memory | ✅ | ❌ |
| CSV | ✅ | ❌ |
| Archive | ✅ | ❌ |
| Blackhole | ✅ | ❌ |
| Federated | ✅ | ❌ (默认禁用) |

### MariaDB 10.6 存储引擎

| 引擎 | 支持 | 说明 |
|------|------|------|
| InnoDB | ✅ | MariaDB 维护的版本 |
| MyISAM | ✅ | 改进版 |
| Aria | ✅ | 替代 MyISAM 的选择 |
| XtraDB | ✅ | InnoDB 增强版（默认启用） |
| TokuDB | ✅ | Fractal Tree 索引 |
| Spider | ✅ | 分片存储引擎 |
| CONNECT | ✅ | 虚拟表引擎 |
| ColumnStore | ✅ | 列式存储 |
| CassandraSE | ✅ | NoSQL 接口 |

### InnoDB 的差异

```
MySQL InnoDB vs MariaDB InnoDB

┌─────────────────────────────────────────────────────────────┐
│                    MySQL InnoDB (Oracle)                    │
├─────────────────────────────────────────────────────────────┤
│  - Oracle 官方维护                                         │
│  - 与 MySQL 版本同步更新                                   │
│  - 独立的 MySQL Performance Schema                        │
│  - 数据字典基于 InnoDB                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 MariaDB InnoDB (MariaDB Foundation)        │
├─────────────────────────────────────────────────────────────┤
│  - 基于 Oracle InnoDB + XtraDB 改进                       │
│  - 从 MariaDB 10.2 开始使用 Percona XtraDB 作为基础        │
│  - 与 MariaDB 版本同步更新                                 │
│  - 部分性能优化来自 XtraDB                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 线程池

### MySQL 企业版线程池（收费）

```sql
-- MySQL 企业版
-- 需要 license 才能使用
INSTALL PLUGIN thread_pool SONAME 'thread_pool.so';
```

### MariaDB 开源线程池（免费）

```sql
-- MariaDB 所有版本都可用
-- 查看线程池状态
SHOW STATUS LIKE 'Thread_pool%';

-- 配置线程池
SET GLOBAL thread_pool_size = 16;
SET GLOBAL thread_pool_stall_limit = 500;
```

**线程池工作原理**：

```
┌─────────────────────────────────────────────────────────────┐
│                    MariaDB 线程池架构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   连接请求 ──► 监听线程                                       │
│                    │                                         │
│              ┌─────┴─────┐                                  │
│              ▼           ▼                                   │
│         线程组 1     线程组 2     ...                       │
│         [线程池]     [线程池]                                │
│              │           │                                  │
│              └─────┬─────┘                                  │
│                    ▼                                        │
│              请求队列（stall 监控）                           │
│                    │                                         │
│                    ▼                                        │
│              空闲线程池                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## JSON 支持差异

### MySQL 8.0 JSON

```sql
-- MySQL 8.0 JSON 函数
SELECT JSON_OBJECT('name', name, 'age', age) FROM users;
SELECT JSON_EXTRACT(data, '$.field');
SELECT JSON_SET(data, '$.field', value);
SELECT JSON_TABLE(data, '$[*]' COLUMNS (val PATH '$')) as t;
```

### MariaDB JSON

```sql
-- MariaDB 使用基础 JSON 函数（部分）
SELECT JSON_EXTRACT(data, '$.field');
SELECT JSON_VALUE(data, '$.field');

-- MariaDB 特有：JSON_DETAILED
SELECT JSON_DETAILED(data);

-- MariaDB 推荐：使用虚拟列代替 JSON
CREATE TABLE t (
    data JSON,
    name VARCHAR(100) GENERATED ALWAYS AS (data->>'$.name')
);
```

**注意**：MariaDB 对 JSON 的支持不如 MySQL 8.0 完善，但虚拟列提供了替代方案。

---

## 字符集与排序规则

### 默认字符集

```sql
-- MySQL 8.0
SELECT @@character_set_server;
-- 结果：utf8mb4

-- MariaDB 10.6
SELECT @@character_set_server;
-- 结果：utf8mb4
```

### MariaDB 特有的排序规则

```sql
-- MariaDB 特有的 Unicode 排序规则
SHOW COLLATION LIKE 'utf8mb4%';

-- MariaDB 特有：uca0900 排序规则
-- 基于 Unicode Collation Algorithm 9.0.0
utf8mb4_unicode_uca_ci
utf8mb4_uca0900_as_cs

-- 支持更多语言
utf8mb4_unicode_520_ci  -- 支持 Unicode 5.2.0
```

---

## GTID 差异

### MySQL GTID

```sql
SET GLOBAL gtid_mode = ON;
SET GLOBAL enforce_gtid_consistency = ON;
```

### MariaDB GTID（兼容 MySQL + 自己的增强）

```sql
-- 兼容 MySQL GTID
SET GLOBAL gtid_domain_id = 1;  -- MariaDB 特有
SET GLOBAL gtid_pos_engines = 'innodb';

-- MariaDB GTID 结构
-- server_id:sequence_number:domain_id
-- 与 MySQL 的 UUID:sequence_number 不同
```

**关键差异**：
- MySQL 使用 `UUID:number`
- MariaDB 使用 `server_id:sequence_number:domain_id`
- MariaDB GTID 在集群场景更灵活

---

## 复制差异

### MySQL 异步复制

```sql
-- MySQL 主从配置
CHANGE MASTER TO
    MASTER_HOST='master_host',
    MASTER_USER='repl_user',
    MASTER_PASSWORD='password',
    MASTER_LOG_FILE='mysql-bin.000001',
    MASTER_LOG_POS=123;
```

### MariaDB 复制（兼容 + 增强）

```sql
-- 兼容 MySQL 的配置方式
CHANGE MASTER TO
    MASTER_HOST='master_host',
    MASTER_USER='repl_user',
    MASTER_PASSWORD='password';

-- MariaDB 特有：全局事务 ID
SET GLOBAL gtid_slave_pos = '1-1-123';
CHANGE MASTER TO master_use_gtid = 'current_pos';

-- MariaDB 特有：并行复制增强
SET GLOBAL slave_parallel_threads = 4;
```

---

## Java 连接兼容性

### MySQL Connector/J

```java
// MySQL 连接（MariaDB 也兼容）
String url = "jdbc:mysql://localhost:3306/testdb";
Connection conn = DriverManager.getConnection(url, user, password);
```

### MariaDB Connector/J（推荐）

```java
// MariaDB 官方驱动（完全兼容，性能更好）
// Maven
// org.mariadb.jdbc:mariadb-java-client

String url = "jdbc:mariadb://localhost:3306/testdb";
Connection conn = DriverManager.getConnection(url, user, password);

// 或者使用普通 MySQL URL
String url2 = "jdbc:mysql://localhost:3306/testdb?user=user&password=password";
Connection conn2 = DriverManager.getConnection(url2);
```

**MariaDB Connector/J 特性**：
- 完全兼容 MySQL 协议
- 支持 MariaDB 特有功能（批量插入优化、线程池）
- 性能更好
- 维护更及时

---

## 迁移注意事项

### 从 MySQL 迁移到 MariaDB

```sql
-- 1. 导出 MySQL 数据
mysqldump -u root -p --all-databases > backup.sql

-- 2. 修改备份（可选）
-- 移除 MySQL 特有的函数和语法

-- 3. 导入 MariaDB
mysql -u root -p < backup.sql

-- 4. 检查兼容性
SELECT * FROM mysql.general_log;  -- 检查错误
```

### 需要注意的兼容性问题

| 问题 | MySQL | MariaDB | 解决方案 |
|------|-------|---------|----------|
| `JSON_OBJECTAGG` | ✅ | ❌ | 使用虚拟列 |
| `EXCEPT/INTERSECT` | 8.0+ | ❌ | 使用子查询 |
| `CTE` | 8.0+ | 10.2+ | 降级需重写 |
| `窗口函数` | 8.0+ | 10.2+ | 降级需重写 |
| `CTAS + SELECT` | ✅ | ✅ | 兼容 |

---

## 面试追问

### 追问一：两个数据库能互相复制吗？

**技术上可以**，但有限制：

```
MySQL → MariaDB：✅ 完全支持
MariaDB → MySQL：⚠️ 需要注意 GTID 格式差异
```

最佳实践：
- 使用 `mysqldump` 迁移数据
- 迁移后再配置复制
- 避免混用 GTID 格式

### 追问二：性能上哪个更好？

取决于具体场景：

| 场景 | MySQL | MariaDB |
|------|-------|---------|
| 标准 OLTP | 相同 | 相同 |
| 高并发连接 | 需要企业版线程池 | 开源线程池更好 |
| 复杂查询 | 优化器更好 | 窗口函数支持更好 |
| 集群部署 | MGR | Galera Cluster 更成熟 |
| 读写分离 | 中间件 | MaxScale 更好 |

### 追问三：未来哪个更有前途？

考虑因素：

| 因素 | MySQL | MariaDB |
|------|-------|---------|
| 商业支持 | Oracle | MariaDB Corporation |
| 社区活跃度 | 高 | 高 |
| 创新速度 | 中等 | 较快 |
| 兼容性 | 参考标准 | 保持兼容 |
| 云支持 | AWS RDS | SkySQL + 多云 |

---

## 总结

| 对比维度 | MySQL 8.0 | MariaDB 10.6 |
|----------|-----------|--------------|
| 兼容性 | 参考标准 | 保持与 MySQL 兼容 |
| 线程池 | 企业版收费 | 开源免费 |
| JSON 支持 | 更完善 | 基本支持 + 虚拟列 |
| 存储引擎 | InnoDB 为主 | 多引擎并存 |
| 新特性 | Oracle 开发 | 社区驱动 |
| GTID | UUID 格式 | server_id 格式 |
| 窗口函数/CTE | ✅ | ✅ (10.2+) |
| Galera Cluster | ❌ | ✅ |

**选择建议**：
- 需要线程池 + 开源：选择 MariaDB
- 需要完整 JSON 支持：选择 MySQL
- 担心许可证风险：选择 MariaDB
- 需要 Oracle 官方支持：选择 MySQL

---

## 下一步

- 想了解 MariaDB 的存储引擎？[MariaDB 存储引擎：InnoDB、Aria、XtraDB、TokuDB](/database/mariadb/engine)
- 想了解 MariaDB 的新特性？[MariaDB 新增特性：系统版本表、Galera Cluster、Spider 存储引擎](/database/mariadb/new-feature)
- 想了解 MariaDB 的集群方案？[MariaDB Galera Cluster 原理：同步多主复制](/database/mariadb/galera)
