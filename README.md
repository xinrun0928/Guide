# Java 面试指南

系统梳理 Java 后端核心知识，覆盖面试高频考点，助你从容应对技术面试。

---

## 知识体系

本项目涵盖 Java 后端面试的九大核心模块：

| 模块 | 路径 | 核心内容 |
|------|------|----------|
| **面试准备** | [/interview/](/interview/index) | 简历优化、算法训练、系统设计 |
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

## 项目结构

```
Guide/
├── docs/                          # 文档目录
│   ├── index.md                   # 首页
│   ├── interview/                 # 面试准备
│   ├── java/                      # Java
│   ├── cs/                        # 计算机基础
│   ├── database/                  # 数据库
│   ├── framework/                 # 常用框架
│   ├── distributed/               # 分布式架构
│   ├── high-performance/          # 高性能与高可用
│   ├── middleware/                # 中间件
│   ├── devops/                    # 工程化与运维
│   └── .vitepress/                # VitePress 配置
│       ├── config.js              # 主配置
│       ├── nav.js                 # 导航栏
│       ├── sidebar.js             # 侧边栏
│       └── sidebar/               # 各模块侧边栏
├── .cursor/
│   └── rules/                    # Cursor AI 规则
│       ├── java-interview.mdc     # Java 面试知识规范
│       ├── vitepress-docs.mdc     # VitePress 文档规范
│       ├── vitepress-writing.mdc  # 文档写作规范
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
4. 面试常考点使用标记突出

### 提交前检查

- [ ] 技术内容准确无误
- [ ] 代码示例可运行
- [ ] 链接目标存在
- [ ] 无泛型未转义问题
- [ ] 符合写作风格指南

---

## License

MIT
