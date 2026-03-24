# Dubbo 服务导出（Export）与引用（Refer）流程

你有没有想过这个问题：

Dubbo 的 Provider 是怎么把自己「暴露」出去的？Consumer 又是怎么找到 Provider 并建立连接的？

这个过程涉及到 Dubbo 的两个核心概念：**服务导出（Export）和服务引用（Refer）**。

今天，我们来深入理解这个过程。

## 服务导出：Provider 是怎么「暴露」自己的？

### 导出的时机

Dubbo 提供了三种服务导出的触发方式：

```java
// 方式 1：延迟导出（推荐）
// Spring Bean 初始化完成后导出
@DubboService(version = "1.0.0")
public class UserServiceImpl implements UserService { }

// 方式 2：立即导出
@Service(export = "dubbo:20880")
public class UserServiceImpl implements UserService { }

// 方式 3：手动导出（Spring 事件监听）
@Service
public class UserServiceImpl implements UserService {
    @PostConstruct
    public void init() {
        // 显式调用导出
        ServiceBean.getSingleton().export();
    }
}
```

### 导出的完整流程

服务导出是一个多步骤的过程：

```
┌─────────────────────────────────────────────────────────────┐
│                    服务导出流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Spring 容器初始化完成                                    │
│     └──→ Spring 触发 ContextRefreshedEvent                 │
│                                                             │
│  2. ServiceBean 收到事件                                    │
│     └──→ 调用 export() 方法                                │
│                                                             │
│  3. 检查配置                                                │
│     └──→ 合并 XML/注解/编程式配置                          │
│     └──→ 校验参数（端口、版本、分组等）                      │
│                                                             │
│  4. 收集服务 URL                                            │
│     └──→ 格式：dubbo://ip:port/interface?param=value       │
│                                                             │
│  5. 遍历协议暴露服务                                        │
│     └──→ 基于 SPI 选择 Protocol 实现                        │
│     └──→ 调用 Protocol.export()                           │
│                                                             │
│  6. 注册到注册中心                                          │
│     └──→ 将 URL 注册到 ZooKeeper/Nacos                     │
│     └──→ Consumer 即可发现此服务                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 关键代码解析

**Step 1：Spring 事件触发**

```java
// ServiceBean 继承 ApplicationListener
public class ServiceBean&lt;T&gt; extends ServiceConfig&lt;T&gt;
    implements ApplicationListener&lt;ContextRefreshedEvent&gt; {

    @Override
    public void onApplicationEvent(ContextRefreshedEvent event) {
        if (!isExported() && !isUnexported()) {
            if (shouldExport()) {
                export();  // 开始导出
            }
        }
    }
}
```

**Step 2：收集服务 URL**

```java
public class ServiceConfig&lt;T&gt; {
    private void doExport() {
        // 构建服务 URL
        // 协议://主机:端口/接口名?参数...
        URL serviceUrl = new URL("dubbo",
            "192.168.1.100",     // host
            20880,               // port
            UserService.class.getName(),  // path
            "version", "1.0.0",
            "group", "user-group",
            "timeout", 3000,
            "methods", "findById,findByName"
        );
    }
}
```

**Step 3：基于 SPI 暴露服务**

```java
// 基于 SPI 获取 Protocol 实现（默认是 DubboProtocol）
Protocol protocol = ExtensionLoader.getExtensionLoader(Protocol.class)
    .getAdaptiveExtension();

// 调用 export，会在指定端口启动 Netty Server
protocol.export(serviceUrl);
```

**Step 4：注册到注册中心**

```java
// RegistryProtocol 负责注册
public class RegistryProtocol implements Protocol {
    @Override
    public &lt;T&gt; Exporter&lt;T&gt; export(Invoker&lt;T&gt; originInvoker) throws RpcException {
        // 1. 启动 Netty Server（调用 DubboProtocol）
        Exporter&lt;T&gt; exporter = dubboProtocol.export(invoker);

        // 2. 注册到注册中心
        Registry registry = registryFactory.getRegistry(url);
        registry.register(serviceUrl);

        return exporter;
    }
}
```

## 服务引用：Consumer 是怎么找到 Provider 的？

### 引用的时机

服务引用同样有多种时机：

```java
// 方式 1：启动时引用（默认）
// Spring 初始化时建立连接
@Reference(version = "1.0.0")
private UserService userService;

// 方式 2：懒加载引用
// 第一次调用时才建立连接
@Reference(version = "1.0.0", lazy = true)
private UserService userService;

