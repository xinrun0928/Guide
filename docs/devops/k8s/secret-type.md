# Secret 类型：Opaque、kubernetes.io/dockerconfigjson、tls

Secret 是 K8s 中存储敏感信息的原生方式，但你真的了解它的类型系统吗？

Opaque、dockerconfigjson、tls——这三种类型背后对应了不同的使用场景和验证逻辑。用错了类型，不仅不方便，还可能导致安全问题。

## Secret 的类型系统

K8s Secret API 中有一个 `type` 字段，它决定了：

1. **数据的用途**：K8s 控制器会识别特定类型并做对应的处理
2. **验证规则**：创建时 K8s 会校验格式
3. **使用方式**：不同类型有不同的引用方式

```yaml
type: Opaque                      # 通用类型，无特殊处理
type: kubernetes.io/tls           # TLS 证书
type: kubernetes.io/dockerconfigjson  # Docker registry 认证
type: bootstrap.kubernetes.io/token  # Bootstrap Token
type: kubernetes.io/ssh-auth     # SSH 密钥
```

## Opaque：通用 Secret

Opaque 是默认类型，也是最灵活的类型。它对数据格式没有任何假设和验证，所有数据都以 Base64 编码存储。

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-opaque-secret
type: Opaque
data:
  username: YWRtaW4=            # admin
  password: c3VwZXJzZWNyZXQ=    # supersecret
  api-token: c2stYWJjMTIzNDU2   # sk-abc123456
```

**使用场景**：数据库凭证、API Token、任意字符串形式的敏感信息。

### 何时用 Opaque vs 专用类型？

专用类型（如 tls、dockerconfigjson）只是多了验证和自动引用逻辑。如果你需要的功能没有被专用类型覆盖，就用 Opaque。

## TLS Secret

`kubernetes.io/tls` 类型专门用于存储 TLS 证书和私钥。创建时 K8s 会验证证书和私钥的格式是否匹配。

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: nginx-tls
  namespace: default
type: kubernetes.io/tls
data:
  # 必须包含 tls.crt 和 tls.key
  # base64 编码的证书和私钥
  tls.crt: $(cat server.crt | base64 -w 0)
  tls.key: $(cat server.key | base64 -w 0)
```

或者用 kubectl 直接创建：

```bash
kubectl create secret tls nginx-tls \
  --cert=path/to/server.crt \
  --key=path/to/server.key
```

### 自动处理

TLS Secret 被引用时（如 Ingress 的 TLS 配置），K8s 会自动将其挂载为两个文件：

```
/etc/kubernetes/secrets/tls/tls.crt
/etc/kubernetes/secrets/tls/tls.key
```

### 证书续期

证书到期前，重新创建 Secret 即可。配合 cert-manager 可以实现自动续期：

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: nginx-tls
spec:
  secretName: nginx-tls  # 自动创建同名 Secret
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - api.example.com
  duration: 2160h   # 90 天
  renewBefore: 360h  # 到期前 15 天续期
```

## Docker Registry Secret

`kubernetes.io/dockerconfigjson` 类型用于存储容器镜像仓库的认证信息。当 Pod 需要从私有仓库拉取镜像时，需要引用这个 Secret。

### 创建方式

```bash
# 方式一：从 docker login 生成的 ~/.docker/config.json
kubectl create secret generic my-registry \
  --from-file=.dockerconfigjson=$HOME/.docker/config.json \
  --type=kubernetes.io/dockerconfigjson

# 方式二：手动指定
kubectl create secret docker-registry my-registry \
  --docker-server=registry.example.com \
  --docker-username=admin \
  --docker-password=password \
  --docker-email=admin@example.com \
  --type=kubernetes.io/dockerconfigjson
```

### 使用：imagePullSecrets

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: private-app
spec:
  imagePullSecrets:
    - name: my-registry   # 引用上面创建的 Secret
  containers:
    - name: app
      image: registry.example.com/myapp:v1
```

`imagePullSecrets` 的特点：
- 在 Pod 创建时由 kubelet 使用，向私有 registry 做认证
- 需要在 Pod 所在的 namespace 中创建
- 如果多个 Pod 使用同一个私有镜像，可以在 ServiceAccount 上配置（更优雅）

### 配置 ServiceAccount 自动注入

```bash
# 为 default ServiceAccount 添加 imagePullSecrets
kubectl patch serviceaccount default \
  -p '{"imagePullSecrets":[{"name":"my-registry"}]}'

# 此后该 namespace 下所有未指定 imagePullSecrets 的 Pod
# 都会自动继承这个镜像拉取凭证
```

## SSH Auth Secret

`kubernetes.io/ssh-auth` 用于存储 SSH 私钥：

```bash
kubectl create secret generic ssh-key \
  --from-file=ssh-privatekey=path/to/id_rsa \
  --type=kubernetes.io/ssh-auth
```

使用场景较少，主要用于需要 SSH 访问远程服务器的运维工具。

## Bootstrap Token Secret

`bootstrap.kubernetes.io/token` 是 K8s 用于节点引导的专用 Secret 类型，由 kubeadm 在集群初始化时自动创建：

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: bootstrap-token-abcdef
  namespace: kube-system
type: bootstrap.kubernetes.io/token
data:
  # token ID 和 secret（已 Base64 编码）
  token-id: YWJjZGVm
  token-secret: a3ViZWFkbWluLXZhbHVl
  # 额外元数据
  usage-bootstrap-ignition: dHJ1ZQ==
  usage-bootstrap-signing: dHJ1ZQ==
  expiration: $(date -d '+24h' +%Y-%m-%dT%H:%M:%SZ --utc | base64)
```

## 重要：Secret 内容的可见性问题

```bash
# 任何能 GET Secret 的人都能解码看到内容
kubectl get secret my-secret -o yaml
# data:
#   password: c3VwZXJzZWNyZXQ=
# 解码
echo c3VwZXJzZWNyZXQ= | base64 -d
# supersecret
```

**解决方案**：
1. **RBAC 限制**：通过 RBAC 控制谁能读取 Secret
2. **加密存储**：配置 EncryptionConfiguration，让 etcd 中的 Secret 内容加密存储
3. **外部密钥管理**：使用 Vault 等外部 KMS，通过 CSI Secret Store 注入

## Secret 类型对比

| 类型 | 数据格式 | 主要用途 | K8s 自动处理 |
|------|---------|---------|------------|
| Opaque | 任意 Base64 | 通用凭证存储 | 无 |
| tls | tls.crt + tls.key | HTTPS/TLS 证书 | Ingress TLS 挂载 |
| dockerconfigjson | .dockerconfigjson | 私有镜像仓库认证 | imagePullSecrets |
| ssh-auth | ssh-privatekey | SSH 认证 | 无 |
| bootstrap.kubernetes.io/token | token 结构 | 节点引导 | kubeadm 使用 |

## 面试追问方向

- 为什么 Secret 的 Base64 编码不是真正的加密？如何让 Secret 在 etcd 中加密存储？
- imagePullSecrets 配置在 Pod 上和 ServiceAccount 上有什么区别？
- 如果私有镜像仓库认证失败，Pod 会处于什么状态？kubelet 的行为是什么？
- TLS Secret 和 cert-manager 有什么关系？为什么推荐使用 cert-manager 管理证书？
- Bootstrap Token Secret 在节点加入集群的过程中扮演什么角色？

> Secret 的类型不是装饰——它们对应了真实的使用场景和 K8s 的自动化机制。用对类型，可以让你的配置管理更加安全、优雅。
