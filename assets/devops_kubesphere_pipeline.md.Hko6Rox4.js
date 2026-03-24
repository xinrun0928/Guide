import{_ as n,o as a,c as i,ak as p}from"./chunks/framework.DwHlt8HN.js";const u=JSON.parse('{"title":"KubeSphere 流水线：基于 Jenkins 的 CI/CD","description":"","frontmatter":{},"headers":[],"relativePath":"devops/kubesphere/pipeline.md","filePath":"devops/kubesphere/pipeline.md","lastUpdated":1774340030000}'),l={name:"devops/kubesphere/pipeline.md"};function e(r,s,h,k,t,c){return a(),i("div",null,[...s[0]||(s[0]=[p(`<h1 id="kubesphere-流水线-基于-jenkins-的-ci-cd" tabindex="-1">KubeSphere 流水线：基于 Jenkins 的 CI/CD <a class="header-anchor" href="#kubesphere-流水线-基于-jenkins-的-ci-cd" aria-label="Permalink to “KubeSphere 流水线：基于 Jenkins 的 CI/CD”">​</a></h1><p>「KubeSphere 的流水线是怎么跑起来的？」——图形化 Jenkins，不需要懂 Jenkins 也能用。</p><p>KubeSphere 的 DevOps 模块基于 Jenkins 和 Jenkins Kubernetes Plugin，提供图形化的流水线编辑能力。开发者可以在 Web 界面中拖拽创建 CI/CD 流水线，不需要写 Jenkinsfile，也不需要懂 Jenkins 的内部原理。</p><h2 id="流水线架构" tabindex="-1">流水线架构 <a class="header-anchor" href="#流水线架构" aria-label="Permalink to “流水线架构”">​</a></h2><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    KubeSphere DevOps 架构                         │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  ┌──────────────────────────────────────────────────────────┐   │</span></span>
<span class="line"><span>│  │              KubeSphere Console（图形化编辑）               │   │</span></span>
<span class="line"><span>│  │                                                          │   │</span></span>
<span class="line"><span>│  │  ┌────────────────────────────────────────────────────┐ │   │</span></span>
<span class="line"><span>│  │  │              Jenkins Kubernetes Plugin               │ │   │</span></span>
<span class="line"><span>│  │  │                                                      │ │   │</span></span>
<span class="line"><span>│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │ │   │</span></span>
<span class="line"><span>│  │  │  │ Stage 1  │→│ Stage 2  │→│ Stage 3  │         │ │   │</span></span>
<span class="line"><span>│  │  │  │ Build    │  │ Test    │  │ Deploy   │         │ │   │</span></span>
<span class="line"><span>│  │  │  └──────────┘  └──────────┘  └──────────┘         │ │   │</span></span>
<span class="line"><span>│  │  └────────────────────────────────────────────────────┘ │   │</span></span>
<span class="line"><span>│  │                         │                              │   │</span></span>
<span class="line"><span>│  │  ┌──────────────────────┴──────────────────────────┐   │   │</span></span>
<span class="line"><span>│  │  │              Jenkins Master（Pod）                  │   │   │</span></span>
<span class="line"><span>│  │  │  - 调度流水线执行                                    │   │   │</span></span>
<span class="line"><span>│  │  │  - 存储流水线定义                                   │   │   │</span></span>
<span class="line"><span>│  │  │  - 管理 Agent                                       │   │   │</span></span>
<span class="line"><span>│  │  └──────────────────────┬──────────────────────────┘   │   │</span></span>
<span class="line"><span>│  └─────────────────────────┼──────────────────────────────┘   │</span></span>
<span class="line"><span>│                             │ Jenkins Agent (按需创建)           │</span></span>
<span class="line"><span>│         ┌───────────────────┼───────────────────┐               │</span></span>
<span class="line"><span>│         ▼                   ▼                   ▼               │</span></span>
<span class="line"><span>│  ┌────────────┐       ┌────────────┐       ┌────────────┐        │</span></span>
<span class="line"><span>│  │  Agent 1   │       │  Agent 2   │       │  Agent N   │        │</span></span>
<span class="line"><span>│  │ (maven)    │       │ (nodejs)   │       │ (docker)   │        │</span></span>
<span class="line"><span>│  │ (构建 JDK) │       │ (构建前端) │       │ (构建镜像) │        │</span></span>
<span class="line"><span>│  └────────────┘       └────────────┘       └────────────┘        │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  ┌──────────────────────────────────────────────────────────┐   │</span></span>
<span class="line"><span>│  │                    集成服务                               │   │</span></span>
<span class="line"><span>│  │  SonarQube（代码质量）| Harbor（镜像仓库）| 制品库（Binary）│   │</span></span>
<span class="line"><span>│  └──────────────────────────────────────────────────────────┘   │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br><span class="line-number">26</span><br><span class="line-number">27</span><br><span class="line-number">28</span><br><span class="line-number">29</span><br><span class="line-number">30</span><br><span class="line-number">31</span><br><span class="line-number">32</span><br><span class="line-number">33</span><br><span class="line-number">34</span><br><span class="line-number">35</span><br><span class="line-number">36</span><br></div></div><h2 id="流水线创建流程" tabindex="-1">流水线创建流程 <a class="header-anchor" href="#流水线创建流程" aria-label="Permalink to “流水线创建流程”">​</a></h2><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    流水线创建步骤                                 │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  1. 准备阶段                                                     │</span></span>
<span class="line"><span>│     → 创建 DevOps Project                                        │</span></span>
<span class="line"><span>│     → 关联代码仓库（Git/GitHub/GitLab）                         │</span></span>
<span class="line"><span>│     → 配置凭证（用户名密码/SSH Key/Token）                       │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  2. 创建阶段                                                     │</span></span>
<span class="line"><span>│     → 新建流水线 → 填写基本信息                                 │</span></span>
<span class="line"><span>│     → 添加构建片段（图形化或 Jenkinsfile）                       │</span></span>
<span class="line"><span>│     → 配置构建参数（可选）                                       │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  3. 执行阶段                                                     │</span></span>
<span class="line"><span>│     → 运行流水线 → 查看构建日志                                   │</span></span>
<span class="line"><span>│     → 质量门槛检查 → 自动部署（可选）                             │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  4. 运维阶段                                                     │</span></span>
<span class="line"><span>│     → 查看历史记录 → 分析失败原因                                │</span></span>
<span class="line"><span>│     → 重新运行 → 回滚                                            │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br></div></div><h2 id="图形化流水线配置" tabindex="-1">图形化流水线配置 <a class="header-anchor" href="#图形化流水线配置" aria-label="Permalink to “图形化流水线配置”">​</a></h2><h3 id="阶段与步骤" tabindex="-1">阶段与步骤 <a class="header-anchor" href="#阶段与步骤" aria-label="Permalink to “阶段与步骤”">​</a></h3><div class="language-yaml line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># KubeSphere 图形化流水线会生成 Jenkinsfile</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 以下是生成的 Jenkinsfile 示例</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">pipeline {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  agent {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    kubernetes {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      label &#39;maven-agent&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      defaultContainer &#39;maven&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  environment {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    DOCKER_REGISTRY = &#39;harbor.example.com&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    APP_NAME = &#39;myapp&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    REGISTRY_CREDENTIAL = &#39;harbor-credential&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  stages {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;Checkout&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          checkout scm</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">        }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;Build&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          sh &#39;mvn clean package -DskipTests&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">        }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;Test&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          sh &#39;mvn test&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">        }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;SonarQube&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          withSonarQubeEnv(&#39;SonarQube&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">            sh &#39;mvn sonar:sonar&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">          }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">        }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;Build Image&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          sh &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">            docker build -t \${DOCKER_REGISTRY}/\${APP_NAME}:\${BUILD_NUMBER} .</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">            docker push \${DOCKER_REGISTRY}/\${APP_NAME}:\${BUILD_NUMBER}</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;Deploy to Dev&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        sh &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          sed &#39;s|IMAGE_TAG|\${BUILD_NUMBER}|g&#39; deploy/dev/deployment.yaml | kubectl apply -f -</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  post {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    always {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      cleanWs()</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    failure {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      echo &#39;Pipeline failed. Check logs.&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">}</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br><span class="line-number">26</span><br><span class="line-number">27</span><br><span class="line-number">28</span><br><span class="line-number">29</span><br><span class="line-number">30</span><br><span class="line-number">31</span><br><span class="line-number">32</span><br><span class="line-number">33</span><br><span class="line-number">34</span><br><span class="line-number">35</span><br><span class="line-number">36</span><br><span class="line-number">37</span><br><span class="line-number">38</span><br><span class="line-number">39</span><br><span class="line-number">40</span><br><span class="line-number">41</span><br><span class="line-number">42</span><br><span class="line-number">43</span><br><span class="line-number">44</span><br><span class="line-number">45</span><br><span class="line-number">46</span><br><span class="line-number">47</span><br><span class="line-number">48</span><br><span class="line-number">49</span><br><span class="line-number">50</span><br><span class="line-number">51</span><br><span class="line-number">52</span><br><span class="line-number">53</span><br><span class="line-number">54</span><br><span class="line-number">55</span><br><span class="line-number">56</span><br><span class="line-number">57</span><br><span class="line-number">58</span><br><span class="line-number">59</span><br><span class="line-number">60</span><br><span class="line-number">61</span><br><span class="line-number">62</span><br><span class="line-number">63</span><br><span class="line-number">64</span><br><span class="line-number">65</span><br><span class="line-number">66</span><br><span class="line-number">67</span><br><span class="line-number">68</span><br><span class="line-number">69</span><br><span class="line-number">70</span><br><span class="line-number">71</span><br><span class="line-number">72</span><br><span class="line-number">73</span><br><span class="line-number">74</span><br><span class="line-number">75</span><br><span class="line-number">76</span><br><span class="line-number">77</span><br><span class="line-number">78</span><br><span class="line-number">79</span><br><span class="line-number">80</span><br><span class="line-number">81</span><br></div></div><h3 id="常用构建片段" tabindex="-1">常用构建片段 <a class="header-anchor" href="#常用构建片段" aria-label="Permalink to “常用构建片段”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    常用构建片段                                    │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  Git 拉取                                                        │</span></span>
<span class="line"><span>│  - 从代码仓库拉取代码                                             │</span></span>
<span class="line"><span>│  - 支持 GitHub、GitLab、SVN                                      │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  Maven 构建                                                      │</span></span>
<span class="line"><span>│  - mvn clean package                                             │</span></span>
<span class="line"><span>│  - mvn test                                                      │</span></span>
<span class="line"><span>│  - mvn deploy                                                    │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  Docker 构建                                                     │</span></span>
<span class="line"><span>│  - 构建镜像                                                      │</span></span>
<span class="line"><span>│  - 推送到镜像仓库                                                │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  SonarQube 扫描                                                  │</span></span>
<span class="line"><span>│  - 代码质量检查                                                  │</span></span>
<span class="line"><span>│  - 质量门槛验证                                                  │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  部署到 Kubernetes                                              │</span></span>
<span class="line"><span>│  - kubectl apply                                                 │</span></span>
<span class="line"><span>│  - kubectl set image                                            │</span></span>
<span class="line"><span>│                                                                  │</span></span>
<span class="line"><span>│  二进制制品上传                                                  │</span></span>
<span class="line"><span>│  - 上传到 JFrog Artifactory                                      │</span></span>
<span class="line"><span>│  - 下载特定版本制品                                              │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br><span class="line-number">26</span><br><span class="line-number">27</span><br><span class="line-number">28</span><br></div></div><h2 id="凭证管理" tabindex="-1">凭证管理 <a class="header-anchor" href="#凭证管理" aria-label="Permalink to “凭证管理”">​</a></h2><p>KubeSphere 支持多种凭证类型：</p><div class="language-bash line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 1. 用户名密码</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 用途：Git 仓库登录、镜像仓库登录</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">username:</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> git-user</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">password:</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> git-password</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 2. SSH Key</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 用途：Git SSH 方式拉取代码</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">privateKey:</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> |</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">  -----BEGIN</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> RSA</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> PRIVATE</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> KEY-----</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">  ...</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> (SSH </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">私钥内容</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">)</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">  -----END</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> RSA</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> PRIVATE</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> KEY-----</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 3. Access Token</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 用途：GitHub/GitLab Personal Access Token</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">accessToken:</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> ghp_xxxxxxxxxxxxx</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 4. Kubernetes Config</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 用途：部署到 K8s 的凭证</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">kubeconfig:</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> |</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">  -----BEGIN</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> KUBECONFIG-----</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">  ...</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> (kubeconfig </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">内容</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">)</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">  -----END</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> KUBECONFIG-----</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br></div></div><h2 id="完整流水线示例" tabindex="-1">完整流水线示例 <a class="header-anchor" href="#完整流水线示例" aria-label="Permalink to “完整流水线示例”">​</a></h2><h3 id="java-maven-项目" tabindex="-1">Java Maven 项目 <a class="header-anchor" href="#java-maven-项目" aria-label="Permalink to “Java Maven 项目”">​</a></h3><div class="language-yaml line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># Java Maven 项目完整流水线</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">pipeline {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  agent {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    kubernetes {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      label &#39;maven-agent&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      defaultContainer &#39;maven&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  parameters {</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    string(name</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;TAG_NAME&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">defaultValue</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">description</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;镜像标签&#39;)</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    choice(name</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;ENV&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">choices</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: [</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;dev&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;test&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;prod&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">], </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">description</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;部署环境&#39;)</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  environment {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    DOCKER_REGISTRY = &#39;harbor.example.com&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    APP_NAME = &#39;java-app&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    REGISTRY_CREDENTIAL = credentials(&#39;harbor-credential&#39;)</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  stages {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;拉取代码&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        checkout scm</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;Maven 构建&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          sh &#39;mvn clean package -DskipTests&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">        }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;单元测试&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          sh &#39;mvn test&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">        }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;代码质量扫描&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          withSonarQubeEnv(&#39;SonarQube&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">            sh &#39;mvn sonar:sonar -Dsonar.projectKey=\${APP_NAME}&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">          }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">        }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;安全扫描&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;maven&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          sh &#39;&#39;&#39;</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">            # Trivy 镜像安全扫描</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">            trivy image --exit-code 0 --severity HIGH,CRITICAL \${DOCKER_REGISTRY}/\${APP_NAME}:\${TAG_NAME}</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          &#39;</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">&#39;&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;构建 Docker 镜像&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        container(&#39;docker&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          sh &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">            docker build -t \${DOCKER_REGISTRY}/\${APP_NAME}:\${TAG_NAME} .</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">            docker push \${DOCKER_REGISTRY}/\${APP_NAME}:\${TAG_NAME}</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;部署到开发环境&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      when {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        expression { params.ENV == &#39;dev&#39; }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        sh &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          kubectl set image deployment/\${APP_NAME} \${APP_NAME}=\${DOCKER_REGISTRY}/\${APP_NAME}:\${TAG_NAME} -n \${APP_NAME}-dev</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;部署到测试环境&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      when {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        expression { params.ENV == &#39;test&#39; }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        input message: &#39;是否部署到测试环境?&#39;, ok: &#39;确认&#39;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        sh &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">          kubectl set image deployment/\${APP_NAME} \${APP_NAME}=\${DOCKER_REGISTRY}/\${APP_NAME}:\${TAG_NAME} -n \${APP_NAME}-test</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        &quot;&quot;&quot;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      }</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    }</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">    stage(&#39;通知&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">      steps {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">        echo &quot;流水线执行完成&quot;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br><span class="line-number">26</span><br><span class="line-number">27</span><br><span class="line-number">28</span><br><span class="line-number">29</span><br><span class="line-number">30</span><br><span class="line-number">31</span><br><span class="line-number">32</span><br><span class="line-number">33</span><br><span class="line-number">34</span><br><span class="line-number">35</span><br><span class="line-number">36</span><br><span class="line-number">37</span><br><span class="line-number">38</span><br><span class="line-number">39</span><br><span class="line-number">40</span><br><span class="line-number">41</span><br><span class="line-number">42</span><br><span class="line-number">43</span><br><span class="line-number">44</span><br><span class="line-number">45</span><br><span class="line-number">46</span><br><span class="line-number">47</span><br><span class="line-number">48</span><br><span class="line-number">49</span><br><span class="line-number">50</span><br><span class="line-number">51</span><br><span class="line-number">52</span><br><span class="line-number">53</span><br><span class="line-number">54</span><br><span class="line-number">55</span><br><span class="line-number">56</span><br><span class="line-number">57</span><br><span class="line-number">58</span><br><span class="line-number">59</span><br><span class="line-number">60</span><br><span class="line-number">61</span><br><span class="line-number">62</span><br><span class="line-number">63</span><br><span class="line-number">64</span><br><span class="line-number">65</span><br><span class="line-number">66</span><br><span class="line-number">67</span><br><span class="line-number">68</span><br><span class="line-number">69</span><br><span class="line-number">70</span><br><span class="line-number">71</span><br><span class="line-number">72</span><br><span class="line-number">73</span><br><span class="line-number">74</span><br><span class="line-number">75</span><br><span class="line-number">76</span><br><span class="line-number">77</span><br><span class="line-number">78</span><br><span class="line-number">79</span><br><span class="line-number">80</span><br><span class="line-number">81</span><br><span class="line-number">82</span><br><span class="line-number">83</span><br><span class="line-number">84</span><br><span class="line-number">85</span><br><span class="line-number">86</span><br><span class="line-number">87</span><br><span class="line-number">88</span><br><span class="line-number">89</span><br><span class="line-number">90</span><br><span class="line-number">91</span><br><span class="line-number">92</span><br><span class="line-number">93</span><br><span class="line-number">94</span><br><span class="line-number">95</span><br><span class="line-number">96</span><br><span class="line-number">97</span><br><span class="line-number">98</span><br><span class="line-number">99</span><br><span class="line-number">100</span><br><span class="line-number">101</span><br><span class="line-number">102</span><br><span class="line-number">103</span><br><span class="line-number">104</span><br><span class="line-number">105</span><br></div></div><h2 id="质量门槛" tabindex="-1">质量门槛 <a class="header-anchor" href="#质量门槛" aria-label="Permalink to “质量门槛”">​</a></h2><div class="language-yaml line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># SonarQube 质量门槛配置</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 在 SonarQube 平台配置质量门</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 当以下条件不满足时，流水线会失败</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 质量门规则示例：</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># - 新代码覆盖率 &gt;= 80%</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># - 严重级别 Bug = 0</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># - 漏洞数 = 0</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># - 代码异味（Smell） &lt; 10 个</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># - 重复行数 &lt; 3%</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 在流水线中集成质量门</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">stage(&#39;SonarQube 质量门&#39;) {</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  steps {</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    waitForQualityGate abortPipeline</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">true</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br></div></div><h2 id="常见问题" tabindex="-1">常见问题 <a class="header-anchor" href="#常见问题" aria-label="Permalink to “常见问题”">​</a></h2><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>问题一：Agent Pod 无法启动</span></span>
<span class="line"><span>原因：没有足够的节点资源 / Docker in Docker 未配置</span></span>
<span class="line"><span>解决：</span></span>
<span class="line"><span>  - 检查节点资源</span></span>
<span class="line"><span>  - 确认 Jenkins Agent 镜像可用</span></span>
<span class="line"><span>  - 配置 Pod template</span></span>
<span class="line"><span></span></span>
<span class="line"><span>问题二：SonarQube 扫描失败</span></span>
<span class="line"><span>原因：SonarQube 服务不可达 / Token 过期</span></span>
<span class="line"><span>解决：</span></span>
<span class="line"><span>  - 检查 SonarQube 服务状态</span></span>
<span class="line"><span>  - 更新 SonarQube Credential</span></span>
<span class="line"><span>  - 确认 SonarQube 版本与 Maven 插件兼容</span></span>
<span class="line"><span></span></span>
<span class="line"><span>问题三：镜像构建超时</span></span>
<span class="line"><span>原因：Dockerfile 构建时间过长 / 网络问题</span></span>
<span class="line"><span>解决：</span></span>
<span class="line"><span>  - 优化 Dockerfile（减少层数、使用多阶段构建）</span></span>
<span class="line"><span>  - 配置更快的镜像仓库</span></span>
<span class="line"><span>  - 增加构建超时时间</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br></div></div><h2 id="面试追问方向" tabindex="-1">面试追问方向 <a class="header-anchor" href="#面试追问方向" aria-label="Permalink to “面试追问方向”">​</a></h2><ol><li><p><strong>KubeSphere 的图形化流水线是怎么工作的？</strong> 答：KubeSphere 提供图形化的 Jenkinsfile 编辑器，用户通过拖拽构建片段生成 Jenkinsfile。图形化配置会序列化为 Jenkinsfile 存储在 ConfigMap 中，Jenkins Master 读取并执行。实际上还是 Jenkins 在跑流水线，只是创建流水线的过程被图形化了。</p></li><li><p><strong>Jenkins Agent 在 KubeSphere 中是怎么运行的？</strong> 答：通过 Jenkins Kubernetes Plugin 实现。Jenkins Master 调度流水线时，在 K8s 中动态创建 Agent Pod（使用预设的 Pod Template），Agent Pod 中的容器执行构建步骤，执行完成后 Pod 被销毁。这种方式实现了构建环境的隔离和资源弹性。</p></li><li><p><strong>KubeSphere 的 CI/CD 和 GitLab CI 有什么区别？</strong> 答：KubeSphere 的 DevOps 基于 Jenkins，适合需要在 K8s 环境中运行构建、且希望有图形化流水线的团队。GitLab CI 基于 GitLab Runner，适合 GitLab 用户，配置简单但需要在 Kubernetes 中手动部署 Runner。两者都可以实现完整的 CI/CD，KubeSphere 的优势是与 K8s 平台深度集成。</p></li></ol><blockquote><p>&quot;KubeSphere 流水线的精髓，是让 Jenkins 不再是运维的专属工具。开发者自己就能创建流水线，自己配置部署环境，流水线失败了自己去查日志——这才是 DevOps 应该有的样子。&quot;</p></blockquote>`,25)])])}const F=n(l,[["render",e]]);export{u as __pageData,F as default};
