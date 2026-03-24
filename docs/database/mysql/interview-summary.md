# MySQL 面试汇总：高频问题与答题思路

MySQL 是后端面试的重头戏，无论是 Java 开发、还是 DBA 岗位，MySQL 都是必考内容。

本文汇总了 MySQL 面试中的高频问题，并给出详细的答题思路。

---

## 一、索引高频问题

### 问题 1：B+ 树 vs 红黑树，为什么 MySQL 用 B+ 树？

**参考答案**：

红黑树的树高是 O(log n)，100 万数据树高约 27；B+ 树的非叶子节点只存索引不存数据，同样大小能存更多索引，100 万数据树高只需 3-4。

关键原因是**磁盘 I/O**。MySQL 数据存在磁盘上，每次 I/O 以页（16KB）为单位。B+ 树每个节点刚好是一页，树高低意味着 I/O 次数少。

另外 B+ 树的叶子节点用链表连接，**范围查询**只需遍历链表，不需要回溯。

---

### 问题 2：聚簇索引 vs 非聚簇索引

**参考答案**：

聚簇索引的叶子节点存储完整行数据，非聚簇索引（辅助索引）只存主键值。

InnoDB 中，主键索引就是聚簇索引，查询主键可以直接返回数据，无需回表。查询非聚簇索引需要先找到主键，再回表查完整数据。

**最佳实践**：主键用自增 ID，不要用 UUID（无序插入会导致页分裂）。

---

### 问题 3：联合索引的最左前缀原则

**参考答案**：

联合索引 `(a, b, c)` 按 a 排序，a 相同按 b 排序，b 相同按 c 排序。

只有从最左边开始连续使用，索引才能生效。

- `WHERE a = 1 AND b = 2` ✅ 能用
- `WHERE b = 2` ❌ 不能用（跳过 a）
- `WHERE a = 1 AND c = 3` ⚠️ 只能用 a（b 断了）

**追问**：范围查询（`>`、`<`、`BETWEEN`）会阻断后续字段。

---

### 问题 4：覆盖索引

**参考答案**：

如果查询的所有字段都在索引中，MySQL 不需要回表，直接在索引中返回结果。

EXPLAIN 的 Extra 列会显示 `Using index`。

**适用场景**：高频查询的字段尽量设计成覆盖索引，减少回表。

---

### 问题 5：索引失效的场景

**参考答案**：

1. **最左前缀原则**：跳过索引最左列
2. **范围查询阻断**：范围查询右边的列无法使用索引
3. **函数/计算**：`WHERE YEAR(created_at) = 2024` 索引失效
4. **类型不匹配**：`WHERE id = '1'` 字符串和数字比较
5. **LIKE % 开头**：`WHERE name LIKE '%三'` 无法利用索引有序性

---

### 问题 6：Hash 索引 vs B+ 树索引

**参考答案**：

| 特性 | Hash | B+ 树 |
|------|------|-------|
| 等值查询 | O(1)，最快 | O(log n) |
| 范围查询 | 不支持 | 高效 |
| 排序 | 不支持 | 高效 |
| 适用场景 | 等值查询极多 | 大多数场景 |

MySQL 默认是 B+ 树索引，Memory 引擎支持 Hash 索引。InnoDB 有自适应 Hash 索引。

---

## 二、事务高频问题

### 问题 7：ACID 是什么？InnoDB 怎么实现的？

**参考答案**：

- **A（原子性）**：事务是最小单元，InnoDB 用 Undo Log 实现回滚
- **C（一致性）**：事务前后数据状态合法，Redo Log + Undo Log + 锁保证
- **I（隔离性）**：并发事务相互隔离，MVCC + 锁实现
- **D（持久性）**：事务提交后修改永久保存，Redo Log 保证

---

### 问题 8：事务隔离级别

**参考答案**：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|----------|------|------------|------|
| 读未提交 | ❌ | ❌ | ❌ |
| 读已提交 | ✅ | ❌ | ❌ |
| 可重复读 | ✅ | ✅ | ✅（InnoDB） |
| 串行化 | ✅ | ✅ | ✅ |

MySQL InnoDB 默认是可重复读，Oracle 默认是读已提交。

---

### 问题 9：MVCC 原理

