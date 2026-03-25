# Flowable Spring Boot 集成与自动配置

你有没有这种感觉：用 Flowable 原生的方式配置，实在是太麻烦了。

要写一堆 XML 配置，要手动创建 ProcessEngine，要配置数据源、事务管理器、异步执行器……好不容易跑起来了，一行代码都没写。

好消息是：**Flowable 提供了开箱即用的 Spring Boot 支持**。只需要几个依赖，一个配置文件，就能把 Flowable 跑起来。

---

## 快速开始

### 添加依赖

```xml
<dependencies>
    <!-- Flowable Spring Boot Starter -->
    <dependency>
        <groupId>org.flowable</groupId>
        <artifactId>flowable-spring-boot-starter</artifactId>
        <version>6.7.2</version>
    </dependency>
    
    <!-- Spring Boot Web（可选，用于 REST API） -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    
    <!-- 数据库驱动 -->
    <dependency>
        <groupId>com.mysql</groupId>
        <artifactId>mysql-connector-j</artifactId>
        <scope>runtime</scope>
    </dependency>
</dependencies>
```

### 配置文件

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/flowable?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai
    username: root
    password: root123
    driver-class-name: com.mysql.cj.jdbc.Driver
  
  # Flowable 会自动创建表结构
  # 但建议生产环境使用 Flyway 或 Liquibase 管理

flowable:
  # 自动部署 BPMN 文件
  process:
    definition-location:
      auto-check: true
      # BPMN 文件存放位置
    files-to-deploy:
      - classpath:processes/*.bpmn20.xml
      - classpath:processes/*.bpmn
  
  # 关闭异步执行器自动启动（调试时有用）
  # async-executor-activate: false
  
  # 启用定时任务
  job-executor-activate: true
  
  # 启用历史记录
  history-level: full
  
  # 数据库表名前缀（可选）
  # database-table-prefix: FLW_

# 开启日志输出 SQL（调试用）
logging:
  level:
    org.flowable.engine: DEBUG
    org.flowable.variable.service.impl: DEBUG
```

### 启动类

```java
@SpringBootApplication
public class FlowableApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(FlowableApplication.class, args);
    }
}
```

就这样，Flowable 就已经跑起来了。Spring Boot 会自动：

1. 创建 ProcessEngine
2. 配置 6 大核心服务（RuntimeService、TaskService 等）
3. 自动部署 BPMN 文件
4. 启动异步执行器和定时任务

---

## 自动配置详解

### Flowable 创建的 Bean

启动项目后，Flowable 会自动注册以下 Bean：

| Bean 类型 | 说明 |
|---|---|
| `ProcessEngine` | 流程引擎主对象 |
| `RepositoryService` | 流程定义管理 |
| `RuntimeService` | 流程运行管理 |
| `TaskService` | 任务管理 |
| `HistoryService` | 历史数据查询 |
| `ManagementService` | 作业管理 |
| `IdentityService` | 身份管理 |
| `DynamicBpmnService` | 动态流程 |
| `AsyncExecutor` | 异步执行器 |
| `ProcessEngineConfiguration` | 引擎配置 |

### 直接注入使用

```java
@Service
public class WorkflowService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private RepositoryService repositoryService;
    
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
    public List&lt;Task&gt; getTasks(String userId) {
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

### 部署目录结构

```
src/
└── main/
    ├── resources/
    │   ├── processes/           # BPMN 文件目录
    │   │   ├── expense.bpmn20.xml
    │   │   ├── purchase.bpmn20.xml
    │   │   └── approval.bpmn
    │   └── static/
    │       └── forms/           # 表单文件（可选）
    └── java/
        └── com/example/
            └── FlowableApplication.java
```

### 自动部署配置

```yaml
flowable:
  process:
    definition-location:
      auto-check: true
    files-to-deploy:
      # 方式1：指定文件路径
      - classpath:processes/*.bpmn20.xml
      # 方式2：指定目录
      - classpath:processes/
    
    # 部署后自动激活（默认 true）
    activate-process-definitions-on-startup: true
```

### 手动触发部署

有时候你可能需要手动控制部署：

```java
@Service
public class ProcessDeploymentService {
    
    @Autowired
    private RepositoryService repositoryService;
    
    @Autowired
    private RuntimeService runtimeService;
    
    /**
     * 手动部署指定文件
     */
    @Deployment(resources = {
        "processes/expense.bpmn20.xml",
        "processes/expense-form.form"
    })
    public void deployExpenseProcess() {
        // 部署注解会在方法调用时触发部署
    }
    
    /**
     * 动态部署（从数据库或文件系统）
     */
    public void deployFromDatabase(String processKey, String bpmnXml) {
        Deployment deployment = repositoryService.createDeployment()
            .name(processKey + "_deployment")
            .key(processKey)
            .addString(processKey + ".bpmn20.xml", bpmnXml)
            .deploy();
        
        System.out.println("部署ID: " + deployment.getId());
    }
    
    /**
     * 带条件的自动部署
     */
    @PostConstruct
    public void conditionalDeploy() {
        // 检查是否已部署
        long count = repositoryService.createProcessDefinitionQuery()
            .processDefinitionKey("expense")
            .count();
        
        if (count == 0) {
            // 未部署，执行部署
            deployExpenseProcess();
        }
    }
}
```

---

## 事务管理

### Flowable 的事务机制

Flowable 会自动与 Spring 的事务管理集成：

```java
@Service
public class TransactionalWorkflowService {
    
