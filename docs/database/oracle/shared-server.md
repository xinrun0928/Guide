# Oracle 共享服务器：连接池的数据库端实现

你有没有遇到过这种情况：

数据库连接数爆炸，内存告警。

应用服务器配了一堆连接池，但还是不够用。

Oracle 的共享服务器模式，就是来解决这个问题的。

今天，了解 Oracle 的共享服务器架构。

---

## 专用服务器 vs 共享服务器

### 专用服务器（Dedicated Server）

```
传统连接模式：
    客户端 ────► 专用进程 ────► SGA
                     ▲
                     │
                  独占此进程
                     │
                  此进程专属此客户端
```

- 每个客户端连接独占一个服务器进程
- 进程在会话期间一直存在
- 连接多时，进程多，消耗资源大

### 共享服务器（Shared Server）

```
共享服务器模式：
    客户端 ────► Dispatcher ──┬──► 共享进程 1 ───► SGA
              (调度器)        ├──► 共享进程 2 ───► SGA
                             └──► 共享进程 N ─── ► SGA
```

- 多个客户端共享一组服务器进程
- Dispatcher 将请求分发给共享进程
- 连接多时，进程数不变，资源消耗稳定

---

## 配置共享服务器

### 初始化参数

```sql
-- 共享服务器核心参数
-- 在 init.ora 或 spfile 中配置：

-- 1. 调度器数量
dispatchers = "(PROTOCOL=TCP)(DISPATCHERS=3)"

-- 2. 共享进程数量
shared_servers = 5

-- 3. 最大共享进程数
max_shared_servers = 20

-- 4. 会话队列长度
 circuits = n

-- 5. 专用传输模式（某些连接需要）
local_listener = "(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=1521))"
```

### 配置示例

```sql
-- 在 SQL*Plus 中查看当前配置
SHOW PARAMETER dispatchers
SHOW PARAMETER shared_server
SHOW PARAMETER circuits

-- 修改配置
ALTER SYSTEM SET dispatchers = "(PROTOCOL=TCP)(DISPATCHERS=3)(POOL=ON)" SCOPE = BOTH;
ALTER SYSTEM SET shared_servers = 5 SCOPE = BOTH;
ALTER SYSTEM SET max_shared_servers = 20 SCOPE = SPFILE;
```

---

## 共享服务器架构

### 组件说明

| 组件 | 说明 |
|-----|------|
| Dispatcher (Dnnn) | 接收客户端请求，分发给共享进程 |
| Shared Server (Snnn) | 实际执行 SQL 的进程 |
| Request Queue | 请求队列（在 SGA 中） |
| Response Queue | 响应队列（在 SGA 中） |

### 请求流程

```
共享服务器请求流程：

1. 客户端发送请求到 Dispatcher
       ↓
2. Dispatcher 将请求放入 Request Queue
       ↓
3. 任意一个 Shared Server 取走请求
       ↓
4. Shared Server 执行请求
       ↓
5. Shared Server 将结果放入 Response Queue
       ↓
6. Dispatcher 从 Response Queue 取回结果
       ↓
7. 返回给客户端
```

---

## 使用共享服务器

### 连接字符串配置

```sql
-- 服务端：确保监听器配置
-- listener.ora
LISTENER = 
  (ADDRESS_LIST =
    (ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=1521))
  )

SID_LIST_LISTENER =
  (SID_LIST =
    (SID_DESC =
      (GLOBAL_DBNAME=orcl)
      (ORACLE_HOME=/u01/app/oracle)
      (SID_NAME=orcl)
    )
  )

-- TNS 配置：使用共享服务器
ORCL_SHARED =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = ...)(PORT = 1521))
    (CONNECT_DATA =
      (SERVER = SHARED)       -- 指定共享服务器
      (SERVICE_NAME = orcl)
    )
  )
```

### 连接测试

```sql
-- 查看当前连接模式
SELECT username, server, program
FROM v$session
WHERE username = USER;

-- 查看 Dispatcher 状态
SELECT name, network, connections, messages, busy
FROM v$dispatcher;

-- 查看 Shared Server 状态
SELECT name, status, requests, circuit# 
FROM v$shared_server;
```

---

## 共享服务器的优缺点

### 优点

| 优点 | 说明 |
|-----|------|
| 减少进程数 | 共享进程复用 |
| 降低内存消耗 | 不需要为每个连接分配 PGA |
| 支持更多连接 | 相同资源下支持更多会话 |
| 适合 OLTP | 多用户短连接场景 |

