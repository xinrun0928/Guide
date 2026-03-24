# Maven 常用命令

Maven 命令看似简单，但高级用法才是区分会用和精通的关键。

## 基础命令

### 最常用的五个命令

```bash
mvn clean install          # 清理并构建所有模块（常用）
mvn clean package          # 清理并打包（不安装到本地仓库）
mvn clean deploy           # 清理并发布到远程仓库
mvn clean test             # 清理并运行所有测试
mvn clean verify           # 清理并验证包是否有效
```

### 跳过测试

```bash
mvn clean install -DskipTests          # 跳过测试运行（但编译测试代码）
mvn clean install -Dmaven.test.skip=true  # 跳过测试编译和运行
mvn clean install -DskipTests -DfailIfNoTests=false  # 跳过测试但不报错
```

## 依赖相关命令

### 查看依赖树

```bash
# 查看完整依赖树
mvn dependency:tree

# 只看某个依赖及其传递依赖
mvn dependency:tree -Dincludes=com.alibaba:fastjson

# 排除某个依赖的传递依赖
mvn dependency:tree -Dexcludes=org.springframework:spring-core

# 查看详细的版本冲突
mvn dependency:tree -Dverbose
```

### 依赖分析

```bash
# 分析未使用和未声明的依赖
mvn dependency:analyze

# 输出示例
[WARNING] Used undeclared dependencies found:
[WARNING]    org.apache.commons:commons-lang3:jar:3.12.0:compile
[WARNING] Unused declared dependencies found:
[WARNING]    org.springframework.boot:spring-boot-starter-test:jar:3.2.0:test
```

### 复制依赖到指定目录

```bash
# 将所有依赖复制到 target/lib
mvn dependency:copy-dependencies -DoutputDirectory=target/lib

# 包含 scope 为 provided 的依赖
mvn dependency:copy-dependencies -DincludeScope=compile -DoutputDirectory=target/lib
```

### 查看依赖解析过程

```bash
# 解释依赖是如何被选中的
mvn dependency:resolve -Dverbose
```

## 插件相关命令

### 常用插件调用

```bash
# 查看 effective-pom（合并父 POM 后的完整 POM）
mvn help:effective-pom

# 查看 Maven 版本和配置信息
mvn -version
mvn help:system

# 查看插件的帮助信息
mvn compiler:help
mvn surefire:help -Dgoal=test -Ddetail

# 生成项目站点
mvn site

# 验证插件版本是否有更新
mvn versions:display-plugin-updates

# 检查依赖版本更新
mvn versions:display-dependency-updates
```

### Maven Helper 插件

当 pom.xml 出现依赖冲突时，可以使用 Maven Helper 插件的 `mvn dependency:analyze-only`：

```bash
mvn dependency:analyze-only
```

## 多模块项目命令

```bash
# 构建所有模块
mvn clean install

# 只构建指定模块（不构建其依赖）
mvn clean install -pl module-a

# 构建指定模块及其所有依赖
mvn clean install -pl module-c -am

# 构建指定模块，排除某些模块
mvn clean install -pl '!module-b'

# 指定多个模块
mvn clean install -pl module-a,module-b

# 并行构建所有模块（加快速度）
mvn clean install -T 1C       # 1C 表示每个 CPU 核心一个线程
mvn clean install -T 4        # 固定 4 个线程
```

## Profile 相关命令

```bash
# 查看所有可用的 profile
mvn help:active-profiles

# 激活指定 profile
mvn clean package -Pdev
mvn clean package -Pdev,prod  # 激活多个 profile

# 禁用某个 profile
mvn clean package -P '!prod'
```

## 构建输出相关

```bash
# 输出详细日志
mvn clean install -X          # 开启 debug 模式
mvn clean install -e          # 显示错误堆栈

# 将日志输出到文件
mvn clean install > build.log 2>&1

# 只输出警告和错误
mvn clean install -q          # quiet 模式
```

## 常用参数组合

### 日常开发

```bash
# 快速构建，跳过测试
mvn clean install -DskipTests

# 带日志输出
mvn clean install -DskipTests | tee build.log
```

### CI/CD 构建

```bash
# 完整构建，带测试，带签名
mvn clean verify

# 发布到远程仓库
mvn clean deploy -Pprod

# SonarQube 代码分析
mvn clean verify sonar:sonar
```

### 排查问题

```bash
# 查看完整的依赖解析过程
mvn clean install -X -DskipTests > debug.log 2>&1

# 查看哪些依赖导致了冲突
mvn dependency:tree -Dverbose | grep "omitted for conflict"
```

## settings.xml 常用配置

```xml
<!-- ~/.m2/settings.xml -->

<!-- 本地仓库路径 -->
<localRepository>/path/to/local/repo</localRepository>

<!-- 私服认证 -->
<servers>
    <server>
        <id>nexus-releases</id>
        <username>admin</username>
        <password>admin123</password>
    </server>
</servers>

<!-- 镜像配置 -->
<mirrors>
    <mirror>
        <id>aliyun</id>
        <mirrorOf>*</mirrorOf>
        <url>https://maven.aliyun.com/repository/public</url>
    </mirror>
</mirrors>

<!-- JDK 版本 -->
<profiles>
    <profile>
        <id>jdk-17</id>
        <activation>
            <activeByDefault>true</activeByDefault>
            <jdk>17</jdk>
        </activation>
        <properties>
            <maven.compiler.source>17</maven.compiler.source>
            <maven.compiler.target>17</maven.compiler.target>
            <maven.compiler.compilerVersion>17</maven.compiler.compilerVersion>
        </properties>
    </profile>
</profiles>
```

## 面试高频问题

**问：mvn install 和 mvn package 的区别是什么？**

答：`mvn package` 只打包到项目的 `target` 目录，不会安装到本地仓库。`mvn install` 会在 `package` 的基础上，把构建产物安装到本地仓库（`~/.m2/repository`），供其他本地项目作为依赖使用。`mvn deploy` 则更进一步，会把产物部署到远程仓库。

**问：mvn -T 1C 和 mvn -T 4 有什么区别？**

答：`-T 1C` 表示根据 CPU 核心数动态计算并行线程数，`-T 4` 表示固定 4 个并行线程。多模块项目中，并行构建可以大幅缩短构建时间，但需要注意模块间的依赖关系——Maven 会自动解析依赖顺序。

**问：mvn dependency:tree 和 mvn dependency:list 有什么区别？**

答：`tree` 以树形结构展示依赖及其传递依赖，直观但可能很长。`list` 以列表形式展示去重后的依赖，简洁但不显示依赖路径。两者结合使用效果最好——先用 `list` 看大概，再用 `tree` 追查特定依赖的来源。
