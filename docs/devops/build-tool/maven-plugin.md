# Maven 插件机制：插件目标与生命周期绑定

Maven 本身不做事，它的所有功能都是通过**插件**来完成的。理解插件机制，是从「会用 Maven」到「精通 Maven」的关键一步。

## 插件的本质

Maven 插件本质上是一个或多个 **Goal（目标）** 的集合。每个 Goal 做一件具体的事。

```
maven-compiler-plugin
    ├── compile        ← 编译 Java 源码
    └── testCompile    ← 编译测试代码

maven-surefire-plugin
    └── test           ← 运行单元测试

maven-jar-plugin
    ├── jar            ← 打包 jar 文件
    └── test-jar       ← 打包测试 jar
```

当你执行 `mvn compile` 时，实际上是调用了 `maven-compiler-plugin` 的 `compile` goal。

## 插件坐标与普通依赖的区别

插件也是一种 Maven 构件，有自己的 GAV：

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>      <!-- 通常省略，使用默认值 -->
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.11.0</version>
    <configuration>
        <source>17</source>
        <target>17</target>
    </configuration>
</plugin>
```

**和依赖的区别**：
- 依赖：`dependencies` 标签，运行时需要
- 插件：`build > plugins` 标签，构建时需要

## 插件配置方式

### 方式一：通过命令行传参

```bash
# 指定 Java 版本
mvn compile -Dmaven.compiler.source=17 -Dmaven.compiler.target=17

# 跳过测试
mvn package -DskipTests
```

### 方式二：通过 pom.xml 配置

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
                <encoding>UTF-8</encoding>
                <fork>true</fork>
            </configuration>
        </plugin>
    </plugins>
</build>
```

### 方式三：通过 parent POM 继承

插件可以在父 POM 中配置，子 POM 自动继承：

```xml
<!-- 父 POM -->
<build>
    <pluginManagement>
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
    </pluginManagement>
</build>
```

`pluginManagement` 和 `plugins` 的区别：
- `pluginManagement`：只声明版本和默认配置，子项目需要显式引用才生效
- `plugins`：直接启用插件，所有子项目自动继承

## 常用核心插件

### maven-compiler-plugin——编译插件

```xml
<plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.11.0</version>
    <configuration>
        <source>17</source>
        <target>17</target>
        <encoding>UTF-8</encoding>
        <!-- 编译器 fork 出新进程 -->
        <fork>true</fork>
        <!-- javac 的最大堆内存 -->
        <maxmem>512m</maxmem>
    </configuration>
</plugin>
```

### maven-surefire-plugin——测试插件

```xml
<plugin>
    <artifactId>maven-surefire-plugin</artifactId>
    <version>3.0.0</version>
    <configuration>
        <!-- 跳过测试 -->
        <skipTests>false</skipTests>
        <!-- 测试失败后继续运行 -->
        <testFailureIgnore>false</testFailureIgnore>
        <!-- 并行运行测试 -->
        <parallel>methods</parallel>
        <threadCount>4</threadCount>
        <!-- 生成测试覆盖率报告 -->
        <properties>
            <property>
                <name>listener</name>
                <value>com.puppycrawl.tools.checkstyle.ant.AntListener</value>
            </property>
        </properties>
    </configuration>
</plugin>
```

### maven-jar-plugin——打包插件

```xml
<plugin>
    <artifactId>maven-jar-plugin</artifactId>
    <version>3.3.0</version>
    <configuration>
        <archive>
            <manifest>
                <!-- 启动类 -->
                <mainClass>com.example.Application</mainClass>
                <!-- 添加 Class-Path -->
                <addClasspath>true</addClasspath>
                <classpathPrefix>lib/</classpathPrefix>
            </manifest>
        </archive>
    </configuration>
</plugin>
```

### maven-shade-plugin——打包可执行 JAR

