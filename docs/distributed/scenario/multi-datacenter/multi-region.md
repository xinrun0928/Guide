# 异地多活架构：单元化部署与数据同步方案

同城双活可以应对机房级别的故障，但如果遇到了地震、洪水、城市级别的灾难呢？

同城双活解决不了这个问题。

你需要——**异地多活**。

## 异地多活的价值

想象一下这个场景：

2021 年 7 月，郑州遭遇特大暴雨。

如果你的系统只在郑州有同城双活，数据中心被淹没了，整个系统就瘫痪了。

但如果你的系统有异地多活——北京、上海、广州都有节点——任何一个城市瘫痪，其他城市继续服务。

这就是异地多活的核心价值：**应对城市级别的灾难**。

## 分层容灾架构

### 同城双活

- **延迟**：1-5ms
- **RPO**：接近 0
- **适用场景**：日常容灾

### 两地三中心

```
┌─────────────────────┐
│     北京同城双活       │
│  (主数据中心 A + B)   │
└─────────────────────┘
           │
           │ 异步复制
           ▼
┌─────────────────────┐
│     上海灾备中心       │
│  (数据恢复目标)       │
└─────────────────────┘
```

- **优势**：成本适中，可应对城市级别灾难
- **劣势**：RPO > 0，有数据丢失

### 异地多活

```
┌─────────┐    ┌─────────┐    ┌─────────┐
│  北京    │◀──▶│  上海    │◀──▶│  广州    │
│ (单元1) │    │ (单元2) │    │ (单元3) │
└─────────┘    └─────────┘    └─────────┘
```

- **优势**：每个城市都是独立的单元，任一城市可独立服务
- **劣势**：成本高，架构复杂

## 单元化（Cell-based Architecture）

异地多活的核心是**单元化**。

### 什么是单元？

单元（Cell）是一个**自包含的系统**，包含：

- 应用服务
- 数据库（或数据库分片）
- 缓存
- 消息队列

```
单元 1 (北京)：
├── 服务 A (3 副本)
├── 服务 B (3 副本)
├── 数据库 (北京节点)
└── Redis (北京节点)

单元 2 (上海)：
├── 服务 A (3 副本)
├── 服务 B (3 副本)
├── 数据库 (上海节点)
└── Redis (上海节点)
```

### 单元隔离

每个单元都是独立的：

1. **数据隔离**：单元的数据只在本单元
2. **流量隔离**：用户请求路由到特定单元
3. **故障隔离**：一个单元故障不影响其他单元

### 流量路由

用户如何路由到特定单元？

```java
// 路由规则：按用户 ID hash
public class UnitRouter {

    private static final int UNIT_COUNT = 3;

    public String route(Long userId) {
        int unitIndex = Math.abs(userId.hashCode() % UNIT_COUNT);
        return "unit-" + unitIndex;
    }
}

// 或者按地域路由
public class UnitRouter {

    public String route(String region) {
        switch (region) {
            case "华北": return "unit-1";  // 北京
            case "华东": return "unit-2";  // 上海
            case "华南": return "unit-3";  // 广州
            default: return "unit-1";
        }
    }
}
```

### 跨单元调用

同一个用户的数据可能分布在不同单元（但这种情况应该尽量避免）：

```java
// 跨单元调用（尽量避免）
public Order getOrder(Long userId, Long orderId) {
    // 获取用户的单元
    String userUnit = getUserUnit(userId);

    // 获取订单的单元
    String orderUnit = getOrderUnit(orderId);

    if (userUnit.equals(orderUnit)) {
        // 同单元，直接调用
        return localService.getOrder(orderId);
    } else {
        // 跨单元，通过网络调用
        return remoteCall(orderUnit, orderId);
    }
}
```

## 数据同步方案

### 单元内：强一致

每个单元内部使用分布式数据库（如 TiDB、Cassandra）保证强一致。

### 单元间：最终一致

单元之间的数据同步采用最终一致方案：

```java
// 单元间数据同步
public class UnitSyncService {

    // 用户信息变更时，同步到所有单元
    public void syncUser(User user) {
        // 写入本地单元
        localDb.save(user);

        // 异步同步到其他单元
        for (String unitId : otherUnits) {
            async.syncToUnit(unitId, "user", user);
        }
    }

    // 订单信息变更时，同步到用户的单元
    public void syncOrder(Order order) {
        // 获取用户所属单元
        String userUnit = getUserUnit(order.getUserId());

        // 写入本地单元
        localDb.save(order);

        // 同步到用户单元
        if (!isCurrentUnit(userUnit)) {
            async.syncToUnit(userUnit, "order", order);
        }
    }
}
```

### 数据同步工具

常用的同步工具：

1. **MySQL Binlog**：解析 MySQL 日志同步数据
2. **Canal**：阿里开源的 MySQL binlog 增量订阅组件
3. **Debezium**：支持多种数据库的 CDC 工具
4. **阿里云 DTS**：云厂商提供的数据传输服务

## 异地多活的挑战

### 数据冲突

两个单元同时修改同一数据怎么办？

```java
// 冲突场景：用户同时在北京和上海修改昵称
// 解决方案：最后写入胜出（Last Write Wins）

// 但更好的方案是避免冲突：
// - 用户数据按用户 ID 路由，同一用户只在一个单元
// - 跨用户数据避免同时修改
```

### 跨单元事务

分布式事务在异地多活下延迟很高：

```java
// 跨单元转账（高延迟场景）
public void transfer(Long fromUserId, Long toUserId, BigDecimal amount) {
    String fromUnit = getUserUnit(fromUserId);
    String toUnit = getUserUnit(toUserId);

    if (fromUnit.equals(toUnit)) {
        // 同单元，本地事务
        localDb.transaction(() -> {
            deduct(fromUserId, amount);
            add(toUserId, amount);
        });
    } else {
        // 跨单元，异步处理
        // 方案 1：TCC 事务
        // 方案 2： Saga 模式
        // 方案 3：接受最终一致
        asyncTransfer(fromUserId, toUserId, amount);
    }
}
```

### 成本问题

异地多活需要：

1. **多地机房**：带宽、租赁成本
2. **多套基础设施**：数据库、缓存、消息队列
3. **运维复杂度**：多套环境、监控、告警

## 面试追问方向

- 单元化架构的核心思想是什么？（答：每个单元自包含，数据和流量隔离）
- 如何保证单元间的数据一致性？（答：最终一致 + 冲突处理）
- 跨单元事务怎么处理？（答：TCC、Saga 或接受最终一致）
- 异地多活的成本如何控制？（答：按业务重要性分级，非核心业务先不做多活）

## 小结

异地多活是最高级别的容灾方案：

1. **单元化**：每个城市是独立的服务单元
2. **流量路由**：用户按规则路由到特定单元
3. **数据同步**：单元内强一致，单元间最终一致
4. **架构复杂**：数据冲突、跨单元事务、成本问题

异地多活不是所有系统都需要的。只有对可用性有极高要求（如金融、电商核心系统）的业务，才需要考虑异地多活。

在此之前，先把同城双活做好。
