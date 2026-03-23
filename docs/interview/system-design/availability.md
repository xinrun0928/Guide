# 如何保证系统的高可用

你有没有想过：

- 为什么阿里云能做到 99.99% 的可用性（全年停机不超过 52 分钟）？
- 为什么你的系统一年要宕机好几次？
- 为什么有些系统能「永不停机」，而你的系统动不动就崩溃？

这些差距的背后，是**高可用设计**的差异。

今天，我们来深入探讨如何设计一个高可用的系统。


## 一、什么是可用性？

### 1.1 可用性的定义

```
┌─────────────────────────────────────────────────────────┐
│                    可用性指标                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  可用性 =正常运行时间 / (正常运行时间 + 停机时间)           │
│                                                         │
│  几个关键的可用性指标：                                   │
│                                                         │
│  99%    →  年停机 3.65 天                             │
│  99.9%  →  年停机 8.76 小时                           │
│  99.99% →  年停机 52.6 分钟                            │
│  99.999% → 年停机 5.26 分钟                            │
│                                                         │
│  每个 9 的代价：成本增加 10 倍                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 可用性 vs 一致性

```
CAP 理论告诉我们：
- 在分区发生时，必须在可用性和一致性之间选择

实际选择：
- 大多数互联网系统 → 选择可用性（AP）
- 金融交易系统 → 选择一致性（CP）

但这不是绝对的：
- 可以通过「降级」来平衡
- 核心流程强一致，非核心流程可用
```


## 二、高可用架构原则

### 2.1 消除单点

```java
/**
 * 单点故障 vs 高可用
 */
public class SinglePointVsHA {
    
    /**
     * 单点故障
     */
    public static class SinglePoint {
        // 单个数据库
        // 单个 Redis
        // 单个服务实例
        
        // 问题：
        // 任何一个组件故障，整个系统故障
    }
    
    /**
     * 高可用
     */
    public static class HighAvailability {
        // 主从数据库
        // Redis Sentinel/Cluster
        // 服务多实例部署
        
        // 任何一个组件故障，系统继续服务
    }
}
```

### 2.2 冗余设计

```java
/**
 * 冗余设计
 */
public class RedundancyDesign {
    
    /**
     * 数据冗余
     */
    public static class DataRedundancy {
        
        public void replicate() {
            // 主从复制
            // 主备切换
            
            // 多副本存储
            // 数据分片
        }
    }
    
    /**
     * 服务冗余
     */
    public static class ServiceRedundancy {
        
        public void deployMultiple() {
            // 至少部署 2 个实例
            // 使用负载均衡
            
            // Docker + Kubernetes
            // 自动故障恢复
        }
    }
    
    /**
     * 机房冗余
     */
    public static class DatacenterRedundancy {
        
        public void multiDatacenter() {
            // 多机房部署
            // 数据同步
            
            // 流量切换
        }
    }
}
```


## 三、高可用技术方案

### 3.1 服务冗余

```java
/**
 * 服务冗余实现
 */
public class ServiceRedundancy {
    
    /**
     * 健康检查
     */
    public static class HealthCheck {
        
        public boolean isHealthy() {
            // 1. 检查进程是否存活
            if (!process.isAlive()) {
                return false;
            }
            
            // 2. 检查依赖是否可用
            if (!checkDependencies()) {
                return false;
            }
            
            // 3. 检查资源是否充足
            if (cpuUsage > 90 || memoryUsage > 90) {
                return false;
            }
            
            return true;
        }
        
        private boolean checkDependencies() {
            // 检查数据库连接
            if (!db.isConnected()) {
                return false;
            }
            
            // 检查 Redis 连接
            if (!redis.isConnected()) {
                return false;
            }
            
            return true;
        }
    }
    
    /**
     * 故障检测与恢复
     */
    public static class FailureDetection {
        
        public void handleFailure() {
            // 1. 连续 N 次健康检查失败
            // 2. 标记实例为不健康
            // 3. 从负载均衡器移除
            // 4. 启动新实例
            // 5. 等待新实例就绪
            // 6. 加入负载均衡器
        }
    }
}
```

### 3.2 限流与熔断

```java
/**
 * 限流与熔断
 */
public class RateLimitAndCircuitBreaker {
    
