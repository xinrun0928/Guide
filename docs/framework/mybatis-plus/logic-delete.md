# 逻辑删除：让数据「假删除」变成「真安全」

你有没有遇到过这种情况：

用户误删了一条重要数据，然后你花了半天从数据库备份里恢复？

或者，财务对账时发现数据对不上，一查才发现某条记录被「物理删除」了？

这就是**逻辑删除**存在的意义——**数据不删除，只标记；需要时，可以恢复**。

## 物理删除 vs 逻辑删除

### 物理删除

```sql
-- 物理删除：数据真的没了
DELETE FROM user WHERE id = 1;

-- 查询时，这条数据不存在
SELECT * FROM user WHERE id = 1;  -- Empty
```

### 逻辑删除

```sql
-- 逻辑删除：只是标记 deleted = 1
UPDATE user SET deleted = 1 WHERE id = 1;

-- 查询时，自动过滤掉 deleted = 1 的数据
SELECT * FROM user WHERE id = 1 AND deleted = 0;  -- Empty（但数据还在）
```

```
┌─────────────────────────────────────────────────────────────────┐
│                      逻辑删除 vs 物理删除                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  物理删除                                                        │
│  ├── 优点：释放磁盘空间                                          │
│  ├── 缺点：数据不可恢复，风险高                                  │
│  └── 适用：临时数据、日志数据                                    │
│                                                                 │
│  逻辑删除                                                        │
│  ├── 优点：数据可恢复，审计方便                                  │
│  ├── 缺点：占用磁盘空间，查询需要过滤                            │
│  └── 适用：业务数据、用户数据、财务数据                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## MyBatis Plus 配置逻辑删除

### 1. 实体类添加字段

```java
@Data
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private Integer age;

    private String email;

    // 逻辑删除字段
    @TableLogic
    private Integer deleted;
}
```

### 2. 全局配置（推荐）

```yaml
mybatis-plus:
  global-config:
    db-config:
      # 全局逻辑删除字段
      logic-delete-field: deleted
      # 删除值
      logic-delete-value: 1
      # 未删除值
      logic-not-delete-value: 0
```

### 3. 单表注解配置

```java
@TableName("user")
@TableLogic(value = "1", delval = "0")
private Integer deleted;
```

## 逻辑删除的执行效果

### 查询操作

```java
// 查询时自动加上 deleted = 0 条件
List&lt;User&gt; users = userMapper.selectList(null);
// 生成的 SQL: SELECT * FROM user WHERE deleted = 0
```

### 插入操作

```java
// 插入时 deleted 字段使用默认值
userMapper.insert(user);
// 生成的 SQL: INSERT INTO user (name, age, deleted) VALUES (?, ?, 0)
```

### 更新操作

```java
// 更新时自动加上 deleted = 0 条件，防止更新已删除数据
user.setName("New Name");
userMapper.updateById(user);
// 生成的 SQL: UPDATE user SET name = ?, deleted = 0 WHERE id = ? AND deleted = 0
```

### 删除操作

```java
// 删除变成更新
userMapper.deleteById(1L);
// 生成的 SQL: UPDATE user SET deleted = 1 WHERE id = ? AND deleted = 0
```

### 使用 Wrapper 删除

```java
// 条件删除也会变成更新
QueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;();
wrapper.eq("status", 0);
userMapper.delete(wrapper);
// 生成的 SQL: UPDATE user SET deleted = 1 WHERE status = 0 AND deleted = 0
```

## 逻辑删除的高级配置

### 1. 局部配置覆盖全局配置

```java
@TableName("order")
public class Order {

    @TableId(type = IdType.AUTO)
    private Long id;

    // 单独指定逻辑删除值
    @TableLogic(value = "1", delval = "0")
    private Integer deleted;
}

@TableName("product")
public class Product {

    @TableId(type = IdType.AUTO)
    private Long id;

    // 使用 String 类型
    @TableLogic(value = "Y", delval = "N")
    private String deleted;
}
```

### 2. 不删除但标记

```java
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    // 标记为已删除，但保留原值
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime deleteTime;

    @TableLogic
    private Integer deleted;
}
```

```java
@Component
public class MyMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        this.strictInsertFill(metaObject, "deleteTime", LocalDateTime.class, null);
    }
}
```

```java
// 自定义删除逻辑
@Bean
public ISqlInjector sqlInjector() {
    return new LogicSqlInjector() {
        @Override
        public MethodSignature getMethodSignature(Class&lt;?&gt; mapperClass, Class&lt;?&gt; modelClass, TableInfo table) {
            // 自定义删除行为
            return super.getMethodSignature(mapperClass, modelClass, table);
        }
    };
}
```

## 常见问题

### 问题一：查询已删除数据

```java
// 方式一：使用 @TableLogic 的 select = false
// 但这样会完全查不到，需要慎用

