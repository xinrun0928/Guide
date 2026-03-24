# 主从复制：MySQL 的数据同步之道

你的数据库已经扛不住了，一台服务器的资源用到了极限。

DBA 给了你一个方案：「上一台从库，做主从复制，读写分离。」

主从复制是什么？它是怎么工作的？今天，我们彻底搞懂它。

---

## 什么是主从复制？

主从复制（Replication）是 MySQL 最基础的高可用方案。

核心原理很简单：**主库（Master）把所有数据变更记录到 Binlog，从库（Slave）读取主库的 Binlog 并执行，实现数据同步。**

```
┌─────────────────────────────────────────────────────────────┐
│                      主从复制架构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    ┌─────────────┐                         │
│                    │   Master    │                         │
│                    │  (主库)     │                         │
│                    └──────┬──────┘                         │
│                           │                                 │
│                    binlog │ 写入                            │
│                           ↓                                 │
│                    ┌─────────────┐                         │
│                    │  Binlog     │                         │
│                    └─────────────┘                         │
│                           │                                 │
│                    ┌──────┴──────┐                         │
│                    │  I/O Thread │                         │
│                    └──────┬──────┘                         │
│                           │ 网络传输                        │
│              ┌───────────┴───────────┐                    │
│              ↓                       ↓                     │
│       ┌─────────────┐         ┌─────────────┐             │
│       │   Slave 1   │         │   Slave 2   │             │
│       │  (从库1)    │         │  (从库2)    │             │
│       └─────────────┘         └─────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 主从复制的工作原理

### 三条线程

主从复制依赖三条线程：

1. **Binlog Dump 线程（主库）**：读取 Binlog 并发送给从库
2. **I/O 线程（从库）**：接收主库的 Binlog，写入 Relay Log
3. **SQL 线程（从库）**：读取 Relay Log，执行 SQL 语句

### 复制过程

```
┌────────────────────────────────────────────────────────────┐
│                      主从复制流程                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 主库：                                                      │
│ 1. 事务提交                                                 │
│ 2. 写入 Binlog                                             │
│ 3. Binlog Dump 线程读取 Binlog，发送给从库                 │
│                                                            │
│ 从库：                                                      │
│ 4. I/O 线程接收 Binlog，写入 Relay Log                     │
│ 5. SQL 线程读取 Relay Log，执行 SQL                         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 代码级别的理解

```java
// 主库 Binlog Dump 线程
public class BinlogDumpThread {
    public void run() {
        while (running) {
            // 1. 读取 Binlog
            BinlogEvent event = binlogReader.nextEvent();

            // 2. 发送给从库
            if (event != null) {
                sendToSlave(event);
            }
        }
    }
}

// 从库 I/O 线程
public class IOThread {
    public void run() {
        while (running) {
            // 1. 接收 Binlog
            BinlogEvent event = receiveFromMaster();

            // 2. 写入 Relay Log
            relayLog.write(event);
        }
    }
}

// 从库 SQL 线程
public class SQLThread {
    public void run() {
        while (running) {
            // 1. 读取 Relay Log
            BinlogEvent event = relayLog.read();

            // 2. 执行 SQL
            execute(event);
        }
    }
}
```

---

## 主从复制的配置

### 主库配置

```ini
[mysqld]
server-id = 1  # 必须唯一
log-bin = mysql-bin  # 开启 Binlog
binlog-format = ROW  # 建议使用 ROW 格式
sync-binlog = 1  # 每次事务提交都同步到 Binlog
```

### 从库配置

```ini
[mysqld]
server-id = 2  # 必须唯一
relay-log = relay-bin  # 开启 Relay Log
read-only = ON  # 从库只读
```

### 创建复制账号

