# Terraform 基础入门

「Terraform 怎么用？」——声明式地管理你的基础设施。

Terraform 是 HashiCorp 出品的 IaC（Infrastructure as Code）工具，用 HCL（HashiCorp Configuration Language）描述基础设施配置。它能管理 AWS、GCP、Azure、Kubernetes 等各种云平台和基础设施资源，并且能够追踪配置变更、管理版本、回滚操作。

## 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                    Terraform 工作流程                             │
│                                                                  │
│  写配置 (.tf) ──► terraform init ──► terraform plan ──► terraform apply │
│       │                                         │                    │
│       │                                    预览变更                   │
│       │                                         │                    │
│       ▼                                         ▼                    │
│  .tfstate ◄───────────────────────────── 实际基础设施             │
│  (状态文件)                                    (真实世界)              │
└─────────────────────────────────────────────────────────────────┘
```

- **Configuration（HCL 配置）**：描述「你想要什么样的基础设施」
- **State（状态文件）**：记录「当前实际的基础设施是什么样」
- **Plan（计划）**：对比 Configuration 和 State，输出「需要做什么变更」
- **Apply（应用）**：执行变更，更新 State

## 安装与快速上手

```bash
# macOS 安装
brew install terraform

# 验证安装
terraform version
# Terraform v1.6.0

# AWS CLI 配置（Terraform 会自动读取）
aws configure

# 创建工作目录
mkdir my-infra && cd my-infra
```

## 第一个 Terraform 配置

### AWS 资源

```hcl
# main.tf
# 指定 Provider
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# 配置 Provider
provider "aws" {
  region = "us-east-1"
}

# 创建资源：EC2 实例
resource "aws_instance" "web_server" {
  ami           = "ami-0c55b159cbfafe1f0"  # Amazon Linux 2 AMI (us-east-1)
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.main.id

  tags = {
    Name        = "web-server"
    Environment = "development"
    ManagedBy   = "terraform"
  }
}

# 创建 VPC
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "my-vpc"
    Environment = "development"
  }
}

# 创建子网
resource "aws_subnet" "main" {
  vpc_id                  = aws_vpc.main.id
  cidr_block             = "10.0.1.0/24"
  availability_zone      = "us-east-1a"
  map_public_ip_on_launch = true

  tags = {
    Name        = "my-subnet"
    Environment = "development"
  }
}

# 创建安全组
resource "aws_security_group" "web" {
  name        = "web-sg"
  description = "Security group for web server"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "web-sg"
    Environment = "development"
  }
}

# 关联安全组
resource "aws_vpc_security_group_ingress_rule" "web_ingress" {
  security_group_id = aws_instance.web_server.security_group
  description       = "HTTP from anywhere"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}
```

## Terraform 命令

```bash
# 初始化（下载 Provider、初始化后端）
terraform init

# 预览变更（dry-run）
terraform plan

# 预览变更并保存到文件
terraform plan -out=tfplan

# 应用变更
terraform apply

# 应用变更（不询问）
terraform apply -auto-approve

# 应用指定的计划文件
terraform apply tfplan

# 销毁所有资源
terraform destroy

# 销毁（不询问）
terraform destroy -auto-approve

# 查看当前状态
terraform show

# 查看资源列表
terraform state list

# 查看资源详情
terraform state show aws_instance.web_server

# 手动移动资源到 State
terraform state mv aws_instance.old aws_instance.new

# 删除 State 中的资源（不从云端删除）
terraform state rm aws_instance.web_server

# 导入已有资源到 State
terraform import aws_instance.web_server i-xxxxxxxxxx

# 格式化配置文件
terraform fmt

# 验证配置文件语法
terraform validate

# 获取依赖
terraform get

# 输出值
terraform output
terraform output instance_ip
```

## 变量与输出

### 变量定义

```hcl
# variables.tf
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"

  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type)
    error_message = "Instance type must be t3.micro, t3.small, or t3.medium."
  }
}

