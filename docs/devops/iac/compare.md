# IaC 对比：Ansible vs Terraform vs Pulumi

「该用哪个 IaC 工具？」——没有最好的，只有最合适的。

Ansible、Terraform、Pulumi 是基础设施即代码（Infrastructure as Code）的三驾马车。Ansible 是配置管理的老将，Terraform 是声明式编排的王者，Pulumi 是代码优先的新秀。理解它们的定位和适用场景，才能做出正确的选择。

## 整体对比

| 维度 | Ansible | Terraform | Pulumi |
|------|---------|------------|--------|
| 定位 | 配置管理 + 编排 | 基础设施编排 | 通用编程 IaC |
| 类型 | 过程式 + 声明式 | 声明式 | 声明式（用代码） |
| 语言 | YAML | HCL / JSON | TypeScript/Python/Go |
| 状态管理 | 无状态（可加） | 有状态（tfstate） | 有状态（可选） |
| 执行模型 | SSH 执行命令 | Provider API 调用 | SDK 直接调用 |
| 资源管理 | 配置现有资源 | 创建/管理资源 | 创建/管理资源 |
| 生态系统 | 模块（Galaxy） | Provider 市场 | Pulumi Registry |
| 学习曲线 | 中（YAML 简单） | 中（HCL 独特） | 中（需编程语言） |
| 调试难度 | 中 | 中 | 低（标准调试工具） |
| 适用场景 | 配置管理、应用部署 | 基础设施（云资源） | 复杂基础设施逻辑 |

## Ansible：配置管理的老将

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ansible 特点                                   │
│                                                                  │
│  优势：                                                         │
│  ✓ 无代理，通过 SSH 执行                                         │
│  ✓ 配置管理 + 编排，一专多能                                    │
│  ✓ YAML 语法简单易懂                                           │
│  ✓ 丰富的模块生态（1800+ 模块）                                 │
│  ✓ 适合应用部署、中间件配置                                     │
│                                                                  │
│  劣势：                                                         │
│  ✗ 基础设施编排能力弱（不如 Terraform）                         │
│  ✗ 幂等性依赖模块实现                                          │
│  ✗ 状态管理弱                                                   │
│  ✗ 复杂逻辑用 Jinja2 模板，不够灵活                            │
└─────────────────────────────────────────────────────────────────┘
```

### 适用场景

```yaml
# Ansible 擅长的场景
- name: 配置管理
  tasks:
    - name: 安装 Nginx
      apt:
        name: nginx
        state: present

- name: 应用部署
  tasks:
    - name: 部署应用
      git:
        repo: "{{ app_repo }}"
        dest: /opt/app

- name: 中间件配置
  tasks:
    - name: 配置 Redis
      template:
        src: redis.conf.j2
        dest: /etc/redis/redis.conf
```

```
适合 Ansible 的场景：
1. 服务器配置管理（Nginx、Redis、MySQL）
2. 应用部署（war/jar 包、容器）
3. 临时任务和一次性操作
4. 小规模基础设施（< 50 台服务器）
5. 混合环境（虚拟机 + 物理机 + 云服务器）

不适合 Ansible 的场景：
1. 云资源创建（Terraform 更适合）
2. 复杂的状态管理
3. 需要版本控制的基础设施（如 VCS 驱动的环境）
```

## Terraform：基础设施编排的王者

```
┌─────────────────────────────────────────────────────────────────┐
│                    Terraform 特点                                 │
│                                                                  │
│  优势：                                                         │
│  ✓ 声明式语法，结果可预测                                       │
│  ✓ Provider 生态最丰富（AWS/GCP/Azure/K8s...）                 │
│  ✓ 状态管理，确保基础设施一致性                                 │
│  ✓ 计划预览，避免误操作                                         │
│  ✓ 远程状态，支持团队协作                                       │
│                                                                  │
│  劣势：                                                         │
│  ✗ HCL 语法独特，学习成本                                       │
│  ✗ 不擅长细粒度配置管理（配置已存在的基础设施）                  │
│  ✗ 调试困难（错误信息不够友好）                                 │
│  ✗ 循环和条件逻辑受限                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 适用场景

```hcl
# Terraform 擅长的场景
# 创建 VPC
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags = {
    Name = "production-vpc"
  }
}

# 创建 EKS 集群
resource "aws_eks_cluster" "main" {
  name     = "production-cluster"
  role_arn = aws_iam_role.eks_role.arn

  vpc_config {
    subnet_ids = aws_subnet.public[*].id
  }
}

# 创建 RDS
resource "aws_db_instance" "main" {
  identifier     = "production-db"
  engine         = "mysql"
  instance_class = "db.t3.medium"
  allocated_storage = 100
}
```

