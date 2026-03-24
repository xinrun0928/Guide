# Spinnaker 持续交付平台

「Spinnaker 是什么？」——Netflix 开源的多云持续交付平台，专注大规模部署和发布策略。

GitHub: https://github.com/spinnaker/spinnaker

如果说 GitLab CI 是「写配置，跑流水线」，那么 Spinnaker 就是「配好策略，自动执行」。Spinnaker 的强项是多云部署（Kubernetes、AWS、GCP、Azure、Tenant Cloud）、金丝雀分析和零停机发布。

## 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                    Spinnaker 架构                                │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Deck       │  │  Gate (API)  │  │  Orca        │         │
│  │  (Web UI)   │◄─┤  (Gateway)   │◄─┤  (Orchestr) │         │
│  └──────────────┘  └──────┬───────┘  └──────┬───────┘         │
│                           │                 │                  │
│  ┌──────────────┐  ┌──────┴───────┐  ┌──────┴───────┐         │
│  │  Clouddriver │  │  Igor        │  │  Front50    │         │
│  │  (多云适配)  │  │  (CI 集成)  │  │  (存储)    │         │
│  └──────────────┘  └─────────────┘  └─────────────┘         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              部署目标 (Kubernetes / AWS / GCP / Azure)       │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 安装部署

### Halyard（传统方式）

```bash
# 安装 halyard
curl -O https://storage.googleapis.com/spinnaker-artifacts/halyard/install.sh
bash install.sh --version 1.29.0

# 配置 Kubernetes
hal config provider kubernetes enable
hal config provider kubernetes account add my-k8s \
  --context $(kubectl config current-context)

# 配置 Docker Registry
hal config provider docker-registry enable
hal config provider docker-registry account add my-registry \
  --address index.docker.io \
  --username myuser \
  --password

# 部署
hal deploy apply
```

### Operator（现代方式，K8s 原生）

```bash
# 安装 Operator
kubectl apply -f https://raw.githubusercontent.com/spinnaker-operator/spinnaker-operator/v1.2.0/deploy/crds/spinnaker.io_spinnakerservices.yaml

# 部署 Spinnaker（使用 Kustomize 或 Helm）
kubectl apply -k spinnaker/kustomize

# 配置 GitHub 触发
kubectl edit spinnakerservice spinnaker -n spinnaker
```

## Pipeline：核心流水线

Spinnaker 的 Pipeline 是最核心的概念，类似 Jenkins Pipeline，但功能更丰富。

```json
{
  "name": "Deploy to Production",
  "stages": [
    {
      "type": "bake",
      "name": "Bake Docker Image",
      "regions": ["us-east-1"],
      "templateRenderer": "packer",
      " BakeManifest": {
        "outputName": "myapp",
        "baseOs": "ubuntu",
        "cloudProviderType": "kubernetes",
        "kubernetesImplicitPodSpec": {
          "image": "myregistry/myapp:${trigger.properties.commit_sha}"
        }
      }
    },
    {
      "type": "deploy",
      "name": "Deploy to Production",
      "cloudProvider": "kubernetes",
      "account": "my-k8s",
      "application": "myapp",
      "config": {
        "strategy": "redblack",
        "strategyOptions": {
          "disableSelfPreservation": "true",
          "delayBeforeDisableSec": "600"
        },
        "kato.tasks": [
          {
            "blueGreen": {
              "loadBalancer": "myapp-lb",
              "service": "myapp-service"
            }
          }
        ]
      }
    },
    {
      "type": "trafficManagement",
      "name": "Enable Traffic",
      "targets": [
        {
          "account": "my-k8s",
          "location": "production",
          "type": "kubernetes"
        }
      ]
    }
  ],
  "triggers": [
    {
      "type": "git",
      "repo": {
        "project": "my-org",
        "name": "myapp",
        "branch": "main"
      }
    },
    {
      "type": "docker",
      "organization": "myregistry",
      "image": "myapp",
      "tag": ".*"
    },
    {
      "type": "jenkins",
      "master": "my-jenkins",
      "job": "myapp-build",
      "enabled": true
    }
  ],
  "notifications": [
    {
      "address": "slack:#deployments",
      "level": "complete",
      "when": ["failed", "succeeded"],
      "type": "slack"
    }
  ]
}
```

## 部署策略

### Red/Black（蓝绿）

```json
{
  "type": "deploy",
  "strategy": "redblack",
  "config": {
    "strategyOptions": {
      "delayBeforeDisableSec": "600",
      "delayBeforeScaleSec": "30"
    },
    "maxRemainingAsgs": 2,
    "scaleDown": false
  }
}
```

### Canary（金丝雀）

```json
{
  "type": "canary",
  "config": {
    "canaryConfig": {
      "name": "myapp-canary",
      "configAccount": "my-k8s",
      "storageAccount": "my-minio",
      "scopes": [
        {
          "analysisConfig": {
            "metricInterval": "1m",
            "maxDelayInterval": "5m",
            "queryTimeout": "3m",
            "method": "avg",
            "metric": [
              {
                "name": "kubernetes.pod.cpu.usage.sum",
                "serviceType": "stackdriver"
              }
            ]
          },
          "controlScope": {
            "regions": ["us-east-1"],
            "location": "production",
            "cluster": "main"
          },
          "experimentScope": {
            "regions": ["us-east-1"],
            "location": "production-canary",
            "cluster": "main"
          }
        }
      ]
    },
    "preprocessing": {
      "metricsToIgnore": ["kubernetes.pod.cpu.usage.sum"]
    }
  }
}
```

