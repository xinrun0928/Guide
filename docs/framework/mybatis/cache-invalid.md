# MyBatis 二级缓存失效场景：那些让你抓狂的坑

你有没有遇到过这种诡异的情况：

代码没改，数据没动，但查出来的结果时而对时而错。

或者，你明明加了缓存，却发现缓存根本没起作用，数据库还是被一次次打爆。

这节课，我们来盘点 MyBatis 二级缓存的各种失效场景，让你彻底理解它的工作原理。

## 先回顾：二级缓存是如何工作的？

```
┌─────────────────────────────────────────────────────────────┐
│                    二级缓存工作流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   SqlSession A                                     SqlSession B │
│   ┌─────────┐                                    ┌─────────┐   │
│   │一级缓存 │                                    │一级缓存 │   │
│   └────┬────┘                                    └────┬────┘   │
│        │                                              │        │
│        │     ┌──────────────────────────────────┐    │        │
│        └────▶│         二级缓存                   │◀───┘        │
│              │      (Mapper 级别)               │             │
│              └──────────────────────────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

二级缓存是 Mapper 级别的，多个 SqlSession 可以共享同一个 Mapper 的缓存。

## 失效场景大盘点

### 场景 1：增删改操作（最常见）

这是最容易理解的失效场景，也是设计者有意为之。

```java
SqlSession session1 = sqlSessionFactory.openSession();
UserMapper mapper1 = session1.getMapper(UserMapper.class);

User user1 = mapper1.findById(1);  // 查数据库，存入二级缓存
System.out.println(user1.getName()); // "Tom"

mapper1.updateName(1, "Jerry");     // UPDATE，缓存失效
session1.commit();

SqlSession session2 = sqlSessionFactory.openSession();
UserMapper mapper2 = session2.getMapper(UserMapper.class);
User user2 = mapper2.findById(1);  // 从二级缓存读取（应该已清空）
System.out.println(user2.getName()); // "Jerry"
```

**原理**：MyBatis 在执行 INSERT、UPDATE、DELETE 操作时，会自动调用 `CacheExecutor.flushCacheIfNeeded()` 清空该 Mapper 的二级缓存。

```java
// 伪代码演示
public class CachingExecutor {
    private final Executor delegate;

    @Override
    public int update(MappedStatement ms, Object parameter) {
        // 增删改都调用 update
        // 1. 执行实际的更新操作
        int result = delegate.update(ms, parameter);

        // 2. 清空该 Mapper 的二级缓存
        if (ms.isFlushCacheRequired()) {
            flushCache(ms.getCache());
        }
        return result;
    }

    private void flushCache(Cache cache) {
        cache.clear(); // 清空所有缓存
    }
}
```

> **面试官可能会问**：为什么增删改要清空缓存？
>
> 答：数据被修改后，缓存里的旧数据就过时了（脏数据）。如果不清空，后续查询会返回过时的数据。

### 场景 2：未开启缓存的 Mapper

```xml
<!-- UserMapper.xml -->
<mapper namespace="com.example.mapper.UserMapper">
    <!-- 没有 <cache> 标签 -->
    <select id="findById" resultType="User">
        SELECT * FROM user WHERE id = #{id}
    </select>
</mapper>
```

```java
// 即使其他 SqlSession 查询并放入了缓存
SqlSession session1 = sqlSessionFactory.openSession();
UserMapper mapper1 = session1.getMapper(UserMapper.class);
User user1 = mapper1.findById(1);  // 查询数据库

// 这个查询也查数据库，因为 UserMapper 没有开启二级缓存
SqlSession session2 = sqlSqlSessionFactory.openSession();
UserMapper mapper2 = session2.getMapper(UserMapper.class);
User user2 = mapper2.findById(1);  // 再次查数据库
```

**结论**：没有 `<cache>` 标签的 Mapper，不支持二级缓存。

### 场景 3：flushInterval 定时刷新

```xml
<cache flushInterval="30000" />
```

这意味着：每 30 秒，缓存会自动清空一次。

```
时间线：
0s   : 查询，数据入库
15s  : 查询，从缓存命中
30s  : 缓存自动清空
35s  : 查询，再次查数据库
60s  : 缓存自动清空
...
```

**适用场景**：
- 数据实时性要求不高
- 允许一定延迟的统计报表
- 变化不频繁的配置数据

### 场景 4：readOnly 属性设置

```xml
<!-- readOnly=true -->
<cache readOnly="true"/>

