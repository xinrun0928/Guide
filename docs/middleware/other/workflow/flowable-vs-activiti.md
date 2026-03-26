# Flowable 与 Activiti 的历史渊源与主要区别

2016 年，一个叫「Flowable」的项目在 GitHub 上悄然出现。

很多人第一反应是：这是什么东西？怎么没听说过？

但对于老一批工作流开发者来说，这个名字背后，有一段精彩的故事——它涉及到一个开源社区的分裂，也涉及到技术理念的分歧。

这篇文章带你了解 Flowable 和 Activiti 的前世今生。

---

## 起源：共同的祖先 jBPM

故事要从 jBPM 说起。

2005 年，Tom Baeyens 创建了 jBPM（Java Business Process Management），这是最早的开源工作流引擎之一。

2010 年，Alfresco 公司主导了 jBPM 4 的 fork，创建了 Activiti。Tom Baeyens 本人也加入了 Alfresa，成为 Activiti 的核心开发者。

```
jBPM 3/4 (Tom Baeyens)
        │
        ├──→ Activiti 5 (Alfresco, 2010)
        │
        └──→ ...多年后...
            │
            └──→ Flowable (2016)
```

---

## 分裂：2016 年的转折

Activiti 5 发展了几年后，社区出现了一些问题：

**1. 核心开发者离开**

包括 Activiti 的核心架构师 Joram Barrez 在内的多位核心开发者相继离开 Alfresco。

**2. 方向分歧**

Alfresco 更关注企业级协作方向，而部分核心开发者认为 Activiti 应该专注于 BPMN 引擎本身。

**3. 社区治理问题**

开源社区对版本发布节奏、新功能开发方向等问题的反馈没有被充分采纳。

2016 年，以 Tom Baeyens 和 Joram Barrez 为首的原 Activiti 核心团队，fork 了 Activiti 6，创立了 Flowable。

---

## 技术架构对比

### 代码继承关系

```
Activiti 5/6 源码
        │
        ├──→ Flowable 6 (Tom Baeyens 团队 fork)
        │          │
        │          └──→ Flowable 6.x 持续维护
        │
        └──→ Activiti Cloud (Alfresco 新项目)
                   │
                   └──→ 发展不如预期
```

### 包名和命名空间

| 组件 | Activiti | Flowable |
|---|---|---|
| Maven GroupId | `org.activiti` | `org.flowable` |
| 包名前缀 | `org.activiti.*` | `org.flowable.*` |
| Spring Bean 前缀 | `activiti:*` | `flowable:*` |
| 数据库表前缀 | `ACT_RE_*`, `ACT_RU_*` | 相同 |
| REST API 路径 | `/activiti-rest/` | `/flowable-rest/` |

### 核心 API 对比

```java
// Activiti 5/6
ProcessEngine processEngine = ProcessEngines.getDefaultProcessEngine();
TaskService taskService = processEngine.getTaskService();

// Flowable 6
ProcessEngine processEngine = ProcessEngines.getDefaultProcessEngine();
TaskService taskService = processEngine.getTaskService();
```

API 几乎完全兼容——这也是为什么很多项目可以从 Activiti 迁移到 Flowable。

---

## 功能差异

### 引擎数量

| 引擎 | Activiti | Flowable |
|---|---|---|
| Process Engine (BPMN) | ✅ | ✅ |
| CMMN Engine | ❌ | ✅ |
| DMN Engine | ❌ | ✅ |
| Form Engine | ❌ | ✅ |
| Content Engine | ❌ | ✅ |
| App Engine | ❌ | ✅ |

这是最大的差异。Activiti 专注 BPMN，而 Flowable 提供了完整的数字化平台。

### 版本对应关系

| 时间 | Activiti | Flowable |
|---|---|---|
| 2016 | Activiti 6.0 | Flowable 6.0 (fork) |
| 2017 | Activiti 6.0.x | Flowable 6.1/6.2 |
| 2018 | Activiti 6.0.x | Flowable 6.3/6.4 |
| 2019 | Activiti Cloud | Flowable 6.5+ |
| 2020+ | 活跃度下降 | 持续活跃 |

### Spring Boot 支持

```yaml
# Activiti Spring Boot
<dependency>
    <groupId>org.activiti</groupId>
    <artifactId>activiti-spring-boot-starter</artifactId>
</dependency>

# Flowable Spring Boot
<dependency>
    <groupId>org.flowable</groupId>
    <artifactId>flowable-spring-boot-starter</artifactId>
</dependency>
```

Flowable 对 Spring Boot 的支持更完善，auto-configuration 更加成熟。

---

## 迁移指南

如果你想把项目从 Activiti 迁移到 Flowable：

### 1. Maven 依赖替换

```xml
<!-- 替换前（Activiti） -->
<dependency>
    <groupId>org.activiti</groupId>
    <artifactId>activiti-engine</artifactId>
    <version>6.0.0</version>
</dependency>

<!-- 替换后（Flowable） -->
<dependency>
    <groupId>org.flowable</groupId>
    <artifactId>flowable-engine</artifactId>
    <version>6.7.2</version>
</dependency>
```

### 2. 包名替换

大部分代码不需要修改，但需要注意：

```java
// Activiti
import org.activiti.engine.ProcessEngine;
import org.activiti.engine.TaskService;
import org.activiti.engine.delegate.DelegateExecution;

// Flowable
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.TaskService;
import org.flowable.engine.delegate.DelegateExecution;
```

### 3. Spring 配置替换

```java
// Activiti Spring 配置
@Bean
public ProcessEngineConfiguration processEngineConfiguration() {
    return SpringProcessEngineConfiguration.builder()
        .dataSource(dataSource)
        .build();
}

// Flowable Spring 配置
@Bean
public SpringProcessEngineConfiguration processEngineConfiguration() {
    return SpringProcessEngineConfiguration.builder()
        .dataSource(dataSource)
        // Flowable 特有配置
        .asyncExecutorActivate(true)
        .build();
}
```

### 4. 数据库迁移

Flowable 使用与 Activiti 相同的表结构前缀（`ACT_RE_*`, `ACT_RU_*`），可以直接复用数据库，但建议执行数据库升级脚本。

---

## 社区和生态

### 社区活跃度对比

| 指标 | Activiti | Flowable |
|---|---|---|
| GitHub Stars | ~10k | ~8k |
| 最新版本时间 | 2019 | 持续更新 |
| Stack Overflow 问题 | 较多 | 逐渐增加 |
| 文档更新 | 缓慢 | 活跃 |

### 企业采用

- **Activiti**：国内早期工作流项目使用较多，有一定存量
- **Flowable**：新项目选择更多，社区活跃度高

---

## 总结：如何选择？

| 场景 | 推荐 |
|---|---|
| 新项目，需求简单 | 都可以 |
| 需要 DMN/CMMN/表单 | Flowable |
| 已有 Activiti 项目 | 评估迁移成本后决定 |
| 重视社区活跃度 | Flowable |
| 团队习惯现有技术 | 保持现有 |

---

## 留给你的问题

假设你的公司已经有了一个基于 Activiti 5 的老系统，运行了 5 年，流程定义和数据库都非常稳定。

现在有两个选择：

1. 继续维护 Activiti 5（停止更新，有安全风险）
2. 迁移到 Flowable（需要测试、回归、重写部分代码）

你会怎么选？

这个问题没有标准答案，但它考验的是你对技术债务、迁移成本、长期规划的权衡能力。
