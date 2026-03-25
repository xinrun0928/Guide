# Mapper 代理对象生成：JDK 动态代理深度解析

你有没有好奇过这个问题的答案：

```java
UserMapper mapper = sqlSession.getMapper(UserMapper.class);
User user = mapper.selectById(1);
```

`mapper` 到底是什么？它不是 `UserMapper` 的实现类（因为你根本没写过），但你却能像调用真实对象一样调用它的方法。

答案就是：**JDK 动态代理**。

## JDK 动态代理基础

在深入 MyBatis 之前，先回顾一下 JDK 动态代理的核心概念：

### 三个角色

| 角色 | 说明 |
|-----|------|
| `Proxy` | 用于创建代理对象的类 |
| `InvocationHandler` | 调用处理器，代理对象的所有方法调用都会转发到这里 |
| `被代理接口` | 要代理的接口 |

### 工作原理

```
┌─────────────────────────────────────────────────────┐
│                      用户调用                        │
│                  mapper.selectById(1)                │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                   代理对象                           │
│              (Proxy.newProxyInstance)               │
│  ┌───────────────────────────────────────────────┐  │
│  │          mapper 实际上是一个代理对象            │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  所有方法调用都会转发到 InvocationHandler │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│               MapperProxy.invoke()                   │
│  ┌───────────────────────────────────────────────┐  │
│  │  在这里执行：                                   │  │
│  │  1. 解析方法名，确定要执行的 SQL                 │  │
│  │  2. 获取 SQL 参数                               │  │
│  │  3. 调用 SqlSession 执行                        │  │
│  │  4. 返回结果                                    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 最小示例

```java
// 1. 定义接口
public interface UserService {
    void save(User user);
    User findById(Long id);
}

// 2. 实现 InvocationHandler
public class UserServiceInvocationHandler implements InvocationHandler {
    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        System.out.println("方法执行前: " + method.getName());
        Object result = method.invoke(target, args); // 调用真实对象
        System.out.println("方法执行后");
        return result;
    }
}

// 3. 创建代理对象
UserService proxy = (UserService) Proxy.newProxyInstance(
    UserService.class.getClassLoader(),
    new Class[]{UserService.class},
    new UserServiceInvocationHandler()
);
proxy.save(user); // 输出: 方法执行前: save, 方法执行后
```

## MyBatis 中的 MapperProxy

### MapperProxy 类结构

```java
public class MapperProxy<T> implements InvocationHandler, Serializable {
    private static final long serialVersionUID = -6424529895463L;

    private final SqlSession sqlSession;
    private final Class<T> mapperInterface;
    // 方法缓存，避免每次都从 Configuration 查找
    private final Map&lt;Method, MapperMethod&gt; methodCache;

    public MapperProxy(SqlSession sqlSession, Class<T> mapperInterface) {
        this.sqlSession = sqlSession;
        this.mapperInterface = mapperInterface;
        this.methodCache = new ConcurrentHashMap<>();
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        try {
            // 1. 如果是 Object 的方法（如 toString()、hashCode()），不走代理逻辑
            if (Object.class.equals(method.getDeclaringClass())) {
                return method.invoke(this, args);
            }

            // 2. 缓存中获取 MapperMethod
            final MapperMethod mapperMethod = methodCache.computeIfAbsent(
                method,
                m -> new MapperMethod(mapperInterface, method, sqlSession.getConfiguration())
            );

            // 3. 执行 SQL
            return mapperMethod.execute(sqlSession, args);

        } catch (Exception e) {
            throw ExceptionUtil.unwrapThrowable(e);
        }
    }
}
```

### 为什么要过滤 Object 方法？

```java
// 代理对象上调用 toString()
mapper.toString();
// 如果不过滤，会导致无限递归：
// mapper.toString() → invoke() → method.invoke(mapper) → mapper.toString() → ...
```

### 缓存机制

```java
// 使用 ConcurrentHashMap + computeIfAbsent 实现线程安全的懒加载缓存
private final Map&lt;Method, MapperMethod&gt; methodCache = new ConcurrentHashMap<>();

// 获取方法时，如果缓存中没有，就创建并放入缓存
final MapperMethod mapperMethod = methodCache.computeIfAbsent(
    method,
    m -> new MapperMethod(mapperInterface, method, sqlSession.getConfiguration())
);
```

> **性能优化点**：每次方法调用都去缓存查找，O(1) 时间复杂度，比每次 new 对象快得多。

## MapperMethod：SQL 执行的指挥官

`MapperMethod` 封装了 SQL 执行的所有信息。

```java
public class MapperMethod {
    // SQL 命令（id、SQL 类型）
    private final SqlCommand command;
    // 方法签名（返回值类型、参数名等）
    private final MethodSignature method;