<!-- readOnly=false（默认） -->
<cache readOnly="false"/>
```

#### readOnly=true

```java
// 假设缓存中有 User 对象
User cachedUser = mapper.findById(1);

// 由于 readOnly=true，返回的是同一个对象
cachedUser.setName("Modified");
session.commit();

// 再次查询，返回的是被修改过的对象！
User user2 = mapper.findById(1);
System.out.println(user2.getName()); // "Modified"（不是数据库里的原始值）
```

#### readOnly=false

```java
// 假设缓存中有 User 对象
User cachedUser = mapper.findById(1);

// 由于 readOnly=false，返回的是对象的克隆
cachedUser.setName("Modified");

// 原始缓存不受影响
User user2 = mapper.findById(1);
System.out.println(user2.getName()); // 原始值
```

> **性能差异**：readOnly=true 不需要克隆对象，性能更好；readOnly=false 每次都要序列化/反序列化，但更安全。

### 场景 5：eviction 回收策略

```xml
<cache eviction="LRU" size="100"/>
```

当缓存数量超过 100 时，最久未使用的缓存项会被清除。

```java
// 假设 size=3
mapper.findById(1);  // 缓存: {1}
mapper.findById(2);  // 缓存: {1, 2}
mapper.findById(3);  // 缓存: {1, 2, 3}
mapper.findById(4);  // 缓存满了，清除最久未使用的 {1}，缓存: {2, 3, 4}
```

**LRU vs FIFO vs SOFT vs WEAK**

| 策略 | 含义 | 适用场景 |
|-----|------|---------|
| LRU | 最近最少使用 | 大多数场景，默认推荐 |
| FIFO | 先进先出 | 按插入顺序淘汰 |
| SOFT | 软引用 | 内存敏感，允许内存溢出前淘汰 |
| WEAK | 弱引用 | 内存敏感，尽快释放内存 |

### 场景 6：跨 Mapper 缓存不共享

```xml
<!-- UserMapper.xml -->
<mapper namespace="com.example.mapper.UserMapper">
    <cache/>
    <select id="findById" resultType="User">
        SELECT * FROM user WHERE id = #{id}
    </select>
</mapper>

<!-- OrderMapper.xml -->
<mapper namespace="com.example.mapper.OrderMapper">
    <cache/>
    <select id="findByUserId" resultType="Order">
        SELECT * FROM order WHERE user_id = #{userId}
    </select>
</mapper>
```

```java
// 在 OrderMapper 中修改了用户信息
SqlSession session1 = sqlSessionFactory.openSession();
OrderMapper orderMapper1 = session1.getMapper(OrderMapper.class);
orderMapper1.updateUserInfo(userId, newInfo);
session1.commit();

// UserMapper 的缓存不会被清空！
SqlSession session2 = sqlSessionFactory.openSession();
UserMapper userMapper2 = session2.getMapper(UserMapper.class);
User user = userMapper2.findById(userId);  // 返回缓存中的旧数据
```

> **问题根源**：二级缓存是 Mapper 级别的，一个 Mapper 的增删改只会清空自己的缓存，不会影响其他 Mapper。

### 场景 7：分布式环境下的缓存不一致

这是生产环境中最常见也最头疼的问题。

```java
// 服务 A
SqlSession sessionA = sqlSessionFactory.openSession();
UserMapper mapperA = sessionA.getMapper(UserMapper.class);
mapperA.updateName(1, "NewName");
sessionA.commit();  // 事务提交，二级缓存更新（清空）
// 此时服务 A 的缓存已更新

// 服务 B（另一台机器）
// 服务 B 的缓存还是旧数据！
SqlSession sessionB = sqlSessionFactory.openSession();
UserMapper mapperB = sessionB.getMapper(UserMapper.class);
User user = mapperB.findById(1);  // 命中缓存，返回 "OldName"
```

**解决方案**：

1. **使用分布式缓存（Redis）**
   - MyBatis 二级缓存替换为 RedisCache
   - 所有服务共享同一份缓存

2. **使用 `CacheRef` 引用其他 Mapper 的缓存**
   ```xml
   <!-- OrderMapper.xml -->
   <cache-ref namespace="com.example.mapper.UserMapper"/>
   ```
   - OrderMapper 的缓存实际上就是 UserMapper 的缓存
   - 修改 User 或 Order 都会清空同一个缓存

3. **关闭二级缓存**
   - 只依赖一级缓存（SqlSession 级别）
   - 适合一致性要求高的场景

### 场景 8：Spring 整合下的事务问题

```java
@Service
public class UserService {
    @Autowired
    private UserMapper userMapper;

