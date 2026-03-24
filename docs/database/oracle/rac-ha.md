# Oracle RAC 高可用：VIP 与故障切换

你有没有想过：

数据库节点宕了，应用却没报错。

VIP 帮你屏蔽了底层故障。

今天，了解 RAC 高可用的核心机制。

---

## VIP（Virtual IP）原理

### 什么是 VIP？

VIP 是分配给集群节点的虚拟 IP，当节点故障时自动漂移到健康节点，客户端连接自动重路由。

```
VIP 故障切换：

正常状态：
┌─────────┐                    ┌─────────┐
│ Node 1  │  VIP: 10.1.1.101 │ Node 2  │  VIP: 10.1.1.102
│ (RAC01) │                    │ (RAC02) │
└─────────┘                    └─────────┘

Node 1 故障：
┌─────────┐                    ┌─────────┐
│ Node 1  │                    │ Node 2  │  VIP: 10.1.1.101 → 漂移到 Node 2
│ (宕机)  │                    │ (RAC02) │  VIP: 10.1.1.102
└─────────┘                    └─────────┘
```

### VIP 的优势

| 优势 | 说明 |
|-----|------|
| 快速切换 | 无需 DNS 解析或 ARP 更新 |
| 应用无感知 | 客户端无需重新配置 |
| 透明重连 | Oracle Net 自动重连 |

---

## TAF（Transparent Application Failover）

### TAF 是什么？

TAF 让客户端连接在故障切换时自动重连，并可选择恢复查询。

```sql
-- TAF 配置示例
ORCL_RAC =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = rac01-vip)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = rac02-vip)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVER = DEDICATED)
      (SERVICE_NAME = orcl)
      (FAILOVER_MODE = 
        (TYPE = SELECT)        -- 故障切换类型
        (METHOD = BASIC)        -- 连接方式
        (RETRIES = 20)         -- 重试次数
        (DELAY = 15)           -- 重试间隔（秒）
      )
    )
  )
```

### TAF 类型

| 类型 | 说明 |
|-----|------|
| NONE | 不启用 TAF |
| SESSION | 失败时创建新会话 |
| SELECT | 继续未完成的 SELECT 查询 |

### TAF 状态监控

```sql
-- 查看 TAF 状态
SELECT instance_name, failover_type, failover_method, failed_over
FROM v$session
WHERE username = USER;

-- 查看失败重连统计
SELECT * FROM v$session_failover_details;
```

---

## 故障检测与切换

### CSSD（Cluster Synchronization Services Daemon）

CSSD 负责节点间心跳检测：

```bash
# 查看 CSS 状态
crsctl check css

# 查看投票信息
crsctl query css votedisk

# 查看集群状态
crsctl status res -t
```

### 故障切换流程

```
节点故障检测与切换流程：

1. CSSD 检测到心跳丢失（默认 30 秒）
        ↓
2. 驱逐故障节点（Node Eviction）
        ↓
3. VIP 漂移到健康节点
        ↓
4. Oracle Net 接收连接请求
        ↓
5. 客户端连接自动重定向
        ↓
6. PMON 清理故障实例资源
```

---

## Services（服务）

### 服务是什么？

服务是 RAC 中逻辑层面的连接对象，用于负载均衡和故障切换：

```sql
-- 创建服务
BEGIN
    DBMS_SERVICE.CREATE_SERVICE(
        service_name => 'oltp_service',
        network_name => 'oltp_service',
        failover_method => 'BASIC',
        failover_type => 'SELECT',
        failover_retries => 30,
        failover_delay => 5
    );
END;
/

-- 启动服务
BEGIN
    DBMS_SERVICE.START_SERVICE('oltp_service');
END;
/

-- 将服务绑定到特定节点
BEGIN
    DBMS_SERVICE.MODIFY_SERVICE(
        service_name => 'oltp_service',
        preferred_nodes => list('racnode1', 'racnode2'),
        available_nodes => list()
    );
END;
/
```

### 服务管理

