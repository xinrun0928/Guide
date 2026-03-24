# Oracle Data Guard：数据保护的「金钟罩」

你有没有这种担忧：

机房着火，所有数据全没了。

磁盘故障，业务中断好几小时。

Oracle Data Guard，就是来解决这个问题的。

今天，认识 Oracle 的数据保护方案。

---

## Data Guard 是什么？

Data Guard 是 Oracle 提供的数据高可用和灾备解决方案，通过在主库和备库之间同步数据，实现数据保护和快速故障切换。

```
Data Guard 架构：

主库（Primary Database）
    │
    │ Redo 传输
    │
    ▼
备库（Standby Database）1 ──► 备库（Standby Database）2
```

### Data Guard 的价值

| 价值 | 说明 |
|-----|------|
| 数据保护 | 实时同步，数据零丢失 |
| 高可用 | 主库故障时快速切换 |
| 灾难恢复 | 支持异地灾备 |
| 性能提升 | 备库分担查询压力 |

---

## Data Guard 架构

### 角色类型

| 角色 | 说明 |
|-----|------|
| Primary Database | 主库，处理正常业务 |
| Physical Standby | 物理备库，完全同步，数据块级别复制 |
| Logical Standby | 逻辑备库，SQL 语句级别复制，可用于查询 |
| Snapshot Standby | 快照备库，可读写，用于测试 |

### 保护模式

| 模式 | 说明 | 数据保护级别 |
|-----|------|-------------|
| Maximum Availability | 最大可用（默认） | 零数据丢失，可能短暂中断 |
| Maximum Protection | 最大保护 | 零数据丢失，主库不可用 |
| Maximum Performance | 最大性能（默认） | 可能丢失少量数据 |

```sql
-- 查看当前保护模式
SELECT protection_mode, protection_level FROM v$database;

-- 修改保护模式
ALTER DATABASE SET STANDBY DATABASE TO MAXIMIZE AVAILABILITY;
```

---

## 物理 Data Guard 配置

### 主库配置

```sql
-- 1. 启用强制日志
ALTER DATABASE FORCE LOGGING;

-- 2. 配置归档模式
ALTER SYSTEM SET log_archive_dest_1 = 'LOCATION=/u01/arch VALID_FOR=(ALL_LOGFILES,ALL_ROLES)';
ALTER SYSTEM SET log_archive_dest_2 = 'SERVICE=standby1 LGWR ASYNC VALID_FOR=(ONLINE_LOGFILES,PRIMARY_ROLE)';

-- 3. 配置 TNS 别名
-- listener.ora 和 tnsnames.ora 中配置主备库连接

-- 4. 备份数据库用于创建备库
RMAN> BACKUP DATABASE PLUS ARCHIVELOG;
```

### 备库配置

```sql
-- 1. 创建备库控制文件
ALTER DATABASE CREATE STANDBY CONTROLFILE AS '/u01/standby.ctl';

-- 2. 配置备库参数文件
-- standby_init.ora:
-- db_name=orcl
-- db_unique_name=standby1
-- log_archive_config='dg_config=(orcl,standby1)'

-- 3. 启动备库到mount状态
STARTUP NOMOUNT;
ALTER DATABASE MOUNT STANDBY DATABASE;

-- 4. 启用实时应用
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE USING CURRENT LOGFILE DISCONNECT FROM SESSION;
```

---

## Redo 传输服务

### 传输模式

| 模式 | 说明 | 性能 | 可靠性 |
|-----|------|------|--------|
| ARCH | 归档传输 | 中 | 中 |
| LGWR SYNC | 日志写同步 | 慢 | 高 |
| LGWR ASYNC | 日志写异步 | 快 | 中 |

```sql
-- 配置 LGWR 同步传输
ALTER SYSTEM SET log_archive_dest_2 = 
    'SERVICE=standby1 LGWR SYNC VALID_FOR=(ONLINE_LOGFILES,PRIMARY_ROLE)';

-- 配置 LGWR 异步传输
ALTER SYSTEM SET log_archive_dest_2 = 
    'SERVICE=standby1 LGWR ASYNC VALID_FOR=(ONLINE_LOGFILES,PRIMARY_ROLE)';
```

### 实时应用

```sql
-- 启用实时应用
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE USING CURRENT LOGFILE DISCONNECT FROM SESSION;

-- 停止实时应用
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;

-- 查看应用状态
SELECT sequence#, applied, registrar, creation_date 
FROM v$archived_log
ORDER BY sequence# DESC;
```

