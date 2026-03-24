# MariaDB 审计插件与安全增强

你的数据库被黑客攻击了，数据泄露。

警察问：「谁在什么时间做了什么操作？」

你打开日志，一片空白。

**审计不是事后诸葛亮，而是事前诸葛亮。MariaDB 的审计插件让你对数据库的每一次操作都了如指掌。**

---

## MariaDB 审计概述

### 什么是数据库审计？

数据库审计是**记录和分析数据库所有访问活动**的过程，包括：
- 谁连接了数据库
- 执行了什么操作
- 什么时候发生的
- 影响了哪些数据

```
┌─────────────────────────────────────────────────────────────┐
│                     数据库审计流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   用户操作 ──► 审计日志 ──► 日志分析 ──► 安全告警            │
│       │                           │                          │
│       │                           ▼                          │
│       │                     ┌───────────┐                   │
│       │                     │  报表生成  │                   │
│       │                     └───────────┘                   │
│       │                                                    │
│       └────────────────────────────────────────────────────┘
│                           │                                │
│                           ▼                                │
│   审计内容：连接、查询、修改、DDL、失败操作                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### MariaDB 审计方案

| 方案 | 说明 | 适用场景 |
|------|------|----------|
| MariaDB Audit Plugin | 官方审计插件 | 标准审计需求 |
| MAXSCALE 审计 | 通过 MaxScale 代理 | 集中式审计 |
| CONNECT 引擎 | 记录到外部表 | 自定义审计 |
| 触发器 | DML 审计 | 细粒度表级审计 |
| MySQL Enterprise Audit | Oracle 方案 | MySQL 用户 |

---

## MariaDB Audit Plugin

### 安装审计插件

```sql
-- 安装审计插件
INSTALL SONAME 'server_audit';

-- 验证安装
SHOW PLUGINS;
-- 应该看到 server_audit 插件
```

### 审计插件配置

```ini
# 配置文件 /etc/mysql/mariadb.conf.d/50-server.cnf

[mysqld]
# 审计插件配置
server_audit_events='CONNECT,QUERY,TABLE,QUERY_DDL,QUERY_DML_ROWS'
server_audit_logging=ON
server_audit_output_type=FILE
server_audit_file_path='/var/log/mysql/server_audit.log'
server_audit_file_rotate_size=10M
server_audit_file_rotations=10
server_audit_file_permissions=0600
server_audit_locale='en_US'
server_audit_syslog_facility=LOG_USER
server_audit_syslog_priority=LOG_INFO
```

### 关键配置参数

```sql
-- server_audit_events：记录的事件类型
-- CONNECT：连接和断开连接
-- QUERY：所有查询（包含 SQL 语句）
-- TABLE：表访问
-- QUERY_DDL：DDL 语句（CREATE, DROP, ALTER）
-- QUERY_DML_ROWS：影响行的 DML（INSERT, UPDATE, DELETE）
-- ERROR：认证失败等错误

-- server_audit_output_type：输出类型
-- FILE：文件（默认）
-- SYSLOG：系统日志
-- TABLE：数据库表

-- 连接过滤
server_audit_excl_users='backup_user,monitor_user'
server_audit_incl_users='admin_user'
```

### 查看审计日志

```sql
-- 默认日志位置
SHOW VARIABLES LIKE 'server_audit_file_path';

-- 动态修改配置（需要 SUPER 权限）
SET GLOBAL server_audit_events='QUERY,TABLE';
SET GLOBAL server_audit_logging=ON;

-- 查看审计配置
SHOW VARIABLES LIKE 'server_audit%';
SHOW STATUS LIKE 'Server_audit%';
```

---

## 审计日志格式

### 日志结构

```
server_audit: 2024-01-15 10:30:45, node1, root, localhost, 123, 456, 
QUERY, connect, 0

server_audit: 2024-01-15 10:30:45, node1, root, localhost, 123, 456, 
QUERY, SELECT * FROM users WHERE id=1, 0

server_audit: 2024-01-15 10:30:46, node1, root, localhost, 123, 456, 
QUERY, INSERT INTO users (name) VALUES ('test'), 1

server_audit: 2024-01-15 10:30:47, node1, root, localhost, 123, 456, 
QUERY, UPDATE users SET email='new@example.com' WHERE id=1, 1

