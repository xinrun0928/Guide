# 分页插件：Page 对象全解析

你还在用 MySQL 的 `LIMIT offset, size` 做分页吗？

如果是，那你可能遇到过这种问题：

```java
// 分页查询第 1000 页
Page&lt;User&gt; page = new Page&lt;&gt;(1000, 10);
```

**MySQL 的 LIMIT 原理是跳过前 9990 条记录，性能会随着页数增加急剧下降。**

MyBatis Plus 的分页插件帮你解决了这个问题——它支持**游标分页**（基于 ID），让大偏移量的分页也能保持高性能。

## 分页插件配置

### 添加依赖

```xml
<dependencies>
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-boot-starter</artifactId>
        <version>3.5.5</version>
    </dependency>
</dependencies>
```

### 配置分页插件

```java
@Configuration
public class MyBatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
        return interceptor;
    }
}
```

### 插件配置选项

```java
@Bean
public MybatisPlusInterceptor mybatisPlusInterceptor() {
    MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

    // 分页插件配置
    PaginationInnerInterceptor pageInterceptor = new PaginationInnerInterceptor();
    // 设置请求的页面大于最大页后操作：true 调回首页，false 继续请求（默认 false）
    pageInterceptor.setOverflow(false);
    // 设置单页最大数量限制，默认 500 条，-1 不受限制
    pageInterceptor.setMaxLimit(500L);
    // 数据库类型
    pageInterceptor.setDbType(DbType.MYSQL);

    interceptor.addInnerInterceptor(pageInterceptor);
    return interceptor;
}
```

## Page 对象详解

### 基本使用

```java
// pageNum: 页码（从 1 开始）
// pageSize: 每页数量
Page&lt;User&gt; page = new Page&lt;&gt;(1, 10);

LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
wrapper.eq(User::getStatus, 1);

Page&lt;User&gt; result = userMapper.selectPage(page, wrapper);

System.out.println("当前页: " + result.getCurrent());
System.out.println("每页数量: " + result.getSize());
System.out.println("总记录数: " + result.getTotal());
System.out.println("总页数: " + result.getPages());
System.out.println("是否有上一页: " + result.hasPrevious());
System.out.println("是否有下一页: " + result.hasNext());
System.out.println("数据列表: " + result.getRecords());
```

### Page 对象属性

| 方法 | 说明 |
|-----|-----|
| `getCurrent()` | 当前页码 |
| `getSize()` | 每页数量 |
| `getTotal()` | 总记录数 |
| `getPages()` | 总页数 |
| `getRecords()` | 当前页的数据列表 |
| `hasPrevious()` | 是否有上一页 |
| `hasNext()` | 是否有下一页 |
| `searchCount()` | 是否查询总数 |
| `optimizeCountSql()` | 优化 COUNT SQL |

### 分页参数

```java
// 不查询总数（提升性能）
Page&lt;User&gt; page = new Page&lt;&gt;(1, 10, false);  // 第三个参数表示是否查询总数

// 查询部分字段
Page&lt;User&gt; page = new Page&lt;&gt;(1, 10);
page.setRecords(userMapper.selectList(wrapper));  // 手动设置结果
```

## Service 层分页

```java
// Controller
@GetMapping("/page")
public Page&lt;User&gt; getPage(@RequestParam(defaultValue = "1") long current,
                          @RequestParam(defaultValue = "10") long size) {
    return userService.getPage(current, size);
}

// Service
public Page&lt;User&gt; getPage(long current, long size) {
    Page&lt;User&gt; page = new Page&lt;&gt;(current, size);
    LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
    wrapper.eq(User::getStatus, 1);
    return baseMapper.selectPage(page, wrapper);
}
```

### 响应结构封装

```java
@Data
public class PageResult&lt;T&gt; {
    private long current;      // 当前页
    private long size;         // 每页数量
    private long total;        // 总记录数
    private long pages;        // 总页数
    private List&lt;T&gt; records;   // 数据列表

    public static &lt;T&gt; PageResult of(Page&lt;T&gt; page) {
        PageResult&lt;T&gt; result = new PageResult&lt;&gt;();
        result.setCurrent(page.getCurrent());
        result.setSize(page.getSize());
        result.setTotal(page.getTotal());
        result.setPages(page.getPages());
        result.setRecords(page.getRecords());
        return result;
    }
}
```

## 游标分页（性能优化）

### 为什么需要游标分页？

传统分页：

```sql
-- 第 1000 页，每页 10 条
SELECT * FROM user ORDER BY id LIMIT 9990, 10
-- 需要扫描前 9990 条数据！
```

游标分页（基于 ID）：

```sql
-- 假设上一页最后一条的 ID 是 9990
SELECT * FROM user WHERE id > 9990 ORDER BY id LIMIT 10
-- 只扫描 10 条数据！
```

### 游标分页实现

```java
public class CursorPage {
    private Long lastId;      // 上一页最后一条的 ID
    private Integer pageSize; // 每页数量

    public CursorPage(Long lastId, Integer pageSize) {
        this.lastId = lastId;
        this.pageSize = pageSize;
    }
}

@Service
public class UserServiceImpl extends ServiceImpl&lt;UserMapper, User&gt; implements UserService {

    @Override
    public IPage&lt;User&gt; cursorPage(Long lastId, int pageSize) {
        LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
        wrapper.select(User::getId, User::getName, User::getAge)
              .eq(User::getStatus, 1)
              .orderByAsc(User::getId);

        // 游标条件
        if (lastId != null) {
            wrapper.gt(User::getId, lastId);
        }

        // 查询多一条，用于判断是否有下一页
        Page&lt;User&gt; page = new Page&lt;&gt;(1, pageSize + 1);
        Page&lt;User&gt; result = baseMapper.selectPage(page, wrapper);

        // 处理游标
        List&lt;User&gt; records = result.getRecords();
        boolean hasMore = records.size() > pageSize;
        if (hasMore) {
            records = records.subList(0, pageSize);
        }
        page.setRecords(records);
        page.setTotal(hasMore ? -1 : result.getTotal());  // 游标模式不返回总数

        return page;
    }
}
```

