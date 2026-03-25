# 自动填充：让时间字段自动维护

你有多少次是因为忘记设置 `create_time` 和 `update_time` 而排查 bug 的？

创建时忘了设置创建时间，更新时忘了更新修改时间……

MyBatis Plus 的**自动填充**功能，就是来解决这个问题的——**让时间字段自己记住自己的生命周期**。

## 自动填充原理

```
┌─────────────────────────────────────────────────────────────────┐
│                      自动填充执行流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  执行 insert/update 操作                                         │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │            MyBatis Plus 拦截器                            │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │        MetaObjectHandler                            │ │   │
│  │  │   ├── insertFill()  → 插入时调用                    │ │   │
│  │  │   └── updateFill()  → 更新时调用                    │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                                                        │
│         ▼                                                        │
│  自动填充字段值                                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 配置步骤

### 1. 实体类添加注解

```java
@Data
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private Integer age;

    // 创建时自动填充
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    // 创建和更新时自动填充
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    // 只在更新时填充（通常配合乐观锁使用）
    @TableField(fill = FieldFill.UPDATE)
    private Long updateBy;
}
```

### 2. 实现 MetaObjectHandler

```java
@Component
public class MyMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        // 插入操作，填充创建时间和更新时间
        this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());
        this.strictInsertFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());

        // 填充创建人
        this.strictInsertFill(metaObject, "createBy", Long.class, getCurrentUserId());
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        // 更新操作，只填充更新时间
        this.strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());

        // 填充更新人
        this.strictUpdateFill(metaObject, "updateBy", Long.class, getCurrentUserId());
    }

    /**
     * 获取当前登录用户 ID（根据实际情况实现）
     */
    private Long getCurrentUserId() {
        // 方式一：从 SecurityContext 获取
        // Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        // return (Long) auth.getPrincipal();

        // 方式二：从 ThreadLocal 获取
        // return UserContext.getCurrentUserId();

        // 方式三：默认系统用户
        return 0L;
    }
}
```

### 3. 配置填充模式（可选）

```java
@Component
public class MyMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        // 方式一：严格模式（推荐）
        // 如果字段值已经存在（不为 null），则不覆盖
        this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());

        // 方式二：填充模式
        // 不管字段值是否存在，都会填充
        this.fillStrategy(metaObject, "createTime", LocalDateTime.now());
    }
}
```

## FieldFill 枚举详解

| 值 | 说明 | 使用场景 |
|---|------|---------|
| `DEFAULT` | 默认不处理 | - |
| `INSERT` | 插入时填充 | 创建时间、创建人 |
| `UPDATE` | 更新时填充 | 更新时间、更新人 |
| `INSERT_UPDATE` | 插入和更新时都填充 | 更新时间 |

```java
@TableField(fill = FieldFill.INSERT)           // 只在插入时填充
@TableField(fill = FieldFill.UPDATE)           // 只在更新时填充
@TableField(fill = FieldFill.INSERT_UPDATE)    // 插入和更新时都填充
```

## 自动填充的类型

### LocalDateTime

```java
this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());
```

### Date（传统写法）

```java
this.strictInsertFill(metaObject, "createTime", Date.class, new Date());
```

### String

```java
this.strictInsertFill(metaObject, "createBy", String.class, getCurrentUserId());
```

### Long（用户 ID）

```java
this.strictInsertFill(metaObject, "createBy", Long.class, getCurrentUserId());
```

### Integer（版本号）

```java
this.strictInsertFill(metaObject, "version", Integer.class, 1);
```

## 常见使用场景

### 场景一：审计字段

```java
@Data
@TableName("sys_user")
public class SysUser {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String username;

    // 创建审计
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT)
    private Long createBy;

    // 更新审计
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private Long updateBy;

    // 乐观锁
    @Version
    private Integer version;

    // 逻辑删除
    @TableLogic
    private Integer deleted;
}
```

### 场景二：多租户场景

```java
@Component
public class TenantMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        // 自动填充租户 ID
        Long tenantId = TenantContext.getTenantId();
        if (tenantId != null) {
            this.strictInsertFill(metaObject, "tenantId", Long.class, tenantId);
        }
    }
}
```

### 场景三：业务状态字段

```java
@Data
@TableName("order")
public class Order {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String orderNo;

