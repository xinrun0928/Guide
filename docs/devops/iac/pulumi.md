# Pulumi：真正的代码式 IaC

「不想写 HCL？」——Pulumi 用你熟悉的编程语言定义基础设施。

Terraform 使用 HCL（HashiCorp Configuration Language），语法简洁但表达能力有限。Pulumi 用 TypeScript、Python、Go、C# 等编程语言定义基础设施，逻辑更灵活，可以写循环、函数、测试——这才是真正的「代码即基础设施」。

## Pulumi vs Terraform

```
┌─────────────────────────────────────────────────────────────────┐
│                    Pulumi vs Terraform                            │
│                                                                  │
│  Terraform (HCL)                     Pulumi (编程语言)           │
│  ├── 声明式配置                       ├── 声明式 + 命令式混合   │
│  ├── 无循环（用 count/for_each）      ├── 支持完整循环/条件      │
│  ├── 无函数复用（HCL 函数有限）       ├── 支持函数和类           │
│  ├── 无类型系统                       ├── 强类型系统             │
│  ├── 无单元测试                       ├── 支持单元测试          │
│  └── 社区生态成熟                    └── 社区生态增长中          │
│                                                                  │
│  Terraform: 配置即代码                                        │
│  Pulumi: 代码即配置                                           │
└─────────────────────────────────────────────────────────────────┘
```

| 维度 | Terraform | Pulumi |
|------|-----------|--------|
| 语言 | HCL | TypeScript / Python / Go / C# |
| 循环 | count / for_each | 原生 for 循环 |
| 条件 | count / if | 原生 if/else |
| 函数 | 内置函数 | 语言标准库 + SDK |
| 测试 | Terratest | 原生单元测试 / 集成测试 |
| 状态 | .tfstate | Pulumi Service / S3 / etcd |
| 学习曲线 | HCL 简单 | 需要语言基础 |

## Pulumi 安装与项目创建

```bash
# 安装 Pulumi
brew install pulumi

# 登录 Pulumi（创建免费账户）
pulumi login

# 创建新项目（TypeScript）
mkdir my-infra && cd my-infra
pulumi new aws-typescript

# 或 Python
pulumi new aws-python

# 或 Go
pulumi new aws-go
```

### 项目结构

```
my-infra/
├── Pulumi.yaml           # 项目元数据
├── Pulumi.dev.yaml      # 开发环境配置
├── Pulumi.prod.yaml     # 生产环境配置
├── tsconfig.json        # TypeScript 配置
├── package.json
├── package-lock.json
└── index.ts             # 入口文件
```

## 基础资源定义

### TypeScript

```typescript
// index.ts
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// 创建 VPC
const vpc = new aws.ec2.Vpc("my-vpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: {
        Name: "my-vpc",
        Environment: pulumi.getStack(),
    },
});

// 创建子网
const publicSubnet = new aws.ec2.Subnet("public-subnet", {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: "us-east-1a",
    mapPublicIpOnLaunch: true,
    tags: {
        Name: "my-public-subnet",
        Environment: pulumi.getStack(),
    },
});

const privateSubnet = new aws.ec2.Subnet("private-subnet", {
    vpcId: vpc.id,
    cidrBlock: "10.0.10.0/24",
    availabilityZone: "us-east-1a",
    tags: {
        Name: "my-private-subnet",
        Environment: pulumi.getStack(),
    },
});

// 创建 Internet Gateway
const igw = new aws.ec2.InternetGateway("igw", {
    vpcId: vpc.id,
    tags: {
        Name: "my-igw",
        Environment: pulumi.getStack(),
    },
});

// 创建路由表
const publicRouteTable = new aws.ec2.RouteTable("public-rt", {
    vpcId: vpc.id,
    routes: [
        {
            cidrBlock: "0.0.0.0/0",
            gatewayId: igw.id,
        },
    ],
    tags: {
        Name: "my-public-rt",
        Environment: pulumi.getStack(),
    },
});

// 路由表关联
const publicSubnetAssoc = new aws.ec2.RouteTableAssociation("public-subnet-assoc", {
    subnetId: publicSubnet.id,
    routeTableId: publicRouteTable.id,
});

// 创建安全组
const webSg = new aws.ec2.SecurityGroup("web-sg", {
    name: "web-sg",
    description: "Security group for web servers",
    vpcId: vpc.id,
    ingress: [
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"],
            description: "HTTP",
        },
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks: ["0.0.0.0/0"],
            description: "HTTPS",
        },
    ],
    egress: [
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    tags: {
        Name: "my-web-sg",
        Environment: pulumi.getStack(),
    },
});

// 输出
export const vpcId = vpc.id;
export const vpcCidr = vpc.cidrBlock;
export const publicSubnetId = publicSubnet.id;
export const privateSubnetId = privateSubnet.id;
```

