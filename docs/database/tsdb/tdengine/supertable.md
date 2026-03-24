# TDengine 超级表与子表设计

100 万台电表，每台每秒上报数据。

你怎么设计表结构？建 100 万张表？还是建 1 张大表？

TDengine 的答案是：**1 张超级表 + 100 万张子表**。

这个设计看似简单，背后却藏着对时序数据本质的深刻理解。

## 超级表 vs 普通表

### 普通表

```sql
-- MySQL 风格的建表
CREATE TABLE meter_001 (
    ts TIMESTAMP,
    voltage DOUBLE,
    current DOUBLE,
    power DOUBLE
);

CREATE TABLE meter_002 (
    ts TIMESTAMP,
    voltage DOUBLE,
    current DOUBLE,
    power DOUBLE
);

-- 100 万台电表 = 100 万张表
-- 问题：元数据管理复杂，跨表查询慢
```

### 超级表（Super Table）

```sql
-- 创建超级表（定义同一类型设备的数据结构）
CREATE STABLE power_meter (
    ts TIMESTAMP,          -- 时间戳
    voltage DOUBLE,         -- 电压
    current DOUBLE,         -- 电流
    power DOUBLE           -- 功率
) TAGS (
    meter_id BINARY(50),   -- 电表 ID（标签）
    location BINARY(50),   -- 地理位置（标签）
    meter_type INT         -- 电表类型（标签）
);
```

超级表 = **数据结构定义** + **标签schema**

### 子表（Sub Table）

```sql
-- 基于超级表创建子表
CREATE TABLE meter_001 USING power_meter TAGS ('meter_001', 'Beijing', 1);
CREATE TABLE meter_002 USING power_meter TAGS ('meter_002', 'Shanghai', 2);

-- 子表继承超级表的列结构
-- 子表拥有独立的标签值
-- 100 万台电表 = 1 张超级表 + 100 万张子表
```

## 超级表的核心优势

### 1. 共享 schema，减少元数据

```
普通表方案（MySQL）：
┌──────────────────────────────────────────────────────┐
│  表名：meter_001                                     │
│  存储：meter_id, location, meter_type, ts, voltage...│
│  表名：meter_002                                     │
│  存储：meter_id, location, meter_type, ts, voltage...│
│  ...（每张表都重复存储标签信息）                      │
└──────────────────────────────────────────────────────┘
元数据开销：100 万 × 标签列数 = 海量

超级表方案（TDengine）：
┌──────────────────────────────────────────────────────┐
│  超级表：power_meter                                 │
│  存储：ts, voltage, current, power（仅数据列）         │
│                                                      │
│  标签元数据（独立存储）：                             │
│  meter_id → meter_001                               │
│  location → Beijing                                 │
│  meter_type → 1                                    │
└──────────────────────────────────────────────────────┘
元数据开销：仅存储一次标签schema
```

### 2. 支持超级表级别的聚合查询

```sql
-- 查询所有北京电表的平均功率（跨所有子表）
SELECT AVG(power) FROM power_meter WHERE location = 'Beijing';

-- 按地理位置分组聚合
SELECT location, AVG(voltage), MAX(current)
FROM power_meter
WHERE ts > NOW() - 1d
GROUP BY location;

-- 查询特定类型的电表
SELECT * FROM power_meter WHERE meter_type = 1;
```

### 3. 标签支持索引

```sql
-- TDengine 自动为标签建立索引
-- 查询 location='Beijing' 的电表时，直接定位到相关子表
-- 无需扫描所有 100 万张子表
```

## 实战：IoT 电表监控系统

### 场景描述

```
需求：
- 100 万台电表
- 每台电表每秒上报：电压、电流、功率
- 查询场景：
  1. 单台电表实时数据
  2. 某地区所有电表的聚合数据
  3. 某类型电表的统计
```

### 建表语句

