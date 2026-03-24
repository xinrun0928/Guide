# Tekton 云原生流水线

「Tekton 是什么？」——Kubernetes 原生的 CI/CD 框架，流水线即代码，资源定义在 CRD 里。

Tekton 脱胎于 Google 的 Knative Build 项目，是 CNCF 官方项目。它的设计理念和 Kubernetes 完全一致：声明式、API 驱动、可扩展、多租户。你可以把 Tekton 理解为「专门为流水线设计的 Kubernetes Operator」。

## 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                     Tekton 核心资源                               │
│                                                                  │
│  Task (任务)                                                     │
│  ├── steps: [build, test, push]                                  │
│  └── workspaces: 共享存储                                       │
│                                                                  │
│  TaskRun (任务运行) — Task 的运行时实例                          │
│                                                                  │
│  Pipeline (流水线)                                               │
│  ├── tasks: [TaskA, TaskB, TaskC]                               │
│  └── conditions: [when, finally]                                │
│                                                                  │
│  PipelineRun (流水线运行) — Pipeline 的运行时实例                │
│                                                                  │
│  PipelineResource (资源) — 输入/输出定义                        │
│  ├── git, image, cluster, storage 等                            │
└─────────────────────────────────────────────────────────────────┘
```

## Task：原子任务

```yaml
# task-maven.yaml
apiVersion: tekton.dev/v1beta1
kind: Task
metadata:
  name: maven-build
  namespace: ci
spec:
  # 步骤列表，每个 step 是一个容器
  steps:
    - name: mvn-version
      image: maven:3.9-eclipse-temurin-17
      command:
        - mvn
      args:
        - --version

    - name: build
      image: maven:3.9-eclipse-temurin-17
      command:
        - mvn
      args:
        - clean
        - package
        - -DskipTests
      workingDir: /workspace/source  # 指定工作目录
      env:
        - name: MAVEN_OPTS
          value: "-Dmaven.repo.local=/workspace/m2"

    - name: test
      image: maven:3.9-eclipse-temurin-17
      command:
        - mvn
      args:
        - test
      workingDir: /workspace/source

  # 工作空间，多个 step 共享
  workspaces:
    - name: source
      mountPath: /workspace/source
    - name: m2-cache
      mountPath: /workspace/m2
```

### Task 的输入输出

```yaml
# task-build-push.yaml
apiVersion: tekton.dev/v1beta1
kind: Task
metadata:
  name: build-push-image
spec:
  params:
    - name: image
      description: Image to build and push
    - name: context
      description: Build context path
      default: .
    - name: dockerfile
      description: Dockerfile path
      default: Dockerfile

  steps:
    - name: build
      image: docker:24-dind
      script: |
        #!/bin/sh
        docker build -t $(params.image):$(tasks.results.commit-sha.default) .
      securityContext:
        privileged: true
      volumeMounts:
        - name: docker-socket
          mountPath: /var/run/docker.sock

    - name: push
      image: docker:24
      script: |
        #!/bin/sh
        docker push $(params.image):$(tasks.results.commit-sha.default)
      env:
        - name: DOCKER_CONFIG
          value: /workspace/docker-config

  resources:
    inputs:
      - name: source
        type: git
    outputs:
      - name: image
        type: image

  volumes:
    - name: docker-socket
      hostPath:
        path: /var/run/docker.sock
```

## Pipeline：流水线编排

```yaml
# pipeline.yaml
apiVersion: tekton.dev/v1beta1
kind: Pipeline
metadata:
  name: app-pipeline
  namespace: ci
