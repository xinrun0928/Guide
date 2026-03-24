# MariaDB 线程池（Thread Pool）插件

你的应用有 10000 个并发连接，MySQL 5.7 默认配置下性能开始下降。

你查了文档，发现 MySQL 企业版有「线程池」功能——但要收费。

隔壁的 MariaDB 笑了：「我们开源版就有。」

**线程池是 MariaDB 在高并发场景下的杀手锏，让它在连接数爆炸的时代依然保持高性能。**

---

## 线程池是什么？

### 传统连接模型的问题

MySQL 默认使用「一连接一线程」模型：

```
传统模型：
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ 连接 1   │──►│ 连接 2   │──►│ 连接 3   │──►│ 连接 N   │
└─────────┘   └─────────┘   └─────────┘   └─────────┘
     │             │             │             │
     ▼             ▼             ▼             ▼
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ 线程 1  │   │ 线程 2  │   │ 线程 3  │   │ 线程 N  │
└─────────┘   └─────────┘   └─────────┘   └─────────┘
     │             │             │             │
     └─────────────┴──────┬──────┴─────────────┘
                          │
                          ▼
                    ┌───────────┐
                    │ MariaDB   │
                    │  服务器   │
                    └───────────┘
```

问题：
- 每个连接都占用一个操作系统线程
- 线程创建、切换、销毁有开销
- 线程数过多时，上下文切换成为瓶颈
- 内存占用随连接数线性增长

### 线程池模型

线程池使用固定数量的工作线程处理所有连接：

```
线程池模型：
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ 连接 1   │   │ 连接 2   │   │ 连接 3   │   │ 连接 N   │
└────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘
     │              │              │              │
     └──────────────┴──────────────┴──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  监听线程    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
         ┌────────┐   ┌────────┐   ┌────────┐
         │工作线程1│   │工作线程2│   │工作线程3│
         └────────┘   └────────┘   └────────┘
              │            │            │
              └────────────┴────────────┘
                           │
                           ▼
                    ┌───────────┐
                    │ MariaDB   │
                    │  服务器   │
                    └───────────┘
```

优势：
- 线程数量固定可控
- 连接复用，减少线程创建开销
- 减少上下文切换
- 更好的资源管理

---

## MariaDB 线程池架构

### 线程池组件

```
┌─────────────────────────────────────────────────────────────┐
│                 MariaDB 线程池架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   客户端连接                                                │
│       │                                                    │
│       ▼                                                    │
│   ┌─────────────────────────────────────────────────┐      │
│   │               监听线程 (Listener)                 │      │
│   │  - 接受新连接                                    │      │
│   │  - 分发请求到线程组                              │      │
│   └─────────────────────────────────────────────────┘      │
│                           │                                │
│                           ▼                                │
│   ┌─────────────────────────────────────────────────┐      │
│   │              请求队列 (Request Queue)              │      │
│   │  - 等待执行的请求                                │      │
│   │  - stall 检测                                    │      │
│   └─────────────────────────────────────────────────┘      │
│                           │                                │
│       ┌───────────────────┼───────────────────┐           │
│       │                   │                   │           │
│       ▼                   ▼                   ▼           │
│   ┌────────┐         ┌────────┐         ┌────────┐      │
│   │线程组 1│         │线程组 2│    ...  │线程组 N│      │
│   │(Thread │         │(Thread │         │(Thread │      │
│   │ Group) │         │ Group) │         │ Group) │      │
│   └────────┘         └────────┘         └────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 线程组（Thread Groups）

线程池由多个线程组组成，每个线程组管理一组工作线程：

- 默认线程组数量：`thread_pool_size`（通常 = CPU 核心数）
- 每个线程组有独立的请求队列
- 减少锁竞争，提高并行度

---

## 线程池配置

### 关键配置参数

```sql
-- 查看当前配置
SHOW VARIABLES LIKE 'thread_pool%';