// 方式 3：软引用
@Reference(version = "1.0.0", lazy = true)
private UserService userService;  // 如果引用失败，返回 null 而非抛异常
```

### 引用的完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                    服务引用流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Spring 容器初始化                                        │
│     └──→ ReferenceBean 初始化                               │
│                                                             │
│  2. 创建 Invoker（代理对象）                                 │
│     └──→ 基于动态代理生成远程调用的代理                       │
│                                                             │
│  3. 注册到注册中心                                          │
│     └──→ 向 Registry 订阅服务                               │
│                                                             │
│  4. 获取 Provider 列表                                     │
│     └──→ Registry 返回可用 Provider 的地址                  │
│                                                             │
│  5. 建立连接                                                │
│     └──→ Netty Client 连接 Provider                        │
│                                                             │
│  6. 订阅服务变更                                            │
│     └──→ Registry 监听 Provider 变化                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 关键代码解析

**Step 1：创建 Invoker**

```java
// ReferenceBean 实现了 FactoryBean
public class ReferenceBean&lt;T&gt; extends ReferenceConfig&lt;T&gt;
    implements FactoryBean {

    @Override
    public Object getObject() {
        return get();  // 返回代理对象
    }

    @Override
    public Object getObjectType() {
        return refInterface;
    }

    @Override
    public boolean isSingleton() {
        return true;
    }
}
```

**Step 2：生成代理对象**

```java
public class ReferenceConfig&lt;T&gt; {
    private T createProxy() {
        // 1. 如果指定了 URL，直接连接
        if (url != null) {
            urls.add(url);
        }

        // 2. 如果配置了注册中心，从注册中心获取地址
        if (registryURLs != null) {
            for (URL registryURL : registryURLs) {
                // 订阅服务，获取 Provider 列表
                List&lt;URL&gt; providerUrls = subscribe(registryURL);
            }
        }

        // 3. 基于动态代理创建代理对象
        return proxyFactory.getProxy(invoker);
    }
}
```

**Step 3：订阅服务变更**

```java
// RegistryProtocol 处理订阅逻辑
public class RegistryDirectory&lt;T&gt; implements NotifyListener {

    // 收到 Provider 列表变更通知
    @Override
    public void notify(List&lt;URL&gt; urls) {
        // 1. 更新本地 Provider 列表
        this.providerUrls = urls;

        // 2. 刷新 Invoker
        refreshInvoker();
    }
}
```

## 基于注解的配置示例

Dubbo 2.7+ 支持注解配置，使用更加简洁：

### Provider 端

```java
// Application.java
@SpringBootApplication
@EnableDubbo  // 启用 Dubbo
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

```java
// UserServiceImpl.java
@DubboService(          // 替换原来的 @Service
    version = "1.0.0",
    group = "user",
    timeout = 3000,
    retries = 2,
    loadbalance = "roundrobin"
)
public class UserServiceImpl implements UserService {
    @Override
    public User findById(Long id) {
        return userDao.findById(id);
    }
}
```

### Consumer 端

```java
// Application.java
@SpringBootApplication
@EnableDubbo          // 启用 Dubbo
@EnableDubboClients   // 扫描 @Reference（Dubbo 2.7+）
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

```java
// UserController.java
@RestController
public class UserController {

    @Reference(        // 替换原来的 @Reference
        version = "1.0.0",
        group = "user",
        timeout = 5000,
        check = false   // 启动时不检查 Provider 是否存在
    )
    private UserService userService;

    @GetMapping("/user/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }
}
```

## 导出与引用的时序图

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│ Spring  │      │Service  │      │Protocol│      │Registry │
│ Container│     │ Config  │      │        │      │         │
└────┬────┘      └────┬────┘      └────┬────┘      └────┬────┘
     │               │               │               │
     │ 启动完成      │               │               │
     │──────────────→│               │               │
     │               │               │               │
     │               │  export()     │               │
     │               │──────────────→               │
     │               │               │               │
     │               │               │ 启动 Netty   │
     │               │               │←──────────────│
     │               │               │               │
     │               │               │ register()   │
     │               │               │──────────────→│
     │               │               │               │
     │               │               │    完成      │
     │               │←──────────────│               │
     │   完成        │               │               │
     │←──────────────│               │               │
     │               │               │               │
```

## 面试追问方向

- Provider 启动时为什么要监听 `ContextRefreshedEvent`？如果 Bean 有依赖关系怎么办？
- 服务导出时 URL 包含哪些信息？版本号、分组是怎么传递的？
- Consumer 怎么知道 Provider 下线了？心跳检测机制是怎么工作的？
- 如果注册中心挂了，Consumer 还能调用 Provider 吗？Cached Registry 是什么？

## 总结

Dubbo 的服务导出和引用是两个镜像的过程：

| 阶段 | 服务导出（Provider） | 服务引用（Consumer） |
|-----|---------------------|---------------------|
| **触发** | Spring 容器刷新完成 | Spring 容器刷新完成/第一次调用 |
| **核心对象** | Exporter | Invoker（代理对象） |
| **关键动作** | 启动 Netty Server，注册到 Registry | 订阅服务，获取 Provider 列表 |
| **结果** | 开放端口，监听请求 | 建立连接，准备调用 |

理解了这个过程，你才能理解 Dubbo 的服务治理是怎么实现的——注册中心、负载均衡、路由策略，都建立在这个基础之上。
