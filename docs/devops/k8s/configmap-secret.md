# ConfigMap 与 Secret：应用配置

「应用的配置应该放在哪？」——这是容器化和 K8s 化过程中必然会遇到的问题。

硬编码不行，改一次配置要重新打包镜像。ConfigMap 和 Secret 是 K8s 提供的原生配置管理方案，它们把配置从镜像中分离出来，让同一个镜像可以在不同环境中使用不同的配置。

## ConfigMap vs Secret

两者本质上是同一个 API 对象，区别在于用途：

| 特性 | ConfigMap | Secret |
|------|-----------|--------|
| 用途 | 非敏感配置（环境变量、启动参数） | 敏感数据（密码、Token、证书） |
| 编码 | 明文 | Base64 编码（可选加密） |
| 体积限制 | 1Mi | 1Mi |
| 默认处理 | 不加密 | 不加密（除非启用 EncryptionConfiguration） |
| 典型内容 | DB_HOST、LOG_LEVEL、配置文件 | DB_PASSWORD、API_KEY、TLS 证书 |

## 创建 ConfigMap

### 方式一：从 key-value 对创建

```bash
kubectl create configmap app-config \
  --from-literal=DB_HOST=localhost \
  --from-literal=DB_PORT=5432 \
  --from-literal=LOG_LEVEL=info
```

### 方式二：从文件创建

```bash
# 整个文件作为 ConfigMap 的一个 key
kubectl create configmap nginx-config --from-file=nginx.conf

# 指定 key 名
kubectl create configmap nginx-config --from-file=custom-name=nginx.conf

# 整个目录
kubectl create configmap app-config --from-file=./config/
```

### 方式三：从 YAML 创建

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
data:
  # 简单键值对
  DB_HOST: "mysql.default.svc.cluster.local"
  DB_PORT: "3306"
  LOG_LEVEL: "debug"
  # 也可以存完整的配置文件（多行字符串用 |）
  redis.conf: |
    maxmemory 2gb
    maxmemory-policy allkeys-lru
    appendonly yes
  application.yml: |
    spring:
      datasource:
        url: jdbc:mysql://${DB_HOST}:${DB_PORT}/app
        driver-class-name: com.mysql.cj.jdbc.Driver
binaryData:
  # 二进制数据（如图片、证书）
  cert.pem: $(cat cert.pem | base64)
```

## 使用 ConfigMap

### 方式一：环境变量

```yaml
env:
  - name: DB_HOST
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: DB_HOST
        optional: true  # 可选：ConfigMap 不存在时不报错
  - name: APP_MODE
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: LOG_LEVEL
```

### 方式二：从配置批量注入环境变量

```yaml
envFrom:
  - configMapRef:
      name: app-config
# 所有 data 下的键值对都会被注入为环境变量
```

### 方式三：Volume 挂载（配置文件形式）

```yaml
volumeMounts:
  - name: config
    mountPath: /etc/app/config
    readOnly: true
volumes:
  - name: config
    configMap:
      name: app-config
      items:
        - key: application.yml
          path: application.yml  # 指定挂载的文件名
      defaultMode: 0644
```

挂载后的目录结构：

```
/etc/app/config/
├── DB_HOST         # 值为 "mysql.default.svc.cluster.local"
├── DB_PORT         # 值为 "3306"
├── LOG_LEVEL       # 值为 "debug"
├── redis.conf      # 文件内容为配置内容
└── application.yml # 文件内容为 YAML 配置
```

## Secret 的创建与使用

### 创建 Secret

```bash
# generic 类型的 Secret（用户名密码、Token 等）
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password=secret123 \
  --from-literal=api-key=sk-xxx \
  --type=Opaque

# TLS Secret（从证书文件）
kubectl create secret tls nginx-tls \
  --cert=path/to/cert.pem \
  --key=path/to/key.pem \
  --type=kubernetes.io/tls

# Docker registry 认证 Secret
kubectl create secret docker-registry my-registry \
  --docker-server=registry.example.com \
  --docker-username=admin \
  --docker-password=password \
  --docker-email=admin@example.com \
  --type=kubernetes.io/dockerconfigjson
```

### 使用 Secret

**环境变量：**

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: password
```

**Volume 挂载（证书形式）：**

```yaml
volumeMounts:
  - name: tls-certs
    mountPath: /etc/nginx/tls
    readOnly: true
volumes:
  - name: tls-certs
    secret:
      secretName: nginx-tls
      # 文件名：tls.crt 和 tls.key
```

## Secret 的加密

**重要**：Secret 的 Base64 编码不是加密！任何有权限访问 etcd 的人都能直接读取 Secret 内容。

启用 Secret 加密：

```yaml
# kube-apiserver 启动参数中添加
--encryption-provider-config=/etc/kubernetes/encryption-config.yaml
```

```yaml
# /etc/kubernetes/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <32字节的base64编码密钥>
      - identity: {}   # 不加密（降级用）
```

## ConfigMap/Secret 的热更新

K8s 1.19+ 支持对 ConfigMap 和 Secret 的热更新（挂载为文件时）：

```bash
# 修改 ConfigMap
kubectl patch configmap app-config -p '{"data":{"LOG_LEVEL":"warn"}}'

# 查看 Pod 是否自动更新（默认需要 60 秒，通过 --sub-path 挂载的文件不支持热更新）
kubectl exec pod-name -- cat /etc/app/config/LOG_LEVEL
# 输出：warn
```

热更新的延迟由 kubelet 的 sync-frequency 控制，默认为 60 秒。

### 使用 subPath 挂载的问题

```yaml
# 下面的方式挂载，ConfigMap 更新后文件内容不会更新
volumeMounts:
  - name: config
    mountPath: /etc/app/application.yml
    subPath: application.yml  # 问题在这里
```

解决方式：不用 subPath，整个目录挂载，让 kubelet 做符号链接更新。

## 使用场景对比

| 场景 | 推荐方式 | 说明 |
|------|---------|------|
| 环境变量（字符串） | ConfigMap `env` | 最简单直接 |
| 配置文件（nginx.conf） | ConfigMap `volume` | 完整配置文件 |
| 数据库密码 | Secret `env` | 敏感信息 |
| TLS 证书 | Secret `volume` | 自动挂载为 tls.crt/tls.key |
| Docker 镜像拉取凭证 | Secret `type: dockerconfigjson` | Pod 的 imagePullSecrets 引用 |
| SSH Key | Secret `volume` | 挂载为文件使用 |

## 面试追问方向

- ConfigMap 和 Secret 的 Base64 编码是加密吗？什么情况下需要加密？
- 使用 subPath 挂载 ConfigMap/Secret 的坑是什么？为什么？
- ConfigMap 更新后，Pod 内什么时候能看到新值？为什么不是即时的？
- 如果一个 ConfigMap 被多个 Pod 引用，修改后所有 Pod 都会收到更新吗？
- 为什么建议不要把 ConfigMap/Secret 直接写在 Pod _spec 里，而是通过 volume 挂载？

> ConfigMap 和 Secret 是 K8s 配置管理的基础。真正掌握它们，需要理解热更新机制、subPath 限制、以及在不同挂载方式下的行为差异。