-- thread_pool_size：线程组数量（默认 = CPU 核心数）
SHOW VARIABLES LIKE 'thread_pool_size';
-- 通常不需要修改

-- thread_pool_stall_limit：stall 检测间隔（毫秒）
-- 默认 500ms，太短可能误判，太长延迟高
SET GLOBAL thread_pool_stall_limit = 500;

-- thread_pool_min_threads：每个线程组最小线程数
SET GLOBAL thread_pool_min_threads = 1;

-- thread_pool_max_threads：每个线程组最大线程数
SET GLOBAL thread_pool_max_threads = 10000;

-- thread_pool_idle_timeout：空闲线程超时（秒）
SET GLOBAL thread_pool_idle_timeout = 60;

-- thread_pool_high_priority_connection：高优先级连接
-- 使用独立队列，不与其他连接竞争
SET GLOBAL thread_pool_high_priority_connection = 1;
```

### 配置文件设置

```ini
# /etc/mysql/mariadb.conf.d/50-server.cnf

[mysqld]
# 线程池配置
thread_handling = pool-of-threads  # 启用线程池
thread_pool_size = 16              # 线程组数量
thread_pool_stall_limit = 500     # stall 检测间隔
thread_pool_min_threads = 1       # 最小线程数
thread_pool_max_threads = 10000   # 最大线程数
thread_pool_idle_timeout = 60     # 空闲超时
```

### 监控线程池状态

```sql
-- 查看线程池统计
SHOW STATUS LIKE 'Thread_pool%';

-- 常用状态变量
-- Thread_pool_active_threads：活跃线程数
-- Thread_pool_queries_executed：执行的查询数
-- Thread_pool_stars：线程启动次数
-- Thread_pool_waits：请求等待次数
-- Thread_pool_queue_length：队列长度
-- Thread_pool_threads_created：创建的线程数
-- Thread_pool_stalls：stall 事件数

-- 示例
SHOW STATUS LIKE 'Thread_pool%';
+-------------------------------+-------+
| Variable_name                 | Value |
+-------------------------------+-------+
| Thread_pool_active_threads    | 8     |
| Thread_pool_queries_executed  | 12345 |
| Thread_pool_stars             | 10    |
| Thread_pool_waits             | 56    |
| Thread_pool_queue_length      | 0     |
| Thread_pool_threads_created   | 16    |
| Thread_pool_stalls           | 0     |
+-------------------------------+-------+
```

---

## 线程池工作原理

### 请求处理流程

```
┌─────────────────────────────────────────────────────────────┐
│                    请求处理流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 连接请求到达                                             │
│          │                                                  │
│          ▼                                                  │
│  2. 监听线程接收连接                                        │
│          │                                                  │
│          ▼                                                  │
│  3. 根据连接 ID 选择线程组                                   │
│          │                                                  │
│          ▼                                                  │
│  4. 请求进入线程组队列                                       │
│          │                                                  │
│          ▼                                                  │
│  5. 空闲工作线程取出请求                                     │
│          │                                                  │
│          ▼                                                  │
│  6. 执行查询                                                │
│          │                                                  │
│          ▼                                                  │
│  7. 返回结果给客户端                                        │
│          │                                                  │
│          ▼                                                  │
│  8. 工作线程返回空闲池或处理下一个请求                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Stall 检测机制

Stall（停滞）检测是线程池的核心功能：

```sql
-- stall 触发条件
-- 1. 请求在队列中等待时间 > thread_pool_stall_limit
-- 2. 线程组没有可用线程

-- stall 响应策略
-- 1. 创建新线程处理请求
-- 2. 如果已达到 thread_pool_max_threads，标记警告
```

### 高优先级连接

```sql
-- 高优先级连接特点
-- 1. 使用独立队列，不与普通连接竞争
-- 2. 更快的响应时间
-- 3. 适合关键业务操作

-- 设置当前连接为高优先级
SET thread_pool_high_priority_connection = ON;

-- 在会话中保持高优先级
SET SESSION thread_pool_high_priority_connection = ON;
```