## 循环与动态资源

### TypeScript 循环

```typescript
// 创建多个子网
const availabilityZones = ["us-east-1a", "us-east-1b", "us-east-1c"];

const publicSubnets = availabilityZones.map((az, index) => {
    return new aws.ec2.Subnet(`public-subnet-${az}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${index + 1}.0/24`,
        availabilityZone: az,
        mapPublicIpOnLaunch: true,
        tags: {
            Name: `public-subnet-${az}`,
            Environment: pulumi.getStack(),
        },
    });
});

// 条件创建
const createNatGateway = true;

const natGateway = createNatGateway
    ? new aws.ec2.NatGateway("nat-gw", {
          subnetId: publicSubnets[0].id,
          allocationId: eip.id,
      })
    : null;
```

### 动态组件

```typescript
import * as pulumi from "@pulumi/pulumi";

// 动态组件：可复用的 ECS Service
class EcsService extends pulumi.ComponentResource {
    public readonly serviceName: pulumi.Output<string>;
    public readonly cluster: aws.ecs.Cluster;

    constructor(
        name: string,
        args: {
            cluster: aws.ecs.Cluster;
            image: string;
            desiredCount: number;
            subnetIds: string[];
        },
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("my:EcsService", name, {}, opts);

        const taskDefinition = new aws.ecs.TaskDefinition(name, {
            family: name,
            cpu: "256",
            memory: "512",
            networkMode: "awsvpc",
            requiresCompatibilities: ["FARGATE"],
            containerDefinitions: pulumi.jsonStringify([
                {
                    name: name,
                    image: args.image,
                    essential: true,
                    portMappings: [
                        {
                            containerPort: 8080,
                            protocol: "tcp",
                        },
                    ],
                },
            ]),
        }, { parent: this });

        const securityGroup = new aws.ec2.SecurityGroup(`${name}-sg`, {
            name: `${name}-sg`,
            description: `Security group for ${name}`,
            vpcId: args.cluster.vpcId,
            ingress: [
                {
                    protocol: "tcp",
                    fromPort: 8080,
                    toPort: 8080,
                    cidrBlocks: ["0.0.0.0/0"],
                },
            ],
            egress: [
                {
                    protocol: "-1",
                    fromPort: 0,
                    toPort: 0,
                    cidrBlocks: ["0.0.0.0/0"],
                },
            ],
        }, { parent: this });

        const service = new aws.ecs.Service(name, {
            cluster: args.cluster.arn,
            taskDefinition: taskDefinition.arn,
            desiredCount: args.desiredCount,
            launchType: "FARGATE",
            networkConfiguration: {
                subnets: args.subnetIds,
                securityGroups: [securityGroup.id],
            },
        }, { parent: this });

        this.serviceName = service.name;
        this.cluster = args.cluster;
    }
}

// 使用动态组件
const orderService = new EcsService("order-service", {
    cluster: ecsCluster,
    image: "my-registry/order-service:v1.0.0",
    desiredCount: 3,
    subnetIds: privateSubnets.map((s) => s.id),
});
```

## 配置与环境

```typescript
// Pulumi.dev.yaml
config:
  aws:region: us-east-1
  my-infra:environment: development
  my-infra:desiredCount: "1"
  my-infra:instanceType: t3.micro

// Pulumi.prod.yaml
config:
  aws:region: us-east-1
  my-infra:environment: production
  my-infra:desiredCount: "3"
  my-infra:instanceType: t3.medium
```

