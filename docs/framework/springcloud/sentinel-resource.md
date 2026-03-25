# Sentinel @SentinelResource 与热点参数限流

> 你有没有遇到过这种情况：某个接口的热点参数（如商品 ID）访问量巨大，但其他参数正常？
>
> Sentinel 的热点参数限流，就是来解决这个问题的——它能对参数值进行精细化控制。

---

## @SentinelResource 详解

### 基本用法

```java
@RestController
@RequestMapping("/product")
public class ProductController {
    
    @GetMapping("/{id}")
    @SentinelResource(value = "getProduct")
    public Result&lt;Product&gt; getProduct(@PathVariable Long id) {
        return Result.ok(productService.getById(id));
    }
}
```

**注意**：@SentinelResource 需要配合 Sentinel Core 使用，且资源名（value）是唯一的标识。

### 完整属性

```java
@SentinelResource(
    value = "getProduct",           // 资源名（必填）
    blockHandler = "getProductBlock",  // BlockException 处理方法
    blockHandlerClass = ProductController.class,  // BlockHandler 所在类
    fallback = "getProductFallback",    // 业务异常处理方法
    fallbackClass = ProductController.class,  // Fallback 所在类
    defaultFallback = "defaultFallback", // 默认 Fallback
    exceptionsToIgnore = {RuntimeException.class},  // 忽略的异常
    entryType = EntryType.IN  // IN=入站流量，OUT=出站流量
)
```

### 资源命名建议

| 命名方式 | 示例 | 特点 |
|---|---|---|
| 接口路径 | `/product/{id}` | 简单直观 |
| 方法名 | `getProduct` | 简洁 |
| 自定义 | `product-api-get` | 灵活，可加版本号 |

---

## BlockHandler vs Fallback

### 区别

```
┌─────────────────────────────────────────────────────────┐
│                    异常处理分工                           │
│                                                          │
│  BlockException          Throwable                       │
│       │                       │                         │
│       ▼                       ▼                         │
│  ┌───────────┐          ┌───────────┐                  │
│  │ 限流/熔断  │          │ 业务异常  │                  │
│  │ 触发时调用 │          │ 触发时调用│                  │
│  └───────────┘          └───────────┘                  │
│                                                          │
│  blockHandler            fallback                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 示例

```java
@RestController
@RequestMapping("/order")
public class OrderController {
    
    @GetMapping("/{id}")
    @SentinelResource(
        value = "getOrder",
        blockHandler = "getOrderBlock",
        fallback = "getOrderFallback"
    )
    public Result&lt;Order&gt; getOrder(@PathVariable Long id) {
        // 业务逻辑，可能抛出异常
        if (id < 0) {
            throw new IllegalArgumentException("订单 ID 不能为负数");
        }
        return Result.ok(orderService.getById(id));
    }
    
    // 限流/熔断时调用
    public Result&lt;Order&gt; getOrderBlock(Long id, BlockException e) {
        log.warn("限流触发: resource={}, blockType={}", 
            e.getRule().getResource(), e.getClass().getSimpleName());
        return Result.fail(429, "访问太频繁，请稍后再试");
    }
    
    // 业务异常时调用
    public Result&lt;Order&gt; getOrderFallback(Long id, Throwable e) {
        log.error("获取订单失败: id={}, error={}", id, e.getMessage());
        return Result.fail(500, "服务繁忙，请稍后再试");
    }
}
```

### 静态方法 vs 实例方法

```java
@RestController
@RequestMapping("/order")
public class OrderController {
    
    // 实例方法
    @GetMapping("/{id}")
    @SentinelResource(value = "getOrder", blockHandler = "getOrderBlock")
    public Result&lt;Order&gt; getOrder(Long id) {
        return Result.ok(orderService.getById(id));
    }
    
    // 实例方法的签名必须是：
    // public Result&lt;Order&gt; getOrderBlock(Long id, BlockException e)
    
    // 静态方法（在单独类中）
    @GetMapping("/list")
    @SentinelResource(
        value = "listOrders",
        blockHandler = "listBlock",
        blockHandlerClass = SentinelBlockHandler.class
    )
    public Result&lt;List&lt;Order&gt;&gt; listOrders() {
        return Result.ok(orderService.list());
    }
}

