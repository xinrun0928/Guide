# 数据库安全：达梦的立体防护体系

安全，从来不是事后补救，而是事前防御。

2017 年，某公司因为数据库弱口令被攻击，黑客删库跑路，损失上千万。

2021 年，某系统因为 SQL 注入漏洞，用户数据被批量导出。

这些不是故事，而是真实发生的事。数据库作为数据的最后一道防线，安全必须做到位。

## 达梦安全体系概览

```
┌─────────────────────────────────────────────────────────────┐
│                        安全管理体系                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   身份认证   │  │    权限管理  │  │    审计追踪  │        │
│  │ Authentication│  │  Authorization│  │    Auditing │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   数据加密   │  │   敏感脱敏   │  │    访问控制  │        │
│  │   Encryption │  │  Data Masking│  │  Access Control│    │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 身份认证

### 用户管理

```sql
-- 创建用户
CREATE USER "app_user" IDENTIFIED BY "Str0ngP@ss123"
DEFAULT TABLESPACE MAIN
TEMPORARY TABLESPACE TEMP
PASSWORD EXPIRE TIME 90;  -- 90天后强制修改密码

-- 修改用户密码
ALTER USER "app_user" IDENTIFIED BY "N3wStr0ngP@ss";

-- 锁定/解锁用户
ALTER USER "app_user" ACCOUNT LOCK;
ALTER USER "app_user" ACCOUNT UNLOCK;

-- 删除用户（先删除相关对象）
DROP USER "app_user" CASCADE;
```

### 密码策略

```sql
-- 设置密码复杂度策略
ALTER USER "SYSDBA" LIMIT
    PASSWORD_POLICY 15,    -- 密码长度至少15位
    PASSWORD_COMPLEXITY 3, -- 复杂度等级
    FAILED_LOGIN_ATTEMPTS 5, -- 连续失败5次锁定
    PASSWORD_LOCK_TIME 30;   -- 锁定30分钟
```

```ini
# dm.ini 中的密码策略配置
PWD_POLICY = 15
```

### 多因素认证

```sql
-- 启用数据库登录审计
AUDIT TRIM_TABLESPACE = TRUE;
AUDIT ALTER SEQUENCE = TRUE;
```

## 权限管理

### 角色管理

```sql
-- 创建角色
CREATE ROLE "DBA_ROLE";

-- 为角色分配权限
GRANT CREATE TABLE TO "DBA_ROLE";
GRANT CREATE VIEW TO "DBA_ROLE";
GRANT SELECT ANY TABLE TO "DBA_ROLE";

-- 将角色分配给用户
GRANT "DBA_ROLE" TO "app_user";
```

```java
// Java 应用中使用最小权限原则
public class MinPrivilegeDemo {

    // 应用读写用户
    public static final String APP_RW_USER = "app_rw";
    public static final String APP_RW_PASS = "***";

    // 应用只读用户
    public static final String APP_RO_USER = "app_ro";
    public static final String APP_RO_PASS = "***";

    public DataSource createReadOnlyDataSource() {
        DruidDataSource ds = new DruidDataSource();
        ds.setUsername(APP_RO_USER);
        ds.setPassword(APP_RO_PASS);
        // 只读用户只能执行 SELECT
        return ds;
    }

    public DataSource createReadWriteDataSource() {
        DruidDataSource ds = new DruidDataSource();
        ds.setUsername(APP_RW_USER);
        ds.setPassword(APP_RW_PASS);
        // 读写用户可以执行 SELECT/INSERT/UPDATE/DELETE
        return ds;
    }
}
```

### 对象权限

```sql
-- 授予表级权限
GRANT SELECT, INSERT, UPDATE ON orders TO "app_user";
GRANT SELECT ON customers TO "report_user";

-- 授予列级权限（只允许查看敏感列）
GRANT SELECT ON employee(salary) TO "hr_readonly_user";

-- 撤销权限
REVOKE UPDATE ON orders FROM "app_user";

-- 查看用户权限
SELECT * FROM USER_TAB_PRIVS_MADE;
SELECT * FROM USER_COL_PRIVS_MADE;
```

## 数据加密

### 列级加密

```sql
-- 创建加密列（使用透明数据加密 TDE）
CREATE TABLE employee (
    emp_id INT PRIMARY KEY,
    name VARCHAR(50),
    -- 工资字段加密存储
    salary DECIMAL(10,2) ENCRYPT WITH AES256
);
```

```java
// Java 应用中处理加密字段
public class EncryptedFieldDemo {

    public void insertWithEncrypted() {
        // 达梦透明加密，应用无需特殊处理
        // 写入时自动加密，读取时自动解密
        String sql = "INSERT INTO employee (emp_id, name, salary) VALUES (?, ?, ?)";
        jdbcTemplate.update(sql, 1001, "张三", 15000.00);
    }

