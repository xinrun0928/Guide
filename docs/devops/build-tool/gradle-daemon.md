# Gradle 守护进程（Daemon）与配置缓存、构建缓存

Gradle 的守护进程（Daemon）和构建缓存是提升构建速度的两大法宝。

## Gradle 守护进程（Daemon）

### 什么是守护进程？

传统方式每次运行 `mvn` 或 `gradle`，都会启动一个全新的 JVM 进程。JVM 启动本身就需要几秒钟，加上 Gradle/Maven 的初始化时间，一次简单构建可能要花 10-20 秒在进程启动上。

Gradle 守护进程是一个**长期运行的 JVM 进程**，Gradle 会复用这个进程执行构建，避免重复启动 JVM。

```
无 Daemon：
每次执行 gradle → 启动 JVM（3-5秒）→ 加载 Gradle → 执行构建

有 Daemon：
首次执行 gradle → 启动 JVM → 加载 Gradle → 执行构建
后续执行 gradle → 直接复用已启动的 JVM → 执行构建
```

### 开启和关闭 Daemon

```bash
# 开启（默认已开启）
./gradlew build --daemon

# 关闭
./gradlew build --no-daemon

# 停止所有 Daemon
./gradlew --stop
```

### 持久化配置

在 `~/.gradle/gradle.properties` 中配置：

```properties
# 开启守护进程（默认 true）
org.gradle.daemon=true

# JVM 参数
org.gradle.jvmargs=-Xmx2g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8

# 并行构建
org.gradle.parallel=true

# 缓存
org.gradle.caching=true
```

### Daemon 的优势

| 指标 | 无 Daemon | 有 Daemon |
|------|-----------|-----------|
| 首次构建 | 10-15 秒 | 10-15 秒 |
| 第二次构建 | 10-15 秒 | 2-3 秒 |
| 第十次构建 | 10-15 秒 | 2-3 秒 |

### Daemon 的生命周期

```
启动 Daemon：
    首次执行 gradle 命令时启动
    ↓
Daemon 空闲超时后自动退出（默认 3 小时空闲）
    ↓
手动停止：
    ./gradlew --stop
    或
    kill 进程 ID
```

### Daemon 日志

如果构建出现问题，可以查看 Daemon 日志：

```bash
# 查看 Daemon 日志位置
./gradlew --status

# 输出示例：
#   PID | VERSION | STATUS   | BUSY   | LAST COMMAND
#  1234 | 8.5     | IDLE     | 3 mins | --stop
#  5678 | 8.5     | STOPPED  | -      | (build completed)
```

Daemon 日志通常在 `~/.gradle/daemon/` 目录下。

## 构建缓存（Build Cache）

### 本地构建缓存

Gradle 的本地构建缓存会自动缓存 Task 的输出：

```properties
# 开启构建缓存（默认 true）
org.gradle.caching=true
```

```bash
# 显式开启
./gradlew build --build-cache

# 关闭
./gradlew build --no-build-cache
```

### 缓存的工作原理

```
Task 执行时：
    ↓
计算 Task 的缓存键（基于输入的内容哈希）
    ↓
检查本地缓存是否有匹配的输出
    ↓
命中 → 从缓存恢复输出，跳过执行
    ↓
未命中 → 执行 Task，产出输出存入缓存
```

### 缓存键的构成

缓存键由以下因素决定：

- Task 类名
- Task 输入文件的内容哈希
- Task 输入属性值
- Gradle 版本
- JVM 参数
- 环境变量

### 缓存清理

```bash
# 清理所有构建缓存
./gradlew clean --build-cache

# 或直接删除缓存目录
rm -rf ~/.gradle/caches/build-cache-*/
```

## 配置缓存（Configuration Cache）

### 什么是配置缓存？

Gradle 的构建分为三个阶段：

```
初始化（Initialization） → 确定有哪些 Project
    ↓
配置（Configuration） → 执行 build.gradle 建立 Task 图
    ↓
执行（Execution） → 执行 Task
```

**配置缓存**将 Configuration 阶段的结果（Task 图）缓存起来，下次构建时跳过 Configuration，直接进入 Execution。

