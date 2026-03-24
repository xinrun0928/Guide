import{_ as n,o as a,c as p,ak as l}from"./chunks/framework.DwHlt8HN.js";const k=JSON.parse('{"title":"CDN 原理与缓存策略","description":"","frontmatter":{},"headers":[],"relativePath":"cs/network/cdn.md","filePath":"cs/network/cdn.md","lastUpdated":1774353797000}'),i={name:"cs/network/cdn.md"};function e(r,s,c,b,h,t){return a(),p("div",null,[...s[0]||(s[0]=[l(`<h1 id="cdn-原理与缓存策略" tabindex="-1">CDN 原理与缓存策略 <a class="header-anchor" href="#cdn-原理与缓存策略" aria-label="Permalink to “CDN 原理与缓存策略”">​</a></h1><p>你有没有想过：为什么打开一个视频网站，全球各地的用户都能快速加载？</p><p>答案是 <strong>CDN（Content Delivery Network）</strong>——内容分发网络。</p><p>CDN 是现代互联网的基础设施，了解它的原理，对性能优化和架构设计至关重要。</p><h2 id="为什么需要-cdn" tabindex="-1">为什么需要 CDN？ <a class="header-anchor" href="#为什么需要-cdn" aria-label="Permalink to “为什么需要 CDN？”">​</a></h2><h3 id="没有-cdn-的问题" tabindex="-1">没有 CDN 的问题 <a class="header-anchor" href="#没有-cdn-的问题" aria-label="Permalink to “没有 CDN 的问题”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>用户分布：</span></span>
<span class="line"><span>北京 ────────────────────────────────&gt; 服务器（广州）</span></span>
<span class="line"><span>用户 A（距离 2000km）</span></span>
<span class="line"><span>延迟：约 50-100ms</span></span>
<span class="line"><span></span></span>
<span class="line"><span>上海 ─────────────────────────────────&gt; 服务器（广州）</span></span>
<span class="line"><span>用户 B（距离 1500km）</span></span>
<span class="line"><span>延迟：约 40-80ms</span></span>
<span class="line"><span></span></span>
<span class="line"><span>美国 ───────────────────────────────────────&gt; 服务器（广州）</span></span>
<span class="line"><span>用户 C（距离 10000km）</span></span>
<span class="line"><span>延迟：约 200-300ms</span></span>
<span class="line"><span></span></span>
<span class="line"><span>问题：</span></span>
<span class="line"><span>1. 跨洲延迟高</span></span>
<span class="line"><span>2. 服务器压力大</span></span>
<span class="line"><span>3. 网络拥塞</span></span>
<span class="line"><span>4. 单点故障</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br></div></div><h3 id="cdn-的解决方案" tabindex="-1">CDN 的解决方案 <a class="header-anchor" href="#cdn-的解决方案" aria-label="Permalink to “CDN 的解决方案”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>CDN 的核心思想：</span></span>
<span class="line"><span>把内容「放到」离用户最近的地方</span></span>
<span class="line"><span></span></span>
<span class="line"><span>没有 CDN：</span></span>
<span class="line"><span>用户 ───────────────────────────────&gt; 源站</span></span>
<span class="line"><span></span></span>
<span class="line"><span>有 CDN：</span></span>
<span class="line"><span>用户 ──&gt; CDN 边缘节点 ──&gt; 源站</span></span>
<span class="line"><span>（近）         （可能有缓存）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>效果：</span></span>
<span class="line"><span>- 北京用户 → 北京 CDN 节点（10ms）</span></span>
<span class="line"><span>- 上海用户 → 上海 CDN 节点（10ms）</span></span>
<span class="line"><span>- 美国用户 → 美国 CDN 节点（10ms）</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br></div></div><h2 id="cdn-工作原理" tabindex="-1">CDN 工作原理 <a class="header-anchor" href="#cdn-工作原理" aria-label="Permalink to “CDN 工作原理”">​</a></h2><h3 id="核心架构" tabindex="-1">核心架构 <a class="header-anchor" href="#核心架构" aria-label="Permalink to “核心架构”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                       CDN 架构                               │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│                    全局负载均衡器（GSLB）                    │</span></span>
<span class="line"><span>│                           │                                 │</span></span>
<span class="line"><span>│        ┌──────────────────┼──────────────────┐           │</span></span>
<span class="line"><span>│        │                  │                  │           │</span></span>
<span class="line"><span>│        ▼                  ▼                  ▼           │</span></span>
<span class="line"><span>│   ┌─────────┐        ┌─────────┐        ┌─────────┐     │</span></span>
<span class="line"><span>│   │边缘节点 │        │边缘节点 │        │边缘节点 │     │</span></span>
<span class="line"><span>│   │(北京)   │        │(上海)   │        │(广州)   │     │</span></span>
<span class="line"><span>│   └─────────┘        └─────────┘        └─────────┘     │</span></span>
<span class="line"><span>│        │                  │                  │           │</span></span>
<span class="line"><span>│        └──────────────────┼──────────────────┘           │</span></span>
<span class="line"><span>│                           │                             │</span></span>
<span class="line"><span>│                           ▼                             │</span></span>
<span class="line"><span>│                    ┌─────────────┐                       │</span></span>
<span class="line"><span>│                    │   源站      │                       │</span></span>
<span class="line"><span>│                    │ (原始服务器) │                       │</span></span>
<span class="line"><span>│                    └─────────────┘                       │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br></div></div><h3 id="请求流程" tabindex="-1">请求流程 <a class="header-anchor" href="#请求流程" aria-label="Permalink to “请求流程”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                      CDN 请求流程                           │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  1. 用户请求                                              │</span></span>
<span class="line"><span>│     用户浏览器 → CDN 域名（cdn.example.com）               │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  2. DNS 解析到最近节点                                     │</span></span>
<span class="line"><span>│     DNS → 根据用户 IP 返回最近 CDN 节点 IP                  │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  3. CDN 节点处理                                          │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│     缓存命中：                                             │</span></span>
<span class="line"><span>│     节点直接返回内容                                       │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│     缓存未命中：                                           │</span></span>
<span class="line"><span>│     节点 → 源站获取内容 → 缓存 → 返回用户                  │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  4. 响应用户                                              │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br></div></div><h3 id="缓存命中流程" tabindex="-1">缓存命中流程 <a class="header-anchor" href="#缓存命中流程" aria-label="Permalink to “缓存命中流程”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>用户浏览器</span></span>
<span class="line"><span>     │</span></span>
<span class="line"><span>     │ GET /static/app.js</span></span>
<span class="line"><span>     ▼</span></span>
<span class="line"><span>┌─────────────┐</span></span>
<span class="line"><span>│ CDN 边缘节点 │</span></span>
<span class="line"><span>│ (北京)      │</span></span>
<span class="line"><span>└──────┬──────┘</span></span>
<span class="line"><span>       │</span></span>
<span class="line"><span>       │ 缓存中有 app.js 吗？</span></span>
<span class="line"><span>       │</span></span>
<span class="line"><span>       ├─ 有 → 返回 app.js（缓存命中）</span></span>
<span class="line"><span>       │</span></span>
<span class="line"><span>       └─ 没有 → 向源站请求 app.js</span></span>
<span class="line"><span>                     │</span></span>
<span class="line"><span>                     ▼</span></span>
<span class="line"><span>              ┌─────────────┐</span></span>
<span class="line"><span>              │   源站      │</span></span>
<span class="line"><span>              └──────┬──────┘</span></span>
<span class="line"><span>                     │</span></span>
<span class="line"><span>                     │ 返回 app.js</span></span>
<span class="line"><span>                     ▼</span></span>
<span class="line"><span>              缓存到 CDN 节点</span></span>
<span class="line"><span>                     │</span></span>
<span class="line"><span>                     ▼</span></span>
<span class="line"><span>              返回给用户</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br><span class="line-number">26</span><br></div></div><h2 id="cdn-关键技术" tabindex="-1">CDN 关键技术 <a class="header-anchor" href="#cdn-关键技术" aria-label="Permalink to “CDN 关键技术”">​</a></h2><h3 id="_1-就近访问-anycast" tabindex="-1">1. 就近访问（Anycast） <a class="header-anchor" href="#_1-就近访问-anycast" aria-label="Permalink to “1. 就近访问（Anycast）”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>原理：同一个 IP 在全球多个地点广播</span></span>
<span class="line"><span></span></span>
<span class="line"><span>用户 A（上海）→ 路由到最近的上海节点</span></span>
<span class="line"><span>用户 B（东京）→ 路由到最近的东京节点</span></span>
<span class="line"><span>用户 C（旧金山）→ 路由到最近的硅谷节点</span></span>
<span class="line"><span></span></span>
<span class="line"><span>所有请求都发送到同一个 CDN 域名，但自动路由到最近节点</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br></div></div><h3 id="_2-dns-智能解析" tabindex="-1">2. DNS 智能解析 <a class="header-anchor" href="#_2-dns-智能解析" aria-label="Permalink to “2. DNS 智能解析”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>传统 DNS：</span></span>
<span class="line"><span>example.com → 固定 IP</span></span>
<span class="line"><span></span></span>
<span class="line"><span>CDN DNS：</span></span>
<span class="line"><span>example.com → 根据用户 IP 返回不同 IP</span></span>
<span class="line"><span>- 北京用户 → 北京节点 IP</span></span>
<span class="line"><span>- 上海用户 → 上海节点 IP</span></span>
<span class="line"><span>- 海外用户 → 海外节点 IP</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br></div></div><h3 id="_3-缓存策略" tabindex="-1">3. 缓存策略 <a class="header-anchor" href="#_3-缓存策略" aria-label="Permalink to “3. 缓存策略”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>缓存时间（TTL）控制：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>资源类型     │ TTL     │ 说明</span></span>
<span class="line"><span>────────────┼─────────┼────────────────────────</span></span>
<span class="line"><span>HTML        │ 5-15min │ 经常更新</span></span>
<span class="line"><span>CSS/JS      │ 1-24h  │ 版本管理时用指纹</span></span>
<span class="line"><span>图片        │ 1-7d   │ 静态资源</span></span>
<span class="line"><span>视频        │ 7-30d  │ 大文件</span></span>
<span class="line"><span>字体        │ 30d+   │ 基本不变</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br></div></div><h3 id="_4-源站保护" tabindex="-1">4. 源站保护 <a class="header-anchor" href="#_4-源站保护" aria-label="Permalink to “4. 源站保护”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>CDN 不只是加速，还保护源站：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>1. 隐藏源站 IP</span></span>
<span class="line"><span>   用户只看到 CDN 节点，攻击者找不到源站</span></span>
<span class="line"><span></span></span>
<span class="line"><span>2. 负载均衡</span></span>
<span class="line"><span>   多个 CDN 节点分担流量</span></span>
<span class="line"><span></span></span>
<span class="line"><span>3. DDoS 防护</span></span>
<span class="line"><span>   CDN 有专门防护 DDoS 的基础设施</span></span>
<span class="line"><span></span></span>
<span class="line"><span>4. 限速</span></span>
<span class="line"><span>   CDN 可以限制单 IP 请求频率</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br></div></div><h2 id="缓存策略详解" tabindex="-1">缓存策略详解 <a class="header-anchor" href="#缓存策略详解" aria-label="Permalink to “缓存策略详解”">​</a></h2><h3 id="cache-control-头部" tabindex="-1">Cache-Control 头部 <a class="header-anchor" href="#cache-control-头部" aria-label="Permalink to “Cache-Control 头部”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>常用指令：</span></span>
<span class="line"><span>Cache-Control: public          → 可缓存（CDN 可以缓存）</span></span>
<span class="line"><span>Cache-Control: private         → 私有（只有浏览器缓存）</span></span>
<span class="line"><span>Cache-Control: no-cache        → 每次都验证</span></span>
<span class="line"><span>Cache-Control: no-store        → 不缓存</span></span>
<span class="line"><span>Cache-Control: max-age=3600    → 缓存 1 小时</span></span>
<span class="line"><span>Cache-Control: s-maxage=86400  → CDN 缓存 1 天</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br></div></div><h3 id="缓存策略配置" tabindex="-1">缓存策略配置 <a class="header-anchor" href="#缓存策略配置" aria-label="Permalink to “缓存策略配置”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    缓存策略配置示例                          │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  静态资源（CSS/JS/图片）：                                    │</span></span>
<span class="line"><span>│  Cache-Control: public, max-age=31536000, immutable         │</span></span>
<span class="line"><span>│  └─ 缓存 1 年，文件名带 hash，更新后 URL 变                  │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  HTML 页面：                                                  │</span></span>
<span class="line"><span>│  Cache-Control: no-cache                                    │</span></span>
<span class="line"><span>│  └─ 每次访问都向 CDN 验证，没有变化就返回 304               │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  API 响应：                                                  │</span></span>
<span class="line"><span>│  Cache-Control: no-store                                    │</span></span>
<span class="line"><span>│  └─ 不缓存                                                  │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  用户相关数据：                                               │</span></span>
<span class="line"><span>│  Cache-Control: private                                      │</span></span>
<span class="line"><span>│  └─ 只能浏览器缓存，CDN 不缓存                               │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br></div></div><h3 id="缓存失效机制" tabindex="-1">缓存失效机制 <a class="header-anchor" href="#缓存失效机制" aria-label="Permalink to “缓存失效机制”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>1. 基于时间</span></span>
<span class="line"><span>   max-age 过期后自动失效</span></span>
<span class="line"><span></span></span>
<span class="line"><span>2. 基于 URL</span></span>
<span class="line"><span>   文件名包含内容 hash</span></span>
<span class="line"><span>   app.js → app.a1b2c3d4.js</span></span>
<span class="line"><span>   更新内容后 hash 变化，URL 变化，相当于新文件</span></span>
<span class="line"><span></span></span>
<span class="line"><span>3. 手动刷新</span></span>
<span class="line"><span>   CDN 控制台手动刷新</span></span>
<span class="line"><span>   API 调用刷新</span></span>
<span class="line"><span></span></span>
<span class="line"><span>4. 版本号</span></span>
<span class="line"><span>   /v1/api/users</span></span>
<span class="line"><span>   /v2/api/users</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br></div></div><h3 id="分层缓存" tabindex="-1">分层缓存 <a class="header-anchor" href="#分层缓存" aria-label="Permalink to “分层缓存”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>浏览器缓存（Local）</span></span>
<span class="line"><span>    ↓ 过期或未命中</span></span>
<span class="line"><span>CDN 边缘节点缓存</span></span>
<span class="line"><span>    ↓ 过期或未命中</span></span>
<span class="line"><span>CDN 区域中心缓存</span></span>
<span class="line"><span>    ↓ 未命中</span></span>
<span class="line"><span>源站</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br></div></div><h2 id="cdn-边缘计算" tabindex="-1">CDN 边缘计算 <a class="header-anchor" href="#cdn-边缘计算" aria-label="Permalink to “CDN 边缘计算”">​</a></h2><h3 id="传统-cdn" tabindex="-1">传统 CDN <a class="header-anchor" href="#传统-cdn" aria-label="Permalink to “传统 CDN”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>CDN = 内容分发网络</span></span>
<span class="line"><span>只能分发静态内容</span></span>
<span class="line"><span>动态内容必须回源</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br></div></div><h3 id="现代-cdn-边缘计算" tabindex="-1">现代 CDN（边缘计算） <a class="header-anchor" href="#现代-cdn-边缘计算" aria-label="Permalink to “现代 CDN（边缘计算）”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>CDN = 内容分发 + 边缘计算</span></span>
<span class="line"><span>可以在 CDN 节点执行代码</span></span>
<span class="line"><span></span></span>
<span class="line"><span>边缘计算场景：</span></span>
<span class="line"><span>1. A/B 测试</span></span>
<span class="line"><span>2. 动态内容个性化</span></span>
<span class="line"><span>3. 请求过滤</span></span>
<span class="line"><span>4. 图片处理（压缩、格式转换）</span></span>
<span class="line"><span>5. HTTPS 证书</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br></div></div><h3 id="cloudflare-workers-示例" tabindex="-1">Cloudflare Workers 示例 <a class="header-anchor" href="#cloudflare-workers-示例" aria-label="Permalink to “Cloudflare Workers 示例”">​</a></h3><div class="language-javascript line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">javascript</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// Cloudflare Workers 边缘计算</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">addEventListener</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;fetch&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">event</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =&gt;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> {</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  event.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">respondWith</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">handleRequest</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(event.request))</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">})</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">async</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> function</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> handleRequest</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">request</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">) {</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">  // 在边缘节点执行</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  const</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> url</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> new</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> URL</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(request.url)</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">  // 判断地区，返回不同内容</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  const</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> country</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> request.headers.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">get</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;CF-IPCountry&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">)</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  if</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> (url.pathname.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">startsWith</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;/api/&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">)) {</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    // API 请求不过滤</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    return</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> fetch</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(request)</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">  // HTML 页面添加地区标识</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  const</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> response</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> await</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> fetch</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(request)</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  const</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> text</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> await</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> response.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">text</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">()</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  const</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> modified</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> text.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">replace</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    &#39;&lt;body&gt;&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">,</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    \`&lt;body&gt;&lt;p&gt;您来自: \${</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">country</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">}&lt;/p&gt;\`</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  )</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  return</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> new</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Response</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(modified, response)</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br><span class="line-number">26</span><br><span class="line-number">27</span><br></div></div><h2 id="主流-cdn-服务" tabindex="-1">主流 CDN 服务 <a class="header-anchor" href="#主流-cdn-服务" aria-label="Permalink to “主流 CDN 服务”">​</a></h2><h3 id="国际-cdn" tabindex="-1">国际 CDN <a class="header-anchor" href="#国际-cdn" aria-label="Permalink to “国际 CDN”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>Cloudflare</span></span>
<span class="line"><span>- 免费套餐可用</span></span>
<span class="line"><span>- 边缘计算（Workers）</span></span>
<span class="line"><span>- DDoS 防护强</span></span>
<span class="line"><span>- 中国大陆访问一般</span></span>
<span class="line"><span></span></span>
<span class="line"><span>Akamai</span></span>
<span class="line"><span>- 最大 CDN 提供商</span></span>
<span class="line"><span>- 企业级</span></span>
<span class="line"><span>- 价格昂贵</span></span>
<span class="line"><span></span></span>
<span class="line"><span>Fastly</span></span>
<span class="line"><span>- 实时性配置（Purge API）</span></span>
<span class="line"><span>- 边缘计算</span></span>
<span class="line"><span>- VCL 配置语言</span></span>
<span class="line"><span></span></span>
<span class="line"><span>AWS CloudFront</span></span>
<span class="line"><span>- 与 AWS 服务集成</span></span>
<span class="line"><span>- Lambda@Edge</span></span>
<span class="line"><span>- CloudFront Functions</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br></div></div><h3 id="国内-cdn" tabindex="-1">国内 CDN <a class="header-anchor" href="#国内-cdn" aria-label="Permalink to “国内 CDN”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>阿里云 CDN</span></span>
<span class="line"><span>- 阿里云生态</span></span>
<span class="line"><span>- 价格适中</span></span>
<span class="line"><span>- 节点多</span></span>
<span class="line"><span></span></span>
<span class="line"><span>腾讯云 CDN</span></span>
<span class="line"><span>- 腾讯云生态</span></span>
<span class="line"><span>- 游戏加速强</span></span>
<span class="line"><span></span></span>
<span class="line"><span>华为云 CDN</span></span>
<span class="line"><span>- 华为云生态</span></span>
<span class="line"><span></span></span>
<span class="line"><span>又拍云</span></span>
<span class="line"><span>- 专注国内</span></span>
<span class="line"><span>- 适合中小企业</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br></div></div><h3 id="选择建议" tabindex="-1">选择建议 <a class="header-anchor" href="#选择建议" aria-label="Permalink to “选择建议”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                      CDN 选择指南                            │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  个人博客/静态网站：                                          │</span></span>
<span class="line"><span>│  → Cloudflare（免费）、又拍云（免费额度）                      │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  国内业务：                                                  │</span></span>
<span class="line"><span>│  → 阿里云 CDN、腾讯云 CDN                                   │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  海外业务：                                                  │</span></span>
<span class="line"><span>│  → Cloudflare、Fastly、CloudFront                          │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  电商/高并发：                                               │</span></span>
<span class="line"><span>│  → 多 CDN 组合                                              │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>│  游戏/直播：                                                │</span></span>
<span class="line"><span>│  → 腾讯云 CDN（游戏加速）                                    │</span></span>
<span class="line"><span>│                                                             │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br></div></div><h2 id="cdn-配置示例" tabindex="-1">CDN 配置示例 <a class="header-anchor" href="#cdn-配置示例" aria-label="Permalink to “CDN 配置示例”">​</a></h2><h3 id="nginx-配置缓存" tabindex="-1">Nginx 配置缓存 <a class="header-anchor" href="#nginx-配置缓存" aria-label="Permalink to “Nginx 配置缓存”">​</a></h3><div class="language-nginx line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">nginx</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">location</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> /static/ </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">{</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    # 静态资源缓存 1 年</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    expires </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">1y;</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    add_header </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">Cache-Control </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&quot;public, immutable&quot;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    # 开启 gzip</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    gzip </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">on</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">;</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    gzip_types </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">text/plain text/css application/json application/javascript;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">location</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> / </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">{</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    # HTML 不缓存</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    add_header </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">Cache-Control </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&quot;no-cache, no-store&quot;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    proxy_pass </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">http://backend;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br></div></div><h3 id="cloudflare-配置" tabindex="-1">Cloudflare 配置 <a class="header-anchor" href="#cloudflare-配置" aria-label="Permalink to “Cloudflare 配置”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>1. 添加域名</span></span>
<span class="line"><span>2. 修改 DNS 指向 Cloudflare</span></span>
<span class="line"><span>3. 配置 Page Rules（缓存规则）</span></span>
<span class="line"><span>   - *.example.com/images/* → Cache Everything, Edge Cache TTL: 1 month</span></span>
<span class="line"><span>   - *.example.com/*.html → Cache Level: Bypass</span></span>
<span class="line"><span>4. 配置 Edge Certificates（免费 HTTPS）</span></span>
<span class="line"><span>5. 配置 Speed 优化</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br></div></div><h2 id="常见问题" tabindex="-1">常见问题 <a class="header-anchor" href="#常见问题" aria-label="Permalink to “常见问题”">​</a></h2><h3 id="缓存失效问题" tabindex="-1">缓存失效问题 <a class="header-anchor" href="#缓存失效问题" aria-label="Permalink to “缓存失效问题”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>问题：更新了文件，但用户还是看到旧版本</span></span>
<span class="line"><span></span></span>
<span class="line"><span>原因：CDN 缓存还没过期</span></span>
<span class="line"><span></span></span>
<span class="line"><span>解决：</span></span>
<span class="line"><span>1. 使用文件名 hash</span></span>
<span class="line"><span>2. 缩短 TTL</span></span>
<span class="line"><span>3. 手动刷新 CDN</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br></div></div><h3 id="缓存不一致问题" tabindex="-1">缓存不一致问题 <a class="header-anchor" href="#缓存不一致问题" aria-label="Permalink to “缓存不一致问题”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>问题：不同节点返回不同内容</span></span>
<span class="line"><span></span></span>
<span class="line"><span>原因：缓存正在更新</span></span>
<span class="line"><span></span></span>
<span class="line"><span>解决：</span></span>
<span class="line"><span>1. 预热热门资源</span></span>
<span class="line"><span>2. 灰度发布</span></span>
<span class="line"><span>3. 缓存版本隔离</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br></div></div><h3 id="cors-问题" tabindex="-1">CORS 问题 <a class="header-anchor" href="#cors-问题" aria-label="Permalink to “CORS 问题”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>问题：跨域请求被 CDN 拒绝</span></span>
<span class="line"><span></span></span>
<span class="line"><span>原因：CDN 节点需要配置 CORS 头部</span></span>
<span class="line"><span></span></span>
<span class="line"><span>解决：</span></span>
<span class="line"><span>1. CDN 控制台配置 CORS</span></span>
<span class="line"><span>2. 源站返回 CORS 头部，CDN 透传</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br></div></div><h2 id="面试追问方向" tabindex="-1">面试追问方向 <a class="header-anchor" href="#面试追问方向" aria-label="Permalink to “面试追问方向”">​</a></h2><ul><li>CDN 是什么？它解决了什么问题？</li><li>CDN 的工作原理是什么？</li><li>什么是 Anycast？它是如何工作的？</li><li>CDN 缓存策略是如何配置的？</li><li>什么是 Cache-Control？有哪些常用指令？</li><li>CDN 如何保护源站？</li><li>什么是边缘计算？有哪些应用场景？</li><li>缓存失效后会发生什么？</li><li>如何选择 CDN 服务？</li><li>CDN 有哪些常见问题？如何解决？</li></ul>`,62)])])}const u=n(i,[["render",e]]);export{k as __pageData,u as default};
