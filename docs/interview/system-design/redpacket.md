# 设计红包雨/抽奖系统

你有没有想过：

- 春节集五福时，为什么几亿人同时摇手机，却能正常发放奖励？
- 为什么有些抽奖系统能抗住双十一的流量洪峰？
- 为什么你抽到的红包金额看起来是随机的，但实际上有迹可循？

今天，我们来深入探讨红包雨/抽奖系统的设计与实现。


## 一、红包雨 vs 普通抽奖

### 1.1 特殊之处

```
┌─────────────────────────────────────────────────────────┐
│                 红包雨的特殊性                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 瞬时高并发                                        │
│     - 活动开始时，大量用户同时点击                      │
│     - 流量是平时的 1000 倍以上                          │
│                                                         │
│  2. 资金敏感                                         │
│     - 红包金额涉及真实资金                             │
│     - 超发、少发都是严重问题                           │
│                                                         │
│  3. 公平性要求                                        │
│     - 红包金额随机但可计算                             │
│     - 不能出现明显不公平                               │
│                                                         │
│  4. 实时性要求                                        │
│     - 用户点击后立即知道结果                           │
│     - 延迟太大会影响体验                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 核心挑战

```
1. 如何保证库存不超发？
2. 如何快速响应用户请求？
3. 如何保证随机性的公平性？
4. 如何应对瞬时流量？
```


## 二、资金系统设计

### 2.1 账户模型

```java
/**
 * 账户模型
 */
public class AccountModel {
    
    /**
     * 账户表
     */
    public static final String CREATE_TABLE = """
        CREATE TABLE accounts (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT NOT NULL UNIQUE,
            balance DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '余额（分存储）',
            frozen_balance DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '冻结金额',
            version BIGINT NOT NULL DEFAULT 0 COMMENT '乐观锁版本',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
    
    /**
     * 资金流水表
     */
    public static final String CREATE_FLOW_TABLE = """
        CREATE TABLE account_flows (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT NOT NULL,
            business_type VARCHAR(32) NOT NULL COMMENT '业务类型',
            amount DECIMAL(10,2) NOT NULL COMMENT '金额（正负）',
            balance_before DECIMAL(10,2) NOT NULL COMMENT '变动前余额',
            balance_after DECIMAL(10,2) NOT NULL COMMENT '变动后余额',
            biz_no VARCHAR(64) NOT NULL COMMENT '业务单号',
            remark VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            INDEX idx_user_id_time (user_id, created_at),
            INDEX idx_biz_no (biz_no)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
}
```

### 2.2 余额扣减（乐观锁）

```java
/**
 * 余额操作服务
 */
public class BalanceService {
    
    private JdbcTemplate jdbc;
    
    /**
     * 扣减余额（乐观锁）
     */
    public boolean deductBalance(long userId, BigDecimal amount, String bizNo) {
        // 1. 获取当前余额和版本
        Account account = getAccount(userId);
        BigDecimal currentBalance = account.getBalance();
        long currentVersion = account.getVersion();
        
        // 2. 检查余额是否充足
        if (currentBalance.compareTo(amount) < 0) {
            return false;
        }
        
        // 3. 乐观锁更新
        String sql = """
            UPDATE accounts 
            SET balance = balance - ?,
                version = version + 1,
                updated_at = NOW()
            WHERE user_id = ?
              AND version = ?
              AND balance >= ?
            """;
        
        int rows = jdbc.update(sql, amount, userId, currentVersion, amount);
        
        if (rows > 0) {
            // 4. 记录流水
            recordFlow(userId, businessType, amount.negate(), 
                currentBalance, currentBalance.subtract(amount), bizNo);
            return true;
        }
        
        return false;
    }
    
    /**
     * 增加余额
     */
    public boolean addBalance(long userId, BigDecimal amount, String bizNo) {
        // 类似实现
        return true;
    }
}
```


## 三、红包系统设计

### 3.1 红包数据模型

```java
/**
 * 红包数据模型
 */
public class RedPacketModel {
    
