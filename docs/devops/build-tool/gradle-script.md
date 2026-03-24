# Gradle 构建脚本：Project 与 Task 概念、任务依赖链

理解 Project 和 Task，是掌握 Gradle 的核心。

## Project——Gradle 的构建单元

每个 Gradle 项目由一个或多个 **Project** 组成。Project 可以是：

- 一个 Java 库
- 一个 Web 应用
- 一个多模块项目中的子模块

```groovy
// settings.gradle
rootProject.name = 'my-app'
include 'module-user', 'module-order', 'module-payment'
```

这定义了三个 Project：
- `root project`（根项目）
- `:module-user`（子项目）
- `:module-order`（子项目）
- `:module-payment`（子项目）

## Task——构建的最小执行单元

每个 Project 包含多个 **Task**。Task 是 Gradle 中最小的工作单元，每个 Task 做一件事：编译代码、运行测试、打包 JAR 等。

```groovy
// build.gradle
plugins {
    id 'java'
}

// 定义一个 Task
task hello {
    doLast {
        println 'Hello, Gradle!'
    }
}

// 简化写法（doLast 省略）
task hello {
    println 'Hello, Gradle!'
}
```

执行 Task：

```bash
./gradlew hello
# 输出：Hello, Gradle!
```

## Task 的完整语法

```groovy
task myTask {
    // Task 配置块
    group = 'build'           // Task 所属分组
    description = '我的自定义任务'  // Task 描述

    // Task 执行逻辑
    doFirst {
        // 在 Task 主逻辑之前执行
        println 'Task 即将开始...'
    }

    doLast {
        // 在 Task 主逻辑之后执行
        println 'Task 已完成'
    }
}
```

## Task 依赖链

Task 之间可以有依赖关系。Gradle 会自动按依赖顺序执行。

### 声明依赖：dependsOn

```groovy
// Task B 依赖 Task A
task B {
    dependsOn ':A'
    doLast {
        println '执行 B'
    }
}

task A {
    doLast {
        println '执行 A'
    }
}
```

执行 `B` 时，A 会先执行：

```bash
./gradlew B
# 输出：
# 执行 A
# 执行 B
```

### 链式依赖

```groovy
task dist {
    dependsOn compile, test
    doLast {
        println '打包发布'
    }
}

task compile {
    doLast { println '编译代码' }
}

task test {
    dependsOn compile
    doLast { println '运行测试' }
}
```

执行顺序：compile → test → dist

### 动态依赖

```groovy
// 所有以 compile 开头的 Task 执行完后，再执行 deploy
task deploy {
    dependsOn project.tasks.findAll { task ->
        task.name.startsWith('compile')
    }
    doLast { println '部署' }
}
```

## 内置 Task 详解

使用 `java` 插件后，会自动创建以下 Task：

```bash
./gradlew tasks
# 显示所有可用的 Task
```

### 常用内置 Task

| Task | 说明 |
|------|------|
| `compileJava` | 编译 Java 源代码 |
| `processResources` | 处理资源文件 |
| `classes` | 编译主代码（含资源处理） |
| `compileTestJava` | 编译测试代码 |
| `test` | 运行单元测试 |
| `jar` | 打包 JAR |
| `javadoc` | 生成 JavaDoc |
| `build` | 执行完整构建 |
| `clean` | 清理构建产物 |
| `assemble` | 组装所有产物（不跑测试） |
| `check` | 运行所有检查（测试、lint） |

### Task 执行顺序

```
clean → compileJava → processResources → classes
                                           ↓
                              compileTestJava → test
                                           ↓
                                          jar
                                           ↓
                                       assemble
                                           ↓
                                        build
```

## 自定义 Task

### 基本自定义

```groovy
// 创建自定义 Task
task copyConfig(type: Copy) {
    from 'src/main/resources'
    into 'build/resources'
    include '*.properties'
}

// 创建删除 Task
task cleanLogs(type: Delete) {
    delete 'logs'
    delete 'build'
}

// 创建执行命令的 Task
task runScript(type: Exec) {
    commandLine 'bash', '-c', 'echo "Hello World"'
    workingDir projectDir
}
```

### 使用 Java 类的 Task

```groovy
task myTask(type: JavaExec) {
    mainClass = 'com.example.Main'
    classpath = sourceSets.main.runtimeClasspath
    args 'arg1', 'arg2'
}
```

## Task 输出与输入

Gradle 的增量构建依赖 Task 的输入和输出声明：

```groovy
task processData(type: Copy) {
    // 输入：源文件
    from 'src/data'
    // 输出：目标目录
    into 'build/data'
    // 文件名映射
    rename { String fileName ->
        fileName.replace('.txt', '.csv')
    }
}
```

Gradle 会自动：
1. 判断输入是否变化
2. 判断输出是否过期
3. 只执行需要重新运行的 Task

## 多项目构建

### 根项目统一配置

```groovy
// 根项目 build.gradle
subprojects {
    // 对所有子项目应用 Java 插件
    apply plugin: 'java'

    // 统一配置
    repositories {
        mavenCentral()
    }

    // 统一依赖
    dependencies {
        testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'
    }

    // 统一测试配置
    test {
        useJUnitPlatform()
        maxParallelForks = 4
    }
}
```

### 子项目特定配置

```groovy
// module-user/build.gradle
dependencies {
    implementation project(':module-common')
    implementation 'org.springframework.boot:spring-boot-starter-web'
}
```

### 子项目间依赖

```groovy
// module-order/build.gradle
dependencies {
    // 依赖另一个子项目
    implementation project(':module-user')
    implementation project(':module-payment')
}
```

## 面试高频问题

**问：Gradle 的 Task 依赖链是怎么工作的？**

答：Gradle 在**配置阶段**构建一张有向无环图（DAG），每个 Task 是图中的节点，`dependsOn` 声明边。在**执行阶段**，按拓扑排序的顺序执行。如果有环形依赖，Gradle 会报错。

**问：doFirst 和 doLast 有什么区别？**

答：`doLast` 将代码追加到 Task 的末尾执行，`doFirst` 将代码插入到 Task 的开头执行。`doLast` 用得更多，`doFirst` 常用于在已有 Task 前面插入逻辑（比如在 `jar` 前面检查文件是否存在）。
