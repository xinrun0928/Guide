# SQL 执行计划分析：慢查询的克星

你有没有遇到过这种场景：

开发环境运行好好的 SQL，上到生产就变成了慢查询。数据库 CPU 飙升，接口超时，用户投诉。

很多人在这种情况下会选择「加索引」，但问题是：**你真的知道 SQL 为什么慢吗？**

不看执行计划就加索引，就像不看医生就乱吃药。

## 执行计划是什么？

执行计划（Explain Plan）是数据库执行 SQL 语句的具体步骤，包括：

- 以什么顺序访问表
- 使用哪些索引
- 数据扫描方式（索引扫描 vs 全表扫描）
- 表关联方式（嵌套循环 vs 哈希连接 vs 归并连接）

```sql
-- 查看执行计划
EXPLAIN SELECT * FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.order_date >= '2024-01-01'
AND c.region = '北京';

-- 或者使用更详细的格式
EXPLAIN FULL SELECT * FROM orders WHERE order_id = 12345;
```

## 解读执行计划

### 基本术语

| 术语 | 说明 |
|-----|------|
| TABLE SCAN | 全表扫描，扫描整张表 |
| INDEX SCAN | 索引扫描，使用索引定位数据 |
| INDEX RANGE SCAN | 索引范围扫描，范围查询 |
| NESTED LOOP | 嵌套循环连接 |
| HASH JOIN | 哈希连接 |
| SORT MERGE JOIN | 排序归并连接 |

### 示例分析

```sql
EXPLAIN SELECT * FROM orders WHERE customer_id = 1001;

-- 输出示例：
/*
QUERY PLAN
===============================================================
INDEX ADVISE: 需要索引
---------------------------------------------------------------
1) [OPEN]  TABLE: ORDERS
   TYPE: INDEX SCAN
   INDEX: IDX_CUSTOMER_ID
   RANGE: [EQ] customer_id = 1001
===============================================================
*/
```

```sql
-- 全表扫描的执行计划
EXPLAIN SELECT * FROM orders WHERE status = 'pending';

-- 输出示例（没有合适的索引）：
/*
QUERY PLAN
===============================================================
1) [OPEN]  TABLE: ORDERS
   TYPE: TABLE SCAN  -- 全表扫描，性能差
   CONDITION: status = 'pending'
   ROWS ESTIMATE: 1000000
===============================================================
*/
```

```java
// Java 中解析执行计划
public class ExplainPlanParser {

    public ExplainResult parsePlan(String explainOutput) {
        ExplainResult result = new ExplainResult();

        if (explainOutput.contains("TABLE SCAN")) {
            result.setScanType("FULL_TABLE_SCAN");
            result.setRiskLevel("HIGH");
        } else if (explainOutput.contains("INDEX SCAN")) {
            result.setScanType("INDEX_SCAN");
            result.setRiskLevel("LOW");
        }

        // 提取估算行数
        Pattern rowPattern = Pattern.compile("ROWS ESTIMATE: (\\d+)");
        Matcher matcher = rowPattern.matcher(explainOutput);
        if (matcher.find()) {
            result.setEstimatedRows(Long.parseLong(matcher.group(1)));
        }

        return result;
    }
}
```

## 常见问题与优化

### 问题一：全表扫描

```sql
-- 问题 SQL：没有索引，全表扫描
SELECT * FROM orders WHERE order_date >= '2024-01-01';

-- 优化方案：添加索引
CREATE INDEX idx_order_date ON orders(order_date);

-- 再次查看执行计划
EXPLAIN SELECT * FROM orders WHERE order_date >= '2024-01-01';
/*
1) [OPEN]  TABLE: ORDERS
   TYPE: INDEX SCAN
   INDEX: IDX_ORDER_DATE
   RANGE: [GE] order_date >= 2024-01-01
*/
```

### 问题二：索引失效

```sql
-- 索引列上使用函数，索引失效
SELECT * FROM orders WHERE YEAR(order_date) = 2024;
-- 执行计划：TABLE SCAN（因为索引列被函数包裹）

-- 改写 SQL
SELECT * FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01';

-- 或者创建函数索引
CREATE INDEX idx_year ON orders(YEAR(order_date));
```

```java
// Java 中检测索引失效
public class IndexInefficiencyDetector {

    public void detectAndAlert(String sql) {
        String explain = jdbcTemplate.queryForObject(
            "EXPLAIN " + sql, String.class);

        // 检测全表扫描
        if (explain.contains("TABLE SCAN") && explain.contains("FULL")) {
            sendAlert("SQL 存在全表扫描: " + sql);
        }

        // 检测索引列上使用函数
        if (Pattern.matches(".*YEAR\\(.*\\).*|.*SUBSTR\\(.*\\).*", sql)) {
            sendAlert("索引列使用函数，可能导致索引失效: " + sql);
        }
    }
}
```

