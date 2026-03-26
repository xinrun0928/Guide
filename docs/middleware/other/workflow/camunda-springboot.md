# Camunda 与 Spring Boot 集成

你有没有这种感觉：每次集成一个新框架，都要写一堆配置文件，Spring Boot 出现之后，这些配置被大大简化了。

Camunda 也提供了完善的 Spring Boot 支持——只需要引入依赖、配置几行，就能把整个工作流引擎跑起来。

更棒的是，Camunda 的 Spring Boot 集成还包含了 Web 管理界面，不用写一行代码，就能看到流程运行状态、任务列表。

---

## 快速开始

### 添加依赖

```xml
<dependencies>
    <!-- Camunda Spring Boot Starter -->
    <dependency>
        <groupId>org.camunda.bpm.springboot</groupId>
        <artifactId>camunda-bpm-spring-boot-starter</artifactId>
        <version>7.20.0</version>
    </dependency>
    
    <!-- Web 应用（包含 Cockpit、Tasklist） -->
    <dependency>
        <groupId>org.camunda.bpm.springboot</groupId>
        <artifactId>camunda-bpm-spring-boot-starter-webapp</artifactId>
        <version>7.20.0</version>
    </dependency>
    
    <!-- REST API -->
    <dependency>
        <groupId>org.camunda.bpm.springboot</groupId>
        <artifactId>camunda-bpm-spring-boot-starter-rest</artifactId>
        <version>7.20.0</version>
    </dependency>
    
    <!-- 数据库 -->
    <dependency>
        <groupId>com.h2database</groupId>
        <artifactId>h2</artifactId>
        <scope>runtime</scope>
    </dependency>
</dependencies>
```

### 配置文件

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:h2:mem:camunda;DB_CLOSE_DELAY=-1
    driver-class-name: org.h2.Driver
    username: sa
    password: 

camunda:
  # 自动部署 BPMN 和 DMN 文件
  auto-deployment:
    enabled: true
    resources: classpath:processes/*.bpmn
  
  # 引擎配置
  bpm:
    # 历史级别：full, activity, none
    history-level: full
    # 异步执行器
    async-executor:
      enabled: true
      lock-time-in-millis: 300000
    # 启动时自动创建 Demo 用户（开发环境）
    admin-user:
      id: admin
      password: admin
      firstName: Admin
      lastName: User
```

### 启动类

```java
@SpringBootApplication
public class CamundaApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(CamundaApplication.class, args);
    }
}
```

启动后，访问：
- 管理界面：http://localhost:8080/
- REST API：http://localhost:8080/rest/

---

## 自动配置详解

### 核心 Bean

Spring Boot 自动创建以下 Bean：

| Bean | 类型 | 说明 |
|---|---|---|
| ProcessEngine | 流程引擎 | 核心引擎实例 |
| RuntimeService | 运行时服务 | 管理流程实例 |
| TaskService | 任务服务 | 管理用户任务 |
| RepositoryService | 仓库服务 | 管理流程定义 |
| HistoryService | 历史服务 | 查询历史数据 |
| DecisionService | 决策服务 | 评估 DMN |
| ManagementService | 管理服务 | 作业管理 |

### 直接注入使用

```java
@Service
public class WorkflowService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private HistoryService historyService;
    
    /**
     * 启动流程
     */
    public ProcessInstance startProcess(String processKey, Map&lt;String, Object&gt; variables) {
        return runtimeService.startProcessInstanceByKey(processKey, variables);
    }
    
    /**
     * 查询待办任务
     */
    public List&lt;Task&gt; getMyTasks(String userId) {
        return taskService.createTaskQuery()
            .taskAssignee(userId)
            .active()
            .list();
    }
    
    /**
     * 完成任务
     */
    public void completeTask(String taskId, Map&lt;String, Object&gt; variables) {
        taskService.complete(taskId, variables);
    }
}
```

---

## 自动部署

### 部署目录

```
src/main/
├── resources/
│   ├── processes/           # BPMN 文件
│   │   ├── expense.bpmn
│   │   └── approval.dmn
│   ├── forms/               # 表单文件（可选）
│   │   └── task-form.html
│   └── initial-data.sql      # 初始化数据
└── java/
    └── com/example/
        └── CamundaApplication.java
```

### 部署配置

```yaml
camunda:
  auto-deployment:
    enabled: true
    resources: 
      - classpath:processes/*.bpmn
      - classpath:processes/*.dmn
      - classpath:processes/*.bpmn20.xml
```

### 手动部署

```java
/**
 * 手动部署流程
 */
@Service
public class DeploymentService {
    
    @Autowired
    private RepositoryService repositoryService;
    
    /**
     * 部署指定流程
     */
    @Deployment(resources = {
        "processes/expense.bpmn",
        "processes/expense-form.html"
    })
    public void deployExpenseProcess() {
        // 部署注解会在方法调用时触发部署
    }
    
