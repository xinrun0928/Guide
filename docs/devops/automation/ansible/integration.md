# Ansible 与 Docker、Kubernetes 集成

「Ansible 能和什么集成？」——Ansible 的真正价值，在它的生态里。

Ansible 不仅仅是一个配置管理工具。通过 Dynamic Inventory、Callback 插件、Lookup 插件，Ansible 可以与 Docker 镜像构建、Kubernetes 集群管理深度集成，成为 DevOps 自动化的核心调度引擎。

## Ansible 与 Docker

### docker_container 模块

```yaml
# 启动 Docker 容器
- name: Start nginx container
  docker_container:
    name: nginx
    image: nginx:1.25-alpine
    state: started
    ports:
      - "80:80"
      - "443:443"
    env:
      NGINX_HOST: "{{ ansible_hostname }}"
      NGINX_PORT: "80"
    volumes:
      - /data/nginx/html:/usr/share/nginx/html:ro
    restart_policy: unless-stopped
    networks:
      - name: web_network
    purge_networks: yes

# 启动多个容器
- name: Start application containers
  docker_container:
    name: "{{ item.name }}"
    image: "{{ item.image }}"
    state: started
    replicas: "{{ item.replicas | default(1) }}"
    env:
      APP_ENV: "{{ item.env | default('production') }}"
      DB_HOST: "{{ db_host }}"
    restart_policy: unless-stopped
  loop:
    - { name: web, image: myregistry/web:v1.2.0, env: production }
    - { name: api, image: myregistry/api:v1.2.0, replicas: 2 }
    - { name: worker, image: myregistry/worker:v1.2.0 }
```

### docker_image 模块

```yaml
# 构建 Docker 镜像
- name: Build Docker image
  docker_image:
    name: myregistry/myapp:{{ app_version }}
    build:
      path: /path/to/docker/context
      dockerfile: Dockerfile
      args:
        JAR_FILE: target/app.jar
        VERSION: "{{ app_version }}"
    source: build
    force_source: yes

# 推送镜像到 Registry
- name: Push image to registry
  docker_image:
    name: myregistry/myapp:{{ app_version }}
    repository: myregistry
    tag: "{{ app_version }}"
    push: yes
    force_tag: yes
  when: deploy_to_registry | bool

# 拉取最新镜像
- name: Pull latest image
  docker_image:
    name: myregistry/myapp:latest
    source: pull
    force_source: yes
```

### docker_compose 模块

```yaml
# 使用 Docker Compose 管理多容器应用
- name: Start application stack
  docker_compose:
    project_src: /opt/app
    state: present
    pull: yes
    remove_images: false
    remove_volumes: false
  register: compose_result

# 查看 compose 状态
- name: Show compose status
  command: docker-compose ps
  register: compose_status
  changed_when: false

# 停止并移除服务
- name: Stop application stack
  docker_compose:
    project_src: /opt/app
    state: absent
```

### Docker Registry 集成

```yaml
# 登录到私有 Registry
- name: Login to Docker Registry
  docker_login:
    registry: myregistry.example.com
    username: "{{ docker_registry_user }}"
    password: "{{ docker_registry_password }}"
    email: "{{ docker_registry_email | default(omit) }}"
    state: present

# 登出
- name: Logout from Docker Registry
  docker_login:
    registry: myregistry.example.com
    state: absent
```

## Ansible 与 Kubernetes

### kubernetes.core 集合

```yaml
# 安装集合
ansible-galaxy collection install kubernetes.core
```

### k8s 模块（通用）

```yaml
# 创建 Namespace
- name: Create namespace
  k8s:
    definition:
      apiVersion: v1
      kind: Namespace
      metadata:
        name: "{{ app_namespace }}"
        labels:
          app: myapp
          environment: "{{ env }}"

# 创建 Deployment
- name: Create Deployment
  k8s:
    definition:
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: myapp
        namespace: "{{ app_namespace }}"
        labels:
          app: myapp
      spec:
        replicas: 3
        selector:
          matchLabels:
            app: myapp
        template:
          metadata:
            labels:
              app: myapp
          spec:
            containers:
              - name: myapp
                image: "{{ image }}"
                ports:
                  - containerPort: 8080
                env:
                  - name: ENV
                    value: "{{ env }}"
                resources:
                  requests:
                    cpu: "100m"
                    memory: "256Mi"
                  limits:
                    cpu: "500m"
                    memory: "512Mi"
    validate:
      criteria:
        - version: v1
          group: apps
      fail_on_error: yes

# 创建 Service
- name: Create Service
  k8s:
    definition:
      apiVersion: v1
      kind: Service
      metadata:
        name: myapp
        namespace: "{{ app_namespace }}"
      spec:
        selector:
          app: myapp
        ports:
          - port: 80
            targetPort: 8080
        type: ClusterIP
```

### k8s_info 模块（查询资源）

