# 主备切换与故障转移机制

你有没有想过这个问题：如果你负责的数据库服务器突然宕机了，业务会怎样？

如果没有任何高可用机制，答案是：业务中断，所有依赖数据库的功能都无法使用。

但如果你做好了主备切换和故障转移机制，情况就不一样了：主库宕了，备库自动顶上，业务几乎不受影响。

这就是高可用的魅力。

## 主备复制架构

### 主从复制原理

```
写入 ──▶ ┌─────┐                      ┌─────┐
         │主库 │ ──── 同步/异步 ────▶ │备库1 │
         └─────┘                      └─────┘
            │                              │
            │                              │
         ┌──┴──┐                       ┌──┴──┐
         │binlog│                       │relay│
         │日志  │                       │log │
         └─────┘                       └─────┘
```

MySQL 主从复制的核心是 binlog（二进制日志）：

1. 主库将所有写操作记录到 binlog
2. 从库通过 IO 线程读取主库的 binlog
3. 从库将 binlog 内容写入自己的 relay log（中继日志）
4. 从库的 SQL 线程读取 relay log 并执行

### 主从配置

```sql
-- 主库配置
[mysqld]
server-id = 1
log-bin = mysql-bin
binlog-format = ROW
sync-binlog = 1

-- 从库配置
[mysqld]
server-id = 2
relay-log = relay-bin
read-only = 1
```

```java
// MySQL Connector/J 配置
String url = "jdbc:mysql://master:3306/db?useSSL=false";

// 或者使用连接池（推荐）
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:mysql://localhost:3306/db");
config.setUsername("user");
config.setPassword("password");

// 读写分离配置
config.setDataSourceClassName("com.zaxxer.hikari.m
.HikariDataSource");
```

## 主备切换

### 什么是主备切换

主备切换（Failover）是指当主库发生故障时，自动或手动将流量切换到备用库的过程。

```
正常状态：
         用户请求
              │
              ▼
        ┌─────────┐
        │  负载均衡  │
        └────┬────┘
             │ 写
        ┌────▼────┐
        │   主库   │  ←── 正常
        └─────────┘

故障状态：
         用户请求
              │
              ▼
        ┌─────────┐
        │  负载均衡  │
        └────┬────┘
             │ 写
        ┌────▼────┐
        │   主库   │  ✗ 宕机！
        └─────────┘
             │
             ▼ 切换
        ┌─────────┐
        │   备库   │  ←── 接管
        └─────────┘
```

### 主备切换的触发条件

```java
// 健康检查
public boolean shouldFailover(HealthCheckResult result) {
    // 连续多次检查失败才切换
    if (result.getFailureCount() &lt; 3) {
        return false;
    }

    // 检查是否是网络抖动
    if (result.getFailureDuration() &lt; TimeUnit.SECONDS.toMillis(10)) {
        return false; // 网络抖动，等待自行恢复
    }

    // 检查主库是否真的挂了
    if (isNetworkReachable(primaryHost)) {
        return false; // 网络可达，说明主库可能只是响应慢
    }

    return true;
}
```

### 自动切换流程

```
1. 故障检测
      │
      ▼
2. 选举新主
      │
      ▼
3. 提升新主
      │
      ▼
4. 流量切换
      │
      ▼
5. 重新同步
```

```java
public class FailoverManager {

    private final List&lt;DbNode&gt; nodes;
    private volatile DbNode primary;

    public void failover() {
        // 1. 确认主库故障
        if (isPrimaryAlive()) {
            log.info("主库仍然存活，无需切换");
            return;
        }

        // 2. 选举新主库
        DbNode newPrimary = selectNewPrimary();
        if (newPrimary == null) {
            log.error("没有可用的备库，切换失败");
            alert("主备切换失败：无备库可用");
            return;
        }

        // 3. 提升新主库
        promoteNewPrimary(newPrimary);

        // 4. 重新配置其他备库
        reconfigureReplicas(newPrimary);

        // 5. 更新路由
        updateRouting(newPrimary);

        log.info("主备切换完成，新主库：{}", newPrimary);
        alert("主备切换成功：新主库 " + newPrimary);
    }
}
```

### 手动切换