```
适合 Terraform 的场景：
1. 云资源创建和管理（VPC、EC2、RDS、EKS...）
2. 多云基础设施管理
3. 需要状态追踪的基础设施
4. 基础设施版本控制和审计
5. 复杂的环境一致性（dev/staging/prod）

不适合 Terraform 的场景：
1. 细粒度配置管理（Ansible 更适合）
2. 临时命令执行
3. 需要复杂业务逻辑的基础设施（用 Pulumi）
```

## Pulumi：代码优先的新秀

```
┌─────────────────────────────────────────────────────────────────┐
│                    Pulumi 特点                                    │
│                                                                  │
│  优势：                                                         │
│  ✓ 使用熟悉的编程语言（TypeScript/Python/Go...）                │
│  ✓ 完整的编程能力（循环、条件、函数、类）                       │
│  ✓ 标准调试工具（IDE 调试、单元测试）                          │
│  ✓ 共享和复用代码更容易                                        │
│  ✓ 基础设施即真正的代码                                        │
│                                                                  │
│ 劣势：                                                          │
│  ✗ 需要编程语言知识                                             │
│  ✗ HCL 用户需要适应                                            │
│  ✗ 相对 Terraform 还年轻，生态稍弱                              │
│  ✗ 学习曲线取决于编程语言能力                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 适用场景

```typescript
// Pulumi 擅长的场景：复杂基础设施逻辑
import * as aws from "@pulumi/aws";

const vpc = new aws.ec2.Vpc("main", {
  cidrBlock: "10.0.0.0/16",
  tags: { Name: "production-vpc" }
});

// 根据环境变量决定配置
const instanceCount = process.env.ENV === "production" ? 10 : 3;

// 循环创建资源
for (let i = 0; i < instanceCount; i++) {
  new aws.ec2.Instance(`server-${i}`, {
    ami: "ami-0c55b159cbfafe1f0",
    instanceType: "t3.medium",
    vpcSecurityGroupIds: [securityGroup.id],
    tags: { Name: `server-${i}` }
  });
}

// 依赖关系自动管理
const alb = new aws.lb.LoadBalancer("alb", {
  loadBalancerType: "application",
  subnets: vpc.publicSubnetIds,
});

const targetGroup = new aws.lb.TargetGroup("tg", {
  port: 80,
  protocol: "HTTP",
  vpcId: vpc.id,
});

new aws.lb.Listener("listener", {
  loadBalancerArn: alb.arn,
  port: 80,
  defaultActions: [{
    type: "forward",
    targetGroupArn: targetGroup.arn,
  }],
});
```

```
适合 Pulumi 的场景：
1. 需要复杂业务逻辑的基础设施
2. 团队熟悉 TypeScript/Python/Go
3. 需要单元测试的基础设施代码
4. 基础设施抽象和复用
5. 混合云 + 应用代码统一管理

不适合 Pulumi 的场景：
1. HCL 优先的团队（Terraform 更自然）
2. 简单基础设施（Terraform 更快）
3. 不熟悉编程语言的团队
```

## 选型决策树

```
┌─────────────────────────────────────────────────────────────────┐
│                    IaC 工具选型决策树                             │
│                                                                  │
│                   ┌─────────────────────┐                        │
│                   │ 你的主要目标是什么？   │                        │
│                   └──────────┬──────────┘                        │
│                              │                                    │
│         ┌────────────────────┼────────────────────┐              │
│         │                    │                    │              │
│    ┌────▼────┐         ┌─────▼────┐        ┌─────▼────┐         │
│    │  配置   │         │  云资源  │        │  复杂   │         │
│    │  管理   │         │  创建   │        │  逻辑   │         │
│    └────┬────┘         └─────┬────┘        └─────┬────┘         │
│         │                    │                    │              │
│    ┌────▼────┐         ┌─────▼────┐        ┌─────▼────┐         │
│    │ 需要   │         │ HCL     │        │ 熟悉   │         │
│    │ SSH   │         │ 优先？   │        │ 编程？ │         │
│    └────┬────┘         └─────┬────┘        └─────┬────┘         │
│         │                    │                    │              │
│    ┌────▼────────────┐ ┌─────▼────────────┐ ┌─────▼────────────┐ │
│    │    Ansible      │ │      Terraform    │ │     Pulumi      │ │
│    │ (无代理配置)    │ │ (声明式编排)     │ │ (代码优先)      │ │
│    └─────────────────┘ └──────────────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 组合使用

