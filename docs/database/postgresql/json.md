# PostgreSQL JSON/JSONB 数据类型与函数

想把订单的明细存成 JSON？

想查询 JSON 里的某个字段？

MySQL 的 JSON 支持很弱，PostgreSQL 呢？

今天，我们来聊聊 PostgreSQL 的 JSON/JSONB。

## JSON vs JSONB

### 区别

| 特性 | JSON | JSONB |
|------|------|-------|
| 存储格式 | 原始文本 | 二进制 |
| 保留空白 | 是 | 否 |
| 重复键 | 保留 | 保留（最后一个） |
| 查询性能 | 较慢 | 较快 |
| 支持索引 | 否 | 是 |
| 大小 | 较小 | 稍大 |

```sql
-- JSON：保留原始格式
SELECT '{"key": "value", "arr": [1, 2, 3]}'::JSON;

-- JSONB：存储为二进制，忽略空白
SELECT '{"key": "value", "arr": [1, 2, 3]}'::JSONB;
```

**建议**：大多数场景使用 JSONB，性能更好。

## JSON/JSONB 操作符

### 访问操作符

```sql
-- 表结构
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    order_data JSONB
);

INSERT INTO orders (order_data) VALUES (
    '{
        "customer": "Alice",
        "items": [
            {"product": "Book", "quantity": 2, "price": 29.99},
            {"product": "Pen", "quantity": 5, "price": 2.50}
        ],
        "shipping": {
            "address": "123 Main St",
            "city": "Beijing",
            "zip": "100000"
        }
    }'::JSONB
);

-- -> 操作符：返回 JSON 类型
SELECT order_data->>'customer' FROM orders;  -- 返回 TEXT
SELECT order_data->'customer' FROM orders;     -- 返回 JSON

-- ->> 操作符：返回 TEXT 类型
SELECT order_data->>'customer' FROM orders;  -- "Alice"

-- -> 嵌套访问
SELECT order_data->'shipping'->>'city' FROM orders;  -- "Beijing"
SELECT order_data->'items'->0->>'product' FROM orders;  -- "Book"

-- ->> 直接返回文本
SELECT order_data->'shipping'->>'address' FROM orders;  -- "123 Main St"
```

### 路径操作符

```sql
-- #> 操作符：获取嵌套路径（返回 JSON）
SELECT order_data#>ARRAY['shipping', 'city'] FROM orders;

-- #>> 操作符：获取嵌套路径（返回 TEXT）
SELECT order_data#>>ARRAY['shipping', 'city'] FROM orders;
```

### 包含操作符

```sql
-- @>：左包含右
SELECT order_data @> '{"customer": "Alice"}' FROM orders;  -- true

-- 检查数组包含
SELECT order_data @> '{"items": [{"product": "Book"}]}' FROM orders;  -- true

-- <@：右包含左
SELECT '{"customer": "Alice"}' <@ order_data FROM orders;  -- true

-- ?：键存在
SELECT order_data ? 'customer' FROM orders;  -- true
SELECT order_data ? 'phone' FROM orders;       -- false

-- ?|：任一键存在
SELECT order_data ?| ARRAY['customer', 'phone'] FROM orders;

-- ?&：所有键存在
SELECT order_data ?& ARRAY['customer', 'items'] FROM orders;
```

## JSON 函数

### 创建函数

```sql
-- to_json / to_jsonb：任意值转 JSON
SELECT to_json(row(1, 'Alice'));
SELECT to_jsonb(row(1, 'Alice'));

-- jsonb_build_object：构建对象
SELECT jsonb_build_object(
    'name', 'Alice',
    'age', 30,
    'email', 'alice@example.com'
);
-- 结果：{"name": "Alice", "age": 30, "email": "alice@example.com"}

-- jsonb_build_array：构建数组
SELECT jsonb_build_array(1, 2, 3, 4, 5);

-- jsonb_build_array/object 变参版本
SELECT jsonb_build_object('name', name, 'salary', salary)
FROM employees WHERE id = 1;
```

### 查询函数

```sql
-- jsonb_object_keys：获取对象的所有键
SELECT jsonb_object_keys(order_data->'shipping') FROM orders;
-- 结果：address, city, zip

-- jsonb_array_elements：将数组展开
SELECT value
FROM orders,
     jsonb_array_elements(order_data->'items');

-- jsonb_array_elements_text：展开为文本
SELECT value::TEXT
FROM orders,
     jsonb_array_elements_text(order_data->'items');
```

### 聚合函数

