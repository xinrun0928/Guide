# Ansible 与 Docker、Kubernetes 集成

「Ansible 能管容器和 K8s 吗？」——能，而且管得很好。

Ansible 的价值不只是配置服务器，它还是容器和 Kubernetes 集群的自动化编排利器。从 Dockerfile 构建到 Docker Compose 部署，从 K8s 资源创建到 Helm Chart 管理，Ansible 都能覆盖。

## Ansible + Docker

### Docker 模块

```yaml
# docker-basics.yml
---
- name: Docker 基础操作
  hosts: docker_hosts
  become: true
  vars:
    docker_version: "24.0"
    registry_user: myuser
    registry_password: "{{ vault_dockerhub_password }}"

  tasks:
    # 安装 Docker
    - name: Install Docker
      ansible.builtin.package:
        name:
          - docker.io
          - docker-compose
        state: present

    - name: Start Docker service
      ansible.builtin.service:
        name: docker
        state: started
        enabled: yes

    # 登录镜像仓库
    - name: Login to Docker Hub
      docker_login:
        registry: https://index.docker.io/v1/
        username: "{{ registry_user }}"
        password: "{{ registry_password }}"

    # 构建镜像
    - name: Build Docker image
      docker_image:
        name: myapp
        tag: "{{ app_version }}"
        build:
          path: /opt/app
          dockerfile: Dockerfile
          pull: yes
        source: build
        force_source: yes
      register: image_build

    - name: Tag image
      docker_image:
        name: myapp:{{ app_version }}
        repository: registry.example.com/myapp:{{ app_version }}
        source: local

    # 推送镜像
    - name: Push image to registry
      docker_image:
        name: registry.example.com/myapp:{{ app_version }}
        push: yes
        source: local

    # 运行容器
    - name: Run container
      docker_container:
        name: myapp
        image: registry.example.com/myapp:{{ app_version }}
        state: started
        restart_policy: always
        ports:
          - "8080:8080"
        env:
          DATABASE_URL: "{{ db_url }}"
          REDIS_URL: "{{ redis_url }}"
        volumes:
          - app-data:/data
        networks:
          - name: app-network
        healthcheck:
          test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
          interval: 30s
          timeout: 10s
          retries: 3
          start_period: 40s
```

### Docker Compose 模块

```yaml
# docker-compose.yml
---
- name: Deploy application with Docker Compose
  hosts: docker_hosts
  become: true
  vars:
    compose_version: "2.20"
    app_dir: /opt/myapp

  tasks:
    # 安装 Docker Compose v2
    - name: Install Docker Compose
      ansible.builtin.get_url:
        url: "https://github.com/docker/compose/releases/download/v{{ compose_version }}/docker-compose-linux-x86_64"
        dest: /usr/local/bin/docker-compose
        mode: '0755'

    # 创建应用目录
    - name: Create application directory
      ansible.builtin.file:
        path: "{{ app_dir }}"
        state: directory
        owner: ubuntu
        group: ubuntu
        mode: '0755'

    # 复制 docker-compose 文件
    - name: Deploy docker-compose.yml
      ansible.builtin.copy:
        src: docker-compose.yml.j2
        dest: "{{ app_dir }}/docker-compose.yml"

    # 使用 docker_compose_v2 模块
    - name: Pull images
      docker_compose_v2:
        project_src: "{{ app_dir }}"
        state: present
      register: compose_pull

    - name: Start services
      docker_compose_v2:
        project_src: "{{ app_dir }}"
        state: running
      register: compose_up

    - name: Show service status
      ansible.builtin.debug:
        var: compose_up.services

    # 或者用 docker_compose（v1 兼容）
    - name: Deploy with docker-compose command
      ansible.builtin.command: |
        docker-compose -f {{ app_dir }}/docker-compose.yml up -d
      args:
        chdir: "{{ app_dir }}"
      register: compose_result

    - name: Wait for services to be healthy
      ansible.builtin.wait_for:
        host: "{{ inventory_hostname }}"
        port: 8080
        timeout: 60
```

```yaml
# docker-compose.yml.j2
version: "3.8"

services:
  app:
    image: registry.example.com/myapp:{{ app_version | default('latest') }}
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgresql://{{ db_user }}:{{ db_password }}@db:5432/myapp
      - REDIS_URL=redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - app-network
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=myapp
      - POSTGRES_USER={{ db_user }}
      - POSTGRES_PASSWORD={{ db_password }}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U {{ db_user }}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    networks:
      - app-network

networks:
  app-network:
    driver: bridge

volumes:
  postgres-data:
```

## Ansible + Kubernetes

### Kubernetes 模块

