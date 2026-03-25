# CRUD 接口与条件构造器：告别硬编码

你有没有写过这种代码？

```java
QueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;();
wrapper.eq("name", "Tom");           // "name" 写错了怎么办？
wrapper.like("user_name", "Tom");    // 字段名要手动加下划线
wrapper.order_by_desc("create_time"); // 排序字段名又搞错了
```

MyBatis Plus 的条件构造器就是为了解决这些问题而生的——**用 Lambda 语法，告别硬编码**。

## 条件构造器家族

```
┌─────────────────────────────────────────────────────────────────┐
│                    MyBatis Plus 条件构造器                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  QueryWrapper / LambdaQueryWrapper                              │
│  └── 用于查询，支持 select、条件判断、排序等                      │
│                                                                 │
│  UpdateWrapper / LambdaUpdateWrapper                             │
│  └── 用于更新，支持 set、条件判断等                               │
│                                                                 │
│  LambdaQueryWrapper&lt;T&gt;                                         │
│  └── 使用 Lambda 表达式，通过实体类的方法引用获取字段名             │
│                                                                 │
│  LambdaUpdateWrapper&lt;T&gt;                                         │
│  └── 使用 Lambda 表达式的 UpdateWrapper                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## QueryWrapper vs LambdaQueryWrapper

### QueryWrapper（传统写法）

```java
QueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;();
wrapper.select("id", "name", "email")
      .eq("age", 18)
      .like("name", "Tom")
      .orderByDesc("create_time");
```

**问题**：字段名是字符串，容易写错，IDE 无法检查。

### LambdaQueryWrapper（推荐写法）

```java
LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
wrapper.select(User::getId, User::getName, User::getEmail)
      .eq(User::getAge, 18)
      .like(User::getName, "Tom")
      .orderByDesc(User::getCreateTime);
```

**优点**：
- 字段名来自实体类，IDE 自动补全
- 重构时代码自动更新
- 编译期检查，告别硬编码

## 查询构造方法

### select：指定查询字段

```java
// 方式一：字符串列名
queryWrapper.select("id", "name", "email");

// 方式二：Lambda 表达式
queryWrapper.select(
    User::getId,
    User::getName,
    User::getEmail
);

// 方式三：排除某些字段
queryWrapper.select(User.class, table -> !table.getProperty().equals("password"));
```

### where 条件

```java
// 等于
.eq("status", 1)
.eq(User::getStatus, 1);

// 不等于
.ne("status", 0)
.ne(User::getStatus, 0);

// 大于
.gt("age", 18)
.gt(User::getAge, 18);

// 大于等于
.ge("age", 18);

// 小于
.lt("age", 65);

// 小于等于
.le("age", 65);

// BETWEEN
.between("age", 18, 65);
.between(User::getAge, 18, 65);

// NOT BETWEEN
.notBetween("age", 18, 65);

// LIKE
.like("name", "Tom")        // %Tom%
.likeLeft("name", "Tom")    // %Tom
.likeRight("name", "Tom")   // Tom%

// NOT LIKE
.notLike("name", "Tom")

// IS NULL
.isNull("email")
.isNull(User::getEmail);

// IS NOT NULL
.isNotNull("email")

// IN
.in("status", 1, 2, 3)
.in("status", Arrays.asList(1, 2, 3));

// NOT IN
.notIn("status", 1, 2, 3);

// 字符串拼接（用于 OR 条件）
.apply("DATE(create_time) = '2024-01-01'")
.last("LIMIT 10");  // 慎用，可能有 SQL 注入风险
```

### 组合条件

```java
// 默认 AND 连接
.eq("status", 1)
.eq("deleted", 0);

// OR 条件
.eq("status", 1)
.or()
.eq("type", 2);

// OR 包裹（优先级更高）
.or(wrapper -> wrapper.eq("status", 1).eq("type", 2))
.eq("deleted", 0);
// 相当于: (status = 1 AND type = 2) OR deleted = 0
```

### 分组和排序

```java
// 分组
.groupBy("department_id")
.groupBy(User::getDepartmentId);

