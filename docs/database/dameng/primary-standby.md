# 主备集群：达梦高可用架构实战

想象一下这个场景：

凌晨 3 点，数据库服务器硬盘故障。运维人员从睡梦中被叫醒，一边手忙脚乱，一边祈祷数据不要丢失。

但如果你已经部署了达梦主备集群，结果会完全不同：

**主库故障 → 自动切换 → 备库接管 → 业务无感知。**

今天，我们就来聊聊达梦主备集群的部署与运维。

## 主备集群架构

主备集群是达梦高可用方案的基础，由一台主库和一台或多台备库组成。

```
                         ┌─────────────┐
                         │   客户端    │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │ dm_svc.conf │  （服务名配置）
                         │   故障切换   │
                         └──────┬──────┘
                    ┌────────────┼────────────┐
                    │            │            │
              ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
              │   主库    │ │   备库1   │ │   备库2   │
              │ (Primary) │ │(Standby1) │ │(Standby2) │
              └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
                    │             │             │
                    └─────────────┴─────────────┘
                         实时日志同步
```

## 部署模式

### 单主多备

最常见的架构，一台主库 + 多台备库。

```
优点：成本适中，冗余度高
缺点：只有一台主库
适用：大多数生产环境
```

### 双主双备（对称集群）

两台互为主备，架构对称。

```
优点：任何一台故障都能接管，负载分担
缺点：配置复杂，数据同步开销大
适用：金融、证券等高要求场景
```

## 主备切换：平滑的故障转移

### 手动切换

计划内维护时，需要手动执行切换。

```sql
-- 在任意节点执行切换命令
-- 将当前主库切换为备库，备库切换为主库
$ dmasmsvr tool racswitch cluster_name=DAMENG_CLUSTER
```

### 自动切换

守护进程（dmwatcher）自动检测故障并切换。

```ini
# dmwatcher.ini 配置
[GRP1]
DW_TYPE = GLOBAL
DW_MODE = AUTO
DW_ERROR_TIME = 10
INST_RECOVER_TIME = 30
INST_ERROR_TIME = 10
INST_INACTIVE_INTERVAL = 1
INST_HA_INTERVAL = 2
INST_STARTUP_CMDS = /data/dmdbms/start.sh
```

```
自动切换流程：
1. dmwatcher 每 2 秒检测一次实例状态
2. 发现主库故障，标记为 INACTIVE
3. 等待 30 秒（INST_RECOVER_TIME），确认主库不可恢复
4. 选取最优备库，执行 switchover
5. 原备库变为主库，开始提供服务
6. 通知 dm_svc.conf 更新连接信息
```

## 读写分离：从库分担查询压力

主备集群可以配合读写分离使用，SELECT 查询分担到备库执行。

```java
// Java 中配置读写分离
public class ReadWriteSplitDemo {

    public void readWriteDemo() {
        // 达梦支持通过 Hint 实现读写分离
        // /*+SS*/ 表示强制走备库
        String readSql = "/*+SS*/ SELECT * FROM orders WHERE order_id = ?";
        List&lt;Order&gt; orders = jdbcTemplate.queryForList(readSql, 12345);
        // 自动路由到备库执行

        // 普通 UPDATE/INSERT 走主库
        String writeSql = "UPDATE orders SET status = 'paid' WHERE order_id = ?";
        jdbcTemplate.update(writeSql, 12345);
    }
}
```

```ini
# dm_svc.conf 配置读写分离
DAMENG=(192.168.1.10:5236,192.168.1.11:5236)
SWITCH_TIME=2
SWITCH_INTERVAL=10
rwSeparate=1  # 开启读写分离
rw_percent=20 # 20% 的查询走备库
```

## 数据同步延迟监控

备库同步延迟过大，可能导致查询数据不一致。

```sql
-- 查看主备同步延迟
SELECT
    DEST_ID,
    DEST_NAME,
    ARCH_LSN,
    APPLY_LSN,
    (ARCH_LSN - APPLY_LSN) AS LAG_LSN
FROM V$DEST_STATUS;

-- 查看具体表的同步状态
SELECT
    TABLE_NAME,
    ROW_COUNT,
    TRX_COUNT
FROM V$SESSION_STAT;
```

```java
// Java 中监控同步延迟
public class SyncLatencyMonitor {

    public void checkLatency() {
        Long archiveLsn = jdbcTemplate.queryForObject(
            "SELECT MAX(ARCH_LSN) FROM V$DEST_STATUS", Long.class);
        Long applyLsn = jdbcTemplate.queryForObject(
            "SELECT MAX(APPLY_LSN) FROM V$DEST_STATUS", Long.class);

        long lag = archiveLsn - applyLsn;

        if (lag > 10000) {
            // 延迟超过阈值，告警
            sendAlert("同步延迟过大: " + lag);
        }
    }
}
```

## 主备集群的日常运维

### 备库维护

```sql
-- 备库设置为只读模式（允许查询）
ALTER DATABASE STANDBY READ ONLY;

-- 恢复为正常模式
ALTER DATABASE STANDBY READ WRITE;

-- 暂停日志应用（用于批量数据导入）
ALTER DATABASE STANDBY SUSPEND;

-- 恢复日志应用
ALTER DATABASE STANDBY RESUME;
```

### 日志管理

```sql
-- 清理归档日志
SELECT * FROM V$ARCH_FLUSH;
SP_CLEAN_ARCHIVE(48);  -- 清理 48 小时前的归档

-- 手动执行日志备份
ALTER DATABASE BACKUP ARCHIVELOG CURRENT;
```

### 性能监控

```sql
-- 查看等待事件
SELECT
    SESSION_ID,
    WAIT_EVENT,
    WAIT_TIME
FROM V$SESSION_WAIT;

-- 查看连接数
SELECT
    COUNT(*) AS total_connections,
    SUM(CASE WHEN TYPE = 'BACKEND' THEN 1 ELSE 0 END) AS backend_connections
FROM V$SESSION;
```

## 面试追问方向

- 主备切换时，正在执行的事务会怎样？
- 同步延迟过大时，如何定位问题？
- 为什么推荐至少部署两个备库？

---

## 一句话总结

主备集群是数据库的「双保险」：主库正常时各司其职，主库故障时备库无缝接管。配置不难，维护靠自动化，故障来了才见真章。