```yaml
# k8s-basics.yml
---
- name: Kubernetes 资源管理
  hosts: localhost
  gather_facts: no
  vars:
    k8s_context: production
    namespace: myapp
    app_version: "v1.2.3"

  tasks:
    # 加载 kubeconfig
    - name: Load kubeconfig
      ansible.builtin.set_fact:
        k8s_auth:
          kubeconfig: "{{ kubeconfig_path }}"

    # 创建 Namespace
    - name: Create namespace
      k8s:
        definition:
          apiVersion: v1
          kind: Namespace
          metadata:
            name: "{{ namespace }}"
        kubeconfig: "{{ kubeconfig_path }}"
        context_name: "{{ k8s_context }}"

    # 创建 Deployment
    - name: Deploy application
      k8s:
        definition:
          apiVersion: apps/v1
          kind: Deployment
          metadata:
            name: myapp
            namespace: "{{ namespace }}"
            labels:
              app: myapp
              version: "{{ app_version }}"
          spec:
            replicas: 3
            selector:
              matchLabels:
                app: myapp
            template:
              metadata:
                labels:
                  app: myapp
                  version: "{{ app_version }}"
              spec:
                containers:
                  - name: myapp
                    image: registry.example.com/myapp:{{ app_version }}
                    ports:
                      - containerPort: 8080
                    env:
                      - name: DATABASE_URL
                        valueFrom:
                          secretKeyRef:
                            name: myapp-secrets
                            key: database-url
                    resources:
                      requests:
                        cpu: "100m"
                        memory: "256Mi"
                      limits:
                        cpu: "500m"
                        memory: "512Mi"
                    livenessProbe:
                      httpGet:
                        path: /health
                        port: 8080
                      initialDelaySeconds: 30
                      periodSeconds: 10
                    readinessProbe:
                      httpGet:
                        path: /ready
                        port: 8080
                      initialDelaySeconds: 5
                      periodSeconds: 5
        kubeconfig: "{{ kubeconfig_path }}"
      register: app_deployment

    - name: Show deployment result
      ansible.builtin.debug:
        var: app_deployment

    # 创建 Service
    - name: Create Service
      k8s:
        definition:
          apiVersion: v1
          kind: Service
          metadata:
            name: myapp
            namespace: "{{ namespace }}"
          spec:
            type: ClusterIP
            selector:
              app: myapp
            ports:
              - port: 80
                targetPort: 8080
        kubeconfig: "{{ kubeconfig_path }}"

    # 创建 Ingress
    - name: Create Ingress
      k8s:
        definition:
          apiVersion: networking.k8s.io/v1
          kind: Ingress
          metadata:
            name: myapp
            namespace: "{{ namespace }}"
            annotations:
              nginx.ingress.kubernetes.io/rewrite-target: /
        kubeconfig: "{{ kubeconfig_path }}"
```

### Helm 模块

```yaml
# k8s-helm.yml
---
- name: 使用 Helm 部署应用
  hosts: localhost
  gather_facts: no
  vars:
    kubeconfig_path: /path/to/kubeconfig
    release_name: prometheus
    release_namespace: monitoring
    helm_version: "3.13.0"

  tasks:
    # 安装 Helm
    - name: Install Helm
      ansible.builtin.get_url:
        url: "https://get.helm.sh/helm-v{{ helm_version }}-linux-amd64.tar.gz"
        dest: /tmp/helm.tar.gz
        mode: '0644'

    - name: Extract Helm
      ansible.builtin.unarchive:
        src: /tmp/helm.tar.gz
        dest: /tmp
        remote_src: yes

    - name: Install Helm binary
      ansible.builtin.copy:
        src: /tmp/linux-amd64/helm
        dest: /usr/local/bin/helm
        remote_src: yes
        mode: '0755'

    # 添加 Helm Repo
    - name: Add Helm repos
      ansible.builtin.shell: |
        helm repo add bitnami https://charts.bitnami.com/bitnami
        helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
        helm repo update
      args:
        creates: /root/.helm/repositories.yaml

    # 部署 Chart
    - name: Deploy Prometheus with Helm
      k8s:
        definition:
          apiVersion: v1
          kind: Namespace
          metadata:
            name: "{{ release_namespace }}"
      register: ns_result

    - name: Install Prometheus
      k8s_helm:
        name: prometheus
        chart_ref: prometheus-community/prometheus
        release_namespace: "{{ release_namespace }}"
        values_files:
          - /path/to/prometheus-values.yaml
        kubeconfig: "{{ kubeconfig_path }}"
        create_namespace: yes
      register: helm_release

    - name: Show release status
      ansible.builtin.debug:
        var: helm_release

    # 升级 Chart
    - name: Upgrade Prometheus
      k8s_helm:
        name: prometheus
        chart_ref: prometheus-community/prometheus
        release_namespace: "{{ release_namespace }}"
        values:
          server:
            replicaCount: 3
            persistentVolume:
              enabled: true
              size: 50Gi
        kubeconfig: "{{ kubeconfig_path }}"
        update_policy: upgrade
      register: helm_upgrade

    # 回滚
    - name: Rollback Prometheus
      k8s_helm:
        name: prometheus
        release_namespace: "{{ release_namespace }}"
        kubeconfig: "{{ kubeconfig_path }}"
        action: rollback
        revision: 1
```

### Kustomize 集成