// 静态 BlockHandler 类
public class SentinelBlockHandler {
    
    public static Result&lt;List&lt;Order&gt;&gt; listBlock(BlockException e) {
        return Result.fail(429, "访问太频繁");
    }
}
```

---

## 热点参数限流

### 什么是热点

**热点**就是使用频率非常高的参数。例如：

- 商品查询接口：商品 ID 是热点
- 用户查询接口：用户 ID 是热点
- 订单查询接口：订单 ID 是热点

### 基本用法

```java
@GetMapping("/product/{id}")
@SentinelResource(value = "getProduct", blockHandler = "getProductBlock")
public Result&lt;Product&gt; getProduct(@PathVariable Long id) {
    return Result.ok(productService.getById(id));
}

// 热点参数限流会基于参数值进行限流
```

### 参数索引

```java
@GetMapping("/product/{id}")
@SentinelResource(
    value = "getProduct",
    blockHandler = "getProductBlock",
    paramFlowRuleIndex = 0  // 指定参数索引，0=第一个参数
)
public Result&lt;Product&gt; getProduct(
        @PathVariable(value = "id") Long id,
        @RequestParam(required = false) String source) {
    return Result.ok(productService.getById(id));
}
```

### 代码配置热点规则

```java
@Configuration
public class SentinelHotParamConfig {
    
    @PostConstruct
    public void init() {
        // 热点参数规则
        ParamFlowRule rule = new ParamFlowRule("getProduct")
            .setParamIdx(0)  // 第一个参数（id）
            .setCount(10);  // 每个参数值每秒最多 10 次
        
        ParamFlowRuleManager.loadRules(Collections.singletonList(rule));
    }
}
```

### 基于参数值的限流

```java
@Configuration
public class SentinelHotParamConfig {
    
    @PostConstruct
    public void init() {
        // 针对特定参数值的限流
        ParamFlowRule rule = new ParamFlowRule("getProduct")
            .setParamIdx(0)
            .setCount(10);  // 默认每个商品 ID 每秒 10 次
        
        // 针对热门商品的特殊限制
        ParamFlowItem item = ParamFlowItem.newItem("1001", 5);  // 热门商品 ID
        rule.setParamFlowItemList(Collections.singletonList(item));
        
        ParamFlowRuleManager.loadRules(Collections.singletonList(rule));
    }
}
```

---

## 高级用法

### 1. 参数类型支持

Sentinel 支持的参数类型：

```java
@GetMapping("/search")
@SentinelResource(value = "search", blockHandler = "searchBlock")
public Result&lt;List&lt;Product&gt;&gt; search(
        @RequestParam String keyword,      // String
        @RequestParam(defaultValue = "1") int page,  // int
        @RequestParam(required = false) Long categoryId) {  // Long
    return Result.ok(productService.search(keyword, page, categoryId));
}
```

### 2. 对象参数

```java
@Data
public class ProductQuery {
    private Long categoryId;
    private String keyword;
    private Integer page;
    private Integer size;
}

@GetMapping("/search")
@SentinelResource(value = "search", blockHandler = "searchBlock")
public Result&lt;List&lt;Product&gt;&gt; search(ProductQuery query) {
    // 只能通过代码配置热点规则
    return Result.ok(productService.search(query));
}
```

### 3. 数组参数

```java
@GetMapping("/batch")
@SentinelResource(value = "getBatch", blockHandler = "getBatchBlock")
public Result&lt;List&lt;Product&gt;&gt; getBatch(
        @RequestParam("ids") List&lt;Long&gt; ids) {
    // 使用 list.size() 作为限流维度
    return Result.ok(productService.getByIds(ids));
}
```

### 4. 自定义参数解析

```java
@Component
public class CustomParamExtractor implements ParamFlowArgumentInterface {
    
    @Override
    public Object extractArg(Object... args) {
        if (args.length > 0) {
            Object firstArg = args[0];
            if (firstArg instanceof Order) {
                return ((Order) firstArg).getUserId();
            }
        }
        return null;
    }
}
```

---

## 控制台配置热点规则

### 1. 登录控制台

访问 `http://localhost:8858`，点击「热点规则」→「新增热点规则」。

