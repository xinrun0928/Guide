# kubectl 常用命令速查

kubectl 是 K8s 的命令行工具，也是日常运维的核心。这一篇覆盖高频使用场景的命令和技巧，帮助你从「查文档」到「信手拈来」。

## 集群信息

```bash
# 查看集群信息
kubectl cluster-info
kubectl version --short
kubectl api-resources          # 查看所有 API 资源类型
kubectl api-versions           # 查看所有 API 版本

# 查看节点
kubectl get nodes -o wide
kubectl describe node node-1
kubectl top node node-1        # 需要 metrics-server

# 节点打标签/污点
kubectl label node node-1 disk-type=ssd
kubectl label node node-1 disk-type-      # 删除标签
kubectl taint node node-1 dedicated=gpu:NoSchedule
kubectl taint node node-1 dedicated-      # 删除污点
```

## Pod 操作

```bash
# 查看 pods（所有 namespace）
kubectl get pods -A
kubectl get pods -n default -o wide

# 查看 pod 详情
kubectl describe pod nginx-pod -n default

# 查看 pod 日志
kubectl logs nginx-pod -n default
kubectl logs nginx-pod -n default -f           # 实时跟踪
kubectl logs nginx-pod -n default -p            # 上一容器的日志（重启后）
kubectl logs nginx-pod -n default -c sidecar    # 指定容器

# 进入 pod
kubectl exec -it nginx-pod -n default -- sh
kubectl exec nginx-pod -n default -- cat /etc/nginx/nginx.conf

# Pod 扩缩容
kubectl scale deployment nginx --replicas=3 -n default
kubectl autoscale deployment nginx --min=2 --max=10 --cpu-percent=80 -n default

# 排查 pod 问题
kubectl get pod -n default -o yaml              # 查看完整配置
kubectl get events -n default --sort-by=.lastTimestamp  # 按时间排序事件
kubectl top pod -n default                      # 资源使用情况
```

## Deployment 操作

```bash
# 创建/更新/删除
kubectl apply -f deployment.yaml
kubectl apply -f deployment.yaml --dry-run=server  # 服务端校验
kubectl delete -f deployment.yaml

# 滚动更新与回滚
kubectl rollout status deployment/nginx -n default
kubectl rollout history deployment/nginx -n default
kubectl rollout undo deployment/nginx -n default
kubectl rollout undo deployment/nginx --to-revision=2 -n default

# 配置更新（使用 set）
kubectl set image deployment/nginx nginx=nginx:1.25 -n default
kubectl set resources deployment/nginx -c nginx --limits=cpu=200m,memory=512Mi -n default
kubectl set image deployment/nginx nginx=nginx:v2 -n default --record   # 记录到历史

# 查看 deployments
kubectl get deployments -n default
kubectl get deployment nginx -n default -o jsonpath='{.spec.replicas}'
```

## Service 操作

```bash
kubectl get svc -n default
kubectl get svc nginx-svc -n default -o yaml
kubectl expose deployment nginx --port=80 --target-port=8080 --type=ClusterIP -n default
kubectl delete svc nginx-svc -n default

# 端口转发（本地调试用）
kubectl port-forward pod/nginx-pod 8080:80 -n default
kubectl port-forward svc/nginx-svc 8080:80 -n default
```

## ConfigMap 与 Secret

```bash
# 创建
kubectl create configmap app-config --from-literal=KEY=value -n default
kubectl create configmap app-config --from-file=nginx.conf -n default
kubectl create secret generic db-creds --from-literal=password=secret -n default
kubectl create secret tls nginx-tls --cert=cert.pem --key=key.pem -n default

# 使用
kubectl get configmap app-config -n default -o jsonpath='{.data.KEY}'
kubectl get secret db-creds -n default -o jsonpath='{.data.password}' | base64 -d
kubectl describe configmap app-config -n default
```

## 调试技巧

```bash
# 资源是否就绪
kubectl wait --for=condition=ready pod -l app=nginx --timeout=60s -n default

# 等待资源删除
kubectl delete pod nginx-pod -n default
kubectl wait --for=delete pod/nginx-pod --timeout=60s -n default

# 快速找资源
kubectl get all -n default                        # 所有资源
kubectl get pods -n default -l app=nginx         # 标签过滤
kubectl get pods -n default --field-selector=status.phase=Running

# 端口/网络调试
kubectl run curl --image=curlimages/curl --rm -it --restart=Never -- sh

# 资源限制排查
kubectl describe pod problematic-pod -n default | grep -A 5 "Events:"
kubectl get pod problematic-pod -n default -o jsonpath='{.status.conditions[*]}'
```

## 格式化输出

```bash
# 常用 -o 格式
kubectl get pods -o wide          # 额外列信息
kubectl get pods -o yaml          # 完整 YAML
kubectl get pods -o json          # 完整 JSON
kubectl get pods -o name          # 只输出资源名称
kubectl get pods -o jsonpath='{.items[*].status.podIP}'  # 自定义字段
kubectl get pods -o custom-columns='NAME:.metadata.name,IP:.status.podIP,NODE:.spec.nodeName'

# jq 配合使用（需要 jq 工具）
kubectl get pods -o json | jq '.items[] | {name:.metadata.name, ip:.status.podIP}'
```

## 上下文与配置

```bash
# 管理多集群/多上下文
kubectl config get-contexts
kubectl config current-context
kubectl config use-context context-name
kubectl config set-context my-cluster --namespace=default --cluster=k8s-prod --user=admin

# 快速切换 namespace
kubectl config set-context --current --namespace=production

# 查看配置
kubectl config view
```

## 常用别名

```bash
# ~/.bashrc 或 ~/.zshrc 中添加
alias k='kubectl'
alias kgp='kubectl get pods'
alias kgd='kubectl get deployment'
alias kgs='kubectl get svc'
alias kga='kubectl get all'
alias klf='kubectl logs -f'
alias kex='kubectl exec -it'
alias kdp='kubectl describe pod'
alias kdd='kubectl describe deployment'
alias kd='kubectl delete'
alias ka='kubectl apply -f'
alias kaf='kubectl apply -f'
alias kgaa='kubectl get all -A'
alias kgpaa='kubectl get pods -A'
```

## 面试追问方向

- `kubectl apply` 和 `kubectl create` 的区别是什么？
- `kubectl exec` 进入容器需要什么权限？
- kubectl 的 `--dry-run` 有哪几种模式？各有什么区别？
- 如果一个 Pod 处于 `Terminating` 状态无法删除，怎么排查？

> kubectl 是 K8s 运维的瑞士军刀。熟练掌握常用命令和输出格式，能让日常排查效率提升数倍。
