# MariaDB 概述与 MySQL 分支发展史

2008 年，Sun 被 Oracle 收购，MySQL 的创始人 Michael "Monty" Widenius 离开了 Sun。

2010 年，Oracle 收购 Sun，MySQL 正式落入 Oracle 之手。

同年，Michael 创立了 MariaDB——MySQL 的「官方开源分支」。

**十年后，MairaDB 已经成为了世界上最重要的开源数据库之一，被 Google、Red Hat、Wikipedia 等巨头广泛使用。**

---

## MySQL 分支的诞生背景

### Oracle 收购 MySQL 后社区的担忧

```
MySQL 时间线：

1995 ──► MySQL AB 成立，发布 MySQL 1.0
2003 ──► MySQL 4.0 发布，支持事务
2005 ──► MySQL 5.0 发布，支持存储过程、触发器
2008 ──► Sun 以 10 亿美元收购 MySQL AB
2010 ──► Oracle 以 74 亿美元收购 Sun，获得 MySQL
         │
         └──► Michael Widenius 创立 MariaDB
```

社区担心 Oracle 会：
- 关闭 MySQL 的开源特性
- 减少社区版的特性更新
- 将闭源功能与开源版本割裂

**Michael 的回应**：fork 一份 MySQL 代码，创立 MariaDB，保持完全开源。

### MariaDB 与 MySQL 的关系

```
┌─────────────────────────────────────────────────────────────┐
│                    MySQL 代码演进                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MySQL 5.5 ──► MySQL 5.6 ──► MySQL 5.7 ──► MySQL 8.0      │
│                                                             │
│       ↑                             ↑                      │
│       │                             │                      │
│       │      ┌──────────────────────┘                      │
│       │      │                                              │
│  MySQL 5.5  │                                              │
│    (共同起点)│                                              │
│       │      │                                              │
│       ▼      ▼                                              │
│  ┌─────────────┐                                          │
│  │   MariaDB   │                                          │
│  │  5.5  10.x  │                                          │
│  │  10.1 10.2  │                                          │
│  │  10.3 10.4  │                                          │
│  │  10.5 10.6  │                                          │
│  │  10.11     │                                          │
│  └─────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

关键点：
- MariaDB 5.5 与 MySQL 5.5 几乎完全兼容
- 从 MariaDB 10.x 开始，两个项目走上了不同的道路
- MariaDB 10.5 包含 MySQL 8.0 的部分特性

---

## MariaDB 版本体系

### 版本命名规则

| 版本 | 说明 | 维护状态 |
|------|------|----------|
| MariaDB 5.5 | 基于 MySQL 5.5，兼容 | 已停止维护 |
| MariaDB 10.0 | 介于 MySQL 5.6/5.7 之间 | 已停止维护 |
| MariaDB 10.1 | 加入 Galera Cluster | 已停止维护 |
| MariaDB 10.2 | 加入窗口函数、CTE | 已停止维护 |
| MariaDB 10.3 | 加入系统版本表、Spider | 长期支持版本 |
| MariaDB 10.4 | Aria 引擎改进 | 长期支持版本 |
| MariaDB 10.5 | 性能提升、InnoDB 替代 | 长期支持版本 |
| MariaDB 10.6 | LTS 版本 | 长期支持版本 |
| MariaDB 10.11 | LTS 版本（企业版） | 长期支持版本 |
| MariaDB 11.x | 最新版本 | 开发版本 |

### LTS vs 非 LTS

```
MariaDB 版本策略：

LTS（Long Term Support）：
  - 维护期 5 年
  - 适合生产环境
  - 例：10.6.x, 10.11.x

非 LTS：
  - 维护期 1 年
  - 包含最新特性
  - 适合测试和开发
  - 例：11.x
```

---

## MariaDB 的核心哲学

### 1. 保持开源

> 「MariaDB 将永远是开源软件。」—— MariaDB Foundation

- 采用 GPL v2 许可证
- 所有代码开源
- 社区驱动开发
- 不存在「企业版」锁定的功能

### 2. 保持兼容

MariaDB 承诺与 MySQL 的高度兼容性：

```sql
-- MySQL 语法在 MariaDB 中几乎完全兼容
-- 驱动程序、连接器无需修改
-- 数据文件可以直接迁移

