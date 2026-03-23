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
  // GitHub Pages: /DBInsight/
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
    search: {
      provider: 'local',      // 使用 VitePress 内置本地搜索
      options: {
        detailedView: true,   // 搜索结果显示详细视图
        locales: {
          root: { // 如果你想翻译默认语言，请将此处设为 `root`
            translations: {
              button: {
                buttonText: '搜索',
                buttonAriaLabel: '搜索'
              },
              modal: {
                displayDetails: '显示详细列表',
                resetButtonTitle: '重置搜索',
                backButtonTitle: '关闭搜索',
                noResultsText: '没有结果',
                footer: {
                  selectText: '选择',
                  selectKeyAriaLabel: '输入',
                  navigateText: '导航',
                  navigateUpKeyAriaLabel: '上箭头',
                  navigateDownKeyAriaLabel: '下箭头',
                  closeText: '关闭',
                  closeKeyAriaLabel: 'Esc'
                }
              }
            }
          }
        }
      },
    },

    // 社交链接，显示在导航栏
    socialLinks: [
      { icon: 'github', link: 'https://github.com/xinrun0928/DBInsight.git' },
    ],

    // 页脚配置
    footer: {
      message: '基于 VitePress 构建',
      copyright: 'Copyright © 2025-2026 <a href="https://github.com/xinrun0928/DBInsight">DBInsight</a>',
    },

    // 编辑链接，引导用户到 GitHub 编辑页面
    editLink: {
      pattern: 'https://github.com/xinrun0928/DBInsight/edit/main/docs/:path',
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

    // Markdown 扩展配置，可添加自定义插件
    config: (md) => {
      // 添加自定义 markdown 扩展
    },
  },

  // ==================== Vite 配置 ====================
  vite: {
    server: {
      port: 3000,              // 开发服务器端口
      host: true,              // 允许外部访问（0.0.0.0）
    },
    build: {
      // 超过此大小的 chunk 会触发警告（单位：KB）
      chunkSizeWarningLimit: 1500,
    },
  },

  // 是否生成干净的 URL（无 .html 后缀）
  cleanUrls: true,

  
})
