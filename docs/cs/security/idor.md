# IDOR：被忽视的越权访问

你在社交网站打开了一个帖子 URL：

```
https://social.com/posts/12345
```

12345 是帖子的 ID。你想看看其他帖子，改成 12346：

```
https://social.com/posts/12346
```

系统返回了另一个用户的私密帖子——本来只有他自己能看到。

这就是 **IDOR（Insecure Direct Object Reference，不安全的直接对象引用）**——应用直接使用用户提供的 ID 访问资源，没有验证用户是否有权限。

## IDOR 的原理

IDOR 的本质是**缺少访问控制**。

```
正常流程：
用户请求 /posts/123 → 验证用户是否有权访问 123 → 返回结果

IDOR 漏洞：
用户请求 /posts/123 → 直接返回结果 → 没有权限验证
```

### IDOR vs 认证绕过

| | IDOR | 认证绕过 |
|--|------|---------|
| 前提 | 用户已登录 | 用户可能未登录 |
| 原理 | 缺少授权检查 | 认证机制缺陷 |
| 位置 | 业务逻辑层 | 认证层 |
| 修复 | 添加权限验证 | 修复认证机制 |

## IDOR 的常见场景

### 1. URL 参数

```java
// ❌ 漏洞：直接用 ID 查询
@GetMapping("/orders/{orderId}")
public Order getOrder(@PathVariable Long orderId) {
    // 没有验证当前用户是否有权访问这个订单
    return orderRepository.findById(orderId);
}

// 攻击：用户 A 访问用户 B 的订单
GET /orders/456  // 456 是用户 B 的订单
```

### 2. 表单数据

```html
<!-- 危险表单 -->
<form action="/transfer" method="POST">
    <input type="hidden" name="fromAccount" value="12345">
    <input type="hidden" name="toAccount" value="67890">
    <input type="number" name="amount">
</form>

<!-- 攻击者修改 fromAccount -->
<input type="hidden" name="fromAccount" value="99999">
```

### 3. API 参数

```java
// ❌ 漏洞：API 端点缺少权限检查
@PutMapping("/api/users/{userId}/profile")
public User updateProfile(@PathVariable Long userId, 
                          @RequestBody UserProfile profile) {
    // 应该验证 userId == 当前用户 ID
    return userService.updateProfile(userId, profile);
}

// 攻击：修改其他用户的资料
PUT /api/users/123/profile  // 123 是其他用户的 ID
```

### 4. 文件访问

```java
// ❌ 漏洞：文件 ID 直接访问
@GetMapping("/files/{fileId}")
public ResponseEntity<Resource> download(@PathVariable String fileId) {
    Path file = Paths.get("/uploads/" + fileId);
    return ResponseEntity.ok(new FileSystemResource(file));
}

// 攻击：遍历文件 ID
GET /files/../../../etc/passwd  // 路径遍历
GET /files/ABC001  // 访问其他用户上传的文件
```

## IDOR 的危害

```
┌─────────────────────────────────────────────────────────────┐
│                    IDOR 能做什么                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 越权查看                                                 │
│     查看他人隐私、订单、消息、文档                             │
│                                                             │
│  2. 越权修改                                                 │
│     修改他人资料、订单状态、权限                               │
│                                                             │
│  3. 越权删除                                                 │
│     删除他人内容、数据                                        │
│                                                             │
│  4. 越权操作                                                 │
│     以他人身份转账、发帖、评论                                │
│                                                             │
│  5. 敏感数据泄露                                             │
│     遍历 ID 获取大量用户数据                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## IDOR 防御

### 1. 基于用户的访问控制

```java
@Service
public class OrderService {
    
    /**
     * 获取订单（带权限验证）
     */
    public Order getOrder(Long orderId, Long currentUserId) {
        Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));
        
        // ✅ 核心：验证订单所属用户
        if (!order.getUserId().equals(currentUserId)) {
            throw new ForbiddenException("无权访问此订单");
        }
        
        return order;
    }
    
    /**
     * 修改订单
     */
    public Order updateOrder(Long orderId, Long currentUserId, OrderUpdate update) {
        Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));
        
        // ✅ 验证所有权
        if (!order.getUserId().equals(currentUserId)) {
            throw new ForbiddenException("无权修改此订单");
        }
        
        // 业务逻辑
        return orderRepository.save(order);
    }
}

@RestController
public class OrderController {
    
    @GetMapping("/orders/{orderId}")
    public Order getOrder(@PathVariable Long orderId) {
        // 从 SecurityContext 获取当前用户 ID
        Long currentUserId = getCurrentUserId();
        
        // 传入当前用户 ID，由 Service 层验证权限
        return orderService.getOrder(orderId, currentUserId);
    }
}
```

### 2. 使用 UUID 替代数字 ID

```java
// ❌ 数字 ID 可遍历
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;  // 1, 2, 3, 4... 可枚举
}

