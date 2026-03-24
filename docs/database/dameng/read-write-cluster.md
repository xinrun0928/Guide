# 读写分离集群：让查询跑得比写的快

你有没有这种感觉：数据库写操作只占 10%，但读操作占 90%。

每次大促来临，数据库 CPU 飙升，查看监控发现：80% 的负载都在 SELECT 查询上。

这就是读写分离集群的用武之地：**让主库专心写，备库分担读。**

## 读写分离的本质

读写分离不是黑科技，而是一种朴素的架构思路：

```
写操作 ──→ 主库（唯一写入点）
           │
           ↓ 实时同步
           │
读操作 ──→ 备库（多个读取点）
```

## 达梦读写分离集群架构

达梦读写分离集群（RWCluster）基于主备集群构建，由一个主库和多个备库组成。

```
客户端
   │
   ├─→ 主库（写操作 + 部分实时读）
   │
   ├─→ 备库1（读操作）
   │
   ├─→ 备库2（读操作）
   │
   └─→ 备库3（读操作）
```

## 读写分离的路由策略

### 1. 强制备库读（推荐）

```sql
-- 通过 Hint 强制查询走备库
SELECT /*+SS*/ * FROM orders WHERE order_id = ?;
UPDATE /*+SS*/ orders SET status = 'paid' WHERE order_id = ?;  -- 忽略 Hint，写仍走主库
```

### 2. 自动路由

配置读写分离参数，让系统自动决定路由。

```ini
# dm_svc.conf
DAMENG=(192.168.1.10:5236,192.168.1.11:5236,192.168.1.12:5236)
rwSeparate=1           # 开启读写分离
rw_percent=30          # 30% 查询走备库
SWITCH_TIME=2         # 连接超时时间
SWITCH_INTERVAL=10   # 重试间隔
```

```java
// Java 应用无需特殊处理，自动路由
public class AutoRwRouteDemo {

    public void autoRoute() {
        // INSERT 自动走主库
        jdbcTemplate.update("INSERT INTO orders (...) VALUES (...)");

        // SELECT 自动按配置比例分配到主库或备库
        jdbcTemplate.queryForList("SELECT * FROM orders WHERE status = 'pending'");
    }
}
```

### 3. 会话级路由

在会话级别指定路由策略。

```sql
-- 当前会话强制走主库
SET SESSION ROUTE COMMENT = 'PRIMARY';

-- 当前会话强制走备库
SET SESSION ROUTE COMMENT = 'STANDBY';
```

```java
// Java 中设置会话路由
public class SessionRouteDemo {

    public void sessionRoute() {
        // 设置当前会话强制走备库
        connection.createStatement().execute(
            "SET SESSION ROUTE COMMENT = 'STANDBY'"
        );

        // 这个连接的所有查询都走备库
        String sql = "SELECT * FROM orders";
        jdbcTemplate.queryForList(sql);
    }
}
```

## 读写分离的延迟问题

读写分离最大的问题是**复制延迟**——主库写入后，备库可能还没同步完成。

### 延迟的影响

```java
// 延迟导致的读不到最新数据问题
public class ReplicationLagDemo {

    public void lagProblem() {
        // 用户下单
        jdbcTemplate.update(
            "INSERT INTO orders (user_id, amount) VALUES (?, ?)",
            123, 100.00
        );

        // 立即查询（可能走备库）
        // 由于复制延迟，可能查不到刚插入的订单
        String sql = "SELECT * FROM orders WHERE user_id = 123";
        List&lt;Map&lt;String, Object&gt;&gt; orders = jdbcTemplate.queryForList(sql);
        // orders 可能是空的！
    }
}
```

### 解决方案

**方案一：强制主库读**

```java
public class ForcePrimaryReadDemo {

    public void forcePrimaryRead() {
        // 通过 Hint 强制走主库
        String sql = "/*+PRIMARY*/ SELECT * FROM orders WHERE order_id = ?";
        jdbcTemplate.queryForObject(sql, 12345);
    }
}
```

**方案二：延迟感知读取**

```java
public class LagAwareReadDemo {

    private JdbcTemplate jdbcTemplate;

    public List&lt;Order&gt; queryWithLagCheck(String sql, Object... params) {
        // 检查同步延迟
        Long lag = checkReplicationLag();

        if (lag < 1000) {  // 延迟小于 1 秒
            return jdbcTemplate.queryForList(sql, params);
        } else {
            // 延迟过大，强制主库读取
            return jdbcTemplate.queryForList("/*+PRIMARY*/ " + sql, params);
        }
    }

    private Long checkReplicationLag() {
        return jdbcTemplate.queryForObject(
            "SELECT APPLY_LAG FROM V$DEST_STATUS WHERE DEST_ROLE = 'STANDBY'",
            Long.class
        );
    }
}
```

## 读写分离集群的配置

### dm.ini 配置

```ini
# 主库配置
DW_MODE = AUTO           # 自动切换
DW_INTERVAL = 5          # 检测间隔
DW_ERROR_TIME = 60       # 故障认定时间

# 备库配置
DW_TYPE = REMOTE         # 远程守护
DW_MODE = AUTO           # 自动模式
DW_REMOTE_TIME = 60     # 远程检测超时
```

### 集群服务配置

```ini
# dm_rwcluster.ini
[RGR1]
RW_TYPE = 1               # 读写分离模式
RW_MODE = AUTO            # 自动切换
PRIMARY_URL = 192.168.1.10:5236
STANDBY_URLS = 192.168.1.11:5236,192.168.1.12:5236
```

## 读写分离的监控

```sql
-- 查看各节点读写比例
SELECT
    INSTANCE_NAME,
    READ_COUNT,
    WRITE_COUNT,
    ROUND(READ_COUNT * 100.0 / (READ_COUNT + WRITE_COUNT), 2) AS READ_PERCENT
FROM V$INSTANCE;
```

```java
// Java 应用中监控读写分离效果
public class RwMonitor {

    public void monitor() {
        // 查看主库负载
        Double primaryCpu = jdbcTemplate.queryForObject(
            "SELECT CPU_USED FROM V$INSTANCE WHERE INSTANCE_NAME = 'PRIMARY'",
            Double.class
        );

        // 查看备库负载
        List&lt;Double&gt; standbyCpus = jdbcTemplate.queryForList(
            "SELECT CPU_USED FROM V$INSTANCE WHERE INSTANCE_NAME != 'PRIMARY'",
            Double.class
        );

        System.out.println("主库 CPU: " + primaryCpu + "%");
        System.out.println("备库平均 CPU: " + standbyCpus.stream()
            .mapToDouble(d -> d).average().orElse(0) + "%");
    }
}
```

## 读写分离的适用场景

| 场景 | 推荐程度 | 说明 |
|-----|---------|------|
| 读多写少的业务 | ⭐⭐⭐⭐⭐ | 典型场景，效果最好 |
| 报表查询 | ⭐⭐⭐⭐ | 复杂查询放到备库 |
| 用户中心 | ⭐⭐⭐ | 需要注意延迟问题 |
| 金融交易 | ⭐⭐ | 实时性要求高，不建议 |
| 订单系统 | ⭐⭐ | 写入后立即查询的场景多 |

## 面试追问方向

- 读写分离集群和数据守护集群有什么区别？
- 如何解决主备同步延迟导致的数据不一致问题？
- 读写分离后，连接池应该如何配置？

---

## 一句话总结

读写分离是「分而治之」思想的体现：主库专心写，备库分摊读。但要记住，延迟是它的天敌，实时性要求高的场景要慎用。
