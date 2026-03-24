# Gradle DSL：Groovy DSL 与 Kotlin DSL

Gradle 支持两种 DSL（Domain Specific Language）来编写构建脚本：Groovy DSL 和 Kotlin DSL。

## Groovy DSL（.gradle）

Groovy DSL 是 Gradle 的默认 DSL，基于 Groovy 语言。

```groovy
// build.gradle
plugins {
    id 'java'
}

group = 'com.example'
version = '1.0.0'

repositories {
    mavenCentral()
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web:3.2.0'
    testImplementation 'org.springframework.boot:spring-boot-starter-test:3.2.0'
}
```

## Kotlin DSL（.gradle.kts）

Kotlin DSL 基于 Kotlin 语言，提供更好的 IDE 支持（代码补全、类型安全）。

```kotlin
// build.gradle.kts
plugins {
    java
    id("org.springframework.boot") version "3.2.0"
}

group = "com.example"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web:3.2.0")
    testImplementation("org.springframework.boot:spring-boot-starter-test:3.2.0")
}
```

## 核心语法对比

### 变量声明

```groovy
// Groovy DSL
def version = '1.0.0'
String name = 'my-app'

// Kotlin DSL
val version = "1.0.0"
val name: String = "my-app"
```

### 字符串

```groovy
// Groovy DSL
def s1 = '单引号：原样输出 $version'      // 单引号不解析变量
def s2 = "双引号：变量 ${version}"       // 双引号解析变量
def s3 = """多行字符串
    可以换行
""";

// Kotlin DSL
val s1 = "单引号不存在，直接用双引号"
// 多行字符串
val s3 = """
    多行字符串
    可以换行
""".trimIndent()
```

### Map / Dictionary

```groovy
// Groovy DSL
def map = [key: 'value', num: 123]
def value = map.key
def value2 = map['key']

// Kotlin DSL
val map = mapOf("key" to "value", "num" to 123)
val value = map["key"]
```

### List / Array

```groovy
// Groovy DSL
def list = ['a', 'b', 'c']
list << 'd'             // 添加元素
list.each { item -> println item }

// Kotlin DSL
val list = mutableListOf("a", "b", "c")
list.add("d")           // 添加元素
list.forEach { item -> println(item) }
```

### 函数/方法

```groovy
// Groovy DSL
def add(int a, int b) {
    return a + b
}

// 带闭包参数的函数
def configure(Closure closure) {
    closure.call()
}

// Kotlin DSL
fun add(a: Int, b: Int): Int {
    return a + b
}
```

### 条件判断

```groovy
// Groovy DSL
if (project.hasProperty('env')) {
    implementation "com.example:db-$env:1.0"
}

// Kotlin DSL
if (project.hasProperty("env")) {
    implementation("com.example:db-${project.property("env")}:1.0")
}
```

## 插件应用

### Groovy DSL

```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}
```

### Kotlin DSL

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.2.0"
    id("io.spring.dependency-management") version "1.1.4"
}
```

## 依赖配置

### Groovy DSL

```groovy
dependencies {
    // 普通依赖
    implementation 'org.springframework.boot:spring-boot-starter-web:3.2.0'

    // 文件依赖
    implementation files('libs/my-lib.jar')

    // 项目依赖
    implementation project(':module-common')

    // 测试依赖
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'

    // 排除传递依赖
    implementation('org.springframework.boot:spring-boot-starter-web') {
        exclude group: 'ch.qos.logback', module: 'logback-classic'
    }
}
```

### Kotlin DSL

```kotlin
dependencies {
    // 普通依赖
    implementation("org.springframework.boot:spring-boot-starter-web:3.2.0")

    // 文件依赖
    implementation(files("libs/my-lib.jar"))

    // 项目依赖
    implementation(project(":module-common"))

    // 测试依赖
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")

    // 排除传递依赖
    implementation("org.springframework.boot:spring-boot-starter-web") {
        exclude(group = "ch.qos.logback", module = "logback-classic")
    }
}
```

## 仓库配置

### Groovy DSL

```groovy
repositories {
    mavenCentral()
    maven { url 'https://maven.aliyun.com/repository/public' }
    maven { url 'https://jitpack.io' }
    flatDir { dirs 'libs' }  // 本地 flat 目录
}
```

### Kotlin DSL

```kotlin
repositories {
    mavenCentral()
    maven { url = uri("https://maven.aliyun.com/repository/public") }
    maven { url = uri("https://jitpack.io") }
    flatDir { dirs("libs") }
}
```

## Task 定义

### Groovy DSL

```groovy
task myTask {
    group = 'build'
    description = '我的自定义任务'

    doLast {
        println '执行中...'
    }
}

task copyFiles(type: Copy) {
    from 'src'
    into 'dest'
}
```

### Kotlin DSL

```kotlin
tasks.register<Copy>("copyFiles") {
    from("src")
    into("dest")
}

tasks.register("myTask") {
    group = "build"
    description = "我的自定义任务"
    doLast {
        println("执行中...")
    }
}
```

> **注意**：Kotlin DSL 推荐使用 `register` 而不是 `create`——`register` 是延迟创建（lazy），`create` 是立即创建。

## 配置块

### Groovy DSL

```groovy
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

test {
    useJUnitPlatform()
    maxParallelForks = 4
}
```

### Kotlin DSL

```kotlin
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.test {
    useJUnitPlatform()
    maxParallelForks = 4
}
```

## 迁移：从 Groovy 到 Kotlin

### 迁移工具

IntelliJ IDEA 支持自动将 `.gradle` 转换为 `.gradle.kts`：

1. 右键 `build.gradle`
2. 选择「Convert to Kotlin DSL」

### 常见迁移问题

```groovy
// Groovy
implementation "com.example:lib:$version"

// Kotlin（需要显式转换）
implementation("com.example:lib:$version")

// Kotlin（更安全的写法）
implementation("com.example:lib:${rootProject.version}")

// Groovy（方法调用可省略括号）
apply plugin: 'java'

// Kotlin（方法调用必须带括号）
apply(plugin = "java")
```

## 选型建议

| 场景 | 推荐 DSL |
|------|---------|
| Spring Boot 官方项目 | Groovy DSL |
| Android 项目 | Kotlin DSL |
| 新项目（希望类型安全） | Kotlin DSL |
| 现有 Groovy 项目扩展 | Groovy DSL |
| Kotlin 团队主导 | Kotlin DSL |

## 面试高频问题

**问：Groovy DSL 和 Kotlin DSL 哪个更好？**

答：没有绝对的「更好」，只有「更合适」。Kotlin DSL 提供更好的 IDE 支持（代码补全、类型检查、导航跳转），适合新项目和 Kotlin 团队。Groovy DSL 语法更宽松、生态更成熟，很多现有项目在用。Spring Boot 官方同时提供两种 DSL 的示例。

**问：Kotlin DSL 为什么推荐用 register 而不是 create？**

答：`register` 是延迟创建，Gradle 在真正需要时才创建 Task，适合配置尚未完全加载的场景。`create` 是立即创建，可能在配置阶段就触发 Task 的初始化，降低构建性能。Kotlin DSL 的类型安全特性让 `register` 更加可靠。
