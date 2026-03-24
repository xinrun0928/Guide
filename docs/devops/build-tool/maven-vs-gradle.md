# Maven vs Gradle：核心差异与选型建议

「用 Maven 还是 Gradle？」这个问题在 Java 社区争论了十几年，至今没有标准答案。

不是没有答案，而是答案取决于你的场景。Maven 和 Gradle 各有优劣，选对了事半功倍，选错了后期痛苦。

## 本质区别：配置模型

两者的根本差异在于**配置模型**，这决定了它们的基因。

### Maven：声明式 + 固定生命周期

Maven 的构建过程被**严格固化**在生命周期中：compile → test → package → install → deploy。你不能随意插入步骤，只能选择在哪一步做什么。

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.11.0</version>
            <configuration>
                <source>17</source>
                <target>17</target>
            </configuration>
        </plugin>
    </plugins>
</build>
```

这种模式的好处是：**你不需要知道怎么做，Maven 告诉你」。标准化程度极高，团队成员上手成本低。

### Gradle：编程式 + 任务图

Gradle 把构建当作**程序**来写。构建过程是一张有向无环图（DAG），每个 Task 是图中的节点，你可以任意定义、组合、排序。

```groovy
plugins {
    id 'java'
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

// 自定义任务：清理 + 编译 + 打包，一气呵成
task buildApp(type: Exec) {
    dependsOn clean, classes, jar
    commandLine 'java', '-jar', "${jar.archiveFile.get().asFile}"
}
```

这种模式的好处是：**你决定怎么做，Maven 执行你」。灵活性极高，但需要更多的专业知识。

## 核心差异对比

### 依赖管理

| 特性 | Maven | Gradle |
|------|-------|--------|
| 依赖传递 | 支持，自动下载传递依赖 | 支持 |
| 依赖冲突解决 | 就近原则 + exclusions | 就近原则 + ResolutionStrategy |
| 依赖作用域 | compile/provided/runtime/test | implementation/api/runtimeOnly/testImplementation |
| 版本管理 | dependencyManagement + BOM | dependencyManagement + platform() |
| 缓存机制 | 本地仓库 | 本地仓库 + 构建缓存（可跨项目） |

### 构建性能

| 特性 | Maven | Gradle |
|------|-------|--------|
| 增量构建 | 支持（但效果有限） | 优秀（任务级增量） |
| 并行构建 | mvn -T 1C（效果一般） | --parallel（任务级并行） |
| 构建缓存 | 仅本地仓库 | 本地缓存 + 远程缓存 |
| daemon | 无 | 有（守护进程加速启动） |
| 配置缓存 | 无 | 有（实验性） |

### 配置复杂度

Maven 的配置简洁但受限，Gradle 的配置灵活但需要学习 DSL。

Maven 简单场景：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Gradle 同样场景：

```groovy
implementation 'org.springframework.boot:spring-boot-starter-web'
```

简洁程度相当。但到了复杂场景——比如定义一个同时编译 Java 和 Kotlin 的多语言项目——Gradle 的优势就显现出来了。

## 选型建议

### 选 Maven 的场景

1. **团队技术栈统一，流程标准化**。Maven 的约定优于配置让所有项目看起来一致，新人上手快。
2. **企业内网环境，依赖管理简单**。Maven 的依赖冲突解决机制清晰，易于管理。
3. **对构建透明度要求高**。Maven 的生命周期是显式的，任何人都能看懂构建流程。
4. **项目规模中小，定制需求少**。不需要复杂的自定义构建逻辑。

### 选 Gradle 的场景

1. **大型多模块项目**。Gradle 的增量构建和并行执行能显著缩短构建时间。
2. **需要高度定制构建逻辑**。Gradle 的 DSL 让复杂的构建需求成为可能。
3. **Android 项目**。Android Studio 官方支持 Gradle，这是硬性绑定。
4. **追求构建速度**。Gradle 的缓存机制和守护进程在 CI/CD 环境中优势明显。
5. **微服务架构，大量独立服务**。Gradle 的多项目构建和缓存共享能大幅提升效率。

### 不要被「更好」迷惑

很多人争论 Maven 和 Gradle 哪个更好，但这个问题本身没有意义。

真正的问题是：**在你们的团队和项目背景下，哪个更合适？**

一个 10 人团队维护 3 个项目，Maven 的标准化优势远大于 Gradle 的灵活性优势。

一个 100 人团队维护 50 个微服务，Gradle 的构建性能和多项目管理优势就会成为决定性因素。

## 面试中的回答策略

当面试官问「你们项目用 Maven 还是 Gradle？为什么？」时，不要只回答「我们用的是 Maven」。

更好的回答方式：

> "我们用的是 Maven，因为团队规模不大（10 人左右），项目结构简单，Maven 的约定规范已经足够。更重要的是，Maven 的依赖管理透明、稳定性高，踩过坑之后发现 Maven 的『慢』对我们来说不是瓶颈——一次全量编译 3 分钟，完全可接受。但如果项目规模继续增长，比如微服务数量超过 30 个，或者构建时间成为 CI/CD 的瓶颈，我会建议评估 Gradle 的增量构建和缓存机制。"

这个回答展示了：**你不仅会用工具，还在思考工具是否适合当前的场景**。