### 前端调用示例

```java
// 第一次请求
CursorPage cursorPage = new CursorPage(null, 10);
IPage&lt;User&gt; result = userService.cursorPage(cursorPage.getLastId(), cursorPage.getPageSize());
List&lt;User&gt; users = result.getRecords();
Long nextLastId = users.isEmpty() ? null : users.get(users.size() - 1).getId();
boolean hasMore = result.getTotal() == -1 && !users.isEmpty();

// 后续请求
CursorPage nextCursor = new CursorPage(nextLastId, 10);
```

## 分页查询多表

### 关联查询分页

```java
// 需要手写 SQL 和 resultMap
Page&lt;UserVO&gt; page = new Page&lt;&gt;(current, size);

IPage&lt;UserVO&gt; result = userMapper.selectUserPage(page, userQuery);
```

```xml
<select id="selectUserPage" resultType="com.example.vo.UserVO">
    SELECT u.id, u.name, u.email, d.name as dept_name
    FROM user u
    LEFT JOIN department d ON u.dept_id = d.id
    <where>
        <if test="query.name != null">
            AND u.name LIKE CONCAT('%', #{query.name}, '%')
        </if>
    </where>
    ORDER BY u.create_time DESC
</select>
```

### XML 分页写法

```java
// XML 中的分页是自动处理的
IPage&lt;User&gt; selectPage(IPage&lt;User&gt; page, @Param("ew") LambdaQueryWrapper&lt;User&gt; wrapper);
```

```xml
<select id="selectPage" resultType="User">
    SELECT * FROM user
    <where>
        ${ew.customSqlSegment}
    </where>
</select>
```

## 分页常见问题

### 问题一：COUNT 查询慢

```java
// 优化 COUNT 查询
PaginationInnerInterceptor interceptor = new PaginationInnerInterceptor();
interceptor.setOptimizeJoin(true);  // 优化 JOIN 的 COUNT 查询
```

### 问题二：不想要总数

```java
Page&lt;User&gt; page = new Page&lt;&gt;(current, size, false);  // 不查询总数
```

### 问题三：Page 参数被误用

```java
// 错误：直接返回 Page 对象
public Page&lt;User&gt; getPage() {
    return userMapper.selectPage(new Page&lt;&gt;(), null);  // Page 会被填充
}

// 正确：返回 IPage
public IPage&lt;User&gt; getPage() {
    return userMapper.selectPage(new Page&lt;&gt;(), null);
}
```

### 问题四：多表分页 COUNT 不准确

```java
// 方式一：手动处理总数
Page&lt;UserVO&gt; page = new Page&lt;&gt;(current, size);
List&lt;UserVO&gt; records = userMapper.selectUserList(page, query);
page.setRecords(records);
page.setTotal(userMapper.countUserList(query));

// 方式二：使用分页插件处理
Page&lt;UserVO&gt; result = new Page&lt;&gt;(current, size);
userMapper.selectUserPage(result, query);
```

## 分页与排序

### 基本排序

```java
Page&lt;User&gt; page = new Page&lt;&gt;(current, size);
LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
wrapper.orderByDesc(User::getCreateTime);
return baseMapper.selectPage(page, wrapper);
```

### 多字段排序

```java
wrapper.orderByDesc(User::getStatus)
      .orderByAsc(User::getCreateTime);
```

### 动态排序

```java
// 前端传入排序字段和排序方向
String sortField = "createTime";
String sortOrder = "desc";

LambdaQueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
if ("createTime".equals(sortField)) {
    if ("desc".equalsIgnoreCase(sortOrder)) {
        wrapper.orderByDesc(User::getCreateTime);
    } else {
        wrapper.orderByAsc(User::getCreateTime);
    }
}
```

---

## 面试高频问题

### Q1：MyBatis Plus 分页插件的原理？

通过 `PaginationInnerInterceptor` 拦截 SQL，在 SELECT 语句中添加 `LIMIT` 和 `OFFSET`，同时在查询前后处理 COUNT 语句。

### Q2：如何优化分页查询性能？

1. 使用游标分页代替 OFFSET 分页
2. 合理使用索引
3. 关闭不必要的 COUNT 查询
4. 优化 COUNT 查询语句

### Q3：Page 对象和 IPage 的区别？

- `Page` 是 MyBatis Plus 提供的分页实现类
- `IPage` 是分页接口，用于解耦

---

## 最佳实践

1. **使用 IPage 接口**：方便后续切换实现
2. **合理设置 pageSize**：太大影响性能，太小请求频繁
3. **考虑游标分页**：数据量大时使用游标分页
4. **使用 Service 层分页方法**：封装通用分页逻辑
5. **处理空数据**：分页结果为空时要正确处理

---

## 思考题

一个商品列表页，用户可以：
1. 按分类筛选
2. 按价格区间筛选
3. 按关键词搜索
4. 支持分页和排序

如果用户快速翻页（1 → 1000 页），传统的 OFFSET 分页会有什么问题？如何用游标分页解决？

下一节，我们学习 [自动填充](/framework/mybatis-plus/auto-fill)，让创建时间和更新时间自动维护。