variable "environment" {
  description = "Environment name"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "ami_id" {
  description = "AMI ID for EC2 instance"
  type        = string
  sensitive   = true  # 敏感变量，不会显示在 plan 输出中
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
```

### 变量赋值

```bash
# 方式一：命令行指定
terraform apply -var="environment=production" -var="instance_type=t3.medium"

# 方式二：terraform.tfvars 文件（自动加载）
# terraform.tfvars
aws_region    = "us-east-1"
environment   = "production"
instance_type = "t3.medium"
tags = {
  Project     = "my-app"
  Environment = "production"
}

# 方式三：*..auto.tfvars 文件（自动加载）
# production.auto.tfvars

# 方式四：环境变量（TF_VAR_ 前缀）
export TF_VAR_aws_region="us-east-1"
export TF_VAR_environment="production"
```

### 输出值

```hcl
# outputs.tf
output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.web_server.id
}

output "instance_ip" {
  description = "EC2 instance public IP"
  value       = aws_instance.web_server.public_ip
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "all_outputs" {
  description = "All outputs as JSON"
  value       = {
    instance_id = aws_instance.web_server.id
    instance_ip = aws_instance.web_server.public_ip
    vpc_id      = aws_vpc.main.id
  }
}
```

## 数据源与查找

```hcl
# 获取 AMI 信息
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# 获取可用区
data "aws_availability_zones" "available" {
  state = "available"
}

# 使用数据源
resource "aws_instance" "web_server" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = var.instance_type
  # ...
}

# 获取已有 VPC
data "aws_vpc" "existing" {
  filter {
    name   = "tag:Name"
    values = ["my-existing-vpc"]
  }
}
```

## 条件与循环

### count（数量循环）

```hcl
# 创建 3 个 EC2 实例
resource "aws_instance" "server" {
  count         = 3
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.main.id

  tags = {
    Name = "server-${count.index}"
  }
}

# 条件创建
resource "aws_instance" "web_server" {
  count         = var.create_web_server ? 1 : 0
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"
  # ...
}
```

### for_each（键值循环）

```hcl
# 创建多个子网
variable "subnets" {
  type = map(object({
    cidr        = string
    availability_zone = string
    public      = bool
  }))
  default = {
    public_1a = { cidr = "10.0.1.0/24", availability_zone = "us-east-1a", public = true }
    public_1b = { cidr = "10.0.2.0/24", availability_zone = "us-east-1b", public = true }
    private_1a = { cidr = "10.0.11.0/24", availability_zone = "us-east-1a", public = false }
  }
}

resource "aws_subnet" "subnet" {
  for_each = var.subnets

  vpc_id                  = aws_vpc.main.id
  cidr_block             = each.value.cidr
  availability_zone      = each.value.availability_zone
  map_public_ip_on_launch = each.value.public

  tags = {
    Name = each.key
    Type = each.value.public ? "public" : "private"
  }
}

output "subnet_ids" {
  value = aws_subnet.subnet[*].id
}
```

### 条件表达式

```hcl
# 根据环境选择实例类型
instance_type = var.environment == "production" ? "t3.medium" : "t3.micro"

# 根据条件选择资源
resource "aws_instance" "web" {
  count = var.environment == "production" ? 2 : 1
  # ...
}
```

## 依赖与引用

```hcl
# 隐式依赖（Terraform 自动推断）
resource "aws_instance" "web" {
  ami           = "ami-xxx"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.main.id  # 隐式依赖 aws_subnet.main
}

# 显式依赖（需要强制指定）
resource "aws_ebs_volume" "app" {
  availability_zone = "us-east-1a"
  size              = 100

  # 显式依赖 web_server（等待 web_server 创建后再创建）
  depends_on = [aws_instance.web_server]
}

# 参考资源属性
output "instance_ip" {
  # aws_instance.web_server.id — 获取 ID
  # aws_instance.web_server.public_ip — 获取公网 IP
  # aws_instance.web_server.private_ip — 获取私网 IP
  # aws_instance.web_server.tags — 获取标签
  value = aws_instance.web_server.public_ip
}

# 参考变量
output "instance_type" {
  value = var.instance_type
}
```

## 状态管理

```hcl
# 指定后端（远程状态）
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"  # 状态锁
  }
}

# 本地状态（默认）
# terraform {
#   backend "local" {
#     path = "terraform.tfstate"
#   }
# }
```

### S3 后端 + DynamoDB 锁

```bash
# 创建 S3 桶（用于存储状态）
aws s3 mb s3://my-terraform-state --region us-east-1

