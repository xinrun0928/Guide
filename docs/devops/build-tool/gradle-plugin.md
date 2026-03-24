# Gradle 插件机制：核心插件、社区插件、自定义插件开发

Gradle 插件是扩展 Gradle 功能的标准化方式。从简单的代码编译到复杂的部署流程，都通过插件实现。

## 插件分类

```
Gradle 插件体系：
├── 核心插件（内置）
│   ├── java           — Java 项目支持
│   ├── java-library   — Java 库支持
│   └── groovy         — Groovy 支持
│
├── 社区插件
│   ├── io.spring.dependency-management — Spring 依赖管理
│   ├── com.github.johnrengelman.shadow — Shadow JAR
│   └── org.jetbrains.kotlin.jvm        — Kotlin 支持
│
└── 自定义插件
    └── 业务特定构建逻辑
```

## 应用插件

### 方式一：plugins DSL（推荐）

```groovy
// build.gradle
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}
```

### 方式二：buildscript（传统方式）

```groovy
// build.gradle
buildscript {
    repositories {
        mavenCentral()
    }
    dependencies {
        classpath 'org.springframework.boot:spring-boot-gradle-plugin:3.2.0'
    }
}

apply plugin: 'org.springframework.boot'
apply plugin: 'io.spring.dependency-management'
```

**区别**：
- `plugins {}` DSL 更简洁，但仅支持 Gradle 插件 portal 的插件
- `buildscript {}` 支持所有插件，包括本地 JAR 和自定义插件

## 核心插件

### java / java-library

```groovy
plugins {
    id 'java-library'  // 推荐，比 java 更适合库项目
}

// 配置 Source Set
sourceSets {
    main {
        java {
            srcDirs = ['src/main/java']
        }
    }
    test {
        java {
            srcDirs = ['src/test/java']
        }
    }
}
```

### application

```groovy
plugins {
    id 'application'
}

application {
    mainClass = 'com.example.Application'
    applicationName = 'my-app'
}
```

### war

```groovy
plugins {
    id 'war'
}

war {
    // 排除某些文件
    exclude '**/*.xml'
    from('src/main/webapp-static') {
        into '/'
    }
}
```

## 常用社区插件

### Spring Boot 插件

```groovy
plugins {
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}

springBoot {
    // 排除嵌入式的 Tomcat
    mainClass = 'com.example.Application'
}
```

### Shadow 插件（打包可执行 JAR）

```groovy
plugins {
    id 'com.github.johnrengelman.shadow' version '8.1.1'
}

shadowJar {
    // 排除特定依赖
    exclude 'META-INF/*.SF'
    exclude 'META-INF/*.DSA'
    exclude 'META-INF/*.RSA'

    // 合并 META-INF/services
    merge 'META-INF/services'
}
```

### Kotlin 插件

```groovy
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.21'
    id 'org.jetbrains.kotlin.plugin.spring' version '1.9.21'
}

kotlin {
    jvmToolchain(17)
    compilerOptions {
        freeCompilerArgs.addAll('-Xjsr305=strict')
    }
}
```

### Protobuf 插件

```groovy
plugins {
    id 'com.google.protobuf' version '0.9.4'
}

protobuf {
    protoc {
        artifact = 'com.google.protobuf:protoc:3.25.1'
    }
    generateProtoTasks {
        all().each { task ->
            task.builtins {
                java { option 'lite' }
            }
        }
    }
}
```

## 自定义插件开发

### 方式一：Build Script 插件（简单）

直接在 `build.gradle` 中定义：

```groovy
// build.gradle
task myPlugin {
    doLast {
        println '这是我的自定义插件'
    }
}

// 为所有子项目应用
subprojects {
    apply plugin: 'my-plugin'
}
```

### 方式二：Standalone 插件（可复用）

#### 项目结构

```
my-plugin/
├── build.gradle
├── settings.gradle
├── src/
│   └── main/
│       └── groovy/
│           └── com/example/
│               └── MyPlugin.groovy
└── src/
    └── main/
        └── resources/
            └── META-INF/gradle-plugins/
                └── my-plugin.properties
```

#### 创建插件类

```groovy
// src/main/groovy/com/example/MyPlugin.groovy
package com.example

import org.gradle.api.Plugin
import org.gradle.api.Project

class MyPlugin implements Plugin<Project> {
    @Override
    void apply(Project project) {
        // 创建自定义 Task
        project.tasks.register('greet', GreetTask) {
            group = 'custom'
            description = '打招呼'
            message = 'Hello from MyPlugin'
        }

        // 添加扩展
        project.extensions.create('greeting', GreetingExtension) {
            message = 'Default message'
        }
    }
}

// 定义扩展类
class GreetingExtension {
    String message
}

// 定义自定义 Task
class GreetTask extends DefaultTask {
    String message

    @TaskAction
    void greet() {
        println message
    }
}
```

#### 注册插件

```groovy
// src/main/resources/META-INF/gradle-plugins/my-plugin.properties
implementation-class=com.example.MyPlugin
```

#### 发布插件

```groovy
// build.gradle
plugins {
    id 'groovy'
    id 'maven-publish'
}

publishing {
    publications {
        myPlugin(MavenPublication) {
            from components.java
            groupId = 'com.example'
            artifactId = 'my-plugin'
            version = '1.0.0'
        }
    }
    repositories {
        maven {
            url = 'https://repo.example.com/maven'
            credentials {
                username = System.getenv('MAVEN_USER')
                password = System.getenv('MAVEN_PASS')
            }
        }
    }
}
```

## 插件配置

### 插件的 extension 配置块

```groovy
// 使用插件提供的配置块
springBoot {
    mainClass = 'com.example.Application'
}

dependencyManagement {
    imports {
        mavenBom 'org.springframework.boot:spring-boot-dependencies:3.2.0'
    }
}
```

### 读取插件配置

```groovy
// 读取 Spring Boot 插件配置
springBoot {
    println "Main class: ${mainClass}"
}
```

## 插件的版本管理

### 版本 BOM 方式

```groovy
plugins {
    id 'java' version '1.0.0'
    id 'io.spring.dependency-management' version '1.1.4' apply false
}
```

`apply false` 表示应用插件但不配置，让子项目决定是否使用。

## 面试高频问题

**问：plugins {} 和 apply plugin: 有什么区别？**

答：`plugins {}` 是 Gradle 2.1+ 引入的新语法，更简洁且支持版本管理和插件 Portal 查找。`apply plugin:` 是传统方式，需要 `buildscript {}` 块。推荐使用 `plugins {}`，因为它可以自动解析插件版本（通过 pluginManagement 在 `settings.gradle` 中配置）。

**问：如何发布一个 Gradle 插件到 Maven 仓库？**

答：使用 `maven-publish` 插件。在 build.gradle 中配置 publication（指定构件坐标和内容）和 repository（目标仓库），然后执行 `./gradlew publish`。需要确保 `META-INF/gradle-plugins/*.properties` 文件正确注册插件类。
