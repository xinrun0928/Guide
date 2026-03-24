# 数据迁移：从其他数据库到达梦

你知道吗？

很多企业选择迁移到达梦数据库，最大的障碍不是技术，而是**不敢迁**。

「万一迁过去出问题怎么办？」「数据能不能完整迁移？」「应用代码要改多少？」

这些担忧都是合理的。但如果你了解迁移的方法和工具，这些问题都有解。

## 迁移前评估

### 兼容性评估

```sql
-- 查看达梦支持的 SQL 标准
SELECT * FROM V$VERSION;

-- 检查迁移兼容性
-- 1. 关键字冲突检测
SELECT * FROM system.DBA_KEYWORDS WHERE KEYWORD IN (
    'ORDER', 'GROUP', 'SELECT', 'INDEX', 'TABLE'
);

-- 2. 数据类型兼容性
SELECT 'VARCHAR2' AS source_type, 'VARCHAR' AS target_type
UNION ALL
SELECT 'NUMBER', 'DECIMAL' UNION ALL
SELECT 'DATE', 'TIMESTAMP';
```

```java
// 迁移评估工具
public class MigrationAssessment {

    public AssessmentReport assess(String sourceDbType) {
        AssessmentReport report = new AssessmentReport();

        // 1. 统计各类型对象数量
        report.setTableCount(countTables());
        report.setViewCount(countViews());
        report.setProcedureCount(countProcedures());
        report.setTriggerCount(countTriggers());

        // 2. 检测不兼容对象
        report.setIncompatibleObjects(detectIncompatibleObjects());

        // 3. 估算迁移工作量
        report.setEstimatedEffort(calculateEffort(report));

        return report;
    }

    private List&lt;String&gt; detectIncompatibleObjects() {
        List&lt;String&gt; issues = new ArrayList&lt;&gt;();

        // 检测不支持的数据类型
        issues.addAll(checkUnsupportedDataTypes());

        // 检测不兼容的 SQL 语法
        issues.addAll(checkIncompatibleSyntax());

        // 检测使用频率较高的特性
        issues.addAll(checkFrequentFeatures());

        return issues;
    }
}
```

## 迁移工具

### dexp/dimp：逻辑导出导入

```bash
# 从 MySQL 导出数据（使用 mysqldump）
mysqldump -u root -p --compatible=ansi --all-databases > dump.sql

# 到达梦执行导入
# 需要先转换语法
./disql SYSDBA/SYSDBA@localhost:5236
SQL> @dump.sql
```

### DMHS：实时同步迁移

适合大型数据库的在线迁移，源库不停服。

```ini
# DMHS 配置 - 源端（MySQL）
[service]
PORT = 5345

[database]
TYPE = MYSQL
HOST = 192.168.1.100
PORT = 3306
USER = root
PASSWORD = ******
DB_NAME = source_db

[capture]
THREAD = 4

[send]
TYPE = DMHS
HOST = 192.168.1.200
PORT = 5345
```

```ini
# DMHS 配置 - 目标端（达梦）
[service]
PORT = 5345

[database]
TYPE = DM8
HOST = 192.168.1.200
PORT = 5236
USER = SYSDBA
PASSWORD = ******
DB_NAME = target_db

[execute]
THREAD = 4
```

```bash
# 启动 DMHS 服务
./dmhs_server start

# 在源端执行同步
./dmhs_console
DMHS> start capture
DMHS> start send
```

## 语法转换

### 常见转换规则

| MySQL | 达梦 | 说明 |
|-------|------|------|
| AUTO_INCREMENT | AUTO_INCREMENT / IDENTITY | 自增主键 |
| VARCHAR(n) | VARCHAR(n) | 字符串类型 |
| TEXT | TEXT / CLOB | 大文本类型 |
| DATETIME | TIMESTAMP | 时间类型 |
| ENUM | CHECK约束 | 枚举类型 |
| SET | CHECK约束 | 集合类型 |

```sql
-- MySQL 建表语句
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2),
    status ENUM('pending', 'paid', 'cancelled'),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP
);

-- 转换为达梦
CREATE TABLE orders (
    id INT IDENTITY(1,1) PRIMARY KEY,
    order_no VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2),
    status VARCHAR(20) CHECK (status IN ('pending', 'paid', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);
```

```java
// 自动语法转换工具
public class SyntaxConverter {

    public String convert(String mysqlSql) {
        String result = mysqlSql;

        // AUTO_INCREMENT -> IDENTITY
        result = result.replaceAll(
            "AUTO_INCREMENT\\s*=\\s*(\\d+)\\s*PRIMARY KEY",
            "IDENTITY($1,1) PRIMARY KEY"
        );
        result = result.replaceAll(
            "AUTO_INCREMENT\\s+PRIMARY KEY",
            "IDENTITY(1,1) PRIMARY KEY"
        );

        // DATETIME -> TIMESTAMP
        result = result.replaceAll("DATETIME", "TIMESTAMP");

        // ON UPDATE CURRENT_TIMESTAMP
        result = result.replaceAll(
            "ON\\s+UPDATE\\s+CURRENT_TIMESTAMP",
            ""
        );

        // ENUM -> VARCHAR + CHECK
        result = convertEnum(result);

        return result;
    }
}
```

