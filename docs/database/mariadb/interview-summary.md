# MariaDB 面试高频问题汇总

面试官问：「你了解 MariaDB 和 MySQL 的区别吗？」

你：「MariaDB 是 MySQL 的分支……」

面试官：「还有呢？」

你：「……」

**这篇文章帮你梳理 MariaDB 面试的高频问题，让你在面试中游刃有余。**

---

## 一、基础概念类

### 问题 1：MariaDB 是什么？和 MySQL 是什么关系？

**参考答案**：

MariaDB 是 MySQL 的开源分支，由 MySQL 创始人 Michael "Monty" Widenius 于 2010 年创立。

主要背景：
- 2008 年 Sun 被 Oracle 收购
- 2010 年 Oracle 收购 Sun，获得 MySQL
- 社区担心 MySQL 走向闭源

核心差异：
- MariaDB 5.5 与 MySQL 5.5 完全兼容
- MariaDB 10.x 引入大量新特性
- MariaDB 所有特性都是开源的

**面试追问**：为什么要 fork MySQL？
1. 担心 Oracle 将 MySQL 闭源化
2. 需要开源的线程池等企业特性
3. 社区需要保持创新速度

### 问题 2：MariaDB 的版本体系是怎样的？

**参考答案**：

| 版本 | 说明 | 维护状态 |
|------|------|----------|
| MariaDB 5.5 | 基于 MySQL 5.5 | 已停止维护 |
| MariaDB 10.0-10.1 | 引入 Galera Cluster | 已停止维护 |
| MariaDB 10.2 | 引入窗口函数、CTE | 已停止维护 |
| MariaDB 10.3 | 引入系统版本表 | 已停止维护 |
| MariaDB 10.4-10.5 | 改进 Aria 引擎 | 长期支持 |
| MariaDB 10.6 | LTS 版本 | 长期支持 |
| MariaDB 10.11 | LTS 版本 | 长期支持 |
| MariaDB 11.x | 最新版本 | 开发中 |

---

## 二、存储引擎类

### 问题 3：MariaDB 有哪些存储引擎？

**参考答案**：

| 引擎 | 特点 | 适用场景 |
|------|------|----------|
| InnoDB/XtraDB | 默认引擎，事务支持 | 业务表 |
| Aria | 崩溃安全的 MyISAM 替代 | 日志、只读表 |
| TokuDB | Fractal Tree 索引 | 写入密集型 |
| Spider | 分片存储引擎 | 分布式 |
| CONNECT | 虚拟表 | 外部数据源 |
| ColumnStore | 列式存储 | 分析型 |
| MEMORY | 内存表 | 缓存 |
| MyISAM | 传统引擎 | 过渡表 |

### 问题 4：InnoDB 和 MyISAM 的区别？

| 维度 | InnoDB | MyISAM |
|------|--------|--------|
| 事务 | ✅ | ❌ |
| 行级锁 | ✅ | ❌ |
| 外键 | ✅ | ❌ |
| 崩溃恢复 | 自动 | 手动 |
| 全文索引 | ✅ | ✅（更早支持） |
| 并发性能 | 高 | 低 |
| 索引缓存 | 独立缓冲池 | 键缓存 |

### 问题 5：TokuDB 的 Fractal Tree 和 B-Tree 有什么区别？

**参考答案**：

Fractal Tree 是 TokuDB 使用的索引结构，与 B-Tree 的核心区别：

| 维度 | B-Tree (InnoDB) | Fractal Tree (TokuDB) |
|------|------------------|------------------------|
| 写入 | 原地修改，可能页分裂 | 消息缓冲区，异步合并 |
| I/O | 随机写入 | 可合并为顺序写入 |
| 压缩 | 一般 | 5-15x 高压缩比 |
| 适用 | 标准 OLTP | 写入密集型 |

**面试追问**：TokuDB 为什么写入更快？
TokuDB 的写入先进入节点的消息缓冲区，然后异步刷新到磁盘。这样可以把多个随机写入合并成顺序写入，大幅减少 I/O 次数。

---

## 三、高级特性类

### 问题 6：MariaDB 相比 MySQL 有哪些独特功能？

**参考答案**：

