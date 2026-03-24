# 构建产物管理：FatJar、Shade、Shadow、Spring Boot Jar 包结构

「代码只有几 MB，为什么打出来的 JAR 有 50 MB？」——理解打包产物，是排查部署问题的关键。

## JAR 的基本概念

### 普通 JAR vs Fat JAR（Uber JAR）

```
普通 JAR：
├── my-app.jar
│   └── com/example/
│       └── App.class          ← 只有你的代码
│
└── 依赖在运行时从 classpath 加载
    classpath: spring.jar + hibernate.jar + my-app.jar

Fat JAR（Uber JAR）：
├── my-app-fat.jar
│   ├── BOOT-INF/
│   │   ├── classes/           ← 你的代码
│   │   └── lib/               ← 所有依赖
│   └── org/springframework/   ← Spring Boot Loader
│
└── 依赖全部打包在一起，单独一个 JAR 就能运行
```

## Maven 打包方式

### maven-jar-plugin——普通 JAR

```xml
<plugin>
    <artifactId>maven-jar-plugin</artifactId>
    <version>3.3.0</version>
    <configuration>
        <archive>
            <manifest>
                <mainClass>com.example.Application</mainClass>
                <addClasspath>true</addClasspath>
                <classpathPrefix>lib/</classpathPrefix>
            </manifest>
        </archive>
    </configuration>
</plugin>
```