```sql
-- 1. 创建数据库（配置副本、分区、保留策略）
CREATE DATABASE power_grid
KEEP 3650        -- 保留 10 年
DURATION 10      -- 按 10 天分区
BUFFER 256      -- 写入缓冲区 MB
REPLICA 1;      -- 副本数

-- 2. 创建超级表
CREATE STABLE power_grid.meter_data (
    ts TIMESTAMP,           -- 时间戳
    voltage DOUBLE,          -- 电压（V）
    current DOUBLE,          -- 电流（A）
    power DOUBLE,            -- 功率（W）
    pf DOUBLE,               -- 功率因数
    energy DOUBLE            -- 电能（kWh）
) TAGS (
    meter_id BINARY(64),     -- 电表 ID
    location_id INT,         -- 地区编码
    location_name BINARY(50),-- 地区名称
    meter_type TINYINT,      -- 电表类型（1=居民, 2=商业, 3=工业）
    owner_id BINARY(64)      -- 户主 ID
);

-- 3. 创建子表（批量创建）
-- 方式一：逐条创建
CREATE TABLE meter_00001 USING power_grid.meter_data
    TAGS ('meter_00001', 110100, 'Beijing-Chaoyang', 1, 'owner_001');

CREATE TABLE meter_00002 USING power_grid.meter_data
    TAGS ('meter_00002', 310100, 'Shanghai-Pudong', 2, 'owner_002');

-- 方式二：批量创建（使用超级表模板）
INSERT INTO meter_00003
    USING power_grid.meter_data TAGS ('meter_00003', 440100, 'Guangzhou', 1, 'owner_003')
VALUES ('2024-01-15 10:00:00.000', 220.5, 10.2, 2248.0, 0.95, 100.5);

-- 方式三：自动创建（插入数据时自动建表）
INSERT INTO power_grid.meter_data (meter_id, location_id, location_name, meter_type, owner_id, ts, voltage, current, power)
USING power_grid.meter_data TAGS ('meter_auto_001', 110100, 'Beijing', 1, 'owner_auto')
VALUES ('2024-01-15 10:00:00.000', 220.5, 10.2, 2248.0);
```

### Java 代码示例

```java
package com.example;

import com.taosdata.jdbc.TSDBPreparedStatement;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

public class TDengineExample {
    public static void main(String[] args) throws SQLException {
        // 连接 TDengine
        String jdbcUrl = "jdbc:TAOS://localhost:6030/power_grid?user=root&password=taosdata";
        try (Connection conn = DriverManager.getConnection(jdbcUrl);
             Statement stmt = conn.createStatement()) {
            
            // 1. 创建超级表
            stmt.executeUpdate("CREATE STABLE IF NOT EXISTS meter_data (" +
                "ts TIMESTAMP, " +
                "voltage DOUBLE, " +
                "current DOUBLE, " +
                "power DOUBLE, " +
                "pf DOUBLE, " +
                "energy DOUBLE" +
                ") TAGS (" +
                "meter_id BINARY(64), " +
                "location_id INT, " +
                "location_name BINARY(50), " +
                "meter_type TINYINT, " +
                "owner_id BINARY(64))");
            
            // 2. 创建子表
            String insertSql = "INSERT INTO ? USING meter_data TAGS (?, ?, ?, ?, ?) VALUES (?, ?, ?, ?, ?, ?)";
            try (TSDBPreparedStatement pstmt = conn.prepareStatement(insertSql).unwrap(TSDBPreparedStatement.class)) {
                // 绑定第一张子表
                pstmt.setTableName("meter_00001");
                pstmt.setTagString(0, "meter_00001");
                pstmt.setTagInt(1, 110100);
                pstmt.setTagString(2, "Beijing-Chaoyang");
                pstmt.setTagByte(3, (byte) 1);
                pstmt.setTagString(4, "owner_001");
                
                // 绑定数据
                pstmt.setTimestamp(5, new java.sql.Timestamp(System.currentTimeMillis()));
                pstmt.setDouble(6, 220.5);
                pstmt.setDouble(7, 10.2);
                pstmt.setDouble(8, 2248.0);
                pstmt.setDouble(9, 0.95);
                pstmt.setDouble(10, 100.5);
                
                pstmt.execute();
            }
            
            // 3. 查询示例
            // 3.1 查询单台电表
            String querySql = "SELECT LAST(*) FROM meter_00001";
            System.out.println("单表查询: " + stmt.executeQuery(querySql));
            
            // 3.2 超级表聚合查询
            String superQuery = "SELECT location_name, AVG(voltage), MAX(current) " +
                "FROM meter_data " +
                "WHERE ts > NOW() - 1h " +
                "GROUP BY location_name";
            System.out.println("超级表聚合: " + stmt.executeQuery(superQuery));
            
            // 3.3 按标签过滤查询
            String filterQuery = "SELECT AVG(power) FROM meter_data " +
                "WHERE meter_type = 1 " +
                "AND ts > NOW() - 1d " +
                "INTERVAL(1h)";
            System.out.println("标签过滤: " + stmt.executeQuery(filterQuery));
        }
    }
}
```