    public Object execute(SqlSession sqlSession, Object[] args) {
        Object result;

        switch (command.getType()) {
            case INSERT:
                result = sqlSession.insert(command.getName(), args);
                break;
            case UPDATE:
                result = sqlSession.update(command.getName(), args);
                break;
            case DELETE:
                result = sqlSession.delete(command.getName(), args);
                break;
            case SELECT:
                // 根据返回值类型选择不同的查询方法
                if (method.returnsMany) {
                    result = sqlSession.selectList(command.getName(), args);
                } else if (method.returnsMap) {
                    result = sqlSession.selectMap(command.getName(), args);
                } else if (method.returnsCursor) {
                    result = sqlSession.selectCursor(command.getName(), args);
                } else {
                    Object param = method.convertArgsToSqlCommandParam(args);
                    result = sqlSession.selectOne(command.getName(), param);
                }
                break;
        }

        // 空结果检查
        if (result == null && method.getReturnType().isPrimitive()) {
            throw new BindingException(
                "Mapper method '" + command.getName() +
                "' returned null for a non-null return type.");
        }

        return result;
    }
}
```

### SqlCommand 的来源

`SqlCommand` 是在**初始化阶段**就确定好的：

```java
// 初始化时，解析 Mapper 接口上的注解或 XML 配置
public SqlCommand(Configuration configuration, Class<?> mapperInterface, Method method) {
    String statementId = mapperInterface.getName() + "." + method.getName();
    MappedStatement ms = configuration.getMappedStatement(statementId);
    this.name = ms.getId();
    this.type = ms.getSqlCommandType();
}
```

## 代理对象的创建时机

### 时序图

```
应用启动（MyBatis 初始化）
    │
    ▼
XMLConfigBuilder.parseMappers()
    │
    ▼
MapperRegistry.addMapper(UserMapper.class)
    │
    │ 1. 创建 MapperProxyFactory（只保存接口类型）
    │ 2. 不创建代理对象！
    ▼
┌─────────────────────────────────────┐
│  knownMappers = {                  │
│      UserMapper.class → Factory    │
│  }                                  │
└─────────────────────────────────────┘

用户调用
    │
    ▼
sqlSession.getMapper(UserMapper.class)
    │
    ▼
MapperRegistry.getMapper()
    │
    │ 1. 根据接口类型找到 Factory
    │ 2. factory.newInstance(sqlSession)
    ▼
MapperProxyFactory.newInstance()
    │
    ▼
Proxy.newProxyInstance() → 创建代理对象
```

### 延迟加载的好处

1. **启动更快**：不需要在启动时就创建所有代理对象
2. **按需加载**：只有真正用到的 Mapper 才会被创建
3. **节省内存**：如果某些 Mapper 从未被使用，就不会被创建

## 为什么 MyBatis 不用 CGLIB？

你可能会问：为什么不直接继承接口实现，而要用 JDK 动态代理？

### 对比

| 方式 | 原理 | 限制 |
|-----|------|------|
| JDK 动态代理 | 必须有接口，代理的是接口 | 接口方法必须是 public |
| CGLIB 代理 | 继承类，创建子类 | 不能代理 final 方法/类 |

### MyBatis 的选择

MyBatis 选择 JDK 动态代理的原因是：

1. **Mapper 必须是接口**：MyBatis 的设计就是基于接口的
2. **性能更好**：JDK 动态代理在 Java 8 后性能大幅提升
3. **更符合设计原则**：依赖接口而非实现

> **注意**：如果 Mapper 接口的方法不是 public 的，JDK 动态代理无法处理，会抛出 `IllegalAccessException`。

## 面试高频问题

### Q1：MyBatis 中 Mapper 代理对象是用什么技术生成的？

**JDK 动态代理**。具体由 `MapperProxyFactory` 调用 `Proxy.newProxyInstance()` 创建。

### Q2：为什么 `sqlSession.getMapper()` 要传入 SqlSession？

因为代理对象需要 SqlSession 来执行 SQL。在 `MapperProxy.invoke()` 中，最终会调用 `mapperMethod.execute(sqlSession, args)`。

### Q3：MyBatis 可以用 CGLIB 代替 JDK 动态代理吗？

**技术上可以，但没必要**。MyBatis 的 Mapper 就是接口，JDK 动态代理完全够用。而且 Spring 的 `@MapperScan` 默认也用的是 JDK 动态代理。

---

## 思考题

如果 Mapper 接口有继承关系，如：

```java
public interface BaseMapper<T> {
    T selectById(Long id);
}

public interface UserMapper extends BaseMapper<User> {
    int insert(User user);
}
```

调用 `BaseMapper` 的方法会走代理逻辑吗？

答案：**会**。因为 `UserMapper` 继承了 `BaseMapper`，`getMapper(UserMapper.class)` 返回的代理对象实现了 `UserMapper` 接口，而 `BaseMapper` 的方法也在其中。

但有一个坑：**如果只注册了 `UserMapper`，那么 `getMapper(BaseMapper.class)` 会抛出异常**，因为 `BaseMapper` 不在 knownMappers 中。

下一节，我们看 [Executor 执行器](/framework/mybatis/executor) 的实现细节。