## 迁移流程

### 阶段一：准备

```bash
# 1. 创建目标数据库
./dminit path=/data/dmdbms db_name=DAMENG instance_name=DAMENG

# 2. 创建表结构
./dexp SYSDBA/SYSDBA@localhost:5236 FILE=schema.dmp ROWS=N

# 3. 验证表结构
./disql SYSDBA/SYSDBA@localhost:5236
SQL> SELECT COUNT(*) FROM USER_TABLES;
```

### 阶段二：数据迁移

```bash
# 方式一：dexp/dimp
# 导出
mysqldump --compatible=dm -u root -p db_name > data.sql

# 导入
./disql SYSDBA/SYSDBA@localhost:5236
SQL> @data.sql

# 方式二：DMHS 实时同步
# 配置并启动 DMHS 服务
```

### 阶段三：验证

```sql
-- 1. 验证数据完整性
SELECT
    'source' AS db,
    COUNT(*) AS row_count,
    MAX(created_at) AS max_date
FROM source_db.orders
UNION ALL
SELECT
    'target',
    COUNT(*),
    MAX(created_at)
FROM target_db.orders;

-- 2. 验证数据一致性
SELECT id, COUNT(*) FROM orders GROUP BY id HAVING COUNT(*) > 1;

-- 3. 验证聚合数据
SELECT
    SUM(amount) AS total_amount,
    COUNT(*) AS order_count,
    MAX(created_at) AS latest_order
FROM orders;
```

```java
// 迁移验证工具
public class MigrationValidator {

    public ValidationResult validate() {
        ValidationResult result = new ValidationResult();

        // 1. 表数量对比
        int sourceTables = countTables("source");
        int targetTables = countTables("target");
        result.setTableCountMatch(sourceTables == targetTables);

        // 2. 数据量对比
        Map&lt;String, Long&gt; sourceCounts = getRowCounts("source");
        Map&lt;String, Long&gt; targetCounts = getRowCounts("target");
        result.setDataCountsMatch(sourceCounts.equals(targetCounts));

        // 3. 抽样数据对比
        result.setDataAccuracy(validateSampleData());

        return result;
    }

    private double validateSampleData() {
        // 随机抽取 1000 条数据进行对比
        List&lt;Map&lt;String, Object&gt;&gt; sourceSample = getRandomSample("source", 1000);
        List&lt;Map&lt;String, Object&gt;&gt; targetSample = getRandomSample("target", 1000);

        int matchCount = 0;
        for (int i = 0; i < sourceSample.size(); i++) {
            if (sourceSample.get(i).equals(targetSample.get(i))) {
                matchCount++;
            }
        }

        return (double) matchCount / sourceSample.size();
    }
}
```

### 阶段四：应用切换

```java
// 应用切换：灰度发布策略
public class MigrationCutover {

    public void cutover() {
        // 1. 灰度切流：先切换 10% 流量到新数据库
        String sql = "UPDATE gateway_config SET db_weight = 10 " +
            "WHERE db_type = 'DM' AND env = 'prod'";
        jdbcTemplate.update(sql);

        // 2. 观察 1-2 天，无异常后逐步增加
        for (int weight : new int[]{30, 50, 80, 100}) {
            observeAndProceed(weight);
        }

        // 3. 100% 切换后，关闭源库
        shutdownSourceDb();
    }

    private void observeAndProceed(int targetWeight) {
        // 等待一段时间观察
        sleep(24 * 60 * 60 * 1000L);  // 24小时

        // 检查监控指标
        Map&lt;String, Object&gt; metrics = getDbMetrics();
        double errorRate = (double) metrics.get("error_rate");
        double latency = (double) metrics.get("avg_latency");

        if (errorRate < 0.01 && latency < 100) {
            updateDbWeight(targetWeight);
        } else {
            throw new RuntimeException("指标异常，回滚到上一个状态");
        }
    }
}
```

## 常见问题与解决

| 问题 | 解决方案 |
|-----|---------|
| 字符集差异 | 使用 UTF-8，迁移后验证乱码 |
| 精度丢失 | DECIMAL 类型指定精度 |
| 特殊字符 | 迁移前后做编码转换 |
| 索引丢失 | 迁移后重建所有索引 |
| 存储过程 | 手动转换或重写 |

## 面试追问方向

- 从 MySQL 迁移到达梦，最难的部分是什么？
- 如何保证迁移过程不停服？
- 迁移后如何验证数据一致性？

---

## 一句话总结

数据库迁移不是「搬家」，而是「乔迁」：准备工作要充分，迁移过程要平滑，验证环节要严格。掌握工具和方法，迁移没那么可怕。
