# 构建工具

「每次改完代码，点点鼠标等编译——这大概是大多数人对构建工具的全部认知。」

但如果你只把 Maven 或 Gradle 当作「编译工具」，就太低估它们了。从依赖解析、增量构建、多环境打包到插件扩展，构建工具实际上是**软件构建流水线的核心枢纽**。它决定了你的项目能不能快速编译、能不能安全发布、能不能在 CI/CD 中高效运转。

一个配置混乱的 Maven 或 Gradle 项目，往往是团队工程化水平最直观的体现。

## 模块速览

| 方向 | 篇数 | 核心目标 |
|------|------|----------|
| [构建工具基础](/devops/build-tool/history) | 2 篇 | 发展历程、Maven vs Gradle 选型 |
| [Maven](/devops/build-tool/maven-concept) | 11 篇 | 依赖管理、生命周期、插件机制、多模块项目 |
| [Gradle](/devops/build-tool/gradle-concept) | 10 篇 | DSL 语法、增量构建、多项目、守护进程 |
| [构建最佳实践](/devops/build-tool/dependency-version) | 5 篇 | 版本规范、多环境、安全扫描、面试汇总 |

## 为什么需要专门的构建工具知识？

说个真实场景——你的项目突然构建失败，日志里全是 `Could not resolve dependencies`，或者依赖版本冲突导致运行时 `NoSuchMethodError`。这时你会发现：

- 你需要理解 Maven 的**依赖传递**和**依赖调解**机制
- 你需要知道 Gradle 的 **API vs Implementation** 隔离是如何工作的
- 你需要掌握**依赖分析**和**版本锁定**的正确姿势

这些不是「会用」就能解决的，需要深入理解其原理。

## 学习路径建议

```
第一阶段：理解核心概念（1-2 天）
→ Maven 坐标、仓库、依赖传递、作用域
→ Gradle Project、Task、构建脚本基础
→ 对比理解：Maven 的约定优于配置 vs Gradle 的灵活性

第二阶段：掌握常用操作（2-3 天）
→ Maven 多模块项目搭建与依赖管理
→ Gradle 增量构建与任务缓存
→ 掌握依赖分析命令：mvn dependency:tree / gradle dependencies

第三阶段：进阶与最佳实践（3-5 天）
→ Maven Profile 与 Gradle ProductFlavors 多环境构建
→ 构建性能优化：并行构建、本地缓存、增量编译
→ 依赖安全：漏洞扫描、版本锁定策略

第四阶段：面试准备（1-2 天）
→ 依赖冲突的排查与解决思路
→ Maven 与 Gradle 的底层差异
→ 构建工具在 CI/CD 中的角色
```

## 面试的核心逻辑

构建工具的面试题看似简单，但区分度很高：

1. **依赖管理深度**：能不能说清楚依赖传递的副作用？依赖调解的「就近原则」怎么工作的？`dependencyManagement` 和普通 `dependencies` 的区别是什么？
2. **生命周期理解**：Maven 的三套生命周期是相互独立还是有序执行？Clean 和 Default 之间的边界在哪里？
3. **性能意识**：有没有排查过构建性能问题？增量构建和并行构建的原理是什么？
4. **选型判断**：在什么场景下选 Maven，什么场景下选 Gradle？Spring Boot 选择 Gradle 的原因是什么？

> "会配置 Maven 和懂 Maven 是两回事。前者让你能跑起来，后者让你能在构建失败时快速定位问题，在构建缓慢时知道从哪里优化。"
