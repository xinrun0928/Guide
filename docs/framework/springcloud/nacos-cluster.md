# Nacos 集群与持久化

> 单机版 Nacos 能满足开发和测试，但生产环境呢？服务注册中心宕了，整个微服务系统就瘫痪了。
>
> 这一讲，我们来聊聊 Nacos 集群如何部署，以及数据如何持久化。

---

## 为什么需要集群

先看单机版 Nacos 的问题：

```
┌─────────────────────────────────────────────────────────┐
│              单机 Nacos 的风险                           │
│                                                          │
│  ┌──────────┐                                           │
│  │  Nacos   │  ← 宕机                                   │
│  │  :8848   │                                           │
│  └────┬─────┘                                           │
│       │                                                 │
│       ▼                                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │           微服务系统 —— 全部失效                    │   │
│  │  用户服务  订单服务  支付服务  商品服务  ...        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**单机版的风险**：

1. Nacos 宕机 → 服务无法注册 → 新请求无法找到服务
2. Nacos 宕机 → 配置丢失 → 所有服务使用本地缓存的旧配置
3. 无法水平扩展 → 大规模服务时性能瓶颈

---

## Nacos 集群架构

### 基本架构

```
                        ┌─────────────────┐
                        │   VIP / Nginx   │
                        │  (负载均衡入口)   │
                        └────────┬────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
    ┌───────────┐          ┌───────────┐          ┌───────────┐
    │  Nacos 1  │◄────────►│  Nacos 2  │◄────────►│  Nacos 3  │
    │ :8848     │   Raft   │ :8848     │   Raft   │ :8848     │
    └─────┬─────┘          └─────┬─────┘          └─────┬─────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      MySQL / Derby       │
                    │     (统一存储)           │
                    └─────────────────────────┘
```

### 集群核心机制

1. **Leader 选举**：Raft 协议保证数据一致性
2. **数据同步**：Leader 同步到 Follower
3. **故障转移**：Leader 宕机，自动选举新 Leader
4. **统一存储**：所有配置数据存储在数据库

---

## 快速搭建集群

### 1. 准备 MySQL 数据库

```sql
-- 创建 nacos 数据库
CREATE DATABASE nacos_config CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建数据库用户
CREATE USER 'nacos'@'%' IDENTIFIED BY 'nacos_password';
GRANT ALL PRIVILEGES ON nacos_config.* TO 'nacos'@'%';
FLUSH PRIVILEGES;

-- 初始化数据库（使用 Nacos 自带的脚本）
-- 脚本位置：nacos/conf/mysql-schema.sql
```

### 2. 修改配置文件

```bash
# 进入 Nacos 配置目录
cd nacos/conf

# 编辑 cluster.conf
vim cluster.conf
```

```properties
# cluster.conf 内容
# 填写集群节点地址（3 个或以上奇数个）
192.168.1.101:8848
192.168.1.102:8848
192.168.1.103:8848
```

### 3. 配置 MySQL 持久化

```bash
vim application.properties
```

```properties
# application.properties 添加/修改
# 数据库配置
spring.datasource.platform=mysql
db.num=1
db.url.0=jdbc:mysql://192.168.1.200:3306/nacos_config?characterEncoding=utf8&connectTimeout=1000&socketTimeout=3000&autoReconnect=true&useUnicode=true&useSSL=false&serverTimezone=UTC
db.user.0=nacos
db.password.0=nacos_password

# 集群模式
nacos.inetutils.prefer-hostname-over-ip=false
nacos.inetutils.ip-address=192.168.1.101
```

### 4. 启动集群

```bash
# 在每个节点上执行
cd nacos/bin

# Linux/Mac
./startup.sh

# Windows
startup.cmd
```

### 5. 验证集群

```bash
# 查看集群节点状态
curl http://192.168.1.101:8848/nacos/v1/ops/cluster/leader?all=true

