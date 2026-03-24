# Maven 依赖作用域（Scope）

Maven 的 Scope 看似简单，但用错作用域是生产环境 ClassNotFoundException 的常见原因之一。

## 六种作用域一览

| Scope | 编译时可见 | 运行时可见 | 传递性 | 典型用途 |
|-------|-----------|-----------|--------|---------|
| **compile** | ✅ | ✅ | ✅ | 默认值，大部分依赖 |
| **provided** | ✅ | ❌ | ❌ | JDK/容器已提供 |
| **runtime** | ❌ | ✅ | ✅ | 运行时才需要 |
| **test** | ❌ | ❌ | ❌ | 仅测试代码使用 |
| **system** | ✅ | ❌ | ❌ | 系统路径 JAR |
| **import** | ❌ | ❌ | ❌ | 仅在 dependencyManagement 中导入 BOM |

## compile——默认作用域

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <scope>compile</scope>  <!-- 可省略 -->
</dependency>
```

编译、测试、运行都可用，会传递到依赖该项目的产品中。

**适用场景**：大多数依赖，如 Spring、Hibernate、Jackson 等。

## provided——已提供作用域

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-tomcat</artifactId>
    <scope>provided</scope>
</dependency>
```

编译、测试时可用，**运行时不打包**。因为运行环境的 JDK 或容器（如 Tomcat）已经提供了这些类。

**适用场景**：
- `servlet-api`：Tomcat 已提供
- `spring-boot-starter-tomcat`：嵌入式 Tomcat 已包含
- `jakarta.servlet-api`：Jakarta EE 容器已提供

**常见错误**：把 `servlet-api` 写成 `compile`，会导致打包进 WAR，和容器自带的 servlet-api 冲突（方法签名重复）。

## runtime——运行时作用域

```xml
<dependency>
    <groupId>mysql</groupId>
    <artifactId>mysql-connector-java</artifactId>
    <version>8.0.33</version>
    <scope>runtime</scope>
</dependency>
```

编译时不需要（代码中不直接引用），运行时才需要。打包时会包含，但编译时不会参与。

**适用场景**：数据库驱动。代码里写 `Class.forName("com.mysql.cj.jdbc.Driver")` 是运行时触发的，不需要在编译时可用。

**典型场景**：

```java
// 编译时只需要 JDBC 接口（由 JDK 提供）
// 运行时才需要 MySQL 驱动实现
Connection conn = DriverManager.getConnection(url, user, password);
```

## test——仅测试作用域

```xml
<dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter</artifactId>
    <version>5.10.0</version>
    <scope>test</scope>
</dependency>
```

仅在 `src/test/java` 目录下编译和运行。打包时不会包含，不会传递。

**适用场景**：
- JUnit、TestNG（测试框架）
- Mockito（Mock 库）
- Spring Boot Test（测试支持）

**常见错误**：把测试依赖写在 `compile` 作用域，导致打包时把 JUnit 也打进去。

## system——系统作用域（不推荐）

```xml
<dependency>
    <groupId>com.oracle</groupId>
    <artifactId>ojdbc8</artifactId>
    <version>19.3</version>
    <scope>system</scope>
    <systemPath>${project.basedir}/libs/ojdbc8.jar</systemPath>
</dependency>
```

从本地系统路径引入 JAR，不从仓库下载。**不推荐使用**，因为它不可移植（换机器路径可能不对）。

**唯一使用场景**：Oracle 驱动因为许可证问题无法从 Maven 中央仓库下载，只能手动下载后用 system 作用域引入。

**更好的替代方案**：搭建 Maven 私服（Nexus/Artifactory），把 Oracle 驱动上传到私服。

## import——导入作用域（高级）

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-dependencies</artifactId>
    <version>3.2.0</version>
    <scope>import</scope>
    <type>pom</type>
</dependency>
```

**仅在 `<dependencyManagement>` 中使用**，用于导入一个 BOM（Bill of Materials）的依赖列表。

这实际上是一种**版本托管**机制——它不引入依赖，而是把 BOM 中的依赖版本信息合并到当前项目的 dependencyManagement 中。

## 作用域与传递依赖的关系

```xml
<!-- A 的 scope 是 compile，B 依赖 A -->
<dependency>
    <groupId>com.example</groupId>
    <artifactId>A</artifactId>
    <scope>compile</scope>  <!-- 默认，传递 -->
</dependency>

<!-- B 的 dependency -->
<dependency>
    <groupId>com.example</groupId>
    <artifactId>B</artifactId>
    <scope>compile</scope>
</dependency>
```

当 A 的 scope 是 `compile` 或 `runtime` 时，传递依赖会把 A 的依赖带入 B。

当 A 的 scope 是 `provided`、`test`、`system` 时，**不会传递**。

## 实战：Spring Boot 中的作用域使用

```xml
<dependencies>
    <!-- compile（默认）：核心依赖 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <!-- runtime：运行时依赖，打包但不参与编译 -->
    <dependency>
        <groupId>com.mysql</groupId>
        <artifactId>mysql-connector-j</artifactId>
        <scope>runtime</scope>
    </dependency>

    <!-- provided：JDK/Tomcat 已提供 -->
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <scope>provided</scope>
    </dependency>

    <!-- test：仅测试使用 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-test</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

## 面试高频问题

**问：provided 和 compile 的核心区别是什么？**

答：编译时都可见，区别在于**打包和传递**。`provided` 的依赖不会打包进最终产物（因为假设运行环境已提供），也不会传递给依赖本项目的其他模块。`compile` 的依赖会打包并传递。

**问：运行时依赖 scope 为什么不用 compile？**

答：假设数据库驱动是 `compile`，代码编译时需要用到驱动里的类（但实际只需要 JDBC 接口，不需要具体实现类）。用 `runtime` 更准确，而且可以避免驱动类在编译时意外被引入到 classpath 中。

**问：Spring Boot 的 starter 为什么通常是 compile scope？**

答：Spring Boot starter 本质上是一个依赖聚合器，它本身不包含具体实现，只引用了具体依赖。用 `compile` 才能让 starter 的所有传递依赖正确地传递到使用它的项目中。
