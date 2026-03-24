# Maven 生命周期：clean、default、site

很多人把 Maven 的生命周期等同于「mvn package」，但理解这三套生命周期的设计，是用好 Maven 的前提。

## 三套生命周期，互不干扰

Maven 有三套**相互独立**的生命周期。这意味着你可以单独执行任何一套，而不会触发其他两套。

```
mvn clean          ← 只清理 target 目录
mvn compile        ← 只编译，不清理，不打包
mvn site           ← 只生成站点，不编译不打包
mvn clean compile  ← 先清理再编译
```

执行后面的阶段时，前面的阶段会自动执行。但单独执行某套生命周期的阶段，不会触发其他生命周期。

## clean 生命周期——清理构建产物

```
pre-clean → clean → post-clean
```

只有三个阶段，最常用的是 `clean`。

```bash
mvn clean          # 删除 target 目录
mvn clean install  # 清理后重新安装到本地仓库
```

**为什么需要 clean？**

Maven 的增量编译有时不够可靠——当你删除了源代码但编译产物还在时，可能导致「明明删了类，运行时还报错说找不到」的问题。`clean` 就是解决这个问题的。

## default 生命周期——核心构建流程

这是 Maven 最重要的生命周期，包含了从编译到部署的全部流程。

### 核心阶段详解

| 阶段 | 做了什么 | 常用场景 |
|------|---------|---------|
| **validate** | 验证项目结构正确性 | 几乎不用手动跑 |
| **initialize** | 初始化构建状态 | 生成一些初始文件 |
| **generate-sources** | 生成源代码 | 自动生成代码（如 protobuf） |
| **process-sources** | 处理源代码 | 资源文件过滤 |
| **generate-resources** | 生成资源文件 | - |
| **process-resources** | 复制资源文件到输出目录 | - |
| **compile** | 编译源代码 | 日常开发 |
| **process-classes** | 处理编译后的类文件 | 字节码增强 |
| **generate-test-sources** | 生成测试源代码 | - |
| **process-test-sources** | 处理测试源代码 | - |
| **generate-test-resources** | 生成测试资源文件 | - |
| **process-test-resources** | 复制测试资源文件 | - |
| **test-compile** | 编译测试代码 | - |
| **process-test-classes** | 处理测试类文件 | - |
| **test** | 运行单元测试 | CI/CD 中跑测试 |
| **prepare-package** | 打包前的准备 | - |
| **package** | 打包（jar/war/zip） | 发布前打包 |
| **pre-integration-test** | 集成测试前准备 | - |
| **integration-test** | 运行集成测试 | - |
| **post-integration-test** | 集成测试后处理 | - |
| **verify** | 检查包是否有效 | - |
| **install** | 安装到本地仓库 | 本地共享 |
| **deploy** | 部署到远程仓库 | 发布到私服/中央仓库 |

### 常用命令的执行流程

```bash
# mvn compile
# 执行：validate → ... → process-resources → compile

# mvn test
# 执行：validate → ... → compile → test-compile → test

# mvn package
# 执行：validate → ... → compile → test-compile → test → package

# mvn install
# 执行：validate → ... → package → install

# mvn deploy
# 执行：validate → ... → install → deploy
```

### package vs install vs deploy

```
┌─────────────────────────────────────────────────────┐
│  项目 A 打包为 a.jar                                  │
└─────────────────────────────────────────────────────┘
                    ↓
          mvn package
                    ↓
┌─────────────────────────────────────────────────────┐
│  a.jar 放在项目 A 的 target/ 目录下                    │
│  仅本项目可用                                         │
└─────────────────────────────────────────────────────┘
                    ↓
          mvn install
                    ↓
┌─────────────────────────────────────────────────────┐
│  a.jar 安装到本地仓库 ~/.m2/repository/               │
│  其他本地项目可以通过 dependency 引用 A                 │
└─────────────────────────────────────────────────────┘
                    ↓
          mvn deploy
                    ↓
┌─────────────────────────────────────────────────────┐
│  a.jar 部署到远程仓库（私服或中央仓库）                  │
│  其他团队成员和服务器可以引用 A                         │
└─────────────────────────────────────────────────────┘
```

## site 生命周期——生成项目站点

```
pre-site → site → post-site → site-deploy
```

用于生成项目文档站点，通常配合 Maven Site 插件使用。

```bash
mvn site        # 生成站点到 target/site
mvn site:deploy  # 部署站点到服务器
```

结合 `maven-javadoc-plugin`、`maven-surefire-report-plugin` 可以自动生成 API 文档和测试报告。

## 阶段与插件目标的绑定

**Maven 的阶段本身不做事，它通过绑定插件目标来做事。**

```bash
mvn compile
# Maven 找到绑定到 compile 阶段的默认插件：
# maven-compiler-plugin:compile
```

你可以查看默认绑定：

```xml
<!-- pom.xml 中的默认插件配置 -->
<build>
    <plugins>
        <plugin>
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

### 手动绑定插件目标

```xml
<build>
    <plugins>
        <!-- 在 package 阶段生成源码 jar -->
        <plugin>
            <artifactId>maven-source-plugin</artifactId>
            <version>3.2.0</version>
            <executions>
                <execution>
                    <id>attach-sources</id>
                    <phase>package</phase>
                    <goals>
                        <goal>jar</goal>
                    </goals>
                </execution>
            </executions>
        </plugin>

        <!-- 在 verify 阶段运行 SonarQube 分析 -->
        <plugin>
            <groupId>org.sonarsource.scanner.maven</groupId>
            <artifactId>sonar-maven-plugin</artifactId>
            <version>3.9.1.2184</version>
            <executions>
                <execution>
                    <phase>verify</phase>
                    <goals>
                        <goal>sonar</goal>
                    </goals>
                </execution>
            </executions>
        </plugin>
    </plugins>
</build>
```

## 跳过某些阶段

```bash
# 跳过测试
mvn clean package -DskipTests

# 跳过测试编译和运行
mvn clean package -Dmaven.test.skip=true

# 跳过单元测试但运行集成测试
mvn verify -DskipUnitTests=true

# 跳过整个测试阶段（包括编译）
mvn clean install -Dmaven.test.skip=true
```

> `mvn test.skip=true` 跳过测试运行但会编译测试代码，`mvn test.skip` 等价。`maven.test.skip=true` 连测试代码都不编译。

## 面试高频问题

**问：mvn clean install 和 mvn install 有什么区别？**

答：`mvn clean install` 先执行 clean 生命周期删除 target 目录，再执行 default 生命周期完成 install。`mvn install` 只执行 install，不清理，可能导致旧文件残留导致构建不干净。建议日常开发用 `mvn clean install`，确保从零构建。

**问：Maven 的生命周期和插件是什么关系？**

答：生命周期定义了「构建的步骤顺序」，插件定义了「每个步骤具体做什么」。Maven 为常用功能提供了标准插件（如 maven-compiler-plugin、maven-surefire-plugin），你也可以自定义插件来实现特定功能。

**问：如何让某个插件绑定到多个阶段？**

答：通过多个 `<execution>` 块，每个 execution 绑定到不同的阶段：

```xml
<executions>
    <execution>
        <id>attach-sources</id>
        <phase>package</phase>
        <goals><goal>jar</goal></goals>
    </execution>
    <execution>
        <id>attach-javadoc</id>
        <phase>install</phase>
        <goals><goal>javadoc</goal></goals>
    </execution>
</executions>
```