```
最佳实践：Ansible + Terraform 组合

┌─────────────────────────────────────────────────────────────────┐
│                    推荐组合：Terraform + Ansible                   │
│                                                                  │
│  Terraform（基础设施层）                                         │
│  - 创建 VPC、网络、子网                                         │
│  - 创建 EC2、RDS、EKS 等基础设施                                │
│  - 管理基础设施状态                                              │
│                                                                  │
│  Ansible（配置层）                                               │
│  - 配置服务器（Nginx、Redis、MySQL）                             │
│  - 部署应用                                                      │
│  - 细粒度配置管理                                                │
│                                                                  │
│  执行顺序：                                                      │
│  1. Terraform plan/apply（创建基础设施）                        │
│  2. Ansible（配置已创建的资源）                                  │
│  3. Terraform output（输出连接信息给 Ansible）                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  Terraform + Ansible                    │    │
│  │                                                         │    │
│  │  terraform apply ──► Ansible playbook ──► 完整环境     │    │
│  │       (创建资源)       (配置资源)                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Terraform + Ansible 示例

```hcl
# main.tf
resource "aws_instance" "web" {
  count = 3

  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.medium"
  subnet_id    = aws_subnet.public[count.index % length(aws_subnet.public)].id

  tags = {
    Name = "web-server-${count.index + 1}"
    Role = "web"
  }

  # 输出私有 IP 给 Ansible
  provisioner "local-exec" {
    command = "echo '${self.private_ip}' >> inventory.txt"
  }
}

# 输出给 Ansible
output "web_private_ips" {
  value = aws_instance.web[*].private_ip
}
```

```yaml
# deploy.yml
---
- name: Deploy application to web servers
  hosts: all
  become: yes

  vars:
    app_version: "{{ lookup('env', 'APP_VERSION') }}"

  tasks:
    - name: Install dependencies
      apt:
        name:
          - nginx
          - python3
        state: present

    - name: Deploy application
      git:
        repo: "https://github.com/example/app.git"
        version: "{{ app_version }}"
        dest: /opt/app

    - name: Configure nginx
      template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
      notify: Reload nginx

    - name: Start nginx
      service:
        name: nginx
        state: started

  handlers:
    - name: Reload nginx
      service:
        name: nginx
        state: reloaded
```

## 常见错误

```
# 错误一：用 Ansible 创建云资源
# 原因：Ansible 云模块不如 Terraform 完善
# 解决：用 Terraform 创建资源，Ansible 配置资源

# 错误二：Terraform 和 Ansible 手动混用
# 原因：状态不同步
# 解决：Terraform 管理基础设施状态；Ansible 只负责配置

# 错误三：Pulumi 代码太面向过程
# 原因：没有理解 Pulumi 的声明式本质
# 解决：定义资源依赖，Pulumi 自动管理执行顺序

# 错误四：状态管理混乱
# 原因：Terraform state 放在本地
# 解决：用远程后端（S3 + DynamoDB / Terraform Cloud）

# 错误五：HCL 写复杂逻辑
# 原因：HCL 循环和条件有限
# 解决：用 Terraform 的 for_each、dynamic_blocks，或用 Pulumi
```

## 面试追问方向

1. **Ansible 和 Terraform 可以一起用吗？怎么用？**
   答：可以，推荐组合使用。Terraform 创建基础设施（VPC、EC2、RDS），Ansible 配置已创建的资源（Nginx 配置、应用部署）。Terraform `local-exec` 或 `remote-exec` 调用 Ansible；或者 Terraform 输出资源信息（IP、连接字符串），Ansible 读取执行。

2. **Terraform 的状态文件（tfstate）为什么重要？**
   答：tfstate 是 Terraform 管理的「地图」，记录了实际资源和配置的映射。如果 tfstate 丢失，Terraform 不知道资源是否已创建，可能导致重复创建或资源冲突。解决方案：用远程后端（S3 + DynamoDB）存储状态，并加锁。

3. **Pulumi 和 Terraform 的本质区别是什么？**
   答：Terraform 使用 HCL（自定义 DSL）描述基础设施；Pulumi 使用通用编程语言（TypeScript/Python/Go）。本质区别是抽象能力：Terraform 的抽象受 HCL 限制；Pulumi 可以用函数、类、循环、条件语句做复杂抽象，适合有编程背景的团队。

4. **Ansible 的幂等性是怎么保证的？**
   答：Ansible 的模块会检查当前状态，如果状态已经是目标状态，则跳过执行。例如 `service: state=stopped` 会先检查服务是否已停止，是则跳过，否才停止。这就是幂等性——多次执行结果和一次执行相同。

选 IaC 工具不是非此即彼，而是根据场景组合使用。Terraform 管理云资源，Ansible 配置服务器，Pulumi 处理复杂逻辑。
