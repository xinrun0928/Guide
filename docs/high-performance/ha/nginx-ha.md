# Nginx 高可用：Keepalived + VRRP 实现 VIP 漂移

你的 Nginx 服务器挂了。

不是后端，不是数据库，是最前线的 Nginx。

报警电话在凌晨 2 点响起，你从床上爬起来，一边远程重启，一边祈祷：「别有用户在这几分钟里访问」。

这就是单点故障的代价。

有没有办法让 Nginx 本身也是高可用的？答案是：**Keepalived + VRRP**。

## 为什么需要 Keepalived

Nginx 本身没有高可用机制。你部署两台 Nginx，它们各自为政，不知道对方的存在。

Keepalived 的作用就是：**让两台（或多台）Nginx 看起来是一个整体，共享一个虚拟 IP（VIP）**。

```
            用户请求
                │
                ▼
        ┌───────────────┐
        │   虚拟 IP (VIP)  │
        │   192.168.1.100 │
        └───────┬───────┘
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
    ┌─────────┐     ┌─────────┐
    │ Nginx A │     │ Nginx B │
    │ Master  │◄───►│ Backup  │
    └─────────┘     └─────────┘
```

正常情况下，VIP 绑定在 Master（主节点）上，用户请求都打到 Nginx A。

当 Nginx A 挂了，VIP 自动漂移到 Nginx B，用户无感知。

## VRRP 协议原理

VRRP（Virtual Router Redundancy Protocol）是一个选举协议：

1. **优先级（Priority）**：Master 优先级高（比如 100），Backup 优先级低（比如 80）
2. **心跳检测**：Master 定期向 224.0.0.18 组播发送 VRRP 报文
3. **选举**：Backup 收不到心跳时，认为 Master 挂了，自己升级为 Master
4. **漂移**：VIP 和相关配置自动切换到新的 Master

### VRRP 工作流程

```
时间线：
T1: Master 正常，发送心跳，Backup 监听
T2: Master 挂了，心跳中断
T3: Backup 等待 3 秒（默认抢占延迟）
T4: Backup 成为新 Master，VIP 漂移
T5: 旧 Master 恢复，发送更高优先级心跳
T6: 新 Master 让位，旧 Master 恢复主身份
```

## Keepalived 安装

```bash
# CentOS/RHEL
yum install -y keepalived

# Ubuntu/Debian
apt-get install -y keepalived

# 验证安装
keepalived --version
```

## Keepalived 配置

### 配置文件位置

```bash
# 主配置文件
/etc/keepalived/keepalived.conf

# 日志
/var/log/messages
```

### Master 节点配置

```conf
! Configuration File for keepalived

global_defs {
    router_id nginx_master          # 路由器标识，同一集群唯一
    script_user root                # 健康检查脚本执行用户
    enable_script_security          # 启用脚本安全
}

# 健康检查脚本
vrrp_script check_nginx {
    script "/etc/keepalived/check_nginx.sh"   # 检查脚本路径
    interval 2                                      # 检查间隔（秒）
    weight -20                                     # 检查失败时优先级降低
    fall 3                                         # 连续失败 3 次才认为真的挂了
    rise 2                                         # 连续成功 2 次才认为恢复
}

vrrp_instance VI_1 {
    state MASTER                    # 初始状态（可与实际不符，看 priority）
    interface eth0                   # 绑定网卡
    virtual_router_id 51            # 虚拟路由 ID，同一集群必须相同
    priority 100                     # 优先级，Master 要高于 Backup
    advert_int 1                    # 心跳间隔（秒）
    nopreempt                        # 非抢占模式（可选）

    # 认证
    authentication {
        auth_type PASS
        auth_pass 1111              # 认证密码
    }

    # 虚拟 IP
    virtual_ipaddress {
        192.168.1.100/24            # VIP 地址
    }

    # 追踪脚本（检查 Nginx 是否存活）
    track_script {
        check_nginx
    }

    # 状态变化通知
    notify_master "/etc/keepalived/notify.sh master"
    notify_backup "/etc/keepalived/notify.sh backup"
    notify_fault "/etc/keepalived/notify.sh fault"
}
```

### Backup 节点配置

```conf
! Configuration File for keepalived

global_defs {
    router_id nginx_backup
    script_user root
    enable_script_security
}

vrrp_script check_nginx {
    script "/etc/keepalived/check_nginx.sh"
    interval 2
    weight -20
    fall 3
    rise 2
}

vrrp_instance VI_1 {
    state BACKUP                    # Backup 节点
    interface eth0
    virtual_router_id 51            # 必须与 Master 相同
    priority 80                     # 优先级低于 Master
    advert_int 1

    authentication {
        auth_type PASS
        auth_pass 1111             # 必须与 Master 相同
    }

    virtual_ipaddress {
        192.168.1.100/24
    }

    track_script {
        check_nginx
    }

    notify_master "/etc/keepalived/notify.sh master"
    notify_backup "/etc/keepalived/notify.sh backup"
    notify_fault "/etc/keepalived/notify.sh fault"
}
```

### Nginx 健康检查脚本

```bash
#!/bin/bash
# /etc/keepalived/check_nginx.sh

# 检查 Nginx 进程是否存在
nginx_process=$(ps aux | grep "nginx: master" | grep -v grep)

if [ -z "$nginx_process" ]; then
    # Nginx 进程不存在，尝试重启
    systemctl restart nginx
    sleep 2

    # 再次检查
    nginx_process=$(ps aux | grep "nginx: master" | grep -v grep)
    if [ -z "$nginx_process" ]; then
        # 重启失败，退出让 Keepalived 触发切换
        exit 1
    fi
fi

# 检查 Nginx 是否能处理请求
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/health)

if [ "$response" != "200" ]; then
    # Nginx 不能处理请求
    exit 1
fi

exit 0
```

