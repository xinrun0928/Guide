# 动态 SQL：让 SQL 会「思考」

你有没有写过这种代码？

```java
String sql = "SELECT * FROM user WHERE 1=1";
if (name != null) {
    sql += " AND name = '" + name + "'";
}
if (status != null) {
    sql += " AND status = " + status;
}
```

然后被同事吐槽「你这 SQL 注入漏洞等着被黑吧」？

MyBatis 的动态 SQL，就是来解决这个问题的——**让你用安全的方式，动态拼接 SQL**。

## 动态 SQL 标签一览

MyBatis 提供了 9 个动态 SQL 标签：

| 标签 | 作用 |
|-----|------|
| `if` | 条件判断 |
| `where` | 智能 WHERE 子句 |
| `set` | 智能 SET 子句 |
| `trim` | 自定义前后缀处理 |
| `foreach` | 循环遍历 |
| `choose/when/otherwise` | 多条件选择 |
| `bind` | 创建变量 |

## if：最基础的条件判断

```xml
<select id="searchUser" resultType="User">
    SELECT * FROM user
    WHERE 1=1
    <if test="name != null">
        AND name = #{name}
    </if>
    <if test="status != null">
        AND status = #{status}
    </if>
    <if test="email != null and email != ''">
        AND email LIKE CONCAT('%', #{email}, '%')
    </if>
</select>
```

### test 表达式语法

```java
// 单条件
<if test="name != null">
<if test="status == 1">
<if test="count &gt; 10">           // 大于 &gt;
<if test="count &lt; 100">          // 小于 &lt;

// 多条件
<if test="name != null and name != ''">
<if test="name != null &amp;&amp; name.length() &gt; 0">  // && 要转义

// 类型判断
<if test="user instanceof User">
<if test="user instanceof T(com.example.entity.User)">
```

### 常见错误

```xml
<!-- 错误：字符串比较要用双等号 -->
<if test="name = 'Tom'">

<!-- 正确 -->
<if test="name == 'Tom'">
<if test='name == "Tom"'>
```

## where：智能 WHERE 子句

`if` 的问题是：如果所有条件都不满足，SQL 会变成 `SELECT * FROM user WHERE`，语法错误。

`where` 标签帮你解决这个问题：

```xml
<select id="searchUser" resultType="User">
    SELECT * FROM user
    <where>
        <if test="name != null">
            AND name = #{name}
        </if>
        <if test="status != null">
            AND status = #{status}
        </if>
        <if test="email != null and email != ''">
            AND email = #{email}
        </if>
    </where>
</select>
```

### where 的自动处理

```
情况1：所有条件都不满足
    → 生成: SELECT * FROM user

情况2：只有第二个条件满足
    → 生成: SELECT * FROM user WHERE status = ?

情况3：所有条件都满足
    → 生成: SELECT * FROM user WHERE name = ? AND status = ? AND email = ?
```

**注意**：if 里的 AND/OR 要保留，因为 `where` 标签会自动处理首部的 AND/OR。

## set：智能 UPDATE 子句

类似 `where`，`set` 用于 UPDATE 语句：

```xml
<update id="updateUser" parameterType="User">
    UPDATE user
    <set>
        <if test="name != null">name = #{name},</if>
        <if test="email != null">email = #{email},</if>
        <if test="status != null">status = #{status},</if>
    </set>
    WHERE id = #{id}
</update>
```

### set 的自动处理

```
情况1：只有 name 不为空
    → 生成: UPDATE user SET name = ? WHERE id = ?

情况2：所有字段都不为空
    → 生成: UPDATE user SET name = ?, email = ?, status = ? WHERE id = ?

情况3：所有字段都为空（会报错，但通常业务不允许）
    → 生成: UPDATE user SET WHERE id = ?  ❌
```

### 为什么用逗号结尾？

```xml
<if test="name != null">name = #{name},</if>
<if test="email != null">email = #{email},</if>
```

`set` 标签会自动删除最后一个多余的逗号。

## trim：自定义前后缀处理

`trim` 是更通用的标签，可以自定义要「修剪掉」的内容：

```xml
<!-- 等价于 where -->
<trim prefix="WHERE" prefixOverrides="AND |OR ">
    <if test="name != null">AND name = #{name}</if>
    <if test="status != null">AND status = #{status}</if>
</trim>

<!-- 等价于 set -->
<trim prefix="SET" suffixOverrides=",">
    <if test="name != null">name = #{name},</if>
    <if test="email != null">email = #{email},</if>
</trim>
```

### trim 属性说明

| 属性 | 说明 |
|-----|------|
| `prefix` | 添加到内容前面的字符串 |
| `suffix` | 添加到内容后面的字符串 |
| `prefixOverrides` | 删除内容前面的字符串（多个用 `|` 分隔） |
| `suffixOverrides` | 删除内容后面的字符串 |

### 高级用法：自定义 SQL 片段

