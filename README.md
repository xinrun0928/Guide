# Java 面试指南

系统梳理 Java 后端核心知识，覆盖面试高频考点，助你从容应对技术面试。

---

## 知识体系

本项目涵盖 Java 后端面试的九大核心模块：

| 模块 | 路径 | 核心内容 |
|------|------|----------|
| **面试准备** | [/interview/](/interview/index) | 简历优化、算法训练、系统设计、HR 面、面试复盘 |
| **Java** | [/java/](/java/index) | JVM、并发编程、集合框架、新特性 |
| **计算机基础** | [/cs/](/cs/index) | 操作系统、计算机网络、数据结构与算法 |
| **数据库** | [/database/](/database/index) | MySQL（索引、事务、锁）、Redis（缓存、持久化、集群） |
| **常用框架** | [/framework/](/framework/index) | Spring IoC/AOP、Spring Boot 自动装配、MyBatis |
| **分布式架构** | [/distributed/](/distributed/index) | CAP/BASE、分布式事务、一致性算法、分布式锁 |
| **高性能与高可用** | [/high-performance/](/high-performance/index) | 性能优化、缓存策略、限流熔断、负载均衡 |
| **中间件** | [/middleware/](/middleware/index) | Kafka、RabbitMQ、RocketMQ、Dubbo、gRPC、Nacos、Gateway |
| **工程化与运维** | [/devops/](/devops/index) | Docker、Kubernetes、CI/CD、监控与日志 |

---

## 快速开始

### 安装依赖

```bash
npm install
```

### 本地开发

```bash
npm run dev
```

访问 http://localhost:3000 查看文档。

### 构建生产版本

```bash
npm run build
```

### 部署

```bash
npm run deploy
```

---

## 知识图谱

```
Java 后端面试知识体系
│
├── Java 基础
│   ├── 基本类型与包装类
│   ├── String 不可变性与常量池
│   ├── 面向对象（封装、继承、多态）
│   └── 异常体系
│
├── 集合框架
│   ├── List（ArrayList、LinkedList、Vector、CopyOnWriteArrayList）
│   ├── Set（HashSet、LinkedHashSet、TreeSet）
│   ├── Map（HashMap、LinkedHashMap、TreeMap、ConcurrentHashMap）
│   └── Queue（PriorityQueue、ArrayDeque、BlockingQueue）
│
├── 并发编程
│   ├── 线程基础与状态转换
│   ├── 线程同步（synchronized、volatile、Lock）
│   ├── 线程通信（wait/notify、Condition、CountDownLatch）
│   ├── JUC 工具类（Atomic、ConcurrentHashMap）
│   ├── 线程池（ThreadPoolExecutor、Executors）
│   └── JMM 与 happens-before
│
├── JVM
│   ├── 运行时数据区（堆、栈、方法区）
│   ├── 垃圾回收（算法、收集器、GC 日志）
│   ├── 类加载机制与双亲委派
│   ├── 字节码与 JIT 编译
│   └── 性能调优与故障排查
│
├── MySQL
│   ├── 存储引擎（InnoDB vs MyISAM）
│   ├── 索引（B+ 树、Hash、联合索引、最左前缀）
│   ├── 事务（ACID、隔离级别、MVCC）
│   ├── 锁（行锁、表锁、意向锁、间隙锁）
│   ├── 日志（redo log、undo log、binlog）
│   └── 主从复制与读写分离
│
├── Redis
│   ├── 数据结构（SDS、QuickList、ziplist、skiplist）
│   ├── 持久化（RDB、AOF、混合持久化）
│   ├── 缓存策略（Cache Aside、穿透、击穿、雪崩）
│   ├── 集群（主从、哨兵、Cluster）
│   └── 线程模型与 I/O 多路复用
│
├── Spring
│   ├── IoC（Bean 生命周期、依赖注入、循环依赖）
│   ├── AOP（代理方式、通知类型、切面表达式）
│   ├── 事务（传播行为、失效场景）
│   └── 源码（refresh 流程、后置处理器）
│
├── 分布式
│   ├── CAP 与 BASE 理论
│   ├── 分布式事务（2PC、3PC、TCC、Saga）
│   ├── 一致性算法（Paxos、Raft、ZAB）
│   ├── 分布式锁（Redis、ZooKeeper、etcd）
│   └── 负载均衡与服务治理
│
└── 消息队列
    ├── Kafka（分区、副本、消费者组、可靠性）
    ├── RabbitMQ（Exchange、路由、死信队列）
    └── RocketMQ（事务消息、延迟消息、顺序消息）
```

---

## 面试高频考点

### 面试准备