```yaml
# 查看所有 Pod
- name: Get all pods in namespace
  k8s_info:
    api_version: v1
    kind: Pod
    namespace: "{{ app_namespace }}"
  register: pod_list

- name: Show pod names
  debug:
    msg: "{{ item.metadata.name }}"
  loop: "{{ pod_list.resources }}"

# 查看 Deployment 状态
- name: Get deployment
  k8s_info:
    api_version: apps/v1
    kind: Deployment
    name: myapp
    namespace: "{{ app_namespace }}"
  register: deployment

- name: Show available replicas
  debug:
    msg: "{{ deployment.resources[0].spec.replicas }} available: {{ deployment.resources[0].status.availableReplicas | default(0) }}"
```

### k8s_scale 模块

```yaml
# 扩缩容
- name: Scale deployment
  k8s_scale:
    api_version: apps/v1
    kind: Deployment
    name: myapp
    namespace: "{{ app_namespace }}"
    replicas: "{{ desired_replicas }}"
    current_replicas: "{{ current_replicas }}"
  register: scale_result

- name: Wait for rollout
  pause:
    seconds: 10
  when: scale_result.changed
```

### Helm 模块

```yaml
# 安装 Helm Chart
- name: Install Prometheus
  community.kubernetes.helm:
    name: prometheus
    chart_ref: prometheus-community/prometheus
    release_namespace: monitoring
    values_files:
      - /tmp/prometheus-values.yaml
    state: present

# 获取 Helm 列表
- name: List Helm releases
  community.kubernetes.helm_info:
    name: prometheus
    release_namespace: monitoring
  register: helm_releases

- name: Show release status
  debug:
    msg: "{{ helm_releases.status }}"
```

### Kubernetes Dynamic Inventory

```yaml
# inventory/k8s.yml
# 需要 ansible_collections.kubernetes.core
plugin: kubernetes.core.k8s
connections:
  - host: https://kubernetes.default.svc
    api_key: "{{ lookup('env', 'KUBERNETES_AUTH_TOKEN') }}"
    api_key_ca_cert: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    validate_certs: true
    namespaces:
      - production
    context: production
```

```bash
# 按标签过滤 Pod
ansible-inventory -i inventory/k8s.yml --list | jq '._meta.hostvars | keys'

# 在 K8s Pod 中运行 Ansible
kubectl run ansible-runner --image=quay.io/ansible/awx-runner:latest \
  -it --rm --restart=Never \
  --overrides '{
    "apiVersion": "v1",
    "spec": {
      "serviceAccountName": "ansible-runner",
      "containers": [{
        "env": [
          {"name": "KUBERNETES_AUTH_TOKEN", "valueFrom": {"secretKeyRef": {"name": "ansible-token", "key": "token"}}},
          {"name": "KUBECONFIG", "value": "/runner/.kube/config"}
        ]
      }]
    }
  }'
```

### 完整的 CI/CD 流水线示例