    public void queryEncrypted() {
        // 加密字段可以正常查询
        String sql = "SELECT * FROM employee WHERE salary > ?";
        List&lt;Map&lt;String, Object&gt;&gt; result = jdbcTemplate.queryForList(sql, 10000);
    }
}
```

### 表空间加密

```sql
-- 创建加密表空间
CREATE TABLESPACE encrypted_ts
DATAFILE '/data/encrypted.dbf' SIZE 100M
ENCRYPT WITH AES256;
```

## 审计追踪

### 开启审计

```sql
-- 开启审计功能
ALTER SYSTEM SET AUDIT_FLAG = TRUE;

-- 审计登录尝试
AUDIT SESSION;
```

### 审计策略

```sql
-- 审计所有 DDL 操作
AUDIT TABLE;
AUDIT VIEW;
AUDIT SEQUENCE;
AUDIT PROCEDURE;

-- 审计敏感表的操作
AUDIT SELECT, INSERT, UPDATE, DELETE ON orders BY ACCESS;
AUDIT SELECT, INSERT, UPDATE, DELETE ON customers BY ACCESS;

-- 审计权限使用
AUDIT GRANT, REVOKE BY ACCESS;
```

### 查看审计日志

```sql
-- 查看登录审计
SELECT
    USERNAME,
    TERMINAL,
    ACTION_NAME,
    LOGON_TIME,
    LOGOFF_TIME
FROM DBA_AUDIT_SESSION;

-- 查看对象访问审计
SELECT
    USERNAME,
    OBJ_NAME,
    ACTION_NAME,
    TIMESTAMP
FROM DBA_AUDIT_OBJECT;

-- 查看语句执行审计
SELECT
    USERNAME,
    SQL_TEXT,
    TIMESTAMP
FROM DBA_AUDIT_STATEMENT;
```

```java
// Java 中实现应用层审计
public class AuditAspect {

    // 审计切面：记录所有数据变更
    public void auditDataChange(String table, String operation,
                                 Object before, Object after) {
        String sql = "INSERT INTO audit_log (" +
            "table_name, operation, before_value, after_value, " +
            "operator, operate_time, ip_address) " +
            "VALUES (?, ?, ?, ?, ?, SYSDATE, ?)";

        jdbcTemplate.update(sql,
            table, operation,
            serialize(before), serialize(after),
            getCurrentUser(), getClientIp()
        );
    }
}
```

## 敏感数据保护

### 数据脱敏

```sql
-- 创建脱敏视图
CREATE OR REPLACE VIEW employee_sensitive_v AS
SELECT
    emp_id,
    name,
    -- 手机号脱敏：只显示前3后4位
    SUBSTR(phone, 1, 3) || '****' || SUBSTR(phone, -4) AS phone,
    -- 身份证号脱敏
    SUBSTR(id_card, 1, 6) || '********' || SUBSTR(id_card, -4) AS id_card,
    salary
FROM employee;

-- 对外暴露脱敏视图，不暴露原表
GRANT SELECT ON employee_sensitive_v TO "report_user";
REVOKE SELECT ON employee FROM "report_user";
```

```java
// Java 中实现动态脱敏
public class DataMaskingUtil {

    public static String maskPhone(String phone) {
        if (phone == null || phone.length() < 7) {
            return phone;
        }
        return phone.substring(0, 3) + "****" + phone.substring(phone.length() - 4);
    }

    public static String maskIdCard(String idCard) {
        if (idCard == null || idCard.length() < 10) {
            return idCard;
        }
        return idCard.substring(0, 6) + "********" + idCard.substring(idCard.length() - 4);
    }

    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) {
            return email;
        }
        String[] parts = email.split("@");
        String username = parts[0];
        if (username.length() <= 2) {
            return username + "***@" + parts[1];
        }
        return username.substring(0, 2) + "***@" + parts[1];
    }
}
```

## SQL 注入防护

```java
// 安全：使用参数化查询
public class SqlInjectionPrevention {

    // 正确做法：参数化查询
    public List&lt;Order&gt; searchOrders(Long userId, String status) {
        // 参数自动转义，防止 SQL 注入
        String sql = "SELECT * FROM orders WHERE user_id = ? AND status = ?";
        return jdbcTemplate.query(sql,
            (rs, rowNum) -> mapOrder(rs),
            userId, status
        );
    }

    // 错误做法：字符串拼接 SQL
    public List&lt;Order&gt; searchOrdersUnsafe(String userId) {
        // 危险！如果 userId = "1 OR 1=1"，会查出所有数据
        String sql = "SELECT * FROM orders WHERE user_id = " + userId;
        return jdbcTemplate.queryForList(sql).stream()
            .map(this::mapOrder)
            .collect(Collectors.toList());
    }
}
```

## 面试追问方向

- 达梦有哪些安全认证机制？如何防止暴力破解？
- 如何设计一个最小权限的数据访问方案？
- 如何审计和追踪敏感数据的访问？

---

## 一句话总结

数据库安全是「纵深防御」：身份认证是第一道门，权限管理是分房间的钥匙，审计是监控的眼睛，加密是数据的护甲。多一层防护，少一分风险。
