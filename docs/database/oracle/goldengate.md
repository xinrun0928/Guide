# Oracle GoldenGate：异构数据库同步专家

你有没有这种需求：

Oracle 同步到 MySQL。

异构数据库之间实时同步。

数据复制到 Kafka。

GoldenGate 就是来解决这个问题的。

今天，认识 Oracle 的数据复制工具。

---

## GoldenGate 是什么？

GoldenGate 是 Oracle 提供的数据复制和集成软件，支持异构数据库之间的实时数据同步。

```
GoldenGate 架构：

源端（Source）
┌─────────────────────────────────────────┐
│  Oracle 数据库                           │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Extract 进程                    │   │
│  │  捕获数据库变更                   │   │
│  └─────────────────────────────────┘   │
│           │                             │
│           ▼                             │
│  ┌─────────────────────────────────┐   │
│  │  Data Pump 进程                 │   │
│  │  发送数据到目标                  │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
           │
           │ Trail 文件（中间存储）
           │
           ▼
目标端（Target）
┌─────────────────────────────────────────┐
│  MySQL / PostgreSQL / Kafka / Oracle    │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Replicat 进程                   │   │
│  │  应用变更到目标数据库             │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## GoldenGate 的组件

### 进程组件

| 组件 | 说明 |
|-----|------|
| Manager | 主进程，负责管理和监控 |
| Extract | 源端捕获进程 |
| Data Pump | 中间传输进程（可选） |
| Replicat | 目标端应用进程 |
| Collector | 目标端接收进程 |

### 目录组件

| 组件 | 说明 |
|-----|------|
| GGSERR.LOG | 错误日志 |
| dirprm | 参数文件目录 |
| dirrpt | 报告文件目录 |
| dirpcs | 进程检查点目录 |
| dirdat | Trail 文件目录 |

---

## 配置步骤

### 1. 源端配置

```bash
# 启用补充日志（必须）
SQL> ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;
SQL> ALTER SYSTEM SWITCH LOGFILE;

# 启用归档日志
SQL> ALTER DATABASE ARCHIVELOG;
```

### 2. 创建 GoldenGate 用户

```sql
CREATE USER ggsadmin IDENTIFIED BY ggsadmin
DEFAULT TABLESPACE USERS
TEMPORARY TABLESPACE TEMP
QUOTA UNLIMITED ON USERS;

GRANT CONNECT, RESOURCE TO ggsadmin;
GRANT SELECT ANY DICTIONARY TO ggsadmin;
GRANT FLASHBACK ANY TABLE TO ggsadmin;
GRANT SELECT ANY TRANSACTION TO ggsadmin;
```

### 3. 配置 Extract

```bash
GGSCI> DBLOGIN USERID ggsadmin@orcl PASSWORD ggsadmin

# 创建 Extract 进程
GGSCI> ADD EXTRACT ext1, TRANLOG, BEGIN NOW

# 添加抽取表
GGSCI> ADD EXTTRAIL /u01/ogg/dirdat/lt, EXTRACT ext1, MEGABYTES 100

# 编辑 Extract 参数
GGSCI> EDIT PARAMS ext1

# 内容：
EXTRACT ext1
SETENV (ORACLE_SID = 'orcl')
USERID ggsadmin@orcl PASSWORD ggsadmin
EXTTRAIL /u01/ogg/dirdat/lt
TABLE hr.employees;
TABLE hr.departments;
```

### 4. 配置 Data Pump

```bash
# 创建 Data Pump
GGSCI> ADD EXTRACT pump1, EXTTRAILSOURCE /u01/ogg/dirdat/lt

# 编辑 Pump 参数
GGSCI> EDIT PARAMS pump1

# 内容：
EXTRACT pump1
SETENV (ORACLE_SID = 'orcl')
RMTHOST targethost, MGRPORT 7809
RMTTRAIL /u01/ogg/dirdat/rt
TABLE hr.employees;
TABLE hr.departments;
```

### 5. 配置 Replicat

```bash
# 目标端配置 Replicat
GGSCI> DBLOGIN USERID ggsadmin@target PASSWORD ggsadmin

# 创建 Replicat
GGSCI> ADD REPLICAT rep1, EXTTRAIL /u01/ogg/dirdat/rt

# 编辑 Replicat 参数
GGSCI> EDIT PARAMS rep1

# 内容：
REPLICAT rep1
SETENV (ORACLE_SID = 'target')
USERID ggsadmin@target PASSWORD ggsadmin
ASSUMETARGETDEFS
MAP hr.employees, TARGET ggsadmin.employees;
MAP hr.departments, TARGET ggsadmin.departments;
```

### 6. 启动进程

```bash
# 启动 Manager
GGSCI> START MANAGER

# 启动 Extract
GGSCI> START EXTRACT ext1

# 启动 Pump
GGSCI> START EXTRACT pump1

# 启动 Replicat
GGSCI> START REPLICAT rep1