```sql
-- jsonb_agg：聚合为数组
SELECT jsonb_agg(name) FROM employees WHERE department = 'IT';
-- 结果：["Alice", "Bob", "Carol"]

-- jsonb_object_agg：聚合为对象
SELECT jsonb_object_agg(department, count)
FROM (SELECT department, COUNT(*) as count FROM employees GROUP BY department) d;

-- 示例：聚合员工信息
SELECT 
    department,
    jsonb_object_agg(name, salary) as employees
FROM employees
GROUP BY department;
```

### 修改函数

```sql
-- jsonb_set：设置值
SELECT jsonb_set(order_data, '{customer}', '"Bob"'::JSONB)
FROM orders;

-- jsonb_insert：插入值
SELECT jsonb_insert(
    order_data, 
    '{tags}', 
    '["electronics"]'::JSONB,
    true  -- true: 插入到末尾，false: 插入到开头
) FROM orders;

-- jsonb_concat：合并
SELECT order_data || '{"priority": "high"}'::JSONB FROM orders;

-- jsonb_delete_key：删除键
SELECT order_data - 'shipping' FROM orders;

-- jsonb_delete_path：删除路径
SELECT jsonb_delete_path(order_data, '{shipping, address}') FROM orders;
```

### 类型转换

```sql
-- jsonb_typeof：获取值的类型
SELECT jsonb_typeof(order_data->'customer') FROM orders;  -- string
SELECT jsonb_typeof(order_data->'items') FROM orders;      -- array
SELECT jsonb_typeof(order_data->'shipping') FROM orders;    -- object

-- ->> 配合 CAST 使用
SELECT (order_data->>'items')::JSON FROM orders;
```

## GIN 索引

### 为 JSONB 创建索引

```sql
-- 为整个 JSONB 创建 GIN 索引
CREATE INDEX idx_orders_data ON orders USING GIN (order_data);

-- 为 JSONB 中的特定路径创建索引
CREATE INDEX idx_orders_customer ON orders ((order_data->>'customer'));
CREATE INDEX idx_orders_items_product ON orders ((order_data->'items'->0->>'product'));

-- 创建表达式索引
CREATE INDEX idx_orders_shipping_city 
ON orders (((order_data->'shipping'->>'city')::TEXT));
```

### 使用索引查询

```sql
-- 查询包含特定键值
SELECT * FROM orders 
WHERE order_data @> '{"customer": "Alice"}';

-- 查询数组包含
SELECT * FROM orders 
WHERE order_data @> '{"items": [{"product": "Book"}]}';

-- 键存在检查
SELECT * FROM orders 
WHERE order_data ? 'shipping';

-- 效率对比
EXPLAIN SELECT * FROM orders WHERE order_data @> '{"customer": "Alice"}';
```

## 实际应用

### 场景一：动态属性

```sql
-- 产品表，支持动态属性
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    base_price NUMERIC(10,2),
    attributes JSONB DEFAULT '{}'
);

INSERT INTO products (name, base_price, attributes) VALUES
    ('Laptop', 5000, '{"color": "silver", "memory": "16GB", "storage": "512GB"}'),
    ('Phone', 3000, '{"color": "black", "memory": "8GB", "storage": "256GB"}');

-- 查询有银色属性的产品
SELECT * FROM products 
WHERE attributes @> '{"color": "silver"}';

-- 查询所有内存属性
SELECT id, name, attributes->>'memory' as memory
FROM products;
```

### 场景二：订单明细

```sql
-- 用 JSONB 存储订单明细
CREATE TABLE orders_v2 (
    id SERIAL PRIMARY KEY,
    customer_id BIGINT,
    order_date TIMESTAMPTZ DEFAULT NOW(),
    items JSONB,
    metadata JSONB DEFAULT '{}'
);

-- 插入订单
INSERT INTO orders_v2 (customer_id, items) VALUES
    (1, '[
        {"sku": "SKU001", "name": "Book", "qty": 2, "price": 29.99},
        {"sku": "SKU002", "name": "Pen", "qty": 5, "price": 2.50}
    ]');

-- 查询订单总金额
SELECT 
    id,
    SUM((item->>'price')::NUMERIC * (item->>'qty')::INTEGER) as total
FROM orders_v2,
     jsonb_array_elements(items) as item
GROUP BY id;

-- 查询购买了特定商品的所有订单
SELECT DISTINCT id
FROM orders_v2,
     jsonb_array_elements(items) as item
WHERE item->>'sku' = 'SKU001';
```

### 场景三：灵活的配置

