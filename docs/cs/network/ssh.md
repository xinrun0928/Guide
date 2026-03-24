# SSH 远程登录原理

作为后端工程师，你一定用过 SSH 登录服务器。

但你有没有想过：SSH 是如何保证安全的？它和 Telnet 有什么区别？为什么 SSH 密钥比密码更安全？

今天，让我们深入理解 SSH 的工作原理。

## SSH 是什么？

SSH（Secure Shell）是一种加密的网络协议，用于安全地远程登录服务器、执行命令、传输文件。

```
┌─────────────────────────────────────────────────────────────┐
│                    SSH vs Telnet                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Telnet：                                                  │
│  用户名密码明文传输                                         │
│  任何人截获都能看到密码                                      │
│  端口：23                                                  │
│                                                             │
│  SSH：                                                     │
│  所有数据加密传输                                           │
│  支持密钥认证                                              │
│  端口：22                                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## SSH 解决的问题

### Telnet 的安全问题

```
明文传输的 Telnet：
截获者 ────────────────────────────────────────────────────────>
         用户名: admin
         密码:   123456

风险：
- 密码泄露
- 中间人攻击
- 会话劫持
```

### SSH 的安全特性

```
SSH 提供：
1. 加密 ─ 所有传输数据加密
2. 认证 ─ 支持公钥认证，比密码更安全
3. 完整性 ─ 数据完整性校验
4. 转发 ─ 端口转发、SSH 隧道
```

## SSH 协议版本

### SSH-1 vs SSH-2

```
SSH-1：
- 存在安全漏洞
- 已废弃
- 不再使用

SSH-2（SSH2）：
- 更安全
- 更好的性能
- 支持多种认证方式
- 事实标准
```

## SSH 握手过程

### 协议协商

```
┌─────────────────────────────────────────────────────────────┐
│                    SSH 连接建立过程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. TCP 连接建立（22 端口）                                 │
│                                                             │
│  2. 版本协商                                               │
│     客户端 ──── SSH-2.0-OpenSSH_8.9 ──────> 服务器        │
│     服务器 <──── SSH-2.0-OpenSSH_9.2 ────────── 服务器     │
│                                                             │
│  3. 密钥交换（KEX）                                        │
│     双方协商加密算法、认证算法、压缩算法                     │
│                                                             │
│  4. 用户认证                                               │
│     密码认证 / 公钥认证                                     │
│                                                             │
│  5. 会话请求                                               │
│     打开 shell / 执行命令                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 密钥交换

```
密钥交换算法（如 ECDH）：
- 双方协商出共享密钥（Shared Secret）
- 双方生成会话密钥（Session Key）
- 使用会话密钥加密后续通信

目的：前向保密（即使长期密钥泄露，历史会话仍安全）
```

### SSH 密钥体系

```
┌─────────────────────────────────────────────────────────────┐
│                    SSH 密钥体系                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  主机密钥（Host Key）：                                     │
│  - 服务器持有                                               │
│  - 用于服务器身份验证                                        │
│  - 存储在 /etc/ssh/ssh_host_*                              │
│                                                             │
│  用户密钥（User Key）：                                     │
│  - 用户持有                                                 │
│  - 用于客户端身份验证                                        │
│  - 存储在 ~/.ssh/                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## SSH 认证方式

### 1. 密码认证

```
最简单，但不推荐

流程：
1. 客户端发送用户名
2. 服务器要求密码
3. 客户端发送密码（加密传输）
4. 服务器验证
```

### 2. 公钥认证（推荐）

```
更安全，推荐使用

原理：
1. 用户生成密钥对（公钥 + 私钥）
2. 公钥放在服务器 ~/.ssh/authorized_keys
3. 登录时，服务器发送随机挑战
4. 客户端用私钥签名
5. 服务器用公钥验证签名
```

```
密钥生成：
ssh-keygen -t ed25519 -C "alice@workstation"

生成文件：
~/.ssh/id_ed25519      ← 私钥（绝对保密）
~/.ssh/id_ed25519.pub  ← 公钥（可以公开）
```

### 3. 证书认证

```
大规模部署时使用

流程：
1. 用户密钥由 CA（证书颁发机构）签名
2. 服务器信任 CA
3. CA 签名的公钥自动有效

适用：数百台服务器的企业环境
```

## SSH 密钥详解

### 密钥类型

```
RSA：
- 历史最悠久
- 兼容性好
- 建议 4096 位

ECDSA（Elliptic Curve DSA）：
- 更快
- 更短密钥
- 但存在潜在后门争议

Ed25519（推荐）：
- 最现代
- 最安全
- 密钥最短
- 性能最好
```

### 密钥文件格式

```
# RSA 私钥文件格式（PEM）
-----BEGIN OPENSSH PRIVATE KEY-----
Base64 编码的私钥数据
-----END OPENSSH PRIVATE KEY-----

# 公钥文件格式
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... 注释

# authorized_keys 文件格式
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5...  alice@workstation
ssh-rsa AAAAB3NzaC1...  bob@laptop
```

## SSH 配置文件

### SSH 客户端配置

```
~/.ssh/config

Host server1
    HostName 192.168.1.100
    User alice
    Port 22
    IdentityFile ~/.ssh/id_ed25519

Host server2
    HostName example.com
    User bob
    Port 2222
    IdentityFile ~/.ssh/id_rsa
    ForwardAgent yes
```

### SSH 服务端配置

```
/etc/ssh/sshd_config

# 端口
Port 22

# 允许的认证方式
PasswordAuthentication yes
PubkeyAuthentication yes
PermitRootLogin no

