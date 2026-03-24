# Terraform 模块化与最佳实践

「Terraform 代码怎么复用？」——Module 是 Terraform 的代码复用单元。

Terraform 的 Module 类似 Ansible Roles——将可复用的基础设施配置封装成独立单元。一套 VPC、ECS、RDS 的配置，写成 Module 后可以在不同项目、不同环境、不同账户中复用，大幅减少重复代码。

## Module 基础

### 第一个 Module

```
modules/
└── networking/
    ├── main.tf          # 核心资源定义
    ├── variables.tf     # 输入变量
    ├── outputs.tf       # 输出值
    └── README.md        # 文档
```

```hcl
# modules/networking/main.tf
variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDRs"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${var.environment}-vpc"
    Environment = var.environment
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name        = "${var.environment}-igw"
    Environment = var.environment
  }
}

resource "aws_subnet" "public" {
  count = length(var.public_subnet_cidrs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name        = "${var.environment}-public-${count.index + 1}"
    Environment = var.environment
    Type        = "public"
  }
}

resource "aws_subnet" "private" {
  count = length(var.private_subnet_cidrs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone  = var.availability_zones[count.index]

  tags = {
    Name        = "${var.environment}-private-${count.index + 1}"
    Environment = var.environment
    Type        = "private"
  }
}

resource "aws_nat_gateway" "main" {
  count = min(length(var.public_subnet_cidrs), 1)  # 只创建 1 个 NAT Gateway 节省成本

  connectivity_type = "public"
  subnet_id         = aws_subnet.public[count.index].id

  tags = {
    Name        = "${var.environment}-nat"
    Environment = var.environment
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[0].id
  }

  tags = {
    Name        = "${var.environment}-private-rt"
    Environment = var.environment
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name        = "${var.environment}-public-rt"
    Environment = var.environment
  }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count = length(aws_subnet.private)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
```

### outputs.tf

```hcl
# modules/networking/outputs.tf
output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "VPC CIDR block"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "nat_gateway_id" {
  description = "NAT Gateway ID"
  value       = length(aws_nat_gateway.main) > 0 ? aws_nat_gateway.main[0].id : null
}

output "internet_gateway_id" {
  description = "Internet Gateway ID"
  value       = aws_internet_gateway.main.id
}
```

## 使用 Module

```hcl
# environments/production/main.tf
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "my-app"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}

# 调用 networking module
module "networking" {
  source = "../../modules/networking"

  vpc_cidr       = "10.1.0.0/16"
  environment    = "production"
  availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

  public_subnet_cidrs = ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"]
  private_subnet_cidrs = ["10.1.11.0/24", "10.1.12.0/24", "10.1.13.0/24"]
}

# 调用 ECS module
module "ecs" {
  source = "../../modules/ecs"

  cluster_name = "my-app"
  environment = "production"

  vpc_id           = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  public_subnet_ids  = module.networking.public_subnet_ids

  desired_count = 2
  max_size      = 5
  min_size      = 1

  container_port = 8080
  container_image = "myregistry/my-app:v1.0.0"
}
```

## Module 版本管理

### Terraform Registry

```hcl
# 使用 Terraform Registry 的 module
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "my-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["us-east-1a", "us-east-1b", "us-east-1c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = true
  one_nat_gateway_per_az = false

  tags = {
    Environment = "production"
    ManagedBy   = "terraform"
  }
}
```

### 私有 Module Registry

```hcl
# 使用私有 Registry 的 module
module "networking" {
  source  = "app.terraform.io/my-org/networking/aws"
  version = "2.0.0"

  # ...
}
```

### Git 作为 Module 源

```hcl
# 使用 Git 分支
module "networking" {
  source = "git::https://github.com/my-org/terraform-networking.git?ref=feature/new-cidr"
}

# 使用 Git 标签
module "networking" {
  source = "git::https://github.com/my-org/terraform-networking.git?ref=v2.0.0"
}

# 使用子目录
module "networking" {
  source = "git::https://github.com/my-org/terraform-infra.git//modules/networking?ref=v2.0.0"
}
```

## Module 设计模式

### 模式一：可组合 Module

```hcl
# modules/ecs-service/main.tf
# 设计理念：每个 Module 职责单一，可以自由组合

variable "service_name" {}
variable "desired_count" {}
variable "container_definitions" {}

resource "aws_ecs_service" "main" {
  name            = var.service_name
  cluster         = var.cluster_id
  task_definition = var.task_definition_arn
  desired_count   = var.desired_count

  deployment_controller {
    type = "ECS"
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}
```

```hcl
# 组合使用
module "myapp_ecs" {
  source = "../../modules/ecs-service"

  service_name         = "my-app"
  cluster_id           = module.ecs_cluster.cluster_id
  task_definition_arn   = module.ecs_task.arn
  desired_count        = 3
}
```

### 模式二：环境 Module

```hcl
# environments/production/eks/main.tf
module "eks" {
  source = "../../modules/eks"

  cluster_name    = "my-app-prod"
  cluster_version = "1.28"

  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids

  eks_managed_node_groups = {
    general = {
      min_size       = 2
      max_size       = 10
      desired_size   = 3
      instance_types = ["t3.medium"]
    }
  }

  cluster_endpoint_public_access = true

  tags = {
    Environment = "production"
  }
}

# 输出给其他 module 使用
output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "cluster_name" {
  value = module.eks.cluster_name
}
```

