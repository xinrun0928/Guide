# TDengine 写入性能与集群架构

单机 TDengine 能扛住每秒 200 万条数据写入。

这不是吹牛，是实测数字。

但你怎么做到的？答案藏在 TDengine 的架构设计里——**虚拟节点**和**写放大优化**。

## TDengine 写入性能的秘密

### 写入流程

```
数据写入流程：
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  1. 客户端构造数据包                                               │
│     meter_001, ts=10:00:00, voltage=220.5, current=10.2          │
│     ↓                                                            │
│  2. 直接写入 VNode（跳过 WAL？）                                   │
│     ↓                                                            │
│  3. VNode 写入 WAL（顺序追加）                                     │
│     ↓                                                            │
│  4. VNode 写入 MemTable（内存）                                   │
│     ↓                                                            │
│  5. MemTable 刷盘 → SStable（顺序写）                              │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 为什么这么快？

| 优化点 | 说明 |
|---|---|
| **跳过中间层** | 客户端直连 VNode，不经过 Proxy |
| **预聚合** | 写入时自动按时间窗口预聚合 |
| **列式存储** | 同类型数据连续存储，压缩率高 |
| **批量写入** | 支持一次请求写入多条数据 |
| **无锁设计** | 多线程写入各自 MemTable，无竞争 |

### 批量写入示例

```sql
-- 单条写入
INSERT INTO meter_001 VALUES ('2024-01-15 10:00:00.000', 220.5, 10.2, 2248.0);

-- 批量写入
INSERT INTO meter_001 VALUES
    ('2024-01-15 10:00:00.000', 220.5, 10.2, 2248.0),
    ('2024-01-15 10:00:01.000', 220.6, 10.3, 2250.0),
    ('2024-01-15 10:00:02.000', 220.4, 10.1, 2245.0);

-- 多表批量写入（更高效）
INSERT INTO meter_001 VALUES ('2024-01-15 10:00:00.000', 220.5, 10.2, 2248.0)
INTO meter_002 VALUES ('2024-01-15 10:00:00.000', 220.3, 9.8, 2158.0)
INTO meter_003 VALUES ('2024-01-15 10:00:00.000', 220.8, 10.5, 2318.0);
```

### Java 批量写入

```java
package com.example;

import com.taosdata.jdbc.ws.WSPreparedStatement;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

public class TDengineBatchWrite {
    public static void main(String[] args) throws SQLException {
        String jdbcUrl = "jdbc:TAOS://localhost:6030/power_grid";
        
        try (Connection conn = DriverManager.getConnection(jdbcUrl)) {
            // 方式一：使用 PreparedStatement 批量写入
            String sql = "INSERT INTO ? VALUES (?, ?, ?, ?)";
            try (var pstmt = conn.prepareStatement(sql)) {
                var wsPstmt = pstmt.unwrap(WSPreparedStatement.class);
                
                // 写入 10000 条数据
                for (int i = 0; i < 10000; i++) {
                    wsPstmt.setTableName("meter_" + String.format("%05d", i % 100));
                    wsPstmt.setTimestamp(0, new java.sql.Timestamp(System.currentTimeMillis()));
                    wsPstmt.setDouble(1, 220.0 + Math.random());
                    wsPstmt.setDouble(2, 10.0 + Math.random());
                    wsPstmt.setDouble(3, 2200.0 + Math.random() * 100);
                    wsPstmt.addBatch();
                }
                wsPstmt.executeBatch();
            }
            
            // 方式二：使用 Schemaless（无 schema 写入）
            String schemalessSql = "INSERT INTO meter_001 VALUES (?, ?, ?, ?)";
            try (var pstmt = conn.prepareStatement(schemalessSql)) {
                var wsPstmt = pstmt.unwrap(WSPreparedStatement.class);
                wsPstmt.setTimestamp(0, System.currentTimeMillis());
                wsPstmt.setDouble(1, 220.5);
                wsPstmt.setDouble(2, 10.2);
                wsPstmt.setDouble(3, 2248.0);
                wsPstmt.execute();
            }
        }
    }
}
```

## 集群架构

### 核心组件

```
TDengine 集群架构：
┌─────────────────────────────────────────────────────────────────────┐
│                           TDengine Cluster                          │
│                                                                      │
│  ┌─────────────────┐                                               │
│  │  Application     │ ← 客户端 SDK                                   │
│  └────────┬────────┘                                               │
│           │                                                         │
│           │ REST / WebSocket                                        │
│           ↓                                                         │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    taosAdapter                            │       │
│  │              (协议转换、写入代理)                          │       │
│  └────────────────────────┬────────────────────────────────┘       │
│                           │                                          │
│           ┌───────────────┼───────────────┐                        │
│           ↓               ↓               ↓                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │   mnode 1   │  │   mnode 2   │  │   mnode 3   │                │
│  │  (管理节点) │  │  (管理节点) │  │  (管理节点) │                │
│  └─────────────┘  └─────────────┘  └─────────────┘                │
│           ↑               ↑               ↑                        │
│           └───────────────┴───────────────┘                        │
│                    Meta Database (元数据)                           │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │  vnode 1-1 │  │  vnode 2-1 │  │  vnode 3-1 │                │
│  │  (数据节点) │  │  (数据节点) │  │  (数据节点) │                │
│  └─────────────┘  └─────────────┘  └─────────────┘                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │  vnode 1-2 │  │  vnode 2-2 │  │  vnode 3-2 │                │
│  │  (数据节点) │  │  (数据节点) │  │  (数据节点) │                │
│  └─────────────┘  └─────────────┘  └─────────────┘                │
│         ↑               ↑               ↑                          │
│         └───────────────┴───────────────┘                          │
│                    Data Storage (数据存储)                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心概念