```bash
chmod +x /etc/keepalived/check_nginx.sh
```

### 状态通知脚本

```bash
#!/bin/bash
# /etc/keepalived/notify.sh

STATE=$1
VIP="192.168.1.100"
LOGFILE="/var/log/keepalived_notify.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> $LOGFILE
}

case $STATE in
    "master")
        log "Transition to MASTER state"
        # 可以在这里发送告警通知
        # /usr/local/bin/send_alert.sh "Keepalived: $VIP promoted to MASTER"
        ;;
    "backup")
        log "Transition to BACKUP state"
        ;;
    "fault")
        log "Transition to FAULT state"
        ;;
esac
```

## 双主模式（双 VIP）

单主模式有一半的资源浪费了（Backup 平时不干活）。

双主模式让两台机器互为 Backup：

```conf
# Nginx A 配置
vrrp_instance VI_1 {
    state MASTER
    interface eth0
    virtual_router_id 51
    priority 100
    virtual_ipaddress {
        192.168.1.100/24   # VIP 1
    }
    track_script {
        check_nginx
    }
}

vrrp_instance VI_2 {
    state BACKUP
    interface eth0
    virtual_router_id 52    # 不同的 router_id
    priority 80
    virtual_ipaddress {
        192.168.1.101/24   # VIP 2
    }
    track_script {
        check_nginx
    }
}
```

```conf
# Nginx B 配置
vrrp_instance VI_1 {
    state BACKUP
    interface eth0
    virtual_router_id 51
    priority 80
    virtual_ipaddress {
        192.168.1.100/24   # VIP 1
    }
    track_script {
        check_nginx
    }
}

vrrp_instance VI_2 {
    state MASTER
    interface eth0
    virtual_router_id 52
    priority 100
    virtual_ipaddress {
        192.168.1.101/24   # VIP 2
    }
    track_script {
        check_nginx
    }
}
```

```
          VIP 1 (192.168.1.100)          VIP 2 (192.168.1.101)
                 │                              │
         ┌───────┴───────┐              ┌───────┴───────┐
         │               │              │               │
         ▼               ▼              ▼               ▼
    ┌─────────┐     ┌─────────┐    ┌─────────┐     ┌─────────┐
    │ Nginx A │     │ Nginx B │    │ Nginx A │     │ Nginx B │
    │ MASTER  │     │ BACKUP  │    │ BACKUP  │    │ MASTER  │
    └─────────┘     └─────────┘    └─────────┘     └─────────┘
```

## 启动和验证

```bash
# 启动 Keepalived
systemctl enable keepalived
systemctl start keepalived

# 查看 VIP 绑定
ip addr show eth0
# 应该看到：
# inet 192.168.1.100/24 scope global secondary eth0

# 查看 VRRP 状态
cat /var/log/messages | grep -i vrrp

# 模拟故障
# 在 Master 上停止 Keepalived
systemctl stop keepalived

# 在 Backup 上查看日志，应该看到切换为 Master
tail -f /var/log/messages
```

## 常见问题排查

### VIP 没有绑定

```bash
# 检查防火墙
firewall-cmd --add-protocol=vrrp
firewall-cmd --permanent --add-protocol=vrrp

# 或 iptables
iptables -I INPUT -d 224.0.0.0/8 -j ACCEPT
```

### 脑裂问题（双 Master）

两台机器都认为自己是 Master，都绑定了 VIP。

原因：
1. 网络分区
2. 心跳线断了
3. 防火墙阻止了 VRRP 报文

解决方案：

```conf
# 启用抢占延迟
preempt_delay 30s   # 故障恢复后等待 30 秒再抢回

# 或者使用非抢占模式
nopreempt
```

### 健康检查失效

```bash
# 检查脚本权限
ls -la /etc/keepalived/check_nginx.sh

# 测试脚本
/etc/keepalived/check_nginx.sh
echo $?  # 应该是 0
```

## 完整架构图

```
                         用户请求
                              │
                              ▼
                   ┌──────────────────────┐
                   │   域名解析 (DNS)      │
                   │  www.example.com      │
                   └──────────┬───────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │      虚拟 IP (VIP)             │
              │   192.168.1.100               │
              └───────────┬───────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
        ┌──────────┐           ┌──────────┐
        │ Keepalive │           │ Keepalive │
        │  + Nginx  │           │  + Nginx  │
        │  Master   │◄──心跳───►│  Backup   │
        └─────┬─────┘           └─────┬─────┘
              │                       │
              │  proxy_pass           │
              ▼                       ▼
        ┌─────────────────────────────────────┐
        │         后端服务集群                  │
        │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
        │  │ S1  │ │ S2  │ │ S3  │ │ S4  │   │
        │  └─────┘ └─────┘ └─────┘ └─────┘   │
        └─────────────────────────────────────┘
```

---

**思考题：**

假设 Keepalived 检测到 Nginx A 挂了，VIP 漂移到 Nginx B。

问题：
1. 漂移过程中，用户请求会中断多久？这个时间能否优化？
2. 如果 Nginx A 恢复后立即抢回 VIP，可能会导致什么问题？（提示：考虑「脑裂」）
3. 实际生产环境中，Keepalived + Nginx 高可用是否足够？还有什么需要考虑的？

提示：考虑 DNS TTL、会话保持、SSL 证书等。