// ✅ UUID 不可预测
public class Order {
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "uuid2")
    private String id;  // "550e8400-e29b-41d4-a716-446655440000"
}

// 或在 API 层转换
@GetMapping("/orders/{id}")
public Order getOrder(@PathVariable String id) {
    // UUID 无法猜测遍历
    Long numericId = uuidToIdConverter.convert(id);
    return orderService.getOrder(numericId, getCurrentUserId());
}
```

### 3. 资源级权限注解

```java
// 自定义权限注解
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireOwnership {
    String resourceParam() default "id";
    String ownerField() default "userId";
}

// 权限验证切面
@Component
@Aspect
public class OwnershipAspect {
    
    @Autowired
    private CurrentUserService currentUserService;
    
    @Around("@annotation(requireOwnership)")
    public Object checkOwnership(ProceedingJoinPoint joinPoint,
                                 RequireOwnership requireOwnership) throws Throwable {
        
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        String resourceParam = requireOwnership.resourceParam();
        
        // 获取资源 ID 参数
        Object[] args = joinPoint.getArgs();
        Parameter[] params = signature.getMethod().getParameters();
        Object resourceId = null;
        
        for (int i = 0; i < params.length; i++) {
            if (params[i].getName().equals(resourceParam)) {
                resourceId = args[i];
                break;
            }
        }
        
        // 验证所有权
        Long currentUserId = currentUserService.getCurrentUserId();
        if (!resourceService.isOwner(resourceId, currentUserId)) {
            throw new ForbiddenException("无权访问此资源");
        }
        
        return joinPoint.proceed();
    }
}

// 使用
@Service
public class DocumentService {
    
    @RequireOwnership(resourceParam = "docId", ownerField = "ownerId")
    public Document getDocument(Long docId) {
        return documentRepository.findById(docId);
    }
}
```

### 4. 全局安全检查

```java
@Component
public class SecurityInterceptor implements HandlerInterceptor {
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                            HttpServletResponse response, 
                            Object handler) throws Exception {
        
        // 获取当前用户
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            response.setStatus(401);
            return false;
        }
        
        // 记录访问日志
        log.info("User {} accessing {} {}", 
                 auth.getName(), request.getMethod(), request.getRequestURI());
        
        return true;
    }
}

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Autowired
    private SecurityInterceptor securityInterceptor;
    
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(securityInterceptor)
            .addPathPatterns("/api/**")  // API 路径
            .excludePathPatterns("/api/public/**", "/api/auth/**");
    }
}
```

## 安全的 API 设计

### 关系型 API

```java
@RestController
@RequestMapping("/api")
public class ApiController {
    
    /**
     * ✅ 正确：当前用户的资源
     */
    @GetMapping("/me/orders")
    public List<Order> myOrders() {
        Long userId = getCurrentUserId();
        return orderService.findByUserId(userId);
    }
    
    /**
     * ❌ 危险：直接用 ID 访问任意资源
     */
    @GetMapping("/orders/{orderId}")
    public Order getOrder(@PathVariable Long orderId) {
        return orderService.getOrder(orderId);
    }
    
    /**
     * ✅ 更好：在资源路径中明确归属
     */
    @GetMapping("/users/{userId}/orders/{orderId}")
    public Order getUserOrder(@PathVariable Long userId, 
                             @PathVariable Long orderId) {
        // 验证 userId 是当前用户
        Long currentUserId = getCurrentUserId();
        if (!userId.equals(currentUserId)) {
            // 如果是管理员，可以跨用户访问
            if (!hasRole("ADMIN")) {
                throw new ForbiddenException();
            }
        }
        return orderService.getOrder(orderId);
    }
}
```

## 测试 IDOR 漏洞

```bash
# 使用 Burp Suite 测试

# 1. 使用不同用户登录，获取不同的 Session

# 2. 用户 A 的请求
GET /api/users/100/orders  # 用户 A 的订单

# 3. 修改为用户 B 的 ID
GET /api/users/200/orders  # 用户 B 的订单？

# 4. 或者修改请求参数
POST /transfer?from=100&to=200&amount=1000
# 修改为
POST /transfer?from=200&to=300&amount=1000
```

## 面试追问方向

1. **IDOR 和 XSS 的区别？** —— IDOR 是服务端缺少权限检查（后端），XSS 是输出没有转义（前端）
2. **IDOR 和 CSRF 的区别？** —— IDOR 利用有效凭证越权访问，CSRF 利用浏览器的自动发送凭证
3. **为什么 UUID 比数字 ID 更安全？** —— UUID 不可预测，无法遍历
4. **如何在 Controller 层统一处理 IDOR？** —— 使用拦截器/切面，在入口处统一验证权限
5. **水平越权和垂直越权的区别？** —— 水平越权访问同级资源（如其他用户数据），垂直越权访问更高权限资源（如管理员功能）

> "IDOR 是最常见的越权漏洞。每一处资源访问，都应该有明确的权限验证。"
