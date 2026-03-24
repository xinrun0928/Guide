import{_ as n,o as a,c as p,ak as l}from"./chunks/framework.DwHlt8HN.js";const u=JSON.parse('{"title":"QUIC 协议：HTTP/3 底层协议","description":"","frontmatter":{},"headers":[],"relativePath":"cs/network/quic.md","filePath":"cs/network/quic.md","lastUpdated":1774353797000}'),e={name:"cs/network/quic.md"};function i(r,s,c,b,t,h){return a(),p("div",null,[...s[0]||(s[0]=[l(`<h1 id="quic-协议-http-3-底层协议" tabindex="-1">QUIC 协议：HTTP/3 底层协议 <a class="header-anchor" href="#quic-协议-http-3-底层协议" aria-label="Permalink to “QUIC 协议：HTTP/3 底层协议”">​</a></h1><p>2015 年，Google 提出了 QUIC 协议。</p><p>2022 年，HTTP/3 正式成为 RFC 9114，QUIC 成为 HTTP/3 的底层传输协议。</p><p>QUIC 是一个基于 UDP 的传输层协议，但它实现了 TCP 的可靠性，还解决了 TCP 的一些固有问题。</p><h2 id="为什么要发明-quic" tabindex="-1">为什么要发明 QUIC？ <a class="header-anchor" href="#为什么要发明-quic" aria-label="Permalink to “为什么要发明 QUIC？”">​</a></h2><p>TCP 已经用了 40 多年，为什么还需要新的协议？</p><h3 id="tcp-的问题" tabindex="-1">TCP 的问题 <a class="header-anchor" href="#tcp-的问题" aria-label="Permalink to “TCP 的问题”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>1. 连接建立慢</span></span>
<span class="line"><span>   - 三次握手 = 1.5 RTT</span></span>
<span class="line"><span>   - TLS 握手 = 1-2 RTT</span></span>
<span class="line"><span>   - 总计：2.5-3.5 RTT 才能开始传输数据</span></span>
<span class="line"><span></span></span>
<span class="line"><span>2. 队头阻塞</span></span>
<span class="line"><span>   - TCP 保证有序，一个包丢了，后面的都要等</span></span>
<span class="line"><span>   - HTTP/2 多路复用：一个流丢包，其他流也阻塞</span></span>
<span class="line"><span></span></span>
<span class="line"><span>3. 连接迁移困难</span></span>
<span class="line"><span>   - 手机从 WiFi 切换到 4G，IP 变了，TCP 连接断了</span></span>
<span class="line"><span>   - 需要重新建立连接</span></span>
<span class="line"><span></span></span>
<span class="line"><span>4. 拥塞控制僵化</span></span>
<span class="line"><span>   - 拥塞控制算法嵌入内核，更新困难</span></span>
<span class="line"><span>   - 无法在应用层定制</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br></div></div><h3 id="quic-的解决思路" tabindex="-1">QUIC 的解决思路 <a class="header-anchor" href="#quic-的解决思路" aria-label="Permalink to “QUIC 的解决思路”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>QUIC 的设计目标：</span></span>
<span class="line"><span>1. 0-RTT 或 1-RTT 建立连接</span></span>
<span class="line"><span>2. 无队头阻塞的多路复用</span></span>
<span class="line"><span>3. 连接迁移（Connection Migration）</span></span>
<span class="line"><span>4. 可插拔的拥塞控制</span></span>
<span class="line"><span>5. 前向纠错（FEC）</span></span>
<span class="line"><span>6. 连接 ID（Connection ID）</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br></div></div><h2 id="quic-协议结构" tabindex="-1">QUIC 协议结构 <a class="header-anchor" href="#quic-协议结构" aria-label="Permalink to “QUIC 协议结构”">​</a></h2><h3 id="quic-头部" tabindex="-1">QUIC 头部 <a class="header-anchor" href="#quic-头部" aria-label="Permalink to “QUIC 头部”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    QUIC 头部（可变长度）                      │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│  头部Protected │  连接 ID长度 │    连接 ID                   │</span></span>
<span class="line"><span>│  (1-4 字节)   │   (1 字节)    │  (0-20 字节)                │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│  版本号 / 包编号 / 加密信息                                  │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                        帧（Frames）                         │</span></span>
<span class="line"><span>│    ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                    │</span></span>
<span class="line"><span>│    │HEADERS│ │DATA  │ │ACK   │ │ ...  │                    │</span></span>
<span class="line"><span>│    └──────┘ └──────┘ └──────┘ └──────┘                    │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br></div></div><h3 id="quic-vs-tcp-tls-头部开销" tabindex="-1">QUIC vs TCP + TLS 头部开销 <a class="header-anchor" href="#quic-vs-tcp-tls-头部开销" aria-label="Permalink to “QUIC vs TCP + TLS 头部开销”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>TCP + TLS 1.3（最理想情况）：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>┌─────────┬─────────────┬─────────────┬────────────────────┐</span></span>
<span class="line"><span>│ TCP 头  │ TLS 头      │ 应用数据头   │ 实际数据            │</span></span>
<span class="line"><span>│ 20 字节 │ 加密开销     │ HTTP/2      │                    │</span></span>
<span class="line"><span>└─────────┴─────────────┴─────────────┴────────────────────┘</span></span>
<span class="line"><span></span></span>
<span class="line"><span>QUIC（最理想情况）：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>┌─────────┬─────────────┬────────────────────┐</span></span>
<span class="line"><span>│ QUIC 头 │ 帧头（极小） │ 加密后的实际数据     │</span></span>
<span class="line"><span>│ 最小 4B │             │                    │</span></span>
<span class="line"><span>└─────────┴─────────────┴────────────────────┘</span></span>
<span class="line"><span></span></span>
<span class="line"><span>QUIC 将 TLS 加密直接集成到 QUIC 层，减少了头部开销。</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br></div></div><h2 id="quic-的核心特性" tabindex="-1">QUIC 的核心特性 <a class="header-anchor" href="#quic-的核心特性" aria-label="Permalink to “QUIC 的核心特性”">​</a></h2><h3 id="_1-0-rtt-和-1-rtt-连接建立" tabindex="-1">1. 0-RTT 和 1-RTT 连接建立 <a class="header-anchor" href="#_1-0-rtt-和-1-rtt-连接建立" aria-label="Permalink to “1. 0-RTT 和 1-RTT 连接建立”">​</a></h3><h4 id="_1-rtt-首次连接" tabindex="-1">1-RTT（首次连接） <a class="header-anchor" href="#_1-rtt-首次连接" aria-label="Permalink to “1-RTT（首次连接）”">​</a></h4><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>传统 TCP + TLS 1.3：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>客户端 ──── SYN ────────────────────────────────&gt; 服务端</span></span>
<span class="line"><span>客户端 &lt;─── SYN+ACK ──────────────────────────── 服务端</span></span>
<span class="line"><span>客户端 ──── ClientHello (TLS) ──────────────────&gt; 服务端</span></span>
<span class="line"><span>客户端 &lt;─── ServerHello + 证书 + 加密算法 ──────── 服务端</span></span>
<span class="line"><span>客户端 ──── Finished (加密密钥) ────────────────&gt; 服务端</span></span>
<span class="line"><span>（密钥已就绪，可以加密发送）</span></span>
<span class="line"><span>客户端 ──── 加密的应用数据 ───────────────────────&gt; 服务端</span></span>
<span class="line"><span></span></span>
<span class="line"><span>总计：2 RTT（不含应用数据）到 3 RTT（含 TLS）</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br></div></div><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>QUIC 1-RTT：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>客户端 ──── Initial (ClientHello) ────────────────&gt; 服务端</span></span>
<span class="line"><span>客户端 &lt;─── Initial (ServerHello + 证书) ────────── 服务端</span></span>
<span class="line"><span>客户端 &lt;─── Handshake (加密参数) ────────────────── 服务端</span></span>
<span class="line"><span>客户端 ──── 0-RTT 数据（使用会话票据密钥） ────────&gt; 服务端</span></span>
<span class="line"><span></span></span>
<span class="line"><span>（密钥已就绪，可以加密发送）</span></span>
<span class="line"><span>客户端 ──── 加密的应用数据 ───────────────────────&gt; 服务端</span></span>
<span class="line"><span></span></span>
<span class="line"><span>总计：1 RTT</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br></div></div><h4 id="_0-rtt-重连" tabindex="-1">0-RTT（重连） <a class="header-anchor" href="#_0-rtt-重连" aria-label="Permalink to “0-RTT（重连）”">​</a></h4><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>QUIC 0-RTT：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>首次连接时，服务端给客户端一个「会话票据」（Session Ticket）</span></span>
<span class="line"><span>客户端保存这个票据</span></span>
<span class="line"><span></span></span>
<span class="line"><span>重连时：</span></span>
<span class="line"><span>客户端 ──── Initial + 0-RTT 数据（使用会话密钥加密） ──&gt; 服务端</span></span>
<span class="line"><span>客户端 &lt;─── Initial (确认密钥) ────────────────────────── 服务端</span></span>
<span class="line"><span>客户端 &lt;─── Handshake ──────────────────────────────────── 服务端</span></span>
<span class="line"><span></span></span>
<span class="line"><span>总计：0 RTT（无需等待就可以发送数据）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>注意：0-RTT 数据可能受到重放攻击，因此仅用于幂等请求</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br></div></div><h3 id="_2-无队头阻塞的多路复用" tabindex="-1">2. 无队头阻塞的多路复用 <a class="header-anchor" href="#_2-无队头阻塞的多路复用" aria-label="Permalink to “2. 无队头阻塞的多路复用”">​</a></h3><h4 id="tcp-的队头阻塞" tabindex="-1">TCP 的队头阻塞 <a class="header-anchor" href="#tcp-的队头阻塞" aria-label="Permalink to “TCP 的队头阻塞”">​</a></h4><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>HTTP/2 多路复用（在 TCP 上）：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>Stream 1:  ████████████</span></span>
<span class="line"><span>Stream 2:  ██████</span></span>
<span class="line"><span>Stream 3:  ██████████████████████</span></span>
<span class="line"><span></span></span>
<span class="line"><span>场景：Stream 2 丢了一个包</span></span>
<span class="line"><span></span></span>
<span class="line"><span>Stream 1:  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░</span></span>
<span class="line"><span>Stream 2:  ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░</span></span>
<span class="line"><span>Stream 3:  ██████████████████████░░░░░░░░░░░░░░░░░░░░</span></span>
<span class="line"><span>                        ↑</span></span>
<span class="line"><span>                    Stream 2 丢包</span></span>
<span class="line"><span>                    其他 Stream 都要等</span></span>
<span class="line"><span>                    TCP 层阻塞</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br></div></div><h4 id="quic-的无阻塞" tabindex="-1">QUIC 的无阻塞 <a class="header-anchor" href="#quic-的无阻塞" aria-label="Permalink to “QUIC 的无阻塞”">​</a></h4><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>QUIC Stream（在 QUIC 上）：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>Stream 1:  ████████████</span></span>
<span class="line"><span>Stream 2:  ██████</span></span>
<span class="line"><span>Stream 3:  ██████████████████████</span></span>
<span class="line"><span></span></span>
<span class="line"><span>场景：Stream 2 丢了一个包</span></span>
<span class="line"><span></span></span>
<span class="line"><span>Stream 1:  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░</span></span>
<span class="line"><span>Stream 2:  ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░</span></span>
<span class="line"><span>Stream 3:  ██████████████████████░░░░░░░░░░░░░░░░░░░░</span></span>
<span class="line"><span>                        ↑</span></span>
<span class="line"><span>                    Stream 2 丢包</span></span>
<span class="line"><span>                    只影响 Stream 2</span></span>
<span class="line"><span>                    其他 Stream 不受影响</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br></div></div><p>QUIC 的每个 Stream 有独立的序号，丢包只影响本 Stream。</p><h3 id="_3-连接迁移-connection-migration" tabindex="-1">3. 连接迁移（Connection Migration） <a class="header-anchor" href="#_3-连接迁移-connection-migration" aria-label="Permalink to “3. 连接迁移（Connection Migration）”">​</a></h3><h4 id="tcp-的问题-1" tabindex="-1">TCP 的问题 <a class="header-anchor" href="#tcp-的问题-1" aria-label="Permalink to “TCP 的问题”">​</a></h4><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>手机从 WiFi 切换到 4G：</span></span>
<span class="line"><span>- IP 地址变了</span></span>
<span class="line"><span>- TCP 连接基于四元组（源IP, 源端口, 目标IP, 目标端口）</span></span>
<span class="line"><span>- IP 变了，连接断了</span></span>
<span class="line"><span>- 需要重新建立连接</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br></div></div><h4 id="quic-的解决方案" tabindex="-1">QUIC 的解决方案 <a class="header-anchor" href="#quic-的解决方案" aria-label="Permalink to “QUIC 的解决方案”">​</a></h4><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>QUIC 使用连接 ID（Connection ID）：</span></span>
<span class="line"><span>- 每个连接有一个或多个连接 ID</span></span>
<span class="line"><span>- 连接 ID 与 IP 地址无关</span></span>
<span class="line"><span>- 切换网络时，只要连接 ID 不变，连接就保持</span></span>
<span class="line"><span></span></span>
<span class="line"><span>WiFi:          Connection ID = abc123</span></span>
<span class="line"><span>    │</span></span>
<span class="line"><span>    │ ─── QUIC 包 (Connection ID = abc123) ────&gt; 服务端</span></span>
<span class="line"><span>    │                                              │</span></span>
<span class="line"><span>    ▼                                              ▼</span></span>
<span class="line"><span>4G:         Connection ID = abc123                 服务端</span></span>
<span class="line"><span>    │                                              │</span></span>
<span class="line"><span>    │ ─── QUIC 包 (Connection ID = abc123) ────&gt; 服务端</span></span>
<span class="line"><span>    │                                              │</span></span>
<span class="line"><span>    │            连接保持，数据继续传输              │</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br></div></div><h3 id="_4-可插拔的拥塞控制" tabindex="-1">4. 可插拔的拥塞控制 <a class="header-anchor" href="#_4-可插拔的拥塞控制" aria-label="Permalink to “4. 可插拔的拥塞控制”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>TCP 的拥塞控制：</span></span>
<span class="line"><span>- 算法嵌入内核</span></span>
<span class="line"><span>- 更新需要升级内核</span></span>
<span class="line"><span>- 周期：以年为单位</span></span>
<span class="line"><span></span></span>
<span class="line"><span>QUIC 的拥塞控制：</span></span>
<span class="line"><span>- 算法在用户空间实现</span></span>
<span class="line"><span>- 可以随时更新（像更新应用一样）</span></span>
<span class="line"><span>- 可以为不同连接使用不同算法</span></span>
<span class="line"><span>- 周期：以周为单位</span></span>
<span class="line"><span></span></span>
<span class="line"><span>可用的拥塞控制算法：</span></span>
<span class="line"><span>- CUBIC（默认）</span></span>
<span class="line"><span>- BBR</span></span>
<span class="line"><span>- COPPA</span></span>
<span class="line"><span>- 定制算法</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br></div></div><h2 id="quic-与-http-3" tabindex="-1">QUIC 与 HTTP/3 <a class="header-anchor" href="#quic-与-http-3" aria-label="Permalink to “QUIC 与 HTTP/3”">​</a></h2><h3 id="http-3-的请求-响应模型" tabindex="-1">HTTP/3 的请求-响应模型 <a class="header-anchor" href="#http-3-的请求-响应模型" aria-label="Permalink to “HTTP/3 的请求-响应模型”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>HTTP/3 over QUIC：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>┌─────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                         HTTP/3                              │</span></span>
<span class="line"><span>│  ├─ 请求/响应                                              │</span></span>
<span class="line"><span>│  ├─ 首部压缩（QPACK）                                       │</span></span>
<span class="line"><span>│  └─ 服务器推送                                             │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                         QUIC                               │</span></span>
<span class="line"><span>│  ├─ 连接管理                                              │</span></span>
<span class="line"><span>│  ├─ 流控制                                                │</span></span>
<span class="line"><span>│  ├─ 拥塞控制                                              │</span></span>
<span class="line"><span>│  ├─ 加密                                                  │</span></span>
<span class="line"><span>│  └─ 多路复用                                              │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                         UDP                                │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br></div></div><h3 id="http-3-的帧类型" tabindex="-1">HTTP/3 的帧类型 <a class="header-anchor" href="#http-3-的帧类型" aria-label="Permalink to “HTTP/3 的帧类型”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                      HTTP/3 帧类型                          │</span></span>
<span class="line"><span>├─────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│  HEADERS    │  HTTP 首部                                    │</span></span>
<span class="line"><span>│  DATA       │  HTTP 请求体/响应体                           │</span></span>
<span class="line"><span>│  SETTINGS   │  协议参数                                     │</span></span>
<span class="line"><span>│  PING       │  连接保活                                    │</span></span>
<span class="line"><span>│  GOAWAY     │  优雅关闭                                    │</span></span>
<span class="line"><span>│  MAX_DATA   │  流控制                                      │</span></span>
<span class="line"><span>│  ...        │                                             │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br></div></div><h2 id="quic-的部署现状" tabindex="-1">QUIC 的部署现状 <a class="header-anchor" href="#quic-的部署现状" aria-label="Permalink to “QUIC 的部署现状”">​</a></h2><h3 id="主流支持" tabindex="-1">主流支持 <a class="header-anchor" href="#主流支持" aria-label="Permalink to “主流支持”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>浏览器支持：</span></span>
<span class="line"><span>- Chrome: 支持 HTTP/3（2020 年默认启用）</span></span>
<span class="line"><span>- Firefox: 支持 HTTP/3</span></span>
<span class="line"><span>- Safari: 支持 HTTP/3</span></span>
<span class="line"><span></span></span>
<span class="line"><span>服务器支持：</span></span>
<span class="line"><span>- Nginx: 1.25+（需要 OpenSSL 3.0+）</span></span>
<span class="line"><span>- Caddy: 默认支持 HTTP/3</span></span>
<span class="line"><span>- Apache: mod_http3（第三方模块）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>CDN 支持：</span></span>
<span class="line"><span>- Cloudflare: 支持 HTTP/3（2021 年）</span></span>
<span class="line"><span>- Fastly: 支持 HTTP/3</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br></div></div><h3 id="如何启用-http-3" tabindex="-1">如何启用 HTTP/3 <a class="header-anchor" href="#如何启用-http-3" aria-label="Permalink to “如何启用 HTTP/3”">​</a></h3><div class="language-nginx line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">nginx</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># Nginx 配置</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">http</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> {</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    # 启用 HTTP/3</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    ssl_conf_command </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">Ciphersuites TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256;</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    ssl_conf_command </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">Options TLSv1.3;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    </span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    server</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> {</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">        listen </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">443</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> ssl;</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        # 监听 QUIC（UDP 443）</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">        listen </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">443</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> quic reuseport;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">        </span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        # 宣称为 HTTP/3 可用</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">        add_header </span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">Alt-Svc </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;h3=&quot;:443&quot;; ma=86400&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br></div></div><h2 id="quic-vs-tcp-tls-对比" tabindex="-1">QUIC vs TCP + TLS 对比 <a class="header-anchor" href="#quic-vs-tcp-tls-对比" aria-label="Permalink to “QUIC vs TCP + TLS 对比”">​</a></h2><table tabindex="0"><thead><tr><th>特性</th><th>TCP + TLS</th><th>QUIC</th></tr></thead><tbody><tr><td>连接建立</td><td>2-3 RTT</td><td>0-1 RTT</td></tr><tr><td>队头阻塞</td><td>TCP 层阻塞</td><td>Stream 级无阻塞</td></tr><tr><td>连接迁移</td><td>不支持</td><td>支持</td></tr><tr><td>拥塞控制</td><td>内核控制</td><td>用户空间可插拔</td></tr><tr><td>首部加密</td><td>仅负载加密</td><td>全连接加密</td></tr><tr><td>可靠性</td><td>TCP 保证</td><td>QUIC 保证</td></tr><tr><td>传输层</td><td>TCP</td><td>UDP</td></tr><tr><td>多路复用</td><td>HTTP/2 层</td><td>QUIC 层</td></tr></tbody></table><h2 id="面试追问方向" tabindex="-1">面试追问方向 <a class="header-anchor" href="#面试追问方向" aria-label="Permalink to “面试追问方向”">​</a></h2><ul><li>QUIC 协议是什么？它解决了什么问题？</li><li>QUIC 为什么基于 UDP 而不是 TCP？</li><li>什么是 0-RTT 和 1-RTT？它们有什么区别？</li><li>QUIC 是如何实现无队头阻塞的？</li><li>什么是连接迁移？为什么 QUIC 支持连接迁移？</li><li>HTTP/3 和 HTTP/2 有什么区别？</li><li>QUIC 的拥塞控制为什么更容易更新？</li><li>0-RTT 有什么安全风险？</li><li>QUIC 和 TCP 的头部开销有什么区别？</li><li>如何在生产环境中启用 HTTP/3？</li></ul>`,49)])])}const m=n(e,[["render",i]]);export{u as __pageData,m as default};