# 启用版本控制
aws s3api put-bucket-versioning \
  --bucket my-terraform-state \
  --versioning-configuration Status=Enabled

# 启用加密
aws s3api put-bucket-encryption \
  --bucket my-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }'

# 创建 DynamoDB 表（用于状态锁）
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

## 工作空间

```bash
# 创建工作空间
terraform workspace new dev
terraform workspace new staging
terraform workspace new production

# 列出工作空间
terraform workspace list

# 选择工作空间
terraform workspace select dev

# 查看当前工作空间
terraform workspace show

# 删除工作空间
terraform workspace delete dev
```

```hcl
# 使用工作空间变量
resource "aws_instance" "web_server" {
  count         = terraform.workspace == "production" ? 3 : 1
  ami           = "ami-xxx"
  instance_type = terraform.workspace == "production" ? "t3.medium" : "t3.micro"
  # ...
}
```

## 模块

```hcl
# 使用本地模块
module "vpc" {
  source = "./modules/vpc"

  name        = "my-vpc"
  cidr_block  = "10.0.0.0/16"
  environment = var.environment
}

# 使用 Terraform Registry 模块
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "my-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["us-east-1a", "us-east-1b", "us-east-1c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true
}
```

## 常见错误与调试

```bash
# 常见错误

# 1. State 锁定
# Error: Error acquiring the state lock
# 解决方法：等待其他操作完成，或手动解锁
terraform force-unlock <lock-id>

# 2. Provider 版本不兼容
# 解决方法：升级 Provider 或降低 Terraform 版本

# 3. 资源不存在
# Error: Resource already exists
# 解决方法：使用 terraform import 导入已有资源

# 调试
TF_LOG=DEBUG terraform apply   # 开启 debug 日志
TF_LOG_PATH=/tmp/terraform.log # 输出到文件
```

## IaC 工具对比

| 维度 | Terraform | Ansible | Pulumi | CloudFormation |
|------|-----------|---------|--------|---------------|
| 语法 | HCL | YAML | TypeScript/Python/Go | JSON/YAML |
| 状态管理 | 内置（State） | 无状态 | 内置（State） | AWS 原生 |
| 适用平台 | 多云 | 多云 + 主机 | 多云 + 主机 | AWS 专用 |
| 资源类型 | 声明式 | 声明式/过程式 | 声明式/过程式 | 声明式 |
| 学习曲线 | 中 | 低 | 高 | 中 |
| 社区生态 | 极大 | 大 | 增长中 | AWS 生态 |

## 面试追问方向

1. **Terraform 的 State 是什么？为什么不能删除？**
   答：State 是 Terraform 用来记录「实际基础设施长什么样」的文件。Terraform 通过对比 State 和配置文件来决定需要做什么变更。如果删除 State，Terraform 就会认为所有资源都不存在，再次 apply 会尝试创建所有资源（可能导致重复创建或冲突）。State 应该存放在远程后端（如 S3），开启版本控制和加密。

2. **Terraform 和 Ansible 的本质区别是什么？**
   答：Terraform 是声明式的——描述「我要什么结果」；Ansible 默认是过程式的——描述「我要执行什么操作」。Terraform 有 State（状态追踪），Ansible 默认无状态（幂等但不知道目标状态）。Terraform 适合创建/销毁整个基础设施，Ansible 适合配置管理和服务器初始化。

3. **如何避免 Terraform State 冲突？**
   答：使用远程后端（S3 + DynamoDB）实现状态锁；每个环境/模块使用独立的 State 文件；使用工作空间（Workspace）隔离环境；团队协作时，通过后端的锁机制防止并发修改。

4. **Terraform 如何处理敏感信息？**
   答：使用 `-var` 传入敏感变量；使用 `sensitive = true` 标记敏感变量（防止输出到日志）；将敏感值存在 AWS Secrets Manager / Vault 中，通过数据源读取；Terraform Cloud / Vault 提供企业级的密钥管理。

Terraform 的核心理念是「声明式」——你描述目标状态，Terraform 负责实现。这和 Kubernetes 的理念一脉相承。
