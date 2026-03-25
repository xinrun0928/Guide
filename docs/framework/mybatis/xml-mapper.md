# MyBatis XML Mapper 文件结构：SQL 映射的艺术

你打开一个陌生的 MyBatis 项目，看到满屏的 XML 文件，有没有一种「走进迷宫」的感觉？

每个 Mapper XML 都有自己的「章法」——顶级标签放哪？子标签嵌套关系是什么？为什么有些项目用注解，有些用 XML？

这节课，我们把 MyBatis XML Mapper 的结构彻底讲清楚。

## 整体结构概览

一个完整的 MyBatis XML Mapper 文件，结构如下：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">

<!-- mapper 根节点 -->
<mapper namespace="com.example.mapper.UserMapper">

    <!-- 1. 缓存配置（可选） -->
    <cache eviction="LRU" flushInterval="60000" size="512"/>

    <!-- 2. 结果映射（可选，用于复杂映射） -->
    <resultMap id="BaseResultMap" type="User">
        <id property="id" column="id"/>
        <result property="name" column="name"/>
    </resultMap>

    <!-- 3. SQL 片段（可选，可复用） -->
    <sql id="Base_Column_List">
        id, name, email, status
    </sql>

    <!-- 4. 查询语句 -->
    <select id="findById" resultMap="BaseResultMap">
        SELECT * FROM user WHERE id = #{id}
    </select>

    <!-- 5. 插入语句 -->
    <insert id="insert" useGeneratedKeys="true" keyProperty="id">
        INSERT INTO user (name, email) VALUES (#{name}, #{email})
    </insert>

    <!-- 6. 更新语句 -->
    <update id="update">
        UPDATE user SET name = #{name} WHERE id = #{id}
    </update>

    <!-- 7. 删除语句 -->
    <delete id="delete">
        DELETE FROM user WHERE id = #{id}
    </delete>

</mapper>
```

## namespace：连接的桥梁

`namespace` 是 MyBatis 中最重要的配置之一，它有两个作用：

### 1. 绑定 Mapper 接口

```xml
<!-- UserMapper.xml -->
<mapper namespace="com.example.mapper.UserMapper">
    <select id="findById" resultType="User">
        SELECT * FROM user WHERE id = #{id}
    </select>
</mapper>
```

```java
// UserMapper.java
public interface UserMapper {
    User findById(Long id);
}
```

> **关键**：XML 中的 `id` 必须与接口中的方法名完全一致，MyBatis 才会自动绑定。

### 2. 隔离不同 Mapper

有了 namespace，即使两个 Mapper 都有 `findById` 方法，也不会冲突：

```xml
<!-- UserMapper.xml -->
<mapper namespace="com.example.mapper.UserMapper">
    <select id="findById" resultType="com.example.entity.User">
        SELECT * FROM user WHERE id = #{id}
    </select>
</mapper>

<!-- OrderMapper.xml -->
<mapper namespace="com.example.mapper.OrderMapper">
    <select id="findById" resultType="com.example.entity.Order">
        SELECT * FROM order WHERE id = #{id}
    </select>
</mapper>
```

## resultMap：结果映射的核心

`resultMap` 是 MyBatis 最强大的功能之一，用于处理：

- 列名与属性名不一致
- 复杂关联关系（一对一、一对多）
- 嵌套查询与嵌套结果

### 基础用法

```xml
<!-- 假设数据库列名是 user_id, user_name -->
<!-- 而 Java 属性是 id, name -->
<resultMap id="UserResultMap" type="User">
    <!-- id 用于标识主键，提升性能 -->
    <id property="id" column="user_id"/>
    <result property="name" column="user_name"/>
</resultMap>

<select id="findById" resultMap="UserResultMap">
    SELECT user_id, user_name FROM user WHERE id = #{id}
</select>
```

### 自动映射 vs 手动映射

```java
// 自动映射规则：user_name -> userName（驼峰转换）
// 数据库: user_name, user_email, user_status
// Java:   userName, userEmail, userStatus

// 开启驼峰映射
<settings>
    <setting name="mapUnderscoreToCamelCase" value="true"/>
</settings>
```

```xml
<!-- 简单查询可以直接用 resultType，自动映射 -->
<select id="findById" resultType="User">
    SELECT user_id, user_name, user_email
    FROM user WHERE id = #{id}
</select>

<!-- 复杂映射必须用 resultMap -->
<select id="findUserWithOrders" resultMap="UserWithOrdersResultMap">
    SELECT * FROM user u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = #{id}
</select>
```

### association：一对一关联

```xml
<resultMap id="OrderResultMap" type="Order">
    <id property="id" column="id"/>
    <result property="orderNo" column="order_no"/>
    <result property="userId" column="user_id"/>

    <!-- 一对一：嵌套查询方式 -->
    <association property="user" column="user_id"
                 select="com.example.mapper.UserMapper.findById"/>
</resultMap>

<select id="findOrderById" resultMap="OrderResultMap">
    SELECT * FROM orders WHERE id = #{id}
</select>
```

### collection：一对多关联

```xml
<resultMap id="UserResultMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>

    <!-- 一对多：嵌套查询方式 -->
    <collection property="orders" column="id"
                ofType="Order"
                select="com.example.mapper.OrderMapper.findByUserId"/>
</resultMap>

<select id="findUserWithOrders" resultMap="UserResultMap">
    SELECT * FROM user WHERE id = #{id}
</select>
```

## SQL 片段：复用之王

### 定义与使用

```xml
<!-- 定义 SQL 片段 -->
<sql id="Base_Column_List">
    id, name, email, status, create_time, update_time
</sql>

<!-- 使用 SQL 片段 -->
<select id="findById" resultType="User">
    SELECT <include refid="Base_Column_List"/>
    FROM user WHERE id = #{id}
</select>

<insert id="insert" useGeneratedKeys="true" keyProperty="id">
    INSERT INTO user (<include refid="Base_Column_List"/>)
</insert>
```

### 动态 SQL 中的 SQL 片段

```xml
<!-- 动态 SQL 片段 -->
<sql id="Base_Where">
    <if test="name != null and name != ''">
        AND name LIKE CONCAT('%', #{name}, '%')
    </if>
    <if test="status != null">
        AND status = #{status}
    </if>
</sql>

<select id="search" resultType="User">
    SELECT * FROM user
    <where>
        <include refid="Base_Where"/>
    </where>
</select>
```

## CRUD 语句标签

### select：查询

```xml
<select id="findById"
        parameterType="long"
        resultType="User"
        resultMap="customResultMap"
        useCache="true"
        timeout="30"
        fetchSize="100">
    SELECT * FROM user WHERE id = #{id}
</select>
```

**常用属性**：

| 属性 | 说明 |
|-----|------|
| `id` | 唯一标识，与接口方法对应 |
| `parameterType` | 参数类型（可省略，MyBatis 会自动推断） |
| `resultType` | 结果类型（用于自动映射） |
| `resultMap` | 结果映射（用于复杂映射） |
| `useCache` | 是否使用二级缓存 |
| `timeout` | 查询超时时间（秒） |
| `fetchSize` | 每次从数据库获取的记录数 |

### insert：插入

```xml
<insert id="insert"
        parameterType="User"
        useGeneratedKeys="true"
        keyProperty="id"
        keyColumn="id">
    INSERT INTO user (name, email, status)
    VALUES (#{name}, #{email}, #{status})
</insert>
```

**自增主键获取**：

```java
User user = new User();
user.setName("Tom");
userMapper.insert(user);
// 主键已自动回填到 user.id
System.out.println(user.getId()); // 自动生成的主键
```

**非自增主键**（如 UUID）：

```xml
<insert id="insertWithUUID" parameterType="User">
    <selectKey keyProperty="id" resultType="string" order="BEFORE">
        SELECT REPLACE(UUID(), '-', '') FROM DUAL
    </selectKey>
    INSERT INTO user (id, name) VALUES (#{id}, #{name})
</insert>
```

### update：更新

```xml
<update id="update"
        parameterType="User"
        timeout="30">
    UPDATE user
    SET name = #{name},
        email = #{email}
    WHERE id = #{id}
</update>
```

### delete：删除

```xml
<delete id="delete" parameterType="long">
    DELETE FROM user WHERE id = #{id}
</delete>

<!-- 批量删除 -->
<delete id="batchDelete" parameterType="list">
    DELETE FROM user WHERE id IN
    <foreach collection="list" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</delete>
```

## 参数处理

### 单个参数

```java
User findById(Long id);
```

```xml
<!-- #{任意名称} 都可以，因为只有一个参数 -->
<select id="findById" resultType="User">
    SELECT * FROM user WHERE id = #{id}
</select>
```

### 多个参数

```java
User findByNameAndStatus(String name, Integer status);
```

```xml
<!-- 方式一：使用 param1, param2...（不推荐） -->
<select id="findByNameAndStatus" resultType="User">
    SELECT * FROM user WHERE name = #{param1} AND status = #{param2}
</select>

<!-- 方式二：使用 @Param 注解（推荐） -->
<select id="findByNameAndStatus" resultType="User">
    SELECT * FROM user WHERE name = #{name} AND status = #{status}
</select>
```

### 命名参数：@Param

```java
User findByEmail(@Param("email") String email,
                 @Param("status") Integer status);
```

```xml
<select id="findByEmail" resultType="User">
    SELECT * FROM user
    WHERE email = #{email} AND status = #{status}
</select>
```

### Map 参数

```java
Map<String, Object> params = new HashMap<>();
params.put("name", "Tom");
params.put("status", 1);

List<User> users = mapper.searchByMap(params);
```

```xml
<select id="searchByMap" parameterType="map" resultType="User">
    SELECT * FROM user
    WHERE name = #{name} AND status = #{status}
</select>
```

### POJO 参数

```java
UserQuery query = new UserQuery();
query.setName("Tom");
query.setStatus(1);

List<User> users = mapper.search(query);
```

```xml
<select id="search" parameterType="UserQuery" resultType="User">
    SELECT * FROM user
    WHERE name = #{name} AND status = #{status}
</select>
```

## 常用配置对比

| 标签 | 作用 | 示例 |
|-----|------|-----|
| `mapper` | 根节点，定义 SQL 映射 | - |
| `cache` | 配置二级缓存 | `<cache eviction="LRU"/>` |
| `resultMap` | 定义结果映射规则 | `<resultMap id="..." type="...">` |
| `sql` | 定义可复用的 SQL 片段 | `<sql id="...">...</sql>` |
| `select` | 查询语句 | `<select id="...">` |
| `insert` | 插入语句 | `<insert id="...">` |
| `update` | 更新语句 | `<update id="...">` |
| `delete` | 删除语句 | `<delete id="...">` |
| `association` | 一对一关联 | `<association property="user">` |
| `collection` | 一对多关联 | `<collection property="orders">` |

---

## 面试高频问题

### Q1：resultType 和 resultMap 的区别？

- `resultType`：自动映射，要求列名与属性名一致（或开启驼峰映射）
- `resultMap`：手动映射，可以处理复杂关联、自定义转换逻辑

### Q2：为什么 resultMap 中要用 id 标签？

`id` 标签标识主键，用于：

1. **提升性能**：MyBatis 可以快速定位对象
2. **保证对象唯一性**：嵌套结果映射时避免重复对象
3. **缓存优化**：二级缓存依赖 id 来区分不同对象

### Q3：insert 标签的 useGeneratedKeys 和 keyProperty 有什么用？

用于获取数据库自动生成的主键：

```xml
<insert id="insert" useGeneratedKeys="true" keyProperty="id">
    INSERT INTO user (name) VALUES (#{name})
</insert>
```

```java
User user = new User();
user.setName("Tom");
mapper.insert(user);
System.out.println(user.getId()); // 数据库自动生成的主键
```

---

## 最佳实践

### 1. 保持 XML 整洁

```xml
<!-- 推荐：结构清晰，标签顺序固定 -->
<mapper namespace="...">
    <cache/>
    <resultMap/>
    <sql/>

    <select/>
    <insert/>
    <update/>
    <delete/>
</mapper>
```

### 2. 使用包扫描简化配置

```xml
<!-- 不需要每个 mapper 都手动注册 -->
<mappers>
    <package name="com.example.mapper"/>
</mappers>
```

### 3. resultMap 继承减少重复

```xml
<!-- 基础映射 -->
<resultMap id="BaseUserMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>
    <result property="email" column="email"/>
</resultMap>

<!-- 继承并扩展 -->
<resultMap id="UserWithOrdersMap" type="User" extends="BaseUserMap">
    <collection property="orders" column="id"
                select="com.example.mapper.OrderMapper.findByUserId"/>
</resultMap>
```

---

## 思考题

如果数据库中有一个字段 `create_time`，而 Java 实体中是 `createTime`，有哪些方式可以让 MyBatis 正确映射？

下一节，我们看 [resultMap 配置详解](/framework/mybatis/resultmap)，深入学习 association 和 collection 的用法。