| 特性 | MySQL | MariaDB | 说明 |
|------|-------|---------|------|
| 线程池 | 企业版收费 | ✅ 开源 | 高并发连接优化 |
| Galera Cluster | ❌ | ✅ | 同步多主集群 |
| 窗口函数 | 8.0+ | ✅ 10.2+ | 分析函数 |
| CTEs | 8.0+ | ✅ 10.2+ | 递归查询 |
| 系统版本表 | ❌ | ✅ 10.2+ | 自动历史记录 |
| 虚拟列 | ❌ | ✅ | 计算列 |
| 序列 | ❌ | ✅ 10.3+ | 自定义序列 |
| Spider 引擎 | ❌ | ✅ | 分片存储 |
| CONNECT 引擎 | ❌ | ✅ | 外部数据源 |

### 问题 7：什么是系统版本表？

**参考答案**：

系统版本表是 MariaDB 10.2 引入的功能，自动保存表的历史版本：

```sql
-- 创建带版本的表
CREATE TABLE accounts (
    id INT PRIMARY KEY,
    balance DECIMAL(15,2)
) WITH SYSTEM VERSIONING;

-- 插入
INSERT INTO accounts VALUES (1, 1000);

-- 更新（自动保存旧版本）
UPDATE accounts SET balance = 1500 WHERE id = 1;

-- 查询历史
SELECT * FROM accounts FOR SYSTEM_TIME AS OF '2024-01-01 10:00:00';

-- 查询所有版本
SELECT * FROM accounts FOR SYSTEM_TIME ALL;
```

应用场景：
- 审计日志
- 数据追溯
- 误操作恢复
- 时空查询

### 问题 8：什么是 Galera Cluster？

**参考答案**：

Galera Cluster 是 MariaDB 的**同步多主集群**解决方案：

核心特点：
- **同步复制**：所有节点数据一致
- **多主架构**：任意节点可写入
- **自动故障转移**：节点故障自动剔除
- **强一致性**：真正的 ACID

工作原理：
1. 事务在本地执行，生成 write set
2. Write set 广播到所有节点
3. 每个节点进行 certification（证书验证）
4. 所有节点确认后，事务提交

### 问题 9：Galera Cluster 和 MySQL MGR 的区别？

| 维度 | Galera | MGR |
|------|--------|-----|
| 开发方 | Codership | Oracle |
| 协议 | 乐观并发+证书验证 | Paxos |
| 写入点 | 多主 | 可单主可多主 |
| 性能 | 优化良好 | MySQL 8.0+ |
| 成熟度 | 更成熟 | 较新 |
| 生态 | MariaDB, Percona | 仅 MySQL |

---

## 四、性能优化类

### 问题 10：MariaDB 线程池是什么？

**参考答案**：

线程池解决的是高并发连接的性能问题：

传统问题：
- 每连接一线程，连接数爆炸
- 线程创建/切换开销大
- 上下文切换成为瓶颈

线程池方案：
- 固定数量的工作线程
- 连接请求复用线程
- 减少线程开销

```sql
-- MariaDB 所有版本免费使用
SET GLOBAL thread_pool_size = 16;
SET GLOBAL thread_pool_stall_limit = 500;
```

**面试追问**：线程池和连接池的区别？
- 连接池：复用数据库连接，减少连接创建开销（应用层）
- 线程池：复用执行线程，减少线程创建开销（数据库层）

### 问题 11：如何优化 MariaDB 的写入性能？

**参考答案**：

1. **批量写入**
```sql
-- 批量 INSERT
INSERT INTO orders VALUES 
    (1, 100), (2, 200), (3, 300);
```

2. **事务优化**
```sql
BEGIN;
-- 1000 条 INSERT
COMMIT;  -- 一次提交，比 1000 次提交快
```

3. **选择存储引擎**
- TokuDB：写入密集型场景
- InnoDB：标准场景

4. **参数调优**
- `innodb_flush_log_at_trx_commit = 2`（可接受的风险）
- `innodb_log_file_size` 增大
- `bulk_insert_buffer_size` 增大

5. **索引优化**
- 批量写入前删除索引
- 写入后重建索引

### 问题 12：如何分析慢查询？

