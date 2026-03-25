# MyBatis 初始化流程：从 XML 到 Configuration

你有没有想过，MyBatis 配置文件里的每一个标签——`<environments>`、`<mappers>`、`<typeAliases>`——最后都去了哪里？

答案是：**它们都被解析进了 Configuration 对象**。

Configuration 是 MyBatis 的**配置中心**，它保存了所有的配置信息。理解初始化流程，就是理解 MyBatis 是如何「认识」你的项目结构的。

## 初始化入口：SqlSessionFactoryBuilder

一切从这行代码开始：

```java
SqlSessionFactory factory = new SqlSessionFactoryBuilder()
    .build(inputStream);
```

`SqlSessionFactoryBuilder` 的工作很简单：**读取配置，构建 SqlSessionFactory**。

它可以接受多种输入：

```java
// 方式一：InputStream（最常见）
InputStream config = Resources.getResourceAsStream("mybatis-config.xml");
SqlSessionFactory factory = new SqlSessionFactoryBuilder().build(config);

// 方式二：Reader
Reader reader = Resources.getResourceAsReader("mybatis-config.xml");
SqlSessionFactory factory = new SqlSessionFactoryBuilder().build(reader);

// 方式三：直接传入 Configuration（用于编程式配置）
Configuration config = new Configuration();
SqlSessionFactory factory = new SqlSessionFactoryBuilder().build(config);
```

## 核心流程：XMLConfigBuilder

`SqlSessionFactoryBuilder.build()` 内部，实际是由 `XMLConfigBuilder` 完成解析工作：

```java
// SqlSessionFactoryBuilder.build() 源码简化
public SqlSessionFactory build(InputStream inputStream) {
    // 1. 创建 XMLConfigBuilder
    XMLConfigBuilder parser = new XMLConfigBuilder(inputStream);
    // 2. 解析配置，返回 Configuration
    Configuration config = parser.parse();
    // 3. 构建 DefaultSqlSessionFactory
    return new DefaultSqlSessionFactory(config);
}
```

### XMLConfigBuilder 的解析顺序

MyBatis 对配置文件的解析是**按固定顺序**的，顺序很重要：

```xml
<!-- mybatis-config.xml 标准结构 -->
<configuration>
    <properties/>         <!-- 第1步：属性（可以定义变量） -->
    <settings/>            <!-- 第2步：全局配置（如缓存、延迟加载） -->
    <typeAliases/>         <!-- 第3步：类型别名 -->
    <typeHandlers/>        <!-- 第4步：类型处理器 -->
    <objectFactory/>       <!-- 第5步：对象工厂 -->
    <plugins/>             <!-- 第6步：插件 -->
    <environments/>         <!-- 第7步：环境配置 -->
    <databaseIdProvider/>  <!-- 第8步：数据库标识 -->
    <mappers/>             <!-- 第9步：Mapper 注册 -->
</configuration>
```

### 每一步做了什么

#### 1. properties：属性配置

```xml
<properties resource="db.properties">
    <property name="username" value="${db.username}"/>
</properties>
```

解析后，properties 的值可以在后续配置中通过 `${key}` 引用。

#### 2. settings：全局配置

```xml
<settings>
    <!-- 开启二级缓存 -->
    <setting name="cacheEnabled" value="true"/>
    <!-- 开启延迟加载 -->
    <setting name="lazyLoadingEnabled" value="true"/>
    <!-- 下划线自动映射为驼峰 -->
    <setting name="mapUnderscoreToCamelCase" value="true"/>
</settings>
```

这些配置会直接影响 MyBatis 的行为。

#### 3. typeAliases：类型别名

```xml
<typeAliases>
    <!-- 单个类别名 -->
    <typeAlias type="com.example.User" alias="User"/>
    <!-- 包扫描（类名即为别名） -->
    <package name="com.example.entity"/>
</typeAliases>
```

别名可以在 resultType、parameterType 中使用。

#### 4. typeHandlers：类型处理器

```xml
<typeHandlers>
    <package name="com.example.handler"/>
</typeHandlers>
```

MyBatis 会自动扫描并注册包下的所有 `TypeHandler`。

#### 5. plugins：插件配置

```xml
<plugins>
    <plugin interceptor="com.github.pagehelper.PageInterceptor">
        <property name="helperDialect" value="mysql"/>
    </plugin>
</plugins>
```

#### 6. environments：环境配置

```xml
<environments default="development">
    <environment id="development">
        <transactionManager type="JDBC"/>
        <dataSource type="POOLED">
            <property name="driver" value="${driver}"/>
            <property name="url" value="${url}"/>
            <property name="username" value="${username}"/>
            <property name="password" value="${password}"/>
        </dataSource>
    </environment>
</environments>
```

> **面试重点**：`transactionManager` 的 type 可以是 JDBC 或 MANAGED。两者的区别是：
> - **JDBC**：手动提交，事务由应用程序控制
> - **MANAGED**：由容器管理，提交由容器决定（如 Spring）