    /**
     * Flowable 会自动加入 Spring 的事务管理
     */
    @Transactional
    public void submitAndStartProcess(SubmitRequest request) {
        // 1. 保存业务数据
        Order order = orderRepository.save(request.toOrder());
        
        // 2. 启动流程
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("orderId", order.getId());
        variables.put("amount", order.getAmount());
        runtimeService.startProcessInstanceByKey("orderProcess", variables);
        
        // 3. 如果这里抛出异常，流程启动会回滚吗？
        // 答案：取决于异常类型和配置
    }
}
```

### 事务边界控制

```java
@Service
public class TransactionBoundaryService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    /**
     * 让流程在独立事务中执行
     * 使用 ProcessEngineConfiguration 中的事务管理器
     */
    public void startProcessInNewTransaction() {
        ProcessEngineConfiguration config = processEngine.getProcessEngineConfiguration();
        
        // 使用新的事务启动
        config.getTransactionManager().getTransactionManager().execute(() -> {
            runtimeService.startProcessInstanceByKey("myProcess");
        });
    }
    
    /**
     * 在 BPMN 中配置事务边界
     * 错误边界事件可以捕获子流程中的异常
     */
    public void handleTransactionBoundary() {
        // 在 BPMN 中使用错误边界事件捕获异常
        // 这样子流程的异常不会影响主流程
    }
}
```

---

## 异步执行配置

### 启用异步执行

```yaml
flowable:
  # 启用异步执行器
  async-executor-activate: true
  
  # 异步执行器配置
  async:
    executor:
      # 线程池大小
      core-pool-size: 5
      max-pool-size: 10
      queue-size: 100
      keep-alive-seconds: 30
      
      # 是否在启动时激活
      is-activate: true
```

### 自定义异步执行器

```java
@Configuration
public class CustomAsyncExecutorConfig {
    
    /**
     * 自定义异步执行器
     */
    @Bean
    public DefaultAsyncJobExecutor customAsyncExecutor() {
        DefaultAsyncJobExecutor executor = new DefaultAsyncJobExecutor();
        
        // 线程池配置
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(16);
        executor.setQueueSize(200);
        
        // 线程名称
        executor.setThreadNamePrefix("flowable-async-");
        
        // 获取作业等待时间
        executor.setDefaultAsyncJobAcquireWaitTime(5000L);
        executor.setDefaultTimerJobAcquireWaitTime(10000L);
        
        // 锁定期
        executor.setDefaultAsyncJobLockTime(30000L);
        executor.setDefaultTimerJobLockTime(60000L);
        
        return executor;
    }
}
```

---

## REST API

### 启用 REST API

```xml
<dependency>
    <groupId>org.flowable</groupId>
    <artifactId>flowable-spring-boot-starter-rest</artifactId>
    <version>6.7.2</version>
</dependency>
```

```yaml
# 启用 Flowable REST API
flowable:
  rest:
    enabled: true
    api:
      app:
        enabled: true

server:
  port: 8080
```

### 访问 REST API

启动后，可以访问以下端点：

| 端点 | 说明 |
|---|---|
| `/flowable-rest/process-api/` | REST API 根路径 |
| `/flowable-rest/process-api/runtime/process-instances` | 流程实例 |
| `/flowable-rest/process-api/runtime/tasks` | 任务 |
| `/flowable-rest/process-api/repository/process-definitions` | 流程定义 |

```bash
# 启动流程实例
curl -X POST "http://localhost:8080/flowable-rest/process-api/runtime/process-instances" \
  -H "Content-Type: application/json" \
  -d '{
    "processDefinitionKey": "expense",
    "variables": [
      {"name": "amount", "value": 1000}
    ]
  }'

