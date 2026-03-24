# Gradle 常用命令

## 基础命令

```bash
./gradlew build                    # 完整构建（编译 + 测试 + 打包）
./gradlew clean build              # 清理后构建
./gradlew build -x test           # 构建但跳过测试
./gradlew assemble                # 组装产物（不运行测试）
./gradlew classes                 # 编译主代码
./gradlew test                    # 运行测试
./gradlew jar                     # 打包 JAR
```

## 跳过和优化

```bash
./gradlew build --no-daemon       # 禁用守护进程
./gradlew build --build-cache     # 启用构建缓存
./gradlew build --parallel        # 并行构建
./gradlew build --offline         # 离线模式（使用缓存，不下载依赖）
./gradlew build --rerun-tasks     # 强制重新执行所有任务
```

## 多项目构建

```bash
# 构建所有项目
./gradlew build

# 只构建特定子项目
./gradlew :app:build
./gradlew :module-user:build

# 构建特定项目及其依赖
./gradlew :app:build -x :module-user:test

# 排除某个子项目
./gradlew build -x :module-user:build

# 构建所有子项目（根项目跳过）
./gradlew build -x :root-project:classes
```

## 依赖相关

```bash
# 查看依赖树
./gradlew dependencies
./gradlew :app:dependencies

# 查看特定配置的依赖
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencies --configuration implementation

# 查看依赖报告（HTML）
./gradlew htmlDependencyReport

# 分析依赖冲突
./gradlew buildEnvironment
./gradlew dependencyInsight --dependency com.alibaba:fastjson
```

## 任务相关

```bash
# 列出所有可用任务
./gradlew tasks
./gradlew tasks --all           # 包含子项目任务
./gradlew tasks --group=build   # 只显示指定分组的任务

# 查看任务详情
./gradlew help --task build

# 执行特定任务
./gradlew myCustomTask

# 查看任务执行顺序（不实际执行）
./gradlew build --dry-run
```

## 测试相关

```bash
./gradlew test                        # 运行所有测试
./gradlew test --tests "com.example.*"  # 运行指定包测试
./gradlew test --tests "com.example.UserServiceTest"  # 运行指定类
./gradlew test --tests "*Test.testMethod*"  # 运行指定方法
./gradlew test --continue             # 测试失败后继续（不中断）
./gradlew test --rerun-tasks         # 强制重新运行测试
./gradlew test --info                # 详细日志
```

## Spring Boot 相关

```bash
./gradlew bootRun                # 运行 Spring Boot 应用
./gradlew bootJar                # 打包 Spring Boot JAR
./gradlew bootBuildImage          # 构建 Docker 镜像（Spring Boot 2.3+）
```

## Gradle 自身管理

```bash
./gradlew --version              # 查看 Gradle 版本
./gradlew --status               # 查看 Daemon 状态
./gradlew --stop                 # 停止所有 Daemon
./gradlew --refresh-dependencies # 强制刷新依赖（检查远程更新）
./gradlew init                    # 初始化新项目
```

## Gradle Wrapper

```bash
./gradlew wrapper                  # 生成/升级 Wrapper
./gradlew wrapper --gradle-version=8.5  # 指定 Gradle 版本
./gradlew wrapper --distribution-type=bin  # 仅二进制（默认）
./gradlew wrapper --distribution-type=all # 包含源码和文档
```

## 构建变体

```bash
# 使用特定 Product Flavor 构建
./gradlew assembleProdRelease

# 查看所有可用变体
./gradlew projects

# 构建所有变体
./gradlew build
```

## Gradle 属性

```bash
# 查看所有项目属性
./gradlew properties

# 查看特定属性
./gradlew -q properties | grep version

# 传递属性
./gradlew build -Penv=prod -Pdebug=true
```

## 日志和调试

```bash
./gradlew build --info             # Info 级别日志
./gradlew build --debug            # Debug 级别日志（最详细）
./gradlew build --stacktrace       # 打印完整堆栈
./gradlew build -s                # 简化堆栈（用于分析）
```

## 清理

```bash
./gradlew clean                    # 清理 build 目录
./gradlew clean build --build-cache  # 清理 + 使用缓存构建
./gradlew cleanCache              # Gradle 7+ 清理缓存
```

## 常用组合示例

```bash
# 日常开发：快速构建
./gradlew build -x test -x check --parallel

# CI 构建：完整构建 + 缓存
./gradlew clean build --build-cache --parallel --no-daemon

# 调试：详细日志 + 强制重跑
./gradlew clean test --info --rerun-tasks

# 查看依赖：特定模块 + 运行时依赖
./gradlew :app:dependencies --configuration runtimeClasspath

# 发布：构建 + 生成源码和文档
./gradlew clean build publish --stacktrace
```

## gradle.properties 常用配置

```properties
# 性能
org.gradle.daemon=true
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.workers.max=8

# JVM
org.gradle.jvmargs=-Xmx4g -XX:+HeapDumpOnOutOfMemoryError

# 编码
org.gradle.project.encoding=UTF-8

# 项目特定属性
my.custom.property=value
```

## 面试高频问题

**问：./gradlew 和 gradle 命令有什么区别？**

答：`gradle` 命令需要本地安装 Gradle。`./gradlew` 是 Gradle Wrapper 的启动脚本，使用项目绑定的 Gradle 版本。推荐使用 `./gradlew`，因为它确保团队所有人使用相同版本的 Gradle，避免「本地 Gradle 版本不一致」导致的构建问题。

**问：--build-cache 和 --rerun-tasks 有什么区别？**

答：`--build-cache` 尝试从缓存恢复 Task 输出，跳过 Task 实际执行（如果缓存命中）。`--rerun-tasks` 强制所有 Task 重新执行，不使用缓存。两者可以结合使用：`--rerun-tasks --build-cache`，强制重新执行所有 Task，但执行完成后把结果存入缓存。
