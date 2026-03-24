import{_ as n,o as a,c as p,ak as i}from"./chunks/framework.DwHlt8HN.js";const d=JSON.parse('{"title":"文件系统：FCB与索引节点","description":"","frontmatter":{},"headers":[],"relativePath":"cs/os/file-system.md","filePath":"cs/os/file-system.md","lastUpdated":1774353797000}'),l={name:"cs/os/file-system.md"};function e(r,s,c,t,b,h){return a(),p("div",null,[...s[0]||(s[0]=[i(`<h1 id="文件系统-fcb与索引节点" tabindex="-1">文件系统：FCB与索引节点 <a class="header-anchor" href="#文件系统-fcb与索引节点" aria-label="Permalink to “文件系统：FCB与索引节点”">​</a></h1><p>你有没有想过，当你保存一个文件时，这个文件到底存在了哪里？ 操作系统是怎么知道这个文件有多长、叫什么、在磁盘的哪个位置？</p><p>答案就在两个核心概念里：<strong>FCB</strong>和<strong>索引节点（inode）</strong>。</p><h2 id="从文件到磁盘-中间发生了什么" tabindex="-1">从文件到磁盘：中间发生了什么？ <a class="header-anchor" href="#从文件到磁盘-中间发生了什么" aria-label="Permalink to “从文件到磁盘：中间发生了什么？”">​</a></h2><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌──────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    文件系统层次结构                        │</span></span>
<span class="line"><span>├──────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  用户程序                                               │</span></span>
<span class="line"><span>│     ↓                                                   │</span></span>
<span class="line"><span>│  系统调用（open, read, write, close）                     │</span></span>
<span class="line"><span>│     ↓                                                   │</span></span>
<span class="line"><span>│  虚拟文件系统（VFS）                                      │</span></span>
<span class="line"><span>│     ↓                                                   │</span></span>
<span class="line"><span>│  具体文件系统（Ext4, NTFS, FAT32）                        │</span></span>
<span class="line"><span>│     ↓                                                   │</span></span>
<span class="line"><span>│  块设备层（磁盘控制器）                                    │</span></span>
<span class="line"><span>│     ↓                                                   │</span></span>
<span class="line"><span>│  物理磁盘（扇区）                                        │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>└──────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br></div></div><h2 id="fcb-文件控制块" tabindex="-1">FCB：文件控制块 <a class="header-anchor" href="#fcb-文件控制块" aria-label="Permalink to “FCB：文件控制块”">​</a></h2><p><strong>FCB（File Control Block）</strong>是文件系统中描述一个文件的数据结构。 每个文件都有一个FCB，包含文件的所有元数据。</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌──────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    FCB结构（典型）                        │</span></span>
<span class="line"><span>├──────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  ┌──────────────────────────────────────────────────┐   │</span></span>
<span class="line"><span>│  │ 文件名        │ 文件类型       │ 访问权限           │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ 文件大小      │ 创建时间       │ 修改时间           │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ 所有者ID     │ 所属组ID      │ 链接数             │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ 文件数据位置  │ (磁盘块号列表) │                   │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │  文件状态     │  引用计数      │                   │   │</span></span>
<span class="line"><span>│  └──────────────────────────────────────────────────┘   │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>└──────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br></div></div><h3 id="目录项-directory-entry" tabindex="-1">目录项（Directory Entry） <a class="header-anchor" href="#目录项-directory-entry" aria-label="Permalink to “目录项（Directory Entry）”">​</a></h3><p>FCB太大了，不能直接放在目录里。所以目录里放的是<strong>目录项</strong>，是FCB的简化版。</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌──────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    目录项结构                             │</span></span>
<span class="line"><span>├──────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  Linux (Ext2/3/4):                                     │</span></span>
<span class="line"><span>│  ┌──────────────────────────────┐                       │</span></span>
<span class="line"><span>│  │ inode编号 (4字节)             │ 文件名 (可变长)         │   │</span></span>
<span class="line"><span>│  └──────────────────────────────┘                       │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  FAT32:                                                │</span></span>
<span class="line"><span>│  ┌──────────────────────────────┐                       │</span></span>
<span class="line"><span>│  │ 文件名 (8+3字节)             │ FCB起始簇号            │   │</span></span>
<span class="line"><span>│  └──────────────────────────────┘                       │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  NTFS:                                                 │</span></span>
<span class="line"><span>│  ┌──────────────────────────────────────────────┐      │</span></span>
<span class="line"><span>│  │ 文件名 (Unicode)           │ MFT记录号             │   │</span></span>
<span class="line"><span>│  └──────────────────────────────────────────────┘      │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>└──────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br></div></div><h2 id="inode-unix的革命性设计" tabindex="-1">inode：Unix的革命性设计 <a class="header-anchor" href="#inode-unix的革命性设计" aria-label="Permalink to “inode：Unix的革命性设计”">​</a></h2><p><strong>inode（Index Node）</strong>是Unix/Linux文件系统的心脏。 它解决了FCB的直接访问问题——目录项只需要存储inode编号。</p><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>┌──────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                    inode结构（Ext4）                      │</span></span>
<span class="line"><span>├──────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  ┌──────────────────────────────────────────────────┐   │</span></span>
<span class="line"><span>│  │ mode (文件类型 + 权限)                           │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ uid (所有者用户ID)     │ size (文件大小)           │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ atime (访问时间)       │ mtime (修改时间)          │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ ctime (属性改变时间)   │ dtime (删除时间)          │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ gid (所属组ID)        │ links_count (链接数)       │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ blocks (占用块数)      │ flags (Ext4特性)          │   │</span></span>
<span class="line"><span>│  ├──────────────────────────────────────────────────┤   │</span></span>
<span class="line"><span>│  │ 15个块指针:                                    │   │</span></span>
<span class="line"><span>│  │   12个直接块                                  │   │</span></span>
<span class="line"><span>│  │   1个一级间接块                               │   │</span></span>
<span class="line"><span>│  │   1个二级间接块                               │   │</span></span>
<span class="line"><span>│  │   1个三级间接块                               │   │</span></span>
<span class="line"><span>│  └──────────────────────────────────────────────────┘   │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>└──────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br></div></div><h3 id="inode如何定位文件数据" tabindex="-1">inode如何定位文件数据？ <a class="header-anchor" href="#inode如何定位文件数据" aria-label="Permalink to “inode如何定位文件数据？”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>inode中的15个块指针：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>┌──────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  直接块指针(12个):                                        │</span></span>
<span class="line"><span>│  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐               │</span></span>
<span class="line"><span>│  │D0│D1│D2│D3│D4│D5│D6│D7│D8│D9│D10│D11│              │</span></span>
<span class="line"><span>│  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘               │</span></span>
<span class="line"><span>│  每个指向一个磁盘数据块                                     │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  一级间接块(1个):                                        │</span></span>
<span class="line"><span>│  ┌─────────────────────┐                                │</span></span>
<span class="line"><span>│  │  间接块指针表        │ ──→ [P0][P1][P2]...[P255]   │</span></span>
<span class="line"><span>│  └─────────────────────┘        ↓                         │</span></span>
<span class="line"><span>│                            数据块D                        │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  二级间接块(1个):                                        │</span></span>
<span class="line"><span>│  ┌─────────────────────┐                                │</span></span>
<span class="line"><span>│  │  二级间接指针表      │ ──→ [I1][I2]...[I255]        │</span></span>
<span class="line"><span>│  └─────────────────────┘      ↓                         │</span></span>
<span class="line"><span>│                         ┌─────────────────────┐          │</span></span>
<span class="line"><span>│                         │  一级间接指针表      │          │</span></span>
<span class="line"><span>│                         └─────────────────────┘          │</span></span>
<span class="line"><span>│                                  ↓                        │</span></span>
<span class="line"><span>│                            [P0][P1]...[P255]            │</span></span>
<span class="line"><span>│                                  ↓                        │</span></span>
<span class="line"><span>│                               数据块D                     │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>│  三级间接块(1个):                                        │</span></span>
<span class="line"><span>│  ┌─────────────────────┐                                │</span></span>
<span class="line"><span>│  │  三级间接指针表      │                                │</span></span>
<span class="line"><span>│  └─────────────────────┘                                │</span></span>
<span class="line"><span>│       ↓                                                   │</span></span>
<span class="line"><span>│  指向多个二级间接块                                        │</span></span>
<span class="line"><span>│       ↓                                                   │</span></span>
<span class="line"><span>│  指向多个一级间接块                                        │</span></span>
<span class="line"><span>│       ↓                                                   │</span></span>
<span class="line"><span>│  指向多个数据块                                            │</span></span>
<span class="line"><span>│                                                          │</span></span>
<span class="line"><span>└──────────────────────────────────────────────────────────┘</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br><span class="line-number">26</span><br><span class="line-number">27</span><br><span class="line-number">28</span><br><span class="line-number">29</span><br><span class="line-number">30</span><br><span class="line-number">31</span><br><span class="line-number">32</span><br><span class="line-number">33</span><br><span class="line-number">34</span><br><span class="line-number">35</span><br><span class="line-number">36</span><br><span class="line-number">37</span><br><span class="line-number">38</span><br><span class="line-number">39</span><br><span class="line-number">40</span><br></div></div><h3 id="inode的最大文件大小" tabindex="-1">inode的最大文件大小 <a class="header-anchor" href="#inode的最大文件大小" aria-label="Permalink to “inode的最大文件大小”">​</a></h3><div class="language- line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span>计算方式（假设块大小4KB）：</span></span>
<span class="line"><span></span></span>
<span class="line"><span>直接块: 12 × 4KB = 48KB</span></span>
<span class="line"><span></span></span>
<span class="line"><span>一级间接: 256 × 4KB = 1MB</span></span>
<span class="line"><span>(256个指针，每个4字节)</span></span>
<span class="line"><span></span></span>
<span class="line"><span>二级间接: 256² × 4KB = 256MB</span></span>
<span class="line"><span>(256 × 256个指针)</span></span>
<span class="line"><span></span></span>
<span class="line"><span>三级间接: 256³ × 4KB = 64GB</span></span>
<span class="line"><span></span></span>
<span class="line"><span>总最大文件大小 ≈ 64GB + 256MB + 1MB + 48KB ≈ 64.26GB</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br></div></div><h3 id="硬链接-vs-软链接" tabindex="-1">硬链接 vs 软链接 <a class="header-anchor" href="#硬链接-vs-软链接" aria-label="Permalink to “硬链接 vs 软链接”">​</a></h3><div class="language-java line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 硬链接：多个目录项指向同一个inode</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 特点：</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// - 不能跨文件系统</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// - 不能链接目录</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// - 删除只是减少链接数</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// - 所有链接地位相同</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">public</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> class</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> HardLink</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> {</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    public</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> static</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> void</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> main</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">String</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">[] </span><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">args</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">) </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">throws</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> IOException {</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // 创建硬链接</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // ln source.txt hardlink.txt</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // 两个文件名指向同一个inode</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // inode中的links_count = 2</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br></div></div><div class="language-java line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 软链接（符号链接）：一种特殊文件，内容是另一个文件的路径</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 特点：</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// - 可以跨文件系统</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// - 可以链接目录</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// - 删除原文件，软链接失效</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// - 类似Windows快捷方式</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">public</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> class</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> SoftLink</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> {</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">    public</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> static</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> void</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> main</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">String</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">[] </span><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">args</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">) </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">throws</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> IOException {</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // 创建软链接</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // ln -s source.txt softlink.txt</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // softlink.txt的内容是 &quot;source.txt&quot;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br></div></div><h2 id="实际案例-ext4文件系统" tabindex="-1">实际案例：Ext4文件系统 <a class="header-anchor" href="#实际案例-ext4文件系统" aria-label="Permalink to “实际案例：Ext4文件系统”">​</a></h2><div class="language-c line-numbers-mode"><button title="Copy Code" class="copy"></button><span class="lang">c</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// Ext4的inode结构</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">struct</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> ext4_inode {</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le16  i_mode;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">         // 文件模式（类型+权限）</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le16  i_uid;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">          // UID</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_size_lo;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">      // 低32位文件大小</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_atime;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // 访问时间</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_ctime;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // 创建时间</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_mtime;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // 修改时间</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_dtime;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // 删除时间</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_gid;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">          // GID</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le16  i_links_count;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">  // 硬链接计数</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_blocks_lo;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    // 占用的块数（512字节单位）</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_flags;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">        // 文件标志</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_osd1;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">         // OS相关</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  </span><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">i_block</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">[</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">15</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">];</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    // 15个块指针！</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_generation;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">   // 文件版本（用于NFS）</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_file_acl_lo;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">  // ACL</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_size_high;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    // 高32位文件大小</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    __le32  i_obso_faddr;</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">   // 废弃</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">    // ...</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">};</span></span></code></pre><div class="line-numbers-wrapper" aria-hidden="true"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br></div></div><p>Ext4的改进：</p><ul><li><strong>Extent存储</strong>：用区间代替块指针，减少元数据开销</li><li><strong>延迟分配</strong>：优化写入性能</li><li><strong>日志（Journal）</strong>：保证文件系统一致性</li></ul><h2 id="面试追问方向" tabindex="-1">面试追问方向 <a class="header-anchor" href="#面试追问方向" aria-label="Permalink to “面试追问方向”">​</a></h2><ul><li><strong>FCB和inode的区别是什么？</strong> 提示：FCB在内存，inode在磁盘。</li><li><strong>inode如何定位大文件的数据块？</strong> 提示：直接块、一级/二级/三级间接块。</li><li><strong>硬链接和软链接的区别是什么？</strong> 提示：是否共享inode、能否跨文件系统、能否链接目录。</li><li><strong>为什么目录也是一个文件？</strong> 提示：目录内容是目录项的列表。</li></ul>`,27)])])}const u=n(l,[["render",e]]);export{d as __pageData,u as default};