## 标签设计原则

### 静态标签 vs 动态标签

| 类型 | 特点 | 示例 |
|---|---|---|
| **静态标签** | 创建后不变 | meter_id, location, meter_type |
| **动态标签** | 可能变化 | online_status, last_reading_time |

```sql
-- 静态标签：直接放在 TAGS 中
CREATE STABLE meter (...) TAGS (
    meter_id BINARY(64),      -- 静态：电表 ID 不变
    location_id INT,          -- 静态：位置不变
    meter_type TINYINT        -- 静态：类型不变
);

-- 动态属性：作为普通列存储
CREATE STABLE meter (...) TAGS (meter_id BINARY(64), location_id INT) (
    ts TIMESTAMP,
    voltage DOUBLE,
    online_status BOOLEAN,     -- 动态：在线状态
    last_reading_time TIMESTAMP -- 动态：最后读数时间
);
```

### 标签基数控制

```sql
-- 问题：高基数字段作为标签
CREATE STABLE bad_example (...) TAGS (
    user_id BINARY(64),      -- 100 万用户 = 100 万种值 = 100 万时间线
    device_id BINARY(64)     -- 100 万设备 = 100 万种值
);
-- 结果：1 万亿条时间线组合，内存爆炸

-- 解决方案：高基数字段作为普通列
CREATE STABLE good_example (...) TAGS (
    user_id BINARY(64),      -- 保持，但不会做超级表聚合
    device_type INT          -- 低基数标签
) (
    ts TIMESTAMP,
    user_id BINARY(64),      -- 作为普通列
    event_type BINARY(50),
    value DOUBLE
);

-- 查询特定用户时使用 WHERE 条件
SELECT * FROM good_example WHERE user_id = 'user_12345';
```

## 常见问题

### 问题 1：子表数量上限

```sql
-- TDengine 对单库子表数量有限制（取决于配置）
-- 查看当前限制
SHOW VARIABLES;

-- 调整限制（配置文件中）
# maxTablesPerDb 1000000
```

### 问题 2：超级表查询慢

```sql
-- 原因：标签值太多，导致超级表扫描慢
-- 解决：创建超级表时添加索引
CREATE STABLE meter_data (...) TAGS (
    meter_id BINARY(64),
    location_id INT,
    location_name BINARY(50) TAG_TENANT('location_idx')
);

-- 对已有超级表添加索引
ALTER STABLE meter_data ADD TAG INDEX location_idx (location_name);
```

### 问题 3：子表查询 vs 超级表查询

```sql
-- 子表查询（精确到单台设备）
SELECT * FROM meter_00001 WHERE ts > NOW() - 1h;
-- 优点：最快，直接定位到一张表

-- 超级表查询（聚合多台设备）
SELECT AVG(power) FROM meter_data WHERE meter_type = 1;
-- 优点：一次查询多台设备
-- 缺点：需要合并多个子表结果
```

## 面试追问方向

1. **TDengine 的超级表和 InfluxDB 的 Measurement 有什么区别？** 超级表有明确的标签schema，支持子表继承；InfluxDB 的 Measurement 标签是动态添加到每条数据中的。

2. **为什么标签要用 TAGS 单独定义？** TAGS 是 TDengine 的核心创新。标签存储在独立的元数据区，不占用数据存储空间，且支持高效索引。

3. **超级表查询为什么比普通表查询慢？** 需要扫描多个子表的数据，然后聚合。查询条件中指定更多标签可以减少扫描范围。

4. **子表数量对性能的影响？** 子表数量影响元数据管理开销。TDengine 通过虚拟节点（VNode）分散管理子表，单节点建议不超过 100 万个子表。