-- 兼容的连接器：
-- MySQL Connector/J
-- MySQL Connector/NET
-- MySQL Connector/ODBC
-- PHP mysqli/pdo_mysql
```

### 3. 开放开发

- 所有开发在 GitHub 上公开
- 公开的邮件列表和 IRC 频道
- 任何人可以贡献代码
- 公开的 Bug 追踪系统

---

## MariaDB vs MySQL 核心差异

### 存储引擎

| 引擎 | MySQL | MariaDB |
|------|-------|---------|
| InnoDB | ✅ (默认) | ✅ (默认) |
| MyISAM | ✅ | ✅ |
| Memory | ✅ | ✅ |
| XtraDB | ❌ | ✅ (增强版 InnoDB) |
| Aria | ❌ | ✅ (增强版 MyISAM) |
| TokuDB | ❌ | ✅ (支持) |
| Spider | ❌ | ✅ (支持) |
| CONNECT | ❌ | ✅ (支持) |
| CassandraSE | ❌ | ✅ (支持) |

### 新增特性

| 特性 | MySQL | MariaDB |
|------|-------|---------|
| 线程池 | 企业版 | ✅ 开源 |
| Galera Cluster | ❌ | ✅ |
| 窗口函数 | 8.0+ | ✅ 10.2+ |
| CTEs | 8.0+ | ✅ 10.2+ |
| 系统版本表 | ❌ | ✅ 10.2+ |
| 虚拟列 | ❌ | ✅ |
| 序列 (Sequence) | ❌ | ✅ |
| JSON 函数 | 5.7+ | ✅ |
| 原子 DDL | 8.0 | ✅ 10.6+ |

### Oracle MySQL Enterprise 特性对比

| 企业特性 | MySQL Enterprise | MariaDB 等价方案 |
|----------|------------------|------------------|
| 线程池 | ✅ | ✅ (开源) |
| 审计插件 | ✅ | ✅ (开源) |
| 防火墙 | ✅ | ✅ (MaxScale) |
| 备份 | ✅ | ✅ (XtraBackup) |
| 企业监控 | ✅ | ✅ (Prometheus) |

---

## MariaDB 的典型用户

### 互联网巨头

| 公司 | 使用场景 |
|------|----------|
| Google | 部分内部数据库 |
| Red Hat | OpenStack 组件 |
| Wikipedia | 主数据库 |
| Mozilla | Bugzilla 等项目 |
| 腾讯云 | 数据库服务 |
| 阿里云 | 数据库服务 (部分) |

### 行业分布

```
MariaDB 用户行业分布：

金融银行    ████████░░  25%
互联网      ███████░░░  22%
电信运营商   █████░░░░░  15%
政府教育    ████░░░░░░  12%
制造业      ███░░░░░░░  10%
其他        █████████░  16%
```

---

## MariaDB 的安装与配置

### Docker 快速启动

```bash
# 启动 MariaDB 容器
docker run -d \
  --name mariadb \
  -p 3306:3306 \
  -e MARIADB_ROOT_PASSWORD=my-secret-pw \
  mariadb:latest

# 连接数据库
docker exec -it mariadb mariadb -uroot -p
```

### Linux 安装

```bash
# Ubuntu/Debian
apt update && apt install -y mariadb-server

# CentOS/RHEL
yum install -y mariadb-server mariadb

# 启动服务
systemctl start mariadb
systemctl enable mariadb

# 安全配置
mysql_secure_installation
```

### 配置文件

```ini
# /etc/mysql/mariadb.conf.d/50-server.cnf

[mysqld]
# 基础配置
datadir=/var/lib/mysql
socket=/var/run/mysqld/mysqld.sock
user=mysql

# 字符集
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci

# InnoDB 配置
innodb_buffer_pool_size=1G
innodb_log_file_size=256M
innodb_flush_log_at_trx_commit=1

# 连接配置
max_connections=200
wait_timeout=600
```

### Java 连接 MariaDB

```java
// Maven 依赖
// com.mysql:mysql-connector-j 或 org.mariadb.jdbc:mariadb-java-client

