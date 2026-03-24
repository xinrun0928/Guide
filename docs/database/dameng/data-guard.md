# 数据守护（Data Guard）：达梦的容灾利器

你有没有想过这个问题：

如果数据库服务器突然断电，数据中心发生火灾，备份中心怎么接替工作？

这不是危言耸听，而是每个企业都必须面对的现实问题。而达梦数据库的 **数据守护（Data Guard）**，就是解决这类问题的专业方案。

## 数据守护是什么？

数据守护是达梦数据库提供的高可用与容灾解决方案，通过**实时同步**主库数据到备库，确保在主库故障时，备库能快速接管服务。

```
主库（Primary）  ----实时归档---->  备库（Standby）
     |                              |
  接收业务请求                    实时接收并应用日志
                                    |
                              RTO &lt; 60秒
```

## 数据守护的核心组件

### 主库（Primary）

- 处理所有业务请求
- 生成重做日志（Redo Log）
- 将日志发送到备库

### 备库（Standby）

- 接收主库发送的日志
- 应用日志到本地数据库
- 可以处于只读状态提供查询服务

### 守护进程（dmwatcher）

- 监控主库和备库的状态
- 自动执行故障切换
- 管理守护集群

## 数据守护的三种模式

### 1. 最大保护模式（Maximum Protection）

最高安全级别，主库事务必须确认备库已接收日志才能提交。

```ini
# dm.ini 配置
ALTER DATABASE PRIMARY FORCE LOGGING;
ARCH_INI = 1  # 开启归档

# dmmal.ini 网络配置
MAL_CHECK_INTERVAL = 10
```

```
主库提交事务 → 等待备库确认 → 备库确认收到 → 事务提交成功
                                    ↓
                         备库未确认 → 主库宕机 → 业务中断
```

**适用场景：** 金融、证券等对数据零丢失要求极高的系统。

### 2. 最高可用模式（Maximum Availability）

介于最大保护和最大性能之间，主库故障时尽量减少数据丢失。

```ini
# 主库配置
ARCH_WAIT_AP = 1  # 等待备库确认
ARCH_HANG_FLAG = 0  # 超时后降级为最大性能模式
```

**特点：**

- 主库和备库都正常时，等同于最大保护
- 备库故障时，自动降级为最大性能模式
- 故障恢复后，自动恢复到最高可用模式

### 3. 最大性能模式（Maximum Performance）

默认模式，主库提交不等待备库确认，性能最优。

```ini
# 主库配置
ARCH_WAIT_AP = 0  # 不等待备库确认
```

```
主库提交事务 → 异步发送日志 → 事务立即提交
                    ↓
              备库可能延迟几秒
```

**适用场景：** 对性能要求高，能容忍少量数据丢失的系统。

## 数据守护的配置步骤

### 步骤一：初始化主库和备库

```bash
# 初始化主库
./dminit path=/data/dmdbms primary db_name=DAMENG instance_name=DAMENG

# 初始化备库（与主库目录结构相同）
./dminit path=/data/dmstandby db_name=DAMENG instance_name=DAMENG_STANDBY
```

### 步骤二：配置归档（ARCH_INI）

```ini
# 主库 dm.ini
ARCH_INI = 1
ARCH_FILE_INIT = 0

# 主库 dmarch.ini
[ARCHIVE_REALTIME]
ARCH_TYPE = REALTIME
ARCH_DEST = DAMENG_STANDBY  # 备库实例名
ARCH_INTERVAL = 1
ARCH_FILES = 10
ARCH_FLUSH_BUF = 0
ARCH_RESERVE = 48

[ARCHIVE_LOCAL]
ARCH_TYPE = LOCAL
ARCH_DEST = /data/archivelog
ARCH_SPACE_LIMIT = 10240
```

### 步骤三：配置 MAL 系统

```ini
# dmmal.ini（主库和备库配置相同）
[MAL_INST1]
INST_NAME = DAMENG
INST_IP = 192.168.1.10
INST_PORT = 5236
INST_DOWN_TIME = 30
INST_AUTO_RESTART = 1
INST_RESTART_INTERVAL = 10

[MAL_INST2]
INST_NAME = DAMENG_STANDBY
INST_IP = 192.168.1.11
INST_PORT = 5236
INST_DOWN_TIME = 30
INST_AUTO_RESTART = 1
INST_RESTART_INTERVAL = 10
```

### 步骤四：启动数据守护

```bash
# 启动主库
./dmserver path=/data/dmdbms/dm.ini

# 启动备库（以 Standby 模式）
./dmserver path=/data/dmstandby/dm.ini mount

# 在主库执行注册
SQL> SP_SET_PARA_VALUE(1, 'ARCH_INI', 1);
SQL> ALTER DATABASE MOUNT;
SQL> ALTER DATABASE STANDBY;

# 启动守护进程
./dmwatcher path=/data/dmdbms/dmwatcher.ini
```

## 故障切换：自动恢复服务

当主库发生故障时，数据守护会自动执行故障切换：

```java
// Java 应用连接守护集群（自动故障切换）
public class DataGuardConnectionDemo {

    public Connection getFailoverConnection() throws SQLException {
        // 使用达梦 JDBC 的故障切换特性
        Properties props = new Properties();
        props.setProperty("集群", "全局簇");
        props.setProperty("地址", "192.168.1.10:5236,192.168.1.11:5236");

        // 当主库故障时，驱动自动切换到备库
        return DriverManager.getConnection(
            "jdbc:dm://localhost:5236", props
        );
    }
}
```

```
故障切换流程：
1. dmwatcher 检测到主库不可达
2. 等待 RTO（Recovery Time Objective）超时
3. 选取最优备库提升为主库
4. 通知应用连接新主库
5. 其他备库重定向到新主库
```

## 数据守护的监控

```sql
-- 查看守护状态
SELECT * FROM V$DMRPP;
SELECT * FROM V$DEST_STATUS;

-- 查看归档同步状态
SELECT
    DEST_NAME,
    ARCH_DEST,
    ARCH_SEQ,
    ARCH_FLUSH_SEQ,
    ARCH_FLUSH_LSN
FROM V$ARCH_FLUSH;

-- 查看日志应用延迟
SELECT
    STANDBY_NAME,
    APPLY_LSN,
    APPLY_LAG
FROM V$DEST_STATUS;
```

## 面试追问方向

- 数据守护和读写分离集群有什么区别？各自适用什么场景？
- RPO 和 RTO 分别是什么？数据守护能保证多少的 RPO/RTO？
- 最大保护模式下，如果备库长时间不可达会怎样？

---

## 一句话总结

数据守护是达梦的容灾盾牌：最大保护模式保证数据零丢失，最大性能模式追求极致性能。选对模式，才能在灾难来临时从容不迫。
