# SqlSession：获取 Mapper 代理对象

你知道吗，MyBatis 中有两种方式执行 SQL：

```java
// 方式一：直接调用 SqlSession 的方法
User user = sqlSession.selectOne("com.example.mapper.UserMapper.selectById", 1);

// 方式二：通过 Mapper 代理对象调用（推荐）
UserMapper mapper = sqlSession.getMapper(UserMapper.class);
User user = mapper.selectById(1);
```

**方式二**是主流用法，因为它有类型检查 IDE 提示，更安全。

但你有没有想过：`getMapper()` 到底返回了什么？它是怎么工作的？

## SqlSession 是什么？

`SqlSession` 是 MyBatis 的**核心会话对象**，它是与数据库交互的入口。

你可以把 SqlSession 理解为「数据库会话的一次性租借」——每次操作数据库，都从这里开始。

```java
public interface SqlSession {
    // 查询单条记录
    <T> T selectOne(String statement, Object parameter);
    // 查询多条记录
    <E> List<E> selectList(String statement, Object parameter);
    // 执行 insert/update/delete
    int insert(String statement, Object parameter);
    int update(String statement, Object parameter);
    int delete(String statement, Object parameter);
    // 获取 Mapper 代理对象
    <T> T getMapper(Class<T> type);
    // 事务控制
    void commit();
    void rollback();
    void close();
}
```

## 获取 Mapper 代理对象

### 核心流程

```
┌─────────────┐
│  SqlSession │
└──────┬──────┘
       │ getMapper(UserMapper.class)
       ▼
┌─────────────────────────────────┐
│  MapperRegistry.getMapper()     │
│  ┌───────────────────────────┐  │
│  │ 已知 Mapper 接口           │  │
│  │ 获取对应的 MapperProxyFactory│  │
│  └───────────────────────────┘  │
└────────────┬────────────────────┘
            │ createMapperProxy()
            ▼
┌─────────────────────────────────┐
│  MapperProxyFactory             │
│  ┌───────────────────────────┐  │
│  │ 创建 MapperProxy（InvocationHandler）│ │
│  │ 并返回代理对象              │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

### 源码解析

```java
// 1. SqlSession 的实现
public class DefaultSqlSession implements SqlSession {
    private final Configuration configuration;

    @Override
    public <T> T getMapper(Class<T> type) {
        // 委托给 Configuration
        return configuration.getMapper(type, this);
    }
}

// 2. Configuration
public class Configuration {
    protected final MapperRegistry mapperRegistry = new MapperRegistry(this);

    public <T> T getMapper(Class<T> type, SqlSession sqlSession) {
        // 委托给 MapperRegistry
        return mapperRegistry.getMapper(type, sqlSession);
    }
}

// 3. MapperRegistry
public class MapperRegistry {
    private final Map<Class<?>, MapperProxyFactory<?>> knownMappers = new HashMap<>();

    public <T> T getMapper(Class<T> type, SqlSession sqlSession) {
        // 获取 MapperProxyFactory
        MapperProxyFactory<T> mapperProxyFactory =
            (MapperProxyFactory<T>) knownMappers.get(type);
        if (mapperProxyFactory == null) {
            throw new BindingException("Type " + type + " is not known to the MapperRegistry.");
        }
        // 创建代理对象
        return mapperProxyFactory.newInstance(sqlSession);
    }
}
```

### 关键类：MapperProxyFactory

```java
public class MapperProxyFactory<T> {
    private final Class<T> mapperInterface;

    public MapperProxyFactory(Class<T> mapperInterface) {
        this.mapperInterface = mapperInterface;
    }

    @SuppressWarnings("unchecked")
    protected T newInstance(MapperProxy<T> mapperProxy) {
        // JDK 动态代理的核心：创建代理对象
        return (T) Proxy.newProxyInstance(
            mapperInterface.getClassLoader(),
            new Class[]{mapperInterface},
            mapperProxy
        );
    }