    /**
     * 限流器
     */
    public static class RateLimiter {
        
        public boolean tryAcquire(String key) {
            // 滑动窗口限流
            String windowKey = "rate:" + key + ":" + getCurrentWindow();
            Long count = redis.incr(windowKey);
            
            if (count == 1) {
                redis.expire(windowKey, Duration.ofSeconds(60));
            }
            
            return count <= MAX_REQUESTS;
        }
    }
    
    /**
     * 熔断器
     */
    public static class CircuitBreaker {
        
        public static enum State {
            CLOSED,    // 关闭，正常调用
            OPEN,      // 打开，拒绝调用
            HALF_OPEN  // 半开，尝试调用
        }
        
        private State state = State.CLOSED;
        
        public String call(String service, String request) {
            if (state == State.OPEN) {
                // 直接返回降级响应
                return getFallbackResponse();
            }
            
            try {
                String response = callService(service, request);
                
                // 成功，重置熔断器
                if (state == State.HALF_OPEN) {
                    state = State.CLOSED;
                }
                
                recordSuccess();
                return response;
                
            } catch (Exception e) {
                recordFailure();
                
                // 失败次数超过阈值，打开熔断器
                if (failureCount > THRESHOLD) {
                    state = State.OPEN;
                }
                
                return getFallbackResponse();
            }
        }
    }
}
```

### 3.3 重试与幂等

```java
/**
 * 重试与幂等
 */
public class RetryAndIdempotency {
    
    /**
     * 重试机制
     */
    public static class Retry机制 {
        
        public Response callWithRetry(Request request) {
            int maxRetries = 3;
            int retryDelay = 100; // ms
            
            for (int i = 0; i < maxRetries; i++) {
                try {
                    return callService(request);
                } catch (Exception e) {
                    if (i == maxRetries - 1) {
                        throw e;
                    }
                    
                    // 指数退避
                    Thread.sleep(retryDelay * (i + 1));
                }
            }
            
            throw new RuntimeException("重试失败");
        }
    }
    
    /**
     * 幂等性保证
     */
    public static class Idempotency {
        
        public Response processWithIdempotency(String idempotentKey, Request request) {
            // 1. 检查是否已处理
            String result = redis.get("idempotent:" + idempotentKey);
            if (result != null) {
                return JSON.parseObject(result);
            }
            
            // 2. 标记处理中
            redis.setex("idempotent:" + idempotentKey + ":lock", 1, 
                Duration.ofMinutes(1));
            
            try {
                // 3. 执行业务逻辑
                Response response = doProcess(request);
                
                // 4. 保存结果
                redis.setex("idempotent:" + idempotentKey, 
                    JSON.toJSONString(response), 
                    Duration.ofHours(24));
                
                return response;
                
            } finally {
                redis.delete("idempotent:" + idempotentKey + ":lock");
            }
        }
    }
}
```


## 四、高可用存储

### 4.1 数据库高可用

```java
/**
 * 数据库高可用
 */
public class DatabaseHA {
    
    /**
     * 主从复制
     */
    public static class Replication {
        
        public void write(String sql) {
            // 写操作只在主库
            master.execute(sql);
        }
        
        public Result read(String sql) {
            // 读操作可以路由到从库
            if (isReadonly(sql)) {
                return randomSlave().execute(sql);
            }
            return master.execute(sql);
        }
    }
    
    /**
     * 自动切换
     */
    public static class AutoFailover {
        
        public void detectAndSwitch() {
            // 1. 监控主库状态
            if (!master.isHealthy()) {
                // 2. 选择一个健康的从库
                Slave newMaster = selectHealthySlave();
                
                // 3. 提升为新的主库
                newMaster.promote();
                
                // 4. 更新路由配置
                updateRouting(newMaster);
            }
        }
    }
}
```

### 4.2 Redis 高可用

```java
/**
 * Redis 高可用
 */
public class RedisHA {
    
    /**
     * Redis Sentinel
     */
    public static class Sentinel {
        
        public void connect() {
            // 1. 连接到 Sentinel 集群
            // 2. Sentinel 自动发现主从
            // 3. 主库故障时自动切换
        }
        
        public String getMaster() {
            // 获取当前主库地址
            return sentinel.getMasterAddrByName("mymaster").toString();
        }
    }
    
