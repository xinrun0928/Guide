# MyBatis 缓存机制：一级缓存与二级缓存

你有没有遇到过这种情况：明明数据库里的数据没变，但每次查询结果不一样？

或者，你修改了一条数据后立刻查询，却发现还是旧值？

这就是 MyBatis 缓存的「魔法」——用得好是性能利器，用不好就是 bug 温床。

## 为什么需要缓存？

先算一笔账：

| 操作 | 耗时 |
|-----|-----|
| 执行一条简单 SELECT | 10-50ms |
| 建立数据库连接 | 50-200ms |
| 关闭数据库连接 | 10-50ms |

一次数据库查询，大部分时间都花在了「建立连接」上。如果能减少连接次数，性能提升是显著的。

缓存的核心思想：**把查询结果存起来，下次需要同样的数据时，直接从缓存取。**

## MyBatis 两级缓存架构

```
┌─────────────────────────────────────────────────────────────┐
│                      MyBatis 缓存架构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    二级缓存                            │   │
│  │              (Mapper 级别，可跨 SqlSession)           │   │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐             │   │
│  │   │ UserMapper│ │OrderMapper│ │ProductMapper│ ...   │   │
│  │   │  缓存    │  │  缓存    │  │  缓存    │             │   │
│  │   └─────────┘  └─────────┘  └─────────┘             │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ▲                                  │
│                           │ miss 时向下查询                    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    一级缓存                            │   │
│  │              (SqlSession 级别，默认开启)             │   │
│  │   ┌─────────────────────────────────────────────┐   │   │
│  │   │        缓存区域 (PerpetualCache)            │   │   │
│  │   └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 一级缓存：SqlSession 的私人物品

### 工作原理

一级缓存是 MyBatis 默认开启的缓存，生命周期与 `SqlSession` 相同。

```java
SqlSession session = sqlSessionFactory.openSession();
UserMapper mapper = session.getMapper(UserMapper.class);

// 第一次查询，会查数据库，结果存入一级缓存
User user1 = mapper.findById(1);

// 第二次查询，直接从一级缓存返回，不查数据库
User user2 = mapper.findById(1);

// user1 == user2，true！同一个对象
session.close();
```

执行流程：

```
查询请求
    │
    ▼
┌────────────────┐
│  查询一级缓存    │ ──命中──→ 返回缓存结果
└────────────────┘
    │ 未命中
    ▼
┌────────────────┐
│  查询数据库      │
└────────────────┘
    │
    ▼
┌────────────────┐
│  结果存入缓存    │
└────────────────┘
    │
    ▼
  返回结果
```

### 缓存存储结构

MyBatis 使用 `PerpetualCache` 作为缓存实现，本质是一个 `HashMap`：

```java
public class PerpetualCache implements Cache {
    private final String id;
    // key 是 cacheKey，value 是查询结果
    private final Map<Object, Object> cache = new HashMap<>();

    @Override
    public void putObject(Object key, Object value) {
        cache.put(key, value);
    }

    @Override
    public Object getObject(Object key) {
        return cache.get(key);
    }
}
```

### 缓存 key 的生成

缓存 key 由多个因素组成：

```java
public class CacheKey {
    // 组成部分
    private final String statementId;      // SQL 映射的 ID
    private final Object parameter;          // 查询参数
    private final int offset;               // 分页偏移
    private final int limit;                // 分页大小
    private final String sql;               // SQL 语句
    private final Object[] params;           // 其他参数

    @Override
    public boolean equals(Object o) {
        // 所有字段都参与 equals 比较
    }
}
```

> **关键点**：只有当 statementId、parameter、offset、limit、sql 都相同时，才会命中缓存。

### 一级缓存的失效场景

一级缓存看似好用，但有几种情况会导致它失效：

#### 1. 不同 SqlSession

```java
SqlSession session1 = sqlSessionFactory.openSession();
SqlSession session2 = sqlSessionFactory.openSession();

UserMapper mapper1 = session1.getMapper(UserMapper.class);
UserMapper mapper2 = session2.getMapper(UserMapper.class);

User user1 = mapper1.findById(1);  // 查数据库
User user2 = mapper2.findById(1); // 另一个 session，也要查数据库
```

#### 2. 同一个 SqlSession，查询条件不同

```java
UserMapper mapper = session.getMapper(UserMapper.class);

