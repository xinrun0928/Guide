# KubeSphere 事件与审计日志

「谁在什么时候做了什么操作？」——审计日志是安全合规的基石。

KubeSphere 的审计功能记录了平台上所有用户和管理员的关键操作，从谁创建了 Deployment，到谁修改了 RBAC 策略，每一步都有据可查。在金融、政务等强合规行业，审计日志不是可选项，而是必选项。

## 审计架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 审计架构                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    K8s API Server                          │   │
│  │                                                          │   │
│  │  所有写操作都会生成 Event                                   │   │
│  │  Create / Update / Delete / Patch / Action                │   │
│  └─────────────────────────────┬────────────────────────────┘   │
│                                │                                     │
│  ┌─────────────────────────────┴────────────────────────────┐   │
│  │                    KubeSphere Audit                        │   │
│  │                                                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │  │ 事件聚合      │  │ 审计策略      │  │ 审计规则      │   │   │
│  │  │ (K8s Events) │  │ (Audit Policy)│  │ (多条匹配)   │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              存储层                                  │   │   │
│  │  │  Elasticsearch（可选）/ K8s Events（默认）          │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## K8s 事件系统

### 事件类型

```
┌─────────────────────────────────────────────────────────────────┐
│                    K8s 事件类型                                    │
│                                                                  │
│  Normal（正常事件）                                               │
│  - Created: 资源创建成功                                           │
│  - Started: 容器启动                                               │
│  - Pulled: 镜像拉取成功                                            │
│  - Scheduled: Pod 调度成功                                         │
│  - BackOff: 启动失败，开始退避重试                                  │
│                                                                  │
│  Warning（警告事件）                                               │
│  - Failed: 操作失败                                               │
│  - Unhealthy: 健康检查失败                                         │
│  - BackOff: 反复重启                                              │
│  - nodeMemoryPressure: 节点内存压力                               │
│  - Evicted: Pod 被驱逐                                            │
│  - DeadlineExceeded: Job 超时                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 查看 K8s 事件

```bash
# 查看命名空间下所有事件
kubectl get events -n my-project

# 按类型过滤 Warning 事件
kubectl get events --field-selector type=Warning -n my-project

# 按相关对象过滤
kubectl get events --field-selector involvedObject.name=myapp-xxx -n my-project

# 查看最近 1 小时内的事件
kubectl get events --sort-by='.lastTimestamp' -n my-project

# 查看 Pod 的所有事件
kubectl describe pod myapp-xxx -n my-project

# 输出示例
# LAST SEEN   TYPE      REASON             KIND         MESSAGE
# 5m           Normal    Scheduled          Pod          Successfully assigned...
# 5m           Normal    Pulling           Pod          Pulling image...
# 4m           Normal    Pulled            Pod          Successfully pulled image...
# 4m           Normal    Created           Pod          Created container myapp
# 4m           Normal    Started           Pod          Started container myapp
# 3m           Warning   BackOff          Pod          Back-off restarting failed container
```

## KubeSphere 事件查询

### 事件日志界面

```bash
# KubeSphere 控制台操作路径
# 企业空间 → 项目 → 选择项目 → 日志查询 → 事件

# 支持的过滤条件
# - 时间范围（最近 15 分钟/1 小时/24 小时/自定义）
# - 事件类型（Normal / Warning）
# - 关键词搜索（资源名称、用户名）
# - 资源类型（Pod / Deployment / Service / ConfigMap）
```

### 事件日志内容

```json
{
  "type": "Normal",
  "reason": "Created",
  "kind": "Deployment",
  "namespace": "my-project",
  "name": "myapp",
  "message": "Created container myapp",
  "timestamp": "2024-01-15T10:30:00Z",
  "user": {
    "username": "admin",
    "groups": ["system:masters"]
  },
  "source": {
    "component": "deployment-controller",
    "host": "node-1"
  }
}
```

## 审计策略

### 审计策略配置

```yaml
# kube-apiserver 审计策略
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # 不记录只读请求（GET、LIST、WATCH）
  - level: None
    users: ["system:kube-proxy", "system:node:*"]
    verbs: ["get", "list", "watch"]

  # 不记录对某些命名空间的请求
  - level: None
    namespaces: ["kube-system", "kube-public"]

  # 不记录对健康检查和错误信息的请求
  - level: None
    nonResourceURLs:
      - /healthz*
      - /version
      - /swagger*

  # 对 ConfigMap 和 Secret 的修改操作记录元数据
  - level: Metadata
    resources:
      - group: ""
        resources: ["configmaps", "secrets"]

  # 对 Deployment、StatefulSet、DaemonSet 的修改记录完整请求
  - level: RequestResponse
    resources:
      - group: "apps"
        resources:
          - deployments
          - statefulsets
          - daemonsets
          - replicasets

  # 其他所有写入操作记录请求
  - level: Request
    verbs: ["create", "update", "patch", "delete"]

  # 默认记录所有其他请求
  - level: Metadata
```

### 审计级别说明

```
┌─────────────────────────────────────────────────────────────────┐
│                    审计级别说明                                    │
│                                                                  │
│  None：不记录                                                    │
│  Metadata：只记录请求元数据（时间、用户、资源、动词）              │
│  Request：记录元数据 + 请求体（不含响应体）                        │
│  RequestResponse：记录元数据 + 请求体 + 响应体                    │
│                                                                  │
│  ⚠️ 注意：RequestResponse 会记录敏感信息（密码、Token 等）         │
│  ⚠️ 生产环境建议对 Secret 使用 Metadata 级别                     │
└─────────────────────────────────────────────────────────────────┘
```

## 审计日志存储

### Elasticsearch 存储配置

```yaml
# 启用审计日志收集
# KubeSphere 安装时配置 audit-logbacks
# 将日志输出到 Elasticsearch