    /**
     * 红包活动表
     */
    public static final String CREATE_ACTIVITY_TABLE = """
        CREATE TABLE red_packet_activities (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            activity_id VARCHAR(64) NOT NULL UNIQUE,
            total_amount DECIMAL(10,2) NOT NULL COMMENT '总金额（分）',
            total_count INT NOT NULL COMMENT '总红包数',
            remaining_amount DECIMAL(10,2) NOT NULL COMMENT '剩余金额',
            remaining_count INT NOT NULL COMMENT '剩余数量',
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            status TINYINT DEFAULT 0 COMMENT '0-未开始 1-进行中 2-已结束',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            INDEX idx_status_time (status, start_time)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
    
    /**
     * 用户红包表
     */
    public static final String CREATE_USER_RED_TABLE = """
        CREATE TABLE user_red_packets (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT NOT NULL,
            activity_id VARCHAR(64) NOT NULL,
            amount DECIMAL(10,2) NOT NULL COMMENT '红包金额（分）',
            status TINYINT DEFAULT 0 COMMENT '0-未领取 1-已领取 2-已退款',
            grab_time TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            UNIQUE KEY uk_user_activity (user_id, activity_id),
            INDEX idx_activity_status (activity_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
}
```

### 3.2 红包金额算法

```java
/**
 * 红包金额算法
 */
public class RedPacketAlgorithm {
    
    /**
     * 二倍均值算法
     * 
     * 核心思想：每次抢到的金额 = 随机金额 [1, 剩余金额/剩余数量×2]
     * 
     * 优点：
     * - 保证每个人至少能抢到 1 分
     * - 保证红包不会早期被抢光
     * - 金额分布相对均匀
     * 
     * 例如：
     * - 总金额 100，分 10 个
     * - 第一个人：随机 [1, 100/10×2] = [1, 20]
     * - 第二个人：随机 [1, (100-第一个人)/9×2]
     * - ...
     */
    public static List<Long> divideRedPacket(long totalAmount, int totalCount) {
        List<Long> amounts = new ArrayList<>();
        
        long remainingAmount = totalAmount;
        int remainingCount = totalCount;
        
        Random random = new Random();
        
        while (remainingCount > 0) {
            if (remainingCount == 1) {
                // 最后一个，直接拿走剩余
                amounts.add(remainingAmount);
                break;
            }
            
            // 计算当前可抢的最大金额
            // 二倍均值：剩余金额/剩余数量 × 2
            long maxAmount = (remainingAmount / remainingCount) * 2;
            
            // 随机 [1, maxAmount]
            long amount = random.nextInt((int) maxAmount) + 1;
            if (amount < 1) {
                amount = 1; // 最少 1 分
            }
            
            amounts.add(amount);
            remainingAmount -= amount;
            remainingCount--;
        }
        
        return amounts;
    }
    
    /**
     * 提前计算所有红包金额
     * 
     * 适用场景：红包雨活动
     * 优点：抢红包时直接分配，无需计算
     */
    public static Map<Long, Long> preGenerateAmounts(long activityId, 
                                                    long totalAmount, 
                                                    int totalCount) {
        List<Long> amounts = divideRedPacket(totalAmount, totalCount);
        
        Map<Long, Long> result = new HashMap<>();
        for (int i = 0; i < amounts.size(); i++) {
            // 使用雪花 ID 作为红包序列号
            long redPacketId = generateRedPacketId();
            result.put(redPacketId, amounts.get(i));
        }
        
        return result;
    }
}
```

### 3.3 Redis 原子扣减

```java
/**
 * Redis 原子扣减
 */
public class RedPacketRedisService {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 扣减红包库存（Redis 原子操作）
     * 
     * 使用 Lua 脚本保证原子性
     */
    public Long deductStock(String activityId, long userId) {
        String stockKey = "redpacket:stock:" + activityId;
        String userKey = "redpacket:user:" + activityId + ":" + userId;
        
        /**
         * Lua 脚本：
         * 1. 检查用户是否已领取
         * 2. 检查库存是否充足
         * 3. 扣减库存
         * 4. 标记用户已领取
         */
        String luaScript = """
            -- 检查用户是否已领取
            if redis.call('EXISTS', KEYS[2]) == 1 then
                return -1  -- 已领取
            end
            
            -- 获取当前库存
            local stock = tonumber(redis.call('GET', KEYS[1]))
            if stock == nil or stock <= 0 then
                return 0  -- 库存不足
            end
            
            -- 扣减库存
            redis.call('DECR', KEYS[1])
            
            -- 标记用户已领取
            redis.call('SETEX', KEYS[2], 86400, '1')
            
            return 1  -- 成功
            """;
        
        Long result = redis.execute(
            new DefaultRedisScript<>(luaScript, Long.class),
            Arrays.asList(stockKey, userKey)
        );
        
        return result;
    }
    
    /**
     * 初始化红包库存
     */
    public void initStock(String activityId, int totalCount) {
        String stockKey = "redpacket:stock:" + activityId;
        redis.opsForValue().set(stockKey, String.valueOf(totalCount));
    }
}
```


## 四、抽奖系统设计

### 4.1 奖池模型

```java
/**
 * 抽奖奖池模型
 */
public class LotteryModel {
    
    /**
     * 奖池表
     */
    public static final String CREATE_PRIZE_TABLE = """
        CREATE TABLE lottery_prizes (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            prize_id VARCHAR(64) NOT NULL UNIQUE,
            prize_name VARCHAR(128) NOT NULL,
            prize_type TINYINT NOT NULL COMMENT '1-实物 2-虚拟 3-优惠券 4-积分',
            total_count INT NOT NULL COMMENT '总数量',
            remaining_count INT NOT NULL COMMENT '剩余数量',
            probability DECIMAL(5,4) NOT NULL COMMENT '中奖概率（0.0001=万分之一）',
            daily_limit INT DEFAULT 0 COMMENT '每日发放上限（0=不限）',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            INDEX idx_remaining (remaining_count)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
    
    /**
     * 用户抽奖记录表
     */
    public static final String CREATE_LOTTERY_LOG = """
        CREATE TABLE lottery_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT NOT NULL,
            activity_id VARCHAR(64) NOT NULL,
            prize_id VARCHAR(64),
            status TINYINT DEFAULT 0 COMMENT '0-进行中 1-已中奖 2-未中奖',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            UNIQUE KEY uk_user_activity (user_id, activity_id),
            INDEX idx_activity_status (activity_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
}
```

### 4.2 抽奖算法

```java
/**
 * 抽奖服务
 */
public class LotteryService {
    
    private JdbcTemplate jdbc;
    private RedisTemplate<String, String> redis;
    
    /**
     * 抽奖
     */
    public LotteryResult draw(long userId, String activityId) {
        // 1. 检查用户是否已抽过
        if (hasUserDrawn(userId, activityId)) {
            return LotteryResult.fail("您已参与过本次抽奖");
        }
        
        // 2. 检查抽奖次数
        if (!hasChance(userId, activityId)) {
            return LotteryResult.fail("抽奖次数已用完");
        }
        
        // 3. 执行抽奖
        String prizeId = doLottery(activityId);
        
        // 4. 记录结果
        saveLotteryLog(userId, activityId, prizeId);
        
        // 5. 扣减库存
        if (prizeId != null) {
            deductPrizeStock(prizeId);
            return LotteryResult.win(prizeId);
        } else {
            return LotteryResult.lose();
        }
    }
    
    /**
     * 执行抽奖算法
     */
    private String doLottery(String activityId) {
        // 1. 获取所有奖品及其概率
        List<Prize> prizes = getPrizes(activityId);
        
        // 2. 计算总概率
        double totalProbability = prizes.stream()
            .mapToDouble(Prize::getProbability)
            .sum();
        
        // 3. 生成随机数
        Random random = new Random();
        double randomValue = random.nextDouble() * totalProbability;
        
        // 4. 根据概率选择奖品
        double cumulative = 0;
        for (Prize prize : prizes) {
            cumulative += prize.getProbability();
            if (randomValue <= cumulative) {
                // 选中该奖品
                return prize.getPrizeId();
            }
        }
        
        return null; // 未中奖
    }
    
    /**
     * 概率抽奖（使用 Redis）
     * 
     * 使用 Redis ZSet 实现加权随机
     */
    public String lotteryWithRedis(String activityId) {
        String prizeKey = "lottery:prize:" + activityId;
        
        // 1. 获取所有奖品的权重和
        Double totalWeight = redis.opsForZSet().range(prizeKey, 0, -1)
            .stream()
            .mapToDouble(redis.opsForZSet()::score)
            .sum();
        
        // 2. 生成随机数
        Random random = new Random();
        double randomWeight = random.nextDouble() * totalWeight;
        
        // 3. 遍历找到对应奖品
        double cumulative = 0;
        for (String prizeId : redis.opsForZSet().range(prizeKey, 0, -1)) {
            Double weight = redis.opsForZSet().score(prizeKey, prizeId);
            cumulative += weight;
            if (randomWeight <= cumulative) {
                return prizeId;
            }
        }
        
        return null;
    }
}
```


## 五、高并发处理

### 5.1 多级削峰

```
┌─────────────────────────────────────────────────────────┐
│                   多级削峰策略                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  第一层：CDN 静态资源                                   │
│  ├─ 活动页面、规则说明等静态内容放 CDN              │
│  └─ 用户直接访问 CDN，不需要回源                        │
│                                                         │
│  第二层：验证码/答题                                   │
│  ├─ 活动前需要先答一道题                            │
│  ├─ 有效拦截脚本和恶意请求                          │
│  └─ 将请求分散到 5~10 秒内                           │
│                                                         │
│  第三层：限流                                           │
│  ├─ 基于 IP/用户 ID 的滑动窗口限流                 │
│  ├─ 超过阈值的请求直接返回「太火爆」               │
│  └─ 保护下游系统                                       │
│                                                         │
│  第四层：消息队列                                     │
│  ├─ 抽奖请求写入消息队列                            │
│  ├─ 异步处理抽奖逻辑                                │
│  └─ 平滑系统负载                                       │
│                                                         │
│  第五层：数据库                                       │
│  └─ 最终的库存扣减和记录                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.2 热点数据处理

```java
/**
 * 热点数据处理
 */
public class HotDataService {
    
    /**
     * 缓存热点数据
     */
    public void cacheHotData(String activityId, Object data) {
        String key = "hot:activity:" + activityId;
        redis.opsForValue().set(key, data, Duration.ofMinutes(5));
    }
    
    /**
     * 预加载热点数据
     */
    @PostConstruct
    public void preLoadHotData() {
        // 1. 活动开始前 1 分钟，加载奖品数据到 Redis
        // 2. 预生成红包金额
        // 3. 预热用户领取状态
    }
}
```


## 六、面试追问方向

### 问题一：「如何保证红包金额的公平性？」

**回答思路**：

```
1. 使用确定性的随机算法（种子固定）
2. 提前生成所有红包金额
3. 二倍均值算法保证金额分布均匀
4. 资金流水记录可追溯
```

### 问题二：「如何防止刷红包？」

**回答思路**：

```
1. 限流：每个用户限领 N 次
2. 验证码：答题或图形验证码
3. 风控：检测异常行为模式
4. 黑名单：封禁作弊用户
```

### 问题三：「资金系统如何保证一致性？」

**回答思路**：

```
1. 乐观锁：版本号控制并发更新
2. 分布式事务：TCC 或 Saga 模式
3. 对账：定期核对资金流水
4. 补偿机制：异常时自动补偿
```


## 七、总结

```
┌─────────────────────────────────────────────────────────┐
│                 红包/抽奖系统设计要点                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  核心问题                                              │
│  ├── 资金一致性：乐观锁 + 资金流水                 │
│  ├── 库存不超发：Redis 原子扣减                  │
│  └── 随机公平性：二倍均值算法                  │
│                                                         │
│  高并发处理                                          │
│  ├── 多级削峰：CDN → 验证码 → 限流 → MQ     │
│  ├── 热点数据：Redis 缓存 + 预热              │
│  └── 异步处理：消息队列解耦                      │
│                                                         │
│  安全防护                                              │
│  ├── 防刷：限流 + 验证码 + 风控               │
│  ├── 对账：定期核对资金流水                  │
│  └── 补偿：异常时自动补偿                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> "红包雨系统的本质是：在瞬时高并发下，保证资金安全和用户体验的平衡。"