User user1 = mapper.findById(1);     // 查数据库
User user2 = mapper.findByName("Tom");  // 不同 SQL，cacheKey 不同，查数据库
User user3 = mapper.findById(1);    // 命中缓存
```

#### 3. 执行了增删改操作

```java
UserMapper mapper = session.getMapper(UserMapper.class);

User user1 = mapper.findById(1);     // 查数据库
mapper.updateUser(user);             // UPDATE，会清空该 mapper 的一级缓存
User user2 = mapper.findById(1);     // 再次查数据库
```

#### 4. 手动清空缓存

```java
UserMapper mapper = session.getMapper(UserMapper.class);

User user1 = mapper.findById(1);  // 查数据库
session.clearCache();               // 手动清空
User user2 = mapper.findById(1);  // 再次查数据库
```

## 二级缓存：跨 SqlSession 的共享空间

### 为什么需要二级缓存？

一级缓存只在单个 SqlSession 内有效。如果你在 Controller 层创建了一个 SqlSession，在 Service 层创建了另一个 SqlSession，它们之间的一级缓存无法共享。

二级缓存的作用：**让不同 SqlSession 可以共享查询结果。**

### 开启二级缓存

#### 1. 全局开关

```xml
<!-- mybatis-config.xml -->
<settings>
    <setting name="cacheEnabled" value="true"/>
</settings>
```

Spring Boot 配置：

```yaml
mybatis:
  configuration:
    cache-enabled: true  # 默认就是 true
```

#### 2. Mapper 级别开启

```xml
<!-- UserMapper.xml -->
<mapper namespace="com.example.mapper.UserMapper">

    <!-- 开启二级缓存，指定缓存实现类 -->
    <cache eviction="LRU" flushInterval="60000" size="512" readOnly="false"/>

    <select id="findById" resultType="User">
        SELECT * FROM user WHERE id = #{id}
    </select>
</mapper>
```

`cache` 标签属性说明：

| 属性 | 说明 | 可选值 |
|-----|------|-------|
| `eviction` | 缓存回收策略 | LRU（默认）、FIFO、SOFT、WEAK |
| `flushInterval` | 刷新间隔（毫秒） | 默认不刷新 |
| `size` | 缓存数量 | 默认 1024 |
| `readOnly` | 是否只读 | true（返回同一对象）/ false（返回副本，默认） |

#### 3. 使用注解方式

```java
@CacheNamespace(eviction = LruCache.class, flushInterval = 60000, size = 512)
public interface UserMapper {
    @Select("SELECT * FROM user WHERE id = #{id}")
    User findById(Long id);
}
```

### 二级缓存的工作流程

```
SqlSession 1 查询
       │
       ▼
┌────────────────┐
│  一级缓存查询    │ ──命中──→ 返回
└────────────────┘
       │ 未命中
       ▼
┌────────────────┐
│  二级缓存查询    │ ──命中──→ 存入一级缓存 → 返回
└────────────────┘
       │ 未命中
       ▼
┌────────────────┐
│    查询数据库    │
└────────────────┘
       │
       ▼
┌────────────────┐
│  存入二级缓存    │
└────────────────┘
       │
       ▼
  存入一级缓存 → 返回
```

### 二级缓存的存储结构

二级缓存由 `CachingExecutor` 管理，它包装了实际的 Executor：

```java
public class CachingExecutor implements Executor {
    private final Executor delegate;
    // 缓存实现
    private final TransactionalCacheManager tcm = new TransactionalCacheManager();

    @Override
    public <E> List<E> query(MappedStatement ms, Object parameter, ...) {
        // 1. 获取该 Mapper 的二级缓存
        Cache cache = ms.getCache();
        if (cache != null) {
            // 2. 从缓存获取
            List<E> cached = cache.getObject(key);
            if (cached != null) {
                return cached;
            }
        }

        // 3. 委托给被包装的 Executor（如 SimpleExecutor）
        List<E> list = delegate.query(ms, parameter, ...);

        // 4. 存入二级缓存（注意：存入 TransactionalCache）
        if (cache != null) {
            cache.putObject(key, list);
        }
        return list;
    }
}
```

### 缓存的事务性

二级缓存有一个特殊设计——**TransactionalCache**：

```java
public class TransactionalCache {
    private final Cache delegate;
    // 暂存区，事务提交前都放在这里
    private final Map<Object, Object> entriesToAddOnCommit = new HashMap<>();
    // 是否清空
    private boolean clearOnCommit;

