# 设计一次性密码（OTP）系统

你有没有想过：

- 登录时收到的 6 位数字验证码是怎么生成的？
- 为什么短信验证码有时效性？
- 为什么有些验证码只能用一次？

今天，我们来深入探讨一次性密码（OTP）系统的设计与实现。

---

## 一、OTP 系统概述

### 1.1 OTP 的类型

```
┌─────────────────────────────────────────────────────────┐
│                    OTP 的两种类型                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  HOTP（基于 HMAC 的一次性密码）                         │
│  ├─ 计数器模式                                        │
│  ├─ 服务端和客户端共享密钥                              │
│  ├─ 密码 = HMAC-SHA1(密钥, 计数器)                    │
│  └─ 每次使用后计数器递增                               │
│                                                         │
│  TOTP（基于时间的一次性密码）                           │
│  ├─ 时间模式                                         │
│  ├─ 密码 = HMAC-SHA1(密钥, 时间戳)                   │
│  └─ 每 30 秒生成一个新密码                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 应用场景

- **短信验证码**：登录、注册、支付确认
- **邮箱验证码**：密码找回、安全验证
- **双因素认证**：Google Authenticator、Microsoft Authenticator
- **动态口令卡**：银行 U 盾、企业 VPN

---

## 二、TOTP 算法实现

### 2.1 核心算法

```java
/**
 * TOTP（Time-based One-Time Password）实现
 */
public class TOTPAlgorithm {
    
    /**
     * TOTP 算法核心
     * 
     * 步骤：
     * 1. 将当前时间戳转换为 8 字节整数（Big Endian）
     * 2. 使用 HMAC-SHA1 计算哈希
     * 3. 动态截取 4 个字节
     * 4. 将截取的字节转换为整数
     * 5. 取 10 的 6 次方模，得到 6 位数字
     */
    public static String generateTOTP(String secret, long timeStep, int digits) {
        // 1. 计算时间步长
        long counter = System.currentTimeMillis() / 1000 / timeStep;
        
        // 2. 将计数器转换为 8 字节数组
        byte[] counterBytes = new byte[8];
        for (int i = 7; i >= 0; i--) {
            counterBytes[i] = (byte) (counter & 0xff);
            counter >>>= 8;
        }
        
        // 3. 计算 HMAC-SHA1
        byte[] hash = hmacSha1(secret.getBytes(), counterBytes);
        
        // 4. 动态截断
        int offset = hash[hash.length - 1] & 0x0f;
        int binary = ((hash[offset] & 0x7f) << 24)
                | ((hash[offset + 1] & 0xff) << 16)
                | ((hash[offset + 2] & 0xff) << 8)
                | (hash[offset + 3] & 0xff);
        
        // 5. 生成数字密码
        int otp = binary % (int) Math.pow(10, digits);
        
        // 格式化输出（补齐前导零）
        return String.format("%0" + digits + "d", otp);
    }
    
    /**
     * HMAC-SHA1 实现
     */
    private static byte[] hmacSha1(byte[] key, byte[] data) {
        try {
            SecretKeySpec secretKey = new SecretKeySpec(key, "HmacSHA1");
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(secretKey);
            return mac.doFinal(data);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new RuntimeException(e);
        }
    }
    
    /**
     * 验证 OTP
     * 
     * 允许一定的时间偏移（前后各 1 个时间步长）
     * 防止时钟不同步导致的验证失败
     */
    public static boolean verifyTOTP(String secret, String otp, int timeStep, int digits) {
        long currentTime = System.currentTimeMillis() / 1000;
        
        // 允许前后各 1 个时间步长的偏移
        for (int i = -1; i <= 1; i++) {
            String expectedOtp = generateTOTP(secret, timeStep, digits);
            if (expectedOtp.equals(otp)) {
                return true;
            }
        }
        
        return false;
    }
}
```

### 2.2 密钥生成

```java
/**
 * OTP 密钥生成
 */
public class OTPSecretGenerator {
    
    /**
     * 生成随机密钥
     * 
     * 使用 Base32 编码，方便用户输入
     * Base32 字符集：A-Z, 2-7
     */
    public static String generateSecret() {
        // 生成 20 字节的随机数
        byte[] bytes = new byte[20];
        new SecureRandom().nextBytes(bytes);
        
        // 转换为 Base32
        return Base32.encode(bytes);
    }
    
