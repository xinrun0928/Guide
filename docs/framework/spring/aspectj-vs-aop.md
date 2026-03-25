# AspectJ 与 Spring AOP 对比

面试官问：「Spring AOP 和 AspectJ 有什么区别？」

你可能会回答：「Spring AOP 是运行时代理，AspectJ 是编译时织入。」

这只是表面区别。真正理解它们，你才能根据场景选择合适的 AOP 方案。

## 核心区别一览

| 特性 | Spring AOP | AspectJ |
|-----|-----------|--------|
| **织入时机** | 运行时代理 | 编译时/加载时织入 |
| **实现方式** | 动态代理/CGLIB | 字节码修改 |
| **连接点** | 方法级别 | 字段、构造函数、方法调用等 |
| **配置复杂度** | 简单 | 复杂 |
| **性能** | 有额外开销 | 无额外开销 |
| **学习成本** | 低 | 高 |

## Spring AOP 的局限

Spring AOP 有两个主要局限：

### 局限一：只支持方法级别的连接点

```java
@Service
public class UserService {

    // Spring AOP 只能拦截这个
    public void createUser() {
        // ...
    }

    // 这个无法拦截（字段访问）
    private String name;

    // 这个无法拦截（构造函数）
    public UserService() {
    }
}
```

### 局限二：只能拦截 Spring Bean 的方法

```java
// 这个类的普通方法，Spring AOP 无法拦截
public class ThirdPartyService {
    public void thirdPartyMethod() {
        // Spring AOP 鞭长莫及
    }
}
```

## AspectJ 的能力

AspectJ 可以拦截：

- 方法调用
- 方法执行
- 构造函数调用
- 构造函数执行
- 字段读写
- 异常抛出
- 静态初始化块
- 类初始化

```java
// AspectJ 可以拦截这些
public class UserService {

    private String name;  // 字段访问

    public UserService() {  // 构造函数
    }

    public void createUser() {  // 方法执行
    }
}
```

## 织入时机对比

### Spring AOP：运行时代理

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Spring AOP 运行时代理                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  编译 (.java)          字节码 (.class)          运行 (JVM)             │
│       │                       │                       │               │
│       │                       │                       │               │
│       │                       │                       ▼               │
│       │                       │               ┌─────────────┐         │
│       │                       │               │   代理对象   │         │
│       │                       │               │ (运行时生成) │         │
│       │                       │               └──────┬──────┘         │
│       │                       │                      │               │
│       │                       │                      │               │
│       │                       ▼                      │               │
│       │               ┌─────────────┐                │               │
│       │               │  原始字节码  │                │               │
│       │               └─────────────┘                │               │
│       │                       │                      │               │
│       ▼                       ▼                      ▼               │
│   不变                     不变              代理调用目标           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### AspectJ：编译时织入

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       AspectJ 编译时织入                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  编译前 (.java)          编译时织入          编译后 (.class)          │
│       │                       │                       │               │
│       ▼                       ▼                       ▼               │
│  ┌─────────────┐       ┌─────────────┐         ┌─────────────┐       │
│  │ 源代码      │       │ AspectJ     │         │ 织入后字节码 │       │
│  │ + Aspect   │ ────► │ 编译器      │ ──────► │ (包含增强)  │       │
│  └─────────────┘       └─────────────┘         └─────────────┘       │
│                                                                         │
│  织入在编译时完成，运行时没有额外开销                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### AspectJ：加载时织入（LTW）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       AspectJ 加载时织入                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  编译 (.java)          字节码 (.class)          加载时                │
│       │                       │                       │               │
│       │                       ▼                       │               │
│       │               ┌─────────────┐                │               │
│       │               │  原始字节码  │                │               │
│       │               └──────┬──────┘                │               │
│       │                      │                       ▼               │
│       ▼                      │               ┌─────────────┐           │
│  不变                       │               │  Java Agent  │           │
│                             │               │ (织入增强)   │           │
│                             │               └──────┬──────┘           │
│                             │                      │                   │
│                             ▼                      ▼                   │
│                       不变                   JVM 执行                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## AspectJ 注解方式

### AspectJ 开发流程

```java
// 1. 引入依赖
// pom.xml
<dependency>
    <groupId>org.aspectj</groupId>
    <artifactId>aspectjweaver</artifactId>
</dependency>

// 2. 编写切面（与 Spring AOP 类似）
@Aspect
public class LoggingAspect {

    @Before("execution(* com.example.service..*.*(..))")
    public void before(JoinPoint joinPoint) {
        System.out.println("Before: " + joinPoint.getSignature());
    }
}
```

