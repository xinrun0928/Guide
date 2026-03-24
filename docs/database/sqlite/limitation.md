# SQLite 适用场景与局限性

说了这么多 SQLite 的原理和用法，是时候来点实在的了：

**什么时候用 SQLite？什么时候该换方案？**

---

## SQLite 的黄金使用场景

### 1. 移动端本地存储

这是 SQLite 最典型的应用场景。

- **聊天记录**：数据量大、查询频繁、离线可用
- **离线缓存**：减少网络请求，提升用户体验
- **本地配置**：轻量级、持久化、格式灵活

```java
// 一个典型的 App 本地缓存场景
public class LocalCache {
    private final AppDatabase db;

    public void cacheUserProfile(UserProfile profile) {
        // 直接存入 SQLite，下次打开 App 秒加载
        db.userDao().insert(profile);
    }

    public UserProfile getCachedProfile(long userId) {
        // 网络不可用时，从本地读取
        return db.userDao().findById(userId);
    }
}
```

### 2. 桌面应用数据存储

Electron、Qt、Tauri 等桌面应用，SQLite 是首选：

- 零部署：不需要用户安装数据库服务
- 单用户：天然符合桌面应用的使用模式
- 轻量级：安装包可以很小

### 3. 物联网与嵌入式

树莓派、Arduino、各种传感器——这些设备的存储空间极为有限：

- SQLite 可以小到几十 KB
- 可以存储在 SD 卡、闪存等介质上
- 支持事务，保证数据完整性

### 4. 数据分析 / 测试环境

```java
// 数据分析场景：直接用 JDBC 读取 SQLite 文件
public class DataAnalyzer {
    public void analyze(String dbPath) throws Exception {
        String url = "jdbc:sqlite:" + dbPath;

        try (Connection conn = DriverManager.getConnection(url)) {
            // 直接查询，不需要安装任何服务
            String sql = "SELECT category, COUNT(*), AVG(price) " +
                         "FROM products GROUP BY category";
            // 处理结果...
        }
    }
}
```

### 5. 小规模网站 / 博客

没错，SQLite 完全可以驱动小型网站：

- 日PV < 10万
- 单服务器部署
- 静态内容为主

Heroku、Cloudflare Pages 等平台都支持 SQLite 部署静态博客。

---

## SQLite 的力不从心

### 1. 高并发写入场景

**典型失败案例**：

- 多进程同时写入
- 高频写入（如日志系统）
- 需要实时数据同步

**信号**：你开始看到 `SQLITE_BUSY` 错误。

**替代方案**：PostgreSQL、MySQL、MongoDB

### 2. 多机器 / 多节点架构

**典型失败案例**：

- 微服务架构，每个服务独立数据库
- 需要跨机器数据访问
- 分布式事务需求

**信号**：你开始考虑「网络访问数据库」。

**替代方案**：MySQL、PostgreSQL、MongoDB Atlas

### 3. 海量数据

**典型失败案例**：

- 数据量超过 100 GB
- 需要分区、分表
- 复杂 OLAP 查询

**信号**：查询越来越慢，索引也救不了。

**替代方案**：ClickHouse、Apache Druid、TiDB

### 4. 超强写入吞吐量

**典型失败案例**：

- IoT 设备每秒产生百万条数据
- 实时流处理
- 时序数据场景

**替代方案**：InfluxDB、TimescaleDB、TDengine

---

## 决策矩阵：选还是不选？

| 维度 | SQLite ✅ | SQLite ❌ |
|-----|---------|----------|
| **用户规模** | 单用户、少量并发 | 大量并发写入 |
| **部署复杂度** | 越简单越好 | 需要集群 |
| **数据类型** | 结构化为主 | 文档、图等非结构化 |
| **数据量** | < 100 GB | > 100 GB |
| **网络** | 不需要远程访问 | 需要分布式访问 |
| **运维能力** | 不想运维 | 有专职 DBA |

---

## 如果要换，该换什么？

```java
// 从 SQLite 迁移的常见选择

// 1. MySQL/PostgreSQL
// 适合：Web 应用、需要网络访问、成熟生态
String mysqlUrl = "jdbc:mysql://localhost:3306/mydb";
String pgUrl = "jdbc:postgresql://localhost:5432/mydb";

// 2. MongoDB
// 适合：文档型数据、快速迭代、需要 schema 灵活性
MongoClient mongoClient = new MongoClient("localhost", 27017);
MongoDatabase database = mongoClient.getDatabase("mydb");

// 3. TiDB
// 适合：需要 MySQL 兼容 + 水平扩展
String tidbUrl = "jdbc:mysql://localhost:4000/mydb";

// 4. InfluxDB
// 适合：时序数据、监控、物联网
InfluxDB influxDB = InfluxDBFactory.connect("http://localhost:8086", "username", "password");
```

---

## 混合使用：SQLite + 云数据库

很多成熟的 App 采用「混合策略」：

```java
public class DataStrategy {
    // SQLite：本地缓存、高频读取
    private final SQLite localDb;

    // 云数据库：持久化、跨设备同步
    private final MySQL remoteDb;

    public UserProfile getUserProfile(long userId) {
        // 1. 先查本地缓存（快）
        UserProfile cached = localDb.findById(userId);
        if (cached != null) {
            return cached;
        }

        // 2. 本地没有，查远程
        UserProfile remote = remoteDb.findById(userId);
        if (remote != null) {
            // 3. 写入本地缓存
            localDb.insert(remote);
        }
        return remote;
    }
}
```

---

## 最后的话

SQLite 不是银弹，也不是垃圾。

它是嵌入式场景下的极致优化——用最小的代价，解决了最普遍的问题。

> "SQLite 不会赢得数据库战争，因为它根本不在战场上。"
> —— D. Richard Hipp（SQLite 作者）

知道它的边界，用在正确的地方，这就是最好的技术选型。

---

**面试追问方向**

- SQLite 的最大并发写入 QPS 能达到多少？（提示：取决于硬件，约 1000-10000 QPS）
- 如果要做一个「记录用户行为日志」的系统，SQLite 合适吗？（提示：不适合，高频写入会成瓶颈）

希望这份 SQLite 知识体系对你有帮助。如果还有其他问题，欢迎继续探索。
