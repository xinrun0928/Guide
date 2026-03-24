# SELinux：强制访问控制的守护者

你部署了一个 Web 应用。

它需要读取 `/var/www/html` 中的文件，还需要访问网络。

传统 Linux 权限控制（DAC）允许你设置 owner/group/permissions，但无法精细控制「Web 应用能做什么」。

**SELinux（Security-Enhanced Linux）** 提供了一种更强大的访问控制机制——**强制访问控制（MAC）**。

## DAC vs MAC

```
┌─────────────────────────────────────────────────────────────┐
│                    DAC vs MAC                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DAC（Discretionary Access Control，自主访问控制）           │
│  - 基于用户/组/权限                                         │
│  - 所有者可以自主决定谁可以访问                             │
│  - 例如：chmod 777, chmod +s                              │
│  - 问题：root 可以做任何事                                 │
│                                                             │
│  MAC（Mandatory Access Control，强制访问控制）              │
│  - 管理员定义安全策略                                       │
│  - 策略强制执行，即使进程是 root                            │
│  - 例：root 身份的 Apache 也不能读取 /etc/shadow          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## SELinux 的核心概念

### 1. 安全上下文（Security Context）

每个进程和文件都有一个安全标签：

```bash
# 查看文件的安全上下文
ls -Z /etc/passwd
# -rw-r--r--. root root system_u:object_r:passwd_file_t:s0 /etc/passwd

# 查看进程的安全上下文
ps -Z
# system_u:system_r:httpd_t:s0 httpd

# 安全上下文格式：
# 用户:角色:类型:级别
# system_u:system_r:httpd_t:s0
```

### 2. 类型强制（Type Enforcement）

```
┌─────────────────────────────────────────────────────────────┐
│                    SELinux 类型规则                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  httpd_t      ← httpd 进程类型                              │
│       │                                                      │
│       ├─→ 可读 httpd_sys_content_t（Web 内容）              │
│       │                                                      │
│       ├─→ 可写 httpd_tmp_t（临时文件）                     │
│       │                                                      │
│       └─→ 不可读 shadow_t（密码文件）                       │
│                                                             │
│  规则定义在 /etc/selinux/targeted/policy/policy.30         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. 角色（Role）

```
system_u:system_r:httpd_t:s0
            ↑
         角色：定义可以转换到哪些类型

常见角色：
- system_r：系统进程
- staff_r：staff 用户
- user_r：普通用户
```

## SELinux 模式

```bash
# 查看当前模式
getenforce
# Enforcing | Permissive | Disabled

# 临时修改模式
setenforce 0   # Permissive（记录但不阻止）
setenforce 1   # Enforcing（强制执行）

# 永久配置 /etc/selinux/config
SELINUX=enforcing
SELINUXTYPE=targeted
```

## SELinux 策略

### 常用策略模块

```bash
# 查看已加载的策略模块
semodule -l

# 查看策略包
rpm -qa | grep selinux-policy

# targeted 策略：只保护预定义的目标
# minimum 策略：最小化策略
# mls 策略：多级安全
```

### 布尔值（Boolean）

```bash
# 查看所有布尔值
getsebool -a

# 查看特定布尔值
getsebool httpd_can_network_connect

# 临时开启
setsebool httpd_can_network_connect on

# 永久开启
setsebool -P httpd_can_network_connect on

# 常用 HTTP 相关布尔值
httpd_can_network_connect     # 允许 HTTP 访问网络
httpd_can_sendmail            # 允许 HTTP 发送邮件
httpd_enable_cgi             # 允许 CGI 脚本
httpd_unified                 # 允许 HTTP 访问所有类型
httpd_sys_script_anon_write   # 允许 HTTP 写入标记文件
```

## SELinux 命令

### chcon 和 restorecon

```bash
# 临时修改文件上下文
chcon -t httpd_sys_content_t /var/www/html/index.html

# 永久修改：使用 semanage
semanage fcontext -a -t httpd_sys_content_t "/var/www/html(/.*)?"
restorecon -Rv /var/www/html

# 重置为默认上下文
restorecon -Rv /var/www/html
```

### semanage

```bash
# 管理文件上下文
semanage fcontext -l | grep httpd
semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?"

# 管理端口上下文
semanage port -l | grep http
semanage port -a -t http_port_t -p tcp 8080

# 管理登录用户
semanage login -l
semanage user -l
```

### audit2why 和 audit2allow

```bash
# 查看拒绝日志
tail -f /var/log/audit/audit.log | grep AVC

# 或查看 messages
tail -f /var/log/messages | grep selinux

# 分析拒绝原因
cat /var/log/audit/audit.log | audit2why

# 生成允许规则（仅用于调试，生产环境要谨慎）
cat /var/log/audit/audit.log | audit2allow -M mymodule
semodule -i mymodule.pp
```

## 常见问题与解决