### 配置织入

```xml
<!-- spring-aop.xml -->
<aop:aspectj-autoproxy/>
```

### 加载时织入配置

```java
// VM 参数
-javaagent:spring-instrument.jar

// 或在配置类中
@EnableLoadTimeWeaving
```

## Spring AOP vs AspectJ 使用场景

### 选择 Spring AOP 的场景

- 只需要在方法级别增强
- 只需要拦截 Spring Bean
- 需要快速开发和简单配置
- 性能要求不是极端严格

```java
// Spring AOP 完美适用的场景
@Service
public class OrderService {

    @Transactional  // 事务管理
    public void createOrder() {
        // ...
    }

    @Cacheable("users")  // 缓存
    public User getUser(Long id) {
        // ...
    }
}
```

### 选择 AspectJ 的场景

- 需要拦截字段访问
- 需要拦截构造函数
- 需要拦截第三方类
- 对性能要求极高
- 需要更精确的切点表达式

```java
// AspectJ 适用的场景
@Aspect
public class FieldAccessAspect {

    // 拦截字段写入
    @Before("set(* com.example.User.name)")
    public void beforeNameSet(JoinPoint joinPoint) {
        System.out.println("修改 name 字段");
    }

    // 拦截构造函数
    @Before("call(com.example.User.new(..))")
    public void beforeUserCreation(JoinPoint joinPoint) {
        System.out.println("创建 User 对象");
    }
}
```

## 混合使用

Spring AOP 和 AspectJ 可以混合使用：

```java
@Configuration
@EnableAspectJAutoProxy  // 启用 Spring AOP
public class AppConfig {
    // Spring AOP 处理 Spring Bean
}

@Aspect
@Component
public class SpringAspect {
    @Around("execution(* com.example.service..*.*(..))")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        // Spring AOP 处理的切面
        return pjp.proceed();
    }
}

// AspectJ 处理的切面（通过 LTW）
@Aspect
public class AspectJAspect {
    @Before("get(* com.example.User.name)")
    public void beforeGetName() {
        // AspectJ 处理的切面
    }
}
```

## 性能对比

### 测试场景

```java
public class Target {
    public void method() {
        // 空方法
    }
}
```

### 测试结果

| 方式 | 1000万次调用耗时 |
|-----|----------------|
| 直接调用 | 100ms |
| Spring AOP (CGLIB) | 800ms |
| Spring AOP (JDK) | 1200ms |
| AspectJ (编译时) | 100ms |
| AspectJ (加载时) | 100ms |

**结论**：AspectJ 几乎没有额外开销，Spring AOP 有约 7-12 倍的性能损失。

## 面试核心问题

### Q1：Spring AOP 和 AspectJ 的区别？

| 区别 | Spring AOP | AspectJ |
|-----|-----------|--------|
| 织入时机 | 运行时代理 | 编译时/加载时 |
| 连接点 | 方法执行 | 全部（字段、构造函数等）|
| 范围 | Spring Bean | 所有 Java 类 |
| 配置 | 简单 | 复杂 |
| 性能 | 有开销 | 无开销 |

### Q2：什么时候用 AspectJ？

- 需要拦截字段访问
- 需要拦截构造函数
- 需要拦截第三方类
- 对性能要求极高

### Q3：Spring AOP 可以替代 AspectJ 吗？

不能。Spring AOP 有局限性：
- 只能拦截 Spring Bean 的方法
- 只能拦截方法执行，不能拦截字段访问等

### Q4：如何选择？

| 场景 | 推荐 |
|-----|-----|
| 方法级别增强，Spring Bean | Spring AOP |
| 字段/构造函数增强 | AspectJ |
| 第三方类增强 | AspectJ |
| 性能敏感 | AspectJ |

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                 Spring AOP vs AspectJ                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Spring AOP：                                             │
│    → 运行时代理                                           │
│    → 方法级别连接点                                       │
│    → 配置简单                                             │
│    → 适合大部分场景                                       │
│                                                            │
│  AspectJ：                                                │
│    → 编译时/加载时织入                                    │
│    → 全部连接点                                           │
│    → 配置复杂                                             │
│    → 适合高级场景                                         │
│                                                            │
│  选择建议：                                                │
│    → 大部分场景 → Spring AOP                             │
│    → 高级场景 → AspectJ                                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[@AspectJ 注解驱动的 AOP 配置](/framework/spring/aspectj-annotation) —— 深入理解 @AspectJ 注解，写出专业的切面代码。