    // 创建时设置默认值
    @TableField(fill = FieldFill.INSERT)
    private Integer status = 0;  // 默认待支付

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}
```

## 进阶用法

### 1. 自定义填充策略

```java
@Component
public class CustomMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        // 使用 Lambda 填充
        this.strictInsertFill(metaObject, () -> LocalDateTime.now(), LocalDateTime.class);
        this.strictInsertFill(metaObject, () -> getCurrentUserId(), Long.class);
    }
}
```

### 2. 动态填充条件

```java
@Override
public void updateFill(MetaObject metaObject) {
    // 只有在特定条件下才填充
    Object status = getFieldValByName("status", metaObject);
    if (status != null && status.equals(1)) {
        // 只有状态为 1 时才填充更新时间
        this.strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }
}
```

### 3. 全局配置

```yaml
mybatis-plus:
  global-config:
    db-config:
      # 全局逻辑删除字段
      logic-delete-field: deleted
      logic-delete-value: 1
      logic-not-delete-value: 0
```

## 常见问题

### 问题一：自动填充不生效

```java
// 检查一：实体类是否加了注解
@TableField(fill = FieldFill.INSERT)
private LocalDateTime createTime;

// 检查二：MetaObjectHandler 是否加了 @Component 注解
@Component
public class MyMetaObjectHandler implements MetaObjectHandler { ... }

// 检查三：是否实现了正确的接口
public class MyMetaObjectHandler implements MetaObjectHandler { ... }  // 正确
// public class MyMetaObjectHandler extends MetaObjectHandler { ... }  // 错误
```

### 问题二：插入时覆盖已有值

```java
@Override
public void insertFill(MetaObject metaObject) {
    // 默认是严格模式，如果字段已有值则不覆盖
    // 但如果需要强制覆盖，使用：
    this.insertFillStrategy(metaObject, "createTime", LocalDateTime.now());
}
```

### 问题三：批量插入不生效

```java
// MyBatis Plus 的批量插入默认使用 JDBC 的 batch 模式
// 如果使用了自定义填充器，可能需要单独处理

// 解决方案一：使用循环单条插入
for (User user : users) {
    userMapper.insert(user);
}

// 解决方案二：确保 MetaObjectHandler 正确配置
// 批量插入时会为每条记录调用 fill 方法
```

### 问题四：MyBatis Plus 版本问题

```java
// 3.5.3.1+ 版本新增 fillStrategy 方法
// 3.5.3.1 之前版本
this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());

// 3.5.3.1+ 版本也可以使用
this.fillStrategy(metaObject, "createTime", LocalDateTime.now());
```

## 完整配置示例

### 配置类

```java
@Configuration
public class MyBatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 添加分页插件
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
        // 添加乐观锁插件
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }
}
```

### MetaObjectHandler

```java
@Component
@Slf4j
public class CommonMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        log.debug("start insert fill");
        this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());
        this.strictInsertFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
        this.strictInsertFill(metaObject, "createBy", Long.class, getCurrentUserId());
        this.strictInsertFill(metaObject, "updateBy", Long.class, getCurrentUserId());
        this.strictInsertFill(metaObject, "version", Integer.class, 1);
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        log.debug("start update fill");
        this.strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
        this.strictUpdateFill(metaObject, "updateBy", Long.class, getCurrentUserId());
    }

    private Long getCurrentUserId() {
        try {
            // 实际项目中从 SecurityContext 等地方获取
            return 1L;
        } catch (Exception e) {
            return 0L;
        }
    }
}
```

---

## 面试高频问题

### Q1：MyBatis Plus 自动填充的原理？

通过 `MetaObjectHandler` 接口，在执行 insert/update 操作时拦截，自动填充标记了 `@TableField(fill = FieldFill.XXX)` 的字段。

### Q2：strictInsertFill 和 fillStrategy 的区别？

- `strictInsertFill`：严格模式，如果字段已有值（不为 null）则不覆盖
- `fillStrategy`：填充模式，不管字段是否有值都会覆盖

### Q3：批量插入时自动填充会生效吗？

会生效。MyBatis Plus 的批量插入底层是循环调用单条插入，每次插入都会触发 `insertFill` 方法。

---

## 最佳实践

1. **统一审计字段**：所有业务表都加上创建人、创建时间、更新人、更新时间
2. **使用严格模式**：避免覆盖用户手动设置的值
3. **获取当前用户**：从 ThreadLocal 或 SecurityContext 获取
4. **日志记录**：在填充时记录日志，方便排查问题
5. **版本号初始化**：配合乐观锁使用

---

## 思考题

在分布式环境下，多个服务实例同时插入数据，如何保证每条记录的时间戳是准确的（不超过数据库服务器时间）？

提示：可以采用中心化时间服务，或者使用数据库服务器时间。

下一节，我们学习 [逻辑删除](/framework/mybatis-plus/logic-delete)，让数据「假删除」变成「真安全」。