```sql
-- 主库执行：创建复制账号
CREATE USER 'repl'@'%' IDENTIFIED BY 'password';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';

-- 从库执行：连接主库
CHANGE MASTER TO
    MASTER_HOST = '主库IP',
    MASTER_USER = 'repl',
    MASTER_PASSWORD = 'password',
    MASTER_LOG_FILE = 'mysql-bin.000001',
    MASTER_LOG_POS = 0;

START SLAVE;
```

---

## 主从复制的三种模式

### 模式一：异步复制（默认）

主库提交事务后，不等待从库确认就返回。

```
主库：提交事务 → 写入 Binlog → 返回成功
                              ↓
                        从库：接收并执行（可能延迟）
```

**特点**：延迟大，但主库性能最好。

### 模式二：半同步复制（Semi-sync）

主库提交事务后，等待至少一个从库确认收到 Binlog 才返回。

```
主库：提交事务 → 写入 Binlog → 等待从库确认 → 返回成功
                                        ↓
                                  从库确认
```

**特点**：比异步安全，比全同步快。

### 模式三：全同步复制

主库提交事务后，等待所有从库都执行完成才返回。

**特点**：最安全，但性能最差，实际很少用。

---

## 主从复制的用途

### 用途一：读写分离

```
写操作 → Master
读操作 → Slave 1, Slave 2, ...
```

### 用途二：数据备份

从库作为数据备份，主库出问题时可以切换。

### 用途三：故障切换

主库挂了，从库可以升级为主库，继续提供服务。

### 用途四：数据分析

在从库上跑报表，不影响主库业务。

---

## 主从复制的问题

### 问题一：复制延迟

```sql
-- 查看从库延迟
SHOW SLAVE STATUS\G
-- Seconds_Behind_Master: 0  -- 没有延迟
-- Seconds_Behind_Master: 30  -- 延迟 30 秒
```

延迟原因：
- 网络延迟
- 从库机器性能差
- 大事务执行时间长

### 问题二：数据不一致

如果主从数据不一致，可能导致：
- 读写分离时读到旧数据
- 切换主库时数据丢失

### 问题三：Binlog 格式选择

| 格式 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| STATEMENT | 记录 SQL 语句 | Binlog 小 | 某些函数执行结果不一致 |
| ROW | 记录行的变化 | 精确 | Binlog 大 |
| MIXED | 混合使用 | 平衡 | 复杂 |

**建议**：生产环境使用 ROW 格式。

---

## Java 代码：读写分离

```java
@Configuration
public class DataSourceConfig {
    @Bean
    public DataSource masterDataSource() {
        return DataSourceBuilder.create()
            .url("jdbc:mysql://master:3306/guide")
            .build();
    }

    @Bean
    public DataSource slaveDataSource() {
        return DataSourceBuilder.create()
            .url("jdbc:mysql://slave:3306/guide")
            .build();
    }
}

@Component
public class RoutingDataSource extends AbstractRoutingDataSource {
    private static final ThreadLocal&lt;Boolean&gt; isReadOnly = new ThreadLocal&lt;&gt;();

    public static void setReadOnly(boolean readOnly) {
        isReadOnly.set(readOnly);
    }

    public static void clear() {
        isReadOnly.remove();
    }

    @Override
    protected Object determineCurrentLookupKey() {
        Boolean readOnly = isReadOnly.get();
        return (readOnly != null && readOnly) ? "slave" : "master";
    }
}

// 使用示例
public List&lt;Order&gt; getOrders() {
    RoutingDataSource.setReadOnly(true);  // 读操作
    try {
        return orderMapper.selectAll();
    } finally {
        RoutingDataSource.clear();
    }
}
```

---

## 面试追问方向

- 主从复制的原理是什么？
- 主从复制有哪几种模式？区别是什么？
- 主从延迟是怎么产生的？如何解决？
- 如果主库挂了，从库能自动切换吗？

> 主从复制是 MySQL 最基础的高可用方案，核心是 Binlog 的传输和执行。生产环境推荐使用半同步复制，可以平衡性能和安全性。
