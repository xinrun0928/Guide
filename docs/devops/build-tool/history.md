# 构建工具发展历程：Ant → Maven → Gradle

软件开发的第一步，是把源代码变成可运行的程序。这个「变」的过程，就是**构建**。

而构建工具，就是完成这件事的自动化程序。从最早的手写脚本，到如今的智能构建引擎，这个领域经历了三次重大演进。

## 三个时代的构建工具

### 第一代：Makefile 与 Ant

最早的构建，靠的是 Unix 的 `make` 工具——通过编写 `Makefile`，描述文件之间的依赖关系和构建步骤。

`make` 的问题在于：跨平台能力差（Windows 下基本没法用），依赖描述语言简陋，大型项目维护成本极高。

于是 Apache 在 2000 年推出了 **Ant**（Another Neat Tool）。Ant 用 XML 描述构建逻辑，第一次实现了跨平台的 Java 构建：

```xml
<project name="my-project" default="dist" basedir=".">
    <target name="init">
        <mkdir dir="${dist.dir}"/>
    </target>
    <target name="compile" depends="init">
        <javac srcdir="src" destdir="${dist.dir}"/>
    </target>
    <target name="dist" depends="compile">
        <jar destfile="${dist.dir}/my-project.jar"
             basedir="${dist.dir}"/>
    </target>
</project>
```

Ant 解决了跨平台问题，但 XML 本身并不是为编程设计的——当你需要写循环、判断逻辑时，XML 就变得又臭又长。

### 第二代：Maven——约定优于配置

2004 年，Maven 登场了。Maven 最大的贡献是**约定优于配置**（Convention Over Configuration）——你不再需要告诉它源码在哪、编译产物放哪，它有一套标准约定：

```
项目根目录/
├── pom.xml          # 项目对象模型
├── src/
│   ├── main/java/   # 源代码
│   └── test/java/   # 测试代码
└── target/          # 编译产物（Maven 自动创建）
```

这套约定让所有 Java 项目看起来都一样，新人接手成本大大降低。

更重要的是，Maven 带来了**依赖管理**的革命：

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
        <version>3.2.0</version>
    </dependency>
</dependencies>
```

你只需要声明依赖，Maven 自动下载、管理版本、甚至处理依赖的依赖（依赖传递）。

Maven 解决了「如何管理项目结构」和「如何管理依赖」两大问题，但也带来了新问题：XML 配置依然繁琐，定制化能力受限，构建速度慢。

### 第三代：Gradle——灵活与性能的平衡

2008 年，Gradle 诞生了。它吸收了 Ant 和 Maven 的优点，同时引入了革命性的设计：**用编程语言（Groovy/Kotlin）编写构建脚本**。

```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
}

repositories {
    mavenCentral()
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}

// 增量构建：只编译变化的代码
tasks.withType(JavaCompile) {
    options.incremental = true
}
```

Gradle 的核心优势：

1. **DSL 语法**：比 XML 简洁得多，可读性强
2. **增量构建**：只重新编译变化的部分，速度远快于 Maven
3. **构建缓存**：同一项目的不同构建、甚至不同机器之间可以共享构建结果
4. **多语言支持**：不仅 Java，还支持 Scala、Kotlin、C++ 等
5. **任务依赖图**：构建过程是一个有向无环图（DAG），可以精确控制执行顺序

## 三个时代的对比

| 维度 | Ant | Maven | Gradle |
|------|-----|-------|--------|
| 配置语言 | XML | XML | Groovy/Kotlin DSL |
| 依赖管理 | 手动管理 JAR | 中央仓库 + 依赖传递 | 中央仓库 + 依赖传递 |
| 约定能力 | 无 | 强约定 | 可覆盖约定 |
| 构建速度 | 快 | 较慢（每次全量） | 快（增量 + 缓存） |
| 学习曲线 | 低 | 中 | 中高 |
| 灵活性 | 高（纯编程） | 低 | 高 |
| 生态 | 一般 | 庞大 | 快速成长 |

## 演进背后的驱动力

回顾这二十年，有三条主线在推动构建工具进化：

**第一，依赖爆炸。** 2000 年一个 Java 项目可能有 5 个依赖，现在一个 Spring Boot 项目直接依赖几十个、间接依赖几百个。手动管理不现实，必须自动化。

**第二，速度为王。** CI/CD 兴起后，构建速度直接影响交付效率。Maven 一次全量编译可能需要几分钟，Gradle 的增量构建可以将时间缩短到几十秒。

**第三，DSL 化。** XML 是数据格式，不是编程语言。用 XML 写业务逻辑是痛苦，用 DSL 写构建逻辑是享受。

## Spring 选择 Gradle 的原因

很多人知道 Spring Boot 选择 Gradle 作为官方构建工具，但可能不知道为什么。

核心原因不是 Gradle 比 Maven 快（快只是一方面），而是 **Gradle 的灵活性让 Spring 可以更好地模块化其生态**。Spring Framework 有几十个子模块，如果用 Maven 的继承模型管理，版本协调会非常复杂。Gradle 的 `dependencyManagement` 和 BOM 支持让这一切变得优雅。

> "Maven 告诉你『应该怎么做』，Gradle 让你决定『怎么做』。"
