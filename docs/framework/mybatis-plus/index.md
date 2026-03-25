# MyBatis Plus：让 MyBatis 不再需要手写 SQL

你有没有被 MyBatis 的 CRUD 代码折磨过？

```java
// 查一条
User user = userMapper.selectOne(new QueryWrapper&lt;User&gt;().eq("id", 1L));

// 查多条
List&lt;User&gt; users = userMapper.selectList(new QueryWrapper&lt;User&gt;().like("name", "Tom"));

// 插入
userMapper.insert(user);

// 更新
userMapper.update(user, new UpdateWrapper&lt;User&gt;().eq("id", 1L));

// 删除
userMapper.delete(new QueryWrapper&lt;User&gt;().eq("id", 1L));
```

这就是 MyBatis Plus——国产开源的 MyBatis 增强工具。它让简单 CRUD 变得前所未有的简单。

## MyBatis Plus 是什么？

MyBatis Plus（简称 MP）是 MyBatis 的增强工具，在 MyBatis 的基础上只做增强不做改变，为简化开发、提高效率而生。

```
┌─────────────────────────────────────────────────────────────────┐
│                      MyBatis Plus 定位                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│              ┌─────────────────────────────────┐               │
│              │         MyBatis Plus             │               │
│              │         (增强工具层)              │               │
│              └─────────────────────────────────┘               │
│                           ▲                                     │
│                           │ 只做增强，不做改变                   │
│                           │                                     │
│              ┌─────────────────────────────────┐               │
│              │          MyBatis                 │               │
│              │          (基础框架层)              │               │
│              └─────────────────────────────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 核心特性

### 1. 无侵入

只增强 MyBatis，不改变原有架构。已有的 MyBatis 项目，可以零成本接入。

### 2. 损耗小

启动即会对基本 CRUD 进行自动注入，没有任何额外损耗。

### 3. 强大的 CRUD 操作

内置通用 Service CRUD 和 Mapper CRUD，极大减少 CRUD 操作的工作量。

```java
// Service 层调用
User user = userService.getById(1L);
List&lt;User&gt; users = userService.list(new QueryWrapper&lt;User&gt;().like("name", "Tom"));

// Mapper 层调用
User user = baseMapper.selectById(1L);
List&lt;User&gt; users = baseMapper.selectList(null);
```

### 4. 强大的条件构造器

支持 Lambda 语法的条件构造器，告别硬编码：

```java
// 强类型，不用担心列名写错
QueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;();
wrapper.lambda()
      .select(User::getName, User::getEmail)
      .like(User::getName, "Tom")
      .eq(User::getStatus, 1)
      .orderByDesc(User::getCreateTime);
```

### 5. 内置分页插件

无需额外配置，开箱即用：

```java
Page&lt;User&gt; page = new Page&lt;&gt;(1, 10);
Page&lt;User&gt; result = userMapper.selectPage(page, null);
System.out.println("总记录数: " + result.getTotal());
System.out.println("数据: " + result.getRecords());
```

### 6. 自动填充

创建时间、更新时间自动填充：

```java
@TableField(fill = FieldFill.INSERT)
private LocalDateTime createTime;

@TableField(fill = FieldFill.INSERT_UPDATE)
private LocalDateTime updateTime;
```

### 7. 逻辑删除

物理删除变逻辑删除，数据可恢复：

```java
@TableLogic
private Integer deleted;
```

### 8. 乐观锁

解决并发更新问题：

```java
@Version
private Integer version;
```

### 9. 多租户支持

一个系统服务多个租户：

```java
// 自动在 SQL 中注入租户 ID
TenantLineInnerInterceptor tenantInterceptor = new TenantLineInnerInterceptor(new TenantLineHandler() {
    @Override
    public Expression getTenantId() {
        return new LongValue(TenantContext.getTenantId());
    }
});
```

## 生态体系

```
MyBatis Plus
├── 核心功能
│   ├── CRUD 接口
│   ├── 条件构造器
│   ├── 分页插件
│   ├── 自动填充
│   ├── 逻辑删除
│   └── 乐观锁
├── 扩展功能
│   ├── 多租户
│   ├── SQL 分析器
│   ├── 动态表名
│   └── 拦截器链
└── 工具
    ├── 代码生成器（MyBatis Plus Generator）
    └── 快速 CURD 插件（EasyCode、MyBatisX）
```

## 为什么选择 MyBatis Plus？

| 对比项 | 手写 SQL | MyBatis Generator | MyBatis Plus |
|-------|---------|-------------------|--------------|
| 开发效率 | 低 | 中 | 高 |
| SQL 可控性 | 完全可控 | 一般 | 完全可控 |
| CRUD 代码量 | 多 | 中 | 少 |
| 动态 SQL | 灵活 | 一般 | 灵活 |
| 学习成本 | 低 | 中 | 低 |
| 维护成本 | 高 | 中 | 低 |

## 适用场景

- **快速开发阶段**：减少样板代码，快速交付
- **后台管理系统**：CRUD 占比高，适合使用
- **微服务拆分**：各服务独立使用，互不影响
- **需要深度 SQL 优化**：仍然可以手写 SQL

## 章节导航

- [快速上手与核心注解](/framework/mybatis-plus/quickstart)
- [CRUD 接口与条件构造器](/framework/mybatis-plus/wrapper)
- [分页插件与 Page 对象](/framework/mybatis-plus/pagination)
- [自动填充功能](/framework/mybatis-plus/auto-fill)
- [逻辑删除与全局配置](/framework/mybatis-plus/logic-delete)
- [乐观锁插件](/framework/mybatis-plus/optimistic-lock)
- [多租户插件](/framework/mybatis-plus/tenant)
- [SQL 性能分析](/framework/mybatis-plus/sql-analyze)

---

## 思考题

MyBatis Plus 这么好，但它毕竟是增强工具，不是 ORM 框架。如果你的业务需要极度灵活的 SQL 操作，或者查询条件复杂到难以用条件构造器表达，应该怎么做？

**答案**：MyBatis Plus 完全兼容原生 MyBatis，复杂 SQL 仍然可以写 XML 或使用 `@Select` 注解。

下一节，我们从 [快速上手](/framework/mybatis-plus/quickstart) 开始，体验 MyBatis Plus 的魅力。