当需要打包一个包含所有依赖的「fat jar」时（Spring Boot 默认用这个）：

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-shade-plugin</artifactId>
    <version>3.5.0</version>
    <executions>
        <execution>
            <phase>package</phase>
            <goals>
                <goal>shade</goal>
            </goals>
            <configuration>
                <transformers>
                    <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
                        <mainClass>com.example.Application</mainClass>
                    </transformer>
                    <!-- 解决 META-INF/services 冲突 -->
                    <transformer implementation="org.apache.maven.plugins.shade.resource.ServicesResourceTransformer"/>
                </transformers>
            </configuration>
        </execution>
    </executions>
</plugin>
```

### maven-source-plugin——源码打包插件

```xml
<plugin>
    <artifactId>maven-source-plugin</artifactId>
    <version>3.2.0</version>
    <executions>
        <execution>
            <id>attach-sources</id>
            <phase>package</phase>
            <goals>
                <goal>jar-no-fork</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

## 插件目标的手动调用

除了绑定到生命周期，你也可以直接调用插件目标：

```bash
# 直接运行测试（跳过其他阶段）
mvn surefire:test

# 查看 effective-pom
mvn help:effective-pom

# 查看项目依赖树
mvn dependency:tree

# 分析未使用和未声明的依赖
mvn dependency:analyze

# 复制依赖到指定目录
mvn dependency:copy-dependencies -DoutputDirectory=target/lib

# 验证插件版本
mvn versions:display-plugin-updates

# 清理本地仓库缓存
mvn dependency:purge-local-repository
```

## execution 的精细控制

```xml
<plugin>
    <artifactId>maven-antrun-plugin</artifactId>
    <version>3.1.0</version>
    <executions>
        <!-- execution 1：在 compile 阶段执行 -->
        <execution>
            <id>clean-target</id>
            <phase>clean</phase>
            <goals>
                <goal>run</goal>
            </goals>
            <configuration>
                <target>
                    <echo message="清理构建目录"/>
                </target>
            </configuration>
        </execution>

        <!-- execution 2：在 package 阶段执行 -->
        <execution>
            <id>package-info</id>
            <phase>package</phase>
            <goals>
                <goal>run</goal>
            </goals>
            <configuration>
                <target>
                    <echo message="打包完成，准备发布"/>
                </target>
            </configuration>
        </execution>
    </executions>
</plugin>
```

## 继承 vs 聚合中插件的配置

### 继承模式（父 POM）

父 POM 中使用 `pluginManagement`：

```xml
<!-- 父 pom.xml -->
<build>
    <pluginManagement>
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
    </pluginManagement>
</build>

<!-- 子 pom.xml 只引用，继承版本和配置 -->
<build>
    <plugins>
        <plugin>
            <artifactId>maven-compiler-plugin</artifactId>
            <!-- 版本和配置都继承自父 POM -->
        </plugin>
    </plugins>
</build>
```

### 聚合模式（多模块）

在父 POM 的 `plugins` 中直接配置，所有子模块自动应用：

```xml
<!-- 父 pom.xml -->
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

<!-- 子模块自动继承插件配置 -->
```

## 面试高频问题

**问：maven-compiler-plugin 的 fork 参数有什么用？**

答：`fork=true` 时，编译器会 fork出一个新进程来执行 javac，好处是可以独立设置 JVM 参数（如 `-Xmx512m`）。当编译占用内存很大时，需要开启 fork，否则可能 OOM。

**问：插件的 execution id 有什么用？**

答：主要用于标识同一个插件的多个 execution。相同插件的相同 goal 可以绑定到不同的阶段，通过 id 区分。当 `mvn <plugin>:goal` 带上 execution id 时，可以只运行特定的 execution。

**问：如何查找 Maven 插件的用法？**

答：官方插件文档在 `https://maven.apache.org/plugins/<plugin-name>/`。也可以直接 `mvn <plugin>:help` 查看所有 goal 和参数。