# 查看状态
GGSCI> INFO ALL
```

---

## 表级别同步

### 单表同步

```bash
# 编辑 Extract 参数
EXTRACT ext1
USERID ggsadmin@orcl PASSWORD ggsadmin
EXTTRAIL /u01/ogg/dirdat/lt
-- 同步单表
TABLE hr.employees;

# 编辑 Replicat 参数
REPLICAT rep1
USERID ggsadmin@target PASSWORD ggsadmin
ASSUMETARGETDEFS
-- 映射到目标表
MAP hr.employees, TARGET ggsadmin.emp_copy;
```

### 过滤和转换

```bash
# 条件过滤
TABLE hr.employees, &
    FILTER (DEPARTMENT_ID > 50);

# 列过滤
TABLE hr.employees, &
    COLMAP (USEDEFAULTS, emp_name = NAME);

# 列转换
TABLE hr.employees, &
    COLMAP (USEDEFAULTS, create_date = @DATENOW());
```

---

## 初始化加载

### 使用 GoldenGate 进行全量加载

```bash
# 1. 源端创建初始加载 Extract
GGSCI> ADD EXTRACT initload, SOURCEISTABLE

# 2. 配置初始加载 Extract
GGSCI> EDIT PARAMS initload

EXTRACT initload
SETENV (ORACLE_SID = 'orcl')
USERID ggsadmin@orcl PASSWORD ggsadmin
RMTHOST targethost, MGRPORT 7809
RMTFILE /u01/ogg/dirdat/init
TABLE hr.employees;
TABLE hr.departments;

# 3. 目标端创建加载 Replicat
GGSCI> ADD REPLICAT loadrep, SPECIALRUN

# 4. 配置加载 Replicat
GGSCI> EDIT PARAMS loadrep

REPLICAT loadrep
SETENV (ORACLE_SID = 'target')
USERID ggsadmin@target PASSWORD ggsadmin
DISCARDFILE /u01/ogg/dirrpt/load.dsc, PURGE
ASSUMETARGETDEFS
MAP hr.employees, TARGET ggsadmin.employees;
MAP hr.departments, TARGET ggsadmin.departments;

# 5. 执行加载
GGSCI> START EXTRACT initload
```

---

## 监控与维护

### 常用命令

```bash
# 查看进程状态
GGSCI> INFO ALL
GGSCI> INFO ext1
GGSCI> INFO rep1

# 查看延迟
GGSCI> LAG ext1
GGSCI> LAG rep1

# 查看统计信息
GGSCI> STATS ext1
GGSCI> STATS rep1

# 查看错误信息
GGSCI> VIEW REPORT ext1
GGSCI> VIEW REPORT rep1
```

### 日志分析

```bash
# 查看 GoldenGate 错误日志
tail -f ggserr.log

# 查看进程报告
cat dirrpt/ext1.rpt
cat dirrpt/rep1.rpt
```

---

## 常见场景

### 场景一：Oracle 到 MySQL

```bash
# 源端（Oracle）配置
EXTRACT ext1
USERID ggsadmin@orcl PASSWORD ggsadmin
EXTTRAIL /u01/ogg/dirdat/lt
TABLE hr.employees;

# 目标端（MySQL）配置
REPLICAT rep1
USERID ggsadmin@mysql PASSWORD ggsadmin
TARGETDEFS /u01/ogg/dirdef/oracle_mysql.def
MAP hr.employees, TARGET mysql.hr_employees;
```

### 场景二：双向同步

```bash
# 双向同步配置
# 需要添加冲突解决
REPLICAT rep1
USERID ggsadmin@orcl PASSWORD ggsadmin
ASSUMETARGETDEFS
-- 冲突解决策略
GETINSERTS NO
GETUPDATES NO
MAP hr.employees, TARGET hr.employees,
    COMPARECOLS (ON UPDATE KEYINCLUDING (employee_id));
```

---

## 面试高频问题

### Q1: GoldenGate 和 Data Guard 的区别？

Data Guard 是 Oracle 内置的灾备方案，只能 Oracle 到 Oracle；GoldenGate 是独立的数据复制工具，支持异构数据库之间的同步，可以进行实时 CDC。

### Q2: GoldenGate 的工作原理？

Extract 进程读取数据库的重做日志或归档日志，捕获数据变更，生成 Trail 文件；Data Pump 发送 Trail 文件到目标端；Replicat 读取 Trail 文件，应用变更到目标数据库。

### Q3: GoldenGate 同步需要什么条件？

需要启用数据库的补充日志（Supplemental Logging），需要开启归档日志，GoldenGate 需要专属用户和权限。

---

## 总结

GoldenGate 是企业级数据复制的利器：

| 特性 | 说明 |
|-----|------|
| 异构支持 | 支持多种数据库 |
| 实时同步 | 捕获 redo 日志 |
| 低侵入 | 不影响源库性能 |
| 灵活配置 | 支持过滤和转换 |

掌握 GoldenGate，是数据工程师的重要技能。

---

## 下一步

- [Oracle RMAN](/database/oracle/rman)：备份恢复
- [Oracle Data Guard](/database/oracle/data-guard)：灾备方案
