# 高可用方案：让数据库永不宕机

你的电商系统正在搞大促，突然数据库挂了。

订单无法创建、支付无法完成...

损失按秒计算。

数据库高可用，是每个系统必须考虑的问题。

---

## 高可用的目标

### 可用性指标

| 可用性 | 年停机时间 | 适用场景 |
|--------|------------|----------|
| 99% | 3.65 天 | 普通系统 |
| 99.9% | 8.76 小时 | 大多数业务系统 |
| 99.99% | 52.6 分钟 | 核心业务系统 |
| 99.999% | 5.26 分钟 | 金融等关键系统 |

### 高可用的核心

1. **消除单点故障**：任何组件都有备份
2. **故障自动切换**：故障时自动切换到备用节点
3. **数据不丢失**：切换后数据保持一致

---

## MySQL 高可用方案

### 方案一：主从手动切换

最简单的高可用方案，但切换需要人工介入。

```
正常状态：
Master → Slave

Master 挂了：
手动切换 Slave 为 Master，重新配置应用
```

**缺点**：需要人工介入，有停机时间。

### 方案二：MHA（Master High Availability）

日本 DeNA 开发的 MySQL 高可用工具。

```
┌─────────────────────────────────────────────────────────────┐
│                      MHA 架构                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              ┌─────────────┐                                │
│              │   MHA      │                                │
│              │  Manager   │                                │
│              └──────┬──────┘                                │
│                     │                                       │
│     ┌───────────────┼───────────────┐                       │
│     ↓               ↓               ↓                       │
│ ┌─────────┐   ┌─────────┐   ┌─────────┐                    │
│ │ Master  │ → │ Slave 1 │ → │ Slave 2 │                    │
│ └─────────┘   └─────────┘   └─────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**功能**：
- 自动监控 Master 状态
- 自动选举新 Master
- 自动补齐数据差异
- 故障切换时间通常 < 30 秒

### 方案三：MySQL Group Replication

MySQL 5.7.17+ 原生支持的高可用方案。

```
┌─────────────────────────────────────────────────────────────┐
│                   Group Replication                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              ┌─────────────────────────────────┐            │
│              │      MySQL Group (3 节点)        │            │
│              │   多数派 + Paxos 共识协议         │            │
│              └─────────┬───────────┬───────────┘            │
│           ┌───────────┼───────────┼───────────┐              │
│           ↓           ↓           ↓                       │
│      ┌─────────┐ ┌─────────┐ ┌─────────┐                    │
│      │ Node 1  │ │ Node 2  │ │ Node 3  │                    │
│      │Primary  │ │Primary  │ │Primary  │                    │
│      └─────────┘ └─────────┘ └─────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**特点**：
- 多主模式：所有节点都可以接受写请求
- 自动选主：故障时自动选举新主节点
- 数据强一致：基于 Paxos 协议

### 方案四：MySQL Cluster（MySQL NDB）

MySQL 原生的分布式数据库引擎。

**适用场景**：超高性能、高可用、大数据量。

**缺点**：配置复杂，运维成本高。

### 方案五：Orchestrator

开源的 MySQL 高可用管理工具。

```bash
# 查看集群状态
orchestrator -c cluster

# 查看拓扑
orchestrator -c topology INSTANCE:PORT
```

### 方案六：云数据库

使用阿里云 RDS、腾讯云 CDB 等云数据库服务。

**优点**：
- 免运维
- 自动备份
- 自动故障切换
- 按需扩展

**缺点**：
- 费用较高
- 受制于云服务商

---

## 高可用架构对比

| 方案 | 复杂度 | 自动切换 | 数据一致性 | 适用场景 |
|------|--------|----------|------------|----------|
| 主从手动切换 | 低 | 否 | 弱 | 预算有限 |
| MHA | 中 | 是 | 强 | 中小型系统 |
| Group Replication | 中高 | 是 | 强 | MySQL 8.0+ |
| Orchestrator | 中 | 是 | 取决于复制模式 | 成熟系统 |
| 云数据库 | 低 | 是 | 强 | 快速上线 |

---

## 高可用架构设计原则

### 原则一：同机房部署

主从库在同一机房，网络延迟小，切换快。

```yaml
# docker-compose 示例
services:
  mysql-master:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=password
    networks:
      - mysql-net

  mysql-slave:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=password
    networks:
      - mysql-net
    depends_on:
      - mysql-master

networks:
  mysql-net:
```

### 原则二：健康检查

定期检查数据库健康状态。

```java
@Service
public class HealthChecker {
    @Scheduled(fixedRate = 10000)  // 每 10 秒检查一次
    public void checkHealth() {
        try {
            // 检查主库
            boolean masterOk = checkMaster();
            if (!masterOk) {
                alertService.alert("主库不可用！");
                triggerFailover();
            }

            // 检查从库
            List&lt;String&gt; failedSlaves = checkSlaves();
            if (!failedSlaves.isEmpty()) {
                alertService.alert("从库 " + failedSlaves + " 不可用");
            }
        } catch (Exception e) {
            logger.error("健康检查失败", e);
        }
    }
}
```

### 原则三：切换脚本

```bash
#!/bin/bash
# failover.sh

MASTER_HOST=$1
NEW_MASTER=$2

# 1. 停止旧主库复制
mysql -h $MASTER_HOST -e "STOP SLAVE;"

# 2. 在新主库上执行
mysql -h $NEW_MASTER -e "RESET SLAVE ALL;"

# 3. 重新配置其他从库
for SLAVE in $OTHER_SLAVES; do
    mysql -h $SLAVE -e "CHANGE MASTER TO MASTER_HOST='$NEW_MASTER', MASTER_AUTO_POSITION=1;"
    mysql -h $SLAVE -e "START SLAVE;"
done

# 4. 更新应用配置
update-app-config.sh $NEW_MASTER
```

### 原则四：数据校验

定期校验主从数据一致性。

```sql
-- 使用 pt-table-checksum 校验
pt-table-checksum h=master,u=root,p=password --tables orders
```

---

## 实战：搭建 MHA 高可用

### 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      MHA 架构                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Manager                                                  │
│   Node                                                     │
│   (管理节点)                                                │
│       │                                                     │
│       ├────────────────┬────────────────┐                   │
│       ↓                ↓                ↓                   │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐                │
│   │ Master  │ → │ Slave 1 │ → │ Slave 2 │                │
│   │ Node    │    │ Node    │    │ Node    │                │
│   └─────────┘    └─────────┘    └─────────┘                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 配置 MHA

```ini
# /etc/mha/app.cnf
[server default]
manager_log=/var/log/mha/manager.log
manager_workdir=/var/log/mha
remote_root=root
ssh_user=root
repl_user=repl
repl_password=password

[server1]
hostname=192.168.1.101
candidate_master=1

[server2]
hostname=192.168.1.102
candidate_master=1

[server3]
hostname=192.168.1.103
no_master=1
```

### 启动 MHA

```bash
# 启动 manager
nohup masterha_manager --conf=/etc/mha/app.cnf &

# 检查状态
masterha_check_status --conf=/etc/mha/app.cnf
```

---

## 一句话总结

高可用方案的选择取决于业务需求和预算：**预算有限**用主从手动切换，**MySQL 8.0+** 用 Group Replication，**追求简单**用云数据库。
