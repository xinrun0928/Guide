# 自定义异常：优雅地表达业务错误

---

你有没有见过这样的代码？

```java
try {
    doSomething();
} catch (Exception e) {
    throw new Exception("出错了");
}
```

或者这样的异常类？

```java
public class MyException extends Exception {
}
```

这种写法看似「能用」，但实际上问题很多。好的自定义异常需要考虑：继承谁、如何组织异常链、是否需要序列化支持。让我来告诉你正确答案。

## 继承谁？RuntimeException 还是 Exception？

这是第一个需要做的决定。

| 选择 | 适用场景 | 特点 |
|---|---|---|
| `extends Exception` | 需要强制处理 | 受检异常，IDE 和编译器都会提示 |
| `extends RuntimeException` | 不需要强制处理 | 非受检异常，更灵活 |

### 推荐：业务异常继承 RuntimeException

现代 Java 开发中，**推荐所有业务异常都继承 RuntimeException**：

```java
// 推荐：业务异常
public class BusinessException extends RuntimeException {
    public BusinessException(String message) {
        super(message);
    }

    public BusinessException(String message, Throwable cause) {
        super(message, cause);
    }
}

// 不推荐：除非有特殊原因
public class BusinessException extends Exception {
    // ...
}
```

### 理由

1. **避免异常污染**：如果每个方法都要 throws 声明或 try-catch，代码会变得臃肿
2. **统一异常处理**：在 Web 应用中，通常有全局异常处理器统一处理
3. **符合开闭原则**：业务变更时不需要改方法签名

## 标准异常结构

一个完整的自定义异常应该包含以下构造函数：

```java
public class OrderException extends RuntimeException {

    // 序列化版本号
    private static final long serialVersionUID = 1L;

    // 错误码（便于追踪和国际化）
    private String errorCode;

    public OrderException(String message) {
        super(message);
    }

    public OrderException(String message, Throwable cause) {
        super(message, cause);
    }

    public OrderException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public OrderException(String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    // 如果需要序列化，提供这个构造函数
    protected OrderException(String errorCode, String message,
                             Throwable cause, boolean enableSuppression,
                             boolean writableStackTrace) {
        super(message, cause, enableSuppression, writableStackTrace);
        this.errorCode = errorCode;
    }

    public String getErrorCode() {
        return errorCode;
    }
}
```

**关键点**：

1. `serialVersionUID` 必须有（支持序列化）
2. 提供消息构造器和消息+原因构造器
3. 考虑是否需要错误码

## 不要直接抛出 Exception 或 RuntimeException

这是一个严重的代码坏味道：

```java
// 错误：太笼统，调用者不知道是什么类型的错误
throw new RuntimeException("出错了");
throw new Exception("出错了");

// 正确：抛出具体异常
throw new IllegalArgumentException("年龄不能为负数");
throw new OrderException("ORD001", "订单不存在");
```

**异常类型本身就是重要的信息。** `NullPointerException` 告诉你空指针问题，`IllegalArgumentException` 告诉你参数错误。`RuntimeException` 什么都没说。

## 异常链：正确传递根本原因

异常链确保问题的根源不会丢失：

```java
public class UserService {

    public User findById(Long id) {
        try {
            return jdbcTemplate.queryForObject(
                "SELECT * FROM users WHERE id = ?",
                userRowMapper,
                id
            );
        } catch (DataAccessException e) {
            // 错误：丢失了数据库异常信息
            throw new RuntimeException("查询用户失败");

            // 正确：保留异常链
            throw new UserNotFoundException("用户不存在: " + id, e);

            // 或者用 initCause
            RuntimeException re = new RuntimeException("查询用户失败");
            re.initCause(e);
            throw re;
        }
    }
}
```

**异常链传递的不只是错误消息，还有完整的堆栈信息。**

## 异常类层次设计

一个良好的异常体系应该是有层级的：

