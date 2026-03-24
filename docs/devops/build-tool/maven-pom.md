# Maven pom.xml 核心配置

`pom.xml` 是 Maven 项目的核心配置文件。理解它的结构，是掌握 Maven 的必经之路。

## pom.xml 最小配置

一个最简 pom.xml 只需要 GAV：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>my-project</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>
</project>
```

`modelVersion` 固定为 `4.0.0`，Maven 通过它知道用哪个版本的 POM 模型解析。

## 标准项目结构

```
my-project/
├── pom.xml
└── src/
    ├── main/
    │   ├── java/         # Java 源代码
    │   └── resources/    # 资源文件
    └── test/
        ├── java/         # 测试源代码
        └── resources/    # 测试资源文件
```

这是 Maven 的**约定优于配置**——你不需要告诉 Maven 源码在哪，它默认按这个结构找。

## dependencies——依赖声明

最常用的部分，声明项目依赖：

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
        <version>3.2.0</version>
        <!-- 作用域，默认是 compile -->
        <scope>compile</scope>
        <!-- 是否可选，默认 false -->
        <optional>false</optional>
        <!-- 排除传递依赖 -->
        <exclusions>
            <exclusion>
                <groupId>com.fasterxml.jackson.core</groupId>
                <artifactId>jackson-databind</artifactId>
            </exclusion>
        </exclusions>
    </dependency>
</dependencies>
```

## dependencyManagement——依赖版本管理

只在父 POM 中使用，统一管理子模块的依赖版本：

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-dependencies</artifactId>
            <version>3.2.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>

        <!-- 自定义版本管理 -->
        <dependency>
            <groupId>com.alibaba</groupId>
            <artifactId>fastjson</artifactId>
            <version>2.0.0</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

**关键点**：`dependencyManagement` 中的依赖不会自动引入项目，只声明版本。子项目使用时不需要写版本号。

## build——构建配置

### plugins 与 pluginManagement

```xml
<build>
    <!-- 直接启用的插件，所有子模块继承 -->
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.11.0</version>
            <configuration>
                <source>17</source>
                <target>17</target>
            </configuration>
        </plugin>
    </plugins>

    <!-- 插件版本管理，子模块需要显式引用才生效 -->
    <pluginManagement>
        <plugins>
            <plugin>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.0.0</version>
            </plugin>
        </plugins>
    </pluginManagement>
</build>
```

### 资源过滤

让资源文件中的占位符在构建时被替换：

```xml
<resources>
    <resource>
        <directory>src/main/resources</directory>
        <filtering>true</filtering>
        <includes>
            <include>**/*.properties</include>
            <include>**/*.xml</include>
        </includes>
    </resource>
</resources>
```

配合 Maven 属性使用：

```properties
# application.properties
app.version=${project.version}
db.url=${DB_URL}
```

```bash
mvn clean package -DDB_URL=jdbc:mysql://localhost:3306/test
```

### 源码目录配置

覆盖默认源码目录（不推荐，但有时需要）：

```xml
<build>
    <sourceDirectory>src/main/java</sourceDirectory>
    <testSourceDirectory>src/test/java</testSourceDirectory>
    <resources>
        <resource>
            <directory>src/main/resources</directory>
        </resource>
    </resources>
</build>
```

## profiles——多环境构建

通过 profiles 实现多环境配置切换：

```xml
<profiles>
    <profile>
        <!-- 环境 id -->
        <id>dev</id>
        <activation>
            <activeByDefault>true</activeByDefault>
        </activation>
        <properties>
            <env>dev</env>
            <db.url>jdbc:mysql://localhost:3306/dev_db</db.url>
            <db.username>dev</db.username>
            <db.password>dev123</db.password>
        </properties>
    </profile>

    <profile>
        <id>test</id>
        <properties>
            <env>test</env>
            <db.url>jdbc:mysql://test-server:3306/test_db</db.url>
            <db.username>test</db.username>
            <db.password>test123</db.password>
        </properties>
    </profile>

    <profile>
        <id>prod</id>
        <properties>
            <env>prod</env>
            <db.url>jdbc:mysql://prod-server:3306/prod_db</db.url>
            <db.username>prod</db.username>
            <db.password>prod123</db.password>
        </properties>
    </profile>
</profiles>
```

使用：

```bash
mvn clean package -Pprod
```

## properties——自定义属性

定义可在 pom.xml 中复用的属性：

```xml
<properties>
    <java.version>17</java.version>
    <maven.compiler.source>${java.version}</maven.compiler.source>
    <maven.compiler.target>${java.version}</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <spring-boot.version>3.2.0</spring-boot.version>
    <my.custom.property>hello</my.custom.property>
</properties>
```

使用方式：`${属性名}`

## 完整 pom.xml 示例

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <!-- 项目坐标 -->
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <!-- 项目名称和描述 -->
    <name>My Application</name>
    <description>A sample application</description>
    <url>https://example.com</url>

    <!-- 继承的父 POM -->
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.0</version>
        <relativePath/>
    </parent>

    <!-- 属性 -->
    <properties>
        <java.version>17</java.version>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <!-- 依赖 -->
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <!-- 构建配置 -->
    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

## Maven 的 Super POM

每个 pom.xml 都隐式继承了 Maven 的 **Super POM**。它定义了所有默认配置：

```xml
<!-- Maven Super POM 的关键配置 -->
<build>
    <directory>${basedir}/target</directory>
    <sourceDirectory>${basedir}/src/main/java</sourceDirectory>
    <testSourceDirectory>${basedir}/src/test/java</testSourceDirectory>
    <plugins>
        <plugin>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.11.0</version>
        </plugin>
    </plugins>
</build>
```

查看实际生效的 pom：`mvn help:effective-pom`

## 面试高频问题

**问：dependencies 和 dependencyManagement 的区别是什么？**

答：`dependencies` 中的依赖会被直接引入项目并传递。`dependencyManagement` 只声明版本信息，不引入依赖，需要子项目显式声明。父 POM 用 `dependencyManagement` 管理版本，子 POM 用 `dependencies` 声明，是 Maven 多模块项目的标准实践。

**问：如何让 pom.xml 中的属性在资源文件中使用？**

答：两步。第一步在 `pom.xml > build > resources > resource` 中开启 `filtering=true`。第二步在资源文件中使用 `${属性名}` 占位符。Maven 打包时会自动替换这些占位符。

**问：parent 标签的 relativePath 有什么用？**

答：指定父 POM 的相对路径。`../pom.xml` 表示上级目录的 pom.xml，`<relativePath/>` 表示从本地仓库查找（不从文件系统），Spring Boot 项目的 parent 就是这样配置的。
