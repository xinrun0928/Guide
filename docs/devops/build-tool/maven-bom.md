# Maven BOM（Bill of Materials）：统一管理依赖版本

## 什么是 BOM？

BOM（Bill of Materials）是一份「材料清单」，它本身不包含任何代码，只是一份依赖版本列表。

Maven 中的 BOM 实际上是一个 `pom.xml`，其中 `<dependencyManagement>` 部分列出了一组经过兼容性测试的依赖及其版本。

## 为什么需要 BOM？

假设项目同时使用 Spring Boot 和 Elasticsearch：

```
├── Spring Boot 2.7.0
│   └── Jackson 2.13.x
└── Elasticsearch 7.17.0
    └── Jackson 2.12.x
```

Jackson 版本冲突！手动管理每个依赖的版本非常繁琐，而且容易出错。

BOM 的解决方案：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-dependencies</artifactId>
    <version>3.2.0</version>
    <type>pom</type>
    <scope>import</scope>
</dependency>
```

导入 Spring Boot 的 BOM 后，Spring Boot 管理的所有依赖版本自动生效，Jackson 版本冲突问题由 Spring Boot 团队统一解决。

## 如何创建自定义 BOM

如果团队有多个相互依赖的内部模块，可以使用 BOM 统一管理版本：

### 步骤一：创建 BOM 项目

```xml
<!-- bom-project/pom.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>company-bom</artifactId>
    <version>1.0.0</version>
    <packaging>pom</packaging>

    <name>Company BOM</name>
    <description>Company-wide dependency management</description>

    <dependencyManagement>
        <dependencies>
            <!-- 内部模块 -->
            <dependency>
                <groupId>com.example</groupId>
                <artifactId>module-user</artifactId>
                <version>${project.version}</version>
            </dependency>
            <dependency>
                <groupId>com.example</groupId>
                <artifactId>module-order</artifactId>
                <version>${project.version}</version>
            </dependency>

            <!-- 统一第三方库版本 -->
            <dependency>
                <groupId>com.alibaba</groupId>
                <artifactId>fastjson</artifactId>
                <version>2.0.0</version>
            </dependency>
            <dependency>
                <groupId>org.apache.commons</groupId>
                <artifactId>commons-lang3</artifactId>
                <version>3.12.0</version>
            </dependency>
        </dependencies>
    </dependencyManagement>
</project>
```

### 步骤二：发布 BOM 到私服

```bash
mvn clean install   # 安装到本地仓库
mvn deploy          # 部署到私服，供团队使用
```

### 步骤三：子项目引入 BOM

```xml
<dependency>
    <groupId>com.example</groupId>
    <artifactId>company-bom</artifactId>
    <version>1.0.0</version>
    <type>pom</type>
    <scope>import</scope>
</dependency>
```

引入后，子项目可以直接依赖任何在 BOM 中定义的构件，不需要指定版本。

## import scope 的限制

BOM 必须使用 `import` 作用域，并且只能在 `<dependencyManagement>` 中使用：

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>company-bom</artifactId>
            <version>1.0.0</version>
            <type>pom</type>
            <scope>import</scope>  <!-- 必须写 import -->
        </dependency>
    </dependencies>
</dependencyManagement>
```

> **注意**：`import` 作用域仅在 Maven 2.x+ 支持，Maven 3.x 完全支持。

## BOM 的版本合并规则

当存在多个 BOM 时，版本合并规则如下：

1. 直接在 pom.xml 中声明的版本优先级最高
2. 按 BOM 导入顺序，后导入的 BOM 覆盖先导入的

```xml
<dependencyManagement>
    <dependencies>
        <!-- 先导入 Spring Boot BOM -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-dependencies</artifactId>
            <version>3.2.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>

        <!-- 后导入公司自定义 BOM，版本以公司为准 -->
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>company-bom</artifactId>
            <version>1.0.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

## Spring Boot 的 BOM 策略

Spring Boot 的 `spring-boot-dependencies` 是 Java 生态中最成功的 BOM 实践：

- 管理了 400+ 依赖的版本
- 解决了所有已知依赖间的兼容性问题
- 每月更新，修复安全漏洞

所有 Spring Boot Starter 无需指定版本，因为版本由 BOM 统一管理：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <!-- 不写 version，由 spring-boot-dependencies 管理 -->
</dependency>
```

## 面试高频问题

**问：BOM 和 dependencyManagement 有什么区别？**

答：BOM 本质上是一个特殊的 POM，其中使用 `dependencyManagement` 定义版本。区别在于 BOM 可以被导入（`import` scope），实现跨项目共享版本管理。