    @Transactional
    public void updateAndQuery() {
        User user = userMapper.findById(1);
        user.setName("NewName");
        userMapper.update(user);
        // 注意：在事务中，commit 不会立即执行
        // 缓存清空也不会立即生效
    }
}
```

Spring 管理事务时，SqlSession 的生命周期可能跨越多个方法调用，缓存行为可能与预期不符。

**正确做法**：在 Service 层显式操作 SqlSession 或使用编程式事务。

## 失效场景总结表

| 场景 | 是否常见 | 严重程度 | 解决方案 |
|-----|---------|---------|---------|
| 增删改操作 | ⭐⭐⭐ | 低 | 设计如此 |
| 未开启缓存 | ⭐⭐ | 中 | 添加 `<cache>` 标签 |
| flushInterval 刷新 | ⭐ | 低 | 根据业务选择合适间隔 |
| readOnly 陷阱 | ⭐⭐ | 中 | 理解 readOnly 含义 |
| eviction 淘汰 | ⭐ | 低 | 调整 size 或换策略 |
| 跨 Mapper 不共享 | ⭐⭐⭐ | 高 | 使用 CacheRef 或分布式缓存 |
| 分布式不一致 | ⭐⭐⭐ | 高 | Redis 替代本地缓存 |
| Spring 事务问题 | ⭐⭐ | 中 | 理解事务边界 |

---

## 实战：如何调试缓存问题？

当你怀疑缓存有问题时，可以用以下方法排查：

### 1. 开启 MyBatis 日志

```xml
<settings>
    <setting name="logImpl" value="SLF4J"/>
</settings>
```

```yaml
mybatis:
  configuration:
    log-impl: org.apache.ibatis.logging.slf4j.Slf4jImpl
```

观察日志输出：

```
Cache Hit Ratio [com.example.mapper.UserMapper]: 0.0
Cache Hit Ratio [com.example.mapper.UserMapper]: 0.5  // 第二次查询命中率提升
```

### 2. 手动清空缓存

```java
// 清空当前 Mapper 的二级缓存
UserMapper mapper = session.getMapper(UserMapper.class);
((Cache) mapper).clear();  // 需要强转

// 清空所有缓存
sqlSessionFactory.getConfiguration().getCache("UserMapper").clear();
```

### 3. 查看缓存统计

```java
Configuration config = sqlSessionFactory.getConfiguration();
Cache cache = config.getCache("UserMapper");
System.out.println("Size: " + cache.getSize());
```

---

## 面试高频问题

### Q1：如何禁用某个查询的二级缓存？

```xml
<select id="findById" resultType="User" useCache="false">
    SELECT * FROM user WHERE id = #{id}
</select>
```

### Q2：如何禁用某个更新的缓存刷新？

```xml
<update id="update" flushCache="false">
    UPDATE user SET name = #{name} WHERE id = #{id}
</update>
```

> 注意：`flushCache="false"` 仅用于**不影响缓存一致性**的更新场景，比如更新日志、访问统计等。

### Q3：MyBatis 缓存和 Redis 缓存有什么区别？

| 维度 | MyBatis 缓存 | Redis 缓存 |
|-----|-------------|-----------|
| 作用域 | 单机 Mapper | 分布式全局 |
| 存储介质 | 内存（可配置磁盘） | 内存 + 磁盘持久化 |
| 数据一致性 | 弱（各节点独立） | 强（共享存储） |
| 适用场景 | 小型单机应用 | 分布式微服务 |

---

## 思考题

假设这样一个场景：

- 用户模块（UserMapper）和订单模块（OrderMapper）是两个独立的 Mapper
- 订单中包含用户信息（通过 association 关联）
- 用户修改了自己的信息

问题：如何保证订单查询时获取到最新的用户信息？

下一节，我们看 [XML mapper 文件结构](/framework/mybatis/xml-mapper)，了解 MyBatis 如何组织 SQL 映射文件。