| 组件 | 说明 | 作用 |
|---|---|---|
| **mnode** | 管理节点 | 存储元数据（数据库、表、用户信息） |
| **vnode** | 虚拟节点 | 实际存储时序数据的节点 |
| **taosAdapter** | 适配器 | 协议转换，支持 REST/WebSocket 写入 |
| **qnode** | 查询节点 | 可选，独立的查询计算节点 |

### 虚拟节点（VNode）

VNode 是 TDengine 集群的核心，它解决了两个问题：

1. **数据分片**：不同 VNode 存储不同数据
2. **副本管理**：数据在多个 VNode 间复制

```
VNode 内部结构：
┌──────────────────────────────────────────────────────────────────┐
│                         VNode                                     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Write Buffer (MemTable)                                    │ │
│  │  - 内存缓冲区，按时间排序                                     │ │
│  │  - 达到阈值后刷盘                                             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              ↓                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  WAL (Write-Ahead Log)                                       │ │
│  │  - 追加写入日志                                               │ │
│  │  - 故障恢复                                                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              ↓                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  SStable (Sorted String Table)                               │ │
│  │  - 压缩存储                                                  │ │
│  │  - Compaction 合并                                          │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Meta Index (元数据索引)                                      │ │
│  │  - Tag → 子表 映射                                           │ │
│  │  - 加速标签查询                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 数据分片策略

```sql
-- 创建数据库时指定 VGroup 数量
CREATE DATABASE power_grid (
    KEEP 3650,           -- 保留 10 年
    DURATION 10,         -- 分区时长 10 天
    BUFFER 256,          -- 写入缓冲区 MB
    REPLICA 1,           -- 副本数
    VGROUPS 10           -- VGroup 数量 = 10
);
```

```
VGroup 分布：
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  VGroup 1: meter_001 ~ meter_100000  (第一批子表)                │
│  VGroup 2: meter_100001 ~ meter_200000 (第二批子表)              │
│  VGroup 3: meter_200001 ~ meter_300000                          │
│  ...                                                              │
│  VGroup 10: meter_900001 ~ meter_1000000                        │
│                                                                   │
│  每个 VGroup 可配置副本数                                         │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## 集群部署

### Docker Compose 部署

```yaml
# docker-compose.yml
version: '3'

services:
  tdengine-1:
    image: tdengine/tdengine:latest
    hostname: tdengine-1
    container_name: tdengine-1
    ports:
      - "6030:6030"
      - "6041:6041"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - ./data1:/var/lib/taos
    command: taosd

  tdengine-2:
    image: tdengine/tdengine:latest
    hostname: tdengine-2
    container_name: tdengine-2
    ports:
      - "6031:6030"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - ./data2:/var/lib/taos
    command: taosd

  tdengine-3:
    image: tdengine/tdengine:latest
    hostname: tdengine-3
    container_name: tdengine-3
    ports:
      - "6032:6030"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - ./data3:/var/lib/taos
    command: taosd
```

### 集群初始化

```bash
# 1. 启动容器后，进入任意节点
docker exec -it tdengine-1 bash

# 2. 查看集群状态
taos> SHOW DNODE VARIABLES;

# 3. 添加其他节点到集群
taos> CREATE DNODE "tdengine-2:6030";
taos> CREATE DNODE "tdengine-3:6030";

# 4. 查看节点状态
taos> SHOW DNODE;

# 5. 创建副本
taos> CREATE DATABASE power_grid REPLICA 3 VGROUPS 10;
```

## 性能调优

### 写入参数调优

| 参数 | 说明 | 建议值 |
|---|---|---|
| `BUFFER` | 写入缓冲区大小 | 256-512 MB |
| `CACHE` | 标签缓存大小 | 100-500 MB |
| `WAL_LEVEL` | WAL 级别 | 1（性能优先）|
| `MAXSessions` | 单 VNode 最大并发 | 1000+ |

```sql
CREATE DATABASE power_grid (
    KEEP 3650,
    DURATION 10,
    BUFFER 512,          -- 增大缓冲区
    CACHE 400,           -- 增大标签缓存
    WAL_LEVEL 1,         -- 最小 WAL 写入
    MAXSessions 2000,    -- 最大并发
    REPLICA 1,
    VGROUPS 10
);
```

### 查询参数调优

```sql
-- 查看查询配置
SHOW VARIABLES;

-- 设置查询超时
SET query_timeout = 60000;  -- 60 秒

-- 设置 fetch 批次大小
SET fetch_batch_size = 10000;
```

## 面试追问方向

1. **TDengine 为什么比 InfluxDB 快？** TDengine 采用无代理架构（直连 VNode）、超级表预聚合、列式存储 + 高效压缩，写入路径更短。

2. **VNode 和物理节点是什么关系？** 一个物理节点可以运行多个 VNode，VNode 是逻辑概念，用于数据分片和副本管理。

3. **副本同步机制？** TDengine 使用 RAFT 协议同步副本写入，保证数据一致性。

4. **如何估算集群规模？** 单 VNode 约可处理 100 万张子表、每秒 10 万条写入。按此估算数据量，选择 VGroup 数量。
