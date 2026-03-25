# Java 17+ 新特性

Java 在 JDK 8 之后迎来了黄金时代——每隔半年都有新特性发布，LTS 版本从 JDK 8 升级到了 JDK 17 和 JDK 21。

从 Project Loom 的虚拟线程，到 Pattern Matching 的语法增强，到 Record 和 Sealed Class 的类型系统升级——Java 正在变得越来越现代、越来越简洁。这一模块，记录了 Java 进化路上的每一个里程碑。

---

## 模块内容

### 版本演进总览

快速了解每个版本的核心变化。

- [JDK 9~11 新特性](/java/new-features/jdk9-11)：模块化系统、var 推断、集合工厂方法、Stream 增强、HTTP Client
- [JDK 12~16 新特性](/java/new-features/jdk12-16)：Switch 表达式、Records、Sealed Classes 预览版、instanceof 模式匹配
- [JDK 17~21 LTS 新特性](/java/new-features/jdk17-21)：Sealed Classes 正式版、Virtual Thread（Loom）、Pattern Matching for switch

### 核心新特性详解

每一节都是独立的深度专题。

#### 虚拟线程（Virtual Thread）

- [Virtual Thread 原理与适用场景](/java/new-features/virtual-thread)：★ JDK 21 最重要的特性、轻量级线程、Carrier Thread、vs 传统线程

#### Record 类型与模式匹配

- [Record 类型与模式匹配](/java/new-features/record-pattern)：不可变数据类、自动生成 equals/hashCode/toString、Pattern Matching for instanceof、Record Pattern

#### Switch 表达式增强

- [Switch 表达式增强](/java/new-features/switch)：箭头语法、yield 关键字、Pattern Matching for switch（JDK 17+）

#### 密封类

- [Sealed Class 密封类](/java/new-features/sealed-class)：限制继承层次、final / sealed / non-sealed 子类、穷尽性检查

---

## 新特性学习优先级

| 优先级 | 特性 | 原因 |
|---|---|---|
| ⭐⭐⭐ 必学 | 虚拟线程 | JDK 21 LTS，革新并发编程范式 |
| ⭐⭐⭐ 必学 | Switch 表达式 | JDK 12+ 预览，JDK 14 正式，生产可用 |
| ⭐⭐⭐ 必学 | Sealed Class | JDK 17 LTS，类型安全利器 |
| ⭐⭐ 建议 | Record | JDK 16 正式，减少样板代码 |
| ⭐⭐ 建议 | Pattern Matching for instanceof | JDK 16 正式，减少强制类型转换 |
| ⭐⭐ 建议 | JDK 9~11 特性 | 模块化、var、HTTP Client |
| ⭐ 可选 | JDK 12~16 预览特性 | 为 JDK 17+ 打基础 |

## Java 版本选择建议

| 场景 | 推荐版本 |
|---|---|
| 新项目 | JDK 21 LTS |
| 老项目维护 | JDK 17 LTS |
| 教学/学习 | JDK 21 LTS |
| 面试准备 | JDK 8（基础）+ JDK 17（进阶）|