```java
// 运维人员主动触发切换
public class SwitchoverController {

    @PostMapping("/api/db/switchover")
    public Response switchover(@RequestParam String targetNode) {
        log.info("运维发起切换，目标节点：{}", targetNode);

        // 1. 检查目标节点是否健康
        if (!isHealthy(targetNode)) {
            return Response.error("目标节点不健康，无法切换");
        }

        // 2. 等待主库同步完成
        waitForSync();

        // 3. 停止主库写入
        stopWrites();

        // 4. 再次检查同步状态
        if (!isSynced()) {
            resumeWrites();
            return Response.error("数据未完全同步，取消切换");
        }

        // 5. 执行切换
        doSwitchover(targetNode);

        return Response.success("切换成功");
    }
}
```

## 故障转移

### 什么是故障转移

故障转移（Failover）比主备切换更广泛，指系统中任何节点故障时，自动将请求转移到备用节点的过程。可以是应用层、数据库层、服务层等多个层面的故障转移。

```
用户请求
     │
     ▼
┌─────────────────────────────────────────┐
│         ┌─────────┐                     │
│         │ 服务A   │                     │
│         └────┬────┘                     │
│              │                          │
│    正常 ─────┼─────▶ 返回结果            │
│              │                          │
│    故障 ─────┼─────▶ 自动切换            │
│              │                          │
│         ┌────▼────┐                     │
│         │ 服务B   │  ←── 备用节点        │
│         └─────────┘                     │
└─────────────────────────────────────────┘
```

### 客户端故障转移

```java
public class FailoverDataSource extends AbstractDataSource {

    private final List&lt;HikariDataSource&gt; dataSources;
    private volatile int currentIndex = 0;

    @Override
    public Connection getConnection() throws SQLException {
        for (int i = 0; i &lt; dataSources.size(); i++) {
            HikariDataSource ds = dataSources.get((currentIndex + i) % dataSources.size());
            try {
                Connection conn = ds.getConnection();
                currentIndex = (currentIndex + i) % dataSources.size();
                return conn;
            } catch (SQLException e) {
                log.warn("连接失败，尝试下一个数据源：{}", ds.getJdbcUrl());
            }
        }
        throw new SQLException("所有数据源都不可用");
    }
}
```

### 连接池故障转移

```java
@Configuration
public class DataSourceConfig {

    @Bean
    public DataSource dataSource() {
        HikariConfig master = new HikariConfig();
        master.setJdbcUrl("jdbc:mysql://master:3306/db");
        master.setUsername("user");
        master.setPassword("password");
        master.setPoolName("master-pool");

        HikariConfig slave1 = new HikariConfig();
        slave1.setJdbcUrl("jdbc:mysql://slave1:3306/db");
        slave1.setUsername("user");
        slave1.setPassword("password");
        slave1.setPoolName("slave-pool");

        // 使用路由数据源
        RoutingDataSource routingDataSource = new RoutingDataSource();
        routingDataSource.setTargetDataSources(Map.of(
            "master", new HikariDataSource(master),
            "slave", new HikariDataSource(slave1)
        ));
        routingDataSource.setDefaultTargetDataSource(new HikariDataSource(master));

        return routingDataSource;
    }
}
```

### 应用层故障转移

```java
public class ServiceFailover {

    private final Map&lt;String, ServiceInstance&gt; services;
    private final HealthChecker healthChecker;
    private final LoadBalancer loadBalancer;

    public Response call(String serviceName, Request request) {
        List&lt;ServiceInstance&gt; instances = services.get(serviceName);

        for (ServiceInstance instance : loadBalancer.select(instances)) {
            try {
                return invoke(instance, request);
            } catch (Exception e) {
                log.warn("调用失败，尝试下一个实例：{}", instance);
                healthChecker.reportUnhealthy(instance);
            }
        }

        throw new ServiceUnavailableException(serviceName);
    }
}
```

## VIP 飘移

### 什么是 VIP 飘移

VIP（Virtual IP，虚拟 IP）飘移是高可用架构中的常用技术。多个服务器共享一个虚拟 IP，正常情况下只有主服务器持有该 IP，当主服务器故障时，VIP 会自动飘移到备用服务器上。

```
正常状态：
  ┌─────────┐  VIP: 192.168.1.100
  │  主服务器 │
  └────┬────┘
       │ 持有 VIP

备用服务器 ──────────────────▶ 无 VIP

故障状态：
  主服务器 ✗

  ┌─────────┐
  │  主服务器 │
  └─────────┘

  ┌─────────┐  VIP: 192.168.1.100
  │ 备用服务器 │  ←── VIP 飘移过来
  └────┬────┘
```

### Keepalived 实现 VIP 飘移