spec:
  # 参数定义
  params:
    - name: repo-url
      type: string
    - name: image
      type: string
    - name: namespace
      type: string
      default: production

  # 工作空间（共享存储）
  workspaces:
    - name: shared-workspace
    - name: docker-config

  # 任务列表
  tasks:
    # 第一个任务：拉取代码
    - name: fetch-repository
      taskRef:
        name: git-clone
      params:
        - name: url
          value: $(params.repo-url)
        - name: revision
          value: main
      workspaces:
        - name: output
          workspace: shared-workspace

    # 第二个任务：构建
    - name: build
      taskRef:
        name: maven-build
      runAfter:
        - fetch-repository  # 在 fetch 之后运行
      params:
        - name: GOALS
          value:
            - clean
            - package
      workspaces:
        - name: source
          workspace: shared-workspace
        - name: m2-cache
          workspace: maven-cache

    # 第三个任务：测试
    - name: test
      taskRef:
        name: maven-test
      runAfter:
        - build
      params:
        - name: TEST_OPTS
          value: "-DreportFormat=xml"
      workspaces:
        - name: source
          workspace: shared-workspace
      # 任务结果（用于后续任务）
      results:
        - name: test-report
          description: Location of test report

    # 第四个任务：镜像构建与推送
    - name: build-image
      taskRef:
        name: build-push-image
      runAfter:
        - test
      params:
        - name: image
          value: $(params.image)
        - name: context
          value: .
      workspaces:
        - name: docker-config
          workspace: docker-config
      resources:
        inputs:
          - name: source
            resourceRef:
              name: $(tasks.fetch-repository.results.gitrevision)

    # 第五个任务：部署
    - name: deploy
      taskRef:
        name: kubectl-deploy
      runAfter:
        - build-image
      params:
        - name: namespace
          value: $(params.namespace)
        - name: image
          value: $(params.image)
      resources:
        inputs:
          - name: source
            resourceRef:
              name: $(tasks.fetch-repository.results.gitrevision)
```

## PipelineRun：触发执行

```yaml
# pipelinerun.yaml
apiVersion: tekton.dev/v1beta1
kind: PipelineRun
metadata:
  name: app-pipeline-run-$(context.pipelineRun.name)
  generateName: app-pipeline-run-
spec:
  pipelineRef:
    name: app-pipeline

  # 参数覆盖
  params:
    - name: repo-url
      value: https://github.com/my-org/my-app.git
    - name: image
      value: registry.example.com/my-org/my-app
    - name: namespace
      value: production

  # PVC 用于工作空间
  workspaces:
    - name: shared-workspace
      volumeClaimTemplate:
        spec:
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 1Gi
    - name: maven-cache
      volumeClaimTemplate:
        spec:
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 2Gi
    - name: docker-config
      secret:
        secretName: docker-config

  # ServiceAccount（用于镜像推送、kubectl 操作）
  serviceAccountName: tekton-pipeline

  # 超时设置
  timeout: 1h0m0s

  # 标签
  labels:
    app: my-app
    environment: production
```

## 条件执行与 finally

```yaml
# pipeline-with-conditions.yaml
apiVersion: tekton.dev/v1beta1
kind: Pipeline
metadata:
  name: pipeline-with-finally
spec:
  tasks:
    - name: deploy
      taskRef:
        name: kubectl-deploy
      # 条件：仅 main 分支部署到 production
      conditions:
        - conditionRef: cel-equal
          params:
            - name: value1
              value: $(tasks.clone.results.branch)
            - name: value2
              value: "main"

    - name: send-notification
      taskRef:
        name: slack-notify
      runAfter:
        - deploy
      # 无论成功失败都执行
      finally:
        - name: cleanup
          taskRef:
            name: cleanup-workspace
```

## Task vs Pipeline vs PipelineRun

| 资源 | 生命周期 | 说明 |
|-----|---------|------|
| Task | 静态定义 | 定义一个或多个步骤，类似 Makefile |
| TaskRun | 运行时实例 | 执行一个 Task，产生实际运行记录 |
| Pipeline | 静态定义 | 定义多个 Task 的执行顺序和依赖关系 |
| PipelineRun | 运行时实例 | 执行一个 Pipeline，产生实际运行记录 |

## Triggers：事件驱动

```yaml
# TriggerTemplate：定义 PipelineRun 模板
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerTemplate
metadata:
  name: app-pipeline-template
