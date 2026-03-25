# Flowable 网关：排他网关、并行网关、包容网关、事件网关

网关是 BPMN 中最「烧脑」的部分。

很多人学 BPMN 学了半天，网关始终是最大的拦路虎。排他网关、并行网关、包容网关、事件网关……名字听起来差不多，到底什么时候用哪个？

这篇文章用最直白的方式，把四种网关讲透。

---

## 网关的本质

**网关是用来做「分流」和「合流」的。**

```
分流：一条路变成多条路
┌─────────┐
│  起点   │
└────┬────┘
     │ ← 这里可能需要网关
   ┌─┴─┐
   │   │
   ▼   ▼
  A    B  ← 变成多条路

合流：多条路变成一条路
   ┌─┬─┐
   │ │ │
   ▼ │ ▼
  A  │  B
   │ │
   └─┬┘
     │ ← 这里可能需要网关
┌────┴────┐
│   终点  │
         ← 变回一条路
```

---

## 排他网关（Exclusive Gateway）

### 什么时候用？

**只会选择一条分支执行。** 当你需要根据条件选择其中一条路走的时候。

### 场景

报销金额判断：
- 金额 > 10000，走高管审批
- 金额 <= 10000，走主管审批

```
                    ┌─────────┐
                    │  金额判断  │
                    │    (×)   │ ← 排他网关
                    └────┬────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            │            ▼
        [金额>10000?]    │    [金额≤10000?]
            │            │            │
            ▼            │            ▼
        高管审批         │        主管审批
            │            │            │
            └────────────┼────────────┘
                         │
                         ▼
                    财务复核
```

### BPMN 定义

```xml
<!-- 分支网关：分流 -->
<exclusiveGateway id="amountCheckGateway" name="金额判断"/>

<!-- 流向 -->
<sequenceFlow id="flow1" sourceRef="amountCheckGateway" targetRef="executiveReview">
    <conditionExpression>${amount > 10000}</conditionExpression>
</sequenceFlow>
<sequenceFlow id="flow2" sourceRef="amountCheckGateway" targetRef="directorReview">
    <conditionExpression>${amount &lt;= 10000}</conditionExpression>
</sequenceFlow>

<!-- 合并网关：合流 -->
<exclusiveGateway id="mergeGateway" name="合并"/>

<sequenceFlow sourceRef="executiveReview" targetRef="mergeGateway"/>
<sequenceFlow sourceRef="directorReview" targetRef="mergeGateway"/>
```

### 关键规则

**排他网关只选择第一个条件为真的分支！**

```java
// 如果这样写：
flow1: ${amount > 0}    // 条件1：金额 > 0
flow2: ${amount > 100} // 条件2：金额 > 100

// 当 amount = 1000 时，两个条件都为真
// 但排他网关只会选 flow1，不会选 flow2
```

**因此，排他网关的条件必须有互斥性：**

```java
// ✅ 正确：互斥条件
${amount > 10000}
${amount <= 10000}

// ❌ 错误：重叠条件
${amount > 5000}
${amount > 10000}

// ✅ 正确：使用 else 默认流
${approvalResult == 'approved'}
<!-- 没有 else 的分支，所有条件都不满足时走默认流 -->
<sequenceFlow id="defaultFlow" sourceRef="gateway" targetRef="defaultNode">
    <conditionExpression xsi:type="tFormalExpression">${false}</conditionExpression>
</sequenceFlow>
```

---

## 并行网关（Parallel Gateway）

### 什么时候用？

**所有分支同时执行。** 当你需要多个步骤同时进行的时候。

### 场景

员工入职手续：
- 同时办理工牌
- 同时开通邮箱
- 同时分配工位

这三个步骤没有先后依赖，可以并行进行。

```
┌─────────┐
│ 开始    │
└────┬────┘
     │
     │ + ← 并行网关（分支）
     ├─────────────────┐
     │                 │
     ▼                 ▼
  办理工牌          开通邮箱
     │                 │
     │                 │
     ├─────────────────┤
     │ + ← 并行网关（合并）
     ▼
  分配工位
     │
     ▼
   结束
```

### BPMN 定义

