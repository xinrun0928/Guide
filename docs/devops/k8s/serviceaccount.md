# ServiceAccount 与 Pod 安全上下文

「Pod 怎么访问 K8s API？」——答案是 ServiceAccount。

ServiceAccount 是 K8s 中为 Pod、服务账号提供的身份机制。每个 Pod 在创建时都会关联一个 ServiceAccount，应用通过挂载到 Pod 内的 ServiceAccount Token 来向 API Server 认证。配合 RBAC，ServiceAccount 构成了 K8s 内部身份认证体系的核心。

## ServiceAccount 的基础概念

### 默认 ServiceAccount

每个 namespace 创建时都会自带一个 `default` ServiceAccount：

```bash
kubectl get serviceaccount -n default
# NAME      SECRETS   AGE
# default   0         30d

# Pod 关联的 ServiceAccount
kubectl get pod nginx -o jsonpath='{.spec.serviceAccountName}'
# default
```

如果 Pod 未显式指定 `serviceAccountName`，K8s 自动使用 `default` ServiceAccount。

### 创建自定义 ServiceAccount

```bash
kubectl create serviceaccount ci-agent -n production
kubectl get serviceaccount ci-agent -n production -o yaml
```

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ci-agent
  namespace: production
secrets:          # K8s 自动为 ServiceAccount 创建包含 Token 的 Secret
  - name: ci-agent-token-xxxxx
```

## ServiceAccount Token 的工作原理

### Token 的生成

当 ServiceAccount 创建时，K8s Controller Manager 自动创建一个关联的 Secret，其中包含：

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ci-agent-token-xxxxx
  annotations:
    kubernetes.io/service-account.name: ci-agent
    kubernetes.io/service-account.uid: abc-123
type: kubernetes.io/service-account-token
data:
  # JWT Token（自动生成，有效期约一年）
  token: eyJhbGciOiJSUzI1NiIsImtpZCI6Ik...
  # ServiceAccount 名称
  ca.crt: LS0tLS1CRUdJTiBDRVJUSUZ...
  # namespace 信息
  namespace: cHJvZHVjdGlvbg==
```

### Token 的挂载

未指定 `automountServiceAccountToken: false` 的 Pod，kubelet 自动将 ServiceAccount Token 挂载到容器内：

```bash
# 在 Pod 内查看挂载的 Token
kubectl exec -it nginx -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# ca.crt  namespace  token

kubectl exec -it nginx -- cat /var/run/secrets/kubernetes.io/serviceaccount/namespace
# production

# Token 就是用于认证的 JWT
kubectl exec -it nginx -- cat /var/run/secrets/kubernetes.io/serviceaccount/token
```

### 在应用中使用 Token 访问 API

```java
// Java 中使用 ServiceAccount Token 访问 K8s API
public class K8sClient {
    public void listPods() {
        String token = readToken("/var/run/secrets/kubernetes.io/serviceaccount/token");
        String caCert = readCert("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt");
        String namespace = readNamespace("/var/run/secrets/kubernetes.io/serviceaccount/namespace");

        // 使用 token 构建认证头
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://kubernetes.default.svc/api/v1/namespaces/" + namespace + "/pods"))
            .header("Authorization", "Bearer " + token)
            .header("Accept", "application/json")
            .GET()
            .build();
    }
}
```

K8s 提供了 `kubernetes.default.svc` 这个内置 DNS，Pod 可以用它访问 API Server 而无需知道其 IP。

### 禁用自动挂载

对于不需要访问 K8s API 的 Pod，禁用自动挂载以减少攻击面：

```yaml
spec:
  serviceAccountName: default
  automountServiceAccountToken: false  # 禁用 Token 自动挂载
  containers:
    - name: app
      image: myapp:v1
```

## Pod 中的身份认证

Pod 使用 ServiceAccount Token 向 API Server 认证后，API Server 通过 RBAC 决定该 ServiceAccount 有哪些权限：

```yaml
# 创建只读 ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: readonly-agent
  namespace: production
---
# 授予只读 namespace 资源的权限
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: readonly-binding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: readonly-agent
    namespace: production
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

这意味着：**Pod 的权限完全由关联的 ServiceAccount 的 RBAC 规则决定**。攻击者即使拿下了容器内部，也无法获取超过 ServiceAccount 权限范围的 API 访问能力。

## Pod 级别的 Security Context 和 ServiceAccount

Security Context 控制容器能做什么，ServiceAccount 控制 Pod 能访问什么 API。两者是独立且互补的：

```yaml
spec:
  serviceAccountName: monitoring-agent
  automountServiceAccountToken: true
  securityContext:
    runAsUser: 1000          # 以非 root 用户运行
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: agent
      image: prometheus/node-exporter
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
```

## 常见问题

### Token 过期与轮换

ServiceAccount Token 在创建时生成，**不会自动轮换**。如果 Token 泄露，需要手动重建：

```bash
# 删除关联的 Secret，K8s 会自动创建新的
kubectl delete secret ci-agent-token-xxxxx -n production
# 新 Token 需要几分钟生成
```

K8s 1.22 引入了 **TokenRequest API**，支持为 Pod 请求 Audience Bound Token（范围受限、短期有效的 Token）：

```yaml
spec:
  serviceAccountName: my-app-sa
  volumes:
    - name: token
      projected:
        sources:
          - serviceAccountToken:
              audience: kubernetes.default.svc
              expirationSeconds: 3600   # 1 小时后过期
              path: token
```

### 多个 ServiceAccount

一个 Pod 只能关联一个 ServiceAccount，但可以通过 projected volume 挂载多个 ServiceAccount Token：

```yaml
volumes:
  - name: tokens
    projected:
      sources:
        - serviceAccountToken:
            audience: kubernetes.default.svc
            path: "default-token"
        - serviceAccountToken:
            audience: vault.internal
            path: "vault-token"
```

### ImagePullSecrets 与 ServiceAccount

私有镜像仓库的认证凭证，推荐配置在 ServiceAccount 上而非 Pod 上：

```bash
kubectl patch serviceaccount default \
  -n production \
  -p '{"imagePullSecrets":[{"name":"my-registry"}]}'
```

这样该 namespace 下所有未显式指定 `imagePullSecrets` 的 Pod，都会自动使用这个凭证拉取镜像。

## 面试追问方向

- ServiceAccount Token 和普通用户认证的流程有什么区别？它们在 kube-apiserver 层是如何区分的？
- 为什么默认情况下 kubelet 会自动为 Pod 挂载 ServiceAccount Token？如何防止这种行为？
- ServiceAccount Token 和 TokenRequest API 生成的 Bound Token 有什么区别？
- 如果一个 Pod 绑定的 ServiceAccount 没有对应的 RBAC 权限，API Server 会返回什么？
- 在 Pod 中，ServiceAccount Token 的挂载路径是什么？应用怎么找到它？

> ServiceAccount 是 Pod 的「身份证」，RBAC 是「权限清单」。理解它们的配合关系，是掌握 K8s 身份认证体系的关键。
