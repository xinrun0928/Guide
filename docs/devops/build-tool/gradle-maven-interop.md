# Gradle 与 Maven 互操作：导入 pom.xml、maven-publish 插件

在 Maven 到 Gradle 的迁移过程中，或者混合使用两种工具时，互操作性至关重要。

## 在 Gradle 中使用 Maven 仓库

### 直接消费 Maven 构件

Gradle 天生支持从 Maven 仓库下载依赖：

```groovy
repositories {
    mavenCentral()

    // Maven 私服
    maven {
        url 'https://repo.example.com/maven'
        credentials {
            username = System.getenv('MAVEN_USER')
            password = System.getenv('MAVEN_PASS')
        }
    }

    // 本地 Maven 仓库
    mavenLocal()
}
```

### 导入 Maven BOM

```groovy
dependencies {
    // 导入 Spring Boot BOM
    implementation platform('org.springframework.boot:spring-boot-dependencies:3.2.0')

    // 导入后，以下依赖不需要写版本号
    implementation 'com.alibaba:fastjson'
    implementation 'com.google.guava:guava'
}
```

## 在 Gradle 中使用 Maven POM

### 导入外部 pom.xml

可以使用 Maven Publishing 插件导入已有的 Maven POM：

```groovy
plugins {
    id 'java'
    id 'maven-publish'
}

// 导入外部 POM 作为 BOM
dependencyManagement {
    imports {
        mavenBom 'com.example:company-bom:1.0.0'
    }
}
```

### 从 Maven POM 生成 Gradle 依赖

如果你有一个复杂的 Maven 项目，想迁移到 Gradle，可以使用 Gradle 的 `MavenConversion` 工具（不过这个工具已不再维护，更推荐手动迁移）：

## Gradle 发布到 Maven 仓库

### maven-publish 插件

这是 Gradle 官方推荐的发布方式：

```groovy
plugins {
    id 'java'
    id 'maven-publish'
}

publishing {
    publications {
        // 发布 Maven JAR（包含 javadoc 和 source）
        mavenJava(MavenPublication) {
            from components.java

            // POM 元数据
            pom {
                name = project.name
                description = project.description
                url = 'https://example.com'

                licenses {
                    license {
                        name = 'Apache-2.0'
                        url = 'https://www.apache.org/licenses/LICENSE-2.0'
                    }
                }

                developers {
                    developer {
                        id = 'developer1'
                        name = 'Developer One'
                        email = 'dev@example.com'
                    }
                }

                scm {
                    connection = 'scm:git:https://github.com/example/repo.git'
                    developerConnection = 'scm:git:git@github.com:example/repo.git'
                    url = 'https://github.com/example/repo'
                }
            }
        }
    }

    repositories {
        maven {
            name = 'nexus'
            url = version.endsWith('SNAPSHOT')
                ? 'https://repo.example.com/snapshots'
                : 'https://repo.example.com/releases'

            credentials {
                username = System.getenv('MAVEN_USER')
                password = System.getenv('MAVEN_PASS')
            }
        }
    }
}
```

### 发布命令

```bash
# 发布到本地 Maven 仓库
./gradlew publishMavenJavaPublicationToMavenLocal

# 发布到远程 Maven 仓库
./gradlew publish
```

## 从 Maven 迁移到 Gradle

### 典型对照关系

| Maven | Gradle | 说明 |
|-------|--------|------|
| `<dependencies>` | `dependencies {}` | 依赖声明块 |
| `<dependency>` | `implementation` | 普通依赖 |
| `<scope>compile</scope>` | `implementation` | 编译时依赖 |
| `<scope>provided</scope>` | `compileOnly` | 仅编译时 |
| `<scope>test</scope>` | `testImplementation` | 测试依赖 |
| `<exclusions>` | `exclude` | 排除传递依赖 |
| `<dependencyManagement>` | BOM + platform | 依赖版本管理 |
| `<build><plugins>` | `plugins {}` | 插件声明 |
| `<profiles>` | `flavorDimensions` | 多环境配置 |

### Maven POM 转换为 Gradle

Maven POM：

```xml
<project>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
            <version>3.2.0</version>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.11.0</version>
            </plugin>
        </plugins>
    </build>
</project>
```

对应 Gradle：

```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}

group = 'com.example'
version = '1.0.0'

dependencyManagement {
    imports {
        mavenBom 'org.springframework.boot:spring-boot-dependencies:3.2.0'
    }
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
}
```

## 混合使用 Maven 和 Gradle 项目

### 在 Gradle 项目中引用 Maven 依赖

```groovy
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.user:repo:tag'
}
```

### 在 Maven 项目中引用 Gradle 发布的构件

Maven 消费 Gradle 发布的构件没有任何特殊处理——Gradle 的 `maven-publish` 插件会生成标准 Maven POM，Maven 可以无缝消费：

```xml
<dependencies>
    <dependency>
        <groupId>com.example</groupId>
        <artifactId>gradle-module</artifactId>
        <version>1.0.0</version>
    </dependency>
</dependencies>
```

## 常见问题

### 问题一：Gradle 发布后 Maven 无法下载源码

确保正确配置了 source 和 javadoc 附件：

```groovy
publishing {
    publications {
        mavenJava(MavenPublication) {
            from components.java

            artifact sourceJar
            artifact javadocJar
        }
    }
}

java {
    withJavadocJar()
    withSourcesJar()
}
```

### 问题二：Maven 中 scope=system 的依赖在 Gradle 中怎么处理

Maven 的 `system` scope 用于引用本地 JAR，Gradle 中推荐：

```groovy
dependencies {
    // 不推荐：system scope
    // implementation files('libs/local.jar')

    // 推荐：发布到 Maven 仓库
    // 或者使用文件系统依赖（仅本地）
    implementation files('libs/local.jar')
}
```

## 面试高频问题

**问：如何把一个 Maven 项目迁移到 Gradle？**

答：迁移步骤如下。第一步，生成 Gradle Wrapper：`gradle wrapper`。第二步，手动编写 `build.gradle`，对照 Maven POM 的 `<dependencies>` 和 `<build><plugins>`。第三步，使用 BOM 和 dependencyManagement 插件处理版本管理。第四步，测试 `./gradlew build` 是否通过。第五步，清理 Maven 相关文件（pom.xml）。建议保留原 POM 作为备份，分阶段迁移。

**问：Gradle 发布的构件，Maven 能否无缝消费？**

答：可以。Gradle 的 `maven-publish` 插件生成的 POM 是标准 Maven POM 格式，Maven 可以像消费其他 Maven 构件一样消费它。