// HAVING
.groupBy(User::getDepartmentId)
.having("COUNT(*) > 5")
.having("COUNT(*) > {0}", 5)
.having(count -> count.ge(Function&lt;User, Integer&gt;::getAge, 18));

// 排序
.orderByAsc("age", "name")
.orderByAsc(User::getAge, User::getName)
.orderByDesc("create_time")
.orderByDesc(User::getCreateTime);

// 排序 + NULL 处理
.orderByAsc(true, true, User::getAge)  // 升序，NULL 排在前面
.orderByDesc(false, true, User::getAge) // 降序，NULL 排在后面

// ORDER BY FIELD（MySQL 特有）
.orderByField("status", 2, 1, 3)  // 按指定顺序排列
```

## 常用查询示例

### 示例一：基础条件查询

```java
// 查询状态正常的用户
LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
wrapper.eq(User::getStatus, 1)
       .eq(User::getDeleted, 0);
List&lt;User&gt; users = userMapper.selectList(wrapper);
```

### 示例二：多条件组合查询

```java
// 条件：年龄 18-65 之间，姓张或姓李，状态正常
LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
wrapper.between(User::getAge, 18, 65)
       .and(w -> w.likeRight(User::getName, "张")
                   .or()
                   .likeRight(User::getName, "李"))
       .eq(User::getStatus, 1);

// 生成的 SQL:
// WHERE age BETWEEN 18 AND 65
//   AND (name LIKE '张%' OR name LIKE '李%')
//   AND status = 1
```

### 示例三：分页查询

```java
// 查询第 1 页，每页 10 条
Page&lt;User&gt; page = new Page&lt;&gt;(1, 10);
LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
wrapper.eq(User::getStatus, 1)
       .orderByDesc(User::getCreateTime);

Page&lt;User&gt; result = userMapper.selectPage(page, wrapper);
System.out.println("总记录数: " + result.getTotal());
System.out.println("总页数: " + result.getPages());
System.out.println("当前页数据: " + result.getRecords());
```

### 示例四：模糊搜索

```java
// 搜索：姓名包含关键词，或者邮箱包含关键词
LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
String keyword = "Tom";
wrapper.and(w -> w.like(User::getName, keyword)
                  .or()
                  .like(User::getEmail, keyword));

// 生成的 SQL:
// WHERE (name LIKE '%Tom%' OR email LIKE '%Tom%')
```

### 示例五：子查询

```java
// 查询有下级的用户（子查询）
LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
wrapper.inSql(User::getId, "SELECT manager_id FROM user WHERE manager_id IS NOT NULL");

// 或使用 exists
wrapper.exists("SELECT 1 FROM user u2 WHERE u2.manager_id = user.id");
```

## UpdateWrapper：更新构造器

### 基本用法

```java
UpdateWrapper&lt;User&gt; updateWrapper = new UpdateWrapper&lt;&gt;();
updateWrapper.set("name", "New Name")
             .set("email", "new@example.com")
             .eq("id", 1L);

userMapper.update(null, updateWrapper);
```

### Lambda 版本

```java
LambdaUpdateWrapper&lt;User&gt; wrapper = new UpdateWrapper&lt;&gt;().lambda();
wrapper.set(User::getName, "New Name")
       .set(User::getEmail, "new@example.com")
       .eq(User::getId, 1L);

userMapper.update(null, wrapper);
```

### 链式调用

```java
userMapper.update(user, new UpdateWrapper&lt;&gt;()
    .lambda()
    .set(User::getName, user.getName())
    .set(User::getEmail, user.getEmail())
    .eq(User::getId, user.getId())
);
```

### 只更新部分字段

```java
// 方式一：实体类只设置要更新的字段
User user = new User();
user.setId(1L);
user.setName("New Name");  // 只更新 name
userMapper.updateById(user);  // 其他字段不会更新

// 方式二：使用 UpdateWrapper
LambdaUpdateWrapper&lt;User&gt; wrapper = new UpdateWrapper&lt;&gt;().lambda();
wrapper.set(User::getName, "New Name")
       .eq(User::getId, 1L);
