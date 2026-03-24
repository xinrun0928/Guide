# 日志安全分析

> 「攻击者的痕迹会留在日志里，就像脚印留在雪地里。」

日志是安全事件调查最重要的证据来源。一次成功的入侵，攻击者可能会修改数据、窃取信息，但很少能完全清除所有日志痕迹。

日志安全分析（Log Analysis）是 SIEM 的核心能力，也是安全运营的基础技能。

## 日志基础

### 日志是什么

日志是系统和应用程序在运行过程中产生的记录信息。它记录了「谁在什么时候做了什么」。

```java
// 一条典型的 Web 访问日志
public class LogExample {
    // Apache/Nginx 访问日志格式
    String apacheLogFormat = 
        '%h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-Agent}i"';
    // 解析后：
    String remoteHost = "192.168.1.100";    // 客户端 IP
    String remoteLogName = "-";              // 登录名（通常为 -）
    String user = "-";                       // 认证用户
    String time = "[10/Oct/2024:13:55:36 -0700]";  // 时间
    String request = "GET /admin/index.html HTTP/1.1";  // 请求
    String status = "200";                   // 状态码
    String bytesSent = "2326";               // 发送字节数
    String referer = "https://google.com";   // 来源页面
    String userAgent = "Mozilla/5.0...";     // 浏览器标识
}
```

### 日志类型

| 日志类型 | 内容 | 位置 | 安全价值 |
|---------|------|------|---------|
| 访问日志 | HTTP 请求记录 | Web 服务器 | 检测扫描、异常请求 |
| 错误日志 | 应用程序错误 | 应用服务器 | 发现漏洞利用 |
| 安全日志 | 登录/登出/权限操作 | 操作系统/应用 | 检测暴力破解、特权提升 |
| 数据库日志 | SQL 操作记录 | 数据库 | 检测 SQL 注入、数据窃取 |
| DNS 日志 | 域名解析记录 | DNS 服务器 | 检测 C2 通信、隧道 |
| 防火墙日志 | 网络流量记录 | 防火墙/IDS | 检测恶意流量 |
| 系统日志 | 系统事件 | 操作系统 | 检测系统异常 |

## 日志收集与管理

### 日志收集架构

```
┌──────────────────────────────────────────────────────────────┐
│                    日志源                                    │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────┤
│ Web 服务器│ 应用服务器│ 数据库   │ 操作系统 │ 防火墙   │ 终端 │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┘
     │          │          │          │          │
     └──────────┴──────────┼──────────┴──────────┘
                           │
                    ┌──────┴──────┐
                    │  日志收集器  │
                    │ Filebeat   │
                    │ Fluentd    │
                    │ Logstash   │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  日志存储    │
                    │ Elasticsearch│
                    │  LogScale   │
                    │ Splunk      │
                    └─────────────┘
```

### 日志收集工具

**1. Filebeat（轻量级日志收集器）**

```yaml
# filebeat.yml 配置示例
filebeat.inputs:
  # Web 服务器日志
  - type: log
    enabled: true
    paths:
      - /var/log/nginx/access.log
    fields:
      service: nginx
      environment: production

  # 应用日志
  - type: log
    enabled: true
    paths:
      - /var/log/myapp/*.log
    fields:
      service: myapp
      environment: production

# 输出到 Elasticsearch
output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "logs-%{[fields.service]}-%{+yyyy.MM.dd}"

# 关联 Kubernetes 元数据
processors:
  - add_kubernetes_metadata:
      host: ${NODE_NAME}
      matchers:
        - logs_path:
            logs_path: "/var/log/containers/"
```

**2. Logstash（强大的日志处理管道）**