**参考答案**：

MVCC 是多版本并发控制，每个事务看到的是某个时间点的快照。

核心概念：
- **隐藏列**：`DB_TRX_ID`（事务 ID）、`DB_ROLL_PTR`（回滚指针）
- **Undo Log**：存储历史版本，通过回滚指针串联成版本链
- **ReadView**：记录活跃事务 ID 列表，判断版本可见性

**核心区别**：
- Read Committed：每次读取都生成新 ReadView
- Repeatable Read：事务开始时生成 ReadView，之后复用

---

### 问题 10：快照读 vs 当前读

**参考答案**：

- **快照读**：普通 SELECT，读取历史快照，不加锁。依赖 MVCC
- **当前读**：`SELECT ... FOR UPDATE`、INSERT、UPDATE、DELETE，读取最新数据，加锁

MVCC 解决快照读的并发问题，当前读需要锁机制配合。

---

### 问题 11：MVCC + 间隙锁解决幻读

**参考答案**：

Repeatable Read 隔离级别下，MVCC 解决快照读的幻读，间隙锁（Gap Lock）解决当前读的幻读。

`SELECT ... FOR UPDATE` 会锁定索引范围，阻止其他事务插入新记录。

---

## 三、锁机制高频问题

### 问题 12：表锁 vs 行锁

**参考答案**：

- **表锁**：锁定整张表，开销小但并发差。MyISAM 默认表锁，InnoDB 支持但优先行锁
- **行锁**：锁定具体行，并发好但开销大。InnoDB 默认行锁，锁定索引而非数据行

InnoDB 行锁依赖于索引，如果查询不走索引，会锁住整张表。

---

### 问题 13：意向锁

**参考答案**：

意向锁是表级锁，表明「表中某些行正在被锁定」。

- **IS（意向共享锁）**：事务要获取某些行的共享锁
- **IX（意向排他锁）**：事务要获取某些行的排他锁

**作用**：加表锁时不需要遍历整张表，只需检查意向锁。

---

### 问题 14：两阶段锁

**参考答案**：

两阶段锁协议：
1. **扩展阶段**：只能加锁，不能释放锁
2. **收缩阶段**：只能释放锁，不能加锁

InnoDB 实现的是严格两阶段锁，所有锁在事务提交/回滚时统一释放。

---

### 问题 15：死锁

**参考答案**：

死锁是循环等待，InnoDB 通过等待图检测死锁。

**处理策略**：回滚代价最小的事务（undo log 最少的事务）。

**避免方法**：
- 按固定顺序访问资源
- 减少锁持有时间
- 使用 SELECT ... FOR UPDATE NOWAIT

---

### 问题 16：乐观锁 vs 悲观锁

**参考答案**：

- **悲观锁**：先获取锁再操作，适合写多场景。`SELECT ... FOR UPDATE`
- **乐观锁**：先操作再检查，适合读多场景。用版本号/时间戳判断冲突

```java
UPDATE orders SET status = 'paid', version = version + 1
WHERE id = ? AND version = ?
```

---

## 四、SQL 优化高频问题

### 问题 17：慢查询排查

**参考答案**：

1. 开启慢查询日志：`slow_query_log = ON`
2. 分析日志：`mysqldumpslow`
3. `EXPLAIN` 分析执行计划
4. 关注 `type`（越接近 const/eq_ref 越好）、`key`（是否有索引）、`Extra`（有没有 filesort）

---

### 问题 18：EXPLAIN 关键字段

**参考答案**：

| 字段 | 说明 |
|------|------|
| type | 访问类型，ALL 最差，const/eq_ref 最优 |
| key | 实际使用的索引 |
| rows | 估算扫描行数，越少越好 |
| Extra | Using index（覆盖索引）、Using filesort（需排序）、Using temporary（需临时表） |

---

### 问题 19：深度分页优化

**参考答案**：

`LIMIT 1000000, 100` 需要扫描 100 万行，只返回 100 行。

**优化方案**：
- **游标分页**：记录上一页最后的 ID，`WHERE id > lastId LIMIT 100`
- **延迟关联**：先查主键，再 JOIN 回表
- **禁止跳页**：只提供「上一页/下一页」

---

### 问题 20：JOIN 优化