```xml
<!-- 并行分支网关 -->
<parallelGateway id="startParallelGateway" name="并行开始"/>

<!-- 三个并行分支 -->
<sequenceFlow sourceRef="startParallelGateway" targetRef="createBadge"/>
<sequenceFlow sourceRef="startParallelGateway" targetRef="createEmail"/>
<sequenceFlow sourceRef="startParallelGateway" targetRef="assignDesk"/>

<!-- 并行合并网关 -->
<parallelGateway id="endParallelGateway" name="并行结束"/>

<!-- 汇聚 -->
<sequenceFlow sourceRef="createBadge" targetRef="endParallelGateway"/>
<sequenceFlow sourceRef="createEmail" targetRef="endParallelGateway"/>
<sequenceFlow sourceRef="assignDesk" targetRef="endParallelGateway"/>
```

### 关键规则

**并行网关的汇聚规则：必须所有分支都到达，网关才会打开。**

```
场景：3 个并行分支

时间线：
- t1: 办理工牌完成
- t2: 开通邮箱完成
- t3: 分配工位完成

t1: 只有工牌完成，网关等待...
t2: 工牌+邮箱完成，继续等待...
t3: 全部完成，网关打开，流程继续 ↓
```

```java
// 代码中如何验证
@Test
public void parallelGatewayTest() {
    // 启动流程
    runtimeService.startProcessInstanceByKey("onboardingProcess");
    
    // 查询当前状态
    // 应该看到 3 个并行任务同时存在
    List&lt;Task&gt; tasks = taskService.createTaskQuery().list();
    System.out.println("当前任务数: " + tasks.size()); // 应该是 3
}
```

---

## 包容网关（Inclusive Gateway）

### 什么时候用？

**根据条件选择分支，每条条件为真的分支都执行。** 当你想「符合哪个条件就走哪条」时。

### 场景

报销审批条件：
- 金额 > 5000，需要财务复核
- 含有差旅费，需要主管复核

如果金额 8000 且含有差旅费，那么财务复核和主管复核都要执行。

```
              ┌─────────┐
              │  审批判断  │
              │    (O)   │ ← 包容网关
              └────┬────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
    [金额>5000?]         [含差旅费?]
        │                     │
        ▼                     ▼
    财务复核             主管复核
        │                     │
        └──────────┬──────────┘
                   │
                   ▼
              提交报销单
```

### BPMN 定义

```xml
<!-- 包容分支网关 -->
<inclusiveGateway id="approvalGateway" name="审批判断"/>

<!-- 条件1：金额大于5000 -->
<sequenceFlow id="flow1" sourceRef="approvalGateway" targetRef="financeReview">
    <conditionExpression>${amount > 5000}</conditionExpression>
</sequenceFlow>

<!-- 条件2：含有差旅费 -->
<sequenceFlow id="flow2" sourceRef="approvalGateway" targetRef="directorReview">
    <conditionExpression>${hasTravelExpense == true}</conditionExpression>
</sequenceFlow>

<!-- 包容合并网关 -->
<inclusiveGateway id="mergeGateway" name="审批合并"/>

<sequenceFlow sourceRef="financeReview" targetRef="mergeGateway"/>
<sequenceFlow sourceRef="directorReview" targetRef="mergeGateway"/>
```

### 包容网关 vs 排他网关

| 维度 | 排他网关 | 包容网关 |
|---|---|---|
| 条件关系 | 互斥，只能选一个 | 独立，每个条件单独判断 |
| 执行分支数 | 1 条 | 0 到多条（取决于条件） |
| 汇聚条件 | 1 条分支到达 | 所有已选分支都到达 |
| 适用场景 | 二选一 | 多选一或多选多 |

```java
// 举例对比
// 场景1：报销金额判断（排他）
// amount = 15000
${amount > 10000} → true  → 选这条
${amount <= 10000} → false → 不选
// 结果：走「金额>10000」分支

// 场景2：审批条件判断（包容）
// amount = 15000, hasTravelExpense = true
${amount > 5000} → true  → 执行财务复核
${hasTravelExpense == true} → true → 执行主管复核
// 结果：两个分支都执行
```

---

## 事件网关（Event Gateway）

### 什么时候用？

**根据「发生的事件」决定走哪条路。** 不是判断条件，而是等待事件发生。

### 场景

