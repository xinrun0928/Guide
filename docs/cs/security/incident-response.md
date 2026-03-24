# 应急响应流程

> 「安全事件不会因为你没准备好就不发生。」

每个组织都应该为安全事件做好准备。不是「如果」，而是「何时」。

应急响应（Incident Response）就是在安全事件发生时，如何快速、有效地应对，最大限度地减少损失。

## 应急响应的生命周期

业界广泛采用 NIST SP 800-61 标准定义的应急响应生命周期：

```
┌─────────────────────────────────────────────────────────────┐
│                    应急响应生命周期                          │
│                                                             │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐          │
│   │   准备   │────▶│  检测分析  │────▶│  抑制   │          │
│   └──────────┘     └──────────┘     └────┬─────┘          │
│        ▲                               │                  │
│        │                               ▼                  │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐          │
│   │   回顾   │◀────│   恢复   │◀────│  根除   │          │
│   └──────────┘     └──────────┘     └──────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 阶段一：准备

「台上一分钟，台下十年功。」准备阶段决定了应急响应的效率。

### 应急响应团队组建

```java
// 应急响应团队角色
public class IncidentResponseTeam {
    // 1. 应急响应负责人（Incident Commander）
    // 统筹协调，决策拍板
    void incidentCommander() {
        // 职责：
        // - 启动应急响应流程
        // - 协调各方资源
        // - 对外沟通（管理层、客户、监管）
        // - 决定响应策略
    }
    
    // 2. 技术调查组
    // 溯源分析，技术攻关
    void technicalTeam() {
        // 职责：
        // - 现场取证
        // - 日志分析
        // - 恶意软件分析
        // - 漏洞分析
    }
    
    // 3. 业务恢复组
    // 快速恢复业务
    void recoveryTeam() {
        // 职责：
        // - 系统恢复
        // - 数据恢复
        // - 服务上线
    }
    
    // 4. 法务/公关组
    // 处理法律和舆论
    void legalPRTeam() {
        // 职责：
        // - 法律评估
        // - 监管报告
        // - 外部沟通
    }
}
```

### 应急响应预案

```markdown
# 应急响应预案模板

## 1. 事件分级标准

| 级别 | 定义 | 响应时间 | 举例 |
|-----|------|---------|------|
| P0 - 特别重大 | 核心业务全面瘫痪，数据大规模泄露 | 立即 | 勒索软件加密核心数据库 |
| P1 - 重大 | 核心业务部分受影响，数据小规模泄露 | 15 分钟内 | Web 应用被挂马 |
| P2 - 较大 | 非核心业务受影响 | 1 小时内 | 某后台系统被入侵 |
| P3 - 一般 | 影响有限 | 4 小时内 | 员工账号被暴力破解 |

## 2. 响应流程

### P0/P1 响应流程
1. 发现事件 → 立即通知应急负责人
2. 应急负责人 5 分钟内确认并启动预案
3. 隔离受影响系统（优先）
4. 技术组 30 分钟内提交初步分析报告
5. 每小时向管理层汇报进展

### P2 响应流程
1. 发现事件 → 通知安全值班
2. 安全值班 15 分钟内评估
3. 确认后通知应急负责人
4. 4 小时内完成初步分析

## 3. 联系方式

| 角色 | 姓名 | 电话 | 邮箱 |
|-----|------|------|------|
| 应急负责人 | XXX | 138-xxxx-xxxx | xxx@company.com |
| 安全值班 | XXX | 139-xxxx-xxxx | sec@company.com |
| 技术支持 | XXX | 137-xxxx-xxxx | tech@company.com |
```

### 工具和资源准备

```java
// 应急响应工具包
public class IrToolkit {
    // 1. 取证工具
    String[] forensicsTools = {
        "FTK Imager",      // 磁盘镜像
        "Volatility",       // 内存取证
        "Autopsy",          // 文件恢复
        "Wireshark",        // 网络抓包分析
        "tcpdump",          // 命令行抓包
        "EnCase",           // 专业取证工具
    };
    
    // 2. 系统分析工具
    String[] systemAnalysisTools = {
        "Process Explorer",    // 进程分析
        "Autoruns",            // 启动项分析
        "Process Monitor",     // 文件/注册表/进程监控
        "Sysinternals Suite",  // Windows 系统工具包
    };
    