```sql
-- 查看服务
SELECT service_id, name, enabled, failover_type
FROM dba_services;

-- 查看服务分布
SELECT name, inst_id, total, in_use, BUSY
FROM gv$service_stats;

-- 删除服务
BEGIN
    DBMS_SERVICE.STOP_SERVICE('oltp_service');
    DBMS_SERVICE.DELETE_SERVICE('oltp_service');
END;
/
```

---

## 负载均衡

### 连接级负载均衡

Oracle Net 自动将连接分布到不同节点：

```sql
-- 启用负载均衡
ALTER SYSTEM SET local_listener = '(ADDRESS=(PROTOCOL=TCP)(HOST=rac01-vip)(PORT=1521))';
ALTER SYSTEM SET remote_listener = 'scan-cluster-scan:1521';
```

### 运行时负载均衡

Oracle 11gR2+ 支持运行时的负载均衡决策：

```sql
-- 查看当前连接分布
SELECT inst_id, COUNT(*) AS connection_count
FROM gv$session
WHERE username IS NOT NULL
GROUP BY inst_id;

-- 查看 Service Stats
SELECT name, value
FROM gv$service_stats
WHERE name IN ('total_connections', 'total_session_count');
```

---

## 资源管理

### 资源命令

```bash
# 查看所有资源状态
crsctl status res -t

# 查看特定资源
crsctl status res ora.LISTENER.lsnr

# 启动资源
crsctl start res ora.LISTENER.lsnr -n racnode1

# 停止资源
crsctl stop res ora.LISTENER.lsnr -n racnode1

# 移动资源
crsctl relocate res ora.LISTENER.lsnr -n racnode2
```

### 资源依赖关系

```
资源启动顺序：

ora.ctssd (CTSS)
    ↓
ora.crsd (CRS)
    ↓
ora.cssdagent (CSSD Agent)
ora.cssdmonitor (CSSD Monitor)
    ↓
ora.clusterware (Clusterware)
    ↓
ora.crsd (CRSD)
    ↓
ora.evmd (EVMD)
ora.mdnsd (mDNS)
ora.gpnpd (GPnP)
ora.gipcd (GIPc)
    ↓
ora.crsd 启动数据库资源
```

---

## 高可用最佳实践

### 配置建议

| 配置项 | 建议值 |
|-------|--------|
| CSS Misscount | 30-60 秒 |
| Public Network | 双网卡绑定 |
| Private Network | 高带宽低延迟网络 |
| Voting Disk | 奇数个（3、5、7） |

### 监控建议

```sql
-- 定期检查集群健康
SELECT * FROM v$cluster_interconnects;

-- 检查节点状态
SELECT inst_id, host_name, status, instance_role
FROM gv$instance;

-- 检查 VIP 状态
SELECT * FROM gv$ipc.instance_stats;

-- 检查 OCR 状态
ocrcheck
```

---

## 面试高频问题

### Q1: VIP 故障切换的原理是什么？

当节点故障时，CSS 检测到心跳丢失，将故障节点的 VIP 漂移到健康节点。客户端向 VIP 发送的请求被新节点接收，自动建立连接。

### Q2: TAF 和 VIP 的关系？

VIP 负责网络层的连接重定向，TAF 负责应用层的会话恢复。两者配合实现透明故障切换。

### Q3: RAC 如何保证高可用？

通过 CSS 心跳检测、VIP 漂移、TAF 会话恢复、服务层故障切换等多层机制保证高可用。

---

## 总结

RAC 高可用机制保障业务连续性：

| 机制 | 作用 |
|-----|------|
| VIP | 网络层透明切换 |
| TAF | 会话层透明恢复 |
| Services | 逻辑服务管理 |
| CSS | 节点心跳检测 |

多层保障，让 RAC 成为企业级数据库的高可用标准。

---

## 下一步

- [Oracle RAC](/database/oracle/rac)：集群架构
- [Oracle ASM](/database/oracle/asm)：自动存储管理