**参考答案**：

1. **开启慢查询日志**
```sql
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;
SET GLOBAL slow_query_log_file = '/var/log/mysql/slow.log';
```

2. **使用 EXPLAIN**
```sql
EXPLAIN SELECT * FROM users WHERE name = '张三';
EXPLAIN ANALYZE SELECT ...;  -- MariaDB 10.6+
```

3. **使用 optimizer_trace**
```sql
SET optimizer_trace = 'enabled=on';
SELECT ...;
SELECT * FROM information_schema.optimizer_trace;
```

---

## 五、复制与集群类

### 问题 13：MariaDB 主从复制原理是什么？

**参考答案**：

```
主库 → binlog → Dump 线程 → 网络 → 从库 IO 线程 → relay-log → SQL 线程 → 从库数据
```

核心组件：
- **binlog**：记录所有写操作
- **Dump 线程**：主库的发送线程
- **IO 线程**：从库接收数据
- **SQL 线程**：从库执行 SQL

### 问题 14：GTID 是什么？

**参考答案**：

GTID = Global Transaction ID = 全局事务 ID

格式：`domain_id:server_id:sequence_number`

优势：
1. **自动定位**：不需要 binlog 坐标
2. **不重复执行**：每个事务唯一
3. **故障转移简单**：直接指定 GTID
4. **审计方便**：每个事务可追踪

```sql
-- GTID 模式配置
SET GLOBAL gtid_domain_id = 1;
CHANGE MASTER TO MASTER_USE_GTID = current_pos;
```

### 问题 15：Galera Cluster 的 Quorum 是什么？

**参考答案**：

Quorum = 多数节点投票

计算公式：`Quorum = floor(节点数 / 2) + 1`

| 节点数 | Quorum | 容错能力 |
|--------|--------|----------|
| 3 | 2 | 1 节点 |
| 5 | 3 | 2 节点 |
| 7 | 4 | 3 节点 |

当网络分区时：
- 多数节点保持 Primary 状态，继续服务
- 少数节点变成 Non-Primary，禁止写入

---

## 六、安全类

### 问题 16：MariaDB 有哪些安全特性？

**参考答案**：

1. **密码策略**
```sql
SET GLOBAL validate_password.policy = STRONG;
SET GLOBAL validate_password.length = 16;
```

2. **密码过期**
```sql
ALTER USER 'user'@'%' PASSWORD EXPIRE INTERVAL 90 DAY;
```

3. **角色管理**
```sql
CREATE ROLE 'app_read', 'app_write';
GRANT SELECT ON mydb.* TO 'app_read';
```

4. **审计日志**
```sql
INSTALL SONAME 'server_audit';
SET GLOBAL server_audit_logging = ON;
```

5. **SSL/TLS 加密**
```ini
[mysqld]
ssl_cert = /path/to/server-cert.pem
ssl_key = /path/to/server-key.pem
ssl_ca = /path/to/ca-cert.pem
```

---

## 七、备份恢复类

### 问题 17：MariaDB 的备份方式有哪些？

**参考答案**：

| 方式 | 工具 | 特点 |
|------|------|------|
| 逻辑备份 | mysqldump | 跨平台，灵活 |
| 物理备份 | Mariabackup | 速度快，支持增量 |
| 热备份 | XtraBackup | 无锁备份 |
| 增量备份 | Mariabackup | 基于 LSN |

### 问题 18：Mariabackup 和 mysqldump 的区别？

| 维度 | mysqldump | Mariabackup |
|------|-----------|-------------|
| 备份类型 | 逻辑 | 物理 |
| 速度 | 慢 | 快 |
| 恢复速度 | 慢 | 快 |
| 增量备份 | ❌ | ✅ |
| 锁表 | 需要 | 无锁 |
| 备份大小 | 小 | 大 |

---

## 八、场景设计类

### 问题 19：如何设计一个高可用的 MariaDB 架构？

**参考答案**：

