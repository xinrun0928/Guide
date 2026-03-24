# Maven 依赖传递与依赖冲突解决

你有没有遇到过这种情况：项目里明明只引了一个依赖，却莫名其妙多了十几个「我没加的 JAR」？这就是**依赖传递**在起作用。

## 依赖传递（Transitive Dependencies）

Maven 的依赖传递是指：当引入 A 依赖时，A 依赖自己的依赖（B、C）也会被自动引入。

```
项目 → 引入 spring-boot-starter-web:3.2.0
    ↓
自动引入：
    spring-boot-starter:3.2.0
        ↓
    spring-boot:3.2.0
        ↓
    spring-context:6.1.0
        ↓
    spring-beans:6.1.0
    spring-aop:6.1.0
        ↓
    ...（更多传递依赖）
```

这就是为什么一个简单的 Spring Boot 项目，依赖树可能有上百个构件。

### 可视化查看依赖树

```bash
# 查看完整依赖树
mvn dependency:tree

# 过滤只看特定依赖
mvn dependency:tree -Dincludes=com.alibaba:fastjson

# 输出到文件
mvn dependency:tree > dependency-tree.txt
```

### 排除特定传递依赖

如果传递进来的某个依赖版本不对，需要排除：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <!-- 排除 spring-boot-starter 中的某个传递依赖 -->
        <exclusion>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

> **注意**：排除后，如果其他依赖也依赖这个被排除的构件，并且那个版本也不兼容，就会出问题。需要单独再声明一个兼容版本。

## 依赖冲突

当两个直接依赖引入同一个构件的不同版本时，冲突就产生了。

### 冲突场景示例

```
项目直接依赖 A:1.0
项目直接依赖 B:2.0
    ↓
A:1.0 依赖 C:1.0
B:2.0 依赖 C:1.5
    ↓
C 应该用哪个版本？→ 依赖冲突！
```

### Maven 解决冲突：依赖调解原则

Maven 使用两个原则来解决冲突：

**原则一：最短路径优先（Nearest Definition）**

选择依赖路径最短的版本。

```
项目 → A:1.0 → C:1.5        （路径长度 2）
项目 → B:2.0 → C:1.0        （路径长度 2）

路径相同？用谁先声明的？
```

**原则二：第一声明优先（First Declaration）**

当路径长度相同时，选择 pom.xml 中**先声明**的那个版本。

```xml
<!-- A 先声明，所以 C:1.0 被选中 -->
<dependencies>
    <dependency>
        <groupId>com.example</groupId>
        <artifactId>A</artifactId>
        <version>1.0</version>
    </dependency>
    <!-- 虽然 B 也带 C:1.5，但 C:1.0 已经被 A 选中了 -->
    <dependency>
        <groupId>com.example</groupId>
        <artifactId>B</artifactId>
        <version>2.0</version>
    </dependency>
</dependencies>
```

### 依赖调解的局限性

依赖调解是 Maven 自动做的，你无法精细控制。更精确的版本控制需要借助 `dependencyManagement`。

## 依赖分析与问题排查

### 查看冲突

```bash
# 分析依赖冲突（高亮显示冲突）
mvn dependency:analyze

# 输出示例
[WARNING] Used undeclared dependencies found:
[WARNING]    org.apache.commons:commons-lang3:jar:3.12.0:compile
[WARNING] Unused declared dependencies found:
[WARNING]    org.springframework.boot:spring-boot-starter-test:jar:3.2.0:test
```

- **Used undeclared dependencies**：代码用到了，但没有直接声明（通过传递依赖引入的）
- **Unused declared dependencies**：声明了但代码没用到的依赖

### 查看特定依赖的所有版本来源

```bash
mvn dependency:tree -Dverbose | grep fastjson
```

### effective-pom：查看最终的 POM

```bash
# 查看 Maven 计算后的完整 POM（包含父 POM 的所有配置）
mvn help:effective-pom
```

## dependencyManagement 的正确用法

这是解决依赖版本冲突的标准做法。

### 父 POM 中定义版本

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.alibaba</groupId>
            <artifactId>fastjson</artifactId>
            <version>2.0.0</version>
        </dependency>
        <dependency>
            <groupId>org.apache.commons</groupId>
            <artifactId>commons-lang3</artifactId>
            <version>3.12.0</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

### 子 POM 中只声明，不写版本

```xml
<dependencies>
    <!-- 不写 version，Maven 会从 dependencyManagement 中查找版本 -->
    <dependency>
        <groupId>com.alibaba</groupId>
        <artifactId>fastjson</artifactId>
    </dependency>
    <dependency>
        <groupId>org.apache.commons</groupId>
        <artifactId>commons-lang3</artifactId>
    </dependency>
</dependencies>
```

这样做的好处：

1. **版本统一管理**：所有子模块使用相同的依赖版本
2. **显式声明**：子模块明确知道自己依赖了哪些构件
3. **避免冲突**：子模块不需要关心版本号，由父 POM 统一控制

## 实战：解决一个真实的依赖冲突

场景：项目同时使用 Spring Boot 2.7 和 Elasticsearch 7.x，ES 的 Jackson 版本和 Spring Boot 的 Jackson 版本冲突。

**排查步骤：**

```bash
# 1. 查看 Jackson 相关的依赖树
mvn dependency:tree | grep jackson

# 2. 找到所有引入 jackson-databind 的路径
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core:jackson-databind

# 3. 确认冲突版本
# spring-boot-starter:2.7.0 → jackson-databind:2.13.x
# elasticsearch:7.17.0 → jackson-databind:2.12.x
# 冲突！

# 4. 在 dependencyManagement 中锁定版本
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-bom</artifactId>
            <version>2.13.5</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

## 面试高频问题

**问：依赖传递有什么副作用？**

答：最大的副作用是**引入不可控的传递依赖**。你声明一个 A，Maven 可能引入了几十个你不知道的传递依赖，这些依赖的版本可能包含安全漏洞或与你直接声明的其他依赖冲突。所以生产项目应该定期 `mvn dependency:analyze` 并清理无用依赖。

**问：怎么确保依赖版本的稳定性？**

答：两种方式。方式一是在父 POM 中使用 `dependencyManagement` 统一管理版本。方式二是使用 BOM（Bill of Materials），通过 `spring-boot-dependencies` 或自定义 BOM 导入一组经过测试的依赖版本组合。