### maven-shade-plugin——打包 Fat JAR

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
                    <!-- Spring Boot 的 Main-Class 声明 -->
                    <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
                        <mainClass>com.example.Application</mainClass>
                    </transformer>
                    <!-- 合并 META-INF/services（解决 SPI 冲突） -->
                    <transformer implementation="org.apache.maven.plugins.shade.resource.ServicesResourceTransformer"/>
                    <!-- 合并 META-INF/*.SF -->
                    <transformer implementation="org.apache.maven.plugins.shade.resource.DontIncludeResourceTransformer">
                        <resource>MANIFEST.MF</resource>
                    </transformer>
                </transformers>
                <!-- 排除签名文件 -->
                <filters>
                    <filter>
                        <artifact>*:*</artifact>
                        <excludes>
                            <exclude>META-INF/*.SF</exclude>
                            <exclude>META-INF/*.DSA</exclude>
                            <exclude>META-INF/*.RSA</exclude>
                        </excludes>
                    </filter>
                </filters>
            </configuration>
        </execution>
    </executions>
</plugin>
```

### Spring Boot Maven Plugin——打包 Spring Boot JAR

Spring Boot 2.x 使用 repackaging 方式：

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <version>3.2.0</version>
    <executions>
        <execution>
            <goals>
                <goal>repackage</goal>  <!-- 将普通 JAR 重新打包为 Spring Boot JAR -->
            </goals>
        </execution>
    </executions>
    <configuration>
        <mainClass>com.example.Application</mainClass>
        <!-- 打包时排除特定依赖 -->
        <excludeDevtools>true</excludeDevtools>
    </configuration>
</plugin>
```

## Spring Boot JAR 结构

Spring Boot 打包后的 JAR 包含以下结构：

```
my-app-1.0.0.jar
│
├── org/
│   └── springframework/
│       └── boot/
│           └── loader/
│               ├── JarLauncher.class      ← 启动器
│               ├── MainLauncher.class
│               └── ...
│
├── BOOT-INF/
│   ├── classes/                           ← 应用程序代码和资源
│   │   └── com/example/
│   │       └── Application.class
│   │
│   ├── lib/                              ← 所有依赖 JAR
│   │   ├── spring-boot-3.2.0.jar
│   │   ├── spring-core-6.1.0.jar
│   │   ├── tomcat-embed-core-10.1.0.jar
│   │   └── ...
│   │
│   └── classpath.idx                     ← 类路径索引（加速启动）
│
└── META-INF/
    └── MANIFEST.MF
        Manifest-Version: 1.0
        Spring-Boot-Classpath-Index: BOOT-INF/classpath.idx
        Spring-Boot-Classes: BOOT-INF/classes/
        Spring-Boot-Lib: BOOT-INF/lib/
        Start-Class: com.example.Application
        Spring-Boot-Application-Index-Class: com.example.Application
```

### Spring Boot JAR 的启动原理

```bash
java -jar my-app-1.0.0.jar
```

启动过程：

```
1. Java 读取 MANIFEST.MF，找到 Main-Class: JarLauncher
2. JarLauncher 加载 BOOT-INF/lib/ 下所有 JAR
3. JarLauncher 创建新的 ClassLoader（LaunchedURLClassLoader）
4. LaunchedURLClassLoader 加载 BOOT-INF/classes/ 中的应用程序类
5. 反射调用 Start-Class: com.example.Application
```

## Gradle 打包方式

### bootJar（Spring Boot 插件）

```groovy
plugins {
    id 'org.springframework.boot' version '3.2.0'
}

bootJar {
    // 排除某个依赖
    entries {
        exclude(entry -> entry.name.startsWith('logback-'))
    }
    // 归档文件名
    archiveFileName = "${project.name}.jar"
}
```

### shadowJar（第三方 Fat JAR）

```groovy
plugins {
    id 'com.github.johnrengelman.shadow' version '8.1.1'
}

shadowJar {
    archiveFileName = "${project.name}-fat.jar"
    mergeServiceFiles()
    exclude 'META-INF/*.SF', 'META-INF/*.DSA', 'META-INF/*.RSA'
    // 包含或排除特定文件
    exclude 'org/codehaus/janino/**'
}
```

## 构建产物选择策略

| 场景 | 打包方式 | 说明 |
|------|---------|------|
| Spring Boot 应用 | Spring Boot Maven Plugin / bootJar | 最推荐，官方支持 |
| 非 Spring 应用，需要独立运行 | maven-shade-plugin / shadowJar | 打包所有依赖 |
| 类库（供其他项目依赖） | maven-jar-plugin / jar | 不打包依赖，让使用者自行引入 |
| 需要分发 JAR 给外部使用 | maven-source-plugin + javadoc | 同时提供源码和文档 |

## 优化构建产物大小

### 排除不必要的依赖

```groovy
// Gradle
bootJar {
    // 排除可选依赖
    exclude { details ->
        details.requestedArtifact.group == 'org.springframework.boot'
        && details.requestedArtifact.name.startsWith('spring-boot-starter-logging')
    }
}
```

### 使用分层打包（Layered JAR）

Spring Boot 3.1+ 支持分层 JAR：

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <configuration>
        <layers>
            <enabled>true</enabled>
        </layers>
    </configuration>
</plugin>
```

分层后，可以通过 Docker 的多阶段构建只更新变化的层，加速部署。

### Maven 多阶段构建

```dockerfile
# 阶段一：构建
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

# 阶段二：运行
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /app/target/my-app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

## 常见问题

### 问题一：Spring Boot JAR 无法在 `java -jar` 下运行

检查 MANIFEST.MF 中是否有 `Spring-Boot-Application-Index-Class` 或 `Start-Class` 属性。

### 问题二：Fat JAR 中出现多个同名类（ClassNotFoundException）

通常是因为多个 JAR 中包含了相同的类（如 SLF4J 绑定冲突）。使用 shade 插件的 `<filters>` 和 `ServicesResourceTransformer` 可以缓解。

### 问题三：Spring Boot JAR 在 Docker 镜像中很大

使用 Spring Boot 3 的 AOT（Ahead-of-Time）编译和 GraalVM 原生镜像，可以大幅减小镜像体积。

## 面试高频问题

**问：Spring Boot JAR 和普通 Fat JAR 有什么区别？**

答：Spring Boot JAR 使用的是 repackaging 方式，结构是 `BOOT-INF/` 而非把所有类混在一起。它的核心优势是支持嵌套 JAR（`BOOT-INF/lib/` 中的依赖以 JAR 形式存在），而不是解压后的 class 文件。这样做的好处是：依赖 JAR 可以被 Spring Boot 的 ClassLoader 独立加载，支持依赖覆盖和可选依赖。而 shade 插件会把所有 class 混在一起，无法进行细粒度的依赖管理。

**问：Spring Boot 的 layered jar 解决了什么问题？**

答：解决了 Docker 镜像层缓存的问题。在传统打包方式中，更新应用代码会导致整个 JAR 被替换，所有 Docker 层都需要重新构建。使用分层 JAR 后，可以把依赖层和代码层分开，只有代码层变化时才重建，减少了构建时间和镜像大小。