    // 3. 恶意软件分析
    String[] malwareAnalysisTools = {
        "IDA Pro",             // 静态反汇编
        "Ghidra",              // 开源逆向工具
        "x64dbg",              // 动态调试
        "Cuckoo Sandbox",      // 自动化沙箱
        "VirusTotal",          // 恶意软件检测
    };
    
    // 4. 日志分析
    String[] logAnalysisTools = {
        "Splunk",              // 日志分析平台
        "Elastic Stack",       // ELK 日志分析
        "Timeline Explorer",   // Windows 事件日志分析
    };
}
```

## 阶段二：检测与分析

发现事件后，需要快速准确地分析事件的性质和影响范围。

### 事件分类

```java
// 安全事件分类（基于 MITRE ATT&CK）
public class IncidentClassification {
    // 初始访问（Initial Access）
    enum InitialAccess {
        PHISHING,         // 钓鱼攻击
        EXPLOIT_PUBLIC,  // 公开漏洞利用
        SUPPLY_CHAIN,     // 供应链攻击
        VALID_ACCOUNTS,   // 凭证盗取
    }
    
    // 执行（Execution）
    enum Execution {
        MALICIOUS_CODE,   // 恶意代码执行
        SCRIPTING,        // 脚本执行
        COMPILER,         // 编译执行
    }
    
    // 持久化（Persistence）
    enum Persistence {
        BOOT_EXECUTION,       // 启动项
        SCHEDULE_TASK,        // 计划任务
        SERVICE_REGISTRATION, // 服务注册
        WEB_SHELL,            // Webshell
        REGISTRY_RUN_KEYS,    // 注册表自启动
    }
    
    // 权限提升（Privilege Escalation）
    enum PrivilegeEscalation {
        EXPLOIT_PRIVILEGE,   // 漏洞提权
        VALID_ACCOUNTS,      // 凭证利用
        Bypass_UAC,          // UAC 绕过
    }
    
    // 防御规避（Defense Evasion）
    enum DefenseEvasion {
        DISABLE_SECURITY,    // 关闭安全软件
        PROCESS_INJECTION,   // 进程注入
        ROOTKIT,             // Rootkit
        DELETING_LOGS,       // 清除日志
    }
    
    // 横向移动（Lateral Movement）
    enum LateralMovement {
        PSEXEC,              // PsExec
        WMI,                 // WMI 远程执行
        SMB_PTH,             // SMB 哈希传递
        SSH_TUNNEL,          // SSH 隧道
    }
    
    // 数据收集（Collection）
    enum Collection {
        KEYLOGGING,          // 键盘记录
        SCREEN_CAPTURE,      // 屏幕截图
        FILE_COLLECTION,     // 文件收集
    }
    
    // 数据外泄（Exfiltration）
    enum Exfiltration {
        OVER_PROTOCOL,       // 协议隧道
        C2_CHANNEL,          // C2 通信
        ENCRYPTED_EXFIL,     // 加密外泄
    }
}
```

### 快速分析方法

```java
// 事件快速分析方法
public class IncidentAnalysis {
    // 1. 时间线重建
    void buildTimeline() {
        // 收集所有相关日志
        // 按时间排序
        // 识别关键事件节点
        
        // 日志来源：
        // - 安全设备日志（防火墙、IDS、WAF）
        // - 系统日志（Windows Event、Linux Syslog）
        // - 应用日志（Web 服务器、数据库）
        // - 网络流量（PCAP）
    }
    
    // 2. 影响范围评估
    void assessImpact() {
        // 受影响系统数量
        // 受影响用户数量
        // 泄露数据类型
        // 直接经济损失
        
        // 评估方法：
        // - 资产清单交叉对比
        // - 用户数据库查询
        // - 文件完整性校验
    }
    
    // 3. 攻击路径分析
    void analyzeAttackPath() {
        // 初始入口是什么？
        // 如何获得更高权限？
        // 如何横向移动？
        // 最终目标是什么？
        
        // 常用分析方法：
        // - Kill Chain 分析
        // - ATT&CK 矩阵对照
    }
}
```

### 典型事件分析流程

```markdown
# 勒索病毒事件分析