    /**
     * 动态部署（从数据库或外部获取）
     */
    public void deployFromExternal(String processKey, String bpmnXml) {
        Deployment deployment = repositoryService.createDeployment()
            .name(processKey + " - Dynamic Deployment")
            .key(processKey)
            .addString(processKey + ".bpmn", bpmnXml)
            .deploy();
        
        System.out.println("部署完成: " + deployment.getId());
    }
    
    /**
     * 部署带条件检查
     */
    @PostConstruct
    public void conditionalDeploy() {
        // 检查流程是否已部署
        long count = repositoryService.createProcessDefinitionQuery()
            .processDefinitionKey("expense")
            .count();
        
        if (count == 0) {
            deployExpenseProcess();
        }
    }
}
```

---

## 事务管理

### Camunda 与 Spring 事务集成

```java
@Service
public class BusinessService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private OrderRepository orderRepository;
    
    @Autowired
    private PlatformTransactionManager transactionManager;
    
    /**
     * 流程与业务数据在同一事务
     * 如果抛出异常，流程启动会回滚
     */
    @Transactional
    public ProcessInstance submitOrder(Order order) {
        // 1. 保存业务数据
        Order savedOrder = orderRepository.save(order);
        
        // 2. 启动流程
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("orderId", savedOrder.getId());
        variables.put("amount", savedOrder.getAmount());
        
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            "orderProcess", variables);
        
        // 3. 如果这里抛出异常，整个事务回滚
        // 包括 orderRepository.save() 的操作也会回滚
        
        return instance;
    }
}
```

### 独立事务

```java
/**
 * 如果需要流程在独立事务中运行
 */
@Service
public class IndependentTransactionService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void startProcessInNewTransaction(Order order) {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("orderId", order.getId());
        
        runtimeService.startProcessInstanceByKey("orderProcess", variables);
    }
}
```

---

## Spring Security 集成

### 安全配置

```java
@Configuration
@EnableWebSecurity
public class CamundaSecurityConfig extends WebSecurityConfigurerAdapter {
    
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .csrf().disable()
            .authorizeRequests()
                // Web 应用需要认证
                .antMatchers("/camunda/**").authenticated()
                // REST API 可以配置不同策略
                .antMatchers("/rest/**").permitAll()  // 内部网络
                .antMatchers("/api/**").authenticated()  // 外部网络
                .anyRequest().permitAll()
            .and()
            .httpBasic();
    }
}
```

### 从 Security Context 获取用户

```java
@Service
public class SecurityAwareWorkflowService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    /**
     * 使用当前登录用户启动流程
     */
    public ProcessInstance startAsCurrentUser(String processKey) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("initiator", auth.getName());  // 设置流程发起人
        
        // Camunda 会自动记录流程启动人
        return runtimeService.startProcessInstanceByKey(processKey, variables);
    }
}
```

---

## 外部任务客户端

### 配置外部任务客户端

```xml
<!-- BPMN 中定义外部任务 -->
<serviceTask id="checkInventory" name="检查库存">
    <extensionElements>
        <camunda:external>
            <camunda:topic name="inventory-check"/>
        </camunda:external>
    </extensionElements>
</serviceTask>
```

```yaml
# application.yml
camunda:
  external-task:
    # 客户端配置
    client:
      async-response-timeout: 30000
      disable-cookies: false
      base-url: http://localhost:8080
      engine-name: default
```

### 实现外部任务客户端

```java
/**
 * 外部任务处理客户端
 * 作为一个独立的客户端，从 Camunda 拉取任务并处理
 */
@SpringBootApplication
@EnableExternalTaskClient
public class ExternalTaskClientApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(ExternalTaskClientApplication.class, args);
    }
}

/**
 * 处理外部任务
 */
@Component
public class InventoryCheckHandler {
    
    @ExternalTaskSubscription("inventory-check")
    public void handleInventoryCheck(ExternalTask externalTask, 
                                     ExternalTaskService externalTaskService) {
        // 获取输入变量
        String productId = externalTask.getVariable("productId");
        Integer quantity = externalTask.getVariable("quantity");
        
        try {
            // 调用库存服务
            InventoryResult result = inventoryService.check(productId, quantity);
            
            // 设置输出变量并完成任务
            Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
            variables.put("inStock", result.isAvailable());
            variables.put("availableQuantity", result.getQuantity());
            
            externalTaskService.complete(externalTask, variables);
            
        } catch (InventoryException e) {
            // 处理失败
            externalTaskService.handleFailure(
                externalTask,
                "库存检查失败: " + e.getMessage(),
                "请稍后重试",
                3,  // 重试次数
                5000L  // 重试间隔
            );
        }
    }
}
```

---

## 与 Spring 生态集成

### 与 Spring Data JPA 集成

```java
/**
 * 流程与业务数据一致性
 */