import java.sql.*;

public class MariaDBDemo {
    
    public static void main(String[] args) throws SQLException {
        // MariaDB 连接字符串（兼容 MySQL）
        String url = "jdbc:mariadb://localhost:3306/testdb";
        String username = "root";
        String password = "password";
        
        try (Connection conn = DriverManager.getConnection(url, username, password)) {
            System.out.println("连接成功！");
            System.out.println("数据库版本: " + conn.getMetaData().getDatabaseProductVersion());
            
            // 执行查询
            try (Statement stmt = conn.createStatement();
                 ResultSet rs = stmt.executeQuery("SELECT VERSION()")) {
                if (rs.next()) {
                    System.out.println("MariaDB 版本: " + rs.getString(1));
                }
            }
        }
    }
}
```

---

## MariaDB 的生态系统

### 官方工具

| 工具 | 说明 |
|------|------|
| MariaDB MaxScale | 数据库代理/中间件 |
| MariaDB ColumnStore | 列式存储，分析型 |
| MariaDB SkySQL | 云数据库服务 |
| MariaDB TX | 企业级解决方案 |

### 第三方支持

```
MariaDB 生态：

├── 编程语言驱动
│   ├── Java: MariaDB Connector/J
│   ├── Python: mariadb connector
│   ├── Node.js: mariadb
│   └── Go: go-sql-driver/mariadb
│
├── ORM 框架
│   ├── Hibernate
│   ├── MyBatis
│   ├── SQLAlchemy
│   └── Prisma
│
├── 管理工具
│   ├── DBeaver
│   ├── MySQL Workbench
│   ├── HeidiSQL
│   └── phpMyAdmin
│
├── 监控工具
│   ├── Prometheus
│   ├── Grafana
│   └── Zabbix
│
└── 云平台
    ├── MariaDB SkySQL
    ├── AWS (RDS)
    └── Google Cloud
```

---

## 面试追问

### 追问一：为什么要 fork MySQL？

主要有三个原因：

1. **许可证担忧**：担心 Oracle 将 MySQL 闭源化
2. **社区需求**：MySQL 企业版的特性需要开源版本
3. **创新速度**：Oracle 开发节奏可能无法满足社区需求

### 追问二：MariaDB 能完全替代 MySQL 吗？

**大部分场景可以**，但需要注意：

| 场景 | 兼容性 |
|------|--------|
| MySQL 5.5/5.6 迁移 | ✅ 完全兼容 |
| MySQL 5.7 迁移 | ✅ 大部分兼容 |
| MySQL 8.0 迁移 | ⚠️ 需要注意语法差异 |
| 特定企业功能 | ❌ 需要替代方案 |

### 追问三：MariaDB 和 MySQL 哪个性能更好？

没有绝对的答案，取决于场景：

| 场景 | 推荐 |
|------|------|
| 标准 OLTP | 差不多 |
| 高并发连接 | MariaDB (线程池) |
| 分析型查询 | MariaDB ColumnStore |
| 集群场景 | MariaDB Galera |
| 需要 Oracle 生态 | MySQL |

---

## 总结

MariaDB 是 MySQL 最成功的开源分支：

1. **历史背景**：Oracle 收购 MySQL 后社区的产物
2. **兼容 MySQL**：数据文件和语法高度兼容
3. **开源特性**：线程池、Galera Cluster 等企业特性开源
4. **持续创新**：窗口函数、CTE、虚拟列等新特性
5. **社区驱动**：开放开发、透明决策

**选择 MariaDB 的理由**：
- 需要开源的线程池
- 需要 Galera Cluster
- 担心 MySQL 许可证风险
- 支持开源社区

---

## 下一步

- 想了解 MariaDB 与 MySQL 的详细差异？[MariaDB vs MySQL：核心差异对比](/database/mariadb/mysql-compare)
- 想了解 MariaDB 的存储引擎？[MariaDB 存储引擎：InnoDB、Aria、XtraDB、TokuDB](/database/mariadb/engine)
- 想了解 MariaDB 的新特性？[MariaDB 新增特性：系统版本表、Galera Cluster、Spider 存储引擎](/database/mariadb/new-feature)
