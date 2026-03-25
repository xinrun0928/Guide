# 受检异常 vs 非受检异常：Java 的设计抉择

---

你一定遇到过这种情况：写一个读取文件的方法，编译器报错「未处理的 IOException」。

```java
public String readFile(String path) {
    FileReader reader = new FileReader(path); // 编译错误！
    // ...
}
```

你可能心里嘀咕：这破编译器怎么这么烦人？我只是想读个文件而已。

但这个「烦人」的设计背后，是 Java 设计者深思熟虑的权衡。

## 什么是受检异常？

**受检异常（Checked Exception）**是指编译器**强制要求处理**的异常。要么用 try-catch 捕获，要么用 throws 声明抛出。

```java
// 方式一：捕获处理
public String readFile(String path) {
    try {
        FileReader reader = new FileReader(path);
        return readAllContent(reader);
    } catch (IOException e) {
        return "读取失败：" + e.getMessage();
    }
}

// 方式二：声明抛出
public String readFile(String path) throws IOException {
    FileReader reader = new FileReader(path);
    return readAllContent(reader);
}
```

### 常见的受检异常

| 异常类型 | 触发场景 |
|---|---|
| `IOException` | IO 操作失败 |
| `FileNotFoundException` | 文件不存在 |
| `SQLException` | 数据库操作失败 |
| `ClassNotFoundException` | 类加载失败 |
| `ParseException` | 字符串解析失败 |
| `NoSuchMethodException` | 方法不存在 |
| `InterruptedException` | 线程中断 |

## 什么是非受检异常？

**非受检异常（Unchecked Exception）**是编译器**不强制处理**的异常，包括 `RuntimeException` 及其子类。

```java
// 不需要任何处理，编译器不报错
public int divide(int a, int b) {
    return a / b; // 可能会 ArithmeticException
}

public void printLength(String str) {
    System.out.println(str.length()); // 可能会 NPE
}
```

### 常见的非受检异常

| 异常类型 | 触发场景 |
|---|---|
| `NullPointerException` | 空指针访问 |
| `ArrayIndexOutOfBoundsException` | 数组越界 |
| `ClassCastException` | 类型转换错误 |
| `IllegalArgumentException` | 非法参数 |
| `IllegalStateException` | 非法状态 |
| `ConcurrentModificationException` | 并发修改 |
| `UnsupportedOperationException` | 不支持的操作 |

## 设计意图：为什么区分受检与非受检？

### Java 设计者的初衷

受检异常的设计初衷是**强制程序员正视可能的失败**：

```
文件读取可能失败 → 你必须处理
数据库操作可能失败 → 你必须处理
网络请求可能失败 → 你必须处理
```

这些都是**可预期的外部因素**，不应该被忽视。

### 反对声音

但实践中，受检异常带来了不少问题：

```java
// 一个简单的文件读取，受检异常让代码变得臃肿
public String readConfig(String path) throws IOException {
    File file = new File(path);
    FileInputStream fis = null;
    BufferedReader reader = null;
    try {
        fis = new FileInputStream(file);
        reader = new BufferedReader(new InputStreamReader(fis));
        StringBuilder content = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            content.append(line);
        }
        return content.toString();
    } finally {
        // 关闭资源（JDK 7 之前需要这样写）
        if (reader != null) try { reader.close(); } catch (IOException e) {}
        if (fis != null) try { fis.close(); } catch (IOException e) {}
    }
}
```

**异常传播的噩梦**：如果你不想在当前层处理异常，向上抛；但上层可能也不想处理，继续抛……最后可能抛到 `main` 方法。

## 受检异常 vs 非受检异常对比

| 特性 | 受检异常 | 非受检异常 |
|---|---|---|
| 编译器检查 | ✓（强制处理） | ✗ |
| 处理要求 | try-catch 或 throws | 不强制 |
| 典型场景 | 外部环境问题 | 编程错误 |
| 能否预防 | 难以预防 | 通常可预防 |
| 处理策略 | 恢复或转换 | 避免或快速失败 |