```sql
-- 应用配置表
CREATE TABLE app_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(50) UNIQUE,
    config_value JSONB
);

INSERT INTO app_config (config_key, config_value) VALUES
    ('feature_flags', '{"new_ui": true, "beta_features": ["chat", "video"]}'),
    ('rate_limits', '{"api": 1000, "upload": 100}');

-- 查询功能开关
SELECT config_value->>'new_ui' as new_ui_enabled
FROM app_config
WHERE config_key = 'feature_flags';

-- 查询所有 beta 功能
SELECT jsonb_array_elements_text(config_value->'beta_features')
FROM app_config
WHERE config_key = 'feature_flags';
```

## Java 应用

### JPA JSONB 映射

```java
// 使用 Hibernate Types
@Entity
@Table(name = "orders")
@TypeDef(name = "jsonb", typeClass = JsonbType.class)
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "order_data", columnDefinition = "jsonb")
    @Type(type = "jsonb")
    private Map<String, Object> orderData;
}

// 使用 Jackson
@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "order_data", columnDefinition = "jsonb")
    @Convert(converter = JsonbConverter.class)
    private OrderData orderData;
}

@Converter
public class JsonbConverter implements AttributeConverter<Map<String, Object>, String> {
    private static final ObjectMapper mapper = new ObjectMapper();
    
    @Override
    public String convertToDatabaseColumn(Map<String, Object> attribute) {
        return attribute == null ? null : mapper.writeValueAsString(attribute);
    }
    
    @Override
    public Map<String, Object> convertToEntityAttribute(String dbData) {
        return dbData == null ? null : mapper.readValue(dbData, Map.class);
    }
}
```

### MyBatis JSONB 查询

```java
@Select("""
    SELECT 
        id,
        order_data->>'customer' as customer_name,
        order_data->'shipping'->>'city' as city
    FROM orders
    WHERE order_data @> '{"customer": #{customerName}}'
    """)
List<OrderDto> findByCustomer(@Param("customerName") String customerName);

@Insert("""
    INSERT INTO orders (order_data)
    VALUES (#{orderData}::JSONB)
    """)
@SelectKey(statement = "SELECT LASTVAL()", keyProperty = "id", 
           before = false, resultType = Long.class)
void insertOrder(Order order);
```

## JSONPath（PostgreSQL 14+）

```sql
-- PostgreSQL 14+ 支持 JSONPath
SELECT order_data.jsonb_path_query('$.customer') FROM orders;
SELECT order_data.jsonb_path_query_first('$.items[*].product') FROM orders;

-- JSONPath 查询语法
SELECT order_data.jsonb_path_query_array(
    '$.items[*] ? (@.price > 10)'
) FROM orders;

-- 带默认值的查询
SELECT order_data.jsonb_path_query_first(
    '$.notes',
    '"No notes"'  -- 默认值
) FROM orders;
```

## 面试高频问题

### Q1: JSON 和 JSONB 有什么区别？

**考察点**：JSON 类型理解

**参考答案**：
- JSON 存储为文本，JSONB 存储为二进制
- JSONB 忽略空白，保留最后一个重复键
- JSONB 查询更快，支持索引
- 大多数场景推荐使用 JSONB

### Q2: 如何为 JSONB 字段创建索引？

**考察点**：JSON 索引

**参考答案**：
- GIN 索引：`USING GIN (jsonb_column)`
- 表达式索引：`((jsonb_column->>'key')::type)`
- 路径索引：`((jsonb_column->'nested'->>'key'))`

### Q3: JSONB 支持哪些查询操作？

**考察点**：JSON 操作

**参考答案**：
- @>：包含
- ?：键存在
- ?|：任一键存在
- ?&：所有键存在
- -> / ->>：访问
- jsonb_array_elements：展开数组
- jsonb_object_keys：获取键列表

### Q4: JSONB 适合什么场景？

**考察点**：实际应用

**参考答案**：
1. 动态属性（schema-less）
2. 订单明细、日志
3. 配置信息
4. 半结构化数据
5. 避免多表 JOIN

## 总结

PostgreSQL JSON/JSONB 功能强大：

| 特性 | 说明 |
|------|------|
| JSON | 文本存储 |
| JSONB | 二进制存储，性能更好 |
| GIN 索引 | 加速 JSONB 查询 |
| 丰富的操作符 | @>、?、->、->> |
| 丰富的函数 | jsonb_set、jsonb_array_elements |

使用场景：
- 动态属性
- 半结构化数据
- 配置存储
- 避免多表 JOIN

PostgreSQL 的 JSON 支持，远比 MySQL 强大。