// 方式二：使用 XML 手写 SQL
List&lt;User&gt; deletedUsers = userMapper.selectDeletedUsers();
```

```xml
<select id="selectDeletedUsers" resultType="User">
    SELECT * FROM user WHERE deleted = 1
</select>
```

### 问题二：物理删除已删除数据

```java
// 手动物理删除
@Update("UPDATE user SET deleted = 1 WHERE deleted = 1 AND delete_time < #{before}")
int physicallyDeleteOldRecords(LocalDateTime before);
```

### 问题三：恢复已删除数据

```java
// 恢复删除的数据
@Update("UPDATE user SET deleted = 0 WHERE id = #{id}")
int restore(Long id);
```

### 问题四：逻辑删除 + 唯一索引

```sql
-- 问题：唯一索引和逻辑删除冲突
CREATE UNIQUE INDEX uk_name ON user(name);  -- 只能有一个 name

-- 如果删除后再插入同名用户，会报错
```

**解决方案**：使用联合唯一索引

```sql
CREATE UNIQUE INDEX uk_name_deleted ON user(name, deleted);
```

```java
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    // 配合联合唯一索引使用
    private String name;

    @TableLogic
    private Integer deleted;
}
```

## 实战案例

### 案例一：用户管理

```java
@Data
@TableName("sys_user")
public class SysUser {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String username;

    private String password;

    private String email;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT)
    private Long createBy;

    // 逻辑删除
    @TableLogic
    private Integer deleted;
}
```

### 案例二：订单管理

```java
@Data
@TableName("order")
public class Order {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String orderNo;

    private BigDecimal amount;

    private Integer status;

    // 逻辑删除
    @TableLogic
    private Integer deleted;
}
```

### 案例三：回收站功能

```java
@Service
public class UserRecycleBinService {

    @Autowired
    private UserMapper userMapper;

    /**
     * 获取已删除用户列表
     */
    public List&lt;User&gt; getRecycleBin() {
        // 查询 deleted = 1 的记录
        return userMapper.selectDeletedUsers();
    }

    /**
     * 恢复用户
     */
    public boolean restore(Long userId) {
        User user = new User();
        user.setId(userId);
        user.setDeleted(0);
        return userMapper.updateById(user) > 0;
    }

    /**
     * 彻底删除（物理删除）
     */
    public boolean permanentDelete(Long userId) {
        // 先恢复，再物理删除
        restore(userId);
        return userMapper.deleteById(userId) > 0;
    }
}
```

## 逻辑删除的注意事项

### 1. 索引问题

```sql
-- 给 deleted 字段加索引，避免全表扫描
ALTER TABLE user ADD INDEX idx_deleted (deleted);
```

### 2. 性能问题

```yaml
mybatis-plus:
  global-config:
    db-config:
      # 大量已删除数据时，考虑分区表
      # 或者定期物理清理
```

### 3. 分布式问题

```java
// 多节点环境下，需要确保逻辑删除的一致性
// 建议使用分布式锁
DistributedLock lock = new DistributedLock("delete_user_" + userId);
try {
    lock.lock();
    userMapper.deleteById(userId);
} finally {
    lock.unlock();
}
```

---

## 面试高频问题

### Q1：逻辑删除和物理删除的区别？

| 维度 | 逻辑删除 | 物理删除 |
|-----|---------|---------|
| SQL | UPDATE | DELETE |
| 数据 | 保留 | 不可恢复 |
| 查询 | 需要过滤 | 无需过滤 |
| 磁盘 | 占用空间 | 释放空间 |
| 审计 | 可追溯 | 不可追溯 |

### Q2：MyBatis Plus 逻辑删除的原理？

通过 `LogicSqlInjector` 重写 SQL，DELETE 变成 UPDATE，SELECT 自动加上 `deleted = 0` 条件。

### Q3：逻辑删除字段应该用什么类型？

可以用 `Integer`、`String`、`Boolean` 等，只要能表示「已删除」和「未删除」两种状态即可。

---

## 最佳实践

1. **统一使用逻辑删除**：所有业务数据默认使用逻辑删除
2. **定期清理**：已删除数据定期物理清理，释放磁盘空间
3. **注意唯一索引**：涉及唯一索引的字段需要联合 deleted 字段
4. **回收站功能**：提供恢复已删除数据的入口
5. **审计日志**：记录删除操作的时间、操作人、原因

---

## 思考题

一个电商系统中，商品表 `product` 有商品名称 `name` 作为唯一索引。现在需要支持逻辑删除：

1. 删除「商品A」后，能否再插入同名「商品A」？
2. 如果不能，应该如何设计？
3. 联合唯一索引 `uk_name_deleted` 是否会影响性能？

下一节，我们学习 [乐观锁](/framework/mybatis-plus/optimistic-lock)，解决并发更新问题。