## 最佳实践：什么情况下用什么？

### 场景一：外部因素导致的失败 → 受检异常

```java
// 数据库连接失败、网络超时、文件不存在
// 这些是外部环境问题，调用者应该决定如何处理
public User findById(Long id) throws UserNotFoundException {
    User user = userRepository.findById(id);
    if (user == null) {
        throw new UserNotFoundException("用户不存在：" + id);
    }
    return user;
}
```

### 场景二：编程错误 → 非受检异常

```java
// 空指针、非法参数、状态错误
// 这些是调用者的错误，应该让程序快速失败
public void setAge(int age) {
    if (age &lt; 0 || age &gt; 150) {
        throw new IllegalArgumentException("年龄非法：" + age);
    }
    this.age = age;
}
```

### 场景三：业务异常 → 到底用哪个？

这是最有争议的地方。两种做法都有支持者：

**做法一：用受检异常（传统 Java 风格）**

```java
public void withdraw(Account account, BigDecimal amount)
        throws InsufficientBalanceException, AccountFrozenException {

    if (account.isFrozen()) {
        throw new AccountFrozenException("账户已冻结");
    }

    if (account.getBalance().compareTo(amount) &lt; 0) {
        throw new InsufficientBalanceException("余额不足");
    }

    account.setBalance(account.getBalance().subtract(amount));
}
```

**做法二：用非受检异常（现代 Java 风格，更推荐）**

```java
public void withdraw(Account account, BigDecimal amount) {
    if (account.isFrozen()) {
        throw new AccountFrozenException("账户已冻结");
    }

    if (account.getBalance().compareTo(amount) &lt; 0) {
        throw new InsufficientBalanceException("余额不足");
    }

    account.setBalance(account.getBalance().subtract(amount));
}
```

## 为什么现代 Java 更倾向非受检异常？

### 理由一：受检异常破坏 API 契约

```java
// 你写了一个很好的接口
interface UserService {
    User findById(Long id) throws UserNotFoundException;
}

// 后来你换了实现，不想抛受检异常了
class CacheUserService implements UserService {
    public User findById(Long id) { // 无法 throws 新异常
        // ...
    }
}
```

### 理由二：异常处理过于繁琐

Java 7 引入的**异常链**和**多异常捕获**虽然改善了一些问题，但受检异常的本质问题没解决：

```java
// JDK 7 改进后的写法
try {
    doSomething();
} catch (IOException | SQLException e) {
    log.error("操作失败", e);
}
```

### 理由三：业务异常应该统一处理

在 Spring 等现代框架中，通常有统一的异常处理机制：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public Result handleBusinessException(BusinessException e) {
        return Result.error(e.getMessage());
    }
}
```

让所有业务异常都继承 `RuntimeException`，有利于统一处理。

## 总结：选择指南

```
遇到异常时，问自己三个问题：

1. 调用者能否恢复？
   - 能 → 处理异常
   - 不能 → 继续

2. 期望的异常类型是什么？
   - 外部因素（IO、网络） → 受检异常
   - 编程错误（非法参数） → 非受检异常
   - 业务规则违反 → 非受检异常（推荐）

3. API 层级在哪里？
   - 底层 API → 保留受检异常
   - 业务层 → 转换为非受检异常
```

## 面试追问方向

- 你觉得 Java 的受检异常设计是好是坏？为什么？
- 如果让你设计异常体系，你会怎么做？
- 为什么 JDBC 用受检异常，而现代 ORM（如 MyBatis）用非受检异常？

## 留给你的思考题

假设你在开发一个支付模块，有以下场景需要处理：

1. 余额不足
2. 账户被冻结
3. 密码错误
4. 网络超时（调用第三方支付）
5. 系统内部错误（数据库连接失败）

请为每个场景选择异常类型（受检/非受检），并说明理由。

更进一步：如果让你设计支付模块的异常类结构，你会如何组织？