- [ ] 简历优化：STAR 法则、项目亮点提炼、技术栈分层
- [ ] 算法训练：双指针、哈希表、动态规划、回溯、二分查找
- [ ] 系统设计：Scale 估算、高并发架构、缓存策略、CAP 理论
- [ ] HR 面与谈薪：离职原因、薪资谈判、offer 评估

### Java

- [ ] HashMap JDK 7 vs JDK 8 实现差异
- [ ] synchronized 锁升级过程
- [ ] volatile 内存语义与内存屏障
- [ ] ThreadLocal 内存泄漏问题
- [ ] 线程池参数与工作流程
- [ ] JVM 内存模型与 GC 算法
- [ ] 类加载机制与双亲委派

### MySQL

- [ ] InnoDB vs MyISAM 核心差异
- [ ] B+ 树索引原理与最左前缀
- [ ] 事务隔离级别与 MVCC
- [ ] MySQL 锁类型与死锁避免
- [ ] 主从复制原理与延迟问题
- [ ] 分库分表策略与问题

### Redis

- [ ] 5 种数据结构与底层编码
- [ ] RDB vs AOF 持久化对比
- [ ] 缓存穿透、击穿、雪崩解决方案
- [ ] Sentinel vs Cluster 选型
- [ ] Redis 分布式锁实现
- [ ] I/O 多路复用与事件处理

### 分布式

- [ ] CAP 理论及其应用
- [ ] 2PC/3PC/TCC 分布式事务方案
- [ ] Raft 共识算法核心流程
- [ ] 消息队列如何保证可靠性
- [ ] 限流算法与实现
- [ ] 熔断与降级策略

---

## 面试准备模块速览

本项目的 `interview/` 模块包含 **68 篇文档**，覆盖面试全流程：

### 简历优化（7 篇）

| 文章 | 核心内容 |
|------|----------|
| [一份优秀简历的标准](/interview/resume/standard) | 好简历的五个标准与常见问题 |
| [简历各模块写法](/interview/resume/write) | 个人信息、技术栈、项目经历的正确写法 |
| [STAR 法则](/interview/resume/star) | 用 STAR 法则写出有说服力的项目描述 |
| [项目经历包装](/interview/resume/project) | 让普通项目看起来有亮点 |
| [简历常见问题与修改建议](/interview/resume/problem) | 十大高频简历问题与解决方案 |
| [技术简历模板参考](/interview/resume/template) | 各经验层级简历模板参考 |

### 算法训练（16 篇）

| 文章 | 核心内容 |
|------|----------|
| [双指针与滑动窗口](/interview/algorithm/array-linkedlist) | 对撞指针、快慢指针、滑动窗口 |
| [哈希表高频题](/interview/algorithm/hash) | 两数之和、字母异位词、最长连续序列 |
| [栈与队列](/interview/algorithm/stack-queue) | 有效括号、单调栈、单调队列 |
| [二叉树高频题](/interview/algorithm/binary-tree) | 遍历、路径和、最近公共祖先 |
| [动态规划高频题](/interview/algorithm/dp) | 背包、打家劫舍、股票买卖 |
| [回溯高频题](/interview/algorithm/backtracking) | 全排列、组合、N 皇后 |
| [二分查找高频题](/interview/algorithm/binary-search) | 旋转数组、搜索区间 |
| [排序算法高频题](/interview/algorithm/sort) | 快排、归并、TopK |
| [单调栈专题](/interview/algorithm/monotonic-stack) | Next Greater Element、接雨水、最大矩形 |
| [前缀和与差分数组](/interview/algorithm/prefix-sum) | 区间查询、区间修改 |
| [位运算技巧](/interview/algorithm/bit) | 异或运算、位掩码实战 |
| [并查集](/interview/algorithm/union-find) | 朋友圈数量、岛屿数量 |
| [字典树](/interview/algorithm/trie) | 前缀匹配、异或问题 |
| [线段树与树状数组](/interview/algorithm/segment-tree) | 区间查询与修改 |
| [LeetCode 高效刷题方法](/interview/algorithm/method) | 分类刷题、三遍法则、模板提炼 |
| [面试算法题类型总结](/interview/algorithm/summary) | 五大高频类型全景图与应对策略 |

### 系统设计（27 篇）

