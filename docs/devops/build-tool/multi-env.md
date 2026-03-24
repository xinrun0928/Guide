# 多环境构建：Maven Profile 与 Gradle ProductFlavors

「开发环境连测试库，测试环境连测试库，生产连生产库」——多环境配置是每个项目都要面对的问题。

## 环境划分的本质

多环境构建的核心是「同一个代码库，不同的配置」：

```
┌─────────────────────────────────────────────┐
│  同一份代码                                  │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│  │ 开发环境 │  │ 测试环境 │  │ 生产环境 │     │
│  └────┬────┘  └────┬────┘  └────┬────┘     │
│       ↓             ↓             ↓          │
│   dev.properties  test.properties prod.properties │
│   application-dev.yml  application-test.yml  application-prod.yml  │
└─────────────────────────────────────────────┘
```

## Maven Profile

### 定义 Profile

```xml
<profiles>
    <!-- 开发环境（默认激活） -->
    <profile>
        <id>dev</id>
        <activation>
            <activeByDefault>true</activeByDefault>
        </activation>
        <properties>
            <env>dev</env>
            <db.url>jdbc:mysql://localhost:3306/dev_db</db.url>
            <db.username>dev</db.username>
            <db.password>dev123</db.password>
            <api.base-url>http://localhost:8080</api.base-url>
        </properties>
    </profile>

    <!-- 测试环境 -->
    <profile>
        <id>test</id>
        <properties>
            <env>test</env>
            <db.url>jdbc:mysql://test-server:3306/test_db</db.url>
            <db.username>test</db.username>
            <db.password>test123</db.password>
            <api.base-url>http://test-api.example.com</api.base-url>
        </properties>
    </profile>

    <!-- 生产环境 -->
    <profile>
        <id>prod</id>
        <properties>
            <env>prod</env>
            <db.url>jdbc:mysql://prod-cluster:3306/prod_db</db.url>
            <db.username>prod</db.username>
            <db.password>${PROD_DB_PASSWORD}</db.password>
            <api.base-url>https://api.example.com</api.base-url>
        </properties>
    </profile>
</profiles>
```

### 在资源文件中使用 Profile 属性

```properties
# src/main/resources/application.yml
spring:
  datasource:
    url: ${db.url}
    username: ${db.username}
    password: ${db.password}

app:
  env: ${env}
  base-url: ${api.base-url}
```

### 开启资源过滤

```xml
<build>
    <resources>
        <resource>
            <directory>src/main/resources</directory>
            <filtering>true</filtering>
            <includes>
                <include>**/*.yml</include>
                <include>**/*.properties</include>
            </includes>
        </resource>
    </resources>
</build>
```

### 激活 Profile

```bash
# 命令行激活
mvn clean package -Pprod

# 激活多个 Profile
mvn clean package -Pdev,test

# 通过环境变量激活
mvn clean package -P${ENV}
```

### Profile 与资源文件分离

更推荐的方式：每个环境一个独立的配置文件：

```
src/main/resources/
├── application.yml          # 公共配置
├── application-dev.yml       # 开发环境覆盖
├── application-test.yml      # 测试环境覆盖
└── application-prod.yml     # 生产环境覆盖
```

```yaml
# application.yml
spring:
  profiles:
    active: @env@
```

```bash
# 打包时指定环境
mvn clean package -Pdev -Denv=dev
```

## Gradle ProductFlavors

### 定义 ProductFlavors

Gradle 用 `flavorDimensions` 和 `productFlavors` 实现多环境：

```groovy
// build.gradle
plugins {
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}

flavorDimensions += "environment"

productFlavors {
    dev {
        dimension "environment"
        applicationIdSuffix = ".dev"
        versionNameSuffix = "-dev"
        buildConfigField "String", "ENV", "\"dev\""
        buildConfigField "String", "API_BASE_URL", "\"http://localhost:8080\""
    }

    test {
        dimension "environment"
        applicationIdSuffix = ".test"
        versionNameSuffix = "-test"
        buildConfigField "String", "ENV", "\"test\""
        buildConfigField "String", "API_BASE_URL", "\"http://test-api.example.com\""
    }

    prod {
        dimension "environment"
        buildConfigField "String", "ENV", "\"prod\""
        buildConfigField "String", "API_BASE_URL", "\"https://api.example.com\""
    }
}
```

### 访问 BuildConfig

```java
// Java 代码中访问环境配置
public class AppConfig {
    public static String getApiBaseUrl() {
        return BuildConfig.API_BASE_URL;
    }

    public static boolean isProd() {
        return "prod".equals(BuildConfig.ENV);
    }
}
```

### 构建变体

ProductFlavors 和 `buildTypes` 可以组合：

```
Build Types:
├── debug（默认）
└── release

Product Flavors:
├── dev
├── test
└── prod

组合产生的变体：
devDebug, devRelease
testDebug, testRelease
prodDebug, prodRelease
```

### 构建命令

```bash
./gradlew assembleProdRelease      # 生产环境 Release 版本
./gradlew assembleDevDebug        # 开发环境 Debug 版本
./gradlew build                   # 构建所有变体
```

### Source Set 分离

每个 Flavor 可以有自己的源码目录：

```groovy
productFlavors {
    dev {
        dimension "environment"
        sourceSets {
            dev {
                java {
                    srcDirs = ['src/env/java', 'src/dev/java']
                }
                resources {
                    srcDirs = ['src/env/resources', 'src/dev/resources']
                }
            }
        }
    }
}
```

## 敏感信息管理

### Maven：使用加密密码

```bash
# 加密主密码
mvn --encrypt-master-password <password>

# 加密仓库密码
mvn --encrypt-password <password>

# 在 settings.xml 中使用加密密码
<servers>
    <server>
        <id>nexus</id>
        <username>admin</username>
        <password>{OBF:xVEP123...}</password>
    </server>
</servers>
```

### Gradle：使用环境变量

```groovy
// build.gradle
repositories {
    maven {
        url = 'https://repo.example.com'
        credentials {
            username = System.getenv('MAVEN_USER')
            password = System.getenv('MAVEN_PASS')
        }
    }
}
```

## CI/CD 中的多环境构建

### GitHub Actions 示例

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        env: [dev, test, prod]

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Build with ${{ matrix.env }} environment
        run: ./gradlew build -Penv=${{ matrix.env }}
        env:
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}

      - name: Deploy to ${{ matrix.env }}
        if: matrix.env == 'prod'
        run: ./gradlew deploy -Penv=prod
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

## 常见问题

### 问题一：Profile 激活失败

检查 `-P` 参数是否正确，或检查 `activeByDefault` 是否被其他 Profile 覆盖。

### 问题二：资源文件中的占位符没有替换

确保在 `<build><resources><resource>` 中开启了 `filtering=true`。

### 问题三：不同环境的依赖不同

```groovy
// Gradle
dependencies {
    devImplementation 'com.h2database:h2'
    prodImplementation 'com.mysql:mysql-connector-j'
}
```

## 面试高频问题

**问：Maven Profile 和 Gradle ProductFlavors 有什么区别？**

答：两者目的相同，但实现方式不同。Maven Profile 是 XML 中的条件配置，通过激活不同 Profile 切换配置，适合简单场景（不同环境、不同 JDK 版本）。Gradle ProductFlavors 不仅是配置，还生成不同的**构建变体**（每个 Flavor 产生独立的 APK/JAR），适合更复杂的场景（同一代码库构建不同渠道、不同客户的定制版本）。