### 模式三：动态 Module

```hcl
# 动态创建多个相似的资源
variable "applications" {
  type = map(object({
    port     = number
    cpu      = number
    memory   = number
    desired  = number
  }))
  default = {
    frontend = {
      port     = 80
      cpu      = 256
      memory   = 512
      desired  = 2
    }
    api = {
      port     = 8080
      cpu      = 512
      memory   = 1024
      desired  = 3
    }
  }
}

module "services" {
  source = "../../modules/ecs-service"

  for_each = var.applications

  service_name = each.key
  container_port = each.value.port
  container_cpu = each.value.cpu
  container_memory = each.value.memory
  desired_count = each.value.desired
}
```

## Module 测试

### Terratest

```go
// modules/networking/networking_test.go
package test

import (
    "testing"
    "fmt"

    "github.com/gruntwork-io/terratest/modules/terraform"
    "github.com/stretchr/testify/assert"
)

func TestNetworkingModule(t *testing.T) {
    terraformOptions := &terraform.Options{
        TerraformDir: "../examples/simple",
        Vars: map[string]interface{}{
            "environment": "test",
            "vpc_cidr":   "10.99.0.0/16",
        },
    }

    defer terraform.Destroy(t, terraformOptions)
    terraform.InitAndApply(t, terraformOptions)

    vpcId := terraform.Output(t, terraformOptions, "vpc_id")
    assert.NotEmpty(t, vpcId)

    publicSubnetIds := terraform.OutputList(t, terraformOptions, "public_subnet_ids")
    assert.Equal(t, 3, len(publicSubnetIds))

    privateSubnetIds := terraform.OutputList(t, terraformOptions, "private_subnet_ids")
    assert.Equal(t, 3, len(privateSubnetIds))

    igwId := terraform.Output(t, terraformOptions, "internet_gateway_id")
    assert.NotEmpty(t, igwId)

    fmt.Printf("VPC ID: %s\n", vpcId)
    fmt.Printf("Public Subnet IDs: %v\n", publicSubnetIds)
}
```

## Module 最佳实践

### 1. 变量验证

```hcl
# modules/networking/variables.tf
variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "The VPC CIDR must be a valid CIDR block."
  }

  validation {
    condition     = contains(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"], split("/", var.vpc_cidr)[0])
    error_message = "VPC CIDR must be in private address space (10.0.0.0/8, 172.16.0.0/12, or 192.168.0.0/16)."
  }
}

variable "environment" {
  description = "Environment name"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}
```

### 2. Module 文档

```markdown
# modules/networking/README.md
# Networking Module

## Usage

```hcl
module "networking" {
  source  = "git::https://github.com/my-org/terraform-modules.git//networking?ref=v2.0.0"

  vpc_cidr    = "10.1.0.0/16"
  environment = "production"
}
```

## Inputs

| Name | Description | Type | Required | Default |
|------|-------------|------|----------|---------|
| vpc_cidr | VPC CIDR block | `string` | Yes | - |
| environment | Environment name | `string` | Yes | - |
| availability_zones | Availability zones | `list(string)` | No | `["us-east-1a", "us-east-1b", "us-east-1c"]` |

## Outputs

| Name | Description |
|------|-------------|
| vpc_id | VPC ID |
| public_subnet_ids | Public subnet IDs |
| private_subnet_ids | Private subnet IDs |
| internet_gateway_id | Internet Gateway ID |
```

### 3. 本地 Module vs Registry Module

| 场景 | 推荐 |
|------|------|
| 公司内部通用基础设施（VPC、RDS） | 本地 Module + 私有 Registry |
| 公开的开源基础设施 | Terraform Registry |
| 业务定制的基础设施 | 本地 Module |
| 简单一次性资源 | 直接在 main.tf 中写 |

## 面试追问方向

1. **Terraform Module 和 Terragrunt 的区别是什么？**
   答：Module 是 Terraform 内置的代码复用机制；Terragrunt 是第三方工具，提供 DRY（Don't Repeat Yourself）配置、远程状态管理、模块版本管理等功能。Terragrunt 可以调用 Module 并自动注入变量，适合管理大量环境的场景。

2. **如何管理 Terraform Module 的版本？**
   答：Terraform Registry 使用语义版本（SemVer），通过 `version` 约束指定版本；Git 来源使用 `ref` 指定分支/标签/Commit；私有 Registry 支持版本标签管理。推荐使用语义版本，便于追踪升级路径。

3. **Terraform Module 的状态隔离怎么做？**
   答：每个 Module 的状态应该独立管理，通过 `terraform_remote_state` 或 `module.xxx.output` 传递数据。避免在 Module 内部创建跨环境的资源。Module 本身不应包含 backend 配置，由调用方决定。

4. **Module 如何处理敏感信息？**
   答：敏感变量标记 `sensitive = true`；不在 Module 输出中暴露敏感值；在 Module 内部使用 `aws_secretsmanager_secret_version` 等获取密钥；避免在变量默认值中硬编码敏感信息。

Module 是 Terraform 代码组织的核心。好的 Module 设计，可以让基础设施配置像乐高积木一样自由组合。