spec:
  params:
    - name: git-revision
    - name: git-url
    - name: commit-sha

  resourceTemplates:
    - apiVersion: tekton.dev/v1beta1
      kind: PipelineRun
      metadata:
        generateName: app-pipeline-run-
      spec:
        pipelineRef:
          name: app-pipeline
        params:
          - name: repo-url
            value: $(tt.params.git-url)
        workspaces:
          - name: shared-workspace
            volumeClaimTemplate:
              spec:
                accessModes:
                  - ReadWriteOnce
                resources:
                  requests:
                    storage: 1Gi

---
# TriggerBinding：绑定事件数据
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerBinding
metadata:
  name: app-binding
spec:
  params:
    - name: git-url
      value: $(body.repository.clone_url)
    - name: git-revision
      value: $(body.ref)
    - name: commit-sha
      value: $(body.after)

---
# EventListener：监听器
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata:
  name: app-listener
spec:
  serviceAccountName: tekton-triggers
  triggers:
    - name: push-trigger
      bindings:
        - ref: app-binding
      template:
        ref: app-pipeline-template
      interceptors:
        - ref:
            name: cel
          params:
            - name: filter
              value: body.ref.startsWith("refs/heads/main")
```

## 最佳实践

### 1. 使用 Workspace 共享数据

```yaml
# 所有任务共享同一个 PVC，避免重复拉取代码
tasks:
  - name: clone
    taskRef: { name: git-clone }
    workspaces:
      - name: output
        workspace: shared-workspace

  - name: build
    taskRef: { name: build }
    workspaces:
      - name: source
        workspace: shared-workspace
```

### 2. 善用 TaskRun 结果

```yaml
# build 任务生成 commit-sha
steps:
  - name: save-commit
    image: alpine
    script: |
      #!/bin/sh
      echo -n "$(params.git-revision)" | tee /tekton/results/commit-sha

# deploy 任务引用它
params:
  - name: commit
    value: $(tasks.build.results.commit-sha)
```

### 3. 设置超时和重试

```yaml
spec:
  # 任务级超时
  timeout: 30m

  # Pipeline 任务重试
  tasks:
    - name: flaky-task
      taskRef: { name: some-task }
      retries: 2  # 失败后重试 2 次
```

## Tekton vs ArgoCD Workflows vs Jenkins Pipeline

| 维度 | Tekton | ArgoCD Workflows | Jenkins Pipeline |
|------|--------|---------------|----------------|
| 设计理念 | Kubernetes 原生 CRD | Kubernetes 原生 CRD | Jenkins DSL |
| 可视化 | Tekton Dashboard / Red Hat Pipelines | Argo UI | Jenkins Blue Ocean |
| 多租户 | 原生支持（不同 namespace） | 通过 Project | 需要矩阵授权 |
| YAML vs DSL | YAML | YAML | Groovy DSL |
| 生态 | Tekton Hub | Argo Rollouts | 插件市场 |
| CI/CD 专注度 | 专注流水线 | GitOps 为主 | 全能型 |

## 面试追问方向

1. **Tekton 为什么是「Kubernetes 原生」？**
   答：所有资源都是 CRD，存储在 etcd 里，和 K8s 的理念完全一致——声明式、API 驱动、多租户隔离。

2. **Tekton 的 Pipeline 和 Jenkins Pipeline 有什么本质区别？**
   答：Jenkins Pipeline 是 Groovy DSL，写在 Jenkinsfile 里；Tekton Pipeline 是 YAML，写在 K8s CRD 里。Tekton 的 CRD 可以用 `kubectl` 管理，和 K8s 生态完全打通。

3. **如何实现 Tekton 流水线可视化？**
   答：可以用 Tekton Dashboard（官方），或者与 ArgoCD 集成后在 ArgoCD UI 中查看，也可以在 Jenkins、GitLab CI 等外部调度器中调用 Tekton Pipeline。

4. **Tekton 的多任务依赖是如何实现的？**
   答：通过 `runAfter` 声明顺序，通过 `TaskRun` 之间的 `Results` 传递数据，通过 Workspace 共享状态。

Tekton 是云原生时代的 CI/CD 框架，它的本质是把 Jenkins 的能力用 K8s 的方式重新实现了一遍。对于已经在 K8s 上的团队，Tekton 是最自然的选择。
