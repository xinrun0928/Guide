# Kong 服务发现与负载均衡

当你的后端服务有多个实例时，网关需要知道：「这个服务有哪些实例？请求应该发给哪个实例？」

这就是**服务发现**和**负载均衡**要解决的问题。Kong 提供了完善的支持，让这两个问题变得简单。

## 服务发现：如何找到后端实例？

### 传统方式：静态配置

最早的网关使用静态配置——管理员手动写下每个后端实例的地址：

```yaml
upstreams:
  - name: user-service
    targets:
      - target: 192.168.1.10:8080
      - target: 192.168.1.11:8080
      - target: 192.168.1.12:8080
```

问题显而易见：每次扩容/缩容/故障，都需要手动修改配置。这在微服务时代是不可接受的。

### Kong 的服务发现方案

Kong 支持多种服务发现方式：

| 方案 | 说明 | 适用场景 |
|---|---|---|
| 静态目标 | 手动配置 IP:Port | 开发测试环境 |
| DNS 轮询 | Consul/独立 DNS | 简单场景 |
| Consul | HashiCorp Consul | 中大规模 |
| DNS SRV | 基于 DNS 记录 | 云原生环境 |

### 配置 Upstream（上游）

在 Kong 中，定义一个后端服务叫做创建 Upstream：

```bash
# 创建用户服务的 Upstream
curl -X POST http://localhost:8001/upstreams \
    --data "name=user-service" \
    --data "algorithm=round-robin" \
    --data "healthchecks.active.timeout=5" \
    --data "healthchecks.active.healthy.interval=5" \
    --data "healthchecks.active.unhealthy.interval=5"
```

### 添加 Target（目标实例）

Target 是 Upstream 的具体实例：

```bash
# 添加多个实例
curl -X POST http://localhost:8001/upstreams/user-service/targets \
    --data "target=192.168.1.10:8080" \
    --data "weight=100"

curl -X POST http://localhost:8001/upstreams/user-service/targets \
    --data "target=192.168.1.11:8080" \
    --data "weight=100"

curl -X POST http://localhost:8001/upstreams/user-service/targets \
    --data "target=192.168.1.12:8080" \
    --data "weight=50"  # 低权重实例
```

### 创建 Service 和 Route

将 Upstream 与路由关联：

```bash
# 创建 Service
curl -X POST http://localhost:8001/services \
    --data "name=user-service" \
    --data "host=user-service" \
    --data "port=8080" \
    --data "protocol=http"

# 创建 Route
curl -X POST http://localhost:8001/routes \
    --data "name=user-route" \
    --data "service.name=user-service" \
    --data "paths[]=/api/users" \
    --data "strip_path=true"
```

注意：`host=user-service` 是 Upstream 的名称，Kong 会自动使用该 Upstream 的负载均衡策略。

## 健康检查：自动剔除故障实例

健康检查是服务发现的重要一环。Kong 内置了主动健康检查：

### 配置健康检查

```bash
curl -X PATCH http://localhost:8001/upstreams/user-service \
    --data "healthchecks.active.timeout=5" \
    --data "healthchecks.active.http_path=/health" \
    --data "healthchecks.active.healthy.interval=5" \
    --data "healthchecks.active.healthy.successes=2" \
    --data "healthchecks.active.unhealthy.interval=5" \
    --data "healthchecks.active.unhealthy.tcpfailures=3" \
    --data "healthchecks.active.unhealthy.httpfailures=3" \
    --data "healthchecks.active.unhealthy.interval=3"
```

### 健康检查参数说明

| 参数 | 说明 | 推荐值 |
|---|---|---|
| healthy.interval | 健康检查间隔（秒） | 5-30 |
| healthy.successes | 连续成功次数才标记健康 | 1-3 |
| unhealthy.interval | 不健康时的检查间隔（秒） | 1-10 |
| unhealthy.tcpfailures | TCP 失败次数触发不健康 | 3-5 |
| unhealthy.httpfailures | HTTP 失败次数触发不健康 | 3-5 |

### 查看健康状态

```bash
curl http://localhost:8001/upstreams/user-service/health
```

响应示例：

```json
{
  "total": 3,
  "healthy": 2,
  "unhealthy": 1,
  "data": [
    {
      "target": "192.168.1.10:8080",
      "weight": 100,
      "health": "HEALTHY"
    },
    {
      "target": "192.168.1.11:8080",
      "weight": 100,
      "health": "HEALTHY"
    },
    {
      "target": "192.168.1.12:8080",
      "weight": 50,
      "health": "UNHEALTHY"
    }
  ]
}
```

Kong 会自动将不健康的实例从负载均衡池中剔除，直到它恢复健康。

## 负载均衡算法

Kong 支持多种负载均衡算法：

### 1. 轮询（Round Robin）

默认算法，请求依次分配给每个实例：

```
请求1 → 实例1
请求2 → 实例2
请求3 → 实例3
请求4 → 实例1
请求5 → 实例2
...
```

```bash
curl -X PATCH http://localhost:8001/upstreams/user-service \
    --data "algorithm=round-robin"
```

### 2. 加权轮询（Weighted Round Robin）

根据权重分配请求：

