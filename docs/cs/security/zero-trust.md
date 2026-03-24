# 零信任：永不信任，始终验证

传统的安全模型是**城堡式防御**：

```
                    ┌─────────────────────┐
                    │      企业网络        │
                    │  ┌───────────────┐  │
                    │  │   内部系统    │  │
                    │  │  （信任区域） │  │
                    │  └───────────────┘  │
                    │         ↑           │
                    │    防火墙过滤        │
                    └─────────────────────┘
                              ↑
                    ┌─────────────────────┐
                    │      外部网络       │
                    │   （不信任区域）    │
                    └─────────────────────┘
```

一旦突破防火墙进入内部网络，攻击者就可以横向移动，「内部人员」更是天然被信任。

**零信任（Zero Trust）** 的核心思想是：**永不信任，始终验证**。

## 零信任的核心理念

### 传统安全 vs 零信任

| 传统安全 | 零信任 |
|---------|--------|
| 信任内部网络 | 永不信任任何网络 |
| 城堡式边界 | 无边界安全 |
| 用户认证一次 | 持续验证 |
| 静态访问控制 | 动态风险评估 |
| 隐式授权 | 最小权限原则 |

### 零信任的三大原则

```
1. 永不信任（Never Trust）
   - 不信任任何用户、设备、网络
   - 每次访问都需要验证

2. 始终验证（Always Verify）
   - 验证身份、设备安全状态、应用风险
   - 多因素认证（MFA）

3. 最小权限（Least Privilege）
   - 仅授予完成任务所需的最小权限
   - 细粒度访问控制
```

## 零信任的架构

### ZTA（Zero Trust Architecture）

```
┌─────────────────────────────────────────────────────────────┐
│                     零信任架构                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│    ┌─────────────────────────────────────────────┐         │
│    │              策略决策引擎（PDP）              │         │
│    │         Policy Decision Point               │         │
│    │  ┌─────────────────────────────────────────┐│         │
│    │  │ 身份策略 │ 设备策略 │ 风险评估 │ 合规  ││         │
│    │  └─────────────────────────────────────────┘│         │
│    └──────────────────────┬────────────────────────┘         │
│                          │                                   │
│    ┌─────────────────────┼─────────────────────┐            │
│    │                     │                     │            │
│    ▼                     ▼                     ▼            │
│ ┌──────────┐      ┌──────────┐        ┌──────────┐        │
│ │ 身份提供商 │      │ 设备管理器 │        │ 资源服务  │        │
│ │  (IdP)   │      │ (MDM)    │        │ (微服务)  │        │
│ └────┬─────┘      └────┬─────┘        └────┬─────┘        │
│      │                  │                   │               │
│      └──────────────────┼───────────────────┘               │
│                         │                                    │
│    ┌────────────────────┼────────────────────┐             │
│    │                    │                    │             │
│    ▼                    ▼                    ▼             │
│ ┌─────────┐         ┌─────────┐        ┌─────────┐        │
│ │  用户   │         │  设备   │        │  资源   │        │
│ │         │         │         │        │         │        │
│ └─────────┘         └─────────┘        └─────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件

1. **PEP（Policy Enforcement Point）**：策略执行点，拦截访问请求
2. **PDP（Policy Decision Point）**：策略决策引擎，决定是否允许访问
3. **IdP（Identity Provider）**：身份提供者，身份认证
4. **CDM（Continuous Diagnostics and Mitigation）**：持续诊断与缓解

## 零信任的实现：BeyondCorp

Google 的 BeyondCorp 是零信任的典型实践：

```
传统办公：
    用户 → VPN → 公司网络 → 应用
    （在网络中是可信的）

BeyondCorp：
    用户 → 访问代理 → 资源
    （每次访问都经过验证）
```

### BeyondCorp 的组件

```
┌─────────────────────────────────────────────────────────────┐
│                    BeyondCorp 架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐                                           │
│   │  用户认证   │ ←────── 访问请求 ────── 用户               │
│   └──────┬──────┘                                           │
│          │                                                   │
│          ▼                                                   │
│   ┌─────────────┐                                           │
│   │ 设备认证    │ ←────── 设备清单 ──── MDM                  │
│   └──────┬──────┘                                           │
│          │                                                   │
│          ▼                                                   │
│   ┌─────────────┐                                           │
│   │ 访问策略    │ ←────── 资源目录 ──── 配置管理              │
│   └──────┬──────┘                                           │
│          │                                                   │
│          ▼                                                   │
│   ┌─────────────┐                                           │
│   │ 访问代理    │ ←────── 允许访问 ────── 应用                 │
│   └─────────────┘                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 零信任的 Java 实现

### 1. 持续身份验证