```xml
<!-- 去除 WHERE 和多余的 AND -->
<trim prefix="WHERE" prefixOverrides="AND |OR |and |or ">
    <if test="name != null">AND name = #{name}</if>
    <if test="status != null">AND status = #{status}</if>
</trim>
```

## foreach：循环遍历

### 批量查询

```xml
<select id="findByIds" resultType="User">
    SELECT * FROM user WHERE id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>
```

```java
List&lt;Long&gt; ids = Arrays.asList(1L, 2L, 3L, 4L, 5L);
List&lt;User&gt; users = userMapper.findByIds(ids);
```

生成 SQL：

```sql
SELECT * FROM user WHERE id IN (?, ?, ?, ?, ?)
```

### 批量插入

```xml
<insert id="batchInsert" parameterType="list">
    INSERT INTO user (name, email, status) VALUES
    <foreach collection="list" item="user" separator=",">
        (#{user.name}, #{user.email}, #{user.status})
    </foreach>
</insert>
```

```java
List&lt;User&gt; users = Arrays.asList(user1, user2, user3);
userMapper.batchInsert(users);
```

生成 SQL：

```sql
INSERT INTO user (name, email, status) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)
```

### 批量删除

```xml
<delete id="batchDelete" parameterType="list">
    DELETE FROM user WHERE id IN
    <foreach collection="list" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</delete>
```

### foreach 属性详解

| 属性 | 说明 | 示例 |
|-----|------|-----|
| `collection` | 要遍历的集合 | `list`、`array`、`ids` |
| `item` | 循环变量的名称 | `item`、`user`、`id` |
| `open` | 开始符号 | `(` |
| `close` | 结束符号 | `)` |
| `separator` | 分隔符 | `,` |
| `index` | 循环索引（可选） | `index`、`i` |

### 批量更新的两种方式

**方式一：多条 UPDATE（MySQL 扩展语法）**

```xml
<update id="batchUpdate">
    <foreach collection="list" item="user" separator=";">
        UPDATE user SET name = #{user.name} WHERE id = #{user.id}
    </foreach>
</update>
```

```yaml
# 需要在数据库 URL 添加 allowMultiQueries=true
url: jdbc:mysql://localhost:3306/test?allowMultiQueries=true
```

**方式二：Case When（推荐，一条 SQL）**

```xml
<update id="batchUpdateWithCase">
    UPDATE user
    <trim prefix="SET" suffixOverrides=",">
        name = CASE id
        <foreach collection="list" item="user">
            WHEN #{user.id} THEN #{user.name}
        </foreach>
        END,
    </trim>
    WHERE id IN
    <foreach collection="list" item="user" open="(" separator="," close=")">
        #{user.id}
    </foreach>
</update>
```

生成 SQL：

```sql
UPDATE user
SET name = CASE
    WHEN id = 1 THEN 'Tom'
    WHEN id = 2 THEN 'Jerry'
    ...
END
WHERE id IN (1, 2, ...)
```

## choose/when/otherwise：多条件选择

类似 Java 的 `switch-case`，只会选择一个分支：

```xml
<select id="searchUser" resultType="User">
    SELECT * FROM user
    <where>
        <choose>
            <when test="id != null">
                AND id = #{id}
            </when>
            <when test="name != null">
                AND name = #{name}
            </when>
            <when test="email != null">
                AND email = #{email}
            </when>
            <otherwise>
                AND status = 1
            </otherwise>
        </choose>
    </where>
</select>
```

执行逻辑：

```
如果 id != null        → AND id = ?
否则如果 name != null  → AND name = ?
否则如果 email != null → AND email = ?
否则                   → AND status = 1
```

## bind：创建变量

用于在 OGNL 表达式中创建变量，方便复用：

```xml
<select id="searchUser" resultType="User">
    <!-- 创建变量，避免重复拼接 -->
    <bind name="pattern" value="'%' + keyword + '%'"/>

    SELECT * FROM user
    WHERE name LIKE #{pattern}
    OR email LIKE #{pattern}
</select>
```

### 常见场景：模糊查询

```xml
<!-- 不用 bind，要写两遍 CONCAT -->
<select id="searchByKeyword" resultType="User">
    SELECT * FROM user
    WHERE name LIKE CONCAT('%', #{keyword}, '%')
    OR email LIKE CONCAT('%', #{keyword}, '%')
</select>

<!-- 用 bind，优雅多了 -->
<select id="searchByKeyword" resultType="User">
    <bind name="pattern" value="'%' + keyword + '%'"/>
    SELECT * FROM user
    WHERE name LIKE #{pattern}
    OR email LIKE #{pattern}
</select>
```

## 动态 SQL 组合技

### 动态条件查询