userMapper.update(null, wrapper);
```

## 条件构造器的陷阱

### 陷阱一：null 值的处理

```java
// 默认行为：null 值不会添加到条件中
String name = null;
Integer age = 18;
wrapper.eq(name != null, "name", name);  // 正确写法：加条件判断
wrapper.eq("name", name);                 // null 值不会生成条件
```

### 陷阱二：字符串空串的处理

```java
String name = "";
wrapper.like("name", name);  // 会生成 name LIKE '%'（匹配所有）
```

正确做法：

```java
// 方式一：手动判断
if (StringUtils.isNotBlank(name)) {
    wrapper.like("name", name);
}

// 方式二：使用 apply 的表达式
wrapper.apply(StringUtils.isNotBlank(name), "name LIKE {0}", "%" + name + "%");
```

### 陷阱三：or() 的位置

```java
// 错误：OR 的优先级问题
wrapper.eq("status", 1).or().eq("type", 2).eq("deleted", 0);
// 解析为: status = 1 OR type = 2 AND deleted = 0
// 实际期望: (status = 1 OR type = 2) AND deleted = 0

// 正确：使用 lambda 包裹
wrapper.eq("status", 1)
       .or()
       .eq("type", 2)
       .and(w -> w.eq("deleted", 0));
// 解析为: status = 1 OR type = 2 AND deleted = 0
```

### 陷阱四：last() 的 SQL 注入

```java
// 危险：可能遭受 SQL 注入
String orderBy = "1; DROP TABLE user; --";
wrapper.last("ORDER BY " + orderBy);

// 安全：使用 orderBy 方法
wrapper.orderByDesc("create_time");
wrapper.orderBy(true, false, "create_time");  // false 表示降序
```

## 高级用法

### 链式调用风格

```java
// 所有构造器都支持链式调用
List&lt;User&gt; users = userService.lambdaQuery()
    .select(User::getId, User::getName, User::getEmail)
    .eq(User::getStatus, 1)
    .like(User::getName, "Tom")
    .orderByDesc(User::getCreateTime)
    .list();
```

### 链式更新

```java
// Service 层的链式更新
boolean success = userService.lambdaUpdate()
    .set(User::getName, "New Name")
    .set(User::getEmail, "new@example.com")
    .eq(User::getId, 1L)
    .update();
```

### 条件构造器组合

```java
// 封装查询条件
public void search(UserQuery query) {
    LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();

    // 动态条件
    if (query.getName() != null) {
        wrapper.like(User::getName, query.getName());
    }
    if (query.getMinAge() != null) {
        wrapper.ge(User::getAge, query.getMinAge());
    }
    if (query.getMaxAge() != null) {
        wrapper.le(User::getAge, query.getMaxAge());
    }
    if (query.getStatus() != null) {
        wrapper.eq(User::getStatus, query.getStatus());
    }

    // 排序
    wrapper.orderByDesc(User::getCreateTime);

    return userMapper.selectList(wrapper);
}
```

---

## 面试高频问题

### Q1：QueryWrapper 和 LambdaQueryWrapper 的区别？

LambdaQueryWrapper 使用 Lambda 表达式获取字段名，避免硬编码字符串，IDE 支持更好。

### Q2：如何在条件构造器中使用 OR 条件？

使用 `or()` 方法，或者 `and(lambda)` / `or(lambda)` 包裹多个条件。

### Q3：如何避免条件构造器的 SQL 注入？

- 不要使用 `last()` 方法拼接用户输入
- 使用 `apply()` 的参数化形式
- 使用 Lambda 表达式代替字符串列名

---

## 最佳实践

1. **优先使用 Lambda 条件构造器**：告别硬编码，减少 bug
2. **null 值要手动判断**：条件构造器默认忽略 null 值
3. **复杂 OR 条件用 lambda 包裹**：避免优先级问题
4. **善用链式调用**：代码更简洁易读
5. **Service 层的 lambdaQuery() / lambdaUpdate()**：更优雅的 API

---

## 思考题

```java
// 如何实现：查询所有用户，但排除 status=0 且 deleted=1 的用户？
// 如果用 OR 条件，应该怎么写？
```

下一节，我们学习 [分页插件](/framework/mybatis-plus/pagination)，掌握分页查询的正确姿势。
