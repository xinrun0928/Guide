# 构建工具面试高频问题汇总

构建工具看似简单，但面试中的区分度很高。初级开发者只会「配置依赖」，资深开发者能「排查问题、优化构建、制定规范」。

## Maven 篇

### 面试高频问题

#### Q1：Maven 的依赖传递是什么？有什么副作用？

**核心回答**：依赖传递是指当引入 A 依赖时，A 的依赖（B、C）也会被自动引入。副作用是可能引入不兼容的传递依赖版本，导致 `NoSuchMethodError`。解决方法是使用 `exclusions` 排除，或者在父 POM 的 `dependencyManagement` 中强制指定版本。

**追问方向**：
- 依赖调解的「就近原则」是怎么工作的？
- `exclusions` 排除后出现 ClassNotFoundException 怎么办？
- dependencyManagement 和 dependencies 的区别？

#### Q2：Maven 的生命周期和插件是什么关系？

**核心回答**：生命周期定义了构建的步骤顺序（validate → compile → test → package → install → deploy），插件定义了每个步骤具体做什么。Maven 的阶段本身不做事，它通过绑定插件目标来做事。

**追问方向**：
- 如何让同一个插件目标绑定到多个阶段？
- maven-compiler-plugin 的 fork 参数有什么用？
- execution id 有什么用？

#### Q3：Maven 多模块项目中，子模块的版本怎么统一管理？

**核心回答**：父 POM 使用 `dependencyManagement` 统一声明版本，子 POM 只声明依赖不写版本，由父 POM 控制版本号。这样改一个版本号，所有子模块统一生效。

**追问方向**：
- 父 POM 的 packaging 为什么是 pom？
- `-pl` 和 `-am` 参数是什么？
- 如何在多模块中只构建修改过的模块？

#### Q4：SNAPSHOT 版本和正式版本有什么区别？为什么不能用于生产？

**核心回答**：SNAPSHOT 表示不稳定版本，每次构建可能从远程仓库拉取新版本。生产环境要求的是确定性——同一个版本的构建产物应该完全一致，用 SNAPSHOT 无法保证这一点。

**追问方向**：
- Maven 怎么知道 SNAPSHOT 有没有更新？
- 如何配置私服让 SNAPSHOT 只在开发环境使用？

#### Q5：Maven 的 scope 有哪些？provided 和 compile 的区别？

**核心回答**：compile（默认，编译和运行时都可见）、provided（编译时可见，运行时由容器提供）、runtime（编译时不需要，运行时需要）、test（仅测试时可见）。provided 和 compile 的区别是 provided 不会打包进最终产物，也不会传递给依赖项目。

**追问方向**：
- 数据库驱动为什么用 runtime？
- import scope 有什么用？

#### Q6：mvn clean install 和 mvn install 有什么区别？

**核心回答**：`clean install` 先清理 target 目录再构建，确保从零开始。`install` 不清理，可能使用旧的编译产物。

**追问方向**：
- 什么情况下可以用 install 而不用 clean？
- CI/CD 构建应该用哪个？

## Gradle 篇

#### Q7：Gradle 和 Maven 的核心区别是什么？

**核心回答**：Maven 用 XML 配置，Gradle 用 DSL（Groovy/Kotlin）编程。Maven 约定优于配置，Gradle 灵活可扩展。Maven 每次全量编译，Gradle 支持增量构建和构建缓存。

**追问方向**：
- API vs Implementation 的区别是什么？
- Gradle 的增量构建是怎么工作的？
- 什么场景下 Gradle 比 Maven 更适合？

#### Q8：Gradle 的 Task 依赖链是怎么工作的？

**核心回答**：Gradle 在配置阶段构建一张有向无环图（DAG），每个 Task 是节点，`dependsOn` 声明边。在执行阶段，按拓扑排序顺序执行。循环依赖会报错。

**追问方向**：
- doFirst 和 doLast 的区别？
- 如何动态创建 Task？

#### Q9：Gradle 的守护进程（Daemon）解决了什么问题？

