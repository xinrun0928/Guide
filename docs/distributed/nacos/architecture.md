# Nacos 架构：注册中心与配置中心

你有没有想过这个问题：

Spring Cloud 的注册中心，经历了从 Eureka 到 Nacos 的演变。

Eureka 1.x 停止维护，Eureka 2.x 胎死腹中，Spring Cloud 官方推荐 Nacos 作为替代。

但 Nacos 凭什么？

今天，我们来看看 Nacos 的架构设计。

## Nacos 的两大定位

Nacos 官方给自己的定位是：

```
更易于构建云原生应用的动态服务发现、配置管理和服务管理平台。
```

两个核心能力：

- **注册中心**：服务发现、服务元数据、服务心跳
- **配置中心**：配置管理、配置热更新、多环境隔离

## Nacos 的架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                      Open API / SDK                         │
│                  (HTTP / RPC / CLI)                        │
├─────────────────────────────────────────────────────────────┤
│                      Nacos Server                           │
│  ┌────────────────┐  ┌────────────────┐                   │
│  │  OpenAPI Layer │  │  Config Module  │                   │
│  └────────┬───────┘  └────────┬───────┘                   │
│           │                    │                              │
│  ┌────────▼────────────────────▼───────┐                   │
│  │            Naming Module             │                   │
│  │    (注册中心核心逻辑)                │                   │
│  └────────────────────┬───────────────┘                   │
│                       │                                      │
│  ┌────────────────────▼───────────────┐                   │
│  │         Distro Protocol / Raft         │                   │
│  │         (一致性协议)                    │                   │
│  └────────────────────┬───────────────┘                   │
│                       │                                      │
│  ┌────────────────────▼───────────────┐                   │
│  │            Data Store                    │                   │
│  │     (嵌入式数据库 / MySQL)             │                   │
│  └────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

## 两种运行模式

### 单机模式（开发测试）

```bash
# 下载后直接启动
sh startup.sh -m standalone

# 默认端口 8848
```

单机模式使用**嵌入式数据库 Derby**，数据不持久化。

### 集群模式（生产环境）

```yaml
# cluster.conf
192.168.1.1:8848
192.168.1.2:8848
192.168.1.3:8848
```

集群模式使用**MySQL 作为持久化存储**。

```yaml
# application.properties
spring.datasource.platform=mysql
db.num=1
db.url.0=jdbc:mysql://localhost:3306/nacos?characterEncoding=utf8
db.user=nacos
db.password=nacos
```

## Nacos 与 Spring Cloud 集成

```xml
<!-- Maven 依赖 -->
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
    <version>2021.0.5.0</version>
</dependency>

<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
    <version>2021.0.5.0</version>
</dependency>
```

```yaml
# bootstrap.yml
spring:
  application:
    name: user-service
  cloud:
    nacos:
      discovery:
        server-addr: localhost:8848
      config:
        server-addr: localhost:8848
        file-extension: yaml
```

## Nacos vs Eureka vs ZooKeeper

### 功能对比

| 特性 | Nacos | Eureka | ZooKeeper |
|------|-------|--------|-----------|
| 注册中心 | ✅ | ✅ | ⚠️ |
| 配置中心 | ✅ | ❌ | ✅ |
| 健康检查 | ✅ | ✅ | ❌ |
| 订阅发布 | ✅ | ⚠️ | ✅ |
| 多环境/命名空间 | ✅ | ❌ | ✅ |
| 负载均衡 | ✅ | ❌ | ❌ |
| 分布式锁 | ✅ | ❌ | ✅ |

### CAP 定理

- **Nacos 支持 CP + AP 切换**
- **Eureka 遵循 AP**
- **ZooKeeper 遵循 CP**

Nacos 可以通过以下配置切换：

```properties
# CP 模式（配置中心场景）
nacos.distro.protocol=raft

# AP 模式（注册中心场景）
nacos.distro.protocol=http
```

## Nacos 的数据存储

### 嵌入式数据库（单机模式）

```text
 Derby 数据库

 ├── config_info (配置表)
 ├── config_info_aggr (聚合配置)
 ├── config_info_beta (beta 配置)
 ├── config_info_tag (tag 配置)
 ├── service_registry (服务注册表)
 └── service_discvoer_cache (服务发现缓存)
```

### MySQL（集群模式）

生产环境使用 MySQL，保证数据持久化和高可用。

## 总结

Nacos 的架构设计，瞄准了微服务的两个核心需求：

- **注册中心**：服务发现、健康检查、负载均衡
- **配置中心**：配置管理、热更新、多环境隔离

一站式解决方案，是 Nacos 最大的优势。

**面试追问方向：**
- Nacos 如何实现配置的热更新？
- Nacos 的 CP + AP 切换是怎么实现的？
- Nacos 集群模式下如何保证数据一致性？
- Nacos 和 ZooKeeper 在服务发现场景下有什么区别？