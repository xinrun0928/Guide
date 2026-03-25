# Spring Cloud 与 Spring Boot 版本对应关系

> 很多人在引入 Spring Cloud 依赖时，第一个错误就是版本不兼容：Spring Boot 2.4 配了个 Spring Cloud 2020.0，然后启动报错。

这个问题很常见，但也很容易避免——只要搞清楚版本对应关系。

---

## 版本对应表（重要）

### Spring Cloud Alibaba 版本

| Spring Cloud Alibaba | Spring Cloud | Spring Boot |
|---|---|---|
| 2023.0.x.x | 2023.0.x | 3.2.x |
| 2022.0.x.x | 2022.0.x | 2.7.x ~ 3.0.x |
| 2021.0.x.x | 2020.0.x | 2.4.x ~ 2.6.x |

### Spring Cloud Netflix 版本

| Spring Cloud | Spring Boot |
|---|---|
| 2022.0.x | 2.7.x ~ 3.0.x |
| 2021.0.x | 2.4.x ~ 2.6.x |
| 2020.0.x | 2.3.x ~ 2.4.x |
| Hoxton.x | 2.2.x ~ 2.3.x |
| Greenwich.x | 2.1.x |
| Finchley.x | 2.0.x |

---

## 为什么版本对应这么重要

Spring Cloud 底层依赖 Spring Boot 的自动配置、条件注解等机制。如果版本不匹配，可能会出现：

1. **启动报错**：`Bean creation exception`、`UnsatisfiedDependencyException`
2. **功能缺失**：某些自动配置不生效
3. **运行时异常**：某些组件在运行时崩溃

举个例子：

```xml
<!-- Spring Boot 2.4 配 Spring Cloud 2020.0 -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.4.13</version>
</parent>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-dependencies</artifactId>
            <version>2020.0.4</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

这个组合**可以工作**，但不是最优组合。更好的选择是：

```xml
<!-- Spring Boot 2.6 配 Spring Cloud 2021.0.4 -->
<version>2.6.15</version>
<!-- 改为 -->
<version>2021.0.4</version>
```

---

## 快速查询工具

不想记表格？官方提供了两个工具：

### 1. Spring Initializr（推荐）

访问 https://start.spring.io/

选择 Spring Boot 版本后，页面会自动显示兼容的 Spring Cloud 版本。

### 2. 版本对照页面

官方维护了一份实时更新的对照表：

- https://spring.io/projects/spring-cloud#learn

---

## 实战配置模板

### Spring Cloud Alibaba 最新版（推荐）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.4</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>cloud-demo</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>17</java.version>
        <spring-cloud.version>2023.0.0</spring-cloud.version>
        <spring-cloud-alibaba.version>2023.0.1.2</spring-cloud-alibaba.version>
    </properties>

    <dependencyManagement>
        <dependencies>
            <!-- Spring Cloud -->
            <dependency>
                <groupId>org.springframework.cloud</groupId>
                <artifactId>spring-cloud-dependencies</artifactId>
                <version>${spring-cloud.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
            
            <!-- Spring Cloud Alibaba -->
            <dependency>
                <groupId>com.alibaba.cloud</groupId>
                <artifactId>spring-cloud-alibaba-dependencies</artifactId>
                <version>${spring-cloud-alibaba.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <dependencies>
        <!-- 服务注册与发现 -->
        <dependency>
            <groupId>com.alibaba.cloud</groupId>
            <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
        </dependency>
        
        <!-- 配置中心 -->
        <dependency>
            <groupId>com.alibaba.cloud</groupId>
            <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
        </dependency>
        
        <!-- OpenFeign -->
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-starter-openfeign</artifactId>
        </dependency>
        
        <!-- Gateway -->
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-starter-gateway</artifactId>
        </dependency>
    </dependencies>
</project>
```

---

## 升级注意事项

### 从 Spring Cloud 2020 升级到 2021

主要变化：

1. **Spring Boot 最低要求 2.4**
2. **bootstrap.yml 默认禁用**：需要在配置中开启

```yaml
# application.yml
spring:
  cloud:
    bootstrap:
      enabled: true
```

3. **Nacos 配置方式变化**：

```yaml
# 旧写法（Spring Cloud 2020）
spring:
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848

# 新写法（Spring Cloud 2021+）
spring:
  config:
    import: optional:nacos:${spring.application.name}
```

### 从 Spring Cloud 2022 升级到 2023

主要变化：

1. **Spring Boot 3.x 最低要求**
2. **Java 17 最低要求**
3. **部分 API 变更**：注意检查第三方组件兼容性

---

## 面试高频问题

### Q：为什么 Spring Cloud 要和 Spring Boot 版本对应？

A：Spring Cloud 基于 Spring Boot 的自动配置机制。不同版本的 Spring Boot 提供了不同的特性（如 Spring Boot 2.4 的 Config Import 机制），Spring Cloud 需要适配这些变化。

### Q：Spring Cloud Alibaba 和 Spring Cloud Netflix 能混用吗？

A：可以，但一般不推荐。混用会增加运维复杂度。除非有特殊需求，建议选择一个生态深耕。

### Q：老项目还在用 Spring Cloud Hoxton，能升级吗？

A：可以。需要按版本顺序逐步升级：Hoxton → 2020.0 → 2021.0 → 2022.0。每次升级后都要测试核心功能。

---

## 总结

版本选型的核心原则：

1. **新项目用最新版**：减少历史包袱
2. **老项目按顺序升级**：不要跨版本跳跃
3. **优先使用 Spring Cloud Alibaba**：文档活跃、国内支持好
4. **记住版本对应表**：面试常问

> 最好的做法：在项目初始化时，用 Spring Initializr 选择版本，避免手动配置出错的可能。