```
RuntimeException
├── ServiceException（服务层基类）
│   ├── UserException
│   │   ├── UserNotFoundException
│   │   ├── UserAlreadyExistsException
│   │   └── UserDisabledException
│   ├── OrderException
│   │   ├── OrderNotFoundException
│   │   ├── InsufficientBalanceException
│   │   └── OrderStatusException
│   └── ProductException
│       ├── ProductNotFoundException
│       └── ProductOutOfStockException
└── SystemException（系统层基类）
    ├── DatabaseException
    ├── NetworkException
    └── ExternalServiceException
```

### 基类定义

```java
// 业务异常基类
public class ServiceException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String errorCode;

    public ServiceException(String message) {
        super(message);
        this.errorCode = "UNKNOWN";
    }

    public ServiceException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public ServiceException(String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public String getErrorCode() {
        return errorCode;
    }
}
```

### 子类实现

```java
public class UserNotFoundException extends ServiceException {

    private static final long serialVersionUID = 1L;

    private final Long userId;

    public UserNotFoundException(Long userId) {
        super("USER_NOT_FOUND", "用户不存在: " + userId);
        this.userId = userId;
    }

    public UserNotFoundException(Long userId, Throwable cause) {
        super("USER_NOT_FOUND", "用户不存在: " + userId, cause);
        this.userId = userId;
    }

    public Long getUserId() {
        return userId;
    }
}
```

## 异常的最佳实践

### 实践一：不要吞掉异常

```java
// 错误：异常被吞掉，完全不知道发生了什么
try {
    doSomething();
} catch (Exception e) {
    // 什么都不做
}

// 错误：只记录日志然后继续
try {
    doSomething();
} catch (Exception e) {
    log.error("错误", e);
}

// 正确：要么处理，要么传播
try {
    doSomething();
} catch (Exception e) {
    throw new SpecificException("操作失败", e);
}
```

### 实践二：不要捕获再抛出同一异常

```java
// 错误：多此一举，堆栈信息被截断
try {
    doSomething();
} catch (IOException e) {
    throw new IOException(e.getMessage());
}

// 正确：保留完整的异常链
try {
    doSomething();
} catch (IOException e) {
    throw new CustomException("操作失败", e);
}
```

### 实践三：异常信息要清晰

```java
// 错误：信息不够具体
throw new Exception("操作失败");

// 改进：说明是什么操作
throw new OrderException("创建订单失败");

// 更好：包含上下文信息
throw new OrderException("ORD_CREATE_FAILED",
    "创建订单失败，用户ID: " + userId + ", 金额: " + amount);
```

### 实践四：抛异常要慎重

```java
// 错误：用异常做流程控制
public User findUser(Long id) {
    if (count(id) == 0) {
        throw new UserNotFoundException(id); // 异常用于正常流程？
    }
    return get(id);
}

// 正确：用返回值表示正常情况
public Optional&lt;User&gt; findUser(Long id) {
    return findById(id); // Optional 表示可能为空
}

// 或者提供两种方法
public boolean exists(Long id) { ... }
public User getRequired(Long id) { ... } // 找不到就抛异常
```

## 面试追问方向

- 为什么自定义异常要继承 RuntimeException 而不是 Exception？
- 异常链（cause）有什么作用？如何正确使用？
- 为什么不要在 finally 块中抛出异常？

## 留给你的思考题

假设你在开发一个电商系统，需要处理以下几种错误情况：

1. 用户名已存在（注册时）
2. 余额不足（支付时）
3. 订单不存在（查询时）
4. 库存不足（下单时）
5. 数据库连接超时（任何时候）

请设计这个系统的异常类体系，并说明：

1. 每个异常应该继承哪个基类？
2. 是否需要错误码？为什么？
3. 如何让调用者能够区分不同类型的错误？
4. 全局异常处理器应该怎么设计？

实际代码演练比背概念更能加深理解。
