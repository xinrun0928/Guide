# 工作流引擎选型：Flowable vs Camunda vs Activiti

三年前你选了 Activiti 5，项目跑得好好的。

现在要新上一个系统，团队里有人推荐 Flowable，有人推荐 Camunda。

你陷入了纠结：这三个引擎到底有什么区别？选错了会不会踩坑？

这篇文章帮你彻底搞清楚。

---

## 先搞清楚历史：三个引擎的血缘关系

这三个引擎不是凭空出现的，它们有共同的前辈。

```
                    ┌─────────────┐
                    │   jBPM 3   │
                    │  (2005年)   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Activiti  │
                    │  (2010年)   │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
       ┌──────▼──────┐           ┌──────▼──────┐
       │  Flowable   │           │  Camunda    │
       │  (2016年)   │           │  (2013年)   │
       └─────────────┘           └─────────────┘
```

- **Activiti** 诞生于 jBPM 3/4 的基础上，由 Alfresco 公司主导
- **Flowable** 是 Activiti 的 fork，由原团队成员在 Activiti 核心成员离开后创建
- **Camunda** 起源于 BPMN 引擎（Apache Ozone 项目），与 Activiti 有部分代码交集，但核心是独立的

---

## 核心功能对比

### 功能完整性

| 功能 | Flowable | Camunda | Activiti |
|---|---|---|---|
| BPMN 2.0 引擎 | ✅ | ✅ | ✅ |
| DMN 决策引擎 | ✅ | ✅ | ❌ |
| CMMN 案例管理 | ✅ | ✅ | ❌ |
| 表单引擎 | ✅ | ✅ | ❌ |
| 内容/文件管理 | ✅ | ✅ | ❌ |
| 历史审计 | ✅ | ✅ | ⚠️ 基础 |
| 身份管理 | ✅ | ✅ | ⚠️ 需扩展 |

### 部署方式

| 特性 | Flowable | Camunda | Activiti |
|---|---|---|---|
| Spring Boot 集成 | ✅ 原生支持 | ✅ 原生支持 | ⚠️ 需要配置 |
| REST API | ✅ | ✅ | ✅ |
| Web UI | ✅ 多个应用 | ✅ Cockpit/Admin | ⚠️ 基础 |
| LDAP/SSO | ✅ 企业版 | ✅ | ❌ |
| 多租户 | ✅ | ✅ | ⚠️ 需扩展 |

---

## Flowable 特点

### 优势

**1. 功能最全面**

Flowable 是三者中功能最丰富的。它包含了 6 个引擎：
- Process Engine（流程引擎）
- CMMN Engine（案例管理引擎）
- DMN Engine（决策引擎）
- Form Engine（表单引擎）
- Content Engine（内容引擎）
- App Engine（应用引擎）

```java
// Flowable 的多引擎架构
ProcessEngine processEngine = ProcessEngines.getDefaultProcessEngine();
CmmnEngine cmmnEngine = CmmnEngineConfiguration
    .createCmmnEngineConfiguration()
    .buildCmmnEngine();
DmnEngine dmnEngine = DmnEngineConfiguration
    .createDmnEngineConfiguration()
    .buildDmnEngine();
```

**2. Spring Boot 支持最好**

Flowable 对 Spring Boot 的集成非常丝滑，auto-configuration 开箱即用。

```yaml
# Flowable Spring Boot 配置
flowable:
  async-executor-enabled: true
  database-schema-update: true
  # 禁用 UI（生产环境）
  flowable.app-ui.enabled: false
  # 禁用 REST API（可选）
  flowable.rest-api-enabled: false
```

**3. 开源版本功能完整**

Flowable 开源版本的功能已经非常完善，企业版主要是额外的 UI 和支持服务。

### 劣势

**1. 社区活跃度**

Flowable 虽然功能全，但社区相对 Camunda 较小，问题响应可能较慢。

**2. 学习曲线**

引擎多意味着学习内容多，对于只需要 BPMN 的场景，可能有点「杀鸡用牛刀」。

---

## Camunda 特点

### 优势

**1. 企业级特性完善**

Camunda 从一开始就是为企业级场景设计的：
- Cockpit（监控面板）功能强大
- Admin（管理后台）易用性好
- 支持 BPMN + DMN + CMMN
- 完整的任务分配策略

