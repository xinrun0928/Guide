# DM 数据库安装与配置

终于到了实战环节。

今天我们从零开始，把达梦数据库装起来、跑起来。

无论你是要在本地学习，还是要搭一个测试环境，这篇文章都能帮你搞定。

## 安装前准备

### 系统要求

| 项目 | 最低要求 | 推荐配置 |
|------|----------|----------|
| CPU | 2 核 | 4 核+ |
| 内存 | 4GB | 8GB+ |
| 磁盘 | 10GB 可用空间 | 50GB+ SSD |
| 操作系统 | CentOS 7 / 麒麟 V10 / 统信 UOS | Linux x86_64 |

### 检查系统环境

```bash
# 查看操作系统版本
cat /etc/os-release

# 查看 CPU 核心数
nproc

# 查看内存
free -h

# 查看磁盘空间
df -h
```

### 下载达梦数据库

到达梦官网（[www.dameng.com](https://www.dameng.com)）下载对应版本的安装包：

- DM8 开发版：免费使用，功能完整，但有连接数限制
- DM8 企业版：生产环境使用，需商业授权

## Linux 环境安装

### 1. 创建用户和目录

```bash
# 创建安装用户（达梦不建议 root 安装）
groupadd dinstall
useradd -g dinstall -m -s /bin/bash dmdba
passwd dmdba

# 创建安装目录
mkdir -p /dm8
chown dmdba:dinstall /dm8
chmod 755 /dm8
```

### 2. 上传并解压安装包

```bash
# 上传安装包到服务器（假设放在 /tmp）
ls -lh /tmp/dm*.zip

# 解压
cd /tmp
unzip dm_xxx_xxx.zip

# 查看解压内容
ls -la
# 应该看到 DMInstall.bin
```

### 3. 执行安装

```bash
# 切换到 dmdba 用户
su - dmdba

# 设置 DISPLAY（如果使用图形界面安装）
export DISPLAY=:0.0

# 命令行安装（非交互式）
./DMInstall.bin -q /dm8
```

或者使用图形界面安装：

```bash
./DMInstall.bin
# 按照向导选择安装路径、组件等
```

### 4. 初始化数据库实例

```bash
# 使用 dminit 工具初始化数据库
cd /dm8/bin
./dminit PATH=/dm8/data DB_NAME=DAMENG INSTANCE_NAME=DMSERVER PORT_NUM=5236
```

关键参数说明：

| 参数 | 说明 | 示例值 |
|------|------|--------|
| PATH | 数据文件存储路径 | /dm8/data |
| DB_NAME | 数据库名称 | DAMENG |
| INSTANCE_NAME | 实例名称 | DMSERVER |
| PORT_NUM | 端口号 | 5236 |
| PAGE_SIZE | 页大小 | 8192（默认） |
| CASE_SENSITIVE | 大小写敏感 | Y（默认敏感） |

### 5. 注册服务

```bash
# 以 root 用户执行
cd /dm8/script/root
./dm_service_installer.sh -h
```

常用注册方式：

```bash
# 注册数据库服务（前台启动后台运行）
./dm_service_installer.sh -t dmserver -p DMSERVER

# 或者指定配置文件
./dm_service_installer.sh -t dmserver -i /dm8/data/DAMENG/dm.ini -p DMSERVER
```

### 6. 启动数据库

```bash
# 启动服务
systemctl start DmServiceDMSERVER

# 查看服务状态
systemctl status DmServiceDMSERVER

# 设置开机自启
systemctl enable DmServiceDMSERVER
```

## Windows 环境安装

Windows 环境安装相对简单，下载安装包后双击运行：

1. 选择安装语言
2. 阅读并接受许可协议
3. 选择安装路径
4. 选择组件（典型/自定义）
5. 等待安装完成
6. 使用配置助手初始化数据库

## 连接数据库

### 使用 DM 管理工具（图形化）

```bash
# Linux 下启动管理工具
cd /dm8/tool
./manager
```

### 使用 disql（命令行）

```bash
# 本地连接
cd /dm8/bin
./disql SYSDBA/SYSDBA

# 远程连接
./disql SYSDBA/SYSDBA@192.168.1.100:5236
```

连接成功后会看到：

```
Server[localhost:5236]:mode is normal, state is open
disql V8
SQL>
```

### 基本验证命令

```sql
-- 查看数据库版本
SELECT * FROM V$VERSION;

-- 查看数据库状态
SELECT STATUS$, MODE$, PATH_NAME FROM V$DATABASE;

-- 查看会话信息
SELECT SESS_ID, USERNAME, SQL_TEXT FROM V$SESSIONS;
```

## JDBC 连接配置

### Maven 依赖

```xml
<dependency>
    <groupId>com.dameng</groupId>
    <artifactId>DmJdbcDriver18</artifactId>
    <version>8.1.2.192</version>
</dependency>
```

### Java 连接代码

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

public class DamengConnection {
    public static void main(String[] args) {
        String url = "jdbc:dm://localhost:5236/DAMENG";
        String username = "SYSDBA";
        String password = "SYSDBA";
        
        try (Connection conn = DriverManager.getConnection(url, username, password);
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT * FROM V$VERSION")) {
            
            while (rs.next()) {
                System.out.println(rs.getString(1));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

### 连接池配置（Druid 为例）

```java
DruidDataSource dataSource = new DruidDataSource();
dataSource.setDriverClassName("dm.jdbc.driver.DmDriver");
dataSource.setUrl("jdbc:dm://localhost:5236/DAMENG");
dataSource.setUsername("SYSDBA");
dataSource.setPassword("SYSDBA");
dataSource.setInitialSize(5);
dataSource.setMinIdle(5);
dataSource.setMaxActive(20);
dataSource.setMaxWait(60000);
```

## 常用配置参数

### dm.ini 核心参数

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| INSTANCE_NAME | 实例名称 | DMSERVER |
| PORT_NUM | 监听端口 | 5236 |
| MAX_SESSIONS | 最大会话数 | 500-1000 |
| BUFFER | 缓存池大小（页数） | 根据内存配置 |
| MEMORY_POOL | 内存池大小（MB） | 512-2048 |
| SORT_BUF_SIZE | 排序缓冲区大小（MB） | 100-500 |

### 查看当前配置

```sql
-- 查看参数值
SELECT * FROM V$PARAMETER WHERE NAME LIKE '%BUFFER%';

-- 修改参数（动态）
ALTER SYSTEM SET 'MAX_SESSIONS' = 1000 SPFILE;

-- 修改参数（静态，需重启）
-- 需要编辑 dm.ini 文件
```

## 常见问题排查

### 1. 安装后无法启动

```bash
# 查看日志
cat /dm8/data/DAMENG/dm_xxx.log

# 检查端口是否被占用
netstat -tlnp | grep 5236

# 检查权限
ls -la /dm8/data/DAMENG/
```

### 2. JDBC 连接被拒绝

```bash
# 检查防火墙
systemctl status firewalld
firewall-cmd --list-ports

# 开放端口
firewall-cmd --permanent --add-port=5236/tcp
firewall-cmd --reload
```

### 3. ORA-12541: TNS 无监听

```sql
-- 检查监听状态
SELECT * FROM V$LISTEN;

-- 检查端口配置
SELECT PARA_VALUE FROM V$DM_INI WHERE PARA_NAME = 'PORT_NUM';
```

## 下一步

数据库装好了，接下来要做什么？

- 创建自己的表空间和用户
- 学习 SQL 基础操作
- 探索高级特性

安装只是起点，真正的旅程才刚刚开始。
