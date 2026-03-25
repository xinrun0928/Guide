# JDK 动态代理 vs CGLIB 动态代理

你知道 Spring AOP 为什么能在一个方法调用前后「偷偷」加上切面逻辑吗？

答案是：**代理**。

但同样是代理，Spring 用了两套完全不同的技术：JDK 动态代理和 CGLIB 动态代理。它们各有各的脾气，你知道什么时候用哪个吗？

## 代理模式：给对象找个「替身」

在讲动态代理之前，先理解代理模式的核心思想：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   客户端    │ ──► │    代理     │ ──► │   真实对象  │
│   (User)    │     │  (Proxy)   │     │   (Real)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

代理对象持有真实对象的引用，客户端以为自己调用的是真实对象，实际上请求先经过代理，代理可以在调用前后做额外处理。

### 静态代理的局限

如果用静态代理，每个类都要写一个对应的代理类：

```java
// 真实对象
public class UserServiceImpl implements UserService {
    @Override
    public void save(User user) {
        System.out.println("保存用户");
    }
}

// 静态代理
public class UserServiceProxy implements UserService {
    private UserService target;  // 持有真实对象

    public UserServiceProxy(UserService target) {
        this.target = target;
    }

    @Override
    public void save(User user) {
        System.out.println("代理前: 记录日志");
        target.save(user);  // 调用真实对象
        System.out.println("代理后: 记录日志");
    }
}
```

问题来了：
- 如果有 100 个 Service，就得写 100 个代理类
- 代理逻辑改一下，所有代理类都要改
- 代理类和真实对象必须实现同一接口

**动态代理**就是为了解决这些问题——在运行时动态生成代理类，而不是提前写好。

## JDK 动态代理

### 核心原理

JDK 动态代理要求被代理的类**必须实现接口**。它通过 `Proxy.newProxyInstance()` 在运行时动态生成代理类。

```java
public class JdkProxyDemo {

    public static void main(String[] args) {
        // 1. 创建真实对象
        UserService target = new UserServiceImpl();

        // 2. 创建InvocationHandler（调用处理器）
        InvocationHandler handler = new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
                // 代理逻辑
                System.out.println("【JDK代理】方法执行前...");

                // 调用真实对象的方法
                Object result = method.invoke(target, args);

                System.out.println("【JDK代理】方法执行后...");
                return result;
            }
        };

        // 3. 动态生成代理对象
        UserService proxy = (UserService) Proxy.newProxyInstance(
                UserService.class.getClassLoader(),  // 类加载器
                new Class[]{UserService.class},      // 接口数组
                handler                              // 调用处理器
        );

        // 4. 调用代理对象的方法
        proxy.save(new User());  // 实际调用的是代理
    }
}
```

### 生成的代理类结构

`Proxy.newProxyInstance` 生成的代理类大概长这样：

```java
public final class $Proxy11 extends Proxy implements UserService {
    private InvocationHandler h;

    public $Proxy11(InvocationHandler h) {
        this.h = h;
    }

    @Override
    public void save(User user) {
        // 调用InvocationHandler的invoke方法
        h.invoke(this, m3, new Object[]{user});
    }
}
```

可以看到：
- 代理类继承 `Proxy`，实现 `UserService` 接口
- 代理类持有 `InvocationHandler` 引用
- 方法调用都转发给 `InvocationHandler.invoke()`

### 关键特点

| 特点 | 说明 |
|-----|------|
| **必须实现接口** | 代理类和被代理类必须实现同一接口 |
| **基于接口** | 代理的是接口，不是具体类 |
| **性能** | 调用效率高（JDK 原生优化） |
| **限制** | 无法代理没有接口的类 |

## CGLIB 动态代理

### 核心原理

CGLIB（Code Generation Library）通过**继承**的方式动态生成子类来实现的。不需要被代理类实现接口。

```java
public class CglibProxyDemo {

    public static void main(String[] args) {
        // 1. 创建Enhancer
        Enhancer enhancer = new Enhancer();

        // 2. 设置父类（被代理的类）
        enhancer.setSuperclass(UserServiceImpl.class);

        // 3. 设置回调（类似InvocationHandler）
        enhancer.setCallback(new MethodInterceptor() {
            @Override
            public Object intercept(Object obj, Method method, Object[] args,
                                    MethodProxy proxy) throws Throwable {
                System.out.println("【CGLIB代理】方法执行前...");

                // 调用父类的方法
                // 注意：这里用proxy.invokeSuper而不是method.invoke
                // 这样才能真正调用被代理对象的方法
                Object result = proxy.invokeSuper(obj, args);

                System.out.println("【CGLIB代理】方法执行后...");
                return result;
            }
        });

        // 4. 创建代理对象
        UserServiceImpl proxy = (UserServiceImpl) enhancer.create();

        // 5. 调用代理对象的方法
        proxy.save(new User());
    }
}
```

### 生成的代理类结构

CGLIB 生成的代理类大概长这样：

```java
public class UserServiceImpl$$EnhancerByCGLIB$$3f8d9a12
        extends UserServiceImpl {

    private MethodInterceptor CGLIB$CALLBACK_0;

    @Override
    public void save(User user) {
        // 调用拦截器
        CGLIB$CALLBACK_0.intercept(this, ...);
    }
}
```

