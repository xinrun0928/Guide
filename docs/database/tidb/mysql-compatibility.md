# TiDB 与 MySQL 兼容性

很多团队想迁移到 TiDB，但最担心的问题是：**我现有的代码、工具、经验还能用吗？**

答案：**能用，而且基本不用改。**

TiDB 的设计目标之一就是 **MySQL 兼容**。它兼容 MySQL 5.7 协议，支持大部分 MySQL 语法。这意味着——你的 JDBC 驱动、MyBatis、Navicat、DBeaver，插上就能用。

但「兼容」不等于「完全一致」，这里面有些门道。

## 兼容性概览

### 协议级兼容

```
MySQL 客户端 ←→ TiDB Server（MySQL Protocol）
       │
       ▼
   驱动层：MySQL Connector/J、MySQL Connector/Python...
   ORM层：MyBatis、Hibernate、Spring Data JPA...
```

TiDB 使用 MySQL 5.7 的协议协议，理论上任何 MySQL 客户端库都能直接连接。

### 语法级兼容

```java
// 你的 Java 代码，不用改
public class OrderDAO {
    // INSERT 语句，完全兼容
    public void insertOrder(Order order) {
        String sql = "INSERT INTO orders (id, user_id, amount) VALUES (?, ?, ?)";
        jdbcTemplate.update(sql, order.getId(), order.getUserId(), order.getAmount());
    }
    
    // UPDATE 语句，完全兼容
    public void updateOrder(long id, BigDecimal amount) {
        String sql = "UPDATE orders SET amount = ? WHERE id = ?";
        jdbcTemplate.update(sql, amount, id);
    }
    
    // SELECT 语句，完全兼容
    public Order findById(long id) {
        String sql = "SELECT * FROM orders WHERE id = ?";
        return jdbcTemplate.queryForObject(sql, new BeanPropertyRowMapper<>(Order.class), id);
    }
}
```

### 功能级兼容

| 功能 | TiDB | MySQL | 说明 |
|-----|------|-------|-----|
| CREATE/ALTER/DROP TABLE | ✅ | ✅ | 支持 |
| PRIMARY KEY、UNIQUE KEY | ✅ | ✅ | 支持 |
| 外键约束 | ⚠️ 部分 | ✅ | TiDB 外键有使用限制 |
| 事务（ACID） | ✅ | ✅ | 支持 |
| 存储过程 | ⚠️ 限制 | ✅ | 不支持复杂 SP |
| 触发器 | ⚠️ 限制 | ✅ | 功能有限 |
| 视图 | ✅ | ✅ | 支持 |
| 预处理语句 | ✅ | ✅ | 支持 |
| 字符集 | ✅ | ✅ | UTF8MB4 完全支持 |

## 数据类型兼容

TiDB 支持所有主流 MySQL 数据类型：

```sql
CREATE TABLE user_profile (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100),
    age INT,
    balance DECIMAL(10, 2),
    created_at DATETIME,
    is_active TINYINT(1) DEFAULT 1,
    profile JSON                    -- TiDB 扩展
);

-- JSON 类型是 TiDB 对 MySQL 的扩展
INSERT INTO user_profile (username, profile) VALUES 
('alice', '{"bio": "developer", "city": "Beijing"}');
```

## 迁移方案：从 MySQL 到 TiDB

### 方案一：全量迁移 + 增量同步

这是最常用的迁移方式，适合数据量较大、停机窗口有限的场景。

```
MySQL ──► Dumpling（导出）──► Loader/BR（导入）──► TiDB
                │                                        ▲
                └────────► DM（增量同步）────────────────┘
```

**步骤：**

1. 使用 Dumpling 导出全量数据
2. 使用 Loader 或 BR 导入 TiDB
3. 配置 DM 进行增量同步
4. 业务切读流量
5. 业务切写流量
6. 停止 DM，完成迁移

```bash
# 1. 导出 MySQL 数据
./dumpling -h 192.168.1.100 -P 3306 -u root -p123456 \
    -B myapp -t 8 -F 256MB -o /data/backup/

# 2. 导入 TiDB
./loader -h 192.168.1.200 -u root -p123456 \
    -d myapp -t 8 -d /data/backup/

# 3. 配置 DM 增量同步
# 编辑 task.yaml
cat > task.yaml <<EOF
name: myapp-sync
task-mode: all
is-sharding: false

mysql-instances:
  - source-id: mysql-source
    block-allow-list: "*"

tidb-instances:
  - host: "192.168.1.200"
    port: 4000
    user: root
    password: "123456"

syncers:
  sync-diff-inspector:
    chunk-size: 1000
    worker-count: 4
EOF
```

