# spring.factories vs AutoConfiguration.imports

Spring Boot 2.7 做了一个重大改变：**废弃了 `spring.factories`，引入了 `AutoConfiguration.imports`**。

如果你还在用旧的方式写 Starter，或者看到项目里同时存在两种配置文件，不知道该用哪个——这篇文章就是为你写的。

## 历史演变

```
Spring Boot 1.0 ~ 2.6：使用 META-INF/spring.factories
     ↓
Spring Boot 2.7：推荐使用 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
     ↓
Spring Boot 3.0+：完全移除 spring.factories，只支持 AutoConfiguration.imports
```

## 旧方式：spring.factories

### 文件位置

```
META-INF/
└── spring.factories
```

### 文件格式

```properties
# spring.factories 使用 properties 格式
# key 是接口/抽象类，value 是实现类列表（逗号分隔，换行用 \）

org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
com.example.autoconfigure.MyAutoConfiguration,\
com.example.autoconfigure.AnotherAutoConfiguration
```

### 存在的问题

1. **文件格式不直观**：所有配置挤在一行，可读性差
2. **无法排序**：多个 Starter 的配置混在一起，没有明确的加载顺序
3. **容易冲突**：不同 Starter 可能注册相同的配置类
4. **性能问题**：每次启动都要解析整个文件

## 新方式：AutoConfiguration.imports

### 文件位置

```
META-INF/
└── spring/
    └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

### 文件格式

```plaintext
# AutoConfiguration.imports 使用纯文本格式
# 每行一个类名，天然支持排序

com.example.autoconfigure.FirstAutoConfiguration
com.example.autoconfigure.SecondAutoConfiguration
com.example.autoconfigure.ThirdAutoConfiguration
```

### 优势

| 特性 | spring.factories | AutoConfiguration.imports |
|-----|-----|-----|
| **格式** | Properties | 纯文本 |
| **可读性** | 差（挤在一行） | 好（每行一个） |
| **排序** | 需要额外配置 | 直接按顺序写 |
| **性能** | 一般 | 更好 |
| **IDE 支持** | 有限 | 更好 |
| **Spring Boot 3.0+** | 不支持 | 必须使用 |

## 对比示例

### spring.factories（旧）

```properties
# META-INF/spring.factories
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
com.example.autoconfigure.FirstAutoConfiguration,\
com.example.autoconfigure.SecondAutoConfiguration
```

### AutoConfiguration.imports（新）

```plaintext
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.example.autoconfigure.FirstAutoConfiguration
com.example.autoconfigure.SecondAutoConfiguration
```

## 兼容性处理

Spring Boot 2.7 做了兼容性处理：**两种文件同时存在时，`AutoConfiguration.imports` 优先**。

```java
// Spring Boot 源码中的处理逻辑
private List<String> loadFromImports(AnnotationMetadata annotationMetadata) {
    // 1. 优先从 AutoConfiguration.imports 加载
    List<String> imports = loadAutoConfigurationImports();
    if (!imports.isEmpty()) {
        return imports;
    }
    
    // 2. 如果没有，fallback 到 spring.factories（Spring Boot 2.7 ~ 3.0）
    return loadSpringFactories(annotationMetadata);
}
```

但 Spring Boot 3.0 完全移除了对 `spring.factories` 的支持，**必须使用 `AutoConfiguration.imports`**。

## 迁移指南

如果你有一个使用 `spring.factories` 的 Starter，需要迁移到 `AutoConfiguration.imports`：

### 步骤一：创建新文件

```
src/main/resources/
└── META-INF/
    └── spring/
        └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

### 步骤二：复制配置类

把 `spring.factories` 中 `EnableAutoConfiguration` 下的所有类，复制到新文件中，每行一个：

```plaintext
# AutoConfiguration.imports
com.example.autoconfigure.FirstAutoConfiguration
com.example.autoconfigure.SecondAutoConfiguration
```

### 步骤三：删除旧文件（可选）

可以删除 `spring.factories`，也可以保留（用于兼容 Spring Boot 2.6 之前的版本）：

```java
// 判断是否需要保留 spring.factories
if (springBootVersion < 3.0) {
    // 可以保留 spring.factories
} else {
    // 必须使用 AutoConfiguration.imports
}
```

## 完整 Starter 目录结构

迁移后，一个完整的 Starter 应该有这样的结构：

```
my-starter/
├── pom.xml
└── src/main/resources/
    └── META-INF/
        └── spring/
            └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

旧结构（仍可保留用于兼容）：

```
my-starter/
├── pom.xml
└── src/main/resources/
    ├── META-INF/
    │   └── spring.factories          # 兼容 Spring Boot 2.6-
    └── META-INF/
        └── spring/
            └── org.springframework.boot.autoconfigure.AutoConfiguration.imports  # Spring Boot 2.7+
```

## spring.factories 其他用途

`spring.factories` 文件还有其他用途，这些在 Spring Boot 3.0 中也做了调整：

| 用途 | spring.factories key | 新方式 |
|-----|-----|-----|
| 自动配置 | `EnableAutoConfiguration` | `AutoConfiguration.imports` |
| 应用监听器 | `ApplicationListener` | 仍用 spring.factories 或 `@Bean` 注册 |
| 初始化器 | `ApplicationContextInitializer` | 仍用 spring.factories 或 `@Bean` 注册 |
| 错误页面 | `ErrorPageRegistrar` | `ErrorPageRegistry` SPI |

Spring Boot 3.0 对这些 SPI 机制的调整：

```
# 新的 SPI 文件位置
META-INF/
├── spring/
│   ├── org.springframework.boot.autoconfigure.AutoConfiguration.imports  # 自动配置
│   └── org.springframework.boot.autoconfigure.BeanFactoryPostProcessor.imports  # BeanFactoryPostProcessor
└── META-INF/services/  # Java SPI，仍然有效
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| 自动配置从哪里加载？ | spring.factories vs AutoConfiguration.imports |
| 两种文件同时存在时，谁的优先级高？ | 兼容性处理 |
| Spring Boot 3.0 有什么变化？ | 迁移理解 |
| 如何迁移旧 Starter 到新方式？ | 实践能力 |

---

> 如果你正在维护一个老 Starter，强烈建议升级到 `AutoConfiguration.imports`。这是 Spring Boot 官方推荐的方式，而且在 Spring Boot 3.0 之后是强制要求。