可以看到：
- 代理类是**被代理类的子类**
- 通过重写父类方法实现增强
- 使用 `MethodInterceptor` 处理方法调用

### 关键特点

| 特点 | 说明 |
|-----|------|
| **基于继承** | 代理类是目标类的子类 |
| **不需要接口** | 可以代理任意类 |
| **无法代理 final 类** | final 类不能被继承 |
| **无法代理 final 方法** | final 方法不能被重写 |

## 两种代理对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    JDK 代理 vs CGLIB 代理                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  JDK 动态代理:                                                    │
│  ┌───────────────┐      ┌───────────────┐                       │
│  │  $Proxy11    │ ───► │ Proxy类       │                       │
│  │ (实现接口)   │      │ (持有handler) │                       │
│  └───────┬───────┘      └───────────────┘                       │
│          │                                                        │
│          ▼                                                        │
│  ┌───────────────┐                                               │
│  │  UserService  │ ◄── 两者都实现这个接口                         │
│  └───────┬───────┘                                               │
│          │                                                        │
│          ▼                                                        │
│  ┌───────────────┐                                               │
│  │ UserServiceImpl│ (真实对象)                                   │
│  └───────────────┘                                               │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  CGLIB 动态代理:                                                 │
│  ┌─────────────────────────────────────┐                        │
│  │ UserServiceImpl$$EnhancerByCGLIB$$ │                        │
│  │         (继承UserServiceImpl)       │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                            │
│           重写父类方法                                            │
│                    │                                            │
│                    ▼                                            │
│  ┌─────────────────────────────────────┐                        │
│  │       UserServiceImpl (真实对象)    │                        │
│  └─────────────────────────────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Spring 中的选择规则

Spring 默认的代理策略是：

```
Spring AOP 代理选择逻辑：

  ┌──────────────────────────────────────┐
  │     被代理的类是否实现了接口？         │
  └────────────────┬─────────────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
        Yes                  No
         │                   │
         ▼                   ▼
  ┌─────────────┐    ┌─────────────┐
  │  JDK 代理   │    │  CGLIB 代理 │
  └─────────────┘    └─────────────┘
```

**但这个规则可以被打破！**

```java
// 强制使用CGLIB（Spring Boot默认就是这个）
@EnableAspectJAutoProxy(proxyTargetClass = true)

// 强制使用JDK代理
@EnableAspectJAutoProxy(proxyTargetClass = false)
```

### Spring Boot 的默认策略

Spring Boot 2.0 之后，`@EnableAspectJAutoProxy` 的 `proxyTargetClass` 默认值为 `true`，也就是说：

> **Spring Boot 默认使用 CGLIB 代理。**

好处是：即使你的 Service 没有实现接口，也能被代理。

## 性能对比

| 指标 | JDK 动态代理 | CGLIB 动态代理 |
|-----|-------------|---------------|
| **生成速度** | 快 | 较慢（需要生成字节码） |
| **调用速度** | 快 | 略慢（但经过优化后差距很小） |
| **总体性能** | 相当 | 相当 |
| **内存占用** | 较小 | 稍大（生成的类更大） |

**结论**：现代 JDK 下，两者性能差距可以忽略不计。选择哪个，主要看业务场景。

## 常见问题

### 为什么 Spring 不用 AspectJ 的编译时织入？

AspectJ 的编译时织入确实没有运行时开销，但需要额外的编译步骤（使用 ajc 编译器），配置复杂。而 Spring AOP 通过动态代理，零配置即可使用。

### 内部方法调用会走代理吗？

不会！

```java
@Service
public class UserServiceImpl {

    public void methodA() {
        this.methodB();  // this 指的是原始对象，不是代理！
    }

    public void methodB() {
        // 这个方法上的切面不会生效
    }
}
```

因为 `this.methodB()` 调用的是原始对象的 `methodB()`，绕过了代理。

**解决方案**：
1. 注入自己：`@Autowired private UserService userService;`
2. 使用 `AopContext.currentProxy()` 获取代理对象

## 面试核心问题

### Q1：JDK 代理和 CGLIB 代理的区别？

| 维度 | JDK 动态代理 | CGLIB 动态代理 |
|-----|-------------|---------------|
| 实现方式 | 实现接口，继承 Proxy | 继承被代理类 |
| 要求 | 被代理类必须实现接口 | 被代理类不能是 final |
| 代理范围 | 只代理接口方法 | 代理所有方法（除 final） |
| 性能 | 调用效率高 | 略慢，但优化后差距小 |

### Q2：Spring 默认使用哪种代理？

Spring 5.x 之前：如果类实现了接口，用 JDK 代理；否则用 CGLIB。

Spring 5.x + Spring Boot 2.0+：默认 `proxyTargetClass=true`，优先使用 CGLIB。

### Q3：CGLIB 为什么无法代理 final 类/final 方法？

CGLIB 的原理是继承，如果一个类是 final 的，无法继承；如果方法是 final 的，无法重写。

---

**下节预告**：[Spring AOP 代理选择规则](/framework/spring/aop-proxy-select) —— 深入理解 Spring 何时选择 JDK 代理、何时选择 CGLIB，以及 proxyTargetClass 的影响。