# 响应示例
{
  "servers": [
    {"ip":"192.168.1.101","port":8848,"state":"LEADER"},
    {"ip":"192.168.1.102","port":8848,"state":"FOLLOWER"},
    {"ip":"192.168.1.103","port":8848,"state":"FOLLOWER"}
  ]
}
```

---

## 客户端连接集群

### 方式一：直连多个节点

```yaml
spring:
  cloud:
    nacos:
      discovery:
        server-addr: 192.168.1.101:8848,192.168.1.102:8848,192.168.1.103:8848
      config:
        server-addr: 192.168.1.101:8848,192.168.1.102:8848,192.168.1.103:8848
```

### 方式二：通过 Nginx 代理

```nginx
# nginx.conf
upstream nacos-cluster {
    server 192.168.1.101:8848;
    server 192.168.1.102:8848;
    server 192.168.1.103:8848;
}

server {
    listen 8848;
    
    location / {
        proxy_pass http://nacos-cluster;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```yaml
# 客户端配置
spring:
  cloud:
    nacos:
      discovery:
        server-addr: nginx-address:8848
```

---

## Raft 协议核心

### 为什么用 Raft

Nacos 使用 Raft 协议实现 CP 模型（一致性 + 分区容错）：

```
┌─────────────────────────────────────────────────────────┐
│                   Raft 协议原理                          │
│                                                          │
│  Leader Election (领导选举)                              │
│  ┌────────┐                                             │
│  │Follower│ ──超时──► Candidate ──投票──► Leader       │
│  └────────┘                                             │
│                                                          │
│  Log Replication (日志复制)                              │
│  Leader ──AppendEntries──► Follower                     │
│  (写入请求先写本地 log，复制到多数节点后生效)             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 选举机制

| 参数 | 默认值 | 说明 |
|---|---|---|
| election-timeout | 5000ms | 选举超时时间 |
| heartbeat-interval | 1500ms | 心跳间隔 |
| num-election | 1 | 选举轮次 |

**选举原则**：

1. 3 个节点允许 1 个故障
2. 5 个节点允许 2 个故障
3. 节点数 = 2N + 1（N 是允许故障数）

> **建议**：生产环境至少 3 个节点，推荐 5 个节点。

---

## 数据持久化策略

### 数据分类

Nacos 存储两类数据：

1. **元数据**：服务注册信息、配置信息
2. **审计数据**：操作日志、变更历史

### MySQL 存储结构

```sql
-- 服务注册表
CREATE TABLE `config_info` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `data_id` VARCHAR(255) NOT NULL,
    `group_id` VARCHAR(128) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `md5` VARCHAR(32) DEFAULT NULL,
    `gmt_create` DATETIME NOT NULL,
    `gmt_modified` DATETIME NOT NULL,
    `tenant_id` VARCHAR(128) DEFAULT '',
    `app_name` VARCHAR(128) DEFAULT NULL,
    `type` VARCHAR(32) DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_configinfo_datagrouptenant` (`data_id`,`group_id`,`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- 服务实例表
CREATE TABLE `instance` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `instance_id` VARCHAR(128) NOT NULL,
    `port` INT DEFAULT NULL,
    `ip` VARCHAR(128) NOT NULL,
    `cluster_name` VARCHAR(128) DEFAULT DEFAULT,
    `service_name` VARCHAR(128) NOT NULL,
    `healthy` TINYINT(1) DEFAULT FALSE,
    `metadata` TEXT,
    `weight` DOUBLE DEFAULT 1.0,
    `enabled` TINYINT(1) DEFAULT TRUE,
    `ephemeral` TINYINT(1) DEFAULT TRUE,
    `heartbeat_time` BIGINT DEFAULT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### 持久化 vs 非持久化

| 模式 | 适用场景 | 数据安全 | 性能 |
|---|---|---|---|
| Derby（默认） | 开发测试 | 单机，宕机丢失 | 高 |
| MySQL | 生产环境 | 持久化，高可用 | 稍低 |

---

## 生产环境最佳实践

### 1. 集群节点规划

```
┌─────────────────────────────────────────────────────────┐
│                  生产环境部署建议                        │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │                 可用区 A                         │    │
│  │  ┌─────────┐  ┌─────────┐                     │    │
│  │  │Nacos-1  │  │Nacos-2  │  (半数节点)           │    │
│  │  └─────────┘  └─────────┘                      │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │                 可用区 B                         │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐        │    │
│  │  │Nacos-3  │  │Nacos-4  │  │Nacos-5  │  (半数)  │    │
│  │  └─────────┘  └─────────┘  └─────────┘        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │                    MySQL 主从                    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 2. Nginx 高可用配置

```nginx
upstream nacos_cluster {
    server 192.168.1.101:8848 weight=1 max_fails=2 fail_timeout=30s;
    server 192.168.1.102:8848 weight=1 max_fails=2 fail_timeout=30s;
    server 192.168.1.103:8848 weight=1 max_fails=2 fail_timeout=30s;
    keepalive 64;
}

server {
    listen 8848;
    
    # 健康检查
    health_check interval=3000 rise=2 fall=3 type=http;
    health_check uri=/nacos/v1/console/health/readiness;
    
    location / {
        proxy_pass http://nacos_cluster;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### 3. JVM 参数调优

```bash
# startup.sh 添加 JVM 参数
JAVA_OPTS="-server -Xms4g -Xmx4g -Xmn2g \
  -XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=512m \
  -XX:+UseG1GC -XX:G1HeapRegionSize=16m \
  -XX:MaxGCPauseMillis=200 \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/data/nacos/logs/heapdump.hprof"
```

### 4. 监控告警

```yaml
# 开启 Nacos 监控
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  endpoint:
    health:
      show-details: always
```

推荐监控指标：

- 服务注册数量
- 配置数量
- 连接数
- 写入 QPS
- Raft 同步延迟

---

## 故障切换演示

### 模拟 Leader 宕机

```bash
# 1. 查看当前 Leader
curl http://192.168.1.101:8848/nacos/v1/ops/raft/leader

# 2. 模拟 Leader 宕机（停止 Leader 节点）

# 3. 观察新 Leader 选举
curl http://192.168.1.102:8848/nacos/v1/ops/raft/leader

# 4. 验证服务可用性
curl http://192.168.1.102:8848/nacos/v1/ns/instance/list?serviceName=user-service
```

**结果**：集群自动选举新 Leader，服务注册发现不受影响。

---

## 面试高频问题

### Q：Nacos 为什么需要集群？

A：单机版 Nacos 无法保证高可用，宕机后所有服务无法注册和发现。集群模式通过 Raft 协议保证数据一致性，支持故障自动切换。

### Q：Nacos 集群为什么推荐 3 个或 5 个节点？

A：Raft 协议要求多数节点确认才能完成写入。3 节点允许 1 个故障，5 节点允许 2 个故障。偶数节点没有优势，反而增加选主复杂度。

### Q：Nacos 的 AP 和 CP 模式怎么切换？

A：通过 `spring.cloud.nacos.discovery.ephemeral` 配置——`true` 为 AP 模式（临时实例），`false` 为 CP 模式（持久实例）。Raft 协议只对持久实例生效。

### Q：MySQL 持久化后 Derby 数据还在吗？

A：不会。切换到 MySQL 后，只使用 MySQL 存储。Derby 数据不会自动迁移，需要手动处理。

---

## 总结

Nacos 集群保障了微服务架构的高可用：

1. **Raft 协议**：保证数据一致性，支持故障自动切换
2. **MySQL 持久化**：配置数据不丢失
3. **多节点部署**：消除单点故障
4. **Nginx 负载均衡**：客户端统一入口

> 生产环境务必使用集群模式。一个稳定的服务注册中心，是整个微服务系统的基石。