### 方案二：双写双读（灰度切换）

适合对可用性要求极高的场景，迁移过程零停机。

```
MySQL ←─────────────────────── TiDB
  │                              ▲
  │    写   ←  灰度切流量  ←  写  │
  │                              │
  └─────────── 读 ───────────────┘
```

业务逻辑：
1. 老系统写 MySQL，读 MySQL
2. 开启双写：同时写 MySQL 和 TiDB
3. 灰度切读：从 TiDB 读取非关键请求
4. 逐步扩大 TiDB 读取比例
5. 全部切换后，停止双写

```java
// 双写示例代码
public class OrderService {
    @Autowired
    private OrderMapper mysqlMapper;
    
    @Autowired
    private OrderMapper tidbMapper;  // 指向 TiDB
    
    @Transactional
    public void createOrder(Order order) {
        // 双写：保证数据一致性
        mysqlMapper.insert(order);
        
        try {
            tidbMapper.insert(order);
        } catch (Exception e) {
            // TiDB 写入失败，记录日志，后续补偿
            log.error("TiDB write failed, orderId={}", order.getId(), e);
            retryQueue.add(order);  // 进入重试队列
        }
    }
}
```

### 方案三：业务层代理（透明切换）

适合不想修改代码的场景，通过数据库中间件实现透明切换。

```
应用 → Proxy → MySQL
       ↓
    TiDB（读副本）
```

## 兼容性限制与注意事项

### 不支持的特性

| 特性 | 说明 | 替代方案 |
|-----|------|---------|
| 存储过程内的 COMMIT | TiDB 不支持在存储过程内提交事务 | 移除存储过程，或使用应用事务 |
| 批量插入的自增 ID | TiDB 批量插入可能不连续 | 业务层处理 ID 不连续 |
| 外键约束的级联操作 | 外键约束有限制 | 应用层实现级联逻辑 |
| SELECT HIGH_PRIORITY | TiDB 不支持 | 移除或使用其他方式 |
| 全文索引 | TiDB 不支持 | 使用 TiDB 的模糊查询或第三方搜索引擎 |

### 行为差异

| 场景 | MySQL | TiDB | 处理方式 |
|-----|-------|------|---------|
| AUTO_INCREMENT | 连续自增 | 可能跳跃（分布式 ID） | 使用 Snowflake 或 TiDB AUTO_RANDOM |
| TIMESTAMP | 时区敏感 | UTC 存储 | 统一用 DATETIME 或 TIMESTAMP |
| 锁粒度 | 行级锁 | 范围锁 | 减少大事务，避免长事务 |
| 无主键表 | 允许 | 不推荐 | 必须有主键或唯一索引 |

### AUTO_RANDOM：分布式场景的替代方案

MySQL 的自增主键在分布式环境下有问题——多个节点同时插入时，需要全局协调。TiDB 提供了 AUTO_RANDOM 作为替代：

```sql
-- 使用 AUTO_RANDOM，TiDB 自动分配全局唯一 ID
-- 适用于分片键，避免写入热点
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_RANDOM,  -- TiDB 扩展
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL
);

-- 批量插入时，ID 自动分配，无需获取自增锁
INSERT INTO orders (user_id, amount) VALUES (1, 100), (1, 200), (2, 300);
```

## 面试追问

**Q: 如何保证从 MySQL 到 TiDB 迁移的数据一致性？**

主要靠 DM（Data Migration）工具的增量同步 + sync-diff-inspector 数据校验。关键点：
1. 选择低峰期进行全量迁移
2. 增量同步期间记录 Binlog 位点
3. 迁移完成后进行数据一致性校验
4. 切读、切写操作要有回滚预案

**Q: TiDB 的 AUTO_RANDOM 和 MySQL 的 AUTO_INCREMENT 哪个更好？**

取决于场景：
- 单机 MySQL 迁移：优先用 AUTO_INCREMENT（兼容性好）
- 分片场景或高并发写入：使用 AUTO_RANDOM（避免热点）

**Q: TiDB 支持 MySQL 的分区表吗？**

TiDB 支持 Range、List、Hash 分区，但在使用上有限制（如分区表的主键必须是分区键的子集）。建议先在测试环境验证业务 SQL。

---

## 总结

TiDB 的 MySQL 兼容性做得相当到位，大多数业务可以直接迁移，代码改动极小。

但迁移前务必注意：
1. 了解不支持的特性清单
2. 选择合适的迁移方案（全量+增量 vs 双写）
3. 做好数据一致性校验
4. 预留回滚窗口

迁移成功后的 TiDB，能带给你 MySQL 无法提供的水平扩展能力，同时保留你积累的所有 MySQL 经验。
