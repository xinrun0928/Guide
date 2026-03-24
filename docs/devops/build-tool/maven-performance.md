# Maven 构建性能优化

Maven 构建慢是 Java 项目的普遍痛点。一个大型项目全量构建可能需要 10-30 分钟，这直接拖慢了 CI/CD 的效率。

## 构建慢的常见原因

```
Maven 构建慢的五大元凶：
├── 网络下载慢（从远程仓库下载依赖）
├── 重复编译（每次全量编译，未利用增量构建）
├── 单线程执行（模块间可并行但未开启）
├── 测试耗时（单元测试数量多且串行执行）
└── 插件效率低（使用了低效的插件或配置）
```

## 优化一：加速依赖下载

### 使用国内镜像

在 `settings.xml` 中配置阿里云镜像：

```xml
<mirrors>
    <mirror>
        <id>aliyun-maven</id>
        <mirrorOf>*</mirrorOf>
        <url>https://maven.aliyun.com/repository/public</url>
    </mirror>
</mirrors>
```

### 配置并行下载

```xml
<profiles>
    <profile>
        <id>加速下载</id>
        <properties>
            <maven.downloadSources>true</maven.downloadSources>
            <maven.downloadJavadocs>true</maven.downloadJavadocs>
        </properties>
    </profile>
</profiles>
```

### 使用离线模式（已缓存时）

```bash
# 优先从本地仓库获取，不检查远程更新
mvn clean install -o
```

## 优化二：增量构建

### 清理不必要的清理

开发阶段可以用 `mvn install` 替代 `mvn clean install`，跳过 clean 步骤：

```bash
mvn install -DskipTests  # 不 clean，不跑测试，最快
```

但要注意：**CI/CD 构建时必须用 clean**，否则可能因为旧文件残留导致构建不一致。

### 开启增量编译

Maven 编译器插件默认已经支持增量编译（基于 `maven-compiler-plugin 3.6+`），但可以显式开启：

```xml
<plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.11.0</version>
    <configuration>
        <source>17</source>
        <target>17</target>
        <fork>true</fork>
        <!-- 开启增量编译 -->
        <useIncrementalCompilation>true</useIncrementalCompilation>
    </configuration>
</plugin>
```

## 优化三：并行构建

### 多模块并行

```bash
# -T 1C: 每个 CPU 核心一个线程
mvn clean install -T 1C

# -T 4: 固定 4 个线程
mvn clean install -T 4
```

### 自定义线程配置

```bash
# 在 CI 环境中自动检测 CPU 核心数
mvn clean install -T 0   # 0 表示自动检测

# 也可以在 settings.xml 中配置默认线程数
<profiles>
    <profile>
        <id>parallel</id>
        <properties>
            <maven.build.parallel>true</maven.build.parallel>
            <maven.thread.count>8</maven.thread.count>
        </properties>
    </profile>
</profiles>
```

## 优化四：跳过不必要的插件

### 跳过源码打包

```bash
mvn clean install -Dmaven.source.skip=true
```

### 跳过 Javadoc 生成

```bash
mvn clean install -Dmaven.javadoc.skip=true
```

### 跳过 CheckStyle

```bash
mvn clean install -Dcheckstyle.skip=true
```

## 优化五：测试优化

### 跳过测试

```bash
mvn clean install -DskipTests          # 跳过测试运行
mvn clean install -Dmaven.test.skip=true  # 跳过测试编译和运行
```

### 并行运行测试

```xml
<plugin>
    <artifactId>maven-surefire-plugin</artifactId>
    <version>3.0.0</version>
    <configuration>
        <!-- 并行运行测试 -->
        <parallel>methods</parallel>
        <threadCount>4</threadCount>
        <!-- 并行运行测试类 -->
        <perCoreThreadCount>true</perCoreThreadCount>
        <!-- 测试失败后不中断，继续运行 -->
        <testFailureIgnore>false</testFailureIgnore>
        <!-- 跳过特定测试 -->
        <excludes>
            <exclude>**/IntegrationTest*.java</exclude>
        </excludes>
    </configuration>
</plugin>
```

### 只运行失败的测试

```bash
# 使用 rerunFailingTestsCount 重跑失败的测试
mvn test -Dsurefire.rerunFailingTestsCount=2
```

## 优化六：配置优化

### 增大 JVM 堆内存

在 `MAVEN_OPTS` 环境变量中设置：

```bash
export MAVEN_OPTS="-Xmx2g -Xms512m"
```

或在 `.mvn/jvm.config` 文件中配置（推荐，Maven 3.9+ 支持）：

```
-Xmx2g
-Xms512m
-XX:+UseG1GC
```

### 使用 Maven Daemon

使用 `mvnd`（Maven Daemon）替代 `mvn`，可以复用 JVM 进程：

```bash
# macOS
brew install mvndaemon/mvnd/mvnd

# 使用
mvnd clean install -DskipTests
```

## 优化七：构建缓存

### 本地仓库优化

```xml
<!-- settings.xml -->
<profiles>
    <profile>
        <id>cache</id>
        <properties>
            <!-- 离线模式下更新检查 -->
            <updateReleaseFiles>true</updateReleaseFiles>
        </properties>
    </profile>
</profiles>
```

### 使用镜像加速

```xml
<mirrors>
    <mirror>
        <id>nexus-aliyun</id>
        <mirrorOf>central</mirrorOf>
        <url>https://maven.aliyun.com/repository/central</url>
    </mirror>
</mirrors>
```

## 优化八：项目结构优化

### 减少模块间的依赖深度

```
不好：module-a → module-b → module-c → module-d（单线程）
好：    module-a
    ↙        ↘
module-b    module-c（可以并行）
```

### 将不常改动的模块抽取为独立构件

如果 `common-utils` 模块很少改动，可以：
1. 单独发布到本地仓库
2. 其他模块依赖它，而不是源码引用
3. 构建时跳过 `common-utils`，直接用已发布的版本

## CI/CD 中的优化建议

```yaml
# GitHub Actions 示例
- name: Build with Maven
  run: |
    mvn clean install \
      -T 1C \              # 并行构建
      -DskipTests \        # 开发阶段跳过测试
      -Dmaven.javadoc.skip=true \
      -Dmaven.source.skip=true
```

## 性能对比参考

| 优化手段 | 效果 | 适用场景 |
|---------|------|---------|
| 阿里云镜像 | 下载快 3-10 倍 | 所有场景 |
| 并行构建 -T 1C | 快 2-4 倍 | 多模块项目 |
| 跳过源码/Javadoc | 快 10-20% | 开发阶段 |
| 测试并行化 | 快 2-3 倍 | 测试多且独立 |
| mvnd | 快 20-40% | 频繁构建场景 |
| 增量编译 | 快 30-50% | 小改动后构建 |

## 面试高频问题

**问：Maven 构建很慢，从哪些方面排查？**

答：按以下顺序排查——第一步看网络，`mvn dependency:resolve` 是否频繁超时，用阿里云镜像替代中央仓库；第二步看依赖，`mvn dependency:tree` 是否有过多传递依赖，考虑清理无用依赖；第三步看测试，`mvn test` 是否耗时过长，考虑并行化或跳过部分测试；第四步看配置，检查是否有不必要的插件执行，JVM 堆内存是否足够。

**问：mvn clean install 和 mvn install 在 CI/CD 中应该用哪个？**

答：CI/CD 中必须用 `mvn clean install`。原因是 CI/CD 环境可能使用共享构建缓存或 volume，不 clean 可能导致旧文件残留。更重要的是，CI/CD 追求的是**一致性**而非速度，clean 保证了每次构建从零开始。
