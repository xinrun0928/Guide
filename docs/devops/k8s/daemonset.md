# DaemonSet：每个节点运行一个 Pod

DaemonSet 确保每个节点（或者满足条件的节点）都运行一个 Pod 副本。日志收集、监控代理、网络插件——这些场景都需要 DaemonSet。

## DaemonSet 概述

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DaemonSet 工作原理                                  │
│                                                                     │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                        │
│  │  Node 1  │  │  Node 2  │  │  Node 3  │                        │
│  │    ┌───┐ │  │    ┌───┐ │  │    ┌───┐ │                        │
│  │    │Pod│ │  │    │Pod│ │  │    │Pod│ │                        │
│  │    └───┘ │  │    └───┘ │  │    └───┘ │                        │
│  └───────────┘  └───────────┘  └───────────┘ │                        │
│       ↑             ↑             ↑                                     │
│       └─────────────┴─────────────┘                                     │
│                     DaemonSet                                          │
│                                                                     │
│  新节点加入：自动部署 Pod                                              │
│  节点删除：Pod 自动清理                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 基本使用

### 最小配置

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
    spec:
      containers:
        - name: fluentd
          image: fluent/fluentd:v1.16
          resources:
            limits:
              memory: 200Mi
              cpu: 100m
            requests:
              memory: 100Mi
              cpu: 50m
```

```bash
# 创建 DaemonSet
kubectl apply -f fluentd.yaml

# 查看 DaemonSet
kubectl get daemonset

# 输出：
# NAME      DESIRED   CURRENT   READY   AGE   AVAILABLE
# fluentd   3         3         3       10s   3

# 查看 Pod
kubectl get pods -l app=fluentd
```

## 常见使用场景

### 场景1：日志收集

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: filebeat
  labels:
    k8s-app: filebeat
spec:
  selector:
    matchLabels:
      k8s-app: filebeat
  template:
    metadata:
      labels:
        k8s-app: filebeat
    spec:
      containers:
        - name: filebeat
          image: docker.elastic.co/beats/filebeat:8.11.0
          args:
            - -e
            - -strict.perms=false
          env:
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          volumeMounts:
            - name: varlog
              mountPath: /var/log
            - name: dockercontainers
              mountPath: /var/lib/docker/containers
              readOnly: true
            - name: filebeat-config
              mountPath: /etc/filebeat
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
        - name: dockercontainers
          hostPath:
            path: /var/lib/docker/containers
        - name: filebeat-config
          configMap:
            name: filebeat-config
```

### 场景2：节点监控

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
  labels:
    k8s-app: node-exporter
spec:
  selector:
    matchLabels:
      k8s-app: node-exporter
  template:
    metadata:
      labels:
        k8s-app: node-exporter
    spec:
      hostNetwork: true
      hostPID: true
      containers:
        - name: node-exporter
          image: prom/node-exporter:v1.6.1
          args:
            - --path.procfs=/host/proc
            - --path.sysfs=/host/sys
            - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
          ports:
            - name: metrics
              containerPort: 9100
              hostPort: 9100
          resources:
            limits:
              cpu: 250m
              memory: 180Mi
            requests:
              cpu: 102m
              memory: 180Mi
          securityContext:
            privileged: true
          volumeMounts:
            - name: proc
              mountPath: /host/proc
              readOnly: true
            - name: sys
              mountPath: /host/sys
              readOnly: true
      volumes:
        - name: proc
          hostPath:
            path: /proc
        - name: sys
          hostPath:
            path: /sys
```

### 场景3：网络插件（CNI）

```yaml
# Calico DaemonSet 示例
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: calico-node
  namespace: kube-system
spec:
  selector:
    matchLabels:
      k8s-app: calico-node
  template:
    metadata:
      labels:
        k8s-app: calico-node
    spec:
      hostNetwork: true
      tolerations:
        - effect: NoSchedule
          operator: Exists
        - effect: NoExecute
          operator: Exists
      containers:
        - name: calico-node
          image: calico/node:v3.26.0
          env:
            - name: CALICO_IPV4POOL_CIDR
              value: "192.168.0.0/16"
            - name: CALICO_NETWORKING_BACKEND
              value: "bird"
          securityContext:
            privileged: true
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
          volumeMounts:
            - name: lib-modules
              mountPath: /lib/modules
              readOnly: true
            - name: var-run-calico
              mountPath: /var/run/calico
      volumes:
        - name: lib-modules
          hostPath:
            path: /lib/modules
        - name: var-run-calico
          hostPath:
            path: /var/run/calico