### 2. 配置规则

```
参数索引: 0
参数类型: long
单机阈值: 10
统计窗口时长: 1 (秒)
```

### 3. 参数值例外项

| 参数值 | 阈值 |
|---|---|
| 1001 | 100 |
| 1002 | 200 |
| default | 10 |

---

## 实战：热点商品限流

### 场景

电商系统中，99% 的流量集中在 1% 的热门商品上。如果不加控制，热门商品会把系统打垮。

### 实现

```java
@RestController
@RequestMapping("/product")
public class ProductController {
    
    private static final Map&lt;Long, Integer&gt; HOT_PRODUCT_THRESHOLDS = 
        new ConcurrentHashMap&lt;&gt;() {{
        put(1001L, 100);  // 热门商品 100 QPS
        put(1002L, 200);  // 爆款商品 200 QPS
    }};
    
    @GetMapping("/{id}")
    @SentinelResource(value = "getProduct", blockHandler = "getProductBlock")
    public Result&lt;Product&gt; getProduct(@PathVariable Long id) {
        return Result.ok(productService.getById(id));
    }
    
    public Result&lt;Product&gt; getProductBlock(Long id, BlockException e) {
        // 热点限流
        if (e instanceof ParamFlowException) {
            return Result.fail(429, "该商品太火爆了，请稍后再试");
        }
        return Result.fail(429, "访问太频繁，请稍后再试");
    }
}
```

```java
@Configuration
public class HotProductConfig {
    
    @PostConstruct
    public void init() {
        // 基础热点规则
        ParamFlowRule rule = ParamFlowRule.of("getProduct", 0, 10);
        
        // 热门商品例外配置
        List&lt;ParamFlowItem&gt; items = HOT_PRODUCT_THRESHOLDS.entrySet().stream()
            .map(e -> ParamFlowItem.newItem(String.valueOf(e.getKey()), e.getValue()))
            .collect(Collectors.toList());
        rule.setParamFlowItemList(items);
        
        ParamFlowRuleManager.loadRules(Collections.singletonList(rule));
    }
}
```

---

## 常见问题

### Q：热点参数限流和普通限流的区别？

A：**普通限流**是对整个资源限流，所有参数值共享一个阈值。**热点参数限流**是对每个参数值限流，可以针对不同参数值设置不同阈值。

### Q：参数值太多，规则怎么配置？

A：可以只配置默认阈值，热门商品的阈值通过例外项单独配置。或者使用控制台动态配置。

### Q：参数值为 null 时怎么处理？

A：参数值为 null 时会当作字符串 "null" 处理。建议对参数进行非空校验。

### Q：热点限流支持哪些类型？

A：支持基本类型（int、long、String）和它们的对象包装类。复杂对象需要自定义参数解析器。

---

## 面试高频问题

### Q：@SentinelResource 的 blockHandler 和 fallback 有什么区别？

A：**blockHandler** 处理 Sentinel 的流控/熔断异常（FlowException、DegradeException），**fallback** 处理业务异常。两者互不干扰，可以同时使用。

### Q：热点参数限流有什么实际应用场景？

A：

1. **商品详情页**：热门商品限流，避免热点商品压垮系统
2. **用户主页**：大 V 用户限流，避免明星效应
3. **搜索接口**：热门搜索词限流

### Q：如何实现对特定参数值的精细化限流？

A：通过 ParamFlowItem 设置参数值例外项：

```java
ParamFlowItem item = ParamFlowItem.newItem("1001", 100);
rule.setParamFlowItemList(Collections.singletonList(item));
```

### Q：Sentinel 的参数索引如何确定？

A：通过 `@SentinelResource` 的 `paramFlowRuleIndex` 属性指定，或者通过控制台配置。索引从 0 开始，对应方法参数的顺序。

---

## 总结

@SentinelResource 提供了精细化的资源保护能力：

1. **资源定义**：通过 value 属性定义资源名
2. **异常处理**：blockHandler 处理限流/熔断，fallback 处理业务异常
3. **热点限流**：针对参数值进行精细化控制
4. **动态配置**：支持代码配置和控制台配置

> 掌握 @SentinelResource，是用好 Sentinel 的关键。