# 查询任务
curl "http://localhost:8080/flowable-rest/process-api/runtime/tasks?assignee=zhangsan"
```

---

## Spring Security 集成

### 安全配置

```java
@Configuration
@EnableWebSecurity
public class FlowableSecurityConfig extends WebSecurityConfigurerAdapter {
    
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .csrf().disable()
            .authorizeRequests()
                // REST API 需要认证
                .antMatchers("/flowable-rest/**").authenticated()
                // 任务相关端点
                .antMatchers("/api/tasks/**").authenticated()
                // 其他端点公开
                .anyRequest().permitAll()
            .and()
            .httpBasic();  // 简单起见，使用 Basic 认证
    }
}
```

### 用户认证信息传递

```java
@Service
public class SecuredWorkflowService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    /**
     * 从 Security Context 获取当前用户
     */
    public void startProcessAsCurrentUser(String processKey) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String currentUser = auth.getName();
        
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("initiator", currentUser);
        
        // Flowable 会自动使用当前用户作为流程发起人
        runtimeService.startProcessInstanceByKey(processKey, variables);
    }
}
```

---

## 与其他 Spring 组件集成

### 与 Spring Data JPA 集成

```java
@Service
public class JpaIntegrationService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private OrderRepository orderRepository;
    
    /**
     * 流程与业务数据一致更新
     */
    @Transactional
    public void submitOrder(OrderRequest request) {
        // 1. 保存业务数据
        Order order = orderRepository.save(request.toOrder());
        
        // 2. 启动流程（与业务数据在同一个事务）
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("orderId", order.getId());
        
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            "orderProcess", order.getBusinessKey(), variables);
        
        // 3. 更新订单的流程实例ID
        order.setProcessInstanceId(instance.getId());
        orderRepository.save(order);
    }
    
    /**
     * 在监听器中更新业务数据
     */
    public class OrderTaskListener implements TaskListener {
        
        @Autowired
        private OrderRepository orderRepository;
        
        @Override
        public void notify(DelegateTask delegateTask) {
            if (TaskListener.EVENTNAME_COMPLETE.equals(delegateTask.getEventName())) {
                String businessKey = getBusinessKey(delegateTask);
                Order order = orderRepository.findByBusinessKey(businessKey);
                
                Boolean approved = (Boolean) delegateTask.getVariable("approved");
                order.setStatus(approved ? "APPROVED" : "REJECTED");
                
                orderRepository.save(order);
            }
        }
    }
}
```

### 与 Spring Events 集成

```java
@Component
public class FlowableEventPublisher {
    
    @Autowired
    private ApplicationEventPublisher eventPublisher;
    
    /**
     * 发布流程事件到 Spring 事件系统
     */
    @Configuration
    public static class FlowableEventConfig {
        
        @Bean
        public RuntimeService eventAwareRuntimeService(ProcessEngine processEngine) {
            RuntimeService runtimeService = processEngine.getRuntimeService();
            
            runtimeService.addEventListener(new FlowableEventListener() {
                @Override
                public void onEvent(FlowableEvent event) {
                    // 转换为 Spring 事件
                    if (event instanceof FlowableProcessStartedEvent) {
                        ProcessStartedEvent springEvent = 
                            new ProcessStartedEvent((FlowableProcessStartedEvent) event);
                        eventPublisher.publishEvent(springEvent);
                    }
                }
                
                @Override
                public boolean isFailOnException() {
                    return false;
                }
            });
            
            return runtimeService;
        }
    }
}
```

---

## 常用配置汇总

```yaml
# application.yml 完整配置示例
flowable:
  # 数据库配置
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    url: jdbc:mysql://localhost:3306/flowable
    username: root
    password: secret
  
  # 自动部署
  process:
    definition-location:
      auto-check: true
    files-to-deploy:
      - classpath:processes/*.bpmn20.xml
    activate-process-definitions-on-startup: true
  
  # 异步执行
  async-executor-activate: true
  job-executor-activate: true
  
  # 历史记录
  history-level: full
  
  # REST API
  rest:
    enabled: true
  
  # 邮件配置
  mail:
    server:
      host: smtp.example.com
      port: 587
      username: noreply@example.com
      password: secret
      starttls: true
  
  # IDM 配置（身份管理）
  idm:
    enabled: true
    # LDAP 集成（可选）
    ldap:
      enabled: false

logging:
  level:
    org.flowable: INFO
    org.flowable.engine.impl.persistence.entity: DEBUG
```

---

## 总结：Spring Boot 集成要点

| 功能 | 配置项 | 说明 |
|---|---|---|
| 自动创建引擎 | `flowable-spring-boot-starter` | 引入依赖即可 |
| 数据库 | `spring.datasource.*` | Flowable 自动建表 |
| 自动部署 | `flowable.process.files-to-deploy` | 指定 BPMN 文件位置 |
| 异步执行 | `flowable.async-executor-activate` | 启用异步作业 |
| 定时任务 | `flowable.job-executor-activate` | 启用定时器 |
| 历史记录 | `flowable.history-level` | full/activity/none |
| REST API | `flowable.rest.enabled` | 启用 REST 接口 |

---

## 留给你的问题

假设你要把 Flowable 集成到一个微服务架构中：

1. 流程引擎作为独立服务，多个业务服务通过 REST API 调用
2. 需要支持多租户，每个租户有独立的流程定义和流程实例
3. 需要与 Spring Cloud Gateway 集成，实现统一的认证授权

**问题来了：**

1. 作为独立服务时，Flowable 的异步执行器如何配置才能在集群环境下正常工作？
2. 多租户场景下，Flowable 的数据隔离是怎么实现的？不同租户的流程定义会冲突吗？
3. 如果服务实例在执行任务过程中宕机了（比如正要完成任务时重启），已执行的操作会不会丢失？

这三个问题涉及到**微服务架构**、**数据隔离**和**可靠性保证**，是生产环境部署的核心考量。
