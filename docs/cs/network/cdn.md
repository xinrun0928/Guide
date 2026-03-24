# CDN 原理与缓存策略

你有没有想过：为什么打开一个视频网站，全球各地的用户都能快速加载？

答案是 **CDN（Content Delivery Network）**——内容分发网络。

CDN 是现代互联网的基础设施，了解它的原理，对性能优化和架构设计至关重要。

## 为什么需要 CDN？

### 没有 CDN 的问题

```
用户分布：
北京 ────────────────────────────────> 服务器（广州）
用户 A（距离 2000km）
延迟：约 50-100ms

上海 ─────────────────────────────────> 服务器（广州）
用户 B（距离 1500km）
延迟：约 40-80ms

美国 ───────────────────────────────────────> 服务器（广州）
用户 C（距离 10000km）
延迟：约 200-300ms

问题：
1. 跨洲延迟高
2. 服务器压力大
3. 网络拥塞
4. 单点故障
```

### CDN 的解决方案

```
CDN 的核心思想：
把内容「放到」离用户最近的地方

没有 CDN：
用户 ───────────────────────────────> 源站

有 CDN：
用户 ──> CDN 边缘节点 ──> 源站
（近）         （可能有缓存）

效果：
- 北京用户 → 北京 CDN 节点（10ms）
- 上海用户 → 上海 CDN 节点（10ms）
- 美国用户 → 美国 CDN 节点（10ms）
```

## CDN 工作原理

### 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                       CDN 架构                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    全局负载均衡器（GSLB）                    │
│                           │                                 │
│        ┌──────────────────┼──────────────────┐           │
│        │                  │                  │           │
│        ▼                  ▼                  ▼           │
│   ┌─────────┐        ┌─────────┐        ┌─────────┐     │
│   │边缘节点 │        │边缘节点 │        │边缘节点 │     │
│   │(北京)   │        │(上海)   │        │(广州)   │     │
│   └─────────┘        └─────────┘        └─────────┘     │
│        │                  │                  │           │
│        └──────────────────┼──────────────────┘           │
│                           │                             │
│                           ▼                             │
│                    ┌─────────────┐                       │
│                    │   源站      │                       │
│                    │ (原始服务器) │                       │
│                    └─────────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 请求流程

```
┌─────────────────────────────────────────────────────────────┐
│                      CDN 请求流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 用户请求                                              │
│     用户浏览器 → CDN 域名（cdn.example.com）               │
│                                                             │
│  2. DNS 解析到最近节点                                     │
│     DNS → 根据用户 IP 返回最近 CDN 节点 IP                  │
│                                                             │
│  3. CDN 节点处理                                          │
│                                                             │
│     缓存命中：                                             │
│     节点直接返回内容                                       │
│                                                             │
│     缓存未命中：                                           │
│     节点 → 源站获取内容 → 缓存 → 返回用户                  │
│                                                             │
│  4. 响应用户                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 缓存命中流程

```
用户浏览器
     │
     │ GET /static/app.js
     ▼
┌─────────────┐
│ CDN 边缘节点 │
│ (北京)      │
└──────┬──────┘
       │
       │ 缓存中有 app.js 吗？
       │
       ├─ 有 → 返回 app.js（缓存命中）
       │
       └─ 没有 → 向源站请求 app.js
                     │
                     ▼
              ┌─────────────┐
              │   源站      │
              └──────┬──────┘
                     │
                     │ 返回 app.js
                     ▼
              缓存到 CDN 节点
                     │
                     ▼
              返回给用户
```

## CDN 关键技术

### 1. 就近访问（Anycast）

```
原理：同一个 IP 在全球多个地点广播

用户 A（上海）→ 路由到最近的上海节点
用户 B（东京）→ 路由到最近的东京节点
用户 C（旧金山）→ 路由到最近的硅谷节点

所有请求都发送到同一个 CDN 域名，但自动路由到最近节点
```

### 2. DNS 智能解析

```
传统 DNS：
example.com → 固定 IP

CDN DNS：
example.com → 根据用户 IP 返回不同 IP
- 北京用户 → 北京节点 IP
- 上海用户 → 上海节点 IP
- 海外用户 → 海外节点 IP
```

### 3. 缓存策略

```
缓存时间（TTL）控制：

资源类型     │ TTL     │ 说明
────────────┼─────────┼────────────────────────
HTML        │ 5-15min │ 经常更新
CSS/JS      │ 1-24h  │ 版本管理时用指纹
图片        │ 1-7d   │ 静态资源
视频        │ 7-30d  │ 大文件
字体        │ 30d+   │ 基本不变
```

### 4. 源站保护

```
CDN 不只是加速，还保护源站：

1. 隐藏源站 IP
   用户只看到 CDN 节点，攻击者找不到源站

2. 负载均衡
   多个 CDN 节点分担流量

3. DDoS 防护
   CDN 有专门防护 DDoS 的基础设施

4. 限速
   CDN 可以限制单 IP 请求频率
