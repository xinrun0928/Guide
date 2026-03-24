import{_ as n,o as a,c as e,ak as l}from"./chunks/framework.DwHlt8HN.js";const u=JSON.parse('{"title":"Ansible","description":"","frontmatter":{},"headers":[],"relativePath":"devops/ansible/index.md","filePath":"devops/ansible/index.md","lastUpdated":1774340030000}'),p={name:"devops/ansible/index.md"};function i(r,s,b,c,o,t){return a(),e("div",null,[...s[0]||(s[0]=[l(`<h1 id="ansible" tabindex="-1">Ansible <a class="header-anchor" href="#ansible" aria-label="Permalink to “Ansible”">​</a></h1><p>运维自动化的瑞士军刀，无代理的批量配置管理工具。</p><p>Ansible 是运维工程师最该掌握的工具之一。它的设计哲学简洁而强大：无代理（不需要在被管理节点安装软件）、幂等性（执行一次和执行一百次效果一样）、声明式（描述目标状态，而不是操作步骤）。从配置文件管理到应用部署，从 Docker 编排到 Kubernetes 集群维护，Ansible 都能覆盖。</p><h2 id="模块速览" tabindex="-1">模块速览 <a class="header-anchor" href="#模块速览" aria-label="Permalink to “模块速览”">​</a></h2><p>Ansible 在本项目中的定位是「基础设施自动化的粘合剂」——用它连接服务器、Docker、Kubernetes、Cloud APIs，构建端到端的自动化流程。</p><p>|| 方向 | 篇数 | 核心目标 | ||------|------|----------| || <a href="/devops/ansible/architecture">Ansible 架构</a> | 1 篇 | Inventory、Playbook、Modules、Galaxy 生态 | || <a href="/devops/ansible/playbook">Ansible Playbook</a> | 1 篇 | YAML 语法、变量、条件、循环、错误处理 | || <a href="/devops/ansible/roles">Ansible Roles</a> | 1 篇 | Role 目录结构、Galaxy、复用与维护 | || <a href="/devops/ansible/integration">Ansible 集成</a> | 1 篇 | Docker 编排、K8s 资源管理、Helm 集成 |</p><h2 id="学习路径建议" tabindex="-1">学习路径建议 <a class="header-anchor" href="#学习路径建议" aria-label="Permalink to “学习路径建议”">​</a></h2><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>第一阶段：概念入门（1-2 天）</span></span>
<span class="line"><span>→ 理解 Ansible 的无代理设计和幂等性</span></span>
<span class="line"><span>→ 安装 Ansible（pip install ansible）</span></span>
<span class="line"><span>→ 第一个 Inventory 和 Ad-Hoc 命令</span></span>
<span class="line"><span>→ ansible vs ansible-playbook</span></span>
<span class="line"><span></span></span>
<span class="line"><span>第二阶段：Playbook 基础（3-4 天）</span></span>
<span class="line"><span>→ YAML 语法和 Playbook 结构</span></span>
<span class="line"><span>→ 变量定义与 Jinja2 模板</span></span>
<span class="line"><span>→ 条件（when）和循环（loop）</span></span>
<span class="line"><span>→ Handlers 和任务控制</span></span>
<span class="line"><span>→ 错误处理（block/rescue）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>第三阶段：Roles 与复用（2-3 天）</span></span>
<span class="line"><span>→ Role 目录结构</span></span>
<span class="line"><span>→ Ansible Galaxy 使用</span></span>
<span class="line"><span>→ 编写可复用的 Role</span></span>
<span class="line"><span>→ Role 依赖管理</span></span>
<span class="line"><span></span></span>
<span class="line"><span>第四阶段：与企业组件集成（3-4 天）</span></span>
<span class="line"><span>→ Ansible + Docker</span></span>
<span class="line"><span>→ Ansible + Kubernetes（k8s 模块）</span></span>
<span class="line"><span>→ Ansible + Helm（k8s_helm 模块）</span></span>
<span class="line"><span>→ 完整的 CI/CD 流水线示例</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br></div></div><h2 id="ansible-解决了什么问题" tabindex="-1">Ansible 解决了什么问题 <a class="header-anchor" href="#ansible-解决了什么问题" aria-label="Permalink to “Ansible 解决了什么问题”">​</a></h2><p>传统运维的问题：</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>手动运维</span></span>
<span class="line"><span>├── 10 台服务器，每台都要执行相同的操作</span></span>
<span class="line"><span>├── 配置文件不一致，环境差异大</span></span>
<span class="line"><span>├── 新机器部署靠「文档 + 复制粘贴」</span></span>
<span class="line"><span>└── 出了问题不知道在哪台机器上</span></span>
<span class="line"><span></span></span>
<span class="line"><span>Ansible 运维</span></span>
<span class="line"><span>├── 写一个 Playbook，100 台服务器一起执行</span></span>
<span class="line"><span>├── 所有配置代码化，版本可控</span></span>
<span class="line"><span>├── 新机器上线一键搞定</span></span>
<span class="line"><span>└── 所有操作都有记录，可审计</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br></div></div><h2 id="和其他工具的对比" tabindex="-1">和其他工具的对比 <a class="header-anchor" href="#和其他工具的对比" aria-label="Permalink to “和其他工具的对比”">​</a></h2><p>|| 维度 | Ansible | Chef/Puppet | Terraform | ||------|---------|-----------|-----------| || Agent | 无 | 需要 | 无 | || 设计理念 | 幂等自动化 | 配置持续合规 | 声明式基础设施 | || 核心用途 | 配置管理、应用部署 | 配置管理 | 基础设施创建/销毁 | || 状态管理 | 无状态 | 无状态 | State 文件 | || 语法 | YAML | Ruby DSL | HCL | || 学习曲线 | 低 | 中 | 中 |</p><h2 id="面试的核心逻辑" tabindex="-1">面试的核心逻辑 <a class="header-anchor" href="#面试的核心逻辑" aria-label="Permalink to “面试的核心逻辑”">​</a></h2><p>Ansible 面试的核心，不是让你背命令，而是考察三个层次的理解：</p><ol><li><strong>基础概念</strong>：Inventory、Playbook、Module、Role 是什么？为什么说 Ansible 是幂等的？</li><li><strong>实战能力</strong>：如何编写一个可复用的 Role？如何处理跨平台（Linux/Windows）的差异？</li><li><strong>架构思维</strong>：什么场景用 Ansible？什么场景用 Terraform？为什么 Ansible 不适合管理 K8s 资源创建（而应该用 kubectl/helm）？</li></ol><blockquote><p>&quot;Ansible 的价值，在于把『人围着机器转』变成『机器围着人转』。运维工程师应该用工具，而不是被工具用。&quot;</p></blockquote>`,17)])])}const h=n(p,[["render",i]]);export{u as __pageData,h as default};