server_audit: 2024-01-15 10:30:48, node1, unknown_user, 192.168.1.100, 124, 0, 
CONNECT, error, 1045
```

### 日志字段

| 字段 | 说明 | 示例 |
|------|------|------|
| 时间戳 | 操作发生时间 | 2024-01-15 10:30:45 |
| 服务器名 | MariaDB 服务器名 | node1 |
| 用户名 | 连接用户 | root |
| 主机 | 连接来源 | localhost |
| 连接ID | 线程/连接 ID | 123 |
| 查询ID | 查询 ID | 456 |
| 操作类型 | CONNECT/QUERY/TABLE | QUERY |
| 操作 | 具体操作 | SELECT * FROM users |
| 状态 | 结果（0=成功） | 0 |

---

## 安全增强功能

### 1. 密码策略

```sql
-- MariaDB 10.4+ 内置密码验证
SHOW VARIABLES LIKE 'validate_password%';

-- 配置密码策略
-- LOW：只检查长度
-- MEDIUM：长度 + 数字 + 混合大小写 + 特殊字符
-- STRONG：MEDIUM + 字典检查
SET GLOBAL validate_password.policy=STRONG;
SET GLOBAL validate_password.length=16;
SET GLOBAL validate_password.number_count=4;
SET GLOBAL validate_password.uppercase_count=2;
SET GLOBAL validate_password.special_char_count=2;
```

### 2. 用户密码过期

```sql
-- 设置密码过期策略
-- 默认 0（永不过期）
SET GLOBAL default_password_lifetime=90;  -- 90天后过期

-- 为单个用户设置
ALTER USER 'app_user'@'%' PASSWORD EXPIRE INTERVAL 30 DAY;

-- 查看用户密码状态
SELECT user, host, password_lifetime, account_status
FROM mysql.user WHERE password_lifetime IS NOT NULL;

-- 强制用户下次登录修改密码
ALTER USER 'temp_user'@'%' PASSWORD EXPIRE;
```

### 3. 双因素认证（MariaDB 10.5+）

```sql
-- 创建支持两步验证的用户
CREATE USER 'secure_user'@'%' 
IDENTIFIED BY 'strong_password'
REQUIRE SUBJECT '/CN=myclient'
AND ISSUER '/CN=My CA';

-- 查看用户的安全要求
SHOW CREATE USER 'secure_user'@'%';
```

### 4. 角色管理（MariaDB 10.0+）

```sql
-- 创建角色
CREATE ROLE IF NOT EXISTS 'app_read';
CREATE ROLE IF NOT EXISTS 'app_write';
CREATE ROLE IF NOT EXISTS 'app_admin';

-- 分配权限给角色
GRANT SELECT ON myapp.* TO 'app_read';
GRANT SELECT, INSERT, UPDATE, DELETE ON myapp.* TO 'app_write';
GRANT ALL ON myapp.* TO 'app_admin';

-- 将角色分配给用户
GRANT 'app_read' TO 'user1'@'%';
GRANT 'app_write' TO 'user2'@'%';
GRANT 'app_admin' TO 'admin'@'%';

-- 激活默认角色
SET DEFAULT ROLE 'app_read' FOR 'user1'@'%';

-- 会话中切换角色
SET ROLE 'app_write';
```

### 5. 密码历史

```sql
-- 防止密码重用
CREATE USER 'security_user'@'%'
IDENTIFIED BY 'password123'
PASSWORD HISTORY 5;  -- 记录最近5个密码

-- 修改时检查密码历史
ALTER USER 'security_user'@'%'
IDENTIFIED BY 'newpassword'  -- 不能与最近5个相同
REPLACE 'password123';
```

---

## Java 中的审计实现

### 审计日志表方案

```java
public class AuditDemo {
    
    private Connection conn;
    
