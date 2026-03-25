# Spring Cloud 分布式事务，Seata AT 模式集成

> 下单扣库存，库存扣了但订单创建失败，数据不一致怎么办？
>
> 分布式事务，就是来解决这个问题的——要么全成功，要么全失败，没有中间状态。

---

## 从一个问题开始

假设有这样的业务场景：

```
┌─────────────────────────────────────────────────────────┐
│                    创建订单场景                            │
│                                                          │
│  用户下单                                                 │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │  1. 创建订单记录（订单服务）                        │   │
│  │  2. 扣减库存（商品服务）                           │   │
│  │  3. 扣减余额（账户服务）                           │   │
│  │  4. 发送消息通知（消息服务）                        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  问题：步骤 2 成功了，步骤 3 失败了                     │
│  结果：库存扣了，但订单没创建，数据不一致！               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**在单体架构中**，用本地事务就可以解决——一个数据库事务，All in or All out。

**在微服务架构中**，每个服务有自己的数据库，本地事务管不了了——这就要靠分布式事务。

---

## 分布式事务解决方案

### 常见方案对比

| 方案 | 一致性模型 | 性能 | 复杂度 | 适用场景 |
|---|---|---|---|---|
| 2PC/3PC | 强一致 | 低 | 高 | 对数据一致性要求极高的场景 |
| TCC | 最终一致 | 中 | 高 | 跨库操作、复杂业务 |
| **Seata AT** | **最终一致** | **高** | **低** | **业务无侵入、通用场景** |
| 本地消息表 | 最终一致 | 中 | 中 | 可接受代码侵入 |
| Saga | 最终一致 | 高 | 中 | 长流程业务 |

---

## Seata 简介

### 什么是 Seata

Seata（Simple Extensible Autonomous Transaction Architecture）是阿里巴巴开源的分布式事务解决方案：

```
┌─────────────────────────────────────────────────────────┐
│                    Seata 架构                           │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │              TC (Transaction Coordinator)          │   │
│  │              事务协调器（Seata Server）          │   │
│  └─────────────────────────────────────────────────┘   │
│              │                    │                      │
│              │                    │                      │
│              ▼                    ▼                      │
│  ┌───────────────────┐  ┌───────────────────┐          │
│  │   TM (Transaction Manager)                     │   │
│  │   事务管理器（业务服务）                        │   │
│  └─────────────────────────────────────────────┘     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 核心角色

| 角色 | 全称 | 说明 |
|---|---|---|
| TC | Transaction Coordinator | 事务协调器，维护全局事务的运行状态 |
| TM | Transaction Manager | 事务管理器，负责开启、提交、回滚全局事务 |
| RM | Resource Manager | 资源管理器，负责分支事务资源的执行 |

---

## AT 模式原理

### 工作流程

```
┌─────────────────────────────────────────────────────────┐
│                    Seata AT 模式                         │
│                                                          │
│  全局事务开启                                           │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Phase 1: 分支事务注册                           │   │
│  │                                                  │   │
│  │  TM → TC: 注册全局事务                          │   │
│  │  RM → TC: 注册分支事务，执行业务 SQL            │   │
│  │  RM → TC: 报告分支状态                          │   │
│  └─────────────────────────────────────────────────┘   │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Phase 2: 事务提交/回滚                         │   │
│  │                                                  │   │
│  │  TC → RM: 提交/回滚分支事务                     │   │
│  │  RM: 释放锁，更新状态                           │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 关键技术：Undo Log

Seata AT 模式通过 **Undo Log** 实现自动补偿：

```
┌─────────────────────────────────────────────────────────┐
│                    Undo Log 工作原理                       │
│                                                          │
│  分支事务执行前：                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  BEFORE: UPDATE account SET balance = 1000      │   │
│  │  AFTER:  UPDATE account SET balance = 900        │   │
│  │  UNDO LOG: UPDATE account SET balance = 1000     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  如果全局事务回滚：                                      │
│  → 执行 UNDO LOG，恢复到 BEFORE 状态                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 1. 部署 Seata Server

```bash
# 下载 Seata Server
wget https://github.com/seata/seata/releases/download/v1.7.0/seata-server-1.7.0.zip

# 解压并启动（单机模式）
cd seata/bin
./seata-server.sh -h 127.0.0.1 -p 8091 -m db
```

### 2. 创建 Seata 数据库表

