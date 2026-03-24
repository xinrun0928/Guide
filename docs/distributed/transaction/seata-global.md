# Seata 全局事务与分支事务原理

你有没有想过这个问题：

一个订单服务调用了库存服务，库存服务又调用了仓储服务。

三个服务在同一个分布式事务里。

**Seata 是怎么知道它们是一伙的？**

答案就是 **XID**——全局事务 ID。

## XID：分布式事务的身份证

XID（Global Transaction ID）是 Seata 用来串联整个调用链的「身份证」。

```
调用链：

  订单服务                    库存服务                    仓储服务
      │                          │                          │
      │ createOrder()            │                          │
      │──────────▶  TC.begin()   │                          │
      │◀─────────  xid=123456   │                          │
      │                          │                          │
      │ decreaseStock(xid,...)  │                          │
      │───────────▶              │ decreaseStock()         │
      │                          │──────────▶ TC.register() │
      │                          │◀───────── branchId=001   │
      │                          │                          │
      │                          │ reserveStorage(xid,...)  │
      │                          │─────────────▶            │
      │                          │              reserve()    │
      │                          │              TC.register │
      │                          │              ◀──────────│
      │                          │              branchId=002│
      │                          │                          │
```

```java
/**
 * XID 的生成
 */
public class XID {
    
    /**
     * 生成全局唯一的 XID
     */
    public static String generateXID() {
        // XID = IP + Port + Timestamp + Sequence
        String ip = getLocalIP();
        int port = getPort();
        long timestamp = System.currentTimeMillis();
        int sequence = atomicInteger.incrementAndGet();
        
        return String.format("%s:%d:%d:%d", ip, port, timestamp, sequence);
    }
}
```

## @GlobalTransactional：全局事务的入口

在方法上加 `@GlobalTransactional` 注解，就开启了一个全局事务：

```java
/**
 * 开启全局事务
 */
@GlobalTransactional(name = "create-order", rollbackFor = Exception.class)
public void createOrder(OrderDTO orderDTO) {
    // 在这里，全局事务开始了
    
    // 1. 扣库存
    inventoryService.decreaseStock(orderDTO.getProductId(), orderDTO.getCount());
    
    // 2. 创建订单
    Order order = new Order();
    order.setId(orderDTO.getId());
    order.setStatus("CREATED");
    orderDao.insert(order);
    
    // 3. 扣余额
    accountService.decreaseBalance(orderDTO.getUserId(), orderDTO.getAmount());
    
    // 方法正常返回 → 全局事务提交
    // 方法抛出异常 → 全局事务回滚
}
```

```java
/**
 * @GlobalTransactional 注解解析
 */
@Aspect
public class GlobalTransactionalInterceptor {
    
    @Around("@annotation(GlobalTransactional)")
    public Object around(ProceedingJoinPoint point) throws Throwable {
        GlobalTransactional anno = point.getMethod()
            .getAnnotation(GlobalTransactional.class);
        
        // 1. 开启全局事务，获取 XID
        String xid = transactionManager.begin(
            anno.name(),
            anno.timeout()
        );
        
        // 2. 把 XID 绑定到当前线程
        RootContext.bind(xid);
        
        try {
            // 3. 执行目标方法
            Object result = point.proceed();
            
            // 4. 方法成功 → 提交全局事务
            transactionManager.commit(xid);
            
            return result;
            
        } catch (Exception e) {
            // 5. 方法失败 → 回滚全局事务
            transactionManager.rollback(xid);
            
            throw e;
            
        } finally {
            // 6. 解绑 XID
            RootContext.unbind();
        }
    }
}
```

## 分支事务的注册

当 RM 执行本地事务时，会向 TC 注册分支事务：

```java
/**
 * 分支事务注册
 */
public class BranchInterceptor {
    
    @Around("execution(* com.seata.*.*(..))")
    public Object around(ProceedingJoinPoint point) throws Throwable {
        // 1. 获取当前线程的 XID
        String xid = RootContext.getXID();
        
        if (xid == null) {
            // 没有全局事务，直接执行
            return point.proceed();
        }
        
        // 2. 执行本地事务（一阶段）
        BranchSession branchSession = new BranchSession();
        branchSession.setXid(xid);
        branchSession.setBranchId(generateBranchId());
        branchSession.setResourceId(getResourceId());
        branchSession.setSqlType(getSqlType(point));
        branchSession.setTableName(getTableName(point));
        
        // 3. 向 TC 注册分支
        tcServer.registerBranch(branchSession);
        
        // 4. 执行本地事务
        Object result = point.proceed();
        
        // 5. 上报分支状态
        tcServer.reportBranchStatus(
            branchSession.getXid(),
            branchSession.getBranchId(),
            BranchStatus.PhaseOne_Finished
        );
        
        return result;
    }
}
```

## XID 在调用链中的传播

XID 是如何从订单服务传递到库存服务的？

```
传播方式：

1. HTTP 调用：XID 通过 Header 传递
   Header: X-XID: 123456

2. RPC 调用（Dubbo/gRPC）：XID 通过 RpcContext 传递
   Dubbo Filter 自动处理

3. 消息队列：XID 通过 Message Header 传递
   RocketMQ/Kafka 的 Header
```

### HTTP 调用中的 XID 传播