```bash
# 实例1: 权重 100
# 实例2: 权重 100
# 实例3: 权重 50
# 流量比例约为 2:2:1
curl -X POST http://localhost:8001/upstreams/user-service/targets \
    --data "target=192.168.1.10:8080" \
    --data "weight=100"

curl -X POST http://localhost:8001/upstreams/user-service/targets \
    --data "target=192.168.1.11:8080" \
    --data "weight=100"

curl -X POST http://localhost:8001/upstreams/user-service/targets \
    --data "target=192.168.1.12:8080" \
    --data "weight=50"
```

### 3. 加权最少连接（Weighted Least Connections）

将请求分配给当前连接数最少且有权重的实例：

```bash
curl -X PATCH http://localhost:8001/upstreams/user-service \
    --data "algorithm=least-connections"
```

适用于请求处理时间差异较大的场景。

### 4. 一致性哈希（Consistent Hashing）

相同请求特征的请求会发送到同一个实例：

```bash
curl -X PATCH http://localhost:8001/upstreams/user-service \
    --data "algorithm=consistent-hashing" \
    --data "hash_on=header" \
    --data "hash_fallback=header" \
    --data "hash_on_header=X-User-Id"
```

适用场景：
- 需要会话粘性（同一用户请求同一实例）
- 用户缓存（如 session）存储在本地

## 动态服务发现

在生产环境中，后端实例可能随时变化。Kong 支持通过 DNS 和服务注册中心进行动态发现。

### Consul 集成

使用 Kong 的 DNS 解析或 Consul 插件：

```bash
# 安装 Kong Consul 插件
# 配置服务指向 Consul
curl -X POST http://localhost:8001/services \
    --data "name=user-service" \
    --data "host=user-service.consul" \
    --data "port=8500" \
    --data "protocol=http"
```

### Kubernetes 服务发现

在 Kubernetes 中，推荐使用 Kong Ingress Controller：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: user-service
  annotations:
    konghq.com/protocol: http
spec:
  ports:
  - port: 80
    targetPort: 8080
  selector:
    app: user
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: user-ingress
  annotations:
    konghq.com/strip-path: "true"
spec:
  ingressClassName: kong
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /users
        pathType: Prefix
        backend:
          service:
            name: user-service
            port:
              number: 80
```

Kong Ingress Controller 会自动同步 Kubernetes Service 的 endpoints。

## 蓝绿部署与金丝雀发布

Kong 支持通过权重实现灰度发布：

### 蓝绿部署

```bash
# 1. 创建新的绿色环境 Upstream
curl -X POST http://localhost:8001/upstreams \
    --data "name=user-service-green" \
    --data "targets[]=192.168.2.10:8080" \
    --data "targets[]=192.168.2.11:8080"

# 2. 逐步将流量从蓝色切到绿色
# 先切换 10% 流量到绿色
curl -X PATCH http://localhost:8001/upstreams/user-service/targets/192.168.1.10:8080 \
    --data "weight=90"

curl -X PATCH http://localhost:8001/upstreams/user-service/targets/192.168.1.11:8080 \
    --data "weight=90"

# 3. 验证绿色环境正常后，切换 100%
curl -X PATCH http://localhost:8001/upstreams/user-service/targets/192.168.1.10:8080 \
    --data "weight=0"

curl -X PATCH http://localhost:8001/upstreams/user-service/targets/192.168.1.11:8080 \
    --data "weight=0"
```

### 金丝雀发布

```bash
# 保持原有实例 100% 权重
curl -X PATCH http://localhost:8001/upstreams/user-service/targets/192.168.1.10:8080 \
    --data "weight=900"  # 90%

# 添加金丝雀实例，初始权重 10%
curl -X POST http://localhost:8001/upstreams/user-service/targets \
    --data "target=192.168.2.10:8080" \
    --data "weight=100"  # 10%

# 观察金丝雀表现，逐步增加权重
# ... 验证通过后 ...
curl -X PATCH http://localhost:8001/upstreams/user-service/targets/192.168.2.10:8080 \
    --data "weight=500"
```

## 连接池配置

Kong 支持配置向上游的连接池：

```bash
curl -X PATCH http://localhost:8001/services/user-service \
    --data "connect_timeout=60000" \
    --data "write_timeout=60000" \
    --data "read_timeout=60000" \
    --data "retries=3"
```

| 参数 | 说明 |
|---|---|
| connect_timeout | 建立连接超时（毫秒） |
| write_timeout | 发送请求超时（毫秒） |
| read_timeout | 读取响应超时（毫秒） |
| retries | 重试次数 |

## 总结

| 功能 | 配置方式 | 说明 |
|---|---|---|
| 服务定义 | Upstream | 定义后端服务 |
| 实例配置 | Target | 添加/移除实例 |
| 健康检查 | healthchecks | 自动剔除故障实例 |
| 负载均衡 | algorithm | 轮询/最少连接/哈希 |
| 动态发现 | DNS/Consul/K8s | 自动感知实例变化 |
| 灰度发布 | weight | 权重控制流量分配 |

---

**留给你的问题**

负载均衡算法中，**一致性哈希**是一个有趣的话题。它可以保证相同请求特征的用户始终访问同一个实例。

但你知道吗？当后端实例发生变更（增加或减少）时，一致性哈希会导致大量请求重新路由到不同的实例，从而可能引发缓存失效问题。

**有没有办法解决这个问题？**提示：考虑「虚拟节点」或「哈希环」的概念。