    public T newInstance(SqlSession sqlSession) {
        // 创建 InvocationHandler
        final MapperProxy<T> mapperProxy = new MapperProxy<>(sqlSession, mapperInterface);
        return newInstance(mapperProxy);
    }
}
```

## MapperProxy 做了什么？

`MapperProxy` 实现了 `InvocationHandler` 接口，它是**真正执行 SQL 的地方**。

```java
public class MapperProxy<T> implements InvocationHandler {
    private final SqlSession sqlSession;
    private final Class<T> mapperInterface;
    // 方法缓存，避免每次都查找 MethodMap
    private final Map&lt;Method, MapperMethod&gt; methodCache;

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        // 代理对象的任何方法调用都会走到这里
        try {
            // 1. 如果是 Object 的方法（如 toString、hashCode），直接放行
            if (Object.class.equals(method.getDeclaringClass())) {
                return method.invoke(this, args);
            }

            // 2. 缓存中获取 MapperMethod
            final MapperMethod mapperMethod = cachedMapperMethod(method);

            // 3. 执行 SQL
            return mapperMethod.execute(sqlSession, args);

        } catch (Exception e) {
            throw ExceptionUtil.unwrapThrowable(e);
        }
    }
}
```

### MapperMethod：封装 SQL 执行逻辑

```java
public class MapperMethod {
    private final SqlCommand command;
    private final MethodSignature method;

    public Object execute(SqlSession sqlSession, Object[] args) {
        Object result;

        // 根据 SQL 类型执行
        switch (command.getType()) {
            case SELECT:
                // 根据返回值类型决定调用哪个方法
                if (method.returnsMany) {
                    result = sqlSession.selectList(command.getName(), args);
                } else if (method.returnsMap) {
                    result = sqlSession.selectMap(command.getName(), args);
                } else {
                    result = sqlSession.selectOne(command.getName(), args);
                }
                break;
            case INSERT:
                result = sqlSession.insert(command.getName(), args);
                break;
            case UPDATE:
                result = sqlSession.update(command.getName(), args);
                break;
            case DELETE:
                result = sqlSession.delete(command.getName(), args);
                break;
        }
        return result;
    }
}
```

## 完整调用链路

```
mapper.selectById(1)
    │
    ▼
┌─────────────────────────────────────────┐
│  MapperProxy.invoke()                   │
│  - 检查是否是 Object 方法                │
│  - 查找/缓存 MapperMethod                │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  MapperMethod.execute()                 │
│  - 根据 SQL 类型选择执行方式              │
│  - 传入 sqlSession 和参数                │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  SqlSession.selectOne()                 │
│  - 委托给 Executor                        │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Executor.query()                       │
│  - 检查一级缓存                          │
│  - 调用 StatementHandler                 │
└─────────────────────────────────────────┘
```

## Spring Boot 中的使用方式

在 Spring Boot + MyBatis 环境下，你甚至不需要直接接触 SqlSession：

```java
// 只需要定义接口
@Mapper
public interface UserMapper {
    @Select("SELECT * FROM user WHERE id = #{id}")
    User selectById(Long id);

    @Insert("INSERT INTO user(name, email) VALUES(#{name}, #{email})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(User user);
}

// Spring 自动创建代理对象并注入
@Service
public class UserService {
    @Autowired
    private UserMapper userMapper;

    public User getUserById(Long id) {
        return userMapper.selectById(id); // 直接调用即可
    }
}
```

背后发生的事情：

```
Spring 容器启动
    │
    ▼
MapperScannerConfigurer.scanBasePackages("com.example.mapper")
    │
    ▼
为每个 @Mapper 接口创建代理对象
    │
    ▼
注入到需要的地方（@Autowired）
```

## 面试高频问题

### Q1：MyBatis 为什么需要通过代理对象来执行 SQL？

两个原因：

1. **解耦**：业务代码不需要知道 SQL 语句的存在，通过接口调用即可
2. **类型安全**：编译期就能发现类型错误，而不是等到运行时

### Q2：Mapper 代理对象是什么时候创建的？

**Mapper 注册时就创建了**。在 MyBatis 初始化阶段，`XMLConfigBuilder.parseMappers()` 会扫描所有 Mapper 接口，并为每个接口创建一个 `MapperProxyFactory`，但真正的代理对象是在调用 `getMapper()` 时才创建的（延迟创建）。

---

## 思考题

如果我在 Mapper 接口中定义了一个 `default` 方法，调用它会发生什么？

```java
@Mapper
public interface UserMapper {
    @Select("SELECT * FROM user WHERE id = #{id}")
    User selectById(Long id);

    // 这个 default 方法会走代理逻辑吗？
    default User findByIdOrThrow(Long id) {
        User user = selectById(id);
        if (user == null) {
            throw new UserNotFoundException(id);
        }
        return user;
    }
}
```

答案：**`findByIdOrThrow()` 不会走代理逻辑**。因为 `default` 方法有具体实现，MyBatis 会直接调用该实现，而不会触发 `invoke()` 方法。

这其实是一个小技巧——你可以在 Mapper 接口中写一些组合方法，而不需要额外定义。

下一节，我们深入 [Mapper 代理对象](/framework/mybatis/mapper-proxy) 的生成机制。