@Service
public class JpaIntegrationService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private OrderRepository orderRepository;
    
    @Autowired
    private EntityManager entityManager;
    
    /**
     * 在流程监听器中更新业务数据
     */
    @Component
    public static class OrderTaskListener {
        
        @Autowired
        private OrderRepository orderRepository;
        
        @CamundaExecutionListener
        public void onTaskComplete(DelegateExecution execution) {
            if ("completeOrderTask".equals(execution.getCurrentActivityId())) {
                String businessKey = execution.getBusinessKey();
                Order order = orderRepository.findByBusinessKey(businessKey);
                
                Boolean approved = (Boolean) execution.getVariable("approved");
                order.setStatus(approved ? "APPROVED" : "REJECTED");
                
                orderRepository.save(order);
            }
        }
    }
}
```

### 与 Spring Events 集成

```java
/**
 * 发布 Camunda 事件到 Spring 事件系统
 */
@Configuration
public class CamundaEventConfig {
    
    @Bean
    public ProcessEngineConfiguration processEngineConfiguration(
            DataSource dataSource, 
            PlatformTransactionManager transactionManager) {
        
        return SpringProcessEngineConfiguration
            .buildProcessEngineConfiguration(dataSource, transactionManager)
            .setHistory(HistoryService.HISTORY_FULL)
            .setDeploymentResources(
                applicationContext.getResources("classpath:processes/*.bpmn")
            );
    }
    
    @Bean
    public RuntimeEventPublisher runtimeEventPublisher(ProcessEngine processEngine) {
        return new RuntimeEventPublisher(processEngine);
    }
}

public class RuntimeEventPublisher {
    
    @Autowired
    private ApplicationEventPublisher eventPublisher;
    
    public RuntimeEventPublisher(ProcessEngine processEngine) {
        processEngine.getRuntimeService().addEventListener(new CamundaEventListener());
    }
    
    private class CamundaEventListener implements RuntimeEventListener {
        
        @Override
        public void onEvent(RuntimeEvent runtimeEvent) {
            // 转换为 Spring 事件并发布
            if (runtimeEvent instanceof ProcessStartedEvent) {
                eventPublisher.publishEvent(
                    new ProcessStartedSpringEvent((ProcessStartedEvent) runtimeEvent)
                );
            }
        }
    }
}

// 定义 Spring 事件
public class ProcessStartedSpringEvent extends ApplicationEvent {
    private final String processInstanceId;
    private final String businessKey;
    
    public ProcessStartedSpringEvent(ProcessStartedEvent camundaEvent) {
        super(camundaEvent);
        this.processInstanceId = camundaEvent.getProcessInstance().getId();
        this.businessKey = camundaEvent.getProcessInstance().getBusinessKey();
    }
}
```

---

## 常用配置汇总

```yaml
# 完整配置示例
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/camunda
    username: root
    password: secret
    driver-class-name: com.mysql.cj.jdbc.Driver
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5

camunda:
  # 自动部署
  auto-deployment:
    enabled: true
    resources: classpath:processes/*.bpmn
  
  # 历史记录
  bpm:
    history-level: full
    history-time-to-live: 90  # 天数
  
  # 异步执行
  async-executor:
    enabled: true
    lock-time-in-millis: 300000
    wait-time-in-millis: 5000
    max-pool-size: 10
  
  # Web 应用
  webapp:
    enabled: true
    index-redirect-enabled: true
  
  # REST API
  rest:
    enabled: true
    api-suffix: /api
    case-insensitive-matching: true
  
  # Admin 用户
  admin-user:
    id: admin
    password: ${CAMUNDA_ADMIN_PASSWORD:admin}
    firstName: Admin
    lastName: User
  
  # 初始化 Demo 数据（开发环境）
  basic-auth:
    enabled: true
    user: admin
    password: admin

logging:
  level:
    org.camunda.bpm: INFO
    org.camunda.bpm.engine.orm: DEBUG
```

---

## 总结：Spring Boot 集成要点

| 功能 | 配置项 | 说明 |
|---|---|---|
| 自动创建引擎 | 引入 starter | 零配置启动 |
| 数据库 | `spring.datasource.*` | 自动建表 |
| 自动部署 | `camunda.auto-deployment` | 指定 BPMN 位置 |
| 历史记录 | `camunda.bpm.history-level` | full/activity/none |
| Web 应用 | `camunda.webapp.enabled` | Cockpit/Tasklist |
| REST API | `camunda.rest.enabled` | REST 接口 |
| 异步执行 | `camunda.async-executor` | 后台作业 |

---

## 留给你的问题

假设你要把 Camunda 部署到 Kubernetes 集群中：

1. 多个 Pod 运行 Camunda 引擎实例
2. 使用共享数据库（MySQL）
3. 需要在 Pod 启动时自动部署流程定义

**问题来了：**

1. 多个 Pod 都会执行 `camunda.auto-deployment`，会不会重复部署？如何避免？
2. 如果流程执行到一半，Pod 被 Kubernetes 终止了（OOMKill），正在处理的任务怎么办？Camunda 怎么保证任务不丢失？
3. 你想给流程定义加个「版本标签」，记录是谁在什么时间部署的，这个功能 Camunda 原生支持吗？如果不支持，怎么实现？

这三个问题涉及到**分布式部署**、**可靠性保证**和**运维管理**，是生产环境部署的核心考量。