## 1. 发现阶段
- 现象：多个终端无法打开文件，弹出勒索信息
- 时间：2024-XX-XX 09:15
- 报告人：客服部小王

## 2. 初步判断
- 勒索病毒特征明显
- 多个部门终端同时中招
- 可能具有横向传播能力

## 3. 隔离措施
- 立即断网受影响终端
- 关闭域控相关服务
- 禁用域管理员账号
- 通知全体员工不要开机

## 4. 深入分析
- 样本提取：获取勒索信和恶意程序
- 日志分析：查找初始入口
- 传播路径：确定横向移动方式
- 加密范围：评估损失

## 5. 分析结论
- 初始入口：钓鱼邮件附件
- 恶意程序：CrypMix 勒索病毒
- 传播方式：利用 SMB 漏洞横向移动
- 影响范围：23 台终端，核心文件服务器未受影响
```

## 阶段三：抑制

抑制的目的是阻止事件进一步扩大。

### 隔离措施

```java
// 隔离决策矩阵
public class ContainmentStrategy {
    // 紧急程度 vs 业务影响
    enum ContainmentLevel {
        // 立即执行（不需要审批）
        IMMEDIATE {
            void execute() {
                // 断网受影响主机
                // 禁用被入侵账号
                // 封锁恶意 IP/域名
            }
        },
        
        // 需要审批，但优先执行
        URGENT {
            void execute() {
                // 关闭受影响服务
                // 隔离整个网段
                // 切换到备份系统
            }
        },
        
        // 常规处理
        NORMAL {
            void execute() {
                // 计划内的服务暂停
                // 通知用户
                // 灰度发布安全补丁
            }
        }
    }
}
```

### 常见隔离操作

```bash
# Windows 主机隔离
# 1. 禁用账号
net user hacked_user /active:no

# 2. 关闭网络连接（本地）
netsh interface set interface "Ethernet" disable

# 3. 禁用 SMB 服务
Set-Service -Name smb1 -StartupType Disabled

# 4. 阻断恶意连接
netsh advfirewall firewall add rule name="Block C2" dir=out action=block remoteip=<malicious_ip>

# Linux 主机隔离
# 1. 断开网络
ip link set eth0 down

# 2. 杀掉恶意进程
ps aux | grep malware
kill -9 <pid>

# 3. 阻断网络连接
iptables -A OUTPUT -d <malicious_ip> -j DROP

# 4. 检查自启动项
systemctl list-unit-files | grep enabled
crontab -l
```

## 阶段四：根除

根除是彻底清除攻击者的所有痕迹，防止复发。

### 根除步骤

```java
// 根除工作清单
public class EradicationChecklist {
    // 1. 清除恶意软件
    void removeMalware() {
        // 使用杀毒软件全盘扫描
        // 手动删除残余文件
        // 检查启动项
        // 检查计划任务
        // 检查服务
        // 检查注册表（Windows）
    }
    
    // 2. 修复漏洞
    void fixVulnerabilities() {
        // 分析攻击利用的漏洞
        // 确认漏洞已被修复
        // 验证修复有效
    }
    
    // 3. 修复配置
    void fixConfigurations() {
        // 关闭不必要的服务
        // 加强访问控制
        // 重置泄露的凭证
        // 收紧防火墙规则
    }
    
    // 4. 重置凭证
    void resetCredentials() {
        // 重置所有可能泄露的密码
        // 撤销所有可疑的证书
        // 重新生成密钥
        // 检查是否有新增的后门账号
    }
}
```

### 彻底性验证

```bash
# 验证根除是否彻底
# 1. 恶意软件扫描
# 使用多个杀毒软件交叉扫描
powershell -Command "Update-MpSignature"
Start-MpScan -ScanType FullScan

# 2. 内存检查
# 确认没有隐藏的恶意进程
./volatility -f memdump.raw pslist
./volatility -f memdump.raw malfind

# 3. 网络检查
# 确认没有可疑的网络连接
netstat -anp | grep ESTABLISHED
ss -tunap

# 4. 计划任务检查
# 确认没有新的计划任务
schtasks /query /fo LIST /v

