# Java 基础

Java 语言的核心语法与基础特性，是每一个 Java 开发者必须掌握的基石。

无论你是刚入门的新手，还是准备面试的求职者，这一模块都会帮你夯实基础——从数据类型到面向对象，从字符串到底层原理，没有花哨的框架，只有实打实的知识点。

---

## 模块内容

### 基础语法

Java 的语法糖与语言规范，是写出高质量代码的前提。

- [数据类型与类型转换](/java/basic/data-types)：八种基本数据类型、隐式转换与强制转换、常见陷阱
- [面向对象：封装、继承、多态](/java/basic/oop)：访问控制符、重载与重写、向上转型与向下转型
- [抽象类 vs 接口](/java/basic/abstract-interface)：设计层面的本质区别、JDK 8+ default 方法的变革
- [内部类与 lambda 表达式](/java/basic/inner-class-lambda)：四种内部类、函数式接口、方法引用

### String 与字符串

String 是 Java 中使用最频繁的类型，也是面试中的高频考点。

- [String 不可变性与实现原理](/java/basic/string-immutable)：final 修饰、char[]/byte[] 数组、不可变的五大好处
- [字符串常量池与 intern()](/java/basic/string-pool)：常量池位置变迁、new String() 创建几个对象、intern() 使用技巧
- [StringBuilder vs StringBuffer vs String](/java/basic/string-build-buffer)：扩容机制、线程安全对比、性能陷阱
- [JDK 8 vs JDK 9+ String 实现差异](/java/basic/string-jdk9)：Compact Strings、Latin-1 vs UTF-16 编码

### 基本类型与包装类

基本类型和包装类是 Java 类型系统的两极，它们的转换规则藏着不少面试陷阱。

- [自动装箱与拆箱原理](/java/basic/box-unbox)：Integer.valueOf() 的本质、装箱的三大陷阱
- [Integer 缓存池与 IntegerCache](/java/basic/integer-cache)：-128~127 的秘密、JVM 参数调优
- [new Integer(127) vs Integer.valueOf(127)](/java/basic/integer-compare)：对象创建的学问
- [浮点数精度问题与 BigDecimal](/java/basic/float-decimal)：IEEE 754 原理、BigDecimal 的正确打开方式

### 异常体系

异常处理体现了一个程序员的工程素养。

- [Throwable、Error、Exception 体系](/java/basic/exception-hierarchy)：从 Throwable 到 RuntimeException 的完整继承链
- [受检异常 vs 非受检异常](/java/basic/checked-unchecked)：为什么 Java 设计了两种异常？如何选择？
- [try-with-resources 用法与原理](/java/basic/try-with-resources)：AutoCloseable 接口、资源关闭顺序、多资源声明
- [自定义异常的最佳实践](/java/basic/custom-exception)：继承 RuntimeException 还是 Exception？异常链怎么传？

### 枚举与注解

枚举和注解是 Java 语言表达力的集中体现。

- [枚举的用法与实现原理](/java/basic/enum)：枚举的本质是类、枚举属性、枚举实现接口
- [注解的分类与保留策略](/java/basic/annotation-type)：SOURCE/CLASS/RUNTIME、三大内置注解、元注解
- [注解处理器与 Lombok 原理](/java/basic/annotation-processor)：编译时注解处理、Lombok 背后的魔法

### 泛型与序列化

Java 泛型和序列化是通往更高阶的必经之路。

- [泛型](/java/basic/generics)：类型擦除、通配符 PECS 原则、泛型方法与泛型数组
- [序列化](/java/basic/serialization)：Serializable 接口、serialVersionUID、transient 关键字

### 新特性演进

Java 每个版本都在进化，了解它们才能写出更现代的代码。

- [Java 新特性演进（JDK 8~21）](/java/basic/new-features)：从 Lambda 到 Virtual Thread，Java 是如何一路走来的

---

## 学习路线建议

```
第一阶段：数据类型 → 面向对象 → String（基础三件套）
         ↓
第二阶段：基本类型与包装类 → 异常体系（细节深化）
         ↓
第三阶段：枚举与注解 → 泛型 → 序列化（新特性串联）
```

## 面试核心考点

| 高频考点 | 关联文档 |
|---|---|
| String 不可变性 | [String 不可变性与实现原理](/java/basic/string-immutable)、[字符串常量池](/java/basic/string-pool) |
| 整数缓存池 | [Integer 缓存池](/java/basic/integer-cache) |
| 自动装箱陷阱 | [自动装箱与拆箱](/java/basic/box-unbox) |
| 泛型擦除 | [泛型](/java/basic/generics) |
| 抽象类 vs 接口 | [抽象类 vs 接口](/java/basic/abstract-interface) |
