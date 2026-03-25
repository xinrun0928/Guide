# ORM 总览：Java 数据持久化的演进之路

你有没有想过，为什么 Java 开发者要学这么多持久层技术？

JDBC、Hibernate、MyBatis、Spring Data JPA、MyBatis Plus……

它们有什么区别？各自适合什么场景？

这一节，我们从 ORM 的起源说起，理清这些技术之间的关系。

## 从 JDBC 到 ORM：数据持久化的演进

```
┌─────────────────────────────────────────────────────────────────┐
│                    数据持久化技术演进                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  JDBC (1997)                                                    │
│  ├── 纯 Java 操作数据库的标准 API                                 │
│  ├── 手动管理连接、Statement、ResultSet                          │
│  └── 优点：完全可控 | 缺点：代码繁琐                              │
│          │                                                      │
│          ▼                                                      │
│  ORM (Object-Relational Mapping)                                │
│  ├── 对象和关系数据库的映射                                      │
│  ├── 减少样板代码                                                │
│  └── 优点：开发效率 | 缺点：学习曲线、SQL 不透明                  │
│          │                                                      │
│          ▼                                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │                  ORM 框架百花齐放                       │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │     │
│  │  │  Hibernate  │  │   MyBatis   │  │  Spring Data│    │     │
│  │  │  (全自动)   │  │  (半自动)   │  │  JPA 等     │    │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘    │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 什么是 ORM？

ORM（Object-Relational Mapping）是一种程序设计技术，用于实现面向对象编程语言里不同类型系统的数据之间的转换。

简单来说：**ORM 让开发者可以用操作对象的方式操作数据库，而不用写 SQL**。

### 原生 JDBC

```java
// 查询用户
Connection conn = null;
PreparedStatement stmt = null;
ResultSet rs = null;
try {
    conn = dataSource.getConnection();
    stmt = conn.prepareStatement("SELECT * FROM user WHERE id = ?");
    stmt.setInt(1, userId);
    rs = stmt.executeQuery();
    User user = null;
    if (rs.next()) {
        user = new User();
        user.setId(rs.getInt("id"));
        user.setName(rs.getString("name"));
        user.setEmail(rs.getString("email"));
    }
    return user;
} finally {
    // 关闭连接...
}
```

### ORM 方式

```java
// 查询用户 - 一行代码
User user = userRepository.findById(userId);
```

## 主流 ORM 框架对比

| 框架 | 类型 | SQL 控制 | 学习成本 | 适用场景 |
|-----|------|---------|---------|---------|
| Hibernate | 全自动 | 框架生成 | 较高 | 快速开发、简单 CRUD |
| MyBatis | 半自动 | 开发者编写 | 中等 | 复杂查询、性能优化 |
| Spring Data JPA | 全自动（基于 Hibernate） | 框架生成 | 中等 | 快速开发、约定优于配置 |
| MyBatis Plus | 半自动（增强 MyBatis） | 大部分自动 | 低 | 快速开发 + SQL 控制 |
| JDBC Template | 手动 | 开发者编写 | 低 | 轻量级、对 SQL 要求高 |

### 全自动 ORM（以 Hibernate 为代表）

**特点**：开发者不需要写 SQL，框架自动生成。

```java
// Hibernate：直接操作对象
User user = session.get(User.class, 1L);
user.setName("New Name");
session.update(user);
```

**优点**：
- 开发效率高
- 代码简洁
- 数据库无关性好

**缺点**：
- SQL 由框架生成，不够灵活
- 复杂查询实现困难
- 性能调优困难

### 半自动 ORM（以 MyBatis 为代表）

**特点**：SQL 由开发者编写，映射由框架处理。

```java
// MyBatis：手写 SQL
@Select("SELECT * FROM user WHERE id = #{id}")
User findById(Long id);
```

**优点**：
- SQL 完全可控
- 可以做深度优化
- 复杂查询容易实现

**缺点**：
- 需要手写 SQL
- 代码量相对较多

## 为什么需要 ORM？

### 1. 减少样板代码

JDBC 的连接管理、异常处理、资源关闭……都是样板代码。ORM 帮你省略这些。

### 2. 提高开发效率

CRUD 操作从几十行代码变成一行。

### 3. 对象化思维

用面向对象的方式操作数据库，代码更易读。

### 4. 数据库无关性

换数据库只需要改配置，代码基本不动。

## ORM 的问题

### 1. 性能损耗

框架封装带来的性能损耗，通常可以接受。

### 2. SQL 不透明

全自动 ORM 的 SQL 由框架生成，开发者难以控制。

### 3. 学习曲线

每个 ORM 框架都有自己的概念和 API。

### 4. 过度使用

有些人把 ORM 当作银弹，什么场景都用，结果适得其反。

## 如何选择？

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORM 框架选择决策树                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  需要手写复杂 SQL？                                              │
│       │                                                         │
│       ├── 是 ──→ MyBatis / MyBatis Plus                         │
│       │                                                         │
│       └── 否 ──→ 需要极致开发效率？                               │
│                      │                                           │
│                      ├── 是 ──→ Hibernate / Spring Data JPA      │
│                      │                                           │
│                      └── 否 ──→ 需要平衡效率和可控性？            │
│                                     │                            │
│                                     └── 是 ──→ MyBatis Plus      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 章节导航

- [ORM 框架对比](/framework/orm/orm-compare)
- [JDBC 执行流程](/framework/orm/jdbc)
- [数据库连接池](/framework/orm/connection-pool)
- [HikariCP 高性能原理](/framework/orm/hikaricp)
- [Spring JDBC Template](/framework/orm/jdbc-template)

---

## 思考题

一个电商系统，有以下模块：

- 用户模块：简单的 CRUD
- 商品模块：复杂的搜索、筛选、排序
- 订单模块：复杂的事务处理
- 报表模块：大量复杂统计 SQL

应该选择哪些持久层技术？为什么？

提示：可以混用不同技术。