    public void setupAuditTable(Connection conn) throws SQLException {
        // 创建审计日志表
        String createTable = """
            CREATE TABLE IF NOT EXISTS audit_log (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                action_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_name VARCHAR(100),
                host_name VARCHAR(100),
                action_type VARCHAR(20),
                table_name VARCHAR(100),
                old_values JSON,
                new_values JSON,
                ip_address VARCHAR(45),
                INDEX idx_user_time (user_name, action_time),
                INDEX idx_table_time (table_name, action_time)
            ) ENGINE=InnoDB
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createTable);
        }
    }
    
    // DML 触发器审计
    public void createAuditTriggers(Connection conn, String tableName) throws SQLException {
        String triggerInsert = String.format("""
            CREATE TRIGGER %s_audit_insert AFTER INSERT ON %s
            FOR EACH ROW
            BEGIN
                INSERT INTO audit_log (user_name, host_name, action_type, table_name, new_values)
                VALUES (
                    CURRENT_USER(),
                    @@hostname,
                    'INSERT',
                    '%s',
                    JSON_OBJECT(
                        'id', NEW.id
                    )
                );
            END
            """, tableName, tableName, tableName);
        
        String triggerUpdate = String.format("""
            CREATE TRIGGER %s_audit_update AFTER UPDATE ON %s
            FOR EACH ROW
            BEGIN
                INSERT INTO audit_log (user_name, host_name, action_type, table_name, old_values, new_values)
                VALUES (
                    CURRENT_USER(),
                    @@hostname,
                    'UPDATE',
                    '%s',
                    JSON_OBJECT('id', OLD.id),
                    JSON_OBJECT('id', NEW.id)
                );
            END
            """, tableName, tableName, tableName);
        
        String triggerDelete = String.format("""
            CREATE TRIGGER %s_audit_delete AFTER DELETE ON %s
            FOR EACH ROW
            BEGIN
                INSERT INTO audit_log (user_name, host_name, action_type, table_name, old_values)
                VALUES (
                    CURRENT_USER(),
                    @@hostname,
                    'DELETE',
                    '%s',
                    JSON_OBJECT('id', OLD.id)
                );
            END
            """, tableName, tableName, tableName);
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(triggerInsert);
            stmt.execute(triggerUpdate);
            stmt.execute(triggerDelete);
        }
        
        System.out.println("审计触发器创建成功: " + tableName);
    }
    
    // 查询审计日志
    public void queryAuditLog(Connection conn, String user, Date startDate, Date endDate) 
            throws SQLException {
        String sql = """
            SELECT 
                action_time,
                user_name,
                action_type,
                table_name,
                old_values,
                new_values
            FROM audit_log
            WHERE user_name = ?
              AND action_time BETWEEN ? AND ?
            ORDER BY action_time DESC
            LIMIT 100
            """;
        
        try (PreparedStatement pstmt = conn.prepareStatement(sql)) {
            pstmt.setString(1, user);
            pstmt.setTimestamp(2, new Timestamp(startDate.getTime()));
            pstmt.setTimestamp(3, new Timestamp(endDate.getTime()));
            
            try (ResultSet rs = pstmt.executeQuery()) {
                System.out.println("审计日志查询结果：");
                System.out.println("=".repeat(80));
                while (rs.next()) {
                    System.out.printf("[%s] %s | %s | %s | 旧值: %s | 新值: %s%n",
                        rs.getTimestamp("action_time"),
                        rs.getString("user_name"),
                        rs.getString("action_type"),
                        rs.getString("table_name"),
                        rs.getString("old_values"),
                        rs.getString("new_values"));
                }
            }
        }
    }
    
    // 安全检查：失败登录尝试
    public void checkFailedLogins(Connection conn) throws SQLException {
        // 使用 server_audit 查询失败登录
        String sql = """
            SELECT 
                LEFT(timestamp, 16) AS login_time,
                user,
                host,
                COUNT(*) AS failed_attempts
            FROM mysql.server_audit
            WHERE info LIKE '%Access denied%'
              AND timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
            GROUP BY LEFT(timestamp, 16), user, host
            HAVING COUNT(*) > 3
            ORDER BY failed_attempts DESC
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            System.out.println("警告：检测到可疑登录尝试：");
            while (rs.next()) {
                System.out.printf("[%s] 用户: %s | 主机: %s | 失败次数: %d%n",
                    rs.getString("login_time"),
                    rs.getString("user"),
                    rs.getString("host"),
                    rs.getInt("failed_attempts"));
            }
        }
    }
}
```

### 连接审计拦截器

```java
public class AuditConnectionProxy implements InvocationHandler {
    
    private final Connection realConnection;
    private final String userName;
    private final String hostName;
    private final AuditLogger auditLogger;
    
    public AuditConnectionProxy(Connection conn, String user, String host, AuditLogger logger) {
        this.realConnection = conn;
        this.userName = user;
        this.hostName = host;
        this.auditLogger = logger;
    }
    
    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        String methodName = method.getName();
        
