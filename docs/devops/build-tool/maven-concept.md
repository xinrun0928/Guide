# Maven 核心概念：坐标、仓库、生命周期

大多数 Java 开发者每天都在用 Maven，但很多人对 Maven 的核心概念只停留在「配置文件」层面。理解这些概念，是用好 Maven 的前提。

## Maven 坐标（GAV）

Maven 坐标是 Maven 管理一切的基础。每个构件（artifact）都有一个唯一标识，由三个元素组成，简称 **GAV**：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <version>3.2.0</version>
    <packaging>jar</packaging>
</dependency>
```

| 元素 | 含义 | 类比 |
|------|------|------|
| **groupId** | 组织/项目标识，通常是反域名 | `com.alibaba`、`org.apache` |
| **artifactId** | 具体构件名称 | `fastjson`、`commons-lang3` |
| **version** | 版本号，支持快照（SNAPSHOT） | `1.0.0`、`2.1.5-SNAPSHOT` |
| **packaging** | 打包类型，默认为 jar | jar、war、pom、zip |

> **groupId 的命名规范**：通常为反写的域名，从大到小。如 `com.alibaba.fastjson`，`io.netty.netty-all`。

## Maven 仓库

Maven 的仓库体系解决了「去哪找依赖」的问题。

```
本地仓库（Local Repository）
    ↓ 找不到
远程仓库（Remote Repository）
    ├── 私服（Private Repository）：Nexus / Artifactory
    └── 中央仓库（Central Repository）：maven.apache.org
```

### 本地仓库

默认位置是 `~/.m2/repository`。当你 `mvn install` 时，构件会被安装到本地仓库，供本机其他项目引用。

```bash
# 查看本地仓库路径
mvn help:evaluate -Dexpression=settings.localRepository

# 自定义本地仓库路径
<settings>
    <localRepository>/path/to/local/repo</localRepository>
</settings>
```

### 远程仓库

当本地仓库找不到依赖时，Maven 会按以下顺序查找远程仓库：

1. **私服**（如果有配置）：优先使用公司内部的 Nexus/Artifactory
2. **中央仓库**：`https://repo.maven.apache.org/maven2`

私服配置示例：

```xml
<repositories>
    <repository>
        <id>aliyun</id>
        <name>Aliyun Maven Repository</name>
        <url>https://maven.aliyun.com/repository/public</url>
        <releases>
            <enabled>true</enabled>
        </releases>
        <snapshots>
            <enabled>false</enabled>
        </snapshots>
    </repository>
</repositories>
```

### 依赖查找流程

```
项目声明依赖 spring-boot-starter-web:3.2.0
    ↓
本地仓库 ~/.m2/repository 查找
    ↓ 有？ → 使用
    ↓ 无？
    ↓
远程仓库查找并下载到本地仓库
    ↓
缓存到本地，下次直接使用
```

## Maven 生命周期

Maven 有三套相互独立的生命周期，每套包含多个阶段（phase）：

### 1. clean 生命周期——清理构建产物

| 阶段 | 说明 |
|------|------|
| pre-clean | 清理前准备工作 |
| **clean** | 删除 target 目录 |
| post-clean | 清理后处理 |

### 2. default 生命周期——核心构建过程

| 阶段 | 说明 |
|------|------|
| validate | 验证项目结构是否正确 |
| compile | 编译源代码 |
| test | 运行单元测试 |
| package | 打包（jar/war） |
| **install** | 安装到本地仓库 |
| **deploy** | 部署到远程仓库 |

### 3. site 生命周期——生成项目站点

| 阶段 | 说明 |
|------|------|
| pre-site | 站点生成前准备 |
| site | 生成项目站点文档 |
| post-site | 站点生成后处理 |
| site-deploy | 部署站点到服务器 |

### 关键理解：阶段与插件目标

**Maven 的阶段（phase）本身不做事，它通过绑定插件目标（plugin goal）来做事。**

例如，`mvn compile` 执行 compile 阶段，这个阶段默认绑定了 `maven-compiler-plugin:compile`，所以才会真正调用 javac 编译。

你也可以给阶段绑定更多插件目标：

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-surefire-plugin</artifactId>
            <version>3.0.0</version>
            <executions>
                <execution>
                    <id>run-unit-tests</id>
                    <phase>test</phase>
                    <goals>
                        <goal>test</goal>
                    </goals>
                </execution>
            </executions>
        </plugin>
    </plugins>
</build>
```

## 依赖搜索优先级

当声明一个依赖时，Maven 按以下顺序解析版本：

1. **pom.xml 中直接声明的版本**（最优先）
2. **父 POM 的 dependencyManagement 中的版本**
3. **当前 POM 的 dependencyManagement 中的版本**
4. **依赖调解（Dependency Mediation）**：选择路径最短的版本

```xml
<!-- 直接声明，覆盖一切 -->
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>fastjson</artifactId>
    <version>2.0.0</version>  <!-- 优先使用这个版本 -->
</dependency>
```

## 面试高频问题

**问：Maven 的本地仓库默认在哪？可以改吗？**

答：默认在 `~/.m2/repository`。可以通过 `settings.xml` 中的 `<localRepository>` 标签修改。常见用途是设置到 SSD 盘以提升 IO 性能，或者设置到共享存储以在团队间共享依赖缓存。

**问：SNAPSHOT 版本和正式版本有什么区别？**

答：SNAPSHOT（快照版本）表示开发中的不稳定版本。每次从远程仓库获取时，Maven 会检查远程仓库是否有新版本（默认每天检查一次，可配置）。正式版本（不带 SNAPSHOT）一旦发布就不应该再修改，避免「我本地能用，你那边不能用」的问题。