**2. 社区活跃**

Camunda 的社区非常活跃，文档质量高，问题解答及时。

**3. 流程监控强大**

Camunda Cockpit 是三者中最好的流程监控工具：
- 实时查看流程实例状态
- 拖拽式流程修复（修改流转方向）
- 历史数据可视化

```java
// Camunda 的流程监控集成
@RequiresProcessDefinition(key = "expenseApproval")
public class ExpenseService {
    
    @Inject
    private RuntimeService runtimeService;
    
    @Inject
    private HistoryService historyService;
    
    public void submitExpense(String businessKey, Map&lt;String, Object&gt; variables) {
        ProcessInstance instance = runtimeService
            .startProcessInstanceByKey("expenseApproval", businessKey, variables);
    }
}
```

### 劣势

**1. 许可证**

Camunda 使用 Apache License 2.0，但部分高级功能需要商业许可。

**2. 部署复杂度**

Camunda 的部署架构相对复杂，需要更多的运维配置。

---

## Activiti 特点

### 优势

**1. 资历老**

Activiti 是最早的现代开源工作流引擎之一，社区积累丰富。

**2. 轻量级**

Activiti 6 之后变得相对轻量，适合简单场景。

### 劣势

**1. 社区分裂**

Activiti 6 之后，原团队分裂出 Flowable，Activiti 社区活跃度下降。

**2. 功能相对少**

相比 Flowable 和 Camunda，Activiti 缺少 DMN、CMMN、表单等引擎。

**3. 维护不稳定**

Activiti Cloud 项目发展不如预期，版本更新不够稳定。

---

## 如何选择？

### 选择 Flowable 如果...

```
✅ 需要完整的业务数字化平台（BPMN + DMN + CMMN + Form）
✅ 使用 Spring Boot 项目，追求开箱即用
✅ 需要复杂表单与工作流的深度集成
✅ 希望在一个引擎内解决多种流程场景
```

### 选择 Camunda 如果...

```
✅ 企业级应用，需要强大的监控和运维能力
✅ 重视社区活跃度和文档质量
✅ 需要 BPMN + DMN，但不需要 CMMN
✅ 愿意投入时间配置和优化
```

### 选择 Activiti 如果...

```
✅ 项目已经有 Activiti 积累
✅ 只需要基础的 BPMN 功能
✅ 希望找一个轻量级解决方案
✅ 对新功能需求不多
```

---

## 技术选型决策树

```
你的场景需要哪些功能？
                    │
        ┌───────────┴───────────┐
        │                       │
     需要 DMN?               不需要 DMN
        │                       │
   ┌────┴────┐                  │
   │         │                  │
 Flowable  Camunda         Activiti
 (更全)    (更专)           或其他
```

---

## 性能对比

在标准 benchmark 测试中（模拟 1000 个并发用户）：

| 指标 | Flowable | Camunda | Activiti |
|---|---|---|---|
| 流程启动 QPS | ~5000 | ~4500 | ~3000 |
| 任务完成 QPS | ~4000 | ~3800 | ~2500 |
| 内存占用 | 中等 | 较高 | 较低 |
| 数据库存储 | 中等 | 较大 | 较小 |

> 数据来源：各引擎官方 benchmark，仅供参考，实际性能取决于硬件和业务复杂度。

---

## 总结对比

| 维度 | Flowable | Camunda | Activiti |
|---|---|---|---|
| **定位** | 数字化转型平台 | 企业级流程引擎 | 轻量级流程引擎 |
| **功能完整性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **学习曲线** | 陡峭 | 中等 | 平缓 |
| **社区活跃度** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **文档质量** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Spring Boot** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **监控运维** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **推荐场景** | 需要全功能 | 企业级应用 | 简单场景 |

---

## 留给你的问题

假设你的团队现在要用工作流引擎，但纠结于 Flowable 和 Camunda 之间。

老板说：「先选一个，后期如果不行再换。」

你同意这个决策方式吗？为什么工作流引擎选型比普通技术选型更难更换？

这个问题涉及到流程定义的迁移成本、历史数据的兼容性——都是换引擎时要考虑的大坑。
