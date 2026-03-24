# Nacos 临时实例与持久实例

你有没有想过这个问题：

服务 A 部署了 3 个实例，其中一个实例是数据库连接池。服务 A 的消费者需要连接这个数据库连接池实例。

如果数据库连接池实例宕机了，消费者需要知道它下线了，不能再往它发请求。

但如果服务 A 的普通 Web 实例宕机了，消费者只需要知道「有实例不可用了」，不需要知道具体是哪个。

这两种场景，有什么区别？

这就是 Nacos 临时实例和持久实例要解决的问题。

## 两种实例的本质区别

```java
// 临时实例（ephemeral = true）
// 特点：无心跳自动删除，Nacos 不主动管理其生命周期
// 适用：无状态服务

// 持久实例（ephemeral = false）
// 特点：心跳不影响存在性，Nacos 主动管理其生命周期
// 适用：有状态服务
```

## 临时实例（Ephemeral）

### 特点

```
1. 无心跳自动删除
2. Nacos 不持久化实例信息
3. 服务下线后，实例信息立即消失
```

### 工作原理

```java
// 创建临时实例
Instance instance = new Instance();
instance.setEphemeral(true);  // 临时实例

// 客户端定期发送心跳
// 如果 Nacos 超过 15 秒没收到心跳，实例被标记为不健康
// 如果超过 30 秒没收到心跳，实例被删除
```

### 使用场景

```java
// 无状态 Web 服务
@SpringBootApplication
@EnableDiscoveryClient
public class WebServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(WebServiceApplication.class, args);
    }
}
```

```
典型场景：
- Spring Boot 微服务
- HTTP API 服务
- RESTful 服务
```

## 持久实例（Persistent）

### 特点

```
1. 心跳不影响存在性
2. Nacos 持久化实例信息
3. 服务下线后，实例信息仍然保留（直到主动删除）
```

### 工作原理

```java
// 创建持久实例
Instance instance = new Instance();
instance.setEphemeral(false);  // 持久实例

// 即使心跳失败，实例也不会被删除
// 只有主动调用注销接口，实例才会消失
```

### 使用场景

```java
// 有状态服务（数据库连接池）
@Configuration
public class DataSourceConfig {

    @Bean
    @NacosConfigurationProperties(
        dataId = "datasource-pool.yaml",
        autoRefreshed = true
    )
    public DataSourceProperties dataSourceProperties() {
        return new DataSourceProperties();
    }
}

// 注册持久实例
@PostConstruct
public void registerInstance() {
    Instance instance = new Instance();
    instance.setEphemeral(false);  // 持久实例
    instance.setIp("192.168.1.100");
    instance.setPort(3306);
    instance.setServiceName("mysql-pool");

    namingService.registerInstance("mysql-pool", instance);
}
```

```
典型场景：
- 数据库连接池
- 消息队列 Broker
- ZooKeeper 集群节点
- 有状态的服务实例
```

## 实现原理对比

### 临时实例实现

```
基于 ZooKeeper 模式：
- 使用临时节点（Ephemeral Node）
- Session 失效 → 节点自动删除
- Session 心跳 → 保持节点存活

基于 2.0 gRPC 模式：
- 使用 TTL（Time To Live）机制
- 心跳超时 → 标记为不健康
- 持续超时 → 实例删除
```

### 持久实例实现

```
持久实例不依赖心跳：
- 实例信息写入持久化存储（MySQL / Derby）
- 心跳失败不影响实例存在性
- 只有主动注销才会删除
```

## Java 代码示例

### 注册临时实例

```java
@SpringBootApplication
@EnableDiscoveryClient
public class UserServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(UserServiceApplication.class, args);
    }
}
```

```yaml
# application.yml
spring:
  cloud:
    nacos:
      discovery:
        ephemeral: true  # 默认是临时实例
```

### 注册持久实例

```java
@Configuration
public class NacosConfig {

    @Autowired
    private NamingService namingService;

    @PostConstruct
    public void registerPersistentInstance() {
        Instance instance = new Instance();
        instance.setEphemeral(false);  // 持久实例
        instance.setIp("192.168.1.100");
        instance.setPort(3306);
        instance.setServiceName("mysql-pool");
        instance.setClusterName("DEFAULT");
        instance.setWeight(1.0);

        try {
            namingService.registerInstance("mysql-pool", instance);
        } catch (NacosException e) {
            e.printStackTrace();
        }
    }
}
```

### 主动注销持久实例

```java
@PreDestroy
public void deregisterInstance() {
    try {
        namingService.deregisterInstance("mysql-pool", "192.168.1.100", 3306, "DEFAULT");
    } catch (NacosException e) {
        e.printStackTrace();
    }
}
```

## 选型建议

### 什么时候用临时实例？

```
✅ 普通微服务（无状态）
✅ Web API 服务
✅ 消费者服务
✅ 短期运行的任务
✅ 可以容忍服务下线自动移除的场景
```

### 什么时候用持久实例？

```
✅ 数据库连接池
✅ 消息队列 Broker
✅ ZooKeeper / etcd 集群节点
✅ 有状态的服务实例
✅ 需要手动管理生命周期的服务
✅ 不允许实例被意外删除的场景
```

## 总结

Nacos 的临时实例和持久实例，为不同的服务类型提供了不同的生命周期管理策略：

- **临时实例**：无心跳自动删除，适合无状态服务
- **持久实例**：Nacos 主动管理，适合有状态服务

选对实例类型，才能保证服务的可靠性。

**面试追问方向：**
- 临时实例和持久实例在存储上有什么区别？
- Nacos 2.0 的 gRPC 模式下，临时实例是怎么实现的？
- 持久实例的典型场景是什么？
- 如果临时实例的心跳一直失败，会发生什么？