---

## 线程池 vs 传统模式

### 性能对比

| 场景 | 传统模式 | 线程池 | 优势 |
|------|----------|--------|------|
| 100 并发 | ✅ | ✅ | 差不多 |
| 1000 并发 | ⚠️ 下降 | ✅ | 线程池 |
| 10000 并发 | ❌ 严重下降 | ✅ | 线程池 |
| 突发大量连接 | ❌ 线程爆炸 | ✅ | 可控 |
| 长时间运行 | ⚠️ 资源泄漏 | ✅ | 更稳定 |
| 内存占用 | O(n) | O(k) | 线程池 |

### 测试数据

```
测试环境：4核 CPU, 16GB 内存

连接数 vs QPS：

  QPS
   │
300│              ╭────────────────
   │           ╭──╯
200│        ╭──╯     ╭── 线程池
   │     ╭──╯    ╭──╯ ─ ─ ─ ─
100│   ╭─╯   ╭──╯
   │ ╭─╯  ╭──╯
  0├──┼──┼──┼──┼──┼──┼──┼──→ 连接数
   100  500  1000 5000 10000
```

---

## Java 中的线程池优化

### 连接配置

```java
public class ThreadPoolDemo {
    
    // MariaDB 连接配置
    private static final String URL = "jdbc:mariadb://localhost:3306/testdb";
    
    public void configureConnection() throws SQLException {
        // 使用 MariaDB Connector/J
        Properties props = new Properties();
        props.setProperty("user", "root");
        props.setProperty("password", "password");
        
        // 连接池大小配置（配合线程池使用）
        props.setProperty("pool", "true");
        props.setProperty("poolName", "mypool");
        props.setProperty("maxPoolSize", "50");  // 与线程池配合
        props.setProperty("minPoolSize", "5");
        
        // 连接参数
        props.setProperty("connectTimeout", "30000");
        props.setProperty("socketTimeout", "60000");
        
        Connection conn = DriverManager.getConnection(URL, props);
    }
    
    // 高并发场景优化
    public void highConcurrencyDemo() {
        ExecutorService executor = Executors.newFixedThreadPool(100);
        
        for (int i = 0; i < 1000; i++) {
            final int requestId = i;
            executor.submit(() -> {
                try (Connection conn = getConnection()) {
                    // 使用高优先级连接处理关键请求
                    String sql = "SELECT * FROM users WHERE id = ?";
                    try (PreparedStatement pstmt = conn.prepareStatement(sql)) {
                        pstmt.setInt(1, requestId);
                        ResultSet rs = pstmt.executeQuery();
                        // 处理结果
                    }
                } catch (SQLException e) {
                    e.printStackTrace();
                }
            });
        }
        
        executor.shutdown();
    }
}
```

### 连接池推荐配置

```java
// 推荐配置：连接池数量与线程池配合
public class ConnectionPoolConfig {
    
    // MariaDB 线程池通常配置为 CPU 核心数
    // 连接池大小应该与线程池工作能力匹配
    public static final int THREAD_POOL_SIZE = 16;  // 假设 CPU 16 核
    
    // 连接池配置
    public static final int MAX_POOL_SIZE = THREAD_POOL_SIZE * 3;  // 48
    public static final int MIN_POOL_SIZE = THREAD_POOL_SIZE;       // 16
    
    // HikariCP 配置示例
    public HikariConfig createHikariConfig() {
        HikariConfig config = new HikariConfig();
        config.setMaximumPoolSize(MAX_POOL_SIZE);
        config.setMinimumIdle(MIN_POOL_SIZE);
        config.setConnectionTimeout(30000);
        config.setIdleTimeout(600000);
        config.setMaxLifetime(1800000);
        config.setPoolName("MariaDB-ThreadPool-Pool");
        return config;
    }
}
```

