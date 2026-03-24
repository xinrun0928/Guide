# 主从延迟：那个让你头疼的问题

你的读写分离架构搭好了，查询都打到从库。

但突然有用户反馈：「我刚下的单，怎么查不到了？」

这是典型的**主从延迟**问题。

---

## 什么是主从延迟？

主从延迟是指：从库的数据比主库慢，落后于主库一段时间。

```sql
-- 主库：立即能看到最新数据
SELECT * FROM orders WHERE id = 10001;
-- 结果：有这条记录

-- 从库：可能看不到（延迟中）
SELECT * FROM orders WHERE id = 10001;
-- 结果：可能没有这条记录（主从延迟中）
```

---

## 主从延迟的原理

### 复制延迟的来源

```
主库执行事务 → 写入 Binlog → 发送到从库 → 从库写入 Relay Log → 从库执行 SQL
                      ↓            ↓             ↓               ↓
                    T1            T2            T3              T4
                    └─────────── 延迟时间 ──────────┘
```

每个环节都可能产生延迟：
1. **Binlog 写入延迟**：主库事务提交后才写 Binlog
2. **网络传输延迟**：Binlog 从主库传输到从库
3. **Relay Log 写入延迟**：从库接收后写入 Relay Log
4. **SQL 执行延迟**：从库执行 SQL（可能是大事务）

### 延迟的计算

```sql
SHOW SLAVE STATUS\G
```

关键字段：
```
Slave_IO_Running: Yes           -- I/O 线程运行中
Slave_SQL_Running: Yes          -- SQL 线程运行中
Seconds_Behind_Master: 30        -- 延迟 30 秒
Read_Master_Log_Pos: 12345678   -- 读取到主库 Binlog 的位置
Exec_Master_Log_Pos: 12345600   -- 执行到主库 Binlog 的位置
```

---

## 延迟的原因

### 原因一：大事务

```sql
-- 主库：执行一个大事务，耗时 10 秒
BEGIN;
-- 插入 100 万条数据
INSERT INTO orders (...) VALUES (...);  -- 耗时 10 秒
COMMIT;
-- 写入 Binlog：立即
-- 发送到从库：很快
-- 从库执行：也需要 10 秒
```

**问题**：主库几秒钟就完成了，但从库执行可能要更久。

**解决**：拆分大事务为小事务。

```sql
-- 不好：一条 INSERT 插入 100 万条
INSERT INTO orders (...) VALUES (...), (...), ...;

-- 好：分批插入，每批 1000 条
INSERT INTO orders (...) VALUES ...;  -- 1000 条
INSERT INTO orders (...) VALUES ...;  -- 1000 条
-- ... 重复 1000 次
```

### 原因二：从库机器性能差

从库和主库配置不同，或者从库负载高。

```bash
# 检查从库 CPU 使用
top
# 检查从库 I/O 情况
iostat -x 1
```

**解决**：保证主从库硬件配置一致，从库不要跑其他服务。

### 原因三：网络延迟

主从库之间的网络延迟高。

```bash
# 测试主从库之间的网络延迟
ping 主库IP
# 或
iperf -c 主库IP
```

**解决**：主从库部署在同一机房，使用高速网络。

### 原因四：大事务的 Binlog

```sql
-- ROW 格式下，大事务的 Binlog 可能很大
-- 传输时间长

-- STATEMENT 格式：Binlog 较小，但可能有数据不一致风险
binlog-format = STATEMENT
```

**解决**：使用 `binlog-row-image = MINIMAL` 减少 Binlog 大小。

### 原因五：从库复制压力大

从库同时跑了很多查询，占用资源。

```sql
-- 查看从库状态
SHOW PROCESSLIST;
-- 看到大量查询在运行

-- 从库不应该跑复杂查询
-- 复杂查询应该在单独的分析库上跑
```

---

## 延迟的处理方案

### 方案一：保证从库性能

```ini
# 从库配置
[mysqld]
innodb_flush_log_at_trx_commit = 2  # 可以适当降低
sync_binlog = 0  # 减少 Binlog 同步压力
```

### 方案二：读写分离 + 延迟感知

```java
@Service
public class OrderService {
    @Autowired
    private DataSource masterDataSource;
    @Autowired
    private DataSource slaveDataSource;

    /**
     * 写入后立即读取（避免主从延迟问题）
     */
    public Order createOrderAndGet(Order order) {
        // 写入主库
        try (Connection conn = masterDataSource.getConnection()) {
            orderMapper.insert(conn, order);
        }

        // 立即读取时，强制读主库
        return orderMapper.selectById(order.getId());  // 读主库
    }

    /**
     * 允许延迟的读取
     */
    public List&lt;Order&gt; listOrders() {
        // 读从库，可以有延迟
        try (Connection conn = slaveDataSource.getConnection()) {
            return orderMapper.selectList(conn);
        }
    }
}
```

### 方案三：配置延迟阈值告警

```sql
-- 设置延迟告警阈值
-- 如果延迟超过 10 秒，发送告警
SELECT * FROM mysql.slave_master_info;
```

### 方案四：使用 GTID 复制

```ini
[mysqld]
gtid_mode = ON
enforce_gtid_consistency = ON
```

GTID 复制可以更精确地追踪复制状态，自动跳过错误的事务。

---

## 延迟监控

```java
@Service
public class ReplicationMonitor {
    /**
     * 监控主从延迟，超过阈值告警
     */
    public void monitorReplication() {
        try (Connection conn = dataSource.getConnection()) {
            ResultSet rs = conn.createStatement()
                .executeQuery("SHOW SLAVE STATUS");

            if (rs.next()) {
                int delay = rs.getInt("Seconds_Behind_Master");
                String ioRunning = rs.getString("Slave_IO_Running");
                String sqlRunning = rs.getString("Slave_SQL_Running");

                // 检查复制是否中断
                if (!"Yes".equals(ioRunning) || !"Yes".equals(sqlRunning)) {
                    alertService.send("主从复制中断！");
                }

                // 检查延迟
                if (delay > 60) {
                    alertService.send(String.format("主从延迟 %d 秒", delay));
                }

                // 检查错误
                String lastError = rs.getString("Last_Error");
                if (lastError != null && !lastError.isEmpty()) {
                    alertService.send("主从复制错误：" + lastError);
                }
            }
        }
    }
}
```

---

## 延迟预防最佳实践

| 实践 | 说明 |
|------|------|
| 大事务拆分 | 每条事务控制在 1000 行以内 |
| 硬件一致 | 主从库硬件配置相同 |
| 同一机房 | 主从库在同一机房，网络延迟小 |
| 隔离负载 | 从库只做复制和简单查询 |
| GTID 复制 | 使用 GTID 模式，更可靠 |
| 监控告警 | 设置延迟阈值，超过即告警 |

---

## 面试追问方向

- 主从延迟是怎么产生的？
- 如何判断主从延迟？
- 什么操作会产生大事务？
- 主从延迟了怎么办？

> 主从延迟是读写分离架构的常见问题。预防大于治疗：大事务拆分、保证从库性能、同一机房部署，都是有效的预防手段。