```xml
<select id="dynamicSearch" resultType="User">
    SELECT * FROM user
    <where>
        <if test="name != null and name != ''">
            <bind name="namePattern" value="'%' + name + '%'"/>
            AND name LIKE #{namePattern}
        </if>
        <if test="minAge != null">
            AND age &gt;= #{minAge}
        </if>
        <if test="maxAge != null">
            AND age &lt;= #{maxAge}
        </if>
        <if test="statusList != null and statusList.size() &gt; 0">
            AND status IN
            <foreach collection="statusList" item="status" open="(" separator="," close=")">
                #{status}
            </foreach>
        </if>
    </where>
    <if test="orderBy != null">
        ORDER BY ${orderBy}
    </if>
</select>
```

### 动态更新

```xml
<update id="dynamicUpdate" parameterType="User">
    UPDATE user
    <set>
        <if test="name != null">name = #{name},</if>
        <if test="email != null">email = #{email},</if>
        <if test="status != null">status = #{status},</if>
        <if test="updateTime != null">update_time = #{updateTime},</if>
    </set>
    <where>
        id = #{id}
        <if test="optimisticLock != null">
            AND optimistic_lock = #{optimisticLock}
        </if>
    </where>
</update>
```

### 动态插入

```xml
<insert id="dynamicInsert" parameterType="User">
    INSERT INTO user
    <trim prefix="(" suffix=")" suffixOverrides=",">
        <if test="id != null">id,</if>
        <if test="name != null">name,</if>
        <if test="email != null">email,</if>
        <if test="status != null">status,</if>
        <if test="createTime != null">create_time,</if>
    </trim>
    <trim prefix="VALUES (" suffix=")" suffixOverrides=",">
        <if test="id != null">#{id},</if>
        <if test="name != null">#{name},</if>
        <if test="email != null">#{email},</if>
        <if test="status != null">#{status},</if>
        <if test="createTime != null">#{createTime},</if>
    </trim>
</insert>
```

## 常见问题

### 问题 1：$ 和 # 的区别

```xml
<!-- #{}：预编译参数，防止 SQL 注入 -->
<select id="findByName" resultType="User">
    SELECT * FROM user WHERE name = #{name}
</select>
-- 实际执行: SELECT * FROM user WHERE name = ?

<!-- ${}：直接拼接，有 SQL 注入风险 -->
<select id="findByOrder" resultType="User">
    SELECT * FROM user ORDER BY ${columnName}
</select>
-- 实际执行: SELECT * FROM user ORDER BY create_time
```

**原则**：
- `#{}` 用于值传递
- `${}` 用于动态列名/表名（ORDER BY、LIMIT 等）

### 问题 2：collection 参数类型

```java
// List 类型
List&lt;User&gt; findByIds(List&lt;Long&gt; ids);

// Array 类型
List&lt;User&gt; findByIds(Long[] ids);

// Map 类型
List&lt;User&gt; findByCondition(Map&lt;String, Object&gt; params);
params.put("ids", Arrays.asList(1L, 2L, 3L));
```

```xml
<!-- List 类型 -->
<foreach collection="list" item="id">

<!-- Array 类型 -->
<foreach collection="array" item="id">

<!-- Map 中的 List -->
<foreach collection="ids" item="id">
```

### 问题 3：OGNL 表达式中的坑

```xml
<!-- 字符串空判断 -->
<if test="name != null and name != ''">

<!-- 推荐写法：MyBatis 3.3+ -->
<if test="name != null and name.length() &gt; 0">

<!-- 或者使用 @p0 获取参数（不推荐） -->
<if test="@org.apache.commons.lang3.StringUtils@isNotBlank(name)">
```

---

## 面试高频问题

### Q1：MyBatis 动态 SQL 解决了什么问题？

1. 根据条件动态生成 SQL，避免硬拼接
2. 防止 SQL 注入（使用 `#{}`）
3. 简化复杂查询的 XML 配置

### Q2：$ 和 # 的区别？

- `#{}`：预编译参数替换，防止 SQL 注入
- `${}`：直接字符串替换，不安全，但可用于动态列名/表名

### Q3：foreach 的使用场景？

- 批量查询：`WHERE id IN (?, ?, ?)`
- 批量插入：`VALUES (...), (...), (...)`
- 批量更新：`UPDATE ... CASE WHEN ...`

---

## 最佳实践

1. **优先使用 `#{}`**：防止 SQL 注入
2. **`${}` 只用于列名/表名**：如 `ORDER BY ${column}`
3. **`where` 代替 `1=1`**：更优雅
4. **批量操作注意数据量**：单次批量不超过 1000 条
5. **动态 SQL 也要加索引**：避免全表扫描

---

## 思考题

```java
// 下面的查询，有什么潜在问题？
List&lt;User&gt; search(String name, Integer status, String orderBy);
```

```xml
<select id="search" resultType="User">
    SELECT * FROM user
    <where>
        <if test="name != null">
            AND name = #{name}
        </if>
        <if test="status != null">
            AND status = #{status}
        </if>
    </where>
    ORDER BY ${orderBy}
</select>
```

提示：用户传 `orderBy = "1; DROP TABLE user; --"` 会怎样？

下一节，我们看 [注解方式 vs XML 方式](/framework/mybatis/annotation-vs-xml)，分析两种配置方式的优劣。