```bash
# keepalived.conf
vrrp_instance VI_1 {
    state MASTER            # 主服务器
    interface eth0
    virtual_router_id 51
    priority 100            # 优先级
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass 1111
    }
    virtual_ipaddress {
        192.168.1.100       # 虚拟 IP
    }
    track_script {
        chk_mysql           # 检查脚本
    }
}

vrrp_script chk_mysql {
    script "/etc/keepalived/check_mysql.sh"
    interval 2
    weight -20              # 检查失败时优先级降低
}
```

```bash
#!/bin/bash
# check_mysql.sh
/usr/bin/mysqladmin ping -uroot -p$MYSQL_ROOT_PASSWORD &>/dev/null
if [ $? -ne 0 ]; then
    exit 1  # MySQL 不可用，返回失败
fi
exit 0
```

### LVS + Keepalived

```
用户请求
    │
    ▼
┌─────────────┐
│   LVS director │
└───────┬─────┘
        │
   ┌────┴────┐
   │VIP飘移│
   └────┬────┘
        │
   ┌────▼────┐
   │ Real Server 1 │ ←── 主
   └─────────┘
        │
   ┌────▼────┐
   │ Real Server 2 │ ←── 备
   └─────────┘
```

## 数据一致性

### 同步 vs 异步复制

| 模式 | 优点 | 缺点 |
|------|------|------|
| 同步复制 | 数据不丢失 | 延迟高，性能差 |
| 异步复制 | 性能好 | 可能丢数据 |
| 半同步复制 | 平衡安全与性能 | 需要等待一个节点确认 |

```sql
-- 半同步复制配置
-- 主库
SET GLOBAL rpl_semi_sync_master_enabled = 1;

-- 从库
SET GLOBAL rpl_semi_sync_slave_enabled = 1;
STOP SLAVE;
START SLAVE;

-- 查看半同步状态
SHOW STATUS LIKE 'Rpl_semi_sync%';
```

### 切换时的数据保护

```java
public class SafeFailover {

    private static final int MAX_REPLICATION_LAG = 5; // 最大复制延迟（秒）

    public boolean canFailover(ReplicaDbNode replica) {
        // 1. 检查复制延迟
        long lag = replica.getReplicationLag();
        if (lag > MAX_REPLICATION_LAG) {
            log.warn("复制延迟过大，不建议切换: {}秒", lag);
            return false;
        }

        // 2. 检查数据完整性
        if (!replica.isDataConsistent()) {
            log.error("数据不一致，不允许切换");
            return false;
        }

        return true;
    }
}
```

### 切回原主库

```java
public class FailbackManager {

    public void failback(PrimaryNode originalPrimary, PrimaryNode currentPrimary) {
        log.info("开始切回原主库: {}", originalPrimary);

        // 1. 等待原主库恢复
        waitForRecovery(originalPrimary);

        // 2. 停止原主库写入
        stopWrites(originalPrimary);

        // 3. 同步数据
        syncData(currentPrimary, originalPrimary);

        // 4. 等待同步完成
        waitForSyncComplete();

        // 5. 切换角色
        switchRoles(originalPrimary, currentPrimary);

        // 6. 恢复写入
        resumeWrites(originalPrimary);

        log.info("切回原主库完成");
    }
}
```

## 高可用架构设计

### 双主架构

```
┌─────────────────────────────────────┐
│           应用程序                   │
└───────────────┬─────────────────────┘
                │
         ┌──────┴──────┐
         │  读写分离路由 │
         └──────┬──────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│ Master │◀─│ Sync │─▶│ Master │  ←── 双主互相同步
│   A    │   └───────┘   │   B    │
└───────┘               └───────┘
```

### 多活架构

```
        华东节点           华南节点
    ┌─────────────┐   ┌─────────────┐
    │  应用 + DB  │   │  应用 + DB  │
    └──────┬──────┘   └──────┬──────┘
           │                  │
           └────────┬─────────┘
                    │
               数据同步
```

---

**思考题：**

1. 主从复制是异步的，如果主库突然宕机，可能会丢失数据。如何在性能和安全性之间取得平衡？

2. VIP 飘移依赖于 ARP 协议，在云环境或容器化部署中会遇到什么问题？

3. 故障转移发生时，应用程序应该如何处理？连接池如何快速感知并重连到新节点？

4. 切回原主库（Failback）是一个风险较高的操作，应该如何设计流程来确保数据不丢失？