```sql
CREATE DATABASE seata;

USE seata;

-- Seata Server 需要的表
CREATE TABLE global_table (
    xid VARCHAR(128) NOT NULL,
    transaction_id BIGINT,
    status INT NOT NULL,
    application_id VARCHAR(64),
    transaction_service_group VARCHAR(64),
    transaction_name VARCHAR(64),
    timeout INT,
    begin_time BIGINT,
    application_data VARCHAR(500),
    PRIMARY KEY (xid)
);

CREATE TABLE branch_table (
    branch_id BIGINT NOT NULL,
    xid VARCHAR(128) NOT NULL,
    transaction_id BIGINT,
    resource_group_id VARCHAR(32),
    resource_id VARCHAR(256),
    branch_type VARCHAR(16),
    status INT,
    client_id VARCHAR(64),
    application_data VARCHAR(500),
    PRIMARY KEY (branch_id),
    KEY idx_xid (xid)
);

CREATE TABLE lock_table (
    row_key VARCHAR(128) NOT NULL,
    xid VARCHAR(96),
    branch_id BIGINT,
    resource_id VARCHAR(256),
    table_name VARCHAR(32),
    pk VARCHAR(36),
    status INT,
    PRIMARY KEY (row_key)
);
```

### 3. 引入依赖

```xml
<dependencies>
    <!-- Seata Spring Boot Starter -->
    <dependency>
        <groupId>io.seata</groupId>
        <artifactId>seata-spring-boot-starter</artifactId>
        <version>1.7.0</version>
    </dependency>
    
    <!-- Nacos 注册中心 -->
    <dependency>
        <groupId>com.alibaba.cloud</groupId>
        <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
    </dependency>
    
    <!-- 数据库驱动 -->
    <dependency>
        <groupId>com.mysql</groupId>
        <artifactId>mysql-connector-java</artifactId>
    </dependency>
    
    <!-- MyBatis Plus -->
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-boot-starter</artifactId>
    </dependency>
</dependencies>
```

### 4. 配置文件

```yaml
spring:
  application:
    name: order-service
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848
  datasource:
    url: jdbc:mysql://localhost:3306/order_db?useUnicode=true&characterEncoding=utf8
    username: root
    password: root

# Seata 配置
seata:
  application-id: ${spring.application.name}
  tx-service-group: my-test-group
  service:
    vgroup-mapping:
      my-test-group: default
    enable-degrade: false
    grouplist:
      default: 127.0.0.1:8091
  registry:
    type: nacos
    nacos:
      server-addr: ${spring.cloud.nacos.discovery.server-addr}
  config:
    type: nacos
    nacos:
      server-addr: ${spring.cloud.nacos.discovery.server-addr}
```

### 5. 创建 Undo Log 表

每个业务库都需要创建 Undo Log 表：

```sql
CREATE TABLE `undo_log` (
    `id` bigint NOT NULL AUTO_INCREMENT,
    `branch_id` bigint NOT NULL,
    `xid` varchar(100) NOT NULL,
    `context` varchar(128) NOT NULL,
    `rollback_info` longtext NOT NULL,
    `log_status` int NOT NULL,
    `log_created` datetime NOT NULL,
    `log_modified` datetime NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `ux_undo_log` (`xid`,`branch_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8;
```

---

## 代码实现

### 全局事务注解

```java
@Service
@Slf4j
public class OrderService {
    
    @Autowired
    private OrderMapper orderMapper;
    
    @Autowired
    private ProductClient productClient;
    
    @Autowired
    private AccountClient accountClient;
    
    /**
     * 创建订单 - 全局事务
     * 所有操作要么全部成功，要么全部回滚
     */
    @GlobalTransactional(name = "createOrder", rollbackFor = Exception.class)
    public void createOrder(OrderDTO orderDTO) {
        log.info("开始创建订单...");
        
        // 1. 创建订单
        Order order = new Order();
        order.setId(System.currentTimeMillis());
        order.setUserId(orderDTO.getUserId());
        order.setProductId(orderDTO.getProductId());
        order.setAmount(orderDTO.getAmount());
        order.setStatus("CREATED");
        order.setCreateTime(new Date());
        orderMapper.insert(order);
        log.info("订单创建成功: {}", order.getId());
        
        // 2. 扣减库存
        try {
            productClient.deductStock(orderDTO.getProductId(), orderDTO.getQuantity());
            log.info("库存扣减成功");
        } catch (Exception e) {
            throw new RuntimeException("库存扣减失败");
        }
        
        // 3. 扣减余额
        try {
            accountClient.deductBalance(orderDTO.getUserId(), orderDTO.getAmount());
            log.info("余额扣减成功");
        } catch (Exception e) {
            throw new RuntimeException("余额扣减失败");
        }
        
        log.info("订单创建完成");
    }
}
```

### 开启全局事务扫描

```java
@SpringBootApplication
@EnableDiscoveryClient
@EnableFeignClients
@EnableAutoDataSourceProxy
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

### 配置数据源代理

```java
@Configuration
public class DataSourceConfig {
    
    /**
     * 需要使用 Seata 的数据源代理
     */
    @Bean
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource dataSource() {
        return new DruidDataSource();
    }
}
```

---

## AT 模式进阶

### TCC 模式对比

