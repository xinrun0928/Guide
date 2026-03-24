# PostgreSQL 分页查询：OFFSET vs Keyset Cursor

10 万条数据，你要展示第 50 页，每页 20 条记录，怎么查？

大部分人会这样写：

```sql
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 1000;
```

看起来没问题。但当 OFFSET 是 100 万呢？1000 万呢？

今天，我们来聊聊 PostgreSQL 的分页查询，以及为什么 Keyset Cursor 比 OFFSET 高效得多。

## OFFSET 的问题

### OFFSET 是怎么工作的？

```sql
SELECT * FROM orders 
ORDER BY created_at DESC 
LIMIT 20 OFFSET 10000;
```

这条查询的执行过程：

```
1. 扫描全表（按 created_at 排序）
2. 跳过前 10000 条记录
3. 返回接下来的 20 条记录

数据库不知道"第 10001 条"在哪里，只能从第 1 条开始数。
```

当 OFFSET 很大时，数据库做了大量「无用功」：

| OFFSET | 扫描的行数 | 耗时（假设 100 万行） |
|--------|-----------|---------------------|
| 0 | 20 | ~10ms |
| 1000 | 1020 | ~15ms |
| 10000 | 10020 | ~50ms |
| 100000 | 100020 | ~500ms |
| 1000000 | 1000020 | ~5s |

OFFSET 越大，扫描的行数越多，性能越差。

### OFFSET 的另一个问题

在高并发系统中，使用 OFFSET 分页可能导致「错位」：

```
第 1 页：显示 id 1-20
用户 A 刚看完第 1 页

用户 B 删除了 id=5 的订单

用户 A 查看第 2 页：
SELECT * FROM orders LIMIT 20 OFFSET 20;  -- 显示 id 21-40

结果：id=5 永久消失，id=21 提前出现
```

这就是「幻读」在分页场景下的体现。

## Keyset Cursor（游标分页）

### 原理

Keyset Cursor（基于键的分页）不使用 OFFSET，而是记住上一页最后一条记录的位置：

```sql
-- 第 1 页
SELECT * FROM orders 
ORDER BY created_at DESC, id DESC 
LIMIT 20;

-- 假设返回的最后一条：created_at = '2026-03-15 10:00:00', id = 1000

-- 第 2 页：使用上一页的信息
SELECT * FROM orders 
WHERE (created_at, id) < ('2026-03-15 10:00:00', 1000)
ORDER BY created_at DESC, id DESC 
LIMIT 20;
```

### 为什么 Keyset Cursor 更快？

```
Keyset Cursor 的执行过程：

1. 定位到 created_at = '2026-03-15 10:00:00' 的位置（索引 O(log n)）
2. 从这个位置向后取 20 条

不管在第几页，查询时间都是稳定的 O(log n + 20)。
```

### 完整实现

```sql
-- 创建表和索引
CREATE TABLE articles (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(200),
    content TEXT,
    author_id INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 复合索引支持分页排序
CREATE INDEX idx_articles_created_at_id ON articles (created_at DESC, id DESC);
CREATE INDEX idx_articles_author_created ON articles (author_id, created_at DESC);

-- 第一页
SELECT * FROM articles 
ORDER BY created_at DESC, id DESC 
LIMIT 20;

-- 假设返回的最后一条：
-- created_at = '2026-03-20 15:30:00+08'
-- id = 9999

-- 第二页
SELECT * FROM articles 
WHERE (created_at, id) < ('2026-03-20 15:30:00+08', 9999)
ORDER BY created_at DESC, id DESC 
LIMIT 20;

-- 第三页（继续上一页的条件）
-- ...
```

### 处理复杂排序

如果有多列排序，需要组合所有排序列：

```sql
-- 多列排序分页
SELECT * FROM products
WHERE 
    (category, price, id) < ('electronics', 99.99, 100)
ORDER BY category ASC, price DESC, id DESC
LIMIT 20;
```

## Java 实现

### OFFSET 分页

```java
// MyBatis 实现
@Select("""
    SELECT * FROM orders 
    ORDER BY created_at DESC 
    LIMIT #{pageSize} OFFSET #{offset}
    """)
List<Order> findOrdersByOffset(
    @Param("offset") int offset, 
    @Param("pageSize") int pageSize
);

// 计算偏移量
int offset = (pageNumber - 1) * pageSize;
```

### Keyset Cursor 分页

```java
public class CursorPage {
    public String lastCreatedAt;  // 上一页最后一条的时间戳
    public Long lastId;            // 上一页最后一条的 ID
    
    // 是否有下一页
    public boolean hasNext() {
        return lastCreatedAt != null && lastId != null;
    }
}

public class OrderRepository {
    
    // Keyset 分页查询
    public List<Order> findByCursor(OrderCursor cursor, int pageSize) {
        if (cursor == null || !cursor.hasNext()) {
            // 第一页
            return jdbcTemplate.query("""
                SELECT * FROM orders 
                ORDER BY created_at DESC, id DESC 
                LIMIT ?
                """, (rs, rowNum) -> mapRow(rs), pageSize);
        }
        
        // 后续页面：使用游标
        return jdbcTemplate.query("""
            SELECT * FROM orders 
            WHERE (created_at, id) < (?, ?)
            ORDER BY created_at DESC, id DESC 
            LIMIT ?
            """, (rs, rowNum) -> mapRow(rs), 
            cursor.getLastCreatedAt(), cursor.getLastId(), pageSize);
    }
    
    // 构建下一页游标
    public OrderCursor buildCursor(List<Order> orders) {
        if (orders.isEmpty()) {
            return OrderCursor.empty();
        }
        Order last = orders.get(orders.size() - 1);
        return new OrderCursor(last.getCreatedAt(), last.getId());
    }
}
```