```

### 场景4：存储插件

```yaml
# CSI Node Plugin 示例
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: csi-hostpathplugin
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: csi-hostpathplugin
  template:
    metadata:
      labels:
        app: csi-hostpathplugin
    spec:
      containers:
        - name: driver-registrar
          image: k8s.gcr.io/sig-storage/csi-node-driver-registrar:v2.9.0
          args:
            - --v=5
            - --csi-address=/csi/csi.sock
            - --kubelet-registration-path=/var/lib/kubelet/plugins/csi-hostpath/csi.sock
          volumeMounts:
            - name: plugin-dir
              mountPath: /csi
            - name: registration-dir
              mountPath: /registration
        - name: hostpath
          image: k8s.gcr.io/sig-storage/hostpathplugin:v1.12.0
          args:
            - --drivername=hostpath.csi.k8s.io
          ports:
            - name: healthz
              containerPort: 9898
              hostPort: 9898
          volumeMounts:
            - name: plugin-dir
              mountPath: /csi
            - name: socket-dir
              mountPath: /var/lib/csi-hostpath
      volumes:
        - name: plugin-dir
          hostPath:
            path: /var/lib/kubelet/plugins/csi-hostpath
        - name: registration-dir
          hostPath:
            path: /var/lib/kubelet/plugins_registry
        - name: socket-dir
          hostPath:
            path: /var/lib/csi-hostpath
```

## 节点选择

### nodeSelector

```yaml
spec:
  nodeSelector:
    disktype: ssd  # 只部署到 SSD 节点
```

### 节点亲和性

```yaml
spec:
  affinity:
    nodeAffinity:
      # 优先部署到有特定标签的节点
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          preference:
            matchExpressions:
              - key: zone
                operator: In
                values:
                  - us-east-1a
      # 排除特定节点
      # requiredDuringSchedulingIgnoredDuringExecution:
      #   nodeSelectorTerms:
      #     - matchExpressions:
      #         - key: node-role
      #           operator: NotIn
      #           values:
      #             - master
```

## 污点和容忍

### 容忍所有污点

```yaml
spec:
  tolerations:
    - operator: Exists  # 容忍所有污点
```

### 只容忍特定污点

```yaml
spec:
  tolerations:
    - key: dedicated
      operator: Equal
      value: database
      effect: NoSchedule
    - key: node.kubernetes.io/not-ready
      operator: Exists
      effect: NoExecute
      tolerationSeconds: 300
```

## 更新策略

### RollingUpdate（默认）

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1  # 最多 1 个 Pod 不可用
```

### OnDelete

```yaml
spec:
  updateStrategy:
    type: OnDelete  # 手动删除才更新
```

### 滚动更新过程

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DaemonSet 滚动更新                                │
│                                                                     │
│  默认策略：maxUnavailable: 1                                        │
│                                                                     │
│  1. 更新节点 1 上的 Pod                                              │
│       ↓                                                             │
│  2. 等待新 Pod Ready                                               │
│       ↓                                                             │
│  3. 更新节点 2 上的 Pod                                              │
│       ↓                                                             │
│  4. ...                                                            │
│                                                                     │
│  特点：每个节点独立更新                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 历史版本

```bash
# 查看历史版本
kubectl rollout history daemonset/<daemonset-name>

# 回滚到上一版本
kubectl rollout undo daemonset/<daemonset-name>

# 回滚到指定版本
kubectl rollout undo daemonset/<daemonset-name> --to-revision=<revision>
```

## 常见问题

### Pod 未部署到某些节点

```bash
# 排查步骤
# 1. 检查节点标签
kubectl get nodes --show-labels

# 2. 检查 DaemonSet 配置
kubectl describe daemonset <daemonset-name>

# 3. 检查节点资源
kubectl describe node <node-name>

# 4. 检查污点
kubectl get nodes -o jsonpath='{range.items[*]}{.metadata.name}{"\t"}{.spec.taints[*].key}{"\n"}{end}'
```

### 资源争抢

```bash
# DaemonSet 和其他 Pod 争抢资源
# 解决方案：设置合理的资源请求和限制
spec:
  template:
    spec:
      containers:
        - name: my-daemonset
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 256Mi
```

### Pod 被驱逐

```bash
# 原因：节点压力、资源不足
kubectl describe pod <pod-name> | grep -A 5 "Events"

# 解决：配置优先级、调整资源、调整污点容忍
spec:
  template:
    spec:
      tolerations:
        - key: "node.kubernetes.io/disk-pressure"
          operator: Exists
          effect: NoExecute
          tolerationSeconds: 300
```

## 最佳实践

### 1. 资源限制

```yaml
# DaemonSet 应该设置资源限制
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

### 2. 健康检查

```yaml
# 防止异常 Pod 继续运行
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /readiness
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
```

### 3. 合理的容忍

```yaml
tolerations:
  # 容忍 master 节点
  - key: node-role.kubernetes.io/master
    operator: Exists
    effect: NoSchedule
  # 容忍特定污点
  - key: dedicated
    operator: Exists
    effect: NoSchedule
```

### 4. 使用 hostNetwork

```yaml
# 网络插件需要 hostNetwork
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
```

## 面试追问

1. **DaemonSet 和 Deployment 的核心区别是什么？各自适合什么场景？**
2. **DaemonSet 如何保证每个节点只运行一个 Pod？**
3. **新节点加入集群时，DaemonSet 会自动部署吗？节点删除后呢？**
4. **DaemonSet 的更新策略和 Deployment 有什么区别？**
5. **网络插件为什么通常用 DaemonSet 部署？**

> "DaemonSet 是 Kubernetes 保证节点级别服务一致性的机制。理解它的节点选择机制、污点容忍、以及常见的使用场景，是在 K8s 上运行基础设施组件的关键。"
