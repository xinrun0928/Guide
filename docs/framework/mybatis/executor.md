# Executor：SQL 执行器的三种形态

想象一个餐厅后厨的场景：

- **SimpleExecutor**：来了一个订单，厨师就洗一次锅。不管后面有多少订单，都是「来了就干，干完就洗」。
- **ReuseExecutor**：厨师发现有些菜（SQL）之前做过了，锅先不洗，等菜谱（PreparedStatement）一起复用。
- **BatchExecutor**：先把所有订单都收齐，然后一起炒——效率最高，但上菜顺序可能不太确定。

这三种厨师，就是 MyBatis 三种 Executor 的化身。

## Executor 在架构中的位置

```
┌────────────────────────────────────────────────────────────┐
│                        SqlSession                           │
│                            │                                │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    Executor                           │  │
│  │    ┌─────────────┬──────────────┬─────────────┐     │  │
│  │    │   Simple    │    Reuse     │   Batch    │     │  │
│  │    │  Executor   │   Executor   │  Executor  │     │  │
│  │    └─────────────┴──────────────┴─────────────┘     │  │
│  │                         │                             │  │
│  │                         ▼                             │  │
│  │    ┌─────────────────────────────────────────────┐   │  │
│  │    │             CachingExecutor                   │   │  │
│  │    │    （装饰器模式：在一级缓存基础上加二级缓存）   │   │  │
│  │    └─────────────────────────────────────────────┘   │  │
│  └─────────────────────────┬────────────────────────────┘  │
│                            │                                │
│                            ▼                                │
│                   StatementHandler                          │
└────────────────────────────────────────────────────────────┘
```

## 三种 Executor 详解

### 1. SimpleExecutor：最简单直接

```java
public class SimpleExecutor extends BaseExecutor {
    @Override
    public <E> List<E> doQuery(MappedStatement ms, Object parameter,
                                RowBounds rowBounds, ResultHandler resultHandler,
                                BoundSql boundSql) {
        Statement stmt = null;
        try {
            // 1. 获取配置
            Configuration configuration = ms.getConfiguration();
            // 2. 创建 StatementHandler
            StatementHandler handler = configuration.newStatementHandler(
                this, ms, parameter, rowBounds, resultHandler, boundSql);
            // 3. 预编译 SQL
            stmt = prepareStatement(handler, ms.getStatementType());
            // 4. 执行查询
            return handler.query(stmt, resultHandler);
        } finally {
            // 5. 关闭 Statement
            closeStatement(stmt);
        }
    }

    private Statement prepareStatement(StatementHandler handler, String statementType) {
        Connection connection = getConnection(ms.getStatementType(), transaction);
        // 每次都创建新的 PreparedStatement
        return handler.prepare(connection);
    }
}
```

**特点**：每次查询都创建新的 PreparedStatement，简单直接，但效率不是最优。

### 2. ReuseExecutor：复用预编译语句

```java
public class ReuseExecutor extends BaseExecutor {
    // 缓存 PreparedStatement，key 是 SQL 语句
    private final Map<String, PreparedStatement> statementMap = new HashMap<>();

    @Override
    public <E> List<E> doQuery(MappedStatement ms, Object parameter,
                                RowBounds rowBounds, ResultHandler resultHandler,
                                BoundSql boundSql) {
        BoundSql boundSql = ms.getBoundSql(parameter);
        // 用 SQL 作为缓存的 key
        String sql = boundSql.getSql();
        PreparedStatement stmt;

        if (statementMap.containsKey(sql)) {
            // 命中缓存，复用已有的 PreparedStatement
            stmt = statementMap.get(sql);
            // 需要重新绑定参数
            parameterize(stmt);
        } else {
            // 未命中，创建新的并缓存
            Connection connection = getConnection(ms.getStatementType(), transaction);
            StatementHandler handler = configuration.newStatementHandler(...);
            stmt = handler.prepare(connection);
            statementMap.put(sql, stmt);
        }
        return handler.query(stmt, resultHandler);
    }

    @Override
    public void doFlushStatements(boolean commit) {
        // 清理缓存的 Statement
        for (PreparedStatement stmt : statementMap.values()) {
            closeStatement(stmt);
        }
        statementMap.clear();
    }
}
```

**特点**：用 SQL 语句作为 key 缓存 PreparedStatement，避免重复编译。适合执行相同 SQL 多次的场景。

### 3. BatchExecutor：批量执行的利器

```java
public class BatchExecutor extends BaseExecutor {
    // 缓存批量语句
    private final List<Statement> statementList = new ArrayList<>();
    private final List<BatchResult> batchResults = new ArrayList<>();

    @Override
    public <E> List<E> doQuery(MappedStatement ms, Object parameter,
                                RowBounds rowBounds, ResultHandler resultHandler,
                                BoundSql boundSql, Statement statement) {
        // BatchExecutor 不做查询优化，需要单独执行
        Statement stmt = null;
        try {
            // 创建独立的 Statement 来执行查询
            Connection connection = getConnection(ms.getStatementType(), transaction);
            StatementHandler handler = configuration.newStatementHandler(...);
            stmt = handler.prepare(connection);
            return handler.query(stmt, resultHandler);
        } finally {
            closeStatement(stmt);
        }
    }

    @Override
    public int doUpdate(MappedStatement ms, Object parameter) throws SQLException {
        BoundSql boundSql = ms.getBoundSql(parameter);
        String sql = boundSql.getSql();
        Statement stmt;

        if (statementList.isEmpty() || !sql.equals(currentSql)) {
            // 新 SQL，创建新的 Statement
            stmt = getConnection(ms.getStatementType(), transaction)
                .prepareStatement(sql);
            statementList.add(stmt);
            currentSql = sql;
        } else {
            // 复用已有的 Statement
            stmt = statementList.get(statementList.size() - 1);
        }
        // 设置参数
        parameterize(stmt, ms, parameter, boundSql);
        // 添加到批处理队列
        stmt.addBatch();
        return BATCH_UPDATE_RETURN_VALUE;
    }

    @Override
    public void doFlushStatements(boolean commit) throws SQLException {
        for (Statement stmt : statementList) {
            stmt.executeBatch();
            if (commit) {
                stmt.getConnection().commit();
            }
        }
    }
}
```

