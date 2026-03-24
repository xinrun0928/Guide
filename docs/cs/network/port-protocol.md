# 常见端口号与协议对应关系

你有没有想过：当你在浏览器输入 `www.example.com:8080` 时，这个 `:8080` 到底是什么？

端口号是计算机网络中最容易被忽视，却无处不在的存在。它就像一栋大楼的房间号——IP 地址告诉你到了哪栋楼，端口号告诉你进哪个房间。

## 端口号的本质

端口号是一个 16 位的数字，范围是 0 到 65535（2^16 - 1）。

为什么是 65535？这要追溯到 TCP/IP 协议的设计——TCP 和 UDP 的头部都有一个 16 位的字段来存储端口号。

```
0 - 1023      ：系统端口（well-known ports），需要管理员权限才能绑定
1024 - 49151  ：注册端口（registered ports），分配给特定服务
49152 - 65535 ：动态端口（dynamic ports），客户端随机使用
```

简单说：
- 0 是保留的，不使用
- 1-1023 是「官方认证」的房间，比如 80 是 HTTP，443 是 HTTPS，没有特殊身份休想抢
- 1024-49151 是「付费租用」的房间，比如 3306 是 MySQL，6379 是 Redis
- 49152-65535 是「临时工位」，客户端发起连接时系统随机分配，用完就释放

## 经典端口号一览

### HTTP/HTTPS：Web 的大门

```
端口 80  ：HTTP 明文传输
端口 443 ：HTTPS 加密传输
端口 8443：有时用作 HTTPS 的非标准端口（比如 Tomcat 默认）
```

你访问 `http://www.example.com` 时，浏览器默认找 80 端口；访问 `https://www.example.com` 时，默认找 443 端口。

### 数据库：数据的仓库

```
端口 3306  ：MySQL
端口 5432  ：PostgreSQL
端口 1433  ：SQL Server
端口 27017 ：MongoDB
端口 6379  ：Redis
端口 9042  ：Cassandra
```

为什么 Redis 用 6379？这要追溯到电信系统。6379 是手机号段的一个号码，Redis 作者 Antirez 的一个女性朋友在意大利电信工作，这个号码就是她挑的。

### 中间件与消息队列

```
端口 2181  ：Zookeeper
端口 9092  ：Kafka（PLAINTEXT）
端口 9093  ：Kafka（SSL）
端口 5672  ：RabbitMQ（AMQP）
端口 15672 ：RabbitMQ（Management UI）
端口 8080  ：常用作 Tomcat、Resin 等应用服务器的非特权端口
端口 8081  ：常用作备用 HTTP 端口
```

### 远程访问与运维

```
端口 22  ：SSH（Secure Shell）
端口 23  ：Telnet（明文传输，已废弃）
端口 3389：Windows 远程桌面（RDP）
端口 5900：VNC
端口 873 ：Rsync
```

SSH 替代 Telnet 是因为安全。Telnet 传输的用户名和密码是明文的，别人截获网络包就能看到；SSH 全部加密。

### 邮件服务

```
端口 25  ：SMTP（邮件发送），邮件服务器之间通信
端口 465 ：SMTPS（SMTP over SSL）
端口 587 ：SMTP（提交端口），客户端到邮件服务器
端口 110 ：POP3（邮件接收，明文）
端口 995 ：POP3S（POP3 over SSL）
端口 143 ：IMAP（邮件接收，明文）
端口 993 ：IMAPS（IMAP over SSL）
```

### 文件传输

```
端口 20  ：FTP 数据传输（主动模式）
端口 21  ：FTP 控制命令
端口 69  ：TFTP（简单文件传输，无认证）
端口 2049：NFS（Network File System）
端口 445 ：SMB（Windows 文件共享）
```

### 容器与集群

```
端口 2375：Docker API（明文）
端口 2376：Docker API（TLS）
端口 6443：Kubernetes API Server
端口 10250：Kubelet API
端口 2379：Etcd 客户端通信
端口 2380：Etcd 节点间通信
```

### 注册端口：常见的「租户」

```
端口 1080：SOCKS 代理
端口 1110：NFS 相关的 RPC 服务
端口 2049：NFS 服务
端口 3306：MySQL
端口 5000：Flask 开发服务器
端口 5432：PostgreSQL
端口 5672：RabbitMQ
端口 6379：Redis
端口 8080：通用 HTTP 替代端口
端口 9000：PHP-FPM、SonarQube、Pinpoint
端口 9090：Prometheus、Swagger UI
端口 9200：Elasticsearch
端口 9300：Elasticsearch 节点通信
端口 27017：MongoDB
```

## 查看端口占用

Linux/Mac 查看端口占用：

```bash
# 查看所有监听端口
netstat -tuln

# 查看特定端口
lsof -i :8080
ss -tuln | grep :80

# 查看端口被哪个进程占用
lsof -i :3306
```

Windows 查看端口占用：

```powershell
# 查看所有端口
netstat -ano

# 查看特定端口
netstat -ano | findstr :8080

# 根据 PID 查找进程
tasklist | findstr <PID>
```

## 端口扫描与安全

面试中常问的一个问题：端口扫描是什么原理？

端口扫描本质上就是「敲门」——向目标 IP 的各个端口发送连接请求，根据响应判断端口状态。

```
开放端口    ：收到 SYN+ACK 响应
关闭端口    ：收到 RST 响应
过滤/防火墙 ：无响应或收到 ICMP 不可达
```

常见的端口扫描工具：
- `nmap`：网络探索和安全审计的瑞士军刀
- `masscan`：高速端口扫描器
- `netcat`：网络瑞士军刀，可以手动「敲门」

```bash
# 使用 nmap 扫描常见端口
nmap -sV 192.168.1.1

# 扫描特定端口范围
nmap -p 1-1000 192.168.1.1

# 快速扫描常用端口
nmap --top-ports 20 192.168.1.1
```

## 一个有趣的细节：TIME_WAIT

服务器突然崩了无法重启，报错「Address already in use」——这是端口占用问题。

根本原因是 TCP 四次挥手中的 TIME_WAIT 状态。连接关闭后，操作系统会保留端口 2MSL（通常是 60 秒），防止旧连接的延迟数据包被新连接接收。

解决方案：

```bash
# Linux 允许端口快速复用
echo 1 > /proc/sys/net/ipv4/tcp_tw_reuse

# 或调整 TIME_WAIT 超时时间
echo 30 > /proc/sys/net/ipv4/tcp_fin_timeout
```

生产环境建议：
- 服务端使用 SO_REUSEADDR 选项
- 客户端尽量使用连接池复用连接
- 合理设置 keepalive 参数

## 面试追问方向

- 为什么端口号最大是 65535？
- HTTP 默认端口是 80，HTTPS 默认端口是 443，这些是怎么约定的？
- `0.0.0.0:8080` 和 `127.0.0.1:8080` 有什么区别？
- 服务器上出现大量 TIME_WAIT 是什么原因？怎么解决？
- 端口 0 为什么不用？
