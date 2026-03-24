# Gradle 增量构建与任务缓存：输入输出配置、构建缓存

「每次改一行代码，Maven 要重新编译整个项目」——Gradle 用增量构建解决了这个问题。

## 增量构建的核心原理

Gradle 的增量构建依赖两个机制：

1. **输入输出追踪**：每个 Task 声明自己的输入（文件、环境变量等）和输出（class 文件、JAR 等）
2. **变化检测**：构建时比较输入和输出的变化，只执行需要重新运行的 Task

```
Task 状态：
├── UP-TO-DATE：输入没变，直接跳过（最快）
├── EXECUTED：输入变了，重新执行
├── FROM-CACHE：从缓存恢复（次快）
└── NO-SOURCE：输入不存在，跳过
```

## 任务状态的判断逻辑

```
执行 Task 前的检查：
┌─────────────────────────────────────┐
│  输入文件有没有变化？                  │
│  → 变了 → 重新执行                   │
│  → 没变？                            │
│    输出目录有没有对应的输出文件？        │
│    → 有且完整 → SKIP（UP-TO-DATE）   │
│    → 没有或不完整 → 重新执行          │
└─────────────────────────────────────┘
```

## 声明 Task 的输入和输出

### 基本声明

```groovy
task processData(type: SourceTask) {
    source = fileTree('src/data')

    destinationDirectory = file('build/data')

    doLast {
        // 处理逻辑
    }
}
```

### 显式声明输入输出属性

```groovy
task generateConfig {
    // 声明输入属性
    inputs.property('version', project.version)
    inputs.file 'src/template/config.ftl'
    inputs.dir 'src/templates'

    // 声明输出属性
    outputs.file 'build/generated/config.json'
    outputs.dir 'build/generated/output'

    doLast {
        // 生成配置文件的逻辑
    }
}
```

### 避免 UP-TO-DATE 误判

如果 Task 的逻辑中有**副作用**（如调用外部 API），Gradle 的文件追踪无法检测到变化，需要手动声明：

```groovy
task fetchRemoteData {
    // 声明时间戳为输入，确保即使输出存在也想重新执行
    inputs.property('lastFetchTime', project.findProperty('lastFetchTime'))

    outputs.cacheIf { true }  // 允许缓存

    doLast {
        // 调用远程 API 获取数据
    }
}
```

## 构建缓存（Build Cache）

构建缓存比增量构建更进一步——不仅跳过本地重新执行，还能复用其他机器的构建结果。

### 开启构建缓存

```bash
# 开启
./gradlew build --build-cache

# 或者在 gradle.properties 中配置
org.gradle.caching=true
```

### 本地缓存 vs 远程缓存

```
本地缓存（Local Cache）：
    build 目录 → 复用本项目历史构建结果

远程缓存（Remote Cache）：
    共享缓存服务器（如 Gradle Cloud） → 复用团队成员或其他 CI 的构建结果
```

### 远程缓存配置

```groovy
// gradle.properties
org.gradle.caching=true
org.gradle.cache.url=https://cache.example.com

// ~/.gradle/init.gradle
allprojects {
    buildCache {
        remote(HttpBuildCache) {
            url = 'https://cache.example.com/'
            credentials {
                username = System.getenv('CACHE_USER')
                password = System.getenv('CACHE_PASS')
            }
        }
    }
}
```

## 缓存失效策略

### 基于内容的缓存键

Gradle 自动为每个 Task 生成缓存键，包含：
- Task 的类名
- Task 的输入文件内容的哈希
- Task 的输入属性的值

### 手动控制缓存

```groovy
task myTask {
    // 总是重新执行，不使用缓存
    outputs.cacheIf { false }

    // 永远缓存输出
    outputs.cacheIf { true }

    // 条件缓存
    outputs.cacheIf { !project.hasProperty('skipCache') }
}
```

## 增量编译

Gradle 的 Java 插件支持**增量编译**（Javac 增量编译），只重新编译变化的文件。

### 增量编译配置

```groovy
tasks.withType(JavaCompile).configureEach {
    options.incremental = true
    // 可选：开启增量编译注解处理
    options.annotationProcessorGeneratedSourcesLocation = file('build/generated/sources/annotationProcessor/java/main')
}
```

### 清理增量编译缓存

```bash
./gradlew clean compileJava
# 或者删除 .gradle 目录下的增量缓存
rm -rf .gradle/4.11.2/fileChanges/
```

## 任务并行执行

### 开启并行构建

```groovy
// gradle.properties
org.gradle.parallel=true
```

```bash
./gradlew build --parallel
```

### 并行构建的注意事项

```
并行构建的前提：
├── 模块间没有循环依赖
├── 每个 Task 的输出是独立的（不会互相覆盖）
└── 使用文件系统投影（如 NTFS 的 alternate data streams）

并行构建的风险：
├── 多个 Task 同时写入同一文件 → 构建失败
└── 共享状态的 Task 之间产生竞争条件
```

### 控制并行度

```groovy
// gradle.properties
org.gradle.workers.max=8  // 最大并行 Worker 数
```

## 配置缓存（Configuration Cache）

配置缓存将 Gradle 的配置阶段（Project 配置）缓存起来，进一步加速构建。

```groovy
// gradle.properties
org.gradle.configuration-cache=true
org.gradle.configuration-cache.problems=warn  // 警告模式
```

> **注意**：配置缓存目前是实验性功能，部分插件可能不支持。

## 常见问题与排查

### Task 显示 UP-TO-DATE 但仍想重新执行

```bash
# 强制重新执行所有 Task
./gradlew clean build

# 强制重新执行特定 Task
./gradlew --rerun-tasks myTask

# 清理特定 Task 的缓存
./gradlew cleanmyTask
```

### 构建缓存未命中

```bash
# 查看 Task 的缓存键
./gradlew build --info | grep "Task :myTask"

# 查看缓存相关的详细日志
./gradlew build --build-cache --info | grep -i cache
```

## 性能对比参考

| 构建方式 | 首次构建 | 第二次（无变化） | 第二次（小变化） |
|---------|---------|----------------|-----------------|
| Maven 全量 | 10 分钟 | 10 分钟 | 10 分钟 |
| Gradle 增量 | 3 分钟 | < 1 秒 | 10-30 秒 |
| Gradle + 缓存 | 3 分钟 | < 1 秒 | < 1 秒 |
| Gradle + 远程缓存 | 3 分钟 | < 1 秒 | < 1 秒 |

## 面试高频问题

**问：Gradle 的 UP-TO-DATE 是什么意思？**

答：UP-TO-DATE 表示 Task 的所有输入没有变化，输出已经存在且完整，不需要重新执行。Gradle 通过比较输入文件的时间戳和内容哈希来判断。

**问：构建缓存和增量构建有什么区别？**

答：增量构建解决的是「同一台机器的同一个项目，这次构建和上次构建相比有哪些变化」的问题。构建缓存解决的是「这台机器的构建结果，能不能被其他机器或构建复用」的问题。两者的目标不同，但可以叠加使用。