    /**
     * 生成 QR Code URI（用于 Google Authenticator）
     * 
     * otpauth://totp/{issuer}:{account}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30
     */
    public static String generateOTPAuthURI(String issuer, String account, String secret) {
        try {
            return "otpauth://totp/" + URLEncoder.encode(issuer + ":" + account, "UTF-8")
                    + "?secret=" + secret
                    + "&issuer=" + URLEncoder.encode(issuer, "UTF-8")
                    + "&algorithm=SHA1"
                    + "&digits=6"
                    + "&period=30";
        } catch (UnsupportedEncodingException e) {
            throw new RuntimeException(e);
        }
    }
}
```

---

## 三、短信验证码系统

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                 短信验证码系统架构                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  用户请求验证码                                         │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────────────────────────┐                  │
│  │      验证码服务                    │                  │
│  │  ├─ 限流检查                      │                  │
│  │  ├─ 生成验证码                    │                  │
│  │  ├─ 发送短信                      │                  │
│  │  └─ 存储验证码                    │                  │
│  └─────────────────────────────────┘                  │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────────────────────────┐                  │
│  │      存储层                       │                  │
│  │  ├─ Redis（有效期 5 分钟）       │                  │
│  │  └─ 数据库（记录发送日志）         │                  │
│  └─────────────────────────────────┘                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 核心实现

```java
/**
 * 短信验证码服务
 */
public class SmsOTPService {
    
    private RedisTemplate<String, String> redis;
    private SmsSender smsSender;
    
    /**
     * 发送验证码
     */
    public SendResult sendVerificationCode(String phoneNumber) {
        // 1. 限流检查
        if (isRateLimited(phoneNumber)) {
            return SendResult.fail("发送太频繁，请稍后再试");
        }
        
        // 2. 检查发送次数
        if (exceedsDailyLimit(phoneNumber)) {
            return SendResult.fail("今日发送次数已用完");
        }
        
        // 3. 生成 6 位数字验证码
        String code = generateNumericCode(6);
        
        // 4. 存储到 Redis（有效期 5 分钟）
        String cacheKey = "otp:sms:" + phoneNumber;
        redis.opsForValue().set(cacheKey, code, Duration.ofMinutes(5));
        
        // 5. 记录发送次数
        incrementSendCount(phoneNumber);
        
        // 6. 发送短信
        try {
            smsSender.send(phoneNumber, "您的验证码是：" + code + "，5分钟内有效");
            return SendResult.success();
        } catch (Exception e) {
            // 发送失败，删除验证码
            redis.delete(cacheKey);
            return SendResult.fail("发送失败，请重试");
        }
    }
    
    /**
     * 验证验证码
     */
    public VerifyResult verifyCode(String phoneNumber, String code) {
        String cacheKey = "otp:sms:" + phoneNumber;
        String storedCode = redis.opsForValue().get(cacheKey);
        
        if (storedCode == null) {
            return VerifyResult.fail("验证码已过期");
        }
        
        if (!storedCode.equals(code)) {
            // 记录错误尝试次数
            recordFailedAttempt(phoneNumber);
            return VerifyResult.fail("验证码错误");
        }
        
        // 验证成功，删除验证码（只能验证一次）
        redis.delete(cacheKey);
        
        return VerifyResult.success();
    }
    
    /**
     * 生成数字验证码
     */
    private String generateNumericCode(int length) {
        Random random = new Random();
        StringBuilder sb = new StringBuilder();
        
        for (int i = 0; i < length; i++) {
            sb.append(random.nextInt(10));
        }
        
        return sb.toString();
    }
}
```

### 3.3 安全防护

```java
/**
 * OTP 安全防护
 */
public class OTPSecurityProtection {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 限流检查
     * 
     * 使用滑动窗口算法
     */
    public boolean isRateLimited(String phoneNumber) {
        String key = "otp:rate:" + phoneNumber;
        Long count = redis.opsForValue().increment(key);
        
        if (count == 1) {
            // 第一次，设置过期时间（1 分钟窗口）
            redis.expire(key, Duration.ofMinutes(1));
        }
        
        // 每分钟最多发送 3 次
        return count > 3;
    }
    
    /**
     * 每日发送限制
     */
    public boolean exceedsDailyLimit(String phoneNumber) {
        String key = "otp:daily:" + phoneNumber;
        Long count = redis.opsForValue().increment(key);
        
        if (count == 1) {
            // 第一次，设置过期时间（当天剩余时间）
            long secondsUntilMidnight = getSecondsUntilMidnight();
            redis.expire(key, Duration.ofSeconds(secondsUntilMidnight));
        }
        
        // 每天最多发送 10 次
        return count > 10;
    }
    
    /**
     * 错误尝试限制
     * 
     * 连续错误 5 次后锁定 30 分钟
     */
    public boolean isLocked(String phoneNumber) {
        String key = "otp:lock:" + phoneNumber;
        return Boolean.TRUE.equals(redis.hasKey(key));
    }
    
    /**
     * 记录错误尝试
     */
    public void recordFailedAttempt(String phoneNumber) {
        String key = "otp:fail:" + phoneNumber;
        Long count = redis.opsForValue().increment(key);
        
        if (count == 1) {
            redis.expire(key, Duration.ofMinutes(30));
        }
        
        // 连续错误 5 次，锁定 30 分钟
        if (count >= 5) {
            String lockKey = "otp:lock:" + phoneNumber;
            redis.opsForValue().set(lockKey, "1", Duration.ofMinutes(30));
        }
    }
}
```

---

## 四、存储设计

### 4.1 Redis 存储结构

```java
/**
 * OTP 存储结构设计
 */