**核心回答**：每次执行 Gradle 都需要启动 JVM，耗时 3-5 秒。Daemon 是一个长期运行的 JVM 进程，后续构建直接复用，避免重复启动 JVM。

**追问方向**：
- Daemon 什么时候退出？
- CI 环境为什么通常关闭 Daemon？
- 配置缓存是什么？

#### Q10：Gradle 的 buildCache 和增量构建有什么区别？

**核心回答**：增量构建解决的是「同一机器同一项目的变化追踪」，buildCache 解决的是「跨构建、跨机器的结果复用」。两者可以叠加。

**追问方向**：
- 什么情况下缓存会失效？
- UP-TO-DATE 是什么意思？

#### Q11：Maven 项目如何迁移到 Gradle？

**核心回答**：对照 POM 和 build.gradle 的对应关系（dependencies → dependencies、plugins → plugins）。使用 BOM 和 dependencyManagement 插件处理版本管理。

**追问方向**：
- Gradle 发布的构件 Maven 能消费吗？
- 如何在 Gradle 中使用公司的 Maven 私服？

## 综合与实践

#### Q12：你们项目的构建工具有什么问题？你是怎么优化的？

**核心回答要点**：
1. 描述具体问题（构建慢、依赖冲突、本地 vs 生产不一致）
2. 排查过程（使用 dependency:tree、dependency:analyze）
3. 解决方案（镜像加速、版本锁定、并行构建）
4. 效果量化（构建时间从 10 分钟降到 2 分钟）

#### Q13：如何在构建工具中实现多环境配置？

**核心回答**：Maven 用 Profile，`-Pdev/-Pprod` 激活。Gradle 用 ProductFlavors，生成不同的构建变体。敏感信息通过环境变量或 CI Secrets 注入。

#### Q14：依赖安全怎么做？

**核心回答**：集成 OWASP Dependency-Check 进行漏洞扫描，在 CI 中设置 CVSS 阈值。定期更新依赖，使用 BOM 统一管理版本，禁止 SNAPSHOT 上生产。

#### Q15：Maven 和 Gradle 怎么选？

**核心回答**：看场景。小型项目、团队标准化需求高——Maven。大型多模块、需要高度定制构建逻辑、Android 项目——Gradle。

## 面试回答技巧

### 不要只说「会用」

```
❌ 不好：「我们会用 Maven」
✅ 好：「我们用 Maven 管理依赖，通过 dependencyManagement 统一版本，
        通过 profiles 实现多环境，集成 OWASP 扫描保证依赖安全。
        之前遇到过依赖冲突问题，我们通过 dependency:tree 排查，
        发现是传递依赖版本冲突，最后在父 POM 中强制指定版本解决。」
```

### 展示排查问题的能力

```
❌ 不好：「Maven 构建失败我们就重试」
✅ 好：「构建失败时，我们先看日志判断是依赖问题还是配置问题。
        依赖问题用 dependency:tree 排查树状依赖，
        配置问题用 help:effective-pom 查看合并后的完整配置。
        如果是网络问题，检查 settings.xml 的镜像配置。」
```

### 展示工程化意识

```
❌ 不好：「构建是我们自动化的」
✅ 好：「我们通过 Jenkins Pipeline 实现一键构建和发布。
        构建产物自动推送到 Nexus 私服，
        包含源码 JAR 和 Javadoc JAR。
        每次构建自动运行 OWASP 漏洞扫描，
        CVSS >= 7 的漏洞会阻断发布。
        通过 Gradle 配置缓存和并行构建，
        构建时间从 8 分钟降到 90 秒。」
```

## 面试核心逻辑

构建工具的面试，核心考察的是：

1. **深度**：对 Maven/Gradle 核心机制（依赖传递、生命周期、增量构建）的理解
2. **广度**：能否根据场景做出合理的工具选择
3. **实践**：有没有排查和解决实际问题的经验
4. **工程化**：是否理解构建工具在 CI/CD 和团队协作中的角色

> "会配置 Maven 和懂 Maven 是两回事。前者让你能跑起来，后者让你能在构建失败时快速定位问题，在构建缓慢时知道从哪里优化，在团队协作中制定出合理的依赖管理规范。"