### 缺点

| 缺点 | 说明 |
|-----|------|
| 增加响应延迟 | 请求需要排队 |
| 不适合长查询 | 长查询占用共享进程 |
| 无法使用某些特性 | OCI 驱动不支持 |
| 调试困难 | 多会话共享进程 |

---

## 适用场景

### 适合使用共享服务器

| 场景 | 原因 |
|-----|------|
| 连接数多但并发低 | 很多空闲连接 |
| 短连接 OLTP 应用 | 连接频繁创建销毁 |
| 连接池受限环境 | 应用服务器连接池受限 |
| 降低成本 | 减少 Oracle License 费用 |

### 不适合使用共享服务器

| 场景 | 原因 |
|-----|------|
| 长查询/批处理 | 占用共享进程时间长 |
| 批量 DML | 需要专用服务器 |
| 专用连接需求 | 某些特性需要专用服务器 |
| 高并发 OLTP | 排队延迟不可接受 |

---

## 监控共享服务器

### 关键视图

```sql
-- 查看 Dispatcher
SELECT name, network, status, connections, 
       messages, bytes, idle_time, busy_time
FROM v$dispatcher;

-- 查看 Shared Server
SELECT name, status, requests, circuit#, 
       idle_time, busy_time
FROM v$shared_server;

-- 查看队列
SELECT queuetype, totalq, cpus, wait
FROM v$queue;

-- 查看连接统计
SELECT 
    (SELECT COUNT(*) FROM v$session WHERE server != 'DEDICATED') AS shared_connections,
    (SELECT COUNT(*) FROM v$session WHERE server = 'DEDICATED') AS dedicated_connections,
    (SELECT COUNT(*) FROM v$dispatcher) AS dispatcher_count,
    (SELECT COUNT(*) FROM v$shared_server) AS shared_server_count
FROM dual;
```

### 性能诊断

```sql
-- 查看 Dispatcher 繁忙程度
SELECT name, 
       ROUND(busy/(busy + idle) * 100, 2) AS busy_pct
FROM v$dispatcher
WHERE status = 'ACCEPTED';

-- 如果 busy_pct > 80%，需要增加 Dispatcher
-- ALTER SYSTEM SET dispatchers = "(PROTOCOL=TCP)(DISPATCHERS=5)";

-- 查看 Shared Server 利用率
SELECT name,
       requests,
       ROUND(busy_time/(busy_time + idle_time) * 100, 2) AS busy_pct
FROM v$shared_server
WHERE status != 'QUIT';

-- 如果繁忙，考虑增加 Shared Server
-- ALTER SYSTEM SET max_shared_servers = 30;
```

---

## 混合模式

Oracle 支持同时配置专用服务器和共享服务器：

```sql
-- 配置同时支持两种模式
dispatchers = "(PROTOCOL=TCP)(DISPATCHERS=3)"

-- 某些连接仍然使用专用模式
-- 在连接字符串中指定
ORCL_DEDICATED =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = ...)(PORT = 1521))
    (CONNECT_DATA =
      (SERVER = DEDICATED)       -- 强制专用服务器
      (SERVICE_NAME = orcl)
    )
  )
```

---

## 面试高频问题

### Q1: 共享服务器和专用服务器的区别？

专用服务器为每个客户端连接分配独占进程；共享服务器多个客户端共享一组进程。共享服务器减少进程数，降低内存消耗，适合连接多但并发低的场景。

### Q2: 什么情况下使用共享服务器？

连接数很多但实际并发低、短连接 OLTP 应用、连接池受限、需要降低资源消耗的场景。

### Q3: 共享服务器的缺点是什么？

增加请求响应延迟（需要排队）、不适合长查询、无法使用某些 Oracle 特性、调试相对困难。

---

## 总结

| 连接模式 | 适用场景 | 资源消耗 |
|---------|---------|---------|
| 专用服务器 | 高并发、长查询、批处理 | 高（进程独占） |
| 共享服务器 | 连接多并发低、短连接 | 低（进程共享） |

根据实际业务场景选择合适的连接模式。

---

## 下一步

- [Oracle 并行查询](/database/oracle/parallel)：充分利用多核 CPU
- [Oracle SQL 优化](/database/oracle/sql-tuning)：性能调优技巧
