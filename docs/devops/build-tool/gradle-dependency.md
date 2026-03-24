# Gradle 依赖管理：configurations、API vs Implementation 隔离

Gradle 的依赖管理比 Maven 更精细，特别是 **API vs Implementation** 的隔离机制，是理解 Gradle 依赖的核心。

## configurations——依赖分类

Gradle 通过 `configurations` 对依赖进行分类，每种配置有不同的传递性和可见性。

### Java 插件的默认配置

| 配置名 | 说明 | 传递性 | 典型依赖 |
|--------|------|--------|---------|
| `implementation` | 编译和运行时可见 | ❌ 不传递 | 业务代码依赖 |
| `api` | 与 implementation 相同 | ✅ 传递 | 库对外暴露的依赖 |
| `compileOnly` | 仅编译时可见 | ❌ 不传递 | 编译时注解处理器 |
| `runtimeOnly` | 仅运行时可见 | ❌ 不传递 | 日志实现 |
| `testImplementation` | 测试代码可见 | ❌ 不传递 | 测试框架 |
| `testCompileOnly` | 仅测试编译可见 | ❌ 不传递 | 测试注解处理器 |

## API vs Implementation：核心区别

这是 Gradle 3.4+ 引入的最重要特性。

### implementation（推荐）

```groovy
dependencies {
    // spring-boot-starter-web 的依赖不会传递到「依赖本项目的其他模块」
    implementation 'org.springframework.boot:spring-boot-starter-web'
}
```

**特点**：
- 编译时和运行时都可用
- **不会传递**给依赖本模块的其他模块
- 编译速度更快（编译时不需要解析更多依赖）

### api（替代 compile）

```groovy
plugins {
    id 'java-library'  // 必须用 java-library 插件才能使用 api
}

dependencies {
    // commons-lang3 的依赖会传递到「依赖本模块的其他模块」
    api 'org.apache.commons:commons-lang3:3.12.0'
}
```

**特点**：
- 编译时和运行时都可用
- **会传递**给依赖本模块的其他模块
- 相当于 Maven 的 `compile` scope

### 为什么要区分？

想象一个多模块项目：

```
module-common (被其他所有模块依赖)
    ├── implementation 'lombok:1.18.24'
    └── implementation 'fastjson:2.0.0'

module-user (依赖 module-common)
    └── implementation 'org.springframework.boot:spring-boot-starter-web'
```

如果 `module-common` 用的是 `implementation`：
- `module-user` **看不到** lombok 和 fastjson
- `module-user` 的编译不依赖 lombok 的 API
- `module-user` 编译更快，因为依赖图更小

如果 `module-common` 用的是 `api`：
- `module-user` **能看到** lombok 和 fastjson
- `module-common` 换了 fastjson 版本，`module-user` 也需要重新编译
- `module-user` 编译更慢

**最佳实践**：库模块中，对外暴露的类型用 `api`，内部使用用 `implementation`。

## compileOnly——仅编译时依赖

```groovy
dependencies {
    // 仅编译时需要，运行时不需要
    compileOnly 'org.projectlombok:lombok:1.18.24'
    // 注解处理器
    annotationProcessor 'org.projectlombok:lombok:1.18.24'
}
```

典型场景：
- Lombok 注解处理器
- Dagger 依赖注入
- MapStruct 对象映射

## runtimeOnly——仅运行时依赖

```groovy
dependencies {
    // 编译时不需要，运行时才需要
    runtimeOnly 'ch.qos.logback:logback-classic:1.4.11'
}
```

典型场景：日志框架实现（编译时用 SLF4J 接口，运行时用 Logback 实现）。

## 自定义 configurations

```groovy
configurations {
    // 定义新的配置
    myConfig {
        extendsFrom runtimeOnly  // 继承 runtimeOnly
        canBeResolved = true
        canBeConsumed = true
    }

    // 修改现有配置
    implementation {
        // 排除传递依赖
        exclude group: 'commons-logging', module: 'commons-logging'
    }
}
```

## 依赖冲突解决

### 默认策略：最近版本优先

Gradle 默认选择**路径最短**的版本，与 Maven 类似。

### 强制指定版本

```groovy
configurations.all {
    resolutionStrategy {
        // 强制使用指定版本
        force 'org.apache.commons:commons-lang3:3.12.0'
        // 强制排除某个依赖
        exclude group: 'commons-logging', module: 'commons-logging'
    }
}
```

### 替换传递依赖

```groovy
configurations.all {
    resolutionStrategy {
        // 用 SLF4J 替换 commons-logging
        substitute module('commons-logging:commons-logging') \
            with module('org.slf4j:jcl-over-slf4j:2.0.9')
    }
}
```

### 按配置精细控制

```groovy
configurations {
    implementation {
        // implementation 配置中排除
        exclude group: 'com.fasterxml.jackson.core', module: 'jackson-databind'
    }
    testImplementation {
        // 测试配置中排除
        exclude group: 'org.slf4j', module: 'slf4j-simple'
    }
}
```

## 依赖查看与分析

### 查看依赖树

```bash
./gradlew dependencies
./gradlew dependencies --configuration runtimeClasspath
```

### 查看特定配置的依赖

```bash
./gradlew dependencies --configuration implementation
./gradlew dependencies --configuration testImplementation
```

### 查看依赖报告

```groovy
// build.gradle
apply plugin: 'project-report'

task dependencyReport(type: HtmlDependencyReportTask) {
    reports {
        html.required = true
    }
}
```

```bash
./gradlew htmlDependencyReport
# 生成 build/reports/project/dependencies.html
```

## BOM 支持

### 使用 Spring Boot BOM

```groovy
dependencies {
    implementation platform('org.springframework.boot:spring-boot-dependencies:3.2.0')
    // 不需要写版本号
    implementation 'com.alibaba:fastjson'
}
```

### 自定义 BOM

```groovy
dependencies {
    implementation platform('com.example:company-bom:1.0.0')
    implementation 'com.example:module-user'
}
```

## 依赖版本降级与升级

### 检查可用更新

```bash
./gradlew dependencyUpdates
# 生成 build/dependencyUpdates/report.txt
```

### 动态版本

```groovy
dependencies {
    // 使用最新版本（不推荐用于生产）
    implementation 'com.alibaba:fastjson:+'

    // 使用版本范围
    implementation 'com.alibaba:fastjson:2.+'

    // 使用 latest.release
    implementation 'com.alibaba:fastjson:latest.release'
}
```

> **警告**：动态版本在 CI/CD 中是不稳定因素，生产环境应该使用固定版本或 BOM。

## 面试高频问题

**问：implementation 和 api 有什么区别？**

答：两者的核心区别是**传递性**。`implementation` 的依赖不会传递给依赖当前模块的其他模块，`api` 的依赖会传递。在多模块项目中，使用 `implementation` 可以显著加快编译速度——当修改一个底层模块时，上层模块不需要重新编译。不过 `api` 需要 `java-library` 插件支持。

**问：compileOnly 和 implementation 的区别是什么？**

答：`compileOnly` 的依赖仅在编译时需要，运行时完全不需要。典型例子是 Lombok——编译时注解处理器需要 Lombok JAR，但运行时不需要（字节码已经处理好了）。`implementation` 的依赖是编译和运行时都需要。