### 问题三：嵌套循环连接（NL Join）

```sql
-- 嵌套循环连接：适合小表驱动大表
EXPLAIN SELECT * FROM orders o
JOIN customers c ON o.customer_id = c.id;
/*
1) [OPEN]  TABLE: ORDERS
   ...
   NESTED LOOP JOIN
   ...
*/
```

```java
// 选择正确的驱动表
public class JoinOptimization {

    // 错误：让大表做驱动表
    public void badJoin() {
        // orders 表有 1000万条，customers 表有 10万条
        // NL Join 时，如果 orders 在外层，需要扫描 1000万次
        String badSql = "SELECT * FROM orders o, customers c WHERE o.customer_id = c.id";
    }

    // 正确：让小表做驱动表
    public void goodJoin() {
        // 使用 HINT 指定驱动表
        String goodSql = "SELECT /*+ ORDERED */ * FROM customers c " +
            "JOIN orders o ON o.customer_id = c.id";
    }
}
```

### 问题四：排序操作

```sql
-- 未使用索引的排序（filesort）
EXPLAIN SELECT * FROM orders ORDER BY order_date DESC;
/*
...
SORT: order_date DESC
...
*/

-- 使用索引的排序
CREATE INDEX idx_order_date_desc ON orders(order_date DESC);

EXPLAIN SELECT * FROM orders ORDER BY order_date DESC;
/*
...
BY INDEX: IDX_ORDER_DATE_DESC
...
*/
```

## 执行计划分析实战

```java
// 完整的 SQL 分析工具
public class SqlAnalyzer {

    private JdbcTemplate jdbcTemplate;

    public AnalysisReport analyzeSql(String sql) {
        AnalysisReport report = new AnalysisReport();

        // 1. 获取执行计划
        String explainPlan = jdbcTemplate.queryForObject(
            "EXPLAIN " + sql, String.class);
        report.setExplainPlan(explainPlan);

        // 2. 解析执行计划
        report.setScanType(parseScanType(explainPlan));
        report.setRiskLevel(calculateRiskLevel(explainPlan));

        // 3. 检查索引使用情况
        report.setUsedIndexes(findUsedIndexes(explainPlan));
        report.setMissingIndexes(findMissingIndexes(sql));

        // 4. 估算成本
        report.setEstimatedCost(estimateCost(explainPlan));

        return report;
    }

    public void printReport(AnalysisReport report) {
        System.out.println("===== SQL 分析报告 =====");
        System.out.println("扫描方式: " + report.getScanType());
        System.out.println("风险等级: " + report.getRiskLevel());
        System.out.println("使用索引: " + report.getUsedIndexes());
        System.out.println("建议索引: " + report.getMissingIndexes());

        if (!report.getMissingIndexes().isEmpty()) {
            System.out.println("\n推荐创建以下索引:");
            for (String idx : report.getMissingIndexes()) {
                System.out.println("  CREATE INDEX " + idx + ";");
            }
        }
    }
}
```

## 常见 SQL 优化模式

| 问题模式 | 优化方案 |
|---------|---------|
| SELECT * | 只查询需要的字段 |
| LIKE '%xxx' | 使用全文索引或反转索引 |
| OR 条件 | 改写为 UNION 或 IN |
| NOT IN | 改写为 NOT EXISTS |
| COUNT(*) | 使用覆盖索引 |
| 子查询 | 改写为 JOIN |

```sql
-- 优化 SELECT *
SELECT order_id, order_date, amount FROM orders WHERE customer_id = 1;
-- 优于 SELECT * FROM orders WHERE customer_id = 1;

-- 优化 LIKE '%xxx'
-- 建立全文索引
CREATE CONTEXT INDEX idx_content ON articles(content);

-- 优化 OR 条件
SELECT * FROM orders WHERE status = 'paid'
UNION ALL
SELECT * FROM orders WHERE amount > 10000;
-- 优于 SELECT * FROM orders WHERE status = 'paid' OR amount > 10000;
```

## 面试追问方向

- 如何分析一个慢查询？有哪些关键指标？
- 什么时候适合用 Hint？什么时候不适合？
- 如何判断索引是否被正确使用？

---

## 一句话总结

执行计划是 SQL 优化的「透视镜」：不看执行计划就优化，就像蒙着眼睛打靶。学会分析执行计划，才能真正解决慢查询问题。
