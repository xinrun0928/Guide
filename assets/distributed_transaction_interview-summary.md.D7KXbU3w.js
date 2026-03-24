import{_ as n,o as a,c as p,ak as e}from"./chunks/framework.DwHlt8HN.js";const u=JSON.parse('{"title":"分布式事务面试高频问题汇总","description":"","frontmatter":{},"headers":[],"relativePath":"distributed/transaction/interview-summary.md","filePath":"distributed/transaction/interview-summary.md","lastUpdated":1774318215000}'),l={name:"distributed/transaction/interview-summary.md"};function i(r,s,c,b,t,d){return a(),p("div",null,[...s[0]||(s[0]=[e(`<h1 id="分布式事务面试高频问题汇总" tabindex="-1">分布式事务面试高频问题汇总 <a class="header-anchor" href="#分布式事务面试高频问题汇总" aria-label="Permalink to “分布式事务面试高频问题汇总”">​</a></h1><p>分布式事务是面试中的高频考点。</p><p><strong>大多数候选人能说出几种方案，但追问下去就露馅了。</strong></p><p>以下是面试中最高频的问题和回答要点。</p><h2 id="问题一-分布式事务的解决方案有哪些" tabindex="-1">问题一：分布式事务的解决方案有哪些？ <a class="header-anchor" href="#问题一-分布式事务的解决方案有哪些" aria-label="Permalink to “问题一：分布式事务的解决方案有哪些？”">​</a></h2><p><strong>考察点</strong>：对分布式事务方案的全面了解</p><h3 id="完整回答" tabindex="-1">完整回答 <a class="header-anchor" href="#完整回答" aria-label="Permalink to “完整回答”">​</a></h3><p>分布式事务有五种常见解决方案：</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>1. XA 规范（两阶段提交）</span></span>
<span class="line"><span>   - 基于数据库的强一致方案</span></span>
<span class="line"><span>   - 优点：强一致</span></span>
<span class="line"><span>   - 缺点：性能差、同步阻塞</span></span>
<span class="line"><span></span></span>
<span class="line"><span>2. Seata AT 模式</span></span>
<span class="line"><span>   - 对业务无侵入的最终一致方案</span></span>
<span class="line"><span>   - 优点：零侵入、性能较好</span></span>
<span class="line"><span>   - 缺点：有全局锁</span></span>
<span class="line"><span></span></span>
<span class="line"><span>3. TCC 模式</span></span>
<span class="line"><span>   - 业务层面的强一致方案</span></span>
<span class="line"><span>   - 优点：高性能、无全局锁</span></span>
<span class="line"><span>   - 缺点：侵入性大、三大问题</span></span>
<span class="line"><span></span></span>
<span class="line"><span>4. SAGA 模式</span></span>
<span class="line"><span>   - 长事务的编排方案</span></span>
<span class="line"><span>   - 优点：适合长事务</span></span>
<span class="line"><span>   - 缺点：最终一致、不支持隔离</span></span>
<span class="line"><span></span></span>
<span class="line"><span>5. 可靠消息 + 最终一致性</span></span>
<span class="line"><span>   - 异步化的最终一致方案</span></span>
<span class="line"><span>   - 优点：性能最高</span></span>
<span class="line"><span>   - 缺点：不保证强一致</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br></div></div><h3 id="追问方向" tabindex="-1">追问方向 <a class="header-anchor" href="#追问方向" aria-label="Permalink to “追问方向”">​</a></h3><ul><li>每种方案的具体原理是什么？</li><li>每种方案的适用场景是什么？</li><li>你们的系统用的是什么方案？</li></ul><hr><h2 id="问题二-seata-at-模式的原理" tabindex="-1">问题二：Seata AT 模式的原理？ <a class="header-anchor" href="#问题二-seata-at-模式的原理" aria-label="Permalink to “问题二：Seata AT 模式的原理？”">​</a></h2><p><strong>考察点</strong>：对 AT 模式的深度理解</p><h3 id="完整回答-1" tabindex="-1">完整回答 <a class="header-anchor" href="#完整回答-1" aria-label="Permalink to “完整回答”">​</a></h3><p>Seata AT 模式的核心是<strong>一阶段解析 SQL + 二阶段自动回滚</strong>：</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>一阶段：</span></span>
<span class="line"><span>1. 解析 SQL，识别 UPDATE/INSERT/DELETE</span></span>
<span class="line"><span>2. 查询并保存「前镜像」（Before Image）</span></span>
<span class="line"><span>3. 执行 SQL</span></span>
<span class="line"><span>4. 查询并保存「后镜像」（After Image）</span></span>
<span class="line"><span>5. 保存到 undolog 表</span></span>
<span class="line"><span>6. 注册分支到 TC</span></span>
<span class="line"><span></span></span>
<span class="line"><span>二阶段（提交）：</span></span>
<span class="line"><span>→ 异步删除 undolog</span></span>
<span class="line"><span></span></span>
<span class="line"><span>二阶段（回滚）：</span></span>
<span class="line"><span>→ 使用前镜像反向生成 SQL，还原数据</span></span>
<span class="line"><span>→ 删除 undolog</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br></div></div><h3 id="追问方向-1" tabindex="-1">追问方向 <a class="header-anchor" href="#追问方向-1" aria-label="Permalink to “追问方向”">​</a></h3><ul><li>什么是前镜像和后镜像？</li><li>AT 模式的全局锁是怎么工作的？</li><li>AT 和 XA 的区别是什么？</li></ul><hr><h2 id="问题三-tcc-模式的三个问题及解决方案" tabindex="-1">问题三：TCC 模式的三个问题及解决方案？ <a class="header-anchor" href="#问题三-tcc-模式的三个问题及解决方案" aria-label="Permalink to “问题三：TCC 模式的三个问题及解决方案？”">​</a></h2><p><strong>考察点</strong>：对 TCC 模式细节的掌握</p><h3 id="完整回答-2" tabindex="-1">完整回答 <a class="header-anchor" href="#完整回答-2" aria-label="Permalink to “完整回答”">​</a></h3><p>TCC 有三个著名的问题：</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>1. 空回滚</span></span>
<span class="line"><span>   - 定义：Try 未执行，Cancel 执行了</span></span>
<span class="line"><span>   - 原因：网络问题导致 Try 通知没送达</span></span>
<span class="line"><span>   - 解决：记录 Try 执行状态，Cancel 前检查</span></span>
<span class="line"><span></span></span>
<span class="line"><span>2. 幂等</span></span>
<span class="line"><span>   - 定义：Confirm/Cancel 重复执行</span></span>
<span class="line"><span>   - 原因：TC 没收到响应，重试调用</span></span>
<span class="line"><span>   - 解决：唯一键 + 状态机</span></span>
<span class="line"><span></span></span>
<span class="line"><span>3. 悬挂</span></span>
<span class="line"><span>   - 定义：Cancel 先于 Confirm 执行</span></span>
<span class="line"><span>   - 原因：Confirm 通知丢失</span></span>
<span class="line"><span>   - 解决：Cancel 前检查 Confirm 状态</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br></div></div><h3 id="追问方向-2" tabindex="-1">追问方向 <a class="header-anchor" href="#追问方向-2" aria-label="Permalink to “追问方向”">​</a></h3><ul><li>空回滚的解决方案具体怎么实现？</li><li>幂等的唯一键怎么设计？</li><li>哪个问题最严重？为什么？</li></ul><hr><h2 id="问题四-可靠消息最终一致性方案如何保证消息不丢失" tabindex="-1">问题四：可靠消息最终一致性方案如何保证消息不丢失？ <a class="header-anchor" href="#问题四-可靠消息最终一致性方案如何保证消息不丢失" aria-label="Permalink to “问题四：可靠消息最终一致性方案如何保证消息不丢失？”">​</a></h2><p><strong>考察点</strong>：对可靠消息方案的深度理解</p><h3 id="完整回答-3" tabindex="-1">完整回答 <a class="header-anchor" href="#完整回答-3" aria-label="Permalink to “完整回答”">​</a></h3><p>可靠消息有两种实现方式：</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>方式一：本地消息表</span></span>
<span class="line"><span>1. 本地事务 + 消息表，在同一个事务中</span></span>
<span class="line"><span>2. 消息表记录消息内容</span></span>
<span class="line"><span>3. 定时任务轮询消息表，发送消息</span></span>
<span class="line"><span>4. 更新消息状态</span></span>
<span class="line"><span></span></span>
<span class="line"><span>方式二：RocketMQ 事务消息</span></span>
<span class="line"><span>1. 发送半消息（Half Message）</span></span>
<span class="line"><span>2. 执行本地事务</span></span>
<span class="line"><span>3. 本地事务成功 → 提交半消息 → MQ 投递</span></span>
<span class="line"><span>4. 本地事务失败 → 回滚半消息</span></span>
<span class="line"><span>5. 如果发送方崩溃 → MQ 反查本地事务状态</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br></div></div><h3 id="追问方向-3" tabindex="-1">追问方向 <a class="header-anchor" href="#追问方向-3" aria-label="Permalink to “追问方向”">​</a></h3><ul><li>半消息是什么？为什么需要？</li><li>如果反查也失败了怎么办？</li><li>本地消息表和事务消息哪个更好？</li></ul><hr><h2 id="问题五-2pc-和-tcc-的区别" tabindex="-1">问题五：2PC 和 TCC 的区别？ <a class="header-anchor" href="#问题五-2pc-和-tcc-的区别" aria-label="Permalink to “问题五：2PC 和 TCC 的区别？”">​</a></h2><p><strong>考察点</strong>：对不同分布式事务方案的理解深度</p><h3 id="完整回答-4" tabindex="-1">完整回答 <a class="header-anchor" href="#完整回答-4" aria-label="Permalink to “完整回答”">​</a></h3><table tabindex="0"><thead><tr><th>维度</th><th>2PC</th><th>TCC</th></tr></thead><tbody><tr><td>协议层</td><td>数据库协议</td><td>业务协议</td></tr><tr><td>锁粒度</td><td>数据库行锁</td><td>无锁（Try 预留）</td></tr><tr><td>侵入性</td><td>需要 XA API</td><td>需要实现 Try/Confirm/Cancel</td></tr><tr><td>性能</td><td>较差（同步阻塞）</td><td>较高（无全局锁）</td></tr><tr><td>适用场景</td><td>多数据库强一致</td><td>资源敏感场景</td></tr></tbody></table><h3 id="核心区别" tabindex="-1">核心区别 <a class="header-anchor" href="#核心区别" aria-label="Permalink to “核心区别”">​</a></h3><blockquote><p>2PC 是数据库层面的协议，强依赖数据库的 ACID 能力。</p><p>TCC 是业务层面的协议，把一致性责任交给业务。</p></blockquote><h3 id="追问方向-4" tabindex="-1">追问方向 <a class="header-anchor" href="#追问方向-4" aria-label="Permalink to “追问方向”">​</a></h3><ul><li>2PC 的同步阻塞问题怎么理解？</li><li>TCC 的性能为什么更好？</li><li>什么场景下选 2PC，什么场景下选 TCC？</li></ul><hr><h2 id="问题六-分布式事务与本地事务的区别" tabindex="-1">问题六：分布式事务与本地事务的区别？ <a class="header-anchor" href="#问题六-分布式事务与本地事务的区别" aria-label="Permalink to “问题六：分布式事务与本地事务的区别？”">​</a></h2><p><strong>考察点</strong>：对事务本质的理解</p><h3 id="完整回答-5" tabindex="-1">完整回答 <a class="header-anchor" href="#完整回答-5" aria-label="Permalink to “完整回答”">​</a></h3><p><strong>本地事务</strong>：单个数据库的 ACID 事务</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>优点：</span></span>
<span class="line"><span>1. 强一致</span></span>
<span class="line"><span>2. 性能好</span></span>
<span class="line"><span>3. 实现简单</span></span>
<span class="line"><span></span></span>
<span class="line"><span>缺点：</span></span>
<span class="line"><span>1. 只能保证单个数据库</span></span>
<span class="line"><span>2. 无法跨数据库</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br></div></div><p><strong>分布式事务</strong>：多个数据库/服务的 ACID 事务</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>挑战：</span></span>
<span class="line"><span>1. CAP 理论：一致性、可用性、分区容忍不可兼得</span></span>
<span class="line"><span>2. 网络不可靠：消息可能丢失、延迟、乱序</span></span>
<span class="line"><span>3. 节点可能故障：协调者、参与者都可能崩溃</span></span>
<span class="line"><span></span></span>
<span class="line"><span>解决方案：</span></span>
<span class="line"><span>1. 强一致方案：2PC、TCC</span></span>
<span class="line"><span>2. 最终一致方案：SAGA、可靠消息</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br></div></div><h3 id="追问方向-5" tabindex="-1">追问方向 <a class="header-anchor" href="#追问方向-5" aria-label="Permalink to “追问方向”">​</a></h3><ul><li>CAP 理论在分布式事务中怎么体现？</li><li>BASE 理论是什么？</li><li>什么场景下可以用最终一致性？</li></ul><hr><h2 id="问题七-如何选择分布式事务方案" tabindex="-1">问题七：如何选择分布式事务方案？ <a class="header-anchor" href="#问题七-如何选择分布式事务方案" aria-label="Permalink to “问题七：如何选择分布式事务方案？”">​</a></h2><p><strong>考察点</strong>：工程实践能力</p><h3 id="完整回答-6" tabindex="-1">完整回答 <a class="header-anchor" href="#完整回答-6" aria-label="Permalink to “完整回答”">​</a></h3><p>选型决策树：</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>1. 业务代码能改吗？</span></span>
<span class="line"><span>   ├─ 不能改 → AT 模式</span></span>
<span class="line"><span>   └─ 能改 ↓</span></span>
<span class="line"><span>   </span></span>
<span class="line"><span>2. 资源敏感吗？（库存、资金）</span></span>
<span class="line"><span>   ├─ 是 → TCC 模式</span></span>
<span class="line"><span>   └─ 否 ↓</span></span>
<span class="line"><span>   </span></span>
<span class="line"><span>3. 事务时间长吗？（&gt; 1分钟）</span></span>
<span class="line"><span>   ├─ 是 → SAGA 模式</span></span>
<span class="line"><span>   └─ 否 → AT 模式 / 可靠消息</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br></div></div><h3 id="实际案例" tabindex="-1">实际案例 <a class="header-anchor" href="#实际案例" aria-label="Permalink to “实际案例”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>案例 1：电商下单</span></span>
<span class="line"><span>├─ 扣库存 → TCC</span></span>
<span class="line"><span>├─ 扣余额 → TCC</span></span>
<span class="line"><span>├─ 创建订单 → AT</span></span>
<span class="line"><span>└─ 发货通知 → 可靠消息</span></span>
<span class="line"><span></span></span>
<span class="line"><span>案例 2：金融转账</span></span>
<span class="line"><span>└─ 只能用 TCC（强一致）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>案例 3：订单处理流水线</span></span>
<span class="line"><span>└─ SAGA（长事务）</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br></div></div><h3 id="追问方向-6" tabindex="-1">追问方向 <a class="header-anchor" href="#追问方向-6" aria-label="Permalink to “追问方向”">​</a></h3><ul><li>你们系统用的是什么方案？为什么？</li><li>这个方案有什么缺点？你们怎么优化的？</li><li>不同方案可以混用吗？</li></ul><hr><h2 id="面试回答技巧" tabindex="-1">面试回答技巧 <a class="header-anchor" href="#面试回答技巧" aria-label="Permalink to “面试回答技巧”">​</a></h2><h3 id="_1-先框架后细节" tabindex="-1">1. 先框架后细节 <a class="header-anchor" href="#_1-先框架后细节" aria-label="Permalink to “1. 先框架后细节”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>推荐结构：</span></span>
<span class="line"><span>1. 先说有哪些方案（2-3 句话）</span></span>
<span class="line"><span>2. 再详细讲一两个最熟悉的</span></span>
<span class="line"><span>3. 最后说你们系统用的哪个</span></span>
<span class="line"><span></span></span>
<span class="line"><span>❌ 错误示范：</span></span>
<span class="line"><span>「嗯...有 XA，有 TCC...还有...AT？好像还有个什么 Saga？」</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br></div></div><h3 id="_2-结合实际项目" tabindex="-1">2. 结合实际项目 <a class="header-anchor" href="#_2-结合实际项目" aria-label="Permalink to “2. 结合实际项目”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>推荐结构：</span></span>
<span class="line"><span>「我们系统用 AT + TCC 混合方案：</span></span>
<span class="line"><span>- 普通业务用 AT，因为代码不想改</span></span>
<span class="line"><span>- 库存扣减用 TCC，因为并发高</span></span>
<span class="line"><span>- 发货通知用可靠消息，因为不需要强一致」</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br></div></div><h3 id="_3-预判追问" tabindex="-1">3. 预判追问 <a class="header-anchor" href="#_3-预判追问" aria-label="Permalink to “3. 预判追问”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>提前准备可能被追问的点：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>1. AT 模式：</span></span>
<span class="line"><span>   - 全局锁怎么工作？</span></span>
<span class="line"><span>   - 和 XA 的区别？</span></span>
<span class="line"><span></span></span>
<span class="line"><span>2. TCC 模式：</span></span>
<span class="line"><span>   - 空回滚怎么解决？</span></span>
<span class="line"><span>   - 幂等怎么保证？</span></span>
<span class="line"><span></span></span>
<span class="line"><span>3. 可靠消息：</span></span>
<span class="line"><span>   - 半消息是什么？</span></span>
<span class="line"><span>   - RocketMQ 事务消息原理？</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br></div></div><hr><h2 id="总结" tabindex="-1">总结 <a class="header-anchor" href="#总结" aria-label="Permalink to “总结”">​</a></h2><p>分布式事务的面试核心：</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>高频问题类型：</span></span>
<span class="line"><span>1. 方案有哪些？</span></span>
<span class="line"><span>2. 原理是什么？</span></span>
<span class="line"><span>3. 问题怎么解决？</span></span>
<span class="line"><span>4. 怎么选型？</span></span>
<span class="line"><span>5. 怎么实践？</span></span>
<span class="line"><span></span></span>
<span class="line"><span>回答要点：</span></span>
<span class="line"><span>1. 全面：能说出所有方案</span></span>
<span class="line"><span>2. 深入：对 1-2 个方案很熟悉</span></span>
<span class="line"><span>3. 实战：结合项目经验</span></span>
<span class="line"><span>4. 思考：有自己的理解</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br></div></div><p>记住：<strong>能说出方案是入门，能解释原理是合格，能处理问题是优秀。</strong></p>`,77)])])}const m=n(l,[["render",i]]);export{u as __pageData,m as default};