```java
@Service
public class ZeroTrustAuthService {
    
    @Autowired
    private RiskAssessmentService riskService;
    
    @Autowired
    private DeviceService deviceService;
    
    /**
     * 评估访问请求的风险
     */
    public AccessDecision evaluateAccess(AccessRequest request) {
        RiskScore score = new RiskScore();
        
        // 1. 身份验证强度
        int authScore = evaluateAuthStrength(request);
        score.addScore("auth", authScore);
        
        // 2. 设备安全状态
        int deviceScore = evaluateDeviceSecurity(request);
        score.addScore("device", deviceScore);
        
        // 3. 位置风险
        int locationScore = evaluateLocationRisk(request);
        score.addScore("location", locationScore);
        
        // 4. 行为异常
        int behaviorScore = evaluateBehavior(request);
        score.addScore("behavior", behaviorScore);
        
        // 5. 时间风险
        int timeScore = evaluateTimeRisk(request);
        score.addScore("time", timeScore);
        
        // 综合评分
        int totalScore = score.calculateTotal();
        
        // 根据风险级别决定访问策略
        if (totalScore >= 80) {
            return AccessDecision.ALLOW;  // 低风险，直接放行
        } else if (totalScore >= 60) {
            return AccessDecision.ALLOW_WITH_MFA;  // 中风险，需要 MFA
        } else if (totalScore >= 40) {
            return AccessDecision.ALLOW_WITH_MONITORING;  // 高风险，记录日志
        } else {
            return AccessDecision.DENY;  // 极高风险，拒绝访问
        }
    }
    
    /**
     * 设备安全评估
     */
    private int evaluateDeviceSecurity(AccessRequest request) {
        DeviceInfo device = request.getDevice();
        
        int score = 100;
        
        // 检查设备是否注册
        if (!deviceService.isManaged(device)) {
            score -= 30;
        }
        
        // 检查系统是否更新
        if (!deviceService.isOSUpToDate(device)) {
            score -= 20;
        }
        
        // 检查是否有杀毒软件
        if (!deviceService.hasAntiVirus(device)) {
            score -= 20;
        }
        
        // 检查磁盘是否加密
        if (!deviceService.isDiskEncrypted(device)) {
            score -= 15;
        }
        
        return Math.max(0, score);
    }
}
```

### 2. 动态访问控制

```java
@Component
public class PolicyEnforcementPoint {
    
    @Autowired
    private ZeroTrustAuthService authService;
    
    @Autowired
    private AuditLogService auditLog;
    
    /**
     * 拦截并验证每个请求
     */
    public void enforce(HttpServletRequest request, HttpServletResponse response) 
            throws IOException {
        
        // 1. 构建访问请求
        AccessRequest accessRequest = AccessRequest.builder()
            .user(getCurrentUser(request))
            .device(getDeviceInfo(request))
            .resource(request.getRequestURI())
            .method(request.getMethod())
            .ipAddress(getClientIP(request))
            .timestamp(Instant.now())
            .build();
        
        // 2. 评估访问决策
        AccessDecision decision = authService.evaluateAccess(accessRequest);
        
        // 3. 执行决策
        switch (decision) {
            case ALLOW:
                // 记录审计日志
                auditLog.logAccess(accessRequest, decision);
                break;
                
            case ALLOW_WITH_MFA:
                // 需要额外的 MFA 验证
                if (!verifyMFA(request)) {
                    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                    response.getWriter().write("需要额外验证");
                    return;
                }
                auditLog.logAccess(accessRequest, decision);
                break;
                
            case ALLOW_WITH_MONITORING:
                // 记录并加强监控
                auditLog.logAccessWithAlert(accessRequest, decision);
                break;
                
            case DENY:
                auditLog.logAccessWithAlert(accessRequest, decision);
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.getWriter().write("访问被拒绝");
                return;
        }
        
        // 继续处理请求
        filterChain.doFilter(request, response);
    }
}
```

### 3. 服务间认证（mTLS）

```java
@Configuration
public class MtlsConfig {
    
    /**
     * 配置双向 TLS
     */
    @Bean
    public RestTemplate mtlsRestTemplate() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        keyStore.load(
            new FileInputStream("/path/to/client.p12"),
            "keystorePassword".toCharArray()
        );
        
        TrustStore trustStore = KeyStore.getInstance("PKCS12");
        trustStore.load(
            new FileInputStream("/path/to/ca.p12"),
            "truststorePassword".toCharArray()
        );
        
        SSLContext sslContext = SSLContexts.custom()
            .loadKeyMaterial(keyStore, "keyPassword".toCharArray())
            .loadTrustMaterial(trustStore, new TrustStrategy() {
                @Override
                public boolean isTrusted(X509Certificate[] chain, String authType) 
                        throws CertificateException {
                    // 验证服务证书
                    return true;
                }
            })
            .build();
        
        CloseableHttpClient httpClient = HttpClients.custom()
            .setSSLContext(sslContext)
            .build();
        
        return new RestTemplateBuilder()
            .httpClient(httpClient)
            .build();
    }
}
```

## 零信任的实施路径

### 第一阶段：可见性
- 识别所有用户、设备、应用
- 建立资产清单
- 部署日志收集

### 第二阶段：分段
- 网络微分段
- 应用层访问控制
- 最小权限原则

### 第三阶段：零信任
- 持续验证
- 动态策略
- 自动化响应

## 面试追问方向

1. **零信任和传统安全的区别？** —— 传统安全信任内网，零信任永不信任任何网络
2. **BeyondCorp 是什么？** —— Google 实践的零信任模型，核心是访问代理取代 VPN
3. **为什么零信任越来越重要？** —— 远程办公、云服务、边界模糊化导致传统边界安全失效
4. **零信任的关键技术？** —— 身份即服务、设备信任、持续验证、微隔离
5. **实施零信任的挑战？** —— 改造成本、用户体验、遗留系统

> "零信任不是一种产品，而是一种安全理念。理解它的核心思想，才能在这个无边界的安全时代构建真正的防御。"
