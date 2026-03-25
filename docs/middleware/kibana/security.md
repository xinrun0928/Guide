# Kibana 安全功能：空间（Space）、角色、视图级别权限控制

数据安全是企业级应用的基础。Kibana 提供了完善的安全机制，让你能够精细控制用户对数据的访问权限。

## 1. Kibana 安全架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Kibana 安全架构                           │
│                                                               │
│   ┌─────────────┐                                           │
│   │   Spaces    │  ← 组织层面的隔离                         │
│   │  (空间)     │                                           │
│   └─────────────┘                                           │
│        │                                                     │
│        ▼                                                     │
│   ┌─────────────┐                                           │
│   │   Roles      │  ← 功能权限的定义                         │
│   │  (角色)     │                                           │
│   └─────────────┘                                           │
│        │                                                     │
│        ▼                                                     │
│   ┌─────────────┐                                           │
│   │ Privileges  │  ← 细粒度的数据权限                        │
│   │  (特权)     │                                           │
│   └─────────────┘                                           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 2. 空间（Spaces）

### 2.1 什么是空间？

空间是一种**组织机制**，用于将不同的项目、环境或团队的数据隔离。

```
空间示例：

┌─────────────────────────────────────────────────────────────┐
│  Kibana Spaces                                              │
│                                                               │
│  ┌─────────────────┐                                        │
│  │ Production       │  ← 生产环境空间                        │
│  │  └─ Dashboard    │                                        │
│  │  └─ Visualize   │                                        │
│  └─────────────────┘                                        │
│                                                               │
│  ┌─────────────────┐                                        │
│  │ Development     │  ← 开发环境空间                         │
│  │  └─ Dashboard   │                                        │
│  │  └─ Visualize   │                                        │
│  └─────────────────┘                                        │
│                                                               │
│  ┌─────────────────┐                                        │
│  │ Analytics       │  ← 分析团队空间                          │
│  │  └─ Dashboard   │                                        │
│  └─────────────────┘                                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 创建空间

```
创建空间步骤：

1. Stack Management → Spaces → Create space

2. 配置空间
   └─→ Name: Production
   └─→ Description: 生产环境监控
   └─→ Color: 蓝色
   └─→ Avatar: 可选图标

3. 设置访问权限
   └─→ 分配用户/角色
```

### 2.3 空间隔离的内容

| 内容类型 | 隔离 | 说明 |
|---------|------|------|
| Dashboard | ✓ | 仪表板 |
| Visualization | ✓ | 可视化 |
| Index Pattern | ✓ | 索引模式 |
| Saved Search | ✓ | 保存的搜索 |
| Canvas | ✓ | 数据画布 |
| Maps | ✓ | 地图 |

### 2.4 空间之间的切换

```
切换空间：

1. 点击 Kibana 左侧导航栏的 Logo
2. 选择目标空间
3. 或者直接在 URL 中指定空间
   └─→ http://kibana:5601/app/production/dashboards
```

## 3. 角色（Roles）

### 3.1 内置角色

Kibana 提供了几个内置角色：

| 角色 | 说明 | 权限 |
|-----|------|------|
| kibana_admin | Kibana 管理员 | 完全访问 |
| kibana_user | Kibana 用户 | 基本访问 |
| monitoring_user | 监控用户 | 只读监控 |
| remote_monitoring_agent | 远程监控 | 监控代理 |

### 3.2 创建自定义角色

```
创建角色步骤：

1. Stack Management → Roles → Create role

2. 基本信息
   └─→ Name: Data Analyst
   └─→ Description: 数据分析师角色

3. Kibana feature privileges
   └─→ Discover: Read
   └─→ Visualize: Read
   └─→ Dashboard: Read
   └─→ Canvas: None

4. Index privileges
   └─→ Index: analytics-*
   └─→ Privileges: Read, View_index_metadata
```

### 3.3 Feature Privileges

```
Feature Privileges（功能权限）：

┌─────────────────────────────────────────────────────────────┐
│  Feature              │ Read │ Write │ Create │ Delete     │
│  ─────────────────────────────────────────────────────────│
│  Discover            │  ✓   │  ✓    │   ✓    │   ✓       │
│  Visualize           │  ✓   │  ✓    │   ✓    │   ✓       │
│  Dashboard           │  ✓   │  ✓    │   ✓    │   ✓       │
│  Canvas              │  ✓   │  ✓    │   ✓    │   ✓       │
│  Maps                │  ✓   │  ✓    │   ✓    │   ✓       │
│  Stack Management    │      │       │        │           │
│  Alerting and Actions│      │       │   ✓    │           │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Read: 查看
Write: 编辑保存
Create: 创建新的
Delete: 删除
```

## 4. 索引权限（Index Privileges）

### 4.1 索引级别权限

```
索引权限配置：

┌─────────────────────────────────────────────────────────────┐
│  Index Privileges                                           │
│                                                             │
│  Index pattern: logs-*-read                                │
│  Allow read: ☑                                             │
│  Allow write: ☐                                             │
│  Allow create index: ☐                                      │
│  Allow delete: ☐                                           │
│  Allow run async search: ☐                                  │
│  Allow view index metadata: ☑                                │
│                                                             │
│  Field security:                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Grant access to specific fields only                 │  │
│  │ ☐ Sensitive fields                                   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 权限类型

| 权限 | 说明 | 适用场景 |
|-----|------|---------|
| Read | 搜索和聚合 | 只读用户 |
| Write | 索引和更新文档 | 数据写入 |
| Create Index | 创建索引 | 管理员 |
| Delete Index | 删除索引 | 管理员 |
| Manage ILM | 管理生命周期 | 运维 |
| View metadata | 查看索引元数据 | 所有用户 |

### 4.3 多索引模式