```

## 缓存策略详解

### Cache-Control 头部

```
常用指令：
Cache-Control: public          → 可缓存（CDN 可以缓存）
Cache-Control: private         → 私有（只有浏览器缓存）
Cache-Control: no-cache        → 每次都验证
Cache-Control: no-store        → 不缓存
Cache-Control: max-age=3600    → 缓存 1 小时
Cache-Control: s-maxage=86400  → CDN 缓存 1 天
```

### 缓存策略配置

```
┌─────────────────────────────────────────────────────────────┐
│                    缓存策略配置示例                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  静态资源（CSS/JS/图片）：                                    │
│  Cache-Control: public, max-age=31536000, immutable         │
│  └─ 缓存 1 年，文件名带 hash，更新后 URL 变                  │
│                                                             │
│  HTML 页面：                                                  │
│  Cache-Control: no-cache                                    │
│  └─ 每次访问都向 CDN 验证，没有变化就返回 304               │
│                                                             │
│  API 响应：                                                  │
│  Cache-Control: no-store                                    │
│  └─ 不缓存                                                  │
│                                                             │
│  用户相关数据：                                               │
│  Cache-Control: private                                      │
│  └─ 只能浏览器缓存，CDN 不缓存                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 缓存失效机制

```
1. 基于时间
   max-age 过期后自动失效

2. 基于 URL
   文件名包含内容 hash
   app.js → app.a1b2c3d4.js
   更新内容后 hash 变化，URL 变化，相当于新文件

3. 手动刷新
   CDN 控制台手动刷新
   API 调用刷新

4. 版本号
   /v1/api/users
   /v2/api/users
```

### 分层缓存

```
浏览器缓存（Local）
    ↓ 过期或未命中
CDN 边缘节点缓存
    ↓ 过期或未命中
CDN 区域中心缓存
    ↓ 未命中
源站
```

## CDN 边缘计算

### 传统 CDN

```
CDN = 内容分发网络
只能分发静态内容
动态内容必须回源
```

### 现代 CDN（边缘计算）

```
CDN = 内容分发 + 边缘计算
可以在 CDN 节点执行代码

边缘计算场景：
1. A/B 测试
2. 动态内容个性化
3. 请求过滤
4. 图片处理（压缩、格式转换）
5. HTTPS 证书
```

### Cloudflare Workers 示例

```javascript
// Cloudflare Workers 边缘计算
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // 在边缘节点执行
  const url = new URL(request.url)

  // 判断地区，返回不同内容
  const country = request.headers.get('CF-IPCountry')

  if (url.pathname.startsWith('/api/')) {
    // API 请求不过滤
    return fetch(request)
  }

  // HTML 页面添加地区标识
  const response = await fetch(request)
  const text = await response.text()
  const modified = text.replace(
    '<body>',
    `<body><p>您来自: ${country}</p>`
  )

  return new Response(modified, response)
}
```

## 主流 CDN 服务

### 国际 CDN

```
Cloudflare
- 免费套餐可用
- 边缘计算（Workers）
- DDoS 防护强
- 中国大陆访问一般

Akamai
- 最大 CDN 提供商
- 企业级
- 价格昂贵

Fastly
- 实时性配置（Purge API）
- 边缘计算
- VCL 配置语言

AWS CloudFront
- 与 AWS 服务集成
- Lambda@Edge
- CloudFront Functions
```

### 国内 CDN

```
阿里云 CDN
- 阿里云生态
- 价格适中
- 节点多

腾讯云 CDN
- 腾讯云生态
- 游戏加速强

华为云 CDN
- 华为云生态

又拍云
- 专注国内
- 适合中小企业
```

### 选择建议

```
┌─────────────────────────────────────────────────────────────┐
│                      CDN 选择指南                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  个人博客/静态网站：                                          │
│  → Cloudflare（免费）、又拍云（免费额度）                      │
│                                                             │
│  国内业务：                                                  │
│  → 阿里云 CDN、腾讯云 CDN                                   │
│                                                             │
│  海外业务：                                                  │
│  → Cloudflare、Fastly、CloudFront                          │
│                                                             │
│  电商/高并发：                                               │
│  → 多 CDN 组合                                              │
│                                                             │
│  游戏/直播：                                                │
│  → 腾讯云 CDN（游戏加速）                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## CDN 配置示例

### Nginx 配置缓存

```nginx
location /static/ {
    # 静态资源缓存 1 年
    expires 1y;
    add_header Cache-Control "public, immutable";

    # 开启 gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}

location / {
    # HTML 不缓存
    add_header Cache-Control "no-cache, no-store";

    proxy_pass http://backend;
}
```

### Cloudflare 配置

```
1. 添加域名
2. 修改 DNS 指向 Cloudflare
3. 配置 Page Rules（缓存规则）
   - *.example.com/images/* → Cache Everything, Edge Cache TTL: 1 month
   - *.example.com/*.html → Cache Level: Bypass
4. 配置 Edge Certificates（免费 HTTPS）
5. 配置 Speed 优化
```

## 常见问题

### 缓存失效问题

```
问题：更新了文件，但用户还是看到旧版本

原因：CDN 缓存还没过期

解决：
1. 使用文件名 hash
2. 缩短 TTL
3. 手动刷新 CDN
```

### 缓存不一致问题

```
问题：不同节点返回不同内容

原因：缓存正在更新

解决：
1. 预热热门资源
2. 灰度发布
3. 缓存版本隔离
```

### CORS 问题

```
问题：跨域请求被 CDN 拒绝

原因：CDN 节点需要配置 CORS 头部

解决：
1. CDN 控制台配置 CORS
2. 源站返回 CORS 头部，CDN 透传
```

## 面试追问方向

- CDN 是什么？它解决了什么问题？
- CDN 的工作原理是什么？
- 什么是 Anycast？它是如何工作的？
- CDN 缓存策略是如何配置的？
- 什么是 Cache-Control？有哪些常用指令？
- CDN 如何保护源站？
- 什么是边缘计算？有哪些应用场景？
- 缓存失效后会发生什么？
- 如何选择 CDN 服务？
- CDN 有哪些常见问题？如何解决？