```typescript
// index.ts
import * as pulumi from "@pulumi/pulumi";

// 获取配置
const config = new pulumi.Config();
const environment = config.require("environment");
const desiredCount = config.requireNumber("desiredCount");
const instanceType = config.require("instanceType") as aws.ec2.InstanceType;

// 根据环境调整配置
const autoScalingEnabled = environment === "production";

const asg = new aws.autoscaling.Group("asg", {
    minSize: environment === "production" ? 3 : 1,
    maxSize: environment === "production" ? 10 : 2,
    desiredCapacity: desiredCount,
    vpcZoneIdentifiers: privateSubnetIds,
    launchTemplate: {
        id: launchTemplate.id,
        version: "$Latest",
    },
    tags: [
        {
            key: "Environment",
            value: environment,
            propagateAtLaunch: true,
        },
    ],
});
```

## 测试

### 单元测试

```typescript
// __tests__/vpc.test.ts
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

describe("VPC Tests", () => {
    it("should create VPC with correct CIDR", async () => {
        const vpc = new aws.ec2.Vpc("test-vpc", {
            cidrBlock: "10.0.0.0/16",
        });

        const vpcId = await runtime.run(vpc.id);
        const vpcCidr = await runtime.run(vpc.cidrBlock);

        expect(vpcId).toBeDefined();
        expect(vpcCidr).toBe("10.0.0.0/16");
    });

    it("should enable DNS support", async () => {
        const vpc = new aws.ec2.Vpc("test-vpc", {
            cidrBlock: "10.0.0.0/16",
            enableDnsSupport: true,
            enableDnsHostnames: true,
        });

        const enableDnsSupport = await runtime.run(vpc.enableDnsSupport);
        const enableDnsHostnames = await runtime.run(vpc.enableDnsHostnames);

        expect(enableDnsSupport).toBe(true);
        expect(enableDnsHostnames).toBe(true);
    });
});
```

## Pulumi vs Terraform 对比

| 场景 | Terraform | Pulumi |
|------|-----------|--------|
| 简单资源创建 | 简洁 | 需要写类/函数 |
| 循环创建多个资源 | for_each / count | 原生 for 循环 |
| 条件逻辑 | 较复杂 | 原生 if/else |
| 业务逻辑封装 | Module + interpolation | 类继承/组合 |
| 测试 | Terratest | 原生单元测试 |
| 团队技能 | HCL | TypeScript/Python/Go/C# |
| 状态管理 | 多种 backend | Pulumi Service / 自托管 |

## Pulumi Stack 生命周期

```bash
# 创建 Stack
pulumi stack init dev
pulumi stack init staging
pulumi stack init production

# 查看 Stack 列表
pulumi stack ls

# 选择 Stack
pulumi stack select dev

# 预览变更
pulumi preview

# 应用变更
pulumi up

# 销毁资源
pulumi destroy

# 查看输出
pulumi stack output
```

## 面试追问方向

1. **Pulumi 和 Terraform 的本质区别是什么？**
   答：Terraform 用 HCL 描述配置（声明式 DSL）；Pulumi 用通用编程语言描述基础设施（代码化 IaC）。Pulumi 的优势是逻辑复用能力强，可以写函数、循环、测试；劣势是团队需要掌握编程语言，学习成本略高。

2. **Pulumi 如何处理状态？**
   答：Pulumi 默认将状态存储在 Pulumi Service（云服务，免费给个人/团队用）；也支持自托管状态（S3 + DynamoDB、Azure Blob Storage、GCS）。Pulumi Service 提供免费的状态管理、团队协作、审计日志。

3. **什么时候选 Pulumi 而不是 Terraform？**
   答：团队已经熟悉 TypeScript/Python/Go；需要复杂的业务逻辑（循环、函数、类）；需要编写单元测试验证基础设施代码；需要与现有的 CI/CD 流水线深度集成（用同一种语言）。对于标准的基础设施（HCL 模块已成熟），Terraform 依然是好选择。

4. **Pulumi 如何处理 Provider 差异？**
   答：Pulumi 的 Provider 机制和 Terraform 类似，但封装在语言 SDK 中。AWS Provider 叫 `@pulumi/aws`，Azure 叫 `@pulumi/azure-native`，Kubernetes 叫 `@pulumi/kubernetes`。可以同时使用多个 Provider，每个资源指定 `provider` 选项。

Pulumi 代表了 IaC 的未来方向——用熟悉的编程语言管理基础设施。代码即配置，测试即验证，这才是真正的 DevOps。
