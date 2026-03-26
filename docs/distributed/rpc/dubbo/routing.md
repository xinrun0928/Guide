# Dubbo 路由机制：条件路由与脚本路由

灰度发布是微服务绕不开的话题。

你刚改了一个核心接口，想要先让 10% 的流量试试水。如果出问题，只影响一小部分用户。

但问题是：**怎么把这 10% 的流量精准地「挑出来」？**

这就需要今天的主角——**Dubbo 路由机制**。

## 路由在 Dubbo 调用链中的位置

在讲具体实现之前，我们先搞清楚路由在 Dubbo 调用链中的位置：

```
Consumer 调用 Provider 的完整流程：

1. Registry 返回 Provider 列表
2. Router 根据路由规则过滤 Provider  ← 【路由在这里】
3. LoadBalance 从剩余 Provider 中选择一台
4. 发起 RPC 调用
```

**路由发生在服务发现之后、负载均衡之前。**

它的作用是：**在众多 Provider 中，过滤出符合规则的子集**。

## 条件路由：最常用的路由规则

### 语法格式

条件路由使用 `key = value` 的格式，核心符号是 `=>`：

```
条件 = Consumer 匹配条件 => Provider 匹配条件
```

- `=>` 左边：**哪些 Consumer 可以发起调用**
- `=>` 右边：**哪些 Provider 接受调用**

### 常见场景

**场景 1：服务分组路由**

```yaml
# 只允许来自 user-group 的 Consumer 调用
method = find* => host = 192.168.1.*
```

**场景 2：机房隔离**

```yaml
# Consumer 在 zone=beijing，优先调用同样在 beijing 的 Provider
consumer.zone = beijing => host = 192.168.1.*
```

**场景 3：排除特定机器**

```yaml
# 排除 192.168.1.100 这台机器
=> host != 192.168.1.100
```

**场景 4：版本路由（灰度发布核心）**

```yaml
# 10% 的流量走新版本（v2）
method = * => version = 2.0.0
```

### 完整配置示例

```yaml
# application.yml
dubbo:
  router:
    scripts:
      - script: "route-rule.js"
        enable: true
```

```yaml
# ZooKeeper 中存储的路由规则
# /dubbo/config/dubbo/com.example.UserService/routers
[
  {
    "name": "gray-route",
    "priority": 1,
    "enable": true,
    "force": true,
    "rule": "method = findById => version = 2.0.0",
    "conditions": [
      "method = findById => version = 2.0.0"
    ]
  }
]
```

### Java 代码动态配置路由

```java
// 动态添加路由规则
RegistryFactory registryFactory =
    ExtensionLoader.getExtensionLoader(RegistryFactory.class)
                   .getAdaptiveExtension();

Registry registry = registryFactory.getRegistry(URL.valueOf("zookeeper://127.0.0.1:2181"));
registry.register(URL.valueOf(
    "route://0.0.0.0:20880/com.example.UserService" +
    "?category=routers" +
    "&rule=" + URL.encode("method=findById => version=2.0.0") +
    "&priority=1"
));

// 取消路由规则
registry.unregister(url);
```

## 标签路由：Dubbo 2.7+ 的灰度利器

标签路由是 Dubbo 2.7 引入的新特性，比条件路由更简单、更灵活。

### 工作原理

```
┌─────────────────────────────────────────────────────────┐
│                   标签路由工作流                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Provider 设置标签（打标）                            │
│     @DubboService(tag = "gray")                          │
│                                                         │
│  2. Consumer 声明标签（声明想用什么标签）                  │
│     @Reference(tag = "gray")                             │
│                                                         │
│  3. Registry 匹配：Consumer 标签 → Provider 标签         │
│                                                         │
│  4. 匹配成功：调用带标签的 Provider                      │
│     匹配失败：fallback 到无标签 Provider                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 代码示例

**Provider 端：标记服务标签**

```java
// 普通版本
@DubboService(version = "1.0.0")
public class UserServiceImpl implements UserService { }