```java
/**
 * Feign Client：XID 自动传递
 */
@FeignClient(name = "inventory-service")
public interface InventoryClient {
    
    @PostMapping("/decrease-stock")
    Result decreaseStock(@RequestBody DecreaseStockRequest request);
}

/**
 * Feign 拦截器：自动传递 XID
 */
@Configuration
public class FeignXidInterceptor implements RequestInterceptor {
    
    @Override
    public void apply(RequestTemplate template) {
        // 从当前线程获取 XID
        String xid = RootContext.getXID();
        
        if (xid != null) {
            // 添加到 Header
            template.header("X-XID", xid);
        }
    }
}

/**
 * Spring MVC 拦截器：接收 XID
 */
@Component
public class XidInterceptor implements HandlerInterceptor {
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                           HttpServletResponse response,
                           Object handler) {
        String xid = request.getHeader("X-XID");
        
        if (xid != null) {
            // 绑定到当前线程
            RootContext.bind(xid);
        }
        
        return true;
    }
    
    @Override
    public void afterCompletion(HttpServletRequest request,
                               HttpServletResponse response,
                               Object handler,
                               Exception ex) {
        // 解绑
        RootContext.unbind();
    }
}
```

### Dubbo 调用中的 XID 传播

```java
/**
 * Dubbo Filter：XID 自动传递
 */
@Component
@Activate(group = {Constants.PROVIDER_GROUP, Constants.CONSUMER_GROUP})
public class SeataDubboFilter implements Filter {
    
    @Override
    public Result invoke(Invoker<?> invoker, Invocation invocation) {
        String xid = RootContext.getXID();
        
        if (xid != null) {
            // Dubbo RpcContext 传递 XID
            RpcContext.getContext()
                .setAttachment("X-XID", xid);
        }
        
        return invoker.invoke(invocation);
    }
}
```

## 全局事务的完整生命周期

```
1. TM 发起全局事务（begin）
      ↓
   TC 创建全局会话，返回 XID
      ↓
2. 调用链中传递 XID（HTTP Header / RPC Context）
      ↓
3. RM 执行本地事务时注册分支（registerBranch）
      ↓
   TC 记录分支会话
      ↓
4. TM 方法正常返回，通知 TC 提交（commit）
      ↓
   TC 通知所有分支提交（Phase 2）
      ↓
5. 全局事务结束，删除会话（cleanup）
```

```java
/**
 * 全局事务管理器
 */
public class GlobalTransactionManager {
    
    /**
     * 发起全局事务
     */
    public String begin(String name, int timeout) {
        // 1. TC 创建全局会话
        GlobalSession session = tcServer.createSession(name, timeout);
        
        // 2. 持久化会话
        sessionStore.save(session);
        
        return session.getXid();
    }
    
    /**
     * 注册分支
     */
    public void registerBranch(String xid, BranchSession branch) {
        // 1. TC 添加分支到会话
        GlobalSession session = sessionStore.get(xid);
        session.addBranch(branch);
        
        // 2. 申请全局锁（AT 模式）
        if (branch.needGlobalLock()) {
            globalLockManager.lock(branch.getResourceId(), branch.getPrimaryKeys());
        }
        
        // 3. 持久化
        sessionStore.update(session);
    }
    
    /**
     * 全局提交
     */
    public void commit(String xid) {
        GlobalSession session = sessionStore.get(xid);
        
        // 异步通知所有分支提交
        asyncNotifier.notifyBranches(
            session.getBranches(),
            BranchStatus.PhaseTwo_Committed
        );
        
        // 删除会话
        sessionStore.remove(xid);
    }
    
    /**
     * 全局回滚
     */
    public void rollback(String xid) {
        GlobalSession session = sessionStore.get(xid);
        
        // 同步通知所有分支回滚
        for (BranchSession branch : session.getBranches()) {
            branch.rollback();
        }
        
        // 释放全局锁
        globalLockManager.unlock(session.getBranches());
        
        // 删除会话
        sessionStore.remove(xid);
    }
}
```

## 面试追问方向

**追问 1：如果 XID 传递失败了怎么办？**

如果 XID 没有正确传递：
- RM 不知道自己在一个全局事务里
- RM 会直接执行本地事务，不注册分支
- 全局事务回滚时，该 RM 的修改不会被撤销

**解决方案**：
- Seata 的 Filter 链会自动处理 XID 传递
- 但如果 Filter 配置错误，可能丢失 XID
- 建议在 Filter 中加入日志，便于排查

**追问 2：全局事务的回滚顺序是怎样的？**

AT 模式：按照注册顺序逆序回滚
- 如果分支 A 先注册，分支 B 后注册
- 回滚顺序：B 先回滚，A 后回滚

TCC 模式：按照注册顺序逆序执行 Cancel
- Cancel 是业务方法，顺序可能影响结果
- 设计时需要考虑 Cancel 的顺序无关性

**追问 3：如何手动传递 XID？**

```java
/**
 * 手动传递 XID
 */
public void manualXidPropagation() {
    // 1. 获取当前 XID
    String xid = RootContext.getXID();
    
    // 2. 放入 ThreadLocal / RpcContext
    ThreadLocal<String> xidHolder = new ThreadLocal<>();
    xidHolder.set(xid);
    
    // 3. 线程池执行时，XID 会丢失
    // 需要手动传递
    CompletableFuture.runAsync(() -> {
        // 把 XID 重新绑定
        RootContext.bind(xid);
        
        try {
            // 执行业务
        } finally {
            RootContext.unbind();
        }
    });
}
```

## 总结

Seata 全局事务的核心原理：

1. **XID 是身份证**：唯一标识一个全局事务
2. **XID 串联调用链**：通过 Header/RpcContext 自动传播
3. **分支事务注册**：RM 执行时向 TC 注册
4. **全局统一提交/回滚**：TC 协调所有分支

理解 XID 的传播机制，是理解 Seata 的第一步。
