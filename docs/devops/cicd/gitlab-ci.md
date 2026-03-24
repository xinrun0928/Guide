# GitLab CI/CD 流水线语法

「GitLab CI 怎么写？」——`.gitlab-ci.yml` 是答案。

GitLab CI 是 GitLab 的内置 CI/CD 功能，无需额外安装服务器。`.gitlab-ci.yml` 文件放在项目根目录，GitLab Runner 执行流水线。相比 Jenkins，GitLab CI 的配置更简单、更直观。

## 核心概念

```
┌──────────────────────────────────────────────────────────────┐
│                       GitLab CI/CD                            │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   .gitlab-   │  │ GitLab Runner │  │    GitLab     │   │
│  │   ci.yml      │─►│  (执行器)    │─►│  流水线视图   │   │
│  │  流水线定义   │  │ Docker/K8s   │  │              │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## 基础结构

```yaml
# .gitlab-ci.yml
stages:          # 定义流水线阶段
  - build
  - test
  - deploy

variables:       # 全局环境变量
  APP_NAME: "my-service"
  REGISTRY: "registry.example.com"

before_script:    # 每个 job 执行前运行
  - echo "Starting job..."

build-job:
  stage: build    # 指定阶段
  image: maven:3.9-eclipse-temurin-17  # Docker 镜像
  script:          # 执行命令
    - mvn clean package
  artifacts:       # 产物传递
    paths:
      - target/*.jar
    expire_in: 1 week
  tags:            # 指定 Runner
    - maven

test-job:
  stage: test
  image: maven:3.9-eclipse-temurin-17
  script:
    - mvn test
  dependencies:    # 依赖上一个阶段产物
    - build-job
  tags:
    - maven

deploy-job:
  stage: deploy
  script:
    - kubectl set image deployment/$APP_NAME app=$REGISTRY/$APP_NAME:$CI_COMMIT_SHA
    - kubectl rollout status deployment/$APP_NAME
  environment:     # 环境配置
    name: production
    url: https://myapp.example.com
  when: manual     # 手动触发
  only:
    - main
```

## stages 和 jobs

### stages（阶段）

```yaml
stages:
  - build    # 第一阶段
  - test     # 第二阶段
  - deploy   # 第三阶段
  - cleanup  # 第四阶段
```

同 stage 的 jobs 并行执行，不同 stage 的 jobs 按顺序执行。

### jobs（任务）

```yaml
build-frontend:
  stage: build
  image: node:20
  script:
    - cd frontend && npm install && npm run build
  artifacts:
    paths:
      - frontend/dist/
    expire_in: 1 hour

build-backend:
  stage: build
  image: maven:3.9
  script:
    - mvn clean package -DskipTests
  artifacts:
    paths:
      - target/*.jar
    expire_in: 1 hour
```

## script 命令

```yaml
test-unit:
  stage: test
  image: node:20
  script:
    - npm install
    - npm run test:unit
    - npm run lint
```

## before_script / after_script

```yaml
job:
  before_script:
    - echo "Starting job..."
    - chmod +x ./setup.sh
  script:
    - ./setup.sh
    - npm run build
  after_script:
    - echo "Cleaning up..."
    - rm -rf node_modules/
```

## artifacts（产物）

```yaml
build:
  stage: build
  script:
    - mvn clean package
  artifacts:
    paths:
      - target/*.jar
      - build/reports/
    expire_in: 1 week    # 默认保留 1 周
    exclude:
      - node_modules/  # 不包含这些文件
    reports:           # 测试报告格式
      junit: target/surefire-reports/*.xml
      coverage: target/coverage.xml
```

### dependencies

```yaml
test:
  stage: test
  dependencies:    # 只下载指定 jobs 的产物
    - build
  script:
    - mvn test
```

## 触发规则：only / except

```yaml
deploy-production:
  stage: deploy
  only:
    - main         # 只在 main 分支运行
    - tags         # 只在打标签时运行
    - triggers     # 只在 webhook 触发时运行
    - /^feature/   # 正则匹配分支
    - schedules    # 定时任务
  except:
    - development  # 不在 development 分支运行

deploy-staging:
  stage: deploy
  only:
    - develop
    - main
```

## rules（现代方式，推荐）

```yaml
deploy-production:
  stage: deploy
  script:
    - kubectl apply -f k8s/
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'  # main 分支
    - if: '$CI_COMMIT_TAG'                 # 标签推送
      when: manual                          # 但手动触发
  environment:
    name: production
    on_stop: stop-production
```

## 条件判断

```yaml
job:
  script:
    - echo "Running..."
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      when: manual
    - if: '$CI_COMMIT_BRANCH == "main"'
    - when: never   # 其他情况不运行
```

## 并行矩阵

```yaml
test-matrix:
  stage: test
  parallel:
    matrix:
      - JDK_VERSION: [11, 17, 21]
        PLATFORM: [ubuntu, alpine]
  script:
    - ./gradlew test --tests "*Test" -Djdk=$JDK_VERSION
```

## extends 继承

```yaml
# 基础模板
.base-job:
  before_script:
    - echo "Starting..."
  retry:
    max: 2
    when: runner_system_failure

build-template:
  extends: .base-job
  stage: build
  script:
    - mvn clean package

test-template:
  extends: .base-job
  stage: test
  script:
    - mvn test
```

## include 包含外部文件

```yaml
# 包含其他 CI 文件
include:
  - local: 'templates/.docker.yml'
  - project: 'my-group/my-project'
    file: 'templates/.gitlab-ci.yml'
  - remote: 'https://example.com/ci-template.yml'
  - local: '.gitlab-ci-build.yml'
```

## cache 缓存

```yaml
build:
  stage: build
  cache:
    key: ${CI_COMMIT_REF_SLUG}
    paths:
      - node_modules/
      - .m2/repository
    policy: pull-push  # 默认：构建前拉取，构建后推送
```

## GitLab CI vs Jenkins vs GitHub Actions

| 维度 | GitLab CI | Jenkins | GitHub Actions |
|------|---------|--------|---------------|
| 配置位置 | .gitlab-ci.yml | Jenkinsfile | .github/workflows/*.yml |
| 执行器 | GitLab Runner | Jenkins Agent | GitHub Hosted / Self-Hosted |
| 语法 | YAML | Groovy DSL | YAML |
| 镜像支持 | Docker / K8s / SSH | Docker / VM / K8s | Docker / VM |
| 多分支流水线 | 自动 | 需插件（Multibranch） | 自动 |
| 模板复用 | include | Shared Libraries | Reusable Workflows |

> GitLab CI 的 `.gitlab-ci.yml` 是 YAML 配置，简单直观。它把流水线定义和代码放在一起，通过 Git 统一管理，比 Jenkins 更适合「配置即代码」的理念。