**特点**：把多条 SQL 添加到批处理队列，最后一次性执行。适合批量插入、更新场景。

## 执行器选择策略

### 配置方式

```xml
<!-- mybatis-config.xml -->
<settings>
    <!-- SIMPLE | REUSE | BATCH -->
    <setting name="defaultExecutorType" value="REUSE"/>
</settings>
```

### Spring Boot 配置

```yaml
mybatis:
  executor-type: REUSE
```

### 不同场景的选择

| 场景 | 推荐执行器 | 原因 |
|-----|-----------|------|
| 低并发、简单查询 | Simple | 简单直接，无额外开销 |
| 高并发、重复 SQL 多 | Reuse | 减少 SQL 预编译开销 |
| 批量插入/更新 | Batch | 显著减少数据库交互次数 |
| 混合场景 | Simple + 二级缓存 | 默认配置 |

## BaseExecutor：公共逻辑抽离

三种 Executor 都继承自 `BaseExecutor`，它处理公共逻辑：

```java
public abstract class BaseExecutor implements Executor {
    // 一级缓存
    protected PerpetualCache transactionalCache;

    @Override
    public <E> List<E> query(MappedStatement ms, Object parameter,
                             RowBounds rowBounds, ResultHandler resultHandler,
                             BoundSql boundSql) {
        // 1. 检查缓存
        if (ms.isUseCache()) {
            List<E> cached = listFromCache(boundSql);
            if (cached != null) {
                return cached;
            }
        }

        // 2. 调用子类的 doQuery 方法
        List<E> list = doQuery(ms, parameter, rowBounds, resultHandler, boundSql);

        // 3. 放入缓存
        if (ms.isUseCache()) {
            putCache(boundSql, list);
        }
        return list;
    }

    @Override
    public void close(boolean forceRollback) {
        if (forceRollback) {
            // 回滚事务
        } else {
            // 提交事务
        }
        // 关闭所有 Statement
    }
}
```

## CachingExecutor：缓存装饰器

```java
public class CachingExecutor implements Executor {
    private final Executor delegate;

    // 在其他 Executor 基础上增加二级缓存支持
    @Override
    public <E> List<E> query(MappedStatement ms, Object parameter,
                             RowBounds rowBounds, ResultHandler resultHandler,
                             BoundSql boundSql, Cache cache) {
        // 1. 先查二级缓存
        if (cache != null) {
            List<E> cached = cache.getObject(boundSql.getSql());
            if (cached != null) {
                return cached;
            }
        }

        // 2. 委托给被包装的 Executor（如 SimpleExecutor）
        List<E> list = delegate.query(ms, parameter, rowBounds,
                                       resultHandler, boundSql);

        // 3. 放入二级缓存
        if (cache != null) {
            cache.putObject(boundSql.getSql(), list);
        }
        return list;
    }
}
```

> **设计模式**：CachingExecutor 使用了**装饰器模式**，在原有 Executor 基础上透明地增加了缓存能力。

## 性能对比

### 简单查询场景（1000 次相同查询）

| 执行器 | SQL 编译次数 | 性能 |
|-------|-------------|------|
| Simple | 1000 | 最慢 |
| Reuse | 1 | 最优 |
| Batch | N/A（不支持单条查询） | - |

### 批量插入场景（1000 条数据）

| 执行器 | 数据库交互次数 | 性能 |
|-------|-------------|------|
| Simple | 1000 | 最慢 |
| Reuse | 1000 | 较慢 |
| Batch | 1 | 最优 |

## 面试高频问题

### Q1：三种 Executor 的区别是什么？

- **SimpleExecutor**：每次查询都创建新的 PreparedStatement，最简单
- **ReuseExecutor**：复用 PreparedStatement，减少编译次数
- **BatchExecutor**：批量执行 SQL，减少网络往返次数

### Q2：MyBatis 默认使用的是哪种 Executor？

**SimpleExecutor**。

### Q3：BatchExecutor 可以用于 SELECT 查询吗？

**不推荐**。BatchExecutor 的 `doQuery` 方法实际上会创建单独的 Statement，没有批量优势。批量执行器主要用于 INSERT、UPDATE、DELETE 操作。

---

## 思考题

如果我在一个事务中，先执行了 10 次 INSERT，再执行 1 次 SELECT，应该用哪种执行器？

答案：**应该用 BatchExecutor 处理 INSERT**，但问题在于 BatchExecutor 不擅长 SELECT。

实际项目中，这种混合场景可以用 `SqlSession` 的批量模式：

```java
try (SqlSession session = sqlSessionFactory.openSession(ExecutorType.BATCH)) {
    UserMapper mapper = session.getMapper(UserMapper.class);
    for (int i = 0; i < 1000; i++) {
        mapper.insert(users.get(i));
    }
    session.flushStatements(); // 发送批量 SQL
    // 如果需要查询，可以临时用 SimpleExecutor
}
```

但更好的做法是使用存储过程或分批提交。

下一节，我们看 [StatementHandler](/framework/mybatis/statement-handler) 的细节。
