# MySQL 存储引擎对比

面试官突然问：「MySQL 有哪些存储引擎？」

你脱口而出：「InnoDB 和 MyISAM。」

然后面试官追问：「它们有什么区别？」

这个问题看似基础，但很多人答不全。今天我们彻底搞清楚。

---

## 为什么 MySQL 要支持多种存储引擎？

MySQL 的存储引擎是**插件式架构**——存储引擎负责数据的存取，但 SQL 解析、查询优化等逻辑在服务层是统一的。

这种设计的好处：

1. **按需选择**：不同业务场景选不同引擎
2. **独立演进**：引擎可以独立开发和优化
3. **表级粒度**：同一个库的不同表可以用不同引擎

---

## 三大存储引擎对比

### InnoDB vs MyISAM vs Memory

| 特性 | InnoDB | MyISAM | Memory |
|-----|--------|--------|--------|
| **事务支持** | ✅ | ❌ | ❌ |
| **外键支持** | ✅ | ❌ | ❌ |
| **锁粒度** | 行锁 | 表锁 | 表锁 |
| **MVCC** | ✅ | ❌ | ❌ |
| **崩溃恢复** | ✅ | ❌ | ❌ |
| **索引类型** | B+ Tree | B+ Tree / Full-text | Hash |
| **存储空间** | 较大 | 较小 | 较小 |
| **适用场景** | 写多、事务需求 | 读多、只读表 | 临时表、缓存 |

---

## InnoDB：生产环境的首选

MySQL 5.5.5 之后，InnoDB 成为默认存储引擎。原因很简单：**它最接近一个「完整数据库」该有的样子**。

### 核心特性

#### 1. 事务支持（ACID）

```java
// InnoDB 支持事务，代码示例
@Transactional
public void transfer(String from, String to, BigDecimal amount) {
    // 转出账户扣钱
    accountMapper.deduct(from, amount);
    // 转入账户加钱
    accountMapper.add(to, amount);
    // 两步操作要么同时成功，要么同时失败
}
```

MyISAM 不支持事务，转账场景下如果扣钱成功、加钱失败，钱就「消失」了。

#### 2. 行锁与并发

```sql
-- InnoDB 行锁示例
BEGIN;
SELECT balance FROM account WHERE id = 1 FOR UPDATE;  -- 只锁定这一行
UPDATE account SET balance = balance - 100 WHERE id = 1;
UPDATE account SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

MyISAM 是表锁，上述操作会锁住整张表，高并发下性能断崖式下降。

#### 3. MVCC 与隔离级别

InnoDB 通过 MVCC（多版本并发控制）支持四种隔离级别，在读已提交和可重复读级别下大幅减少锁竞争。

MyISAM 完全不支持 MVCC。

#### 4. 崩溃恢复

InnoDB 通过 redo log 实现崩溃恢复。MySQL 异常宕机后，InnoDB 能恢复到宕机前的状态。

MyISAM 宕机后可能丢失数据，文件损坏风险更高。

### InnoDB 的适用场景

- **OLTP 系统**：事务是刚需，并发是常态
- **需要外键**：数据一致性要求高
- **频繁更新**：行锁减少锁冲突
- **需要崩溃恢复**：数据安全不能妥协

---

## MyISAM：曾经的王者

MyISAM 在 MySQL 5.5 之前是默认引擎，现在只在特定场景有优势。

### 核心特性

#### 1. 表级锁

```sql
-- MyISAM 锁表示例
LOCK TABLES orders READ;   -- 读锁：所有连接只能读
-- 执行查询...
UNLOCK TABLES;

LOCK TABLES orders WRITE;  -- 写锁：所有连接只能等
-- 执行更新...
UNLOCK TABLES;
```

#### 2. 全文索引

MyISAM 支持 FULLTEXT 全文索引（InnoDB 5.6+ 也支持了）。

#### 3. 表压缩（针对只读表）

```sql
-- 创建压缩表
CREATE TABLE logs (
    id BIGINT,
    content TEXT
) ENGINE=MyISAM ROW_FORMAT=COMPRESSED;
```

#### 4. 存储结构

```
user.MYD  -- 数据文件
user.MYI  -- 索引文件
user.frm  -- 表结构文件
```

### MyISAM 的适用场景

- **只读报表表**：数据不更新，只有查询
- **日志表**：写入后几乎不修改（用 ARCHIVE 引擎更优）
- **全文搜索**：5.6 之前的 InnoDB 不支持全文索引

> 但说实话，这些场景现在 InnoDB 都能做，MyISAM 的优势越来越小。

---

## Memory：内存里的表

Memory 引擎把数据存在内存中，读写速度极快，但有致命限制。

### 核心特性

#### 1. Hash 索引

```sql
CREATE TABLE cache (
    session_id VARCHAR(32),
    data TEXT
) ENGINE=Memory;

-- Memory 默认使用 Hash 索引，等值查询 O(1)
SELECT * FROM cache WHERE session_id = 'abc123';
```

#### 2. 数据易失

```java
// Memory 表的数据特点
// 1. 服务器重启，数据全部丢失
// 2. 表级锁，并发写入是瓶颈
// 3. 固定长度存储，不支持 BLOB/TEXT
```

#### 3. 存储限制

Memory 表最大大小由 `max_heap_table_size` 控制（默认 16MB），超出就报错。

### Memory 的适用场景

- **临时表**：连接池管理、复杂查询中间结果
- **缓存表**：频繁等值查询、数据可丢失
- **Lookup 表**：配置表、枚举映射

---

## 选择决策树

```
需要事务支持？
    │
    ├── 否 → 数据频繁更新？→ 是 → InnoDB
    │           │
    │           └── 否 → 只读场景？→ 是 → MyISAM
    │                        │
    │                        └── 否 → Archive
    │
    └── 是 → InnoDB（唯一选择）
```

---

## 面试高频追问

### Q1：InnoDB 和 MyISAM 索引结构有什么区别？

两者底层都是 B+ 树，但有区别：

- **InnoDB**：数据和索引在同一个文件（.ibd），聚簇索引叶子节点存储完整行数据
- **MyISAM**：数据和索引分离（.MYD 和 .MYI），叶子节点存储数据地址

### Q2：为什么 InnoDB 推荐使用自增主键？

InnoDB 的聚簇索引叶子节点存储行数据，自增主键保证新插入的数据总是在叶子节点末尾，**顺序写入性能最优**。

如果用 UUID 或非自增主键，新插入的数据可能插入到 B+ 树中间，导致大量页分裂和随机 I/O。

```java
// 自增主键 vs UUID
// 自增主键：append 操作，树结构稳定
// UUID：随机插入，树频繁调整
```

### Q3：Memory 引擎和 Redis 有什么区别？

| 对比 | Memory 引擎 | Redis |
|-----|------------|-------|
| 数据持久化 | ❌ 完全不持久化 | ✅ 可配置 RDB/AOF |
| 数据结构 | 简单表格 | String/Hash/List/Set/ZSet |
| 分布式 | ❌ 单机 | ✅ 支持集群 |
| 超时机制 | ❌ 无 | ✅ 可设置 TTL |

---

## 总结

| 引擎 | 选型建议 |
|-----|---------|
| InnoDB | 默认选择，99% 的场景用它 |
| MyISAM | 基本不用了，除非极特殊情况 |
| Memory | 临时表、缓存，注意数据丢失 |

记住一个原则：**能用 InnoDB 就用 InnoDB**，它解决了 MyISAM 的大部分痛点。