# 5. 日志检查
# 确认日志完整性
wevtutil qe Security /c:1000 /f:text | grep -i suspicious
```

## 阶段五：恢复

恢复是将系统恢复到正常运行状态。

### 恢复决策

```java
// 恢复策略选择
public class RecoveryStrategy {
    enum RecoveryType {
        // 从备份恢复
        FROM_BACKUP {
            void execute() {
                // 确认备份未被感染
                // 确认备份完整性
                // 恢复数据
                // 验证业务功能
            }
        },
        
        // 系统重装
        REINSTALL {
            void execute() {
                // 格式化磁盘
                // 重新安装操作系统
                // 应用所有安全补丁
                // 从备份恢复业务数据
            }
        },
        
        // 继续运行
        CONTINUE {
            void execute() {
                // 仅修复漏洞
                // 加强监控
                // 业务不中断
                // 风险：可能存在未知后门
            }
        }
    }
    
    // 决策因素
    void decideRecoveryType() {
        // 1. 数据完整性要求
        // 2. 业务中断容忍度
        // 3. 根除的彻底性
        // 4. 备份的可用性
    }
}
```

### 恢复步骤

```bash
# 系统恢复步骤

# 1. 准备恢复环境
# - 准备干净的安装介质
# - 准备最新的安全补丁
# - 准备业务恢复脚本

# 2. 系统恢复
# - 格式化系统盘
# - 重新安装操作系统
# - 安装所有安全更新

# 3. 安全加固
# - 配置防火墙
# - 安装 EDR/杀毒软件
# - 配置日志审计

# 4. 业务恢复
# - 恢复应用
# - 恢复数据
# - 恢复配置

# 5. 验证
# - 功能测试
# - 安全测试
# - 压力测试
```

## 阶段六：回顾

事后复盘是提升应急响应能力的关键。

### 复盘报告模板

```markdown
# 安全事件复盘报告

## 事件概述
- 事件名称：XXX 安全事件
- 发生时间：2024-XX-XX
- 发现时间：2024-XX-XX
- 响应完成时间：2024-XX-XX
- 影响范围：XX 系统，XX 用户
- 损失评估：XX 万元

## 时间线
| 时间 | 事件 | 处理人 | 说明 |
|-----|------|-------|------|
| 09:00 | 攻击发生 | - | 钓鱼邮件投递 |
| 09:15 | 用户中招 | 小王 | 打开附件 |
| 10:30 | 发现异常 | 安全监控 | 触发告警 |
| 10:35 | 响应启动 | 应急团队 | 确认事件 |
| 10:45 | 隔离完成 | 技术组 | 受影响系统断网 |
| 14:00 | 根除完成 | 技术组 | 清除恶意软件 |
| 18:00 | 恢复完成 | 恢复组 | 系统恢复上线 |
| 18:30 | 复盘启动 | 应急负责人 | 事后分析 |

## 根因分析

### 直接原因
钓鱼邮件绕过邮件网关，附件为恶意宏文档

### 根本原因
1. 邮件网关规则未覆盖新型恶意文档
2. 员工安全意识不足，未识别钓鱼邮件
3. 内网隔离不足，勒索病毒快速横向传播

### 教训
1. 需要增强邮件安全网关检测能力
2. 需要定期进行员工安全意识培训
3. 内网分段需要进一步细化

## 改进措施

| 措施 | 负责部门 | 完成时间 | 状态 |
|-----|---------|---------|------|
| 升级邮件网关 | 安全部 | 2 周内 | 进行中 |
| 安全意识培训 | 人力资源 | 1 个月内 | 待启动 |
| 内网分段改造 | 运维部 | 3 个月内 | 待启动 |
</parameter>
```

## 总结

应急响应是一场与时间的赛跑。

**核心要点回顾：**

1. **预案先行**：平时多准备，战时少慌乱
2. **快速隔离**：第一时间阻止攻击扩散
3. **精准分析**：搞清楚「敌人是谁，从哪里来，要去哪里」
4. **彻底根除**：不留后患，不能让攻击卷土重来
5. **持续改进**：每次事件都是学习的机会

> 没有绝对的安全，但有越来越好的准备。


## 面试追问方向

- 应急响应团队的组成是怎样的？
- 如何判断是否需要断网？
- 发现零日漏洞利用时如何处理？
- 如何保证应急响应过程中的证据完整性？
- 事件报告应该包含哪些内容？