        // 记录敏感操作
        if (isSensitiveOperation(methodName)) {
            auditLogger.log(
                new AuditEvent(
                    userName,
                    hostName,
                    "SENSITIVE_OPERATION",
                    methodName,
                    Arrays.toString(args)
                )
            );
        }
        
        return method.invoke(realConnection, args);
    }
    
    private boolean isSensitiveOperation(String method) {
        return method.matches(".*(delete|drop|truncate|alter).*");
    }
    
    // 记录审计日志
    public static class AuditEvent {
        public final String user;
        public final String host;
        public final String operation;
        public final String details;
        public final Instant timestamp;
        
        public AuditEvent(String user, String host, String operation, String details) {
            this.user = user;
            this.host = host;
            this.operation = operation;
            this.details = details;
            this.timestamp = Instant.now();
        }
    }
    
    public interface AuditLogger {
        void log(AuditEvent event);
    }
}
```

---

## 合规性要求

### 常见的合规标准

| 标准 | 说明 | 关键要求 |
|------|------|----------|
| GDPR | 通用数据保护条例 | 数据访问记录、删除追踪 |
| SOX | 萨班斯法案 | 财务数据访问审计 |
| PCI-DSS | 支付卡行业数据安全标准 | 访问控制、审计日志 |
| HIPAA | 健康保险流通与责任法案 | 患者数据访问记录 |
| ISO 27001 | 信息安全管理体系 | 完整的操作审计 |

### 审计策略示例

```sql
-- 关键表审计配置
CREATE TABLE IF NOT EXISTS sensitive_table_audit_config (
    table_name VARCHAR(100) PRIMARY KEY,
    audit_enabled BOOLEAN DEFAULT TRUE,
    capture_old_values BOOLEAN DEFAULT TRUE,
    capture_new_values BOOLEAN DEFAULT TRUE,
    retention_days INT DEFAULT 365
);

-- 插入配置
INSERT INTO sensitive_table_audit_config VALUES 
('users', TRUE, FALSE, TRUE, 730),
('orders', TRUE, TRUE, TRUE, 365),
('payments', TRUE, TRUE, TRUE, 1825);
```

---

## 面试追问

### 追问一：审计日志对性能的影响如何？

审计确实会增加一些开销：
- **CONNECT**：几乎无影响
- **QUERY**：5-10% 开销（取决于日志输出方式）
- **TABLE**：10-15% 开销

**优化建议**：
1. 只审计必要的事件
2. 使用异步日志输出
3. 对大表减少审计粒度
4. 定期归档和清理日志

### 追问二：审计日志被篡改了怎么办？

**防护措施**：
1. **写保护**：审计日志文件设置为只追加（append-only）
2. **远程日志**：实时同步到安全的远程服务器
3. **数字签名**：对日志进行哈希签名
4. **权限分离**：审计管理员权限独立

```bash
# Linux 设置文件只追加
chattr +a /var/log/mysql/server_audit.log
```

### 追问三：如何实现细粒度的审计？

除了 MariaDB Audit Plugin：

1. **触发器审计**：针对特定表的细粒度审计
2. **应用层审计**：在业务逻辑中记录
3. **MaxScale 审计**：集中式审计所有数据库操作
4. **数据库代理审计**：如 ProxySQL 层

---

## 总结

| 要点 | 说明 |
|------|------|
| **审计插件** | MariaDB Audit Plugin 记录所有操作 |
| **配置参数** | server_audit_events, server_audit_logging |
| **日志格式** | 时间戳、用户、操作、状态 |
| **安全增强** | 密码策略、密码过期、角色管理 |
| **合规要求** | GDPR、SOX、PCI-DSS 等 |
| **性能影响** | 5-15%，可通过配置优化 |

**审计不是可选项，而是数据安全的必备防线。MariaDB 提供了完整的审计解决方案，让你的数据库操作有据可查。**

---

## 下一步

- 想了解 MariaDB 的集群方案？[MariaDB Galera Cluster 原理：同步多主复制](/database/mariadb/galera)
- 想了解 MariaDB 的备份恢复？[MariaDB 备份与恢复：XtraBackup 集成](/database/mariadb/backup)
- 想了解更多数据库安全知识？[MySQL 面试高频问题汇总](/database/mysql/interview-summary)