**参考答案**：

- 确保连接字段有索引
- 小表驱动大表（驱动表行数少）
- 避免 `SELECT *`，只查需要的字段
- 关联表数量不超过 5 个

---

## 五、主从复制高频问题

### 问题 21：主从复制原理

**参考答案**：

1. 主库写入 Binlog
2. 从库 I/O 线程读取主库 Binlog，写入 Relay Log
3. 从库 SQL 线程读取 Relay Log，执行 SQL

**三种模式**：
- 异步复制：主库提交后不等待从库确认
- 半同步复制：等待至少一个从库确认
- 全同步复制：等待所有从库确认

---

### 问题 22：主从延迟及处理

**参考答案**：

**原因**：大事务、网络延迟、从库性能差。

**处理**：
- 拆分大事务
- 保证主从网络通畅
- 使用 GTID 复制
- 读写分离架构下，写后立即读走主库

---

### 问题 23：读写分离的坑

**参考答案**：

- **主从延迟**：写后立即读可能读不到（走主库）
- **事务中不能切换**：事务内读写必须在同一库
- **长事务**：占用主库连接

---

## 六、日志高频问题

### 问题 24：Binlog、Redo Log、Undo Log

**参考答案**：

| 日志 | 用途 | 持久化 |
|------|------|--------|
| Binlog | 主从复制 | 可配置 |
| Redo Log | 崩溃恢复 | 必须 |
| Undo Log | 回滚、MVCC | 必须 |

**两阶段提交**：Redo Log prepare → Binlog → Redo Log commit，保证一致性。

---

### 问题 25：Redo Log vs 数据文件写入

**参考答案**：

直接写数据文件是随机 I/O，效率低。Redo Log 是顺序写入，效率高。

事务提交时先写 Redo Log，再写数据文件。崩溃时通过 Redo Log 恢复。

---

## 七、架构高频问题

### 问题 26：分库分表的方案

**参考答案**：

- **垂直分库**：按业务模块拆分到不同库
- **垂直分表**：按字段冷热拆分
- **水平分库**：按字段哈希拆分到不同库
- **水平分表**：按字段哈希拆分到不同表

**分片算法**：取模（均匀但扩容难）、范围（扩容易但不均匀）、一致性哈希（平衡）

---

### 问题 27：分库分表的问题

**参考答案**：

- **跨分片查询**：广播查询 + 结果聚合
- **分页查询**：游标分页替代深度分页
- **分布式 ID**：雪花算法生成全局唯一 ID
- **事务**：分布式事务（两阶段提交、TCC）

---

### 问题 28：MySQL 高可用方案

**参考答案**：

| 方案 | 复杂度 | 自动切换 |
|------|--------|----------|
| 主从手动切换 | 低 | 否 |
| MHA | 中 | 是 |
| Group Replication | 中高 | 是 |
| Orchestrator | 中 | 是 |
| 云数据库 | 低 | 是 |

生产环境推荐半同步复制 + 自动切换工具。

---

## 八、场景设计题

### 场景 1：设计订单表

```sql
CREATE TABLE orders (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(32) NOT NULL UNIQUE COMMENT '订单号',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    total_amount DECIMAL(10,2) UNSIGNED NOT NULL DEFAULT 0 COMMENT '订单总额',
    status TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '状态',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_status (user_id, status),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

### 场景 2：设计消息记录表（千万级）

```sql
CREATE TABLE messages (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    type TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '消息类型',
    content TEXT COMMENT '消息内容',
    read_status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已读状态',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_user_read (user_id, read_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 按月分区
ALTER TABLE messages PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p202401 VALUES LESS THAN (TO_DAYS('2024-02-01')),
    ...
);
```

---

## 总结

MySQL 面试的核心知识点：

1. **索引**：B+ 树、聚簇索引、覆盖索引、最左前缀
2. **事务**：ACID、隔离级别、MVCC
3. **锁**：表锁/行锁、意向锁、乐观/悲观锁
4. **优化**：EXPLAIN、分页优化、JOIN 优化
5. **架构**：主从复制、读写分离、分库分表

答题技巧：
- 先给定义/原理
- 再给实现机制
- 最后给应用场景/最佳实践
- 能画图就画图

祝你面试顺利！
