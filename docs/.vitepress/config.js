import { defineConfig } from 'vitepress'
import { nav } from './nav'
import { sidebar } from './sidebar'

// 根据 mode 参数获取 base 路径
const isProd = process.env.VITEPRESS_DEPLOY === 'true'
const base = isProd ? /**'/JTechVault/'**/ '/' : '/'

export default defineConfig({
  // ==================== 站点基础配置 ====================
  title: 'Guide',                             // 站点标题，显示在浏览器标签页
  description: "Java 面试指南 — 系统梳理 Java、计算机基础、数据库、框架、分布式等核心知识，覆盖面试高频考点",

  // 忽略死链接检查（文档内容较多，部分链接可能尚未创建）
  ignoreDeadLinks: true,

  // 部署路径，根据环境自动切换
  // 本地开发: / (根目录)
  // GitHub Pages: /Guide/
  base,

  // 站点语言，影响 HTML lang 属性和搜索功能
  lang: 'zh-CN',

  // ==================== <head> 标签配置 ====================
  head: [
    // 网站图标
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    // 响应式视口设置，移动端适配
    ['meta', { name: 'viewport', content: 'width=device-width,initial-scale=1' }],
    // 网站描述，用于搜索引擎索引
    ['meta', { name: 'description', content: 'Java 面试指南 — 系统梳理 Java、计算机基础、数据库、框架、分布式等核心知识，覆盖面试高频考点' }],
  ],

  // ==================== 主题配置 ====================
  themeConfig: {
    // 导航栏 Logo
    logo: '/images/logo.png',
    // 导航栏站点名称
    siteTitle: 'Guide',

    // 顶部导航栏配置
    nav: nav,

    // 侧边栏配置
    sidebar: sidebar,

    // 本地搜索配置
    // search: {
    //   provider: 'local',      // 使用 VitePress 内置本地搜索
    //   options: {
    //     detailedView: true,   // 搜索结果显示详细视图
    //     locales: {
    //       root: { // 如果你想翻译默认语言，请将此处设为 `root`
    //         translations: {
    //           button: {
    //             buttonText: '搜索',
    //             buttonAriaLabel: '搜索'
    //           },
    //           modal: {
    //             displayDetails: '显示详细列表',
    //             resetButtonTitle: '重置搜索',
    //             backButtonTitle: '关闭搜索',
    //             noResultsText: '没有结果',
    //             footer: {
    //               selectText: '选择',
    //               selectKeyAriaLabel: '输入',
    //               navigateText: '导航',
    //               navigateUpKeyAriaLabel: '上箭头',
    //               navigateDownKeyAriaLabel: '下箭头',
    //               closeText: '关闭',
    //               closeKeyAriaLabel: 'Esc'
    //             }
    //           }
    //         }
    //       }
    //     }
    //   },
    // },

    // 社交链接，显示在导航栏
    socialLinks: [
      { icon: 'github', link: 'https://github.com/xinrun0928/Guide.git' },
    ],

    // 页脚配置
    footer: {
      message: '基于 VitePress 构建',
      copyright: 'Copyright © 2025-2026 <a href="https://github.com/xinrun0928/Guide">Guide</a>',
    },

    // 编辑链接，引导用户到 GitHub 编辑页面
    editLink: {
      pattern: 'https://github.com/xinrun0928/Guide/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    // 最后更新时间配置
    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',   // 日期样式：短格式
        timeStyle: 'short',   // 时间样式：短格式
      },
    },

    // 文档底部导航（上一篇/下一篇）
    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    // 右侧大纲配置
    outline: {
      level: [2, 3],          // 显示 h2 和 h3 级别的标题
      label: '目录',
    },
  },

  // ==================== Markdown 配置 ====================
  markdown: {
    // 代码高亮主题
    theme: {
      light: 'github-light',  // 浅色模式主题
      dark: 'github-dark',    // 深色模式主题
    },
    lineNumbers: true,         // 是否在代码块显示行号
    nativeHtml: false, // 关键：关闭原生 HTML 解析
    vPre: true,          // 代码块不解析模板

    // Shiki 未内置的 fence 语言名：映射到已有语法，避免回退为 txt 并消除构建警告
    // @see https://vitepress.dev/zh/guide/markdown#markdown-options
    languageAlias: {
      jinja2: 'jinja',   // Ansible 模板等（Shiki 语言 id 为 jinja）
      promql: 'sql',     // PromQL 无独立 grammar，用类查询高亮近似展示
      conf: 'ruby',      // Logstash 等 DSL 与 Ruby 块语法较接近
    },

      // 👇 只加载你用到的语言，速度爆炸提升
    codeTransformers: [
      {
        code(node) {
          node.langs = ['java', 'yaml', 'go', 'python', 'markdown']
        }
      }
    ],

    // Markdown 扩展配置，可添加自定义插件
    config: (md) => {
      // VitePress 会把 Markdown 渲染结果继续交给 Vue 编译。
      // 但很多文章里会出现 `{{ ... }}`（如 Helm/Go template），Vue 会误把它当成插值语法并在构建时报错。
      // 这里把 `{{` / `}}` 预先转义为 HTML 实体，避免 Vue 在解析阶段触发插值。
      // 同时转义 `</` 防止 Vue 把 YAML 中的 `export:` `endpoints:` 等误认为 HTML 标签
      const escapeVueMustache = (s) =>
        s
          .replace(/{{/g, '&#123;&#123;')
          .replace(/}}/g, '&#125;&#125;')
          .replace(/</g, '&lt;')

      const visitToken = (token) => {
        if (!token) return
        if (typeof token.content === 'string') {
          token.content = escapeVueMustache(token.content)
        }
        if (Array.isArray(token.children)) {
          for (const child of token.children) visitToken(child)
        }
      }

      md.core.ruler.push('escape_vue_mustache', (state) => {
        if (!state || !Array.isArray(state.tokens)) return
        for (const token of state.tokens) visitToken(token)
      })
    },
  },

  // ==================== Vite 配置 ====================
  vite: {
    ssr: {
      noExternal: ['vitepress'] // 减少内存占用
    },
    server: {
      port: 3000,              // 开发服务器端口
      host: true,              // 允许外部访问（0.0.0.0）
    },
    build: {
      minify: false,          // 关闭代码压缩（打包速度提升 50%+）
      sourcemap: false, // 关闭 sourcemap（大幅减内存）
      minify: 'esbuild', // 最快压缩
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        maxParallelFileOps: 10, // 多线程并行处理
        output: {
          // 手动分块：避免单文件过大
          manualChunks(id) {
            if (id.includes('node_modules')) return 'vendor'
            if (id.includes('theme')) return 'theme'
            if (id.includes('docs')) return 'docs'
          }
        }
      }
    },
    optimizeDeps: {
      exclude: ['vitepress'], // 禁用预构建（大幅省内存）
      noDiscovery: true // 关闭依赖预扫描
    }
  },

  // 是否生成干净的 URL（无 .html 后缀）
  cleanUrls: true,

  
})