```properties
# 开启配置缓存（实验性）
org.gradle.configuration-cache=true
org.gradle.configuration-cache.problems=warn
```

### 配置缓存的效果

| 阶段 | 无配置缓存 | 有配置缓存 |
|------|-----------|-----------|
| Initialization | ✓ | ✓ |
| Configuration | ✓ | 跳过（从缓存恢复） |
| Execution | ✓ | ✓ |

### 配置缓存的注意事项

配置缓存目前是**实验性功能**，使用时有以下限制：

1. 部分插件不支持配置缓存
2. `project.exec`、`project.javaexec` 可能导致缓存失效
3. 部分 Gradle API 在配置阶段不能使用

## Gradle 的多层缓存体系

```
┌─────────────────────────────────────────┐
│  Gradle 缓存体系                          │
├─────────────────────────────────────────┤
│  1. Daemon：JVM 进程复用                  │
│     避免重复启动 JVM，节省 3-5 秒           │
│  2. 增量构建：Task 级别的输入输出追踪        │
│     只重新执行变化的 Task                    │
│  3. 构建缓存：Task 输出的复用               │
│     在不同构建、不同机器间复用               │
│  4. 配置缓存：配置阶段的跳过（实验性）         │
│     下次构建跳过 Configuration              │
└─────────────────────────────────────────┘
```

## 性能调优配置

### gradle.properties 完整配置

```properties
# JVM 参数
org.gradle.jvmargs=-Xmx4g -XX:+HeapDumpOnOutOfMemoryError \
  -XX:+UseParallelGC \
  -XX:MaxMetaspaceSize=512m

# 守护进程
org.gradle.daemon=true
org.gradle.daemon.idle.timeout=1800000  # 30 分钟空闲后退出

# 并行构建
org.gradle.parallel=true
org.gradle.workers.max=8

# 缓存
org.gradle.caching=true
org.gradle.configuration-cache=true
org.gradle.configuration-cache.problems=warn

# 守护进程日志
org.gradle.daemon.debug=true  # 仅排查问题时开启

# 文件系统监听（增量构建增强）
org.gradle.vfs.watch=true
```

## CI/CD 中的 Daemon 管理

### 持续集成环境

CI 环境（如 Jenkins）通常建议**关闭 Daemon**：

```properties
# CI 环境配置
org.gradle.daemon=false
org.gradle.caching=true
org.gradle.parallel=true
```

原因：
- CI 构建通常是干净环境，Daemons 可能占用不必要的内存
- CI 构建完成后进程会被销毁，Daemon 没有复用机会
- CI 通常会并行运行多个构建，Daemons 可能产生资源竞争

### 配置 CI 环境变量

```yaml
# GitHub Actions
env:
  GRADLE_OPTS: "-Xmx2g -Dorg.gradle.daemon=false"
  GRADLE_CACHING: "true"
```

## 常见问题排查

### Daemon 无法启动

```bash
# 查看 Daemon 状态和错误
./gradlew --status

# 强制停止所有 Daemon
./gradlew --stop
pkill -f gradle

# 清理 Gradle 缓存后重试
rm -rf ~/.gradle/daemon/
rm -rf ~/.gradle/caches/
```

### 缓存污染导致构建失败

```bash
# 清理所有缓存
./gradlew clean
rm -rf ~/.gradle/caches/build-cache-*/
./gradlew --no-build-cache build
```

## 面试高频问题

**问：Gradle Daemon 是什么？解决了什么问题？**

答：Daemon 是一个长期运行的 JVM 进程。Gradle 每次执行构建都需要启动 JVM、加载 Gradle 核心类，这可能占用 3-5 秒。Daemon 让 Gradle 复用这个 JVM 进程，后续构建可以跳过 JVM 启动，直接执行。Daemon 的效果在多次构建的场景下特别明显，比如 IDE 中频繁运行 `./gradlew test`。

**问：Gradle 的多层缓存体系是怎么配合工作的？**

答：Daemon 解决的是 JVM 启动开销，增量构建解决的是「哪些 Task 需要重新执行」的问题，构建缓存解决的是「Task 结果能否在不同构建间复用」的问题。三者从不同维度加速构建，可以叠加使用。Daemons 和增量构建是默认开启的，构建缓存需要手动开启。