# fluent-bit 配置
[INPUT]
    Name              tail
    Path              /var/log/kubeaudit/*.log
    Parser            audit
    Tag               kubeaudit
    Refresh_Interval  5

[FILTER]
    Name              kubernetes
    Match             kubeaudit
    Kube_URL          https://kubernetes.default.svc:443
    Kube_CA_File      /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    Kube_Token_File   /var/run/secrets/kubernetes.serviceaccount/token

[OUTPUT]
    Name              elasticsearch
    Match             kubeaudit
    Host              elasticsearch.logging.svc
    Port              9200
    Index             kubeaudit-%Y.%m.%d
    HTTP_User         elastic
    HTTP_Passwd       ${ES_PASSWORD}
```

### 审计日志保留策略

```bash
# Elasticsearch ILM 策略示例
# 7 天内日志全量保留
# 8-30 天聚合到每日索引
# 31-90 天冷存储
# 90 天后删除

PUT _ilm/policy/kubeaudit-policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_age": "7d"
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "shrink": {
            "number_of_shards": 1
          },
          "forcemerge": {
            "max_num_segments": 1
          }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "freeze": {}
        }
      },
      "delete": {
        "min_age": "90d"
      }
    }
  }
}
```

## 审计日志分析

### 常见审计场景

```bash
# 1. 查看谁创建了某个 Deployment
# 审计日志查询
{
  "query": {
    "bool": {
      "must": [
        { "term": { "verb": "create" }},
        { "term": { "resource" : "deployments" }},
        { "term": { "namespace": "my-project" }}
      ]
    }
  }
}

# 2. 查看某个用户的操作记录
{
  "query": {
    "bool": {
      "must": [
        { "term": { "user.username": "admin@example.com" }},
        { "range": { "@timestamp": { "gte": "now-7d" }}}
      ]
    }
  }
}

# 3. 查看 Secret 访问记录
{
  "query": {
    "bool": {
      "must": [
        { "term": { "resource": "secrets" }},
        { "terms": { "verb": ["create", "update", "delete", "patch"] }}
      ]
    }
  }
}

# 4. 查看失败的登录尝试
{
  "query": {
    "bool": {
      "must": [
        { "term": { "resource": "token" }},
        { "term": { "responseStatus.code": 401 }}
      ]
    }
  }
}
```

### 安全相关审计

```
┌─────────────────────────────────────────────────────────────────┐
│                    安全审计要点                                    │
│                                                                  │
│  1. 敏感操作审计                                                  │
│  - Secret 创建/修改/删除                                          │
│  - RBAC 权限变更                                                 │
│  - ServiceAccount 创建                                           │
│  - Pod 创建（安全上下文、特权容器）                               │
│                                                                  │
│  2. 异常行为检测                                                  │
│  - 非工作时间的管理操作                                          │
│  - 来自异常 IP 的操作                                            │
│  - 频繁的失败登录                                                │
│  - 大量资源删除操作                                              │
│                                                                  │
│  3. 合规要求                                                      │
│  - 操作留痕可追溯                                                │
│  - 日志保留期限（通常 180 天+）                                   │
│  - 日志完整性校验                                                │
└─────────────────────────────────────────────────────────────────┘
```

## 审计与 K8s 事件的关系

```
┌─────────────────────────────────────────────────────────────────┐
│                    事件 vs 审计日志                               │
│                                                                  │
│  K8s 事件（Events）                                              │
│  ├── 来源：K8s 控制器和 Kubelet                                  │
│  ├── 内容：Pod 调度、容器启动、镜像拉取等 K8s 内部事件              │
│  ├── 保留：默认 1 小时（TTL）                                    │
│  └── 用途：日常运维排查                                          │
│                                                                  │
│  审计日志（Audit Logs）                                          │
│  ├── 来源：API Server（用户和管理员的 API 调用）                   │
│  ├── 内容：谁在什么时候通过什么方式做了什么操作                    │
│  ├── 保留：可配置，通常长期保留                                   │
│  └── 用途：安全合规、事件追溯、取证分析                           │
│                                                                  │
│  关系：两者互补，共同构成完整的可观测性                           │
│  K8s 事件告诉你 Pod 为什么重启                                     │
│  审计日志告诉你是谁触发了这次重启                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 面试追问方向

1. **K8s 事件和审计日志有什么区别？**
   答：K8s 事件是 K8s 内部组件产生的操作记录（Pod 调度、容器启动、健康检查失败等），默认保留 1 小时；审计日志是 API Server 记录的外部请求（用户通过 kubectl、API 或控制台做的操作），可以长期保留。简单说：K8s 事件是「系统告诉系统发生了什么」，审计日志是「用户告诉系统做了什么」。

2. **审计日志可以追溯到什么级别？**
   答：通过配置审计策略，可以记录到请求级别（谁用什么凭证、从哪个 IP、在什么时间、对哪个资源做了什么操作）。如果使用 `RequestResponse` 级别，还能记录请求和响应的完整内容。但要注意：审计日志记录的是 API 请求，对于已经在运行的进程内部的恶意行为（如通过 exec 进入容器），审计日志无法直接发现。

3. **如何通过审计日志发现异常行为？**
   答：几个常见方向：1）非工作时间的敏感操作（凌晨 2 点删除了 Deployment）；2）失败的认证尝试（暴力破解）；3）ServiceAccount 的异常使用（通常 ServiceAccount 是程序用，不是人用）；4）大量资源删除（可能是被删除前的准备工作）；5）来自异常地理位置的访问。

> "审计日志是安全的最后一道防线——平时不觉得重要，出了事才知道离不开它。"