    @Override
    public void putObject(Object key, Object value) {
        // 先不放入真实缓存，放到暂存区
        entriesToAddOnCommit.put(key, value);
    }

    @Override
    public void commit() {
        if (clearOnCommit) {
            delegate.clear();
        } else {
            // 事务提交时，才把暂存区的内容真正写入缓存
            for (Map.Entry<Object, Object> entry : entriesToAddOnCommit.entrySet()) {
                delegate.putObject(entry.getKey(), entry.getValue());
            }
        }
    }
}
```

> **为什么这样设计？** 假设在事务中查询了数据（一级缓存有），然后更新了数据，一级缓存被清空。如果二级缓存在查询时立刻写入，就会出现「查询时有一级缓存，但一级缓存被清空后，二级缓存里还是旧数据」的问题。TransactionalCache 保证只有在事务真正提交后，缓存才生效。

## 两级缓存对比

| 特性 | 一级缓存 | 二级缓存 |
|-----|---------|---------|
| 作用域 | SqlSession | Mapper（跨 SqlSession） |
| 默认开启 | 是 | 否（需手动开启） |
| 存储位置 | 内存 | 可配置（内存、磁盘） |
| 失效条件 | SqlSession 关闭或 clearCache | 增删改操作/手动清空 |
| 缓存结构 | PerpetualCache | 可配置（LRU、FIFO 等） |
| 线程安全 | 不安全（每个 SqlSession 独立） | 安全（缓存粒度到 Mapper） |

## 实战避坑指南

### 坑 1：缓存与事务的配合问题

```java
@Service
public class UserService {
    @Autowired
    private SqlSessionFactory sqlSessionFactory;

    public User findByIdWithTransaction(Long id) {
        // 问题：每次都创建新的 SqlSession，一级缓存没用
        try (SqlSession session = sqlSessionFactory.openSession()) {
            UserMapper mapper = session.getMapper(UserMapper.class);
            return mapper.findById(id);
        }
    }
}
```

**正确做法**：配合 Spring 事务管理，让同一个事务复用同一个 SqlSession。

### 坑 2：二级缓存的脏读问题

```java
SqlSession session1 = sqlSessionFactory.openSession();
SqlSession session2 = sqlSessionFactory.openSession();

UserMapper mapper1 = session1.getMapper(UserMapper.class);
UserMapper mapper2 = session2.getMapper(UserMapper.class);

User user1 = mapper1.findById(1);   // 存入二级缓存
mapper2.updateName(1, "New Name"); // 另一个 session 更新了数据
session2.commit();

User user2 = mapper1.findById(1);   // 读到的还是旧数据（脏读）！
```

**解决方案**：使用分布式缓存（Redis）替代本地缓存，或者在更新后手动清空相关缓存。

### 坑 3：实体类需要实现序列化

如果使用二级缓存的序列化存储（分布式场景），实体类需要实现 `Serializable`：

```java
public class User implements Serializable {
    private static final long serialVersionUID = 1L;
    // ...
}
```

## 缓存配置总结

### 全局配置

```xml
<settings>
    <!-- 开启二级缓存 -->
    <setting name="cacheEnabled" value="true"/>
    <!-- 开启一级缓存（默认 true） -->
    <setting name="localCacheScope" value="SESSION"/>
</settings>
```

`localCacheScope` 可选值：
- `SESSION`：一级缓存作用域为 SqlSession（默认）
- `STATEMENT`：一级缓存作用域为每条 SQL 语句

### Spring Boot 完整配置

```yaml
mybatis:
  configuration:
    cache-enabled: true
    local-cache-scope: session
  mapper-locations: classpath:mapper/*.xml
```

---

## 面试追问方向

1. **MyBatis 缓存的实现原理是什么？**
   - 一级缓存基于 PerpetualCache（HashMap）
   - 二级缓存基于 CachingExecutor 装饰器模式

2. **一级缓存和二级缓存的区别？**
   - 作用域不同（一级 SqlSession 级，二级 Mapper 级）
   - 生命周期不同
   - 二级缓存需要手动开启

3. **如何保证缓存与数据库的一致性？**
   - 缓存过期策略
   - 更新时主动清空缓存
   - 使用分布式缓存替代本地缓存

下一节，我们看[二级缓存的失效场景](/framework/mybatis/cache-invalid)，深入分析各种导致缓存失效的情况。