### Rolling Red/Black（滚动蓝绿）

```json
{
  "type": "deploy",
  "strategy": "rollingredblack",
  "config": {
    "scaleDown": true,
    "maxBatchSize": 10,
    "waitTimeBetweenBatches": 300,
    "rollback": {
      "automatic": true,
      "onFailure": true
    }
  }
}
```

## CI 集成

### Jenkins 触发

```json
{
  "triggers": [
    {
      "type": "jenkins",
      "master": "jenkins-master",
      "job": "myapp-build",
      "propertyFile": "build.properties",
      "enabled": true
    }
  ]
}
```

### Git 触发

```json
{
  "triggers": [
    {
      "type": "git",
      "repo": {
        "project": "my-org",
        "slug": "myapp",
        "branch": "main"
      },
      "enabled": true,
      "payloadConstraints": {
        "commit_sha": ".*"
      }
    }
  ]
}
```

### Docker Registry 触发

```json
{
  "triggers": [
    {
      "type": "docker",
      "organization": "myregistry",
      "image": "myapp",
      "tag": ".*",
      "account": "my-registry",
      "enabled": true
    }
  ]
}
```

## 多云部署

```json
{
  "stages": [
    {
      "type": "deploy",
      "name": "Deploy to AWS",
      "account": "aws-prod",
      "cloudProvider": "aws",
      "target": {
        "type": "exact",
        "region": "us-east-1"
      },
      "config": {
        "strategy": "highlander",
        "application": "myapp",
        "stack": "prod",
        "image": "ami-xxxxx"
      }
    },
    {
      "type": "deploy",
      "name": "Deploy to GCP",
      "account": "gcp-prod",
      "cloudProvider": "gce",
      "target": {
        "type": "exact",
        "region": "us-central1"
      },
      "config": {
        "strategy": "highlander",
        "application": "myapp",
        "stack": "prod"
      }
    },
    {
      "type": "deploy",
      "name": "Deploy to Kubernetes",
      "account": "my-k8s",
      "cloudProvider": "kubernetes",
      "config": {
        "namespace": "production"
      }
    }
  ]
}
```

## 自动化回滚

```json
{
  "stages": [
    {
      "type": "rollbackCluster",
      "name": "Rollback on Failure",
      "context": {
        "credentials": "my-k8s",
        "region": "production",
        "cluster": "myapp",
        "asgName": "myapp-v000"
      },
      "when": {
        "executionWindow": {
          "days": [0, 1, 2, 3, 4, 5, 6],
          "hours": { "start": 0, "end": 23 }
        }
      }
    }
  ]
}
```

## 与 ArgoCD / Tekton 对比

| 维度 | Spinnaker | ArgoCD | Tekton |
|------|-----------|--------|--------|
| 定位 | 多云 CD | GitOps | CI/CD 框架 |
| 多云支持 | 原生支持 K8s/AWS/GCP/Azure | K8s 为主 | K8s 原生 |
| UI | 强大 | 良好 | 较弱（需 Dashboard） |
| 发布策略 | 红黑/金丝雀/滚动 | 需 Argo Rollouts | 需自定义 |
| 入门难度 | 高 | 低 | 中 |
| CI 集成 | 丰富 | 弱 | 中 |
| GitOps | 支持 | 核心能力 | 支持 |

## 适用场景

Spinnaker 适合：

- 大规模多云部署（同时部署到 AWS、GCP、K8s）
- 需要复杂发布策略（金丝雀分析、A/B 测试）
- 有专门的 Spinnaker 运维团队
- 企业级 CD，需求覆盖完整

> 如果你只是 K8s 上的简单部署，ArgoCD 更轻量；如果需要复杂的发布策略和成熟的多云支持，Spinnaker 是首选。

## 面试追问方向

1. **Spinnaker 的多云部署是怎么做到的？**
   答：通过 Clouddriver 抽象层，统一处理不同云厂商的 API。Deployment 描述转换成各云厂商的原生资源（K8s Deployment、AWS ASG、GCP MIG）。

2. **Spinnaker 的 Canary 分析原理是什么？**
   答：同时运行新旧版本（canary vs baseline），采集指标数据，通过 Kayenta（Spinnaker 的 Canary 分析服务）比较两者性能，自动判断是否可以全量上线。

3. **Spinnaker 和 ArgoCD 的本质区别是什么？**
   答：Spinnaker 是 Push 模型（Spinnaker 主动推送部署）；ArgoCD 是 Pull 模型（ArgoCD 监听 Git 变更后拉取部署）。Spinnaker 更适合多云，ArgoCD 更适合纯 K8s GitOps。

4. **Spinnaker 为什么难上手？**
   答：架构复杂（10+ 微服务），配置项多（账户、权限、策略），需要专门的运维团队。对于小型团队，推荐 ArgoCD 或 Tekton。