```yaml
# k8s-kustomize.yml
---
- name: Kustomize 部署
  hosts: localhost
  gather_facts: no

  tasks:
    # 安装 Kustomize
    - name: Install Kustomize
      ansible.builtin.shell: |
        curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash -s -- 5.2.2
        mv kustomize /usr/local/bin/
      args:
        creates: /usr/local/bin/kustomize

    # 使用 k8s 模块应用 Kustomize
    - name: Apply with kustomize
      k8s:
        definition:
          apiVersion: kustomize.toolkit.fluxcd.io/v1beta2
          kind: Kustomization
          metadata:
            name: myapp
            namespace: flux-system
          spec:
            path: ./deploy/overlays/production
            prune: true
            sourceRef:
              kind: GitRepository
              name: myapp
        kubeconfig: "{{ kubeconfig_path }}"

    # 直接执行 kustomize build
    - name: Build Kustomize manifests
      ansible.builtin.command: kustomize build deploy/overlays/production
      register: kustomize_output
      changed_when: false

    - name: Apply Kustomize output
      k8s:
        definition: "{{ kustomize_output.stdout }}"
        kubeconfig: "{{ kubeconfig_path }}"
```

## 实际场景：完整的 CI/CD 流程

```yaml
# deploy.yml
---
- name: Build, Push, Deploy Pipeline
  hosts: localhost
  gather_facts: no
  vars:
    app_name: myapp
    git_repo: https://github.com/myorg/myapp.git
    registry: registry.example.com
    kubeconfig: /path/to/prod-kubeconfig

  tasks:
    # 1. 构建阶段
    - name: Clone repository
      ansible.builtin.git:
        repo: "{{ git_repo }}"
        dest: /tmp/{{ app_name }}
        version: "{{ git_ref | default('main') }}"
        force: yes

    - name: Build Docker image
      docker_image:
        name: "{{ app_name }}"
        tag: "{{ image_tag }}"
        build:
          path: /tmp/{{ app_name }}
          pull: yes
        source: build
        force_source: yes
        push: yes
        repository: "{{ registry }}/{{ app_name }}"
      register: build_result

    # 2. 部署阶段
    - name: Create namespace if not exists
      k8s:
        definition:
          apiVersion: v1
          kind: Namespace
          metadata:
            name: "{{ app_name }}"
        kubeconfig: "{{ kubeconfig }}"
        apply: yes

    - name: Deploy application
      k8s:
        definition:
          apiVersion: apps/v1
          kind: Deployment
          metadata:
            name: "{{ app_name }}"
            namespace: "{{ app_name }}"
          spec:
            replicas: 3
            selector:
              matchLabels:
                app: "{{ app_name }}"
            strategy:
              type: RollingUpdate
              rollingUpdate:
                maxSurge: 1
                maxUnavailable: 0
            template:
              metadata:
                labels:
                  app: "{{ app_name }}"
                  version: "{{ image_tag }}"
              spec:
                containers:
                  - name: "{{ app_name }}"
                    image: "{{ registry }}/{{ app_name }}:{{ image_tag }}"
                    ports:
                      - containerPort: 8080
        kubeconfig: "{{ kubeconfig }}"
        apply: yes

    - name: Create Service
      k8s:
        definition:
          apiVersion: v1
          kind: Service
          metadata:
            name: "{{ app_name }}"
            namespace: "{{ app_name }}"
          spec:
            type: ClusterIP
            selector:
              app: "{{ app_name }}"
            ports:
              - port: 80
                targetPort: 8080
        kubeconfig: "{{ kubeconfig }}"
        apply: yes

    # 3. 验证阶段
    - name: Wait for rollout
      ansible.builtin.shell: |
        kubectl rollout status deployment/{{ app_name }} -n {{ app_name }}
        --kubeconfig={{ kubeconfig }}
      register: rollout_result
      retries: 30
      delay: 10
      until: rollout_result.rc == 0

    - name: Health check
      ansible.builtin.uri:
        url: "http://{{ app_name }}.{{ app_name }}.svc.cluster.local/health"
        status_code: 200
      register: health
      retries: 5
      delay: 10
      until: health.status == 200
```

## 面试追问方向

1. **Ansible 和 kubectl/helm 命令直接执行有什么区别？**
   答：直接执行命令（`ansible.builtin.command: kubectl apply ...`）的问题是：无法感知当前状态，幂等性差，每次都执行，即使没有变更。Ansible 的 `k8s` 和 `k8s_helm` 模块会先查询当前状态，只做必要的变更，更符合声明式运维的理念。

2. **Ansible 如何管理多集群？**
   答：通过多个 kubeconfig 文件管理多集群。在 Inventory 中定义不同集群的主机，使用不同的 `kubeconfig` 路径。也可以使用 `k8s_auth` 变量动态指定集群上下文，支持在同一个 Playbook 中操作多个集群。

3. **Ansible + K8s 适合什么场景？**
   答：适合需要 Ansible 做「编排层」的场景——先在 Ansible 里做构建、推送、环境准备，再调用 K8s 部署。如果只需要管理 K8s 资源，原生的 `kubectl`、`helm` 或 `GitOps` 工具（ArgoCD）更合适。

Ansible 是 DevOps 工程师的「瑞士军刀」——用它连接 Docker、Kubernetes、Cloud APIs，构建端到端的自动化流水线。
