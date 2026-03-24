# Gradle 多项目构建：根项目与子项目配置、跨项目依赖

当项目规模变大时，多模块构建是必然选择。

## 多项目结构

```
my-company/
├── build.gradle              # 根项目构建脚本
├── settings.gradle           # 项目定义
├── gradle.properties         # 全局属性
├── app/                     # 应用模块
│   └── build.gradle
├── module-user/             # 用户模块
│   └── build.gradle
├── module-order/            # 订单模块
│   └── build.gradle
└── module-common/           # 公共模块
    └── build.gradle
```

## settings.gradle——定义项目结构

```groovy
// settings.gradle
rootProject.name = 'my-company'

// 包含子项目
include 'app', 'module-user', 'module-order', 'module-common'

// 为子项目指定目录名（可选）
include('module-payment')
project(':module-payment').projectDir = file('modules/payment')
```

## 根项目的 build.gradle

根项目通常不打包代码，而是负责：
- 统一插件版本
- 统一依赖版本
- 配置公共行为

```groovy
// 根项目 build.gradle

// 所有子项目默认插件
subprojects {
    apply plugin: 'java-library'
    apply plugin: 'idea'

    // 统一配置仓库
    repositories {
        mavenCentral()
        maven { url 'https://maven.aliyun.com/repository/public' }
    }

    // 统一 Java 版本
    java {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // 统一依赖管理
    dependencies {
        compileOnly 'org.projectlombok:lombok:1.18.24'
        annotationProcessor 'org.projectlombok:lombok:1.18.24'
    }

    // 统一测试配置
    test {
        useJUnitPlatform()
        maxParallelForks = 4
    }
}

// 为特定子项目添加额外配置
project(':app') {
    apply plugin: 'org.springframework.boot'

    dependencies {
        implementation project(':module-common')
        implementation project(':module-user')
        implementation project(':module-order')
    }
}
```

## 子项目的 build.gradle

### module-common

```groovy
// 不需要写 version，由 BOM 或父项目统一管理
plugins {
    id 'java-library'
    id 'io.spring.dependency-management'
}

dependencyManagement {
    imports {
        mavenBom 'org.springframework.boot:spring-boot-dependencies:3.2.0'
    }
}

dependencies {
    // API 表示传递依赖
    api 'org.apache.commons:commons-lang3:3.12.0'
    api 'com.google.guava:guava:32.1.3-jre'

    // Implementation 表示不传递
    implementation 'com.alibaba:fastjson:2.0.0'
}
```

### module-user

```groovy
plugins {
    id 'java-library'
    id 'io.spring.dependency-management'
}

dependencyManagement {
    imports {
        mavenBom 'org.springframework.boot:spring-boot-dependencies:3.2.0'
    }
}

dependencies {
    implementation project(':module-common')

    api 'org.springframework:spring-context:6.1.0'
    implementation 'org.springframework.boot:spring-boot-starter-web'
}
```

### app（应用模块）

```groovy
plugins {
    id 'org.springframework.boot'
    id 'io.spring.dependency-management'
}

dependencyManagement {
    imports {
        mavenBom 'org.springframework.boot:spring-boot-dependencies:3.2.0'
    }
}

bootJar {
    // Spring Boot JAR 配置
    archiveFileName = "${project.name}.jar"
}

dependencies {
    implementation project(':module-common')
    implementation project(':module-user')
    implementation project(':module-order')
}
```

## 跨项目依赖

### 依赖另一个子项目

```groovy
dependencies {
    // 依赖 module-common
    implementation project(':module-common')

    // 依赖多个子项目
    implementation project(':module-user')
    implementation project(':module-order')
}
```

### 有条件地依赖

```groovy
// 只有当某个子项目存在时才依赖
subprojects {
    afterEvaluate {
        if (project.hasProperty('featureX')) {
            dependencies {
                implementation project(':feature-x')
            }
        }
    }
}
```

## 跨项目任务执行

### 在根项目执行子项目任务

```bash
# 所有子项目执行 build
./gradlew build

# 所有子项目执行 test
./gradlew test

# 只构建特定子项目及其依赖
./gradlew :app:build -x :module-user:test

# 只构建特定子项目（不构建依赖）
./gradlew :module-common:build --no-build-dependents
```

### 任务执行顺序

Gradle 自动根据项目间的依赖关系计算执行顺序：

```
app 依赖 module-user, module-order, module-common
module-user 依赖 module-common
module-order 依赖 module-common
module-common 无依赖

执行顺序：
module-common → module-user → module-order → app
```

### 并行执行子项目

```bash
./gradlew build --parallel
```

## 配置继承与覆盖

### 子项目覆盖父项目的配置

```groovy
// 根项目 subprojects 中定义
subprojects {
    tasks.withType(JavaCompile) {
        options.encoding = 'UTF-8'
    }
}

// app 子项目覆盖
project(':app') {
    tasks.withType(JavaCompile) {
        options.encoding = 'GBK'  // 覆盖为 GBK
    }
}
```

### 条件化配置

```groovy
subprojects {
    // 只有 Java 插件应用时才配置
    plugins.withId('java') {
        repositories {
            mavenCentral()
        }
    }

    // 只有 web 相关模块才配置
    if (project.name.contains('web') || project.name.contains('rest')) {
        dependencies {
            implementation 'org.springframework.boot:spring-boot-starter-web'
        }
    }
}
```

## 多环境配置

### profiles 在 Gradle 中的实现

Gradle 用**Source Set**或**Product Flavor**替代 Maven Profile：

```groovy
// 使用 Source Set 实现多环境
sourceSets {
    dev {
        java.srcDirs = ['src/dev/java']
    }
    prod {
        java.srcDirs = ['src/prod/java']
    }
}

// 或使用 Product Flavor
flavorDimensions += "environment"
productFlavors {
    dev {
        dimension "environment"
        applicationIdSuffix ".dev"
        versionNameSuffix "-dev"
    }
    prod {
        dimension "environment"
    }
}
```

### 环境变量配置

```groovy
subprojects {
    tasks.withType(JavaExec) {
        environment 'APP_ENV', project.findProperty('env') ?: 'dev'
    }
}
```

## 项目聚合任务

```groovy
// 根项目 build.gradle

// 所有子项目执行 assemble
tasks.register('deployAll') {
    group = 'build'
    description = '部署所有应用'

    dependsOn gradle.includedBuilds*.task(':deploy')
}

// 收集所有子项目的 JAR
task collectJars {
    group = 'build'

    doLast {
        subprojects.each { proj ->
            proj.tasks.assemble.outputs.files.each { file ->
                if (file.name.endsWith('.jar')) {
                    copy {
                        from file
                        into "${rootDir}/output/jars"
                    }
                }
            }
        }
    }
}
```

## 面试高频问题

**问：Gradle 多项目构建和 Maven 多模块有什么本质区别？**

答：Maven 多模块用父子继承关系管理，`parent` POM 定义公共配置，子 POM 继承。Gradle 多项目用**聚合**管理，所有项目平铺在根项目下，通过 `settings.gradle` 的 `include` 声明。Gradle 的方式更灵活——根项目可以有自己的代码（Maven 的父 POM 通常不行），子项目之间的依赖表达也更自然（`project(':module-a')` 语法比 Maven 的 GAV 坐标引用更直接）。

**问：subprojects 和 allprojects 有什么区别？**

答：`subprojects` 只匹配直接子项目，`allprojects` 匹配根项目 + 所有子项目。常见用法是 `subprojects` 用来配置子项目的共同行为，`allprojects` 用来配置仓库等根项目也需要的内容。
