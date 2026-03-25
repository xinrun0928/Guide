# 反编译工具：看见代码的「真面目」

你在阅读别人代码的时候，有没有遇到过这种情况：

- 第三方库没有源码，只有 JAR 包
- 代码被混淆过，看不懂变量名
- 想验证编译器是否做了某个优化
- 面试被问到：「你能看看这行代码编译后是什么吗？」

答案就是：**用反编译工具看字节码，再反编译成可读的 Java 代码。**

这一章介绍的工具组合，能让你像读源码一样读懂任何 `.class` 文件。

## javap：JDK 自带的字节码查看器

`javap` 是 JDK 自带的工具，无需额外安装。

### 基本用法

```bash
# 查看类信息（不含字节码）
javap java.util.ArrayList

# 查看字节码指令
javap -c java.util.ArrayList

# 查看详细信息（常量池、字段表、方法表）
javap -v java.util.ArrayList

# 查看私有成员
javap -p java.util.ArrayList

# 查看完整信息（行号、本地变量表）
javap -c -verbose MyClass
```

### 输出示例

原始 Java 代码：

```java
public class Hello {
    private int value = 42;
    
    public int getValue() {
        return value;
    }
    
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
```

使用 `javap -c -v Hello` 输出的关键部分：

```
public class Hello
  minor version: 0
  major version: 52  // Java 8
  ...
Constant pool:
  #1 = Methodref          #6.#17
  #2 = String             #18
  #3 = Fieldref           #19.#20
  ...

public int getValue();
  descriptor: ()I
  flags: ACC_PUBLIC
  Code:
    stack=1, locals=1, args_size=1
    0: aload_0
    1: getfield      #3
    4: ireturn
```

### 常量池的奥秘

常量池是字节码中最有价值的信息之一。它包含：

- 字面量（字符串、数字）
- 类和方法的符号引用
- 字段引用

当你看到 `getstatic #19` 这样的指令，#19 就是常量池的索引。

## jclasslib Bytecode Viewer：IDEA 插件

如果你觉得 javap 的输出太「硬核」，`jclasslib` 是更好的选择。

### 安装

在 IDEA 的 Plugins 市场搜索 `jclasslib Bytecode Viewer`，安装即可。

### 使用方法

1. 打开一个 `.java` 文件
2. 菜单栏：`View` → `Show Bytecode Outline`
3. 右侧会显示该类的字节码信息

### 功能特点

- 图形化展示常量池、方法信息
- 按方法查看字节码指令
- 显示局部变量表、操作数栈
- 显示行号映射
- **支持修改字节码并保存**（测试 JIT 优化的利器）

### 界面预览

```
┌─────────────────────────────────────────┐
│ Hello.class                             │
├─────────────────────────────────────────┤
│ General                                │
│  Minor/Major version: 0/52             │
│  Access flags: public                  │
├─────────────────────────────────────────┤
│ Constant Pool (20 entries)             │
│  #1 = Methodref                         │
│  #2 = String                            │
├─────────────────────────────────────────┤
│ Methods                                 │
│  ├─ <init> ()V                         │
│  ├─ getValue ()I                       │
│  └─ main ([Ljava/lang/String;)V        │
└─────────────────────────────────────────┘
```

点击任意方法，右侧会显示详细字节码。

## JBE：图形化字节码编辑器

[JBE](https://github.com/Konloch/bytecode-viewer)（Java Bytecode Editor）是 Java 写的图形化字节码编辑器。

### 特点

- 可视化编辑 `.class` 文件
- 支持直接修改字节码指令
- 内置反编译器

### 适用场景

- 修改 JAR 包中的类（不需要重新编译源码）
- 快速验证字节码修改的效果
- 学习字节码结构

### 使用注意

修改后的 `.class` 文件需要用 `javap -c` 验证修改是否正确。

## CFR：高级反编译器

[CFR](https://github.com/leibnitz27/cfr)（California Framework for Reverse Engineering）是目前最流行的 Java 反编译器之一。

### 安装

```bash
# 下载 jar 包
wget https://github.com/leibnitz27/cfr/releases/latest/download/cfr.jar

# 使用
java -jar cfr.jar MyClass.class --outputdir ./output
```

### 特点

- 反编译结果非常接近原始代码
- 支持 Java 8 Lambda
- 支持 Java 9 模块
- 能够还原泛型类型信息
- 注释少，适合阅读

### 对比：反编译 vs 字节码查看

| 工具 | 输出 | 适用场景 |
|-----|------|---------|
| javap -c | 字节码指令 | 分析执行流程、学习字节码 |
| jclasslib | 字节码 + 辅助信息 | IDEA 中快速查看 |
| CFR | Java 源代码 | 理解逻辑、还原代码 |

## procyon：另一个反编译器

[procyon](https://github.com/mstrobel/procyon) 是轻量级的 Java 反编译器：

```bash
java -jar procyon.jar MyClass.class -o output.java
```

procyon 的特点：

- 输出更简洁
- 对部分混淆代码支持更好
- 适合命令行批量反编译

## 实战：用反编译排查问题

### 场景 1：验证编译器优化

你想知道 `final` 关键字是否会被编译器优化掉：

```java
public class FinalDemo {
    public static final int CONST = 100;
    
    public int getValue() {
        return CONST;
    }
}
```

反编译后你会发现，`CONST` 直接变成了 `bipush 100`，`getstatic` 变成了常量加载。编译器做了**常量折叠**优化。

### 场景 2：分析第三方库行为

JAR 包没有源码，但你想确认某个类是否实现了某个接口：

```bash
java -jar cfr.jar com.example.SomeClass --outputdir ./output
cat ./output/com/example/SomeClass.java
```

### 场景 3：排查混淆代码

代码被 ProGuard 混淆后，变量名变成了 `a`、`b`、`c`：

```java
// 混淆前
public boolean isValid(User user, int age) { ... }

// 混淆后
public boolean a(b c, int d) { ... }
```

反编译后，结合上下文（类名、方法名保留）和逻辑推理，可以大致还原业务逻辑。

## 工具选择建议

| 场景 | 推荐工具 |
|-----|---------|
| 学习字节码 | javap -v |
| IDEA 中快速查看 | jclasslib 插件 |
| 还原源码 | CFR |
| 修改字节码 | JBE |
| 命令行批量反编译 | procyon |

## 面试追问方向

1. **Java 编译器（javac）和 JVM 解释器/JIT 编译器，有什么区别？**

提示：前端编译 vs 后端编译；字节码 vs 机器码。

2. **为什么说 Java 是「编译型语言」又是「解释型语言」？**

提示：答案在字节码这个中间层。

3. **反编译后的代码和原始代码完全一样吗？有什么差异？**

提示：注释丢失、局部变量名丢失、某些语法糖可能被还原。

---

## 留给你的思考题

为什么有些 JAR 包反编译后只能看到奇怪的方法名和数字，却完全无法理解代码逻辑？

这涉及代码混淆（ProGuard/Obfuscator）的原理。想想看，它是怎么让反编译工具「失灵」的？
