# Kubebuilder 与 Operator 开发

「我想让 K8s 自动管理我的有状态应用。」——Operator 是答案。

Operator 是 K8s 的扩展机制，它让开发者用 CRD（自定义资源定义）来描述应用Desired State，再用自定义 Controller 来确保 Actual State 向 Desired State 收敛。Kubebuilder 是最流行的 Operator 开发框架，它让你用 Go 语言快速构建生产级的 Operator。

## Operator 的工作原理

```
用户创建 Custom Resource (例如 MySQLCluster)
    │
    ▼
etcd 存储 CR 对象
    │
    ▼
Controller 监听 CR 变化
    │
    ├──► 读取 CR 的 spec
    ├──► 对比当前状态（Reconciliation Loop）
    ├──► 执行必要的操作（创建/更新/删除资源）
    └──► 更新 CR 的 status

Controller 创建的 K8s 原生资源：
  ├── StatefulSet
  ├── Service
  ├── ConfigMap
  ├── Secret
  └── PersistentVolumeClaim
```

## Kubebuilder 项目结构

```bash
# 创建项目
kubebuilder init --domain mycompany.com --repo github.com/mycompany/mysql-operator
kubebuilder create api --version v1 --kind MySQLCluster

# 项目结构
mycompany-mysql-operator/
├── config/
│   ├── crd/              # CRD YAML 生成目录
│   ├── rbac/             # RBAC 配置
│   └── manager/           # Deployment + ServiceAccount
├── controllers/
│   └── mysqlcluster_controller.go  # Controller 核心逻辑
├── api/v1/
│   └── mysqlcluster_types.go      # CR 的 Go 类型定义
├── main.go
└── Dockerfile
```

## 定义 CR（Custom Resource）

```go
// api/v1/mysqlcluster_types.go
package v1

import (
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type MySQLClusterSpec struct {
    // Replicas 是 MySQL 集群的副本数
    Replicas int32 `json:"replicas,omitempty"`
    // Version 是 MySQL 镜像版本
    Version string `json:"version,omitempty"`
    // Storage 是每个 Pod 的存储大小
    Storage string `json:"storage,omitempty"`
    // Resources 是容器的资源限制
    Resources ResourceRequirements `json:"resources,omitempty"`
}

type MySQLClusterStatus struct {
    // ReadyReplicas 当前 Ready 的 Pod 数
    ReadyReplicas int32 `json:"readyReplicas,omitempty"`
    // Phase 表示集群当前状态
    Phase string `json:"phase,omitempty"`
}

type MySQLCluster struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`
    Spec   MySQLClusterSpec   `json:"spec,omitempty"`
    Status MySQLClusterStatus `json:"status,omitempty"`
}

type MySQLClusterList struct {
    metav1.TypeMeta `json:",inline"`
    metav1.ListMeta `json:"metadata,omitempty"`
    Items []MySQLCluster `json:"items,omitempty"`
}
```

运行 `make generate` 和 `make manifests` 后，Kubebuilder 会生成 CRD YAML 和辅助代码。

## 编写 Controller

```go
// controllers/mysqlcluster_controller.go
package controllers

import (
    "context"
    appsv1 "k8s.io/api/apps/v1"
    corev1 "k8s.io/api/core/v1"
    "k8s.io/apimachinery/pkg/runtime"
    ctrl "sigs.k8s.io/controller-runtime"
    "sigs.k8s.io/controller-runtime/pkg/client"
    "sigs.k8s.io/controller-runtime/pkg/log"

    mycompanyv1 "github.com/mycompany/mysql-operator/api/v1"
)

type MySQLClusterReconciler struct {
    client.Client
    Scheme *runtime.Scheme
}

func (r *MySQLClusterReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    logger := log.FromContext(ctx)

    // 1. 获取 CR
    mysqlCluster := &mycompanyv1.MySQLCluster{}
    if err := r.Get(ctx, req.NamespacedName, mysqlCluster); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // 2. 创建/更新 StatefulSet
    found := &appsv1.StatefulSet{}
    err := r.Get(ctx, req.NamespacedName, found)
    if err != nil && errors.IsNotFound(err) {
        // 创建 StatefulSet
        deploy := r.buildStatefulSet(mysqlCluster)
        if err := r.Create(ctx, deploy); err != nil {
            return ctrl.Result{}, err
        }
        logger.Info("StatefulSet created", "name", deploy.Name)
        return ctrl.Result{Requeue: true}, nil  // 重新入队，等待创建完成
    } else if err != nil {
        return ctrl.Result{}, err
    }

    // 3. 更新 StatefulSet（如果有变化）
    if !r.isStatefulSetUpToDate(found, mysqlCluster) {
        found.Spec.Replicas = &mysqlCluster.Spec.Replicas
        if err := r.Update(ctx, found); err != nil {
            return ctrl.Result{}, err
        }
        logger.Info("StatefulSet updated", "name", found.Name)
    }

    // 4. 更新 CR Status
    mysqlCluster.Status.ReadyReplicas = found.Status.ReadyReplicas
    mysqlCluster.Status.Phase = "Running"
    if err := r.Status().Update(ctx, mysqlCluster); err != nil {
        return ctrl.Result{}, err
    }

    return ctrl.Result{}, nil
}