| 分类 | 核心文章 |
|------|----------|
| **系统设计基础** | [面试方法论](/interview/system-design/method)、[CAP 理论](/interview/system-design/cap)、[一致性哈希](/interview/system-design/consistent-hash)、[分库分表](/interview/system-design/sharding)、[消息队列](/interview/system-design/mq)、[缓存策略](/interview/system-design/cache) |
| **经典系统设计题** | [短链接系统](/interview/system-design/url-shortener)、[时间线推送](/interview/system-design/timeline)、[分布式 ID](/interview/system-design/id-generator)、[延迟消息队列](/interview/system-design/delay-queue)、[排行榜/热搜](/interview/system-design/ranking)、[Redis 三穿透](/interview/system-design/redis-cache)、[秒杀系统](/interview/system-design/seckill)、[抢票系统](/interview/system-design/ticket)、[Auto Complete](/interview/system-design/autocomplete)、[关注/粉丝系统](/interview/system-design/follow)、[分布式锁](/interview/system-design/distributed-lock)、[OTP 系统](/interview/system-design/otp)、[Feed 流](/interview/system-design/feed)、[红包雨/抽奖](/interview/system-design/redpacket)、[配置中心](/interview/system-design/config-center) |
| **架构设计思想** | [可扩展架构](/interview/system-design/scalability)、[高可用](/interview/system-design/availability)、[一致性](/interview/system-design/consistency)、[容量规划](/interview/system-design/capacity)、[微服务拆分](/interview/system-design/microservices) |

### HR 面与谈薪（9 篇）

| 文章 | 核心内容 |
|------|----------|
| [HR 常问问题汇总](/interview/hr/common-question) | 高频 HR 问题与应对话术 |
| [自我介绍](/interview/hr/self-intro) | 3 分钟展现优势的自我介绍框架 |
| [离职原因](/interview/hr/leave-reason) | 得体表达离职原因的技巧 |
| [职业规划](/interview/hr/career) | 技术路线 vs 管理路线的选择 |
| [期望薪资](/interview/hr/salary) | 薪资谈判拿到高 offer 的策略 |
| [福利待遇](/interview/hr/benefits) | 如何全面评估 offer 的真实价值 |
| [反向提问](/interview/hr/ask-interviewer) | 问面试官什么加分 |
| [背调注意事项](/interview/hr/background-check) | 背调流程与注意事项 |

### 面试经验与复盘（7 篇）

| 文章 | 核心内容 |
|------|----------|
| [如何高效准备技术面试](/interview/review/prepare) | 从知识体系到心态的全方位准备方案 |
| [面试高频问题分类与回答框架](/interview/review/question) | 技术问题分类与结构化回答方法 |
| [面试沟通技巧](/interview/review/communication) | 如何清晰表达技术方案与思考过程 |
| [面试复盘模板](/interview/review/template) | 面试复盘的标准模板 |
| [如何应对压力面与追问](/interview/review/stress) | 压力面的应对策略 |
| [面试凉了怎么办](/interview/review/after-fail) | 调整心态、总结复盘、继续投递 |

---

## 项目结构

```
Guide/
├── docs/                          # 文档目录
│   ├── index.md                   # 首页
│   ├── interview/                 # 面试准备（68 篇）
│   │   ├── index.md
│   │   ├── resume/               # 简历优化（6 篇）
│   │   ├── algorithm/            # 算法训练（15 篇）
│   │   ├── system-design/       # 系统设计（26 篇）
│   │   ├── hr/                  # HR 面与谈薪（8 篇）
│   │   └── review/              # 面试经验与复盘（6 篇）
│   ├── java/                      # Java
│   ├── cs/                        # 计算机基础
│   ├── database/                  # 数据库
│   ├── framework/                 # 常用框架
│   ├── distributed/               # 分布式架构
│   ├── high-performance/          # 高性能与高可用
│   ├── middleware/               # 中间件
│   ├── devops/                  # 工程化与运维
│   └── .vitepress/              # VitePress 配置
│       ├── config.js              # 主配置
│       ├── nav.js                 # 导航栏
│       ├── sidebar.js             # 侧边栏
│       └── sidebar/               # 各模块侧边栏
├── .cursor/
│   └── rules/                    # Cursor AI 规则
│       ├── vitepress-docs.mdc     # VitePress 文档规范
│       ├── vitepress-writing.mdc  # 文档写作规范（含代码语言规范）
│       └── doc-common-mistakes.mdc # 常见错误避坑
├── package.json
└── README.md
```

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 文档规范

1. 文件放在正确的模块目录下
2. 链接使用绝对路径 `/module/xxx`
3. 代码中的泛型使用 HTML 转义符（如 `List&lt;String&gt;`）
4. **代码示例必须使用 Java 语言**，关键逻辑加注释说明「为什么这样做」
5. AI 生成的文档**不包含 frontmatter 头信息**（`---`、`title`、`date`）
6. 面试常考点使用标记突出

### 提交前检查

- [ ] 技术内容准确无误
- [ ] 代码示例为 Java 且关键处有注释
- [ ] 链接目标存在，无泛型未转义问题
- [ ] 不含 frontmatter 头信息
- [ ] 符合写作风格指南，有钩子式开头和记忆点

---

## License

MIT