public class OTPStorageDesign {
    
    /**
     * 短信验证码存储
     * 
     * Key: otp:sms:{phoneNumber}
     * Value: {code}:{createTime}
     * TTL: 5 分钟
     */
    public static final String SMS_OTP_KEY = "otp:sms:%s";
    
    /**
     * 发送限流存储
     * 
     * Key: otp:rate:{phoneNumber}
     * Value: count
     * TTL: 1 分钟
     */
    public static final String RATE_LIMIT_KEY = "otp:rate:%s";
    
    /**
     * 每日发送计数
     * 
     * Key: otp:daily:{phoneNumber}
     * Value: count
     * TTL: 当天剩余秒数
     */
    public static final String DAILY_COUNT_KEY = "otp:daily:%s";
    
    /**
     * 错误尝试计数
     * 
     * Key: otp:fail:{phoneNumber}
     * Value: count
     * TTL: 30 分钟
     */
    public static final String FAIL_COUNT_KEY = "otp:fail:%s";
    
    /**
     * 锁定状态
     * 
     * Key: otp:lock:{phoneNumber}
     * Value: "1"
     * TTL: 30 分钟
     */
    public static final String LOCK_KEY = "otp:lock:%s";
}
```

### 4.2 发送日志

```java
/**
 * OTP 发送日志
 */
public class OTPSendLogService {
    
    /**
     * 发送日志表
     */
    public static final String CREATE_TABLE = """
        CREATE TABLE otp_send_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            phone_number VARCHAR(20) NOT NULL,
            otp_code VARCHAR(10) NOT NULL COMMENT '加密存储',
            send_status TINYINT NOT NULL COMMENT '0-发送中 1-成功 2-失败',
            send_channel VARCHAR(20) COMMENT '发送渠道：阿里云、腾讯云等',
            ip_address VARCHAR(50),
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            INDEX idx_phone_time (phone_number, created_at),
            INDEX idx_ip_time (ip_address, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
    
    /**
     * 记录发送日志
     */
    public void logSendResult(String phoneNumber, String code, 
                             SendStatus status, String channel,
                             String ipAddress) {
        // 对验证码加密存储（防止日志泄露）
        String encryptedCode = encryptCode(code);
        
        String sql = """
            INSERT INTO otp_send_logs 
            (phone_number, otp_code, send_status, send_channel, ip_address)
            VALUES (?, ?, ?, ?, ?)
            """;
        
        jdbcTemplate.update(sql, phoneNumber, encryptedCode, 
            status.getCode(), channel, ipAddress);
    }
    
    /**
     * 验证码加密
     * 
     * 使用 AES 加密，密钥定期轮换
     */
    private String encryptCode(String code) {
        // AES 加密实现
        return encryptedCode;
    }
}
```

---

## 五、面试追问方向

### 问题一：「如何防止验证码被暴力破解？」

**回答思路**：

```
1. 限流：每分钟最多发送 N 次
2. 错误次数限制：连续错误 5 次后锁定
3. 图形验证码：连续失败后要求输入图形验证码
4. IP 限制：同一 IP 发送次数限制
5. 智能风控：检测异常行为模式
```

### 问题二：「如何实现 TOTP 的多设备支持？」

**回答思路**：

```
1. 每个用户可以绑定多个设备
2. 每个设备有独立的密钥
3. 验证时检查任意一个设备生成的密码即可
4. 支持设备解绑和恢复
```

### 问题三：「验证码过期后如何处理？」

**回答思路**：

```
1. 提示「验证码已过期」，要求重新获取
2. 不提示具体错误（防止猜测）
3. 新验证码会覆盖旧验证码
4. 旧验证码立即失效
```

---

## 六、总结

```
┌─────────────────────────────────────────────────────────┐
│                   OTP 系统设计要点                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  OTP 算法                                              │
│  ├── TOTP：基于时间，每 30 秒生成新密码                │
│  ├── HOTP：基于计数器，使用后递增                     │
│  └── 核心：HMAC-SHA1 + 动态截断                      │
│                                                         │
│  安全防护                                              │
│  ├── 发送限流：每分钟/每天限制次数                    │
│  ├── 错误限制：连续错误后锁定                        │
│  ├── 有效期控制：验证码 5 分钟有效                   │
│  └── 日志审计：记录所有发送和验证行为               │
│                                                         │
│  存储设计                                              │
│  ├── Redis：验证码、限流、计数                     │
│  └── MySQL：发送日志、审计追踪                     │
│                                                         │
│  工程实践                                              │
│  ├── 验证码加密存储                                  │
│  ├── 多因素验证                                      │
│  └── 异常行为检测                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> "OTP 系统的本质是：在便捷性和安全性之间找到平衡，用一次性密码实现无密钥的安全认证。"