```
┌─────────────────────────────────────────────────────────────┐
│                     高可用架构                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    应用层                                    │
│                       │                                     │
│                       ▼                                     │
│            ┌─────────────────┐                             │
│            │    MaxScale     │ ← 读写分离、负载均衡          │
│            └────────┬────────┘                             │
│                     │                                       │
│     ┌──────────────┼──────────────┐                       │
│     │              │              │                        │
│     ▼              ▼              ▼                        │
│ ┌────────┐   ┌────────┐   ┌────────┐                    │
│ │Master 1│◄──│Master 2│◄──│Master 3│ ← Galera 集群      │
│ └────────┘   └────────┘   └────────┘                    │
│     │              │              │                        │
│     └──────────────┴──────────────┘                        │
│                       │                                     │
│                       ▼                                     │
│              MaxScale 备份 ← XtraBackup                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

组件：
- **Galera Cluster**：同步多主，无数据丢失
- **MaxScale**：读写分离，负载均衡
- **XtraBackup**：热备份，无锁

### 问题 20：什么场景下选 MariaDB 而不是 MySQL？

**参考答案**：

| 场景 | 推荐 | 原因 |
|------|------|------|
| 需要开源线程池 | MariaDB | MySQL 企业版收费 |
| 需要 Galera Cluster | MariaDB | MySQL 无此功能 |
| 需要窗口函数/CTE | 都可以 | MariaDB 10.2+, MySQL 8.0+ |
| 担心许可证风险 | MariaDB | 开源协议更透明 |
| 需要 Oracle 官方支持 | MySQL | Oracle 提供商业支持 |

---

## 九、实操类

### 问题 21：如何排查 MariaDB 连接数过多的问题？

**参考答案**：

1. **查看当前连接**
```sql
SHOW STATUS LIKE 'Threads_connected';
SHOW PROCESSLIST;
```

2. **查看最大连接数**
```sql
SHOW VARIABLES LIKE 'max_connections';
```

3. **排查慢查询导致的连接堆积**
```sql
SHOW PROCESSLIST WHERE Command != 'Sleep';
```

4. **优化建议**
- 增加 `max_connections`
- 减少 `wait_timeout`
- 使用连接池
- 开启线程池

### 问题 22：如何迁移 MySQL 到 MariaDB？

**参考答案**：

1. **备份 MySQL 数据**
```bash
mysqldump -u root -p --all-databases > backup.sql
```

2. **修改备份文件**
- 移除 MySQL 特有的函数
- 检查语法兼容性

3. **安装 MariaDB**

4. **导入数据**
```bash
mysql -u root -p < backup.sql
```

5. **检查兼容性**
```sql
SHOW ERRORS;
SELECT * FROM mysql.general_log;
```

---

## 十、开放性问题

### 问题 23：你认为 MariaDB 的未来发展趋势是什么？

**参考答案**：

1. **云原生支持**
- SkySQL 持续完善
- 多云部署更简单

2. **性能优化**
- 查询优化器改进
- 列式存储增强

3. **新特性**
- JSON 支持增强
- 更好的分布式支持

4. **生态完善**
- 工具链完善
- 社区活跃

### 问题 24：你在项目中用过哪些 MariaDB 特性？

**参考答案**（结合个人项目经验）：

常见答案：
- 使用 Galera Cluster 做高可用
- 使用 CONNECT 引擎访问外部 CSV
- 使用系统版本表做审计
- 使用线程池优化高并发
- 使用虚拟列简化查询
- 使用窗口函数做数据分析

---

## 总结

| 类别 | 高频问题 |
|------|----------|
| 基础概念 | MariaDB vs MySQL、版本体系 |
| 存储引擎 | InnoDB vs MyISAM、TokuDB |
| 高级特性 | Galera、线程池、系统版本表 |
| 复制集群 | GTID、Galera Cluster |
| 安全 | 密码策略、审计、SSL |
| 备份 | Mariabackup vs mysqldump |
| 场景设计 | 高可用架构设计 |

**面试技巧**：
1. 原理和实践结合
2. 能对比分析更好
3. 结合项目经验讲解
4. 了解最新版本动态

---

## 下一步

- 想了解更多数据库知识？[MySQL 面试高频问题汇总](/database/mysql/interview-summary)
- 想了解 Redis？[Redis 面试高频问题汇总](/database/redis/interview-summary)
- 想系统性学习？[数据库知识体系](/database/index)