### 1. Apache/Nginx 无法访问文件

```bash
# 症状：HTTP 500 错误，/var/log/audit/audit.log 显示 AVC denied

# 检查文件上下文
ls -Z /var/www/html/
# drwxr-xr-x. root root unconfined_u:object_r:httpd_sys_content_t:s0 /var/www/html

# 如果上下文错误
semanage fcontext -a -t httpd_sys_content_t "/var/www/html(/.*)?"
restorecon -Rv /var/www/html
```

### 2. 服务无法监听端口

```bash
# 症状：服务启动失败

# 检查端口上下文
semanage port -l | grep 8080

# 添加端口上下文
semanage port -a -t http_port_t -p tcp 8080

# 或修改服务配置使用标准端口
```

### 3. MySQL/PostgreSQL 无法访问数据库

```bash
# 数据库文件上下文
ls -Z /var/lib/mysql/
# drwx------. mysql mysql system_u:object_r:mysqld_db_t:s0 /var/lib/mysql

# 如果复制了数据库文件
cp -R /tmp/mysql_backup/* /var/lib/mysql/
chcon -R -t mysqld_db_t /var/lib/mysql/

# 或使用正确的恢复方式
mysql_restore_t /var/lib/mysql
```

### 4. Web 应用需要特殊权限

```bash
# PHP 写入文件
ls -Z /var/www/html/upload/
# drwxrwxr-x. apache apache unconfined_u:object_r:httpd_sys_content_t:s0 /var/www/html/upload

# 改为可写上下文
semanage fcontext -a -t httpd_sys_rw_content_t "/var/www/html/upload(/.*)?"
restorecon -Rv /var/www/html/upload

# 或使用非标准目录
mkdir -p /var/www/myapp_data
semanage fcontext -a -t httpd_sys_content_t "/var/www/myapp_data(/.*)?"
restorecon -Rv /var/www/myapp_data
```

## Java SELinux 配置

### Tomcat 配置

```bash
# /etc/tomcat/tomcat.conf
JAVA_OPTS="-Djava.security.manager -Djava.security.policy==/etc/tomcat.policy"

# /etc/tomcat/policy.d/*
grant {
  permission java.io.FilePermission "/var/log/tomcat/*", "read,write";
  permission java.net.SocketPermission "localhost:8080", "listen";
};
```

### Docker SELinux 标签

```yaml
# docker-compose.yml
services:
  web:
    image: nginx
    security_opt:
      - label:type:httpd_t
    volumes:
      - ./html:/var/www/html:z
      # :z 或 :Z 让 Docker 自动管理 SELinux 标签
```

## SELinux 策略开发

### 自定义模块

```bash
# 1. 创建策略源文件 myapp.te
module myapp 1.0;

require {
    type httpd_t;
    type user_home_t;
    type tmp_t;
    class dir { read getattr search open };
    class file { read getattr open };
}

# 允许 httpd 读取用户 home 目录
allow httpd_t user_home_t:dir { read getattr search open };
allow httpd_t user_home_t:file { read getattr open };

# 允许 httpd 写临时文件
allow httpd_t tmp_t:dir { read write add_name remove_name };
```

```bash
# 2. 编译模块
make -f /usr/share/selinux/devel/Makefile myapp.pp

# 3. 安装模块
semodule -i myapp.pp

# 4. 启用模块
semodule -e myapp

# 5. 查看模块
semodule -l | grep myapp
```

## 故障排除

### 调试工具

```bash
# 1. setroubleshoot-server
# 自动分析 AVC 拒绝并提供建议
yum install setroubleshoot-server
systemctl restart rsyslog

# 2. 查看详细报告
sealert -a /var/log/audit/audit.log

# 3. 查看特定 AVC
ausearch -m AVC -ts recent

# 4. 查看所有拒绝
ausearch -m avc,user_avc -ts recent
```

### 常用排查命令

```bash
# 查看 SELinux 状态
sestatus
getenforce

# 查看文件/进程上下文
ls -Z /path/to/file
ps -Z

# 查看布尔值
getsebool -a
getsebool httpd_can_network_connect

# 临时设为 Permissive 模式测试
setenforce 0

# 恢复为 Enforcing
setenforce 1
```

## 面试追问方向

1. **SELinux 的作用是什么？** —— 强制访问控制，限制即使有 root 权限的进程能做什么
2. **DAC 和 MAC 的区别？** —— DAC 基于用户自主控制，MAC 基于管理员策略强制执行
3. **安全上下文由什么组成？** —— 用户:角色:类型:级别
4. **如何排查 SELinux 拒绝访问？** —— 查看 audit.log、使用 audit2why、sealert 工具
5. **布尔值的作用是什么？** —— 动态调整 SELinux 策略行为，无需重新编译策略

> "SELinux 是 Linux 安全的终极守护者。理解它，才能真正掌握 Linux 系统安全。"