### REST API 设计

```java
// 返回结果包装
public class PagedResponse<T> {
    private List<T> content;
    private boolean hasNext;
    private String nextCursor;  // Base64 编码的游标
    
    public static <T> PagedResponse<T> of(List<T> content, boolean hasNext, String cursor) {
        PagedResponse<T> response = new PagedResponse<>();
        response.content = content;
        response.hasNext = hasNext;
        response.nextCursor = cursor;
        return response;
    }
}

// Controller
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    
    @GetMapping
    public PagedResponse<OrderDto> getOrders(
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        
        // 解码游标
        OrderCursor orderCursor = decodeCursor(cursor);
        
        // 查询
        List<Order> orders = orderRepository.findByCursor(orderCursor, size);
        
        // 判断是否有下一页（返回了满页）
        boolean hasNext = orders.size() == size;
        
        // 编码游标
        String nextCursor = hasNext 
            ? encodeCursor(orderRepository.buildCursor(orders)) 
            : null;
        
        return PagedResponse.of(orders, hasNext, nextCursor);
    }
}
```

## 滚动查询 vs 分页

### 滚动查询（Scrollable ResultSet）

JDBC 原生支持滚动，但效率不高：

```java
// 不推荐：使用 JDBC 滚动游标
Connection conn = dataSource.getConnection();
Statement stmt = conn.createStatement(
    ResultSet.TYPE_SCROLL_INSENSITIVE, 
    ResultSet.CONCUR_READ_ONLY
);

ResultSet rs = stmt.executeQuery("SELECT * FROM orders");
rs.absolute(500);  // 跳到第 500 行（需要扫描前面所有行）
```

### Keyset 的优势

```
滚动查询：O(n)，n = 目标位置
Keyset：O(log n + pageSize)
```

## 性能对比

### 测试数据

假设 `orders` 表有 1000 万条记录：

```sql
-- 创建测试表
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    customer_name VARCHAR(100),
    total_amount NUMERIC(10,2),
    status VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 插入 1000 万条测试数据
INSERT INTO orders (customer_name, total_amount, status, created_at)
SELECT 
    'Customer ' || generate_series,
    random() * 1000,
    (ARRAY['pending', 'processing', 'completed', 'cancelled'])[floor(random() * 4 + 1)],
    NOW() - (random() * 365 || ' days')::INTERVAL
FROM generate_series(1, 10000000);
```

### 查询性能对比

| 场景 | OFFSET 查询 | Keyset 查询 |
|------|------------|------------|
| 第 1 页 | 15ms | 15ms |
| 第 100 页（2000 条后） | 85ms | 16ms |
| 第 5000 页（10 万条后） | 420ms | 18ms |
| 第 25000 页（50 万条后） | 2.1s | 19ms |
| 第 50000 页（100 万条后） | 4.5s | 20ms |

## 何时用 OFFSET，何时用 Keyset

### OFFSET 适用场景

- 小表（万级以下）
- 用户不经常翻到很后面的页
- 需要跳转到任意页（比如「跳到第 N 页」功能）
- 管理后台，需要快速定位

### Keyset 适用场景

- 大表（百万级以上）
- 用户主要浏览前几页
- 无限滚动加载
- 数据一致性要求高（不允许中间插入/删除导致错位）

## 总页数的问题

Keyset 分页无法直接知道「总页数」或「当前是第几页」。

解决方案：

1. **不显示总页数**：现代 App 常见的「无限滚动」
2. **预计算总数**：
   ```sql
   SELECT COUNT(*) FROM orders;  -- 定期执行，缓存结果
   ```
3. **近似估算**：
   ```sql
   SELECT reltuples::BIGINT AS estimated_count 
   FROM pg_class 
   WHERE relname = 'orders';
   ```

## 面试高频问题

### Q1: 为什么 OFFSET 分页在大数据量下性能差？

**考察点**：数据库原理

**参考答案**：
- OFFSET 需要跳过前面的行，数据库不知道「直接跳到哪里」
- 即使有索引，也要从第一行开始数
- 跳过的行越多，扫描的行数越多
- 时间复杂度 O(n)，n = OFFSET + LIMIT

### Q2: Keyset Cursor 是怎么实现的？

**考察点**：分页优化

**参考答案**：
- 使用上一页返回的最后一条记录的值作为查询条件
- 利用索引定位，而不是逐行扫描
- 时间复杂度 O(log n + pageSize)，与 OFFSET 无关
- 需要组合所有排序列：(col1, col2, ...) < (val1, val2, ...)

### Q3: Keyset 分页有什么限制？

**考察点**：工程实践

**参考答案**：
- 无法跳转到任意页（如「第 N 页」）
- 无法显示总页数
- 不适合管理后台场景
- 需要处理好第一页和最后一页的边界

## 总结

| 特性 | OFFSET | Keyset Cursor |
|------|--------|---------------|
| 实现复杂度 | 简单 | 稍复杂 |
| 翻到后面页 | 慢 | 快 |
| 任意跳转 | 支持 | 不支持 |
| 总页数 | 可计算 | 需额外处理 |
| 数据一致性 | 可能错位 | 稳定 |
| 适用场景 | 小表、管理后台 | 大表、无限滚动 |

> 「分页」看似简单，但在大数据量下，选择错误的方法会让查询从毫秒级变成秒级。