#### 7. mappers：Mapper 注册

```xml
<mappers>
    <!-- XML 文件方式 -->
    <mapper resource="com/example/mapper/UserMapper.xml"/>

    <!-- 注解方式 -->
    <mapper class="com.example.mapper.UserMapper"/>

    <!-- 包扫描方式 -->
    <package name="com.example.mapper"/>
</mappers>
```

## Mapper 的加载过程

当解析到 `<mappers>` 标签时，MyBatis 开始加载 Mapper。

对于 XML Mapper：

```java
// XMLMapperBuilder 解析流程
XMLMapperBuilder mapperParser = new XMLMapperBuilder(inputStream, config, ...);
mapperParser.parse();

// parse() 内部做了什么
// 1. 解析 <select|insert|update|delete> 标签，构建 MappedStatement
// 2. 解析 <resultMap>，构建 ResultMap
// 3. 解析 <cache>，配置二级缓存
// 4. 解析 <parameterMap>（已废弃），构建 ParameterMap
```

## Configuration：配置中心

最终，所有配置都会汇聚到 `Configuration` 对象中：

```java
public class Configuration {
    // 环境
    protected Environment environment;

    // Mapper 语句（SQL）
    protected final Map&lt;String, MappedStatement&gt; mappedStatements = new StrictMap<>();

    // ResultMap
    protected final Map&lt;String, ResultMap&gt; resultMaps = new StrictMap<>();

    // 类型别名
    protected final TypeAliasRegistry typeAliasRegistry = new TypeAliasRegistry();

    // 类型处理器
    protected final TypeHandlerRegistry typeHandlerRegistry = new TypeHandlerRegistry();

    // 缓存
    protected final Map&lt;String, Cache&gt; caches = new StrictMap<>();

    // ... 还有更多
}
```

这就是 MyBatis 运行时的「大脑」——所有后续操作都要从 Configuration 中获取信息。

## 完整初始化时序图

```
┌──────────────────┐
│     用户代码      │
└────────┬─────────┘
         │ new SqlSessionFactoryBuilder().build(inputStream)
         ▼
┌──────────────────┐
│ SqlSessionFactory │  ← 只用做构建入口
│     Builder       │
└────────┬─────────┘
         │ build()
         ▼
┌──────────────────┐
│  XMLConfigBuilder │  ← 真正的解析工作在这里
│      .parse()    │
└────────┬─────────┘
         │
         ├─► parseProperties()        第1步
         ├─► parseSettings()          第2步
         ├─► parseTypeAliases()       第3步
         ├─► parseTypeHandlers()      第4步
         ├─► parsePlugins()           第5步
         ├─► parseEnvironments()       第6步
         └─► parseMappers()            第7步
                   │
                   └─► XMLMapperBuilder.parse()
                              │
                              ├─► buildStatementFromContext()  → MappedStatement
                              ├─► resultMapElements()         → ResultMap
                              └─► cacheElement()             → Cache
         ▼
┌──────────────────┐
│   Configuration   │  ← 所有配置最终汇聚到这里
└────────┬─────────┘
         │ new DefaultSqlSessionFactory(config)
         ▼
┌──────────────────┐
│ SqlSessionFactory │  ← 初始化完成，可以创建 SqlSession
└──────────────────┘
```

## Spring Boot 中的初始化

在 Spring Boot 中，MyBatis 的初始化被自动化了：

```java
// 自动配置类：MybatisAutoConfiguration
// 1. 读取 mybatis.config-location 配置（如果有）
// 2. 读取 mybatis.mapper-locations 配置
// 3. 扫描 @MapperScan 指定的包
// 4. 注册所有 Mapper
```

你只需要在 application.yml 中配置：

```yaml
mybatis:
  mapper-locations: classpath:mapper/*.xml
  type-aliases-package: com.example.entity
  configuration:
    map-underscore-to-camel-case: true
```

## 面试高频问题

### Q1：MyBatis 初始化过程中，解析 XML Mapper 和注解 Mapper 的顺序是什么？

解析顺序取决于 `<mappers>` 标签的配置顺序。如果 XML 和注解配置的接口同名（包名+类名相同），**后解析的会覆盖先解析的**。

### Q2：Configuration 是单例吗？

**不是**。每个 `SqlSessionFactory` 有自己的 `Configuration`。不同 `SqlSessionFactory` 的配置可以不同。

---

## 思考题

如果我定义了相同的 Mapper ID（在不同的 XML 中），MyBatis 会报错还是覆盖？

答案：**不会报错，但运行时会抛出 `BindingException`**，提示「Found two statements for the same id」。

这就是 MyBatis 的设计哲学——**配置即文档**，相同的 ID 是不被允许的。

下一节，我们看看 [SqlSessionFactory](/framework/mybatis/sqlsessionfactory) 的创建流程与生命周期。