// 灰度版本 - 设置 tag
@DubboService(version = "2.0.0", tag = "gray")
public class UserServiceGrayImpl implements UserService { }
```

**Consumer 端：声明需要的标签**

```java
// 声明使用 gray 标签
@Reference(version = "1.0.0", tag = "gray")
private UserService userService;
```

**动态切换标签**

```java
// 基于请求参数动态选择标签
public User getUser(Long id, String version) {
    // 从请求头中获取标签
    RpcContext.getContext().setAttachment("dubbo.tag", version);
    return userService.findById(id);
}
```

### 标签路由 vs 条件路由

| 维度 | 标签路由 | 条件路由 |
|-----|---------|---------|
| 配置复杂度 | 简单（只需要打标签） | 复杂（需要写规则表达式） |
| 灵活性 | 低（只能按标签匹配） | 高（支持复杂条件） |
| 动态性 | 支持运行时切换 | 支持动态下发 |
| 适用场景 | 灰度发布、流量隔离 | 机房隔离、黑白名单 |

## 脚本路由：自定义路由逻辑

当内置的路由方式不满足需求时，Dubbo 支持使用脚本自定义路由逻辑。

### 支持的脚本语言

- **JavaScript**：Dubbo 内置，无需额外依赖
- **Groovy**：需要引入 groovy 依赖

### JavaScript 脚本路由

```javascript
// route-rule.js
function route(invokers, url, invocation) {
    var result = new java.util.ArrayList();

    // 获取请求参数
    var method = invocation.getMethodName();
    var args = invocation.getArguments();

    // 自定义过滤逻辑
    for (var i = 0; i < invokers.size(); i++) {
        var invoker = invokers.get(i);
        var host = invoker.getUrl().getHost();

        // 过滤逻辑：只保留内网 IP
        if (host.startsWith("192.168.")) {
            result.add(invoker);
        }
    }

    return result;
}
```

### Groovy 脚本路由

```groovy
// route-rule.groovy
import org.apache.dubbo.rpc.Invoker
import org.apache.dubbo.rpc.Invocation

static List&lt;Invoker&gt;&gt; route(List&lt;Invoker&gt;&gt; invokers, URL url, Invocation invocation) {
    // 获取 Consumer 的 zone 参数
    String zone = RpcContext.getContext().getAttachment("consumer.zone");

    if (zone == null) {
        return invokers;
    }

    // 只返回同 zone 的 Provider
    return invokers.findAll { inv ->
        zone == inv.getUrl().getParameter("zone")
    };
}
```

### 脚本路由配置

```yaml
dubbo:
  configs:
    configs:
      - id: "script-router"
        name: "script"
        script: "route-rule.js"
        enable: true
```

## 路由的使用场景

### 场景 1：灰度发布

```
需求：新版本上线，先让 10% 的用户试用

方案：
1. Provider v2 设置 tag = "gray"
2. Consumer 通过某种机制（如 Cookie、UserId hash）判断是否在灰度名单
3. 灰度用户请求带上 tag = "gray"
4. Registry 匹配，灰度用户打到 v2，普通用户打到 v1
```

### 场景 2：机房隔离

```
需求：上海机房的请求优先调用上海机房的服务

方案：
1. 各机房 Provider 设置 zone 参数
2. Consumer 请求带上 zone = "shanghai"
3. 路由规则：zone = shanghai => zone = shanghai
```

### 场景 3：节点下线

```
需求：某台机器要下线，但不想中断正在处理的请求

方案：
1. 先给机器打上 "draining" 标签
2. 路由规则排除 "draining" 标签
3. 等待现有请求处理完毕
4. 下线机器
```

### 场景 4：黑白名单

```
需求：禁止特定 IP 调用某个服务

方案：
1. 设置路由规则：host != 10.0.0.1 => host != 10.0.0.1
2. 匹配成功的请求会被放行
3. 10.0.0.1 的请求永远匹配失败，无法调用
```

## 路由与负载均衡的区别

很多人容易混淆路由和负载均衡，它们有本质区别：

| 维度 | 路由（Router） | 负载均衡（LoadBalance） |
|-----|---------------|----------------------|
| **作用时机** | 服务发现之后、调用之前 | 调用之前（最后一步） |
| **作用对象** | Provider 列表 | 单个 Provider 选择 |
| **目的** | 缩小范围（符合规则） | 选出最佳 | 
| **数量变化** | 可能过滤掉部分 Provider | 最终只选一个 |
| **常见实现** | 条件路由、标签路由 | Random、RoundRobin、LeastActive |

**简单理解**：
- 路由是「海选」：从 100 个 Provider 中挑出 30 个
- 负载均衡是「选秀」：从 30 个中选 1 个

## 面试追问方向

- 路由规则是怎么下发的？是推送还是拉取？
- 如果路由规则导致所有 Provider 都被过滤掉了，会发生什么？
- 标签路由的 fallback 机制是什么？如果没有匹配到标签的 Provider 怎么办？
- 如何实现按比例灰度（比如只让 10% 的流量走新版本）？

## 总结

Dubbo 的路由机制是服务治理的重要一环：

- **条件路由**：灵活强大的路由规则，适合复杂场景
- **标签路由**：简单易用的灰度工具，适合快速迭代
- **脚本路由**：完全自定义的路由逻辑，适合特殊需求

合理的路由设计，能让你的灰度发布、流量隔离、机房多活等高级特性得以实现。