    /**
     * Redis Cluster
     */
    public static class Cluster {
        
        public String get(String key) {
            // 1. 计算槽位
            int slot = CRC16(key) % 16384;
            
            // 2. 获取槽位对应的节点
            Node node = slots.get(slot);
            
            // 3. 从节点读取
            return node.get(key);
        }
    }
}
```


## 五、降级与应急预案

### 5.1 降级策略

```java
/**
 * 降级策略
 */
public class DegradationStrategy {
    
    /**
     * 降级级别
     */
    public static enum DegradeLevel {
        NORMAL,     // 正常
        PARTIAL,    // 部分降级
        MINIMAL,    // 最小可用
        OFFLINE     // 完全不可用
    }
    
    private DegradeLevel currentLevel = DegradeLevel.NORMAL;
    
    /**
     * 获取降级响应
     */
    public Object getDegradedResponse(String feature) {
        switch (currentLevel) {
            case NORMAL:
                return getNormalResponse(feature);
            case PARTIAL:
                return getPartialResponse(feature);
            case MINIMAL:
                return getMinimalResponse(feature);
            case OFFLINE:
                return getOfflineResponse(feature);
        }
    }
    
    /**
     * 非核心功能降级
     */
    public Object getPartialResponse(String feature) {
        if (isCoreFeature(feature)) {
            return getNormalResponse(feature);
        }
        
        // 非核心功能返回缓存数据或空
        return getCachedResponse(feature);
    }
}
```

### 5.2 应急预案

```java
/**
 * 应急预案
 */
public class EmergencyPlan {
    
    /**
     * 常见故障场景及处理
     */
    public static class FailureScenarios {
        
        public void handleDatabaseFailure() {
            // 1. 立即切换到备用数据库
            // 2. 停止写操作（如果有）
            // 3. 通知 DBA
            // 4. 分析故障原因
            // 5. 修复并切回
        }
        
        public void handleRedisFailure() {
            // 1. 降级到本地缓存
            // 2. 停止统计功能
            // 3. 通知运维
            // 4. 修复并切回
        }
        
        public void handleNetworkFailure() {
            // 1. 检查网络配置
            // 2. 切换到备用网络
            // 3. 联系云服务商
        }
    }
}
```


## 六、面试追问方向

### 问题一：「如何设计一个 99.99% 可用的系统？」

**回答思路**：

```
1. 消除单点
   - 每个组件至少 2 个实例
   - 自动故障检测和恢复

2. 冗余设计
   - 数据多副本
   - 服务多实例
   - 多机房部署

3. 降级熔断
   - 非核心功能可降级
   - 熔断器防止级联故障

4. 快速恢复
   - 完善的监控告警
   - 自动化故障恢复
   - 定期演练
```

### 问题二：「如何处理缓存失效？」

**回答思路**：

```
1. 缓存穿透：布隆过滤器
2. 缓存击穿：互斥锁
3. 缓存雪崩：过期时间随机化

4. 降级方案
   - 数据库直接查询
   - 返回默认值
   - 友好提示
```

### 问题三：「如何保证服务的高可用？」

**回答思路**：

```
1. 服务冗余
   - 至少 2 个实例
   - 负载均衡

2. 健康检查
   - 定期检查
   - 快速失败

3. 优雅关闭
   - 停止接收新请求
   - 处理完现有请求
   - 再关闭

4. 限流熔断
   - 防止过载
   - 防止级联故障
```


## 七、总结

```
┌─────────────────────────────────────────────────────────┐
│                    高可用设计原则                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  设计原则                                              │
│  ├── 消除单点                                         │
│  ├── 冗余设计                                         │
│  ├── 降级熔断                                         │
│  └── 快速恢复                                         │
│                                                         │
│  技术方案                                              │
│  ├── 服务冗余 + 负载均衡                             │
│  ├── 数据库主从 + 自动切换                           │
│  ├── Redis Sentinel / Cluster                       │
│  └── 限流 + 熔断                                     │
│                                                         │
│  运营保障                                              │
│  ├── 监控告警                                         │
│  ├── 应急预案                                         │
│  └── 定期演练                                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> "高可用的本质是：假设任何组件都可能故障，然后确保系统在故障时仍能提供服务。99.99% 的可用性不是运气，是设计出来的。"