| 维度 | AT 模式 | TCC 模式 |
|---|---|---|
| 代码侵入 | 无侵入 | 需要编写 Try/Confirm/Cancel |
| 性能 | 高 | 中 |
| 适用场景 | 无特殊要求的业务 | 涉及非数据库操作 |
| 回滚粒度 | SQL 级别 | 业务级别 |

### AT + TCC 混用

```java
@Service
public class PaymentService {
    
    // AT 模式
    @GlobalTransactional
    public void createOrder(OrderDTO dto) {
        orderMapper.insert(dto);
    }
    
    // TCC 模式
    @GlobalTransactional
    public void payment(PaymentDTO dto) {
        paymentTccAction.prepare(null, dto);
    }
}

@Component
public class PaymentTccAction implements TCCAction {
    
    @Override
    public boolean prepare(BusinessActionContext context, PaymentDTO dto) {
        // 预留资源
        log.info("TCC Prepare: {}", dto);
        return true;
    }
    
    @Override
    public boolean commit(BusinessActionContext context) {
        // 确认执行
        log.info("TCC Commit: {}", context);
        return true;
    }
    
    @Override
    public boolean rollback(BusinessActionContext context) {
        // 回滚
        log.info("TCC Rollback: {}", context);
        return true;
    }
}
```

---

## 高可用部署

### Seata Server 集群

```
┌─────────────────────────────────────────────────────────┐
│                    Seata 高可用架构                        │
│                                                          │
│                    ┌─────────┐                           │
│                    │  VIP /  │                           │
│                    │  Nginx  │                           │
│                    └────┬────┘                           │
│                         │                                 │
│          ┌──────────────┼──────────────┐                │
│          │              │              │                  │
│          ▼              ▼              ▼                  │
│     ┌─────────┐   ┌─────────┐   ┌─────────┐           │
│     │ Seata 1 │◄─►│ Seata 2 │◄─►│ Seata 3 │           │
│     │  :8091  │   │  :8092  │   │  :8093  │           │
│     └─────────┘   └─────────┘   └─────────┘           │
│          │              │              │                  │
│          └──────────────┼──────────────┘                │
│                         │                                 │
│                         ▼                                 │
│               ┌─────────────────┐                         │
│               │     MySQL      │                         │
│               │   (DB 模式)    │                         │
│               └─────────────────┘                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 配置中心注册

```yaml
seata:
  registry:
    type: nacos
    nacos:
      server-addr: ${NACOS_HOST}:8848
      namespace: ${NACOS_NAMESPACE}
      group: SEATA_GROUP
      application: seata-server
  config:
    type: nacos
    nacos:
      server-addr: ${NACOS_HOST}:8848
      namespace: ${NACOS_NAMESPACE}
      group: SEATA_GROUP
```

---

## 常见问题

### Q：Seata AT 模式和传统 2PC 有什么区别？

A：传统 2PC 是**同步阻塞**的，全局事务期间所有资源都被锁定。Seata AT 模式是**异步执行**的，分支事务独立执行，通过 Undo Log 实现回滚，性能更高。

### Q：全局事务和本地事务可以混用吗？

A：可以。全局事务内的本地操作会自动纳入全局事务管理，不在全局事务内的本地操作不受影响。

### Q：分支事务失败了会怎样？

A：TM 会收到分支事务失败的反馈，然后通知 TC 发起全局回滚。所有分支事务通过 Undo Log 恢复到执行前状态。

### Q：Seata 如何保证隔离性？

A：通过全局锁实现。同一数据的全局事务不能并发执行，防止脏写。

---

## 面试高频问题

### Q：Seata AT 模式的原理是什么？

A：通过 **Undo Log** 记录数据变更前的镜像。分支事务执行时生成 Undo Log，全局事务提交时删除 Undo Log，全局事务回滚时通过 Undo Log 恢复数据。

### Q：Seata 和传统分布式事务有什么区别？

A：传统分布式事务（2PC）需要所有参与者在准备阶段锁定资源，性能差。Seata AT 模式分支事务直接执行业务 SQL，通过 Undo Log 实现回滚，**性能高，业务无侵入**。

### Q：Seata 如何解决分布式事务的一致性问题？

A：Seata 采用 **最终一致性** 模型。全局事务期间各分支事务独立执行，通过 TC 协调确保全局提交或全局回滚，最终达到一致状态。

### Q：Seata 的全局锁会不会导致性能问题？

A：Seata 的全局锁是**行级锁**，只在数据修改时加锁，锁定时间极短。相比 2PC 的表级锁，性能影响小很多。

---

## 总结

Seata AT 模式提供了轻量级的分布式事务解决方案：

1. **AT 模式**：业务无侵入，通过 Undo Log 自动补偿
2. **TCC 模式**：自定义 Confirm/Cancel，适合复杂场景
3. **高可用**：Seata Server 集群部署
4. **集成简单**：Spring Boot Starter，开箱即用

> 分布式事务是微服务架构的难题。Seata AT 模式用最低的成本，解决了这个难题。