订单处理：
- 如果 30 分钟内收到支付成功事件，走支付成功流程
- 如果 30 分钟内收到支付失败事件，走支付失败流程
- 如果超时，走超时处理流程

```
                    ◇ ← 事件网关
                   / \
                  /   \
                 /     \
                ▼       ▼
        [支付成功事件] [支付失败事件]
                │       │
                │       │
                │       │
               /         \
              /           \
             ▼             ▼
        继续处理       取消订单
              \           /
               \         /
                \       /
                 \     /
                  ▼   ▼
              ◇ ← 超时事件
                  │
                  ▼
              订单超时
```

### BPMN 定义

```xml
<!-- 事件网关必须紧跟开始事件或另一个事件 -->
<startEvent id="startEvent"/>

<!-- 事件网关 -->
<eventBasedGateway id="orderEventGateway"/>

<!-- 等待支付成功 -->
<intermediateCatchEvent id="paymentSuccessEvent">
    <messageEventDefinition messageRef="paymentSuccessMessage"/>
</intermediateCatchEvent>

<!-- 等待支付失败 -->
<intermediateCatchEvent id="paymentFailEvent">
    <messageEventDefinition messageRef="paymentFailMessage"/>
</intermediateCatchEvent>

<!-- 定时器（超时） -->
<intermediateCatchEvent id="timeoutEvent">
    <timerEventDefinition>
        <timeDuration>PT30M</timeDuration>
    </timerEventDefinition>
</intermediateCatchEvent>

<!-- 连接 -->
<sequenceFlow sourceRef="startEvent" targetRef="orderEventGateway"/>
<sequenceFlow sourceRef="orderEventGateway" targetRef="paymentSuccessEvent"/>
<sequenceFlow sourceRef="orderEventGateway" targetRef="paymentFailEvent"/>
<sequenceFlow sourceRef="orderEventGateway" targetRef="timeoutEvent"/>
```

### 关键规则

**事件网关会创建一个执行实例，等待多个可能的事件。第一个发生的事件触发后，其他分支取消。**

```java
// 测试：事件网关的行为
@Test
public void eventGatewayTest() {
    // 启动流程
    String processInstanceId = runtimeService.startProcessInstanceByKey(
        "orderProcess"
    ).getId();
    
    // 此时流程在等待事件，不会继续往下走
    
    // 模拟发送支付成功消息
    runtimeService.messageEventReceived(
        "paymentSuccessMessage", // 消息引用
        processInstanceId         // 流程实例ID
    );
    
    // 流程继续执行「支付成功」分支
    // 其他分支（支付失败、超时）会被取消
}
```

---

## 网关选择决策表

```
需要决定走哪条路？
                    │
        ┌───────────┴───────────┐
        │                       │
       是？                     否？
        │                       │
   ┌────┴────┐                  │
   │         │                  │
  几个分支?                  需要并行?
   │         │                  │
 ┌─┴─┐     多条               ├─┤
 │1个│         │               是 否
 │   │     ┌───┴───┐           │ │
 │排他│     │       │           ▼
 │网关│     ▼       ▼           ▼
 └────┘  所有都  有条件   继续其他网关
         走？  走？
          │    │
         是    否
          │    │
          ▼    ▼
       并行  包容
       网关  网关

等等，你说还有事件网关？
      │
      ▼
  等待事件触发？
      │
     是？
      │
      ▼
   事件
   网关
```

---

## 总结对比

| 网关类型 | 图标 | 核心行为 | 使用场景 |
|---|---|---|---|
| 排他网关 | × | 只选 1 条 | 二选一、多选一 |
| 并行网关 | + | 全部执行 | 无条件并行 |
| 包容网关 | O | 符合就走 | 多条件分支 |
| 事件网关 | ◇ | 等事件触发 | 异步响应 |

---

## 留给你的问题

假设你正在设计一个订单处理流程，有这样一个场景：

订单提交后，需要同时：
1. 库存扣减
2. 发送短信通知商家
3. 发送邮件通知买家

但是，第 3 步（邮件通知）有一个前置条件：如果买家设置了「不接受营销邮件」，就不发邮件。

你打算怎么设计？

- 使用并行网关还是包容网关？
- 邮件通知的分支怎么加条件？
- 网关的汇聚怎么设计？

这是一个看起来简单，但设计起来很容易出错的问题。