# 空闲超时
ClientAliveInterval 300
ClientAliveCountMax 2

# 禁止密码空的用户
PermitEmptyPasswords no
```

## SSH 端口转发

### 本地端口转发

```
将远程服务器的端口映射到本地

ssh -L 8080:remote-server:80 user@gateway

效果：
本地浏览器 → localhost:8080 → gateway → remote-server:80
```

### 远程端口转发

```
将本地端口暴露到远程服务器

ssh -R 8080:local-server:80 user@gateway

效果：
远程浏览器 → gateway:8080 → 本地 local-server:80
```

### SOCKS 代理

```
ssh -D 1080 user@gateway

效果：
本地程序 → localhost:1080（SOCKS 代理）→ gateway → 互联网
```

## SCP 与 SFTP

### SCP（安全复制）

```
# 下载文件
scp user@server:/path/file.txt ./local/

# 上传文件
scp ./local/file.txt user@server:/path/

# 下载目录
scp -r user@server:/path/dir/ ./local/

# 指定端口
scp -P 2222 user@server:/path/file.txt ./
```

### SFTP（安全 FTP）

```
# 交互式 SFTP
sftp user@server

# SFTP 命令
sftp> ls
sftp> cd /path
sftp> get file.txt
sftp> put file.txt
sftp> quit
```

## Java 实现 SSH

### 使用 JSch

```java
import com.jcraft.jsch.*;
import java.io.*;

public class SSHClient {
    public static void main(String[] args) {
        String host = "example.com";
        String user = "alice";
        String password = "secret";

        JSch jsch = new JSch();

        try {
            // 添加私钥（如果使用密钥认证）
            // jsch.addIdentity("/path/to/private_key");

            // 创建会话
            Session session = jsch.getSession(user, host, 22);
            session.setPassword(password);
            session.setConfig("StrictHostKeyChecking", "no");
            session.connect();

            System.out.println("SSH 连接成功");

            // 执行命令
            String command = "ls -la /home/alice";
            ChannelExec channelExec = (ChannelExec) session.openChannel("exec");
            channelExec.setCommand(command);
            channelExec.setInputStream(null);
            channelExec.setErrStream(System.err);

            InputStream in = channelExec.getInputStream();
            channelExec.connect();

            // 读取输出
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(in));
            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println(line);
            }

            channelExec.disconnect();
            session.disconnect();

        } catch (JSchException | IOException e) {
            e.printStackTrace();
        }
    }
}
```

### 使用 Apache MINA SSHD

```java
import org.apache.sshd.server.SshServer;
import org.apache.sshd.sftp.server.SftpSubsystemFactory;
import java.util.Arrays;

public class SFTPServer {
    public static void main(String[] args) throws Exception {
        SshServer sshd = SshServer.setUpDefaultServer();

        // 监听端口
        sshd.setPort(2222);

        // 设置主机密钥
        sshd.setKeyPairProvider(
            new SimpleGeneratorHostKeyProvider(
                new java.io.File("/tmp/hostkey.ser")));

        // 设置用户认证
        sshd.setPasswordAuthenticator(
            (username, password, session) ->
                "alice".equals(username) && "secret".equals(password));

        // 启用 SFTP
        sshd.setSubsystemFactories(
            Arrays.asList(new SftpSubsystemFactory()));

        // 启动
        sshd.start();

        System.out.println("SFTP 服务器启动在端口 2222");
    }
}
```

## SSH 安全最佳实践

### 1. 使用密钥认证

```bash
# 生成密钥
ssh-keygen -t ed25519 -C "工作邮箱"

# 复制公钥到服务器
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server
```

### 2. 禁用密码登录

```
/etc/ssh/sshd_config：

PasswordAuthentication no
PubkeyAuthentication yes
```

### 3. 更改默认端口

```
/etc/ssh/sshd_config：

Port 2222
```

### 4. 限制登录用户

```
/etc/ssh/sshd_config：

AllowUsers alice bob
AllowGroups sftpusers
```

### 5. 使用 Fail2Ban

```
防止 SSH 暴力破解

安装后自动封禁多次登录失败的 IP
```

### 6. 启用两步验证

```
Google Authenticator 或其他 TOTP 实现
```

## 常见问题

### 首次连接提示

```
$ ssh user@server
The authenticity of host 'server (192.168.1.100)' can't be established.
ECDSA key fingerprint is SHA256:xxxxxxxxxxxxx.
Are you sure you want to continue connecting (yes/no/[fingerprint])?

这是正常的安全提示，第一次需要确认服务器指纹
```

### 连接被拒绝

```
问题：ssh_exchange_identification: Connection closed by remote host

原因：
1. 服务器 SSH 服务未启动
2. 防火墙阻止
3. 客户端 IP 被禁用
```

### 保持连接

```
问题：长时间不操作后连接断开

解决：
1. 客户端配置
~/.ssh/config：
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3

2. 服务端配置
/etc/ssh/sshd_config：
ClientAliveInterval 300
ClientAliveCountMax 3
```

## 面试追问方向

- SSH 和 Telnet 的区别是什么？
- SSH 的加密原理是什么？
- SSH 握手过程是怎样的？
- 什么是前向保密？
- SSH 密钥认证的原理是什么？
- RSA、ECDSA、Ed25519 密钥有什么区别？
- SSH 端口转发是什么？有哪些类型？
- SCP 和 SFTP 有什么区别？
- SSH 有哪些安全最佳实践？
- 如何在 Java 中实现 SSH 连接？
