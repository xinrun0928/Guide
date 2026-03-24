# 数据同步任务：全量同步与增量同步方案

数据同步是分布式系统中最常见的场景之一。

你可能需要将业务数据库同步到 ES 做搜索，将 MySQL 同步到 ClickHouse 做分析，甚至将一个机房的数据同步到另一个机房。

今天聊聊两种同步方案：全量同步和增量同步。

## 全量同步

全量同步是**一次性将源数据全部复制到目标**。

```sql
-- 全量同步示例：同步用户表
INSERT INTO target_db.users SELECT * FROM source_db.users;
```

### 全量同步的优缺点

**优点：**
- 数据完整，不会遗漏
- 实现简单，不容易出错

**缺点：**
- 耗时长，大表可能需要几个小时
- 锁表时间长，影响生产
- 资源消耗大

### 全量同步的优化

1. **分批处理**：每次同步 10000 条，减少锁表时间
2. **限制时间窗口**：在业务低峰期执行
3. **读写分离**：读从库，不影响主库

```java
@Service
public class FullSyncService {

    private static final int BATCH_SIZE = 10000;

    public void syncUsers() {
        long maxId = userMapper.getMaxId();
        long currentId = 0;

        while (currentId < maxId) {
            List&lt;User&gt; users = userMapper.selectUsers(currentId, BATCH_SIZE);
            if (CollectionUtils.isEmpty(users)) {
                break;
            }

            targetUserMapper.batchInsert(users);

            currentId = users.get(users.size() - 1).getId();
            log.info("已同步 {} 条，最大 ID: {}", users.size(), currentId);
        }
    }
}
```

## 增量同步

增量同步是**只同步变更数据**。

### 增量同步的数据源

1. **时间戳**：业务表加 update_time 字段
2. **增量日志**：MySQL binlog
3. **CDC**：Change Data Capture（推荐）

### 时间戳方案

```sql
-- 每次同步时，记录上次同步的最大时间戳
SELECT * FROM orders
WHERE update_time > #{lastSyncTime}
  AND update_time <= NOW();
```

问题：
- 源表必须有 update_time 字段
- 删改的数据可能查不到（取决于 update_time 是否记录删改）

### Binlog 方案

用 Canal 解析 MySQL binlog 获取增量数据：

```java
@Service
public class BinlogSyncService {

    @Autowired
    private CanalConnector canalConnector;

    public void startSync() {
        canalConnector.connect();
        canalConnector.subscribe("database\\.orders");

        while (true) {
            Message message = canalConnector.get(100);
            for (ByteString rowData : message.getRawEntries()) {
                RowChange change = RowChange.parseFrom(rowData);
                processChange(change);
            }
        }
    }

    private void processChange(RowChange change) {
        switch (change.getEventType()) {
            case INSERT:
                handleInsert(change);
                break;
            case UPDATE:
                handleUpdate(change);
                break;
            case DELETE:
                handleDelete(change);
                break;
        }
    }
}
```

## 全量 + 增量组合

最佳实践是**定期全量 + 日常增量**。

```java
@Service
public class DataSyncScheduler {

    @Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨 3 点
    public void fullSync() {
        log.info("开始全量同步...");
        fullSyncService.syncUsers();
        fullSyncService.syncOrders();
    }

    @Scheduled(fixedRate = 60000)  // 每分钟
    public void incrementalSync() {
        incrementalSyncService.syncChanges();
    }
}
```

## 面试追问方向

- 如何保证增量同步不遗漏？（答：用 binlog position 记录同步点位，失败后从上次位置恢复）
- 增量同步延迟怎么处理？（答：用延迟队列补偿、消费监控）
- 如何处理数据冲突？（答：基于时间戳或版本号的 Last Write Wins）
- binlog 同步和 CDC 的区别？（答：binlog 是 MySQL 特有，CDC 是通用的数据捕获方案）

## 小结

数据同步的核心是**全量和增量的组合**：

1. **全量同步**：定期执行，保证数据完整
2. **增量同步**：实时或准实时同步，保证数据新鲜
3. **位点记录**：记录同步点位，支持断点续传
4. **冲突处理**：基于时间戳或版本号处理冲突

增量同步是现代数据架构的基础。
