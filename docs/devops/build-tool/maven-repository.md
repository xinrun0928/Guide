# Maven 仓库配置：私有仓库 Nexus/Artifactory 搭建与镜像加速

## 为什么需要私有仓库？

Maven 中央仓库虽然内容丰富，但有两个致命问题：

1. **速度慢**：国内访问 Maven 中央仓库动不动超时
2. **安全性**：公司内部 JAR 无法上传到中央仓库

因此，企业通常会搭建 Maven 私有仓库（私服）。

## 私有仓库的价值

```
┌──────────────────────────────────────────────────────────┐
│                      你的项目                             │
│              dependency: spring-boot                     │
└──────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────────────────────┐
        │         Maven 私服                 │
        │   （Nexus / Artifactory）          │
        │                                    │
        │  代理中央仓库 ───────────────→ 中央仓库
        │       ↓                             │
        │  缓存已下载的构件                     │
        │       ↓                             │
        │  存储内部 JAR                        │
        │       ↓                             │
        │  提供给项目使用                      │
        └───────────────────────────────────┘
                            ↓
        ┌───────────────────────────────────┐
        │        你的本地仓库                  │
        │    ~/.m2/repository                │
        └───────────────────────────────────┘
```

### 私服的核心价值

1. **加速下载**：构件只从外网下载一次，之后从私服获取
2. **保障安全**：内部 JAR 包不会泄露到外网
3. **统一管理**：所有团队使用相同的依赖版本
4. **离线可用**：私服缓存的构件在内网可随时获取

## Nexus 搭建与配置

### 下载与启动

Nexus Repository Manager 有两个版本：

- **Nexus Repository Manager 3（OSS）**：开源版，支持 Maven/Docker/NuGet 等
- **Nexus Repository Manager 2（Pro）**：商业版，功能更全

```bash
# 下载 OSS 版本
wget https://download.sonatype.com/nexus/3/latest-unix.tar.gz
tar -xzf latest-unix.tar.gz
cd nexus-3.x.x/bin

# 启动
./nexus start

# 访问管理界面
open http://localhost:8081
```

### 仓库类型

Nexus 支持以下仓库类型：

| 类型 | 说明 | 用途 |
|------|------|------|
| **hosted** | 本地仓库 | 存储内部 JAR、发布内部构件 |
| **proxy** | 代理仓库 | 代理远程仓库（中央仓库、阿里云） |
| **group** | 组仓库 | 聚合多个仓库，统一提供服务 |

### 典型仓库配置

通常创建以下仓库：

```
maven-central      → 代理 Maven 中央仓库
maven-aliyun       → 代理阿里云 Maven 镜像
maven-releases     → hosted，存储正式版本
maven-snapshots    → hosted，存储快照版本
maven-public       → group，聚合以上四个
```

### settings.xml 配置

```xml
<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0
                              http://maven.apache.org/xsd/settings-1.0.0.xsd">

    <localRepository>/path/to/local/repo</localRepository>

    <servers>
        <server>
            <id>nexus-releases</id>
            <username>admin</username>
            <password>admin123</password>
        </server>
        <server>
            <id>nexus-snapshots</id>
            <username>admin</username>
            <password>admin123</password>
        </server>
    </servers>

    <mirrors>
        <mirror>
            <id>aliyun-maven</id>
            <name>Aliyun Maven</name>
            <url>https://maven.aliyun.com/repository/public</url>
            <mirrorOf>*</mirrorOf>
        </mirror>
    </mirrors>

    <profiles>
        <profile>
            <id>nexus</id>
            <repositories>
                <repository>
                    <id>central</id>
                    <url>https://maven.aliyun.com/repository/central</url>
                    <releases><enabled>true</enabled></releases>
                    <snapshots><enabled>false</enabled></snapshots>
                </repository>
            </repositories>
            <pluginRepositories>
                <pluginRepository>
                    <id>central-plugins</id>
                    <url>https://maven.aliyun.com/repository/central</url>
                    <releases><enabled>true</enabled></releases>
                    <snapshots><enabled>false</enabled></snapshots>
                </pluginRepository>
            </pluginRepositories>
        </profile>
    </profiles>

    <activeProfiles>
        <activeProfile>nexus</activeProfile>
    </activeProfiles>
</settings>
```

> **mirrorOf 语法**：`mirrorOf=*` 匹配所有仓库，`mirrorOf=central` 匹配 central，`mirrorOf=*,!nexus-public` 匹配除 nexus-public 外的所有仓库。

## 阿里云 Maven 镜像加速

如果不想搭建私服，直接使用阿里云镜像是最简单的方式：

```xml
<!-- pom.xml 中配置 -->
<repositories>
    <repository>
        <id>aliyun</id>
        <url>https://maven.aliyun.com/repository/public</url>
    </repository>
</repositories>
```

```xml
<!-- settings.xml 中配置 -->
<mirrors>
    <mirror>
        <id>aliyun-maven</id>
        <mirrorOf>*</mirrorOf>
        <url>https://maven.aliyun.com/repository/public</url>
    </mirror>
</mirrors>
```

> **mirrors vs repositories**：`mirrors` 是镜像，会完全替代原仓库；`repositories` 是额外仓库，Maven 会同时从多个仓库查找依赖。两者结合使用效果最佳。

## 部署构件到私服

想把内部 JAR 上传到私服，需要在 pom.xml 中配置：

```xml
<distributionManagement>
    <repository>
        <id>nexus-releases</id>
        <name>Nexus Releases Repository</name>
        <url>http://localhost:8081/repository/maven-releases/</url>
    </repository>
    <snapshotRepository>
        <id>nexus-snapshots</id>
        <name>Nexus Snapshots Repository</name>
        <url>http://localhost:8081/repository/maven-snapshots/</url>
    </snapshotRepository>
</distributionManagement>
```

注意这里的 `id` 需要和 `settings.xml` 中的 `server.id` 一致，否则认证会失败。

部署命令：

```bash
mvn deploy -DskipTests
```

## 常见问题排查

### 问题一：下载依赖时提示 401 Unauthorized

认证失败，检查 `settings.xml` 中的 `<server>` 配置是否正确。

### 问题二：下载依赖时提示 Checksum validation failed

校验和不匹配，删除本地仓库中对应的构件目录，让 Maven 重新下载。

### 问题三：无法从私服下载依赖

检查网络是否能访问私服地址，检查私服是否正常启动，检查 Nexus 仓库的 Anonymous 访问权限是否开启。

## 面试高频问题

**问：Maven 私服的作用是什么？**

答：主要有四点——代理并缓存远程仓库加速下载、存储部署内部私有构件、进行依赖版本统一管理、在内网环境下确保构建可用。

**问：mirrors 和 repositories 有什么区别？**

答：`mirror` 相当于「代理」，会完全拦截对指定仓库的请求，所有请求都转发到镜像地址。`repository` 是「补充」，Maven 会同时从多个 repository 查找依赖。两者用途不同，通常 mirror 用来加速，repository 用来扩展。

**问：SNAPSHOT 版本和正式版本部署到哪个仓库？**

答：SNAPSHOT 版本部署到 `snapshotRepository`，正式版本（非 SNAPSHOT）部署到 `repository`。Nexus 中通常会创建两个 hosted 仓库分别存储。