---

## 故障切换（Failover）

### 计划内切换（Switchover）

```sql
-- 主库：转换为备库
ALTER DATABASE COMMIT TO SWITCHOVER TO PHYSICAL STANDBY;

-- 备库：转换为主库
ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY;

-- 新主库：开启日志应用
ALTER DATABASE OPEN;
```

### 计划外切换（Failover）

```sql
-- 备库：执行故障切换
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE FINISH;

-- 转换为新主库
ALTER DATABASE ACTIVATE PHYSICAL STANDBY DATABASE;
```

### 故障切换注意事项

1. **数据丢失**：根据保护模式，可能丢失未应用的日志
2. **重新配置**：切换后需要重新配置应用程序连接
3. **恢复主库**：原主库恢复后需要重建为新备库

---

## 逻辑 Data Guard

### 逻辑备库特点

| 特性 | 说明 |
|-----|------|
| 数据可用 | 可用于只读查询和报表 |
| 数据转换 | 可在备库进行数据转换 |
| 角色切换 | 支持 Switchover 和 Failover |
| 限制 | 部分 DDL/DML 不支持 |

### 创建逻辑备库

```sql
-- 从物理备库转换为逻辑备库
ALTER DATABASE RECOVER TO LOGICAL STANDBY ORCL;

-- 开启 SQL 应用
ALTER DATABASE START LOGICAL STANDBY APPLY IMMEDIATE;

-- 查看应用状态
SELECT * FROM V$LOGSTDBY_PROGRESS;
```

### 逻辑备库的查询

```sql
-- 查询逻辑备库
SELECT * FROM v$database WHERE NAME = 'STANDBY';

-- 逻辑备库可以执行只读查询
SELECT COUNT(*) FROM sales;
```

---

## 快照备库

### 快照备库特点

| 特性 | 说明 |
|-----|------|
| 可读写 | 暂挂日志应用后可读写 |
| 测试环境 | 用于测试和开发 |
| 自动恢复 | 转换为快照后自动应用日志 |

### 创建快照备库

```sql
-- 将物理备库转换为快照备库
ALTER DATABASE CONVERT TO SNAPSHOT STANDBY;

-- 使用快照备库进行测试
-- ...

-- 将快照备库转换回物理备库
ALTER DATABASE CONVERT TO PHYSICAL STANDBY;
```

---

## Data Guard 监控

### 关键视图

```sql
-- 查看数据库角色
SELECT database_role, protection_mode, protection_level FROM v$database;

-- 查看日志应用状态
SELECT sequence#, applied, registrar, applied_time
FROM v$archived_log
WHERE applied = 'YES'
ORDER BY sequence# DESC;

-- 查看 GAP（日志缺失）
SELECT * FROM v$archive_gap;

-- 查看传输状态
SELECT dest_id, destination, status, transmit_mode, affirm
FROM v$archive_dest WHERE status != 'INACTIVE';
```

### 常见故障排查

```sql
-- 检查 FAL 服务器配置
SHOW PARAMETER fal_server;

-- 检查日志归档
SELECT dest_id, status, error FROM v$archive_dest WHERE status = 'ERROR';

-- 重试失败的归档目的地
ALTER SYSTEM SET log_archive_dest_state_2 = ENABLE;
```

---

## 面试高频问题

### Q1: 物理备库和逻辑备库的区别？

物理备库在数据块级别完全复制主库，无法用于查询；逻辑备库通过 SQL 语句复制，可以在备库上执行只读查询和部分 DML 操作。

### Q2: 三种保护模式的区别？

Maximum Protection 保证零数据丢失，但主库不可用；Maximum Availability 尽量保证零数据丢失，可能短暂中断；Maximum Performance 优先性能，可能丢失少量数据。

### Q3: 如何监控 Data Guard 状态？

通过 `v$database` 查看数据库角色和保护模式，通过 `v$archived_log` 查看日志应用状态，通过 `v$archive_dest` 查看归档目的地状态。

---

## 总结

Data Guard 是 Oracle 高可用方案的核心：

| 组件 | 作用 |
|-----|------|
| Redo 传输 | 将主库日志传输到备库 |
| 应用服务 | 在备库应用日志 |
| 保护模式 | 控制数据保护级别 |
| 角色切换 | 实现高可用 |

掌握 Data Guard，是 DBA 的必备技能。

---

## 下一步

- [Oracle RAC](/database/oracle/rac)：集群架构
- [Oracle RMAN](/database/oracle/rman)：备份恢复