---

## 适用场景与注意事项

### 适用场景

| 场景 | 推荐 | 原因 |
|------|------|------|
| Web 应用高并发 | ✅ | 短连接，突发流量 |
| API 服务 | ✅ | 大量并发请求 |
| 连接池应用 | ⚠️ | 注意协调 |
| 长查询/大事务 | ❌ | 可能阻塞其他请求 |
| OLAP 查询 | ❌ | 长时间占用线程 |

### 不适合的场景

```sql
-- 不适合线程池的操作
-- 1. 长时间运行的查询
-- 2. 大事务
-- 3. LOCK TABLES
-- 4. HANDLER 语句

-- 对于这类操作，可以临时禁用线程池
SET GLOBAL thread_pool_disabled = 'long';
```

### 常见问题

```sql
-- 问题：线程池反而变慢
-- 原因：thread_pool_stall_limit 设置太小
-- 解决：增大 stall_limit

SET GLOBAL thread_pool_stall_limit = 1000;  -- 从 500 改为 1000

-- 问题：高并发写入变慢
-- 原因：InnoDB 行锁等待
-- 解决：优化事务大小，减少锁冲突

-- 问题：线程池队列堆积
-- 原因：查询太慢或连接数远超线程池能力
-- 解决：优化慢查询，增加线程池大小或连接池配置
```

---

## 面试追问

### 追问一：线程池和连接池有什么区别？

| 维度 | 连接池 | 线程池 |
|------|--------|--------|
| 位置 | 应用层 | 数据库层 |
| 管理对象 | 数据库连接 | 执行线程 |
| 作用 | 复用连接，减少创建开销 | 复用线程，减少调度开销 |
| 配置 | 应用端配置 | 服务端配置 |
| 配合使用 | ✅ 两者配合最佳 | ✅ |

### 追问二：MySQL 企业版线程池和 MariaDB 线程池有什么区别？

**架构差异**：
- MySQL 使用两层模型：监听线程 + 工作线程池
- MariaDB 使用多线程组模型，减少锁竞争

**功能差异**：
| 功能 | MySQL 企业版 | MariaDB |
|------|-------------|---------|
| 开源免费 | ❌ | ✅ |
| 线程组 | ❌ | ✅ |
| stall 检测 | ✅ | ✅ |
| 高优先级队列 | ❌ | ✅ |
| 动态调整 | 部分 | ✅ |

### 追问三：如何判断是否需要线程池？

**需要线程池的信号**：
1. 并发连接数 > 500
2. CPU 利用率低但响应慢（线程调度瓶颈）
3. 内存随连接数快速增长
4. 频繁出现 "Too many connections" 错误

**不需要线程池的场景**：
1. 并发连接数 < 100
2. 主要瓶颈在 CPU（查询本身就慢）
3. 有大量长查询

---

## 总结

| 要点 | 说明 |
|------|------|
| **线程池原理** | 固定工作线程处理所有连接请求 |
| **核心优势** | 减少线程创建开销，降低上下文切换 |
| **适用场景** | 高并发短连接，突发流量 |
| **关键参数** | thread_pool_size, thread_pool_stall_limit |
| **监控指标** | Thread_pool_active_threads, Thread_pool_waits, Thread_pool_stalls |
| **注意事项** | 长查询可能影响其他请求 |

**线程池是 MariaDB 在高并发时代的重要武器，配合适当的连接池配置，可以让数据库在连接数爆炸时依然保持稳定性能。**

---

## 下一步

- 想了解更多 MariaDB 高级特性？[MariaDB 虚拟列与序列（Sequence）](/database/mariadb/virtual-column)
- 想了解 MariaDB 的窗口函数？[MariaDB 窗口函数与 CT（Common Table Expression）](/database/mariadb/window-function)
- 想了解 MariaDB 的审计功能？[MariaDB 审计插件与安全增强](/database/mariadb/audit)