```ruby
# logstash pipeline 配置
input {
  beats {
    port => 5044
  }
  tcp {
    port => 5000
    codec => json
  }
}

filter {
  # 解析 Apache 日志
  if [fields][service] == "nginx" {
    grok {
      match => { 
        "message" => '%{IPORHOST:[nginx][access][remote_ip]} - %{DATA:[nginx][access][user_name]} \[%{HTTPDATE:[nginx][access][time]}\] "%{WORD:[nginx][access][method]} %{DATA:[nginx][access][url]} HTTP/%{NUMBER:[nginx][access][http_version]}" %{NUMBER:[nginx][access][response_code]} %{NUMBER:[nginx][access][body_sent][bytes]} "%{DATA:[nginx][access][referrer]}" "%{DATA:[nginx][access][user_agent]}"'
      }
    }
    date {
      match => [ "[nginx][access][time]", "dd/MMM/yyyy:HH:mm:ss Z" ]
      target => "@timestamp"
    }
  }

  # 检测异常：SQL 注入特征
  if [url] =~ /(\%27)|(\')|(\-\-)|(\%23)/ {
    mutate {
      add_tag => ["sqli-attempt"]
      add_field => { "alert_level" => "high" }
    }
  }

  # 检测异常：目录遍历
  if [url] =~ /(\.\.\/)|(\.\.\\)/ {
    mutate {
      add_tag => ["path-traversal-attempt"]
    }
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "logs-%{[@metadata][beat]}-%{+YYYY.MM.dd}"
  }
}
```

## SIEM 系统

### SIEM 是什么

SIEM（Security Information and Event Management）是安全信息和事件管理的缩写。它将分散在各处的日志集中起来，进行关联分析，发现安全威胁。

**SIEM 的核心能力：**

1. **日志收集**：从各种来源收集日志
2. **规范化**：将不同格式的日志转换为统一格式
3. **存储**：海量日志的存储和检索
4. **关联分析**：发现单个日志无法识别的攻击模式
5. **告警**：实时发现安全事件
6. **可视化**：直观展示安全态势

### 主流 SIEM 产品

| 产品 | 类型 | 特点 |
|-----|------|------|
| Splunk | 商业 | 功能强大，生态完善，价格昂贵 |
| Elastic Security | 开源/商业 | 基于 Elasticsearch，免费易用 |
| IBM QRadar | 商业 | 企业级，稳定性高 |
| Azure Sentinel | 云服务 | 微软云原生 SIEM |
| 阿里云安全中心 | 云服务 | 阿里云环境集成好 |
| 开源 SIEM | 自建 | Wazuh + ELK，灵活可控 |

### Elastic Stack 部署

```yaml
# docker-compose.yml for Elastic Stack
version: '3'
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=true
      - ELASTIC_PASSWORD=elastic_password
    volumes:
      - es_data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"

  logstash:
    image: docker.elastic.co/logstash/logstash:8.11.0
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
    depends_on:
      - elasticsearch

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
      - ELASTICSEARCH_USERNAME=kibana_system
      - ELASTICSEARCH_PASSWORD=kibana_password
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

volumes:
  es_data:
```

### Kibana 安全仪表盘

```
安全仪表盘核心视图
┌─────────────────────────────────────────────────────────────┐
│  安全概览                                                    │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│  今日告警    │  待处理事件   │  平均响应时间 │  威胁趋势         │
│    127      │     23      │   15 分钟    │  ▲ 12%          │
├─────────────┴─────────────┴─────────────┴──────────────────┤
│  告警分布地图                                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │        🔴  上海   1,234                                 │    │
│  │        🟡  北京     876                                 │    │
│  │        🟢  深圳     543                                 │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  最近告警列表                                                 │
│  时间          类型            严重性        状态             │
│  14:32:15      SQL注入         高危         处理中           │
│  14:28:03      暴力破解         中危         待处理           │
│  14:15:22      异常登录         低危         已处理           │
└─────────────────────────────────────────────────────────────┘
```

## 威胁检测规则

### 告警规则设计

```java
// 检测规则示例
public class DetectionRules {
    // 1. 暴力破解检测
    // 同一个 IP 在 5 分钟内失败登录超过 10 次
    String bruteForceRule = """
        SELECT src_ip, COUNT(*) as fail_count
        FROM auth_logs
        WHERE event = 'login_failed'
          AND timestamp > NOW() - INTERVAL 5 MINUTE
        GROUP BY src_ip
        HAVING COUNT(*) > 10
        """;
    
    // 2. 权限提升检测
    // 普通用户突然获得管理员权限
    String privilegeEscalationRule = """
        SELECT user_id, COUNT(*) as admin_count
        FROM audit_logs
        WHERE action = 'role_assigned'
          AND new_role = 'admin'
          AND timestamp > NOW() - INTERVAL 1 DAY
        GROUP BY user_id
        """;
    
    // 3. 数据外泄检测
    // 非工作时间大量数据下载
    String dataExfiltrationRule = """
        SELECT user_id, SUM(bytes) as total_bytes
        FROM access_logs
        WHERE action = 'download'
          AND timestamp BETWEEN '22:00' AND '06:00'
        GROUP BY user_id
        HAVING SUM(bytes) > 1000000000  -- 超过 1GB
        """;
    
    // 4. C2 通信检测
    // 异常 DNS 查询模式（如 DNS 隧道）
    String c2DetectionRule = """
        SELECT src_ip, COUNT(DISTINCT query) as unique_domains
        FROM dns_logs
        WHERE timestamp > NOW() - INTERVAL 1 MINUTE
        GROUP BY src_ip
        HAVING COUNT(DISTINCT query) > 50
        """;
}
```

### Sigma 规则

Sigma 是一种通用的告警规则格式，可以在不同 SIEM 之间迁移。

```yaml
# sigma 规则示例：检测可疑 PowerShell 执行
title: Suspicious PowerShell Encoded Command
id: 3e4d1c2b-4a5f-6e7d-8c9a-0b1c2d3e4f5a
status: experimental
description: Detects suspicious encoded PowerShell commands
author: Security Team

logsource:
  product: windows
  service: powershell
  category: engine

detection:
  selection:
    Command|contains:
      - '-EncodedCommand'
      - '-enc '
    # 检测可疑参数
    Command|contains|all:
      - 'http'
      - 'DownloadString'
  condition: selection

fields:
  - Command
  - ComputerName
  - User

falsepositives:
  - Legitimate encoded commands from enterprise tools

level: high
```

### Elastic SIEM 检测规则

```json
// Elastic SIEM 预置检测规则示例
{
  "rule_name": "Potential Remote Code Execution via Java",
  "rule_description": "Detects attempts to exploit Java deserialization vulnerabilities",
  "risk_score": 85,
  "severity": "high",
  "threat_framework": "MITRE ATT&CK",
  "threat_tactic": [
    {
      "id": "TA0004",
      "name": "Privilege Escalation"
    },
    {
      "id": "TA0008",
      "name": "Lateral Movement"
    }
  ],
  "query": {
    "query_string": {
      "query": "process.name: java AND process.args: \"*org.apache.commons.collections.Transformer*\""
    }
  }
}
```

## 威胁情报

### 威胁情报类型

| 类型 | 内容 | 用途 |
|-----|------|------|
| 基础情报 | IP、域名、文件哈希 | IOC 匹配 |
| 战略情报 | 攻击趋势、威胁组织分析 | 安全规划 |
| 战术情报 | 攻击手法、技术细节 | 规则开发 |
| 运营情报 | 实时威胁事件、已确认的入侵 | 应急响应 |

### IOC 威胁情报应用

```java
// 威胁情报 IOC 检测
public class IocDetection {
    // 1. IP 黑名单检测
    void checkIpBlacklist() {
        // 从威胁情报平台获取恶意 IP
        Set<String> maliciousIps = threatIntelApi.getMaliciousIps();
        
        // 检测内网访问恶意 IP
        for (AccessLog log : accessLogs) {
            if (maliciousIps.contains(log.getDstIp())) {
                alert("恶意 IP 访问: " + log.getDstIp());
            }
        }
    }
    
    // 2. 域名检测
    void checkDomainBlacklist() {
        // 检测 DNS 查询是否为恶意域名
        // 常见 C2 域名特征：
        // - 随机字符串域名
        // - DGA（域名生成算法）生成的域名
        // - 知名 C2 框架域名
        
        for (DnsQuery query : dnsQueries) {
            if (isDgaDomain(query.getDomain())) {
                alert("DGA 域名检测: " + query.getDomain());
            }
        }
    }
    
    // 3. 文件哈希检测
    void checkFileHash() {
        // 已知恶意软件哈希
        Set<String> malwareHashes = threatIntelApi.getMalwareHashes();
        
        // 检测上传或下载的可执行文件
        for (FileOperation op : fileOperations) {
            if (malwareHashes.contains(op.getFileHash())) {
                alert("恶意文件: " + op.getFileName());
                quarantineFile(op.getFileId());
            }
        }
    }
}
```

### 威胁情报平台

| 平台 | 类型 | 特点 |
|-----|------|------|
| AlienVault OTX | 免费 + 付费 | 社区活跃，IOC 丰富 |
| VirusTotal | 免费为主 | 文件/URL/IP 多维度检测 |
| 微步在线 | 国内 | 中文界面，本地化 |
| 奇安信威胁情报中心 | 国内 | 威胁组织追踪 |
| 360威胁情报中心 | 国内 | 大数据威胁分析 |

## 日志分析实战

### SQL 注入检测

```python
# 使用 Elasticsearch + Kibana 检测 SQL 注入
# 告警规则

# 1. 异常错误信息
{
  "query": {
    "bool": {
      "must": [
        {"match": {"status": 500}},
        {"wildcard": {"url": "*id=*"}},
        {"regexp": {"response": ".*(sql|syntax|error|oracle|mysql).*"}}
      ]
    }
  }
}

# 2. 异常 SQL 特征
{
  "query": {
    "bool": {
      "should": [
        {"regexp": {"url": ".*(\\%27|\\').*"}},           # 单引号
        {"regexp": {"url": ".*(union|select|insert).*"}}  # SQL 关键字
      ],
      "minimum_should_match": 1
    }
  }
}

# 3. 短时间大量请求
{
  "query": {
    "function_score": {
      "query": {"match_all": {}},
      "functions": [{
        "script_score": {
          "script": {
            "source": "doc['url.keyword'].value.substring(0, 30)"
          }
        }
      }]
    }
  }
}
```

### 横向移动检测

```java
// 横向移动检测特征
public class LateralMovementDetection {
    // 1. 异常 SMB/Windows 管理共享访问
    void detectSmbLateralMovement() {
        // 正常：文件服务器访问
        // 异常：C$、ADMIN$ 默认共享访问
        String[] suspiciousShares = {"C$", "ADMIN$", "IPC$"};
        
        for (SmbAccess access : smbAccesses) {
            if (containsAny(access.getShare(), suspiciousShares)) {
                if (!isKnownAdminHost(access.getSrcIp())) {
                    alert("可疑横向移动: " + access.getSrcIp() + 
                          " -> " + access.getDstHost() + ":" + access.getShare());
                }
            }
        }
    }
    
    // 2. 账户异常使用
    void detectAccountAnomaly() {
        // 服务账户从异常位置登录
        // 同一账户短时间内从不同 IP 登录
        // 禁用账户被启用
    }
    
    // 3. 端口扫描检测
    void detectPortScanning() {
        // 短时间内一个 IP 访问多个端口
        String query = """
            SELECT src_ip, COUNT(DISTINCT dst_port) as port_count
            FROM network_logs
            WHERE timestamp > NOW() - INTERVAL 1 MINUTE
            GROUP BY src_ip
            HAVING COUNT(DISTINCT dst_port) > 20
            """;
    }
}
```

## 总结

日志安全分析是安全运营的基石。

**核心要点回顾：**

1. **日志全覆盖**：关键系统都要开启日志，重要操作都要记录
2. **集中管理**：使用 ELK/Splunk 等工具集中收集和分析日志
3. **关联分析**：单个日志看不全的威胁，关联分析才能发现
4. **规则调优**：告警规则需要不断优化，降低误报，提高检出率
5. **威胁情报**：结合 IOC 情报，提升检测能力

> 最好的安全运营，不是堆砌日志，而是让日志说话。


## 面试追问方向

- 如何设计日志的保留策略？
- SIEM 和 SOC 是什么关系？
- 如何降低误报率？
- 如何检测加密流量中的威胁？
- 威胁情报如何落地到实际检测中？