```yaml
# playbooks/k8s-deploy.yml
---
- name: Deploy application to Kubernetes
  hosts: localhost
  gather_facts: no
  vars:
    app_name: myapp
    app_namespace: production
    image_tag: "{{ lookup('env', 'BUILD_NUMBER') | default('latest') }}"

  tasks:
    - name: Ensure namespace exists
      k8s:
        definition:
          apiVersion: v1
          kind: Namespace
          metadata:
            name: "{{ app_namespace }}"
        state: present

    - name: Create ConfigMap
      k8s:
        definition:
          apiVersion: v1
          kind: ConfigMap
          metadata:
            name: "{{ app_name }}-config"
            namespace: "{{ app_namespace }}"
          data:
            app.conf: |
              server.port=8080
              database.url={{ db_url }}
        state: present

    - name: Create Secret
      k8s:
        definition:
          apiVersion: v1
          kind: Secret
          metadata:
            name: "{{ app_name }}-secret"
            namespace: "{{ app_namespace }}"
          type: Opaque
          stringData:
            DB_PASSWORD: "{{ db_password }}"
            API_KEY: "{{ api_key }}"
        state: present

    - name: Deploy application
      k8s:
        definition:
          apiVersion: apps/v1
          kind: Deployment
          metadata:
            name: "{{ app_name }}"
            namespace: "{{ app_namespace }}"
            annotations:
              checksum/config: "{{ app_config_checksum }}"
          spec:
            replicas: 3
            strategy:
              type: RollingUpdate
              rollingUpdate:
                maxSurge: 1
                maxUnavailable: 0
            selector:
              matchLabels:
                app: "{{ app_name }}"
            template:
              metadata:
                labels:
                  app: "{{ app_name }}"
              spec:
                serviceAccountName: "{{ app_name }}-sa
                containers:
                  - name: app
                    image: myregistry/{{ app_name }}:{{ image_tag }}
                    ports:
                      - containerPort: 8080
                    envFrom:
                      - configMapRef:
                          name: "{{ app_name }}-config"
                      - secretRef:
                          name: "{{ app_name }}-secret"
                    readinessProbe:
                      httpGet:
                        path: /actuator/health/readiness
                        port: 8080
                      initialDelaySeconds: 30
                      periodSeconds: 10
                    livenessProbe:
                      httpGet:
                        path: /actuator/health/liveness
                        port: 8080
                      initialDelaySeconds: 60
                      periodSeconds: 15
                    resources:
                      requests:
                        cpu: "100m"
                        memory: "256Mi"
                      limits:
                        cpu: "500m"
                        memory: "512Mi"
        state: present
        validate:
          criteria:
            - version: v1
              group: apps
          fail_on_error: yes

    - name: Create Service
      k8s:
        definition:
          apiVersion: v1
          kind: Service
          metadata:
            name: "{{ app_name }}"
            namespace: "{{ app_namespace }}"
          spec:
            selector:
              app: "{{ app_name }}"
            ports:
              - port: 80
                targetPort: 8080
            type: ClusterIP
        state: present

    - name: Create Ingress
      k8s:
        definition:
          apiVersion: networking.k8s.io/v1
          kind: Ingress
          metadata:
            name: "{{ app_name }}"
            namespace: "{{ app_namespace }}"
            annotations:
              nginx.ingress.kubernetes.io/ssl-redirect: "true"
              cert-manager.io/cluster-issuer: "letsencrypt-prod"
        state: present
      when: create_ingress | default(false) | bool

    - name: Wait for rollout
      k8s_info:
        api_version: apps/v1
        kind: Deployment
        name: "{{ app_name }}"
        namespace: "{{ app_namespace }}"
      register: deployment_info
      until: deployment_info.resources[0].status.availableReplicas | int >= 3
      retries: 30
      delay: 10

    - name: Verify deployment
      k8s_info:
        api_version: v1
        kind: Pod
        namespace: "{{ app_namespace }}"
        label_selectors:
          - app={{ app_name }}
      register: pods

    - name: Health check
      uri:
        url: "http://{{ app_name }}.{{ app_namespace }}.svc.cluster.local/actuator/health"
        validate_certs: no
      register: health
      retries: 10
      delay: 5
      until: health.status == 200
```

## Secret 管理

### Vault 集成

```yaml
# 从 HashiCorp Vault 获取密钥
- name: Fetch secrets from Vault
  set_fact:
    db_password: "{{ lookup('community.hashi_vault', 'secret/data/production/db:password') }}"
    api_key: "{{ lookup('community.hashi_vault', 'secret/data/production/api:key') }}"
```

```yaml
# 使用 Ansible Vault 加密敏感变量
# vars/production.yml (加密后)
---
db_password: "vault_encrypted_value"
api_key: "vault_encrypted_value"
ssl_cert: |
  -----BEGIN CERTIFICATE-----
  vault_encrypted_value
  -----END CERTIFICATE-----
```

## GitOps 工作流

### Ansible + ArgoCD 组合

```yaml
# Ansible 更新 Git 中的配置，ArgoCD 自动同步到集群
- name: Update Helm values in Git
  ansible.builtin.replace:
    path: "/tmp/git-repo/values/{{ env }}.yaml"
    regexp: '^\s*image:\s*tag:\s*".*"'
    replace: '  image:\n    tag: "{{ new_version }}"'

- name: Commit and push changes
  ansible.builtin.git:
    repo: "{{ git_repo }}"
    dest: /tmp/git-repo
    version: main
    force: yes
  register: git_push
```

## 面试追问方向

1. **Ansible 如何动态发现 Kubernetes 集群中的资源？**
   答：使用 `kubernetes.core.k8s` 插件作为 Dynamic Inventory，通过 Kubernetes API Server 自动发现所有 Namespace、Pod、Service 等资源，支持标签过滤和字段选择器。

2. **Ansible 和 kubectl 的区别是什么？**
   答：kubectl 是命令式工具，执行具体操作（`kubectl apply`）；Ansible 是声明式工具，描述目标状态（Deployment 配置），幂等执行——如果资源已存在且配置一致，则不做任何变更。

3. **如何通过 Ansible 安全地管理 K8s Secret？**
   答：使用 HashiCorp Vault 存储敏感信息，通过 `community.hashi_vault` lookup 动态获取；或使用 Ansible Vault 加密变量文件；避免在 Playbook 或 Git 仓库中明文存储 Secret。

4. **Ansible 在 K8s 环境中的典型使用场景是什么？**
   答：集群初始化（安装组件、配置网络）、应用部署（Helm Chart 管理）、配置更新（ConfigMap/Secret 更新）、扩缩容、多环境一致性管理。适合管理 K8s 本身而非 Pod 内应用。

Ansible 与 Docker/Kubernetes 的集成，让基础设施管理变得标准化和可重复。从镜像构建到集群部署，从配置管理到 Secret 注入，Ansible 可以在整个 DevOps 流程中扮演核心角色。
