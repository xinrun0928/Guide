# Maven 多模块项目：聚合与依赖管理

当项目变大时，我们需要把一个巨大单体拆成多个模块——每个模块独立开发、测试、打包，多个模块协同工作。这就是 Maven 的**多模块项目管理**。

## 为什么需要多模块？

```
单体项目的问题：
├── 一个模块的改动，可能导致整个项目重新编译
├── 不同团队修改同一个项目，Git 冲突频繁
├── 无法针对单个模块发布
└── 模块间的依赖关系不清晰
```

多模块的优势：
- **独立构建**：只修改了模块 A，不需要重新编译模块 B
- **职责分离**：每个模块专注做一件事
- **灵活发布**：可以单独发布某个模块
- **依赖清晰**：通过 Maven 依赖关系显式表达模块间依赖

## 创建多模块项目

### 项目结构

```
parent-project/
├── pom.xml                    ← 父 POM（聚合 POM）
├── module-a/                  ← 模块 A
│   └── pom.xml
├── module-b/                  ← 模块 B
│   └── pom.xml
└── module-c/                  ← 模块 C
    └── pom.xml
```

### 父 POM 配置

父 POM 有两个职责：**聚合管理**和**依赖管理**。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>parent-project</artifactId>
    <version>1.0.0</version>
    <packaging>pom</packaging>

    <!-- 1. 聚合：声明包含哪些模块 -->
    <modules>
        <module>module-a</module>
        <module>module-b</module>
        <module>module-c</module>
    </modules>

    <!-- 2. 统一版本管理 -->
    <properties>
        <java.version>17</java.version>
        <spring-boot.version>3.2.0</spring-boot.version>
        <mybatis.version>3.0.3</mybatis.version>
    </properties>

    <!-- 3. 依赖管理 -->
    <dependencyManagement>
        <dependencies>
            <!-- Spring Boot 依赖 BOM -->
            <dependency>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-dependencies</artifactId>
                <version>${spring-boot.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>

            <!-- 自定义依赖版本 -->
            <dependency>
                <groupId>org.mybatis.spring.boot</groupId>
                <artifactId>mybatis-spring-boot-starter</artifactId>
                <version>${mybatis.version}</version>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <!-- 4. 全局插件配置 -->
    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-maven-plugin</artifactId>
                    <version>${spring-boot.version}</version>
                </plugin>
            </plugins>
        </pluginManagement>
    </build>
</project>
```

**注意**：`packaging` 必须设为 `pom`，否则无法聚合子模块。

### 子模块配置

```xml
<!-- module-a/pom.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>

    <!-- 继承父 POM -->
    <parent>
        <groupId>com.example</groupId>
        <artifactId>parent-project</artifactId>
        <version>1.0.0</version>
    </parent>

    <artifactId>module-a</artifactId>
    <packaging>jar</packaging>

    <!-- 依赖版本由父 POM 管理，这里不需要写 version -->
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter</artifactId>
        </dependency>
    </dependencies>
</project>
```

### 模块间依赖

如果 module-c 依赖 module-a：

```xml
<!-- module-c/pom.xml -->
<dependencies>
    <!-- 依赖模块 A -->
    <dependency>
        <groupId>com.example</groupId>
        <artifactId>module-a</artifactId>
        <version>${project.version}</version>
    </dependency>
</dependencies>
```

## 依赖传递与模块构建顺序

Maven 会根据模块间的依赖关系自动计算构建顺序（构建有向无环图）。

```
module-c 依赖 module-a 和 module-b
module-b 依赖 module-a
module-a 无依赖

构建顺序：module-a → module-b → module-c
```

## 模块拆分策略

### 方式一：按业务领域拆分

```
parent/
├── common-utils/          # 通用工具类
├── domain-user/          # 用户领域
├── domain-order/         # 订单领域
└── api-gateway/          # 网关聚合
```

### 方式二：按层级拆分

```
parent/
├── model/                # 数据模型
├── dao/                  # 数据访问层
├── service/              # 服务层
└── web/                  # Web 层
```

### 方式三：混合格式

```
parent/
├── common/               # 公共模块
├── service-user/         # 用户服务（含 model + dao + service）
├── service-order/        # 订单服务
└── web-admin/            # 管理后台（Web 层聚合）
```

## dependencyManagement 的正确打开方式

父 POM 中使用 `dependencyManagement` 管理版本，子 POM 不写版本：

```xml
<!-- 父 POM -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.alibaba</groupId>
            <artifactId>fastjson</artifactId>
            <version>2.0.0</version>
        </dependency>
    </dependencies>
</dependencyManagement>

<!-- 子 POM -->
<dependencies>
    <dependency>
        <groupId>com.alibaba</groupId>
        <artifactId>fastjson</artifactId>
        <!-- 不写 version，从父 POM 继承 -->
    </dependency>
</dependencies>
```

这样做的好处：
1. **版本统一**：所有子模块使用相同版本
2. **增量声明**：子 POM 只声明依赖，不需要关心版本
3. **便于升级**：父 POM 改一个版本，所有子模块统一升级

## 多环境构建

```xml
<!-- 父 POM 的 profiles -->
<profiles>
    <profile>
        <id>dev</id>
        <activation>
            <activeByDefault>true</activeByDefault>
        </activation>
        <properties>
            <env>dev</env>
            <api.base-url>http://localhost:8080</api.base-url>
        </properties>
    </profile>
    <profile>
        <id>prod</id>
        <properties>
            <env>prod</env>
            <api.base-url>https://api.example.com</api.base-url>
        </properties>
    </profile>
</profiles>
```

```bash
# 激活指定环境
mvn clean install -Pprod
```

## 常用命令

```bash
# 在父项目目录下，一次构建所有模块
mvn clean install

# 只构建特定模块及其依赖
mvn clean install -pl module-c -am
# -pl: projects，构建指定模块
# -am: also-make，同时构建指定模块的依赖

# 跳过某个模块
mvn clean install -pl '!module-b'

# 并行构建（加快速度）
mvn clean install -T 1C
```

## 面试高频问题

**问：为什么父 POM 的 packaging 要设为 pom？**

答：`pom` 表示这个项目不打包成 jar 或 war，而是作为一个**聚合项目**存在。它的主要作用是管理子模块的版本、公共依赖和插件配置。设为 pom 是多模块项目的标准做法。

**问：子模块的 version 可以和父 POM 不一样吗？**

答：可以，但通常建议保持一致。如果确实需要单独发布不同版本，子模块需要移除 parent 中的继承，并单独维护版本号。但这种做法不推荐——版本不一致会增加维护成本。

**问：mvn install -pl -am 是什么？**

答：`-pl` 指定构建哪些模块（projects），`-am` 指定同时构建这些模块的依赖（also-make）。例如 `mvn install -pl module-c -am` 会构建 module-c 及其所有依赖（module-a 和 module-b）。这比在根目录 `mvn install` 快得多，适合只修改了某个模块的场景。

**问：多模块项目的依赖循环怎么解决？**

答：Maven 会检测循环依赖并报错。解决方法是重新审视模块边界——如果 A 依赖 B、B 依赖 C、C 又依赖 A，说明模块划分有问题。常见解决方案是将公共部分抽取到一个新模块，或者调整模块间的依赖方向。