```java
// 支持通配符
logs-*          // 所有日志索引
logs-*-read     // 只读日志
logs-*-write    // 可写日志

// 支持多模式
logs-*,metrics-*  // 日志和指标

// 排除特定索引
logs-*,!logs-internal-*  // 排除内部日志
```

## 5. 字段级安全（Field Level Security）

### 5.1 字段限制

```
字段级安全配置：

场景：普通用户不能查看 password 字段

配置：
Grant access to specific fields: ☑
Fields: *  // 允许所有字段
Exclude fields: password, secret_token

效果：
用户只能看到除 password 和 secret_token 之外的所有字段
```

### 5.2 字段限制示例

```
配置示例：

允许字段：user_id, name, email
禁止字段：salary, password, api_key

{
  "fields": {
    "add": ["user_id", "name", "email"],
    "exclude": ["salary", "password", "api_key"]
  }
}
```

## 6. 文档级安全（Document Level Security）

### 6.1 基于查询的过滤

```
文档级安全配置：

场景：用户只能看到自己部门的数据

KQL 条件：
department: "user's department"

示例：
{
  "query": {
    "field": "department",
    "value": "engineering"
  }
}
```

### 6.2 动态字段过滤

```
动态文档级安全：

场景：用户只能看到自己的数据

{
  "field": "owner",
  "value": "{{user.username}}"
}

用户 Alice 登录时，查询自动添加：
owner: "Alice"
```

### 6.3 组合使用

```java
// 复杂场景

Index privileges:
├─ Index: sales-*
├─ Read: ☑
└─ Document level security:
    {
      "query": {
        "bool": {
          "should": [
            { "term": { "region": "{{user.metadata.region}}" } },
            { "term": { "public": true } }
          ]
        }
      }
    }

效果：用户只能看到自己区域的销售数据，或标记为 public 的数据
```

## 7. 实际场景配置

### 7.1 运维团队角色

```
角色：Operations Engineer

Kibana Feature Privileges:
├─ Discover: Read
├─ Visualize: Read/Write
├─ Dashboard: Read/Write
├─ Alerting: Read/Write
├─ Stack Management: Read

Index Privileges:
├─ Index: logs-*, metrics-*, apm-*
├─ Read: ☑
├─ Write: ☑
└─ Manage ILM: ☑
```

### 7.2 数据分析师角色

```
角色：Data Analyst

Kibana Feature Privileges:
├─ Discover: Read
├─ Visualize: Read/Write
├─ Dashboard: Read/Write
├─ Canvas: Read/Write
├─ Maps: Read

Index Privileges:
├─ Index: analytics-*, reports-*
├─ Read: ☑
└─ Field Level Security:
    ├─ Fields: *
    └─ Exclude: api_key, secret

Document Level Security:
└─ Query: region: "{{user.metadata.region}}"
```

### 7.3 只读用户角色

```
角色：Stakeholder（业务方）

Kibana Feature Privileges:
├─ Discover: Read
├─ Visualize: Read
├─ Dashboard: Read

Index Privileges:
├─ Index: business-*, reports-*
├─ Read: ☑
└─ Read only: true
```

## 8. API Key

### 8.1 创建 API Key

```
创建 API Key：

1. Stack Management → API Keys → Create API key

2. 配置
   └─→ Name: Report Automation
   └─→ Expiration: 30 days
   └─→ Access control:
       └─→ Index: reports-*
       └─→ Privileges: Read

3. 保存 Key
   └─→ 复制生成的 API Key
```

### 8.2 使用 API Key

```bash
# 使用 API Key 查询
curl -H "Authorization: ApiKey YOUR_API_KEY" \
  "http://kibana:5601/api/console/proxy?path=/_search&method=GET" \
  -d '{"index": "reports-*", "body": {"query": {"match_all": {}}}}'
```

## 9. 最佳实践

### 9.1 权限设计原则

```
权限设计原则：

1. 最小权限原则
   └─→ 只授予必要的权限
   └─→ 避免过度开放

2. 按角色分组
   └─→ 创建角色而非直接分配用户
   └─→ 便于权限管理

3. 空间隔离
   └─→ 不同环境使用不同空间
   └─→ 不同团队使用不同空间

4. 审计日志
   └─→ 记录所有敏感操作
   └─→ 定期审查权限分配
```

### 9.2 常见配置模板

```
配置模板：

模板 1：只读报告
├─ Feature: Read only
└─ Index: reports-*

模板 2：监控告警
├─ Feature: Discover, Dashboard, Alerting
└─ Index: logs-*, metrics-*

模板 3：数据分析
├─ Feature: Discover, Dashboard, Visualize, Canvas, Maps
└─ Index: analytics-*
└─ Field Security: 排除敏感字段
```

## 10. 安全配置检查

```
安全检查清单：

□ 启用 Kibana 安全功能
□ 配置 HTTPS
□ 设置强密码策略
□ 启用多因素认证（MFA）
□ 按角色分配权限
□ 使用空间隔离不同环境
□ 配置字段级安全
□ 启用审计日志
□ 定期审查权限分配
□ API Key 设置过期时间
```

## 总结

Kibana 安全功能的核心要点：

1. **Spaces**：组织层面的隔离
2. **Roles**：功能权限的定义
3. **Index Privileges**：数据访问控制
4. **Field Level Security**：字段级别限制
5. **Document Level Security**：文档级别过滤
6. **API Keys**：程序化访问

---

**留给你的问题**：

假设你需要为一个多租户 SaaS 平台配置 Kibana 权限。每个租户只能看到自己的数据。

你会如何设计权限方案？

需要考虑：
1. 如何隔离不同租户的数据？
2. 是否使用空间？
3. 如何配置文档级安全？
4. 如何管理大量租户？