func (r *MySQLClusterReconciler) buildStatefulSet(cr *mycompanyv1.MySQLCluster) *appsv1.StatefulSet {
    replicas := cr.Spec.Replicas
    return &appsv1.StatefulSet{
        ObjectMeta: metav1.ObjectMeta{
            Name:      cr.Name,
            Namespace: cr.Namespace,
        },
        Spec: appsv1.StatefulSetSpec{
            Replicas: &replicas,
            Selector: &metav1.LabelSelector{
                MatchLabels: map[string]string{"app": "mysql"},
            },
            ServiceName: cr.Name + "-svc",
            Template: corev1.PodTemplateSpec{
                ObjectMeta: metav1.ObjectMeta{
                    Labels: map[string]string{"app": "mysql"},
                },
                Spec: corev1.PodSpec{
                    Containers: []corev1.Container{{
                        Name:  "mysql",
                        Image: "mysql:" + cr.Spec.Version,
                        Ports: []corev1.ContainerPort{{
                            Name:          "mysql",
                            ContainerPort: 3306,
                        }},
                        VolumeMounts: []corev1.VolumeMount{{
                            Name:      "data",
                            MountPath: "/var/lib/mysql",
                        }},
                    }},
                },
            },
            VolumeClaimTemplates: []corev1.PersistentVolumeClaim{{
                ObjectMeta: metav1.ObjectMeta{
                    Name: "data",
                },
                Spec: corev1.PersistentVolumeClaimSpec{
                    AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
                    Resources: corev1.ResourceRequirements{
                        Requests: corev1.ResourceList{
                            corev1.ResourceStorage: resource.MustParse(cr.Spec.Storage),
                        },
                    },
                },
            }},
        },
    }
}
```

## 使用 CR

创建 Operator 后，用户可以通过 YAML 使用它：

```yaml
apiVersion: mycompany.com/v1
kind: MySQLCluster
metadata:
  name: my-db
  namespace: production
spec:
  replicas: 3
  version: "8.0"
  storage: "100Gi"
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: "2"
      memory: 4Gi
```

Operator 会自动创建对应的 StatefulSet、Service、PV/PVC。

## Webhook 与 Admission

Operator 可以添加 Validating Webhook 和 Mutating Webhook，在 CR 创建/更新前做校验和修改：

```go
// ValidatingWebhook：校验 CR 的合法性
func (r *MySQLCluster) ValidateCreate() error {
    if r.Spec.Replicas < 1 {
        return errors.New("replicas must be at least 1")
    }
    if r.Spec.Replicas > 9 {
        return errors.New("replicas cannot exceed 9 (ZooKeeper limitation)")
    }
    return nil
}

// MutatingWebhook：在创建前设置默认值
func (r *MySQLCluster) Default() {
    if r.Spec.Replicas == 0 {
        r.Spec.Replicas = 3
    }
    if r.Spec.Version == "" {
        r.Spec.Version = "8.0"
    }
    if r.Spec.Storage == "" {
        r.Spec.Storage = "10Gi"
    }
}
```

## 最佳实践

### 1. 状态设计

CR 的 status 应该反映真实状态，而不是期望状态：

```go
type MySQLClusterStatus struct {
    ReadyReplicas int32       // 实际 Ready 的副本数
    Phase         string      // 集群当前状态（Initializing/Running/Failed）
    Conditions    []Condition // 详细状态条件
}
```

### 2. 错误处理与重试

Reconcile 函数返回 `ctrl.Result{Requeue: true}` 表示需要重新入队：

```go
if err != nil {
    if retryable {
        return ctrl.Result{Requeue: true}, err  // 可重试错误，重新入队
    }
    return ctrl.Result{}, err  // 不可重试错误，停止处理
}
```

### 3. Leader Election

多副本 Operator 确保只有一个实例执行 Reconcile：

```go
func main() {
    mgr, _ := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{...})
    // Leader Election 由 controller-runtime 自动处理
    // 只需确保 Deployment replicas=1
}
```

## 面试追问方向

- Reconcile 函数的「协调循环」是什么？为什么它会反复执行？
- Status 和 Spec 的更新有什么区别？为什么不应该在 Reconcile 中直接更新 Spec？
- Operator 和原生 K8s Controller（如 Deployment Controller）的关系是什么？
- Webhook 和 Reconcile 的执行顺序是什么？它们分别适合做什么？

> Operator 是 K8s 的扩展引擎。通过 Kubebuilder，开发者可以把自己对有状态应用的运维经验编码成 CRD，让 K8s 自动执行那些原本需要人工介入的操作——这就是 K8s Operator 的精髓。
