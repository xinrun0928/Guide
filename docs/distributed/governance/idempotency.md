# 幂等性设计：接口幂等实现方案

你有没有想过这个问题：

用户点击「提交订单」，网络卡了一下，又点了一次。

结果：订单被创建了两次，扣了两次钱。

这是一个经典的问题——**接口幂等性缺失**。

## 幂等的定义

幂等：同一操作执行一次和执行多次，结果相同。

```
GET /users/1       → 幂等（多次查询，结果相同）
PUT /users/1       → 幂等（多次更新，状态相同）
DELETE /users/1    → 幂等（多次删除，效果相同）
POST /users        → 非幂等（每次创建新用户）
```

## 幂等的必要性

```
1. 网络抖动：请求超时，客户端重试
2. 前端抖动：用户多次点击
3. 消息队列重复消费：消息重发
4. 分布式事务：补偿事务重复执行
5. 浏览器回退：用户回退后重新提交
```

## HTTP 方法的幂等性

| 方法 | 幂等 | 安全 |
|------|------|------|
| GET | ✅ | ✅ |
| HEAD | ✅ | ✅ |
| PUT | ✅ | ❌ |
| DELETE | ✅ | ❌ |
| POST | ❌ | ❌ |
| PATCH | ❌ | ❌ |

## 幂等实现方案

### 方案一：Token + Redis

#### 流程

```
1. 客户端请求获取 Token
2. 服务端生成唯一 Token，返回给客户端
3. 客户端提交请求时携带 Token
4. 服务端检查 Token 是否已使用
5. 未使用：执行业务，标记 Token 已使用
6. 已使用：直接返回成功
```

#### 实现代码

```java
@Service
public class IdempotentService {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    // 1. 生成 Token
    public String generateToken() {
        String token = UUID.randomUUID().toString();
        // Token 有效期 10 分钟
        redisTemplate.opsForValue().set(
            "idempotent:token:" + token,
            "0",
            10,
            TimeUnit.MINUTES
        );
        return token;
    }

    // 2. 验证 Token
    public boolean validateToken(String token) {
        String key = "idempotent:token:" + token;
        // SETNX：key 不存在才设置
        Boolean result = redisTemplate.opsForValue()
            .setIfAbsent(key, "1", 10, TimeUnit.MINUTES);
        return Boolean.TRUE.equals(result);
    }

    // 3. 业务操作
    @Transactional
    public void submitOrder(String token, Order order) {
        if (!validateToken(token)) {
            throw new BizException("请求已提交，请勿重复操作");
        }

        orderDao.insert(order);
        // 其他业务逻辑
    }
}
```

```java
@Controller
public class OrderController {

    @Autowired
    private IdempotentService idempotentService;

    // 获取 Token
    @GetMapping("/order/token")
    public String getToken() {
        return idempotentService.generateToken();
    }

    // 提交订单
    @PostMapping("/order")
    public Result submitOrder(@RequestParam String token, @RequestBody Order order) {
        idempotentService.submitOrder(token, order);
        return Result.success();
    }
}
```

### 方案二：唯一键约束

#### 数据库表设计

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    idempotent_key VARCHAR(64) UNIQUE NOT NULL COMMENT '幂等键',
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_idempotent_key (idempotent_key)
) COMMENT '订单表';
```

#### 实现代码

```java
@Service
public class OrderService {

    @Autowired
    private OrderDao orderDao;

    public Order createOrder(Order order) {
        order.setIdempotentKey(generateIdempotentKey(order));

        try {
            return orderDao.insert(order);
        } catch (DuplicateKeyException e) {
            // 唯一键冲突，说明订单已存在
            return orderDao.findByIdempotentKey(order.getIdempotentKey());
        }
    }

    private String generateIdempotentKey(Order order) {
        // 业务标识 + 用户 ID + 时间戳
        return String.format("%s:%d:%d",
            order.getBusinessType(),
            order.getUserId(),
            System.currentTimeMillis() / 1000);
    }
}
```

### 方案三：状态机流转

#### 订单状态

```
PENDING → PROCESSING → PAID → COMPLETED
                    ↘ FAILED
```

#### 实现代码

```java
public class OrderService {

    public void payOrder(Long orderId, Payment payment) {
        Order order = orderDao.findById(orderId);

        // 状态校验：只有 PROCESSING 状态才能支付
        if (order.getStatus() != OrderStatus.PROCESSING) {
            throw new BizException("订单状态不正确，无法支付");
        }

        // 执行支付
        paymentGateway.process(payment);

        // 更新状态
        order.setStatus(OrderStatus.PAID);
        orderDao.update(order);
    }
}
```

### 方案四：分布式锁

#### 实现代码

```java
@Service
public class OrderService {

    @Autowired
    private RedissonClient redissonClient;

    public Order createOrder(Order order) {
        String lockKey = "order:create:" + order.getUserId();

        RLock lock = redissonClient.getLock(lockKey);
        try {
            // 加锁，防止并发重复提交
            if (!lock.tryLock(5, 30, TimeUnit.SECONDS)) {
                throw new BizException("请求过于频繁，请稍后重试");
            }

            // 业务逻辑
            return orderDao.insert(order);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BizException("系统繁忙，请稍后重试");
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

## 幂等拦截器实现

### 自定义注解

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Idempotent {
    String key() default "";
    int expireSeconds() default 60;
}
```

### 拦截器

```java
@Component
public class IdempotentInterceptor implements HandlerInterceptor {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws Exception {
        if (!(handler instanceof HandlerMethod)) {
            return true;
        }

        HandlerMethod method = (HandlerMethod) handler;
        Idempotent idempotent = method.getMethodAnnotation(Idempotent.class);

        if (idempotent == null) {
            return true;
        }

        String token = request.getHeader("X-Idempotent-Token");
        if (token == null) {
            token = request.getParameter("token");
        }

        if (token == null) {
            response.getWriter().write("缺少幂等 Token");
            response.setStatus(400);
            return false;
        }

        String key = "idempotent:" + idempotent.key() + ":" + token;
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(key, "1", idempotent.expireSeconds(), TimeUnit.SECONDS);

        if (!Boolean.TRUE.equals(success)) {
            response.getWriter().write("请求已提交，请勿重复操作");
            response.setStatus(429);
            return false;
        }

        return true;
    }
}
```

### 使用示例

```java
@RestController
public class OrderController {

    @PostMapping("/order")
    @Idempotent(key = "createOrder", expireSeconds = 60)
    public Result createOrder(@RequestBody Order order,
                              @RequestHeader("X-Idempotent-Token") String token) {
        return Result.success(orderService.create(order));
    }
}
```

## 总结

幂等性是分布式系统的基础保障：

- **Token + Redis**：通用方案，适合大多数场景
- **唯一键约束**：数据库层面的保障
- **状态机流转**：适合有状态转换的业务
- **分布式锁**：最严格的幂等保证

选择合适的幂等方案，能让你的系统在面对网络抖动、重试、并发时「稳如泰山」。

**面试追问方向：**
- 幂等性和并发控制有什么区别？
- Token 方案和唯一键方案各有什么优缺点？
- 如何设计一个高效的幂等拦截器？
- 幂等性对性能有什么影响？如何优化？