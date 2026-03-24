# 网络层安全：OSI 模型的守护者

数据在网络中传输，经历层层协议栈。

从物理层的电信号，到数据链路层的帧，到网络层的 IP 包，再到传输层的 TCP/UDP——每一层都有其安全风险。

**网络层安全**是整个安全体系的基础。

## OSI 模型与安全

```
┌─────────────────────────────────────────────────────────────┐
│                    OSI 七层安全                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  7. 应用层     │  应用层安全：HTTPS、OAuth、JWT            │
│  ─────────────┼─────────────────────────────────────────────│
│  6. 表示层     │  TLS/SSL 加密                             │
│  ─────────────┼─────────────────────────────────────────────│
│  5. 会话层     │  会话管理、Cookie                         │
│  ─────────────┼─────────────────────────────────────────────│
│  4. 传输层     │  端口控制、防火墙、DoS 防护               │
│  ─────────────┼─────────────────────────────────────────────│
│  3. 网络层     │  IPsec、VPN、路由安全                     │
│  ─────────────┼─────────────────────────────────────────────│
│  2. 数据链路层 │  MAC 地址过滤、ARP 安全                   │
│  ─────────────┼─────────────────────────────────────────────│
│  1. 物理层     │  物理安全、电缆保护                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 网络层的主要威胁

### 1. IP 欺骗（IP Spoofing）

伪造 IP 地址：

```
攻击场景：
1. 攻击者发送 IP 包，源地址伪造为目标地址
2. 服务器回复给伪造的源地址
3. 如果攻击者能截获回复（Man-in-the-Middle），可以建立信任关系

防御：
- 入口过滤：ISP 在边界过滤声称来自内部网的包
- IPsec：认证 IP 包源地址
- 验证机制：TCP 序列号、Cookie
```

### 2. 路由攻击

攻击 BGP 路由：

```
BGP 劫持：
1. 攻击者（或被黑的路由器）向其他 AS 通告虚假路由
2. 流量被路由到攻击者控制的 AS
3. 攻击者可以监控、篡改、丢弃流量

真实案例：
- 2008 年巴基斯坦封 YouTube：路由泄漏
- 2018 年 Amazon Route53：DNS 劫持
```

### 3. 网络监听

窃听网络流量：

```
未加密流量：
- HTTP、SMTP、FTP、Telnet 都是明文
- 同一网络的用户可以窃听

防御：
- 使用加密协议（HTTPS、SSH、SFTP）
- VPN 隧道
- 网络分段隔离
```

### 4. 中间人攻击（MITM）

拦截并可能篡改通信：

```
攻击场景：
1. 攻击者置于通信双方之间
2. 双方以为在直接通信
3. 攻击者可以监听、修改数据

经典场景：
- ARP 欺骗 + 数据转发
- SSL Stripping（降级攻击）
- 证书伪造
```

## 网络分段与隔离

### VLAN 隔离

```bash
# Cisco 交换机 VLAN 配置
# 创建 VLAN
vlan 10
 name ServerVLAN
vlan 20
 name UserVLAN
vlan 30
 name GuestVLAN

# 分配端口
interface GigabitEthernet0/1
 switchport mode access
 switchport access vlan 10

# VLAN 间路由（需要三层交换）
interface Vlan10
 ip address 10.10.10.1 255.255.255.0
interface Vlan20
 ip address 10.10.20.1 255.255.255.0

# ACL 限制 VLAN 间访问
ip access-list extended SERVER-ACCESS
 permit tcp 10.10.20.0 0.0.0.255 host 10.10.10.100 eq 443
 permit tcp 10.10.20.0 0.0.0.255 host 10.10.10.100 eq 80
 deny ip any any log
```

### 微隔离

```
传统分段：子网级别隔离
微隔离：工作负载级别隔离

微隔离优势：
- 更细粒度
- 适应云原生环境
- 东西向流量防护
```

```yaml
# Kubernetes NetworkPolicy 示例
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-network-policy
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
    - from:
        - namespaceSelector:
            matchLabels:
              name: monitoring
      ports:
        - protocol: TCP
          port: 9090
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: database
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: TCP
          port: 53
        - protocol: UDP
          port: 53
```

## 网络安全架构

### 分层防御模型

```
┌─────────────────────────────────────────────────────────────┐
│                    网络分层防御                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  互联网                                                     │
│      │                                                      │
│      ▼                                                      │
│  ┌─────────────────┐                                       │
│  │   边界防火墙     │ ← 第一道防线：过滤恶意流量             │
│  │   IDS/IPS       │                                       │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                       │
│  │   DMZ（隔离区） │ ← 公共服务：Web、邮件                  │
│  │   WAF          │ ← 应用层防护                           │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                       │
│  │   内部网络       │ ← 核心系统：数据库、应用                │
│  │   微隔离         │ ← 工作负载级隔离                       │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                       │
│  │   安全管理区     │ ← SIEM、堡垒机、日志服务器              │
│  └─────────────────┘                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 零信任网络架构

```
传统网络：
信任内部网络 ──── 不信任外部网络

零信任网络：
永远不信任，始终验证

核心原则：
1. 永不信任：所有用户、设备、网络都不可信
2. 始终验证：每次访问都需要认证和授权
3. 最小权限：只授予完成任务所需的最小权限
4. 持续监控：实时监控和评估风险
```

## 网络安全监控

### NetFlow/sFlow 分析

```bash
# 配置 NetFlow（Linux）
# 使用 nprobe 或 fprobe
nprobe --interface eth0 \
    --collector 10.0.0.100:2055 \
    --ntopng-instance 1 \
    -v 5

# 查看流量
# 使用 ntopng 或 nfdump
nfdump -r /var/flow/flow.dat -a -s ip
```

### 网络流量异常检测

```java
@Service
public class NetworkAnomalyDetector {
    
    private static final double THRESHOLD_STDDEV = 3.0;  // 3 倍标准差
    
    /**
     * 检测网络流量异常
     */
    public List<NetworkAnomaly> detectAnomalies(NetFlowData data) {
        List<NetworkAnomaly> anomalies = new ArrayList<>();
        
        // 1. 流量大小异常
        if (isAnomalous(data.getBytesPerSecond(), historicalBytesPerSecond)) {
            anomalies.add(new NetworkAnomaly(
                AnomalyType.TRAFFIC_VOLUME,
                data.getSourceIP(),
                "异常流量大小: " + data.getBytesPerSecond()
            ));
        }
        
        // 2. 端口扫描
        if (detectPortScan(data)) {
            anomalies.add(new NetworkAnomaly(
                AnomalyType.PORT_SCAN,
                data.getSourceIP(),
                "检测到端口扫描行为"
            ));
        }
        
        // 3. 协议异常
        if (isSuspiciousProtocol(data)) {
            anomalies.add(new NetworkAnomaly(
                AnomalyType.PROTOCOL_ANOMALY,
                data.getSourceIP(),
                "可疑协议使用"
            ));
        }
        
        return anomalies;
    }
    
    private boolean isAnomalous(double value, List<Double> baseline) {
        double mean = baseline.stream().mapToDouble(d -> d).average().orElse(0);
        double stddev = calculateStdDev(baseline, mean);
        return Math.abs(value - mean) > THRESHOLD_STDDEV * stddev;
    }
}
```

### 完整网络安全监控

```java
@Service
public class SecurityMonitoringService {
    
    @Autowired
    private IDSAlertService idsAlertService;
    
    @Autowired
    private FirewallLogService firewallLogService;
    
    @Autowired
    private NetFlowService netFlowService;
    
    /**
     * 综合安全事件关联分析
     */
    @Scheduled(fixedRate = 60000)  // 每分钟
    public void correlateSecurityEvents() {
        // 1. 收集各类事件
        List<SecurityEvent> events = new ArrayList<>();
        events.addAll(idsAlertService.getRecentAlerts());
        events.addAll(firewallLogService.getBlockedConnections());
        events.addAll(netFlowService.getAnomalies());
        
        // 2. 按时间和源 IP 关联
        Map<String, List<SecurityEvent>> grouped = events.stream()
            .collect(Collectors.groupingBy(e -> 
                e.getTimestamp().toString().substring(0, 16) + ":" + e.getSourceIP()
            ));
        
        // 3. 检测攻击模式
        for (Map.Entry<String, List<SecurityEvent>> entry : grouped.entrySet()) {
            List<SecurityEvent> relatedEvents = entry.getValue();
            
            // 如果同一来源同时有 IDS 告警、多个端口被防火墙拦截
            if (isAttackPattern(relatedEvents)) {
                handleAttackPattern(relatedEvents);
            }
        }
    }
    
    /**
     * 自动响应
     */
    private void handleAttackPattern(List<SecurityEvent> events) {
        String sourceIP = events.get(0).getSourceIP();
        
        // 1. 封禁 IP
        firewallService.blockIP(sourceIP);
        
        // 2. 通知安全团队
        alertService.sendCriticalAlert(
            "检测到攻击模式: " + sourceIP,
            events
        );
        
        // 3. 记录事件
        attackEventRepository.save(AttackEvent.builder()
            .sourceIP(sourceIP)
            .events(events)
            .timestamp(LocalDateTime.now())
            .build());
    }
}
```

## 网络安全最佳实践

### 1. 网络架构设计

```
✅ 好的实践：
- 分层防御
- 网络分段
- 最小权限访问
- 冗余设计

❌ 避免：
- 扁平网络
- 过度信任
- 单点故障
```

### 2. 访问控制

```
边界访问：
- 只开放必要端口
- 使用强认证
- 启用 MFA

内部访问：
- 网络分段
- 微隔离
- 最小权限
```

### 3. 监控与响应

```
监控：
- 全流量监控
- 实时告警
- 日志集中

响应：
- 自动封禁
- 事件关联
- 事后分析
```

## 面试追问方向

1. **网络层和应用层安全的区别？** —— 网络层在 IP 层面防护，应用层在 HTTP 等协议层面防护
2. **为什么需要网络分段？** —— 限制攻击扩散，即使一个系统被攻破也不影响其他系统
3. **VLAN 能否完全隔离网络？** —— 不能，需要配合防火墙才能真正隔离
4. **什么是东西向流量？** —— 内部网络之间的流量，与南北向流量（进出网络）相对
5. **如何检测网络扫描？** —— 监控连接同一目标的端口数量、连接频率

> "网络安全是纵深防御的艺术。每一层都有其价值，没有银弹，只有层层的防线。"
