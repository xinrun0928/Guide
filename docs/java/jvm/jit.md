# JIT 编译：让 Java 「越跑越快」的秘密

你有没有注意到这种现象：

Java 程序启动的时候总是「慢热」——开始执行的时候响应较慢，但运行一段时间后，速度明显提升了。

这不是 JVM 的玄学，而是 **JIT 编译器**在发挥作用。

## 解释器 vs JIT 编译器

Java 程序启动后，JVM 要做一件核心的事：**把字节码翻译成机器码，让 CPU 能执行。**

这里有两种策略：

### 解释执行

解释器（Interpreter）逐条读取字节码，翻译成机器码并执行。

**特点：**
- 启动快：不需要编译，立刻能跑
- 执行慢：每次运行都要翻译，重复代码反复翻译

### JIT 即时编译

JIT 编译器（Just-In-Time Compiler）把热点代码直接编译成机器码，缓存起来，后续直接执行。

**特点：**
- 启动稍慢：需要先收集热点信息
- 执行快：编译后的代码是机器码，执行效率高

```
字节码 → 解释执行（慢）→ 检测热点 → JIT 编译（快）
```

类比理解：解释器像同声传译，每句话都要实时翻译；JIT 像同传译员提前准备的「熟稿」，遇到熟悉的段落直接背出来。

## 热点代码探测

JIT 不是对所有代码都编译，那样开销太大。它只针对**热点代码**——调用频繁或循环次数多的代码。

### 热点探测方法

HotSpot 使用**基于计数器的热点探测**，两种计数器：

| 计数器 | 作用 | 阈值参数 |
|-------|------|---------|
| 方法调用计数器 | 统计方法被调用次数 | `-XX:CompileThreshold`（默认 10000） |
| 回边计数器 | 统计循环体执行次数 | `-XX:BackEdgeThreshold` |

当计数器超过阈值，触发 JIT 编译。

### 编译触发条件

```
方法调用计数器 + 回边计数器 >= CompileThreshold
```

可以用 `-XX:+PrintCompilation` 看到每次编译的日志：

```bash
java -XX:+PrintCompilation MyApp
```

输出类似：

```
    1       3       java.lang.Object::hashCode (20 bytes)
   42       4       com.example.MyClass::compute (156 bytes)
```

## 分层编译

JIT 编译不是一次性完成的，而是一个**渐进优化**的过程。这就是分层编译（Tiered Compilation）。

### 四个编译级别

| 级别 | 名称 | 特点 | 适用场景 |
|-----|------|------|---------|
| Tier 0 | 解释执行 | 最快启动，不编译 | 初始阶段 |
| Tier 1 | C1 编译（快速） | 编译快，优化少 | 短期应用 |
| Tier 2 | C1 编译（完整） | 编译快，有更多优化 | 稳定运行 |
| Tier 3 | C2 编译（深度优化） | 编译慢，优化激进 | 长期运行的服务 |

### 编译流程

```
程序启动
    ↓
Tier 0：解释执行，收集热点信息
    ↓
达到阈值 → Tier 1 编译（快速版本）
    ↓
继续调用 → Tier 2 编译（完整优化）
    ↓
调用极频繁 → Tier 3（更激进优化）
    ↓
最终稳定 → Tier 4：C2 编译（Server Compiler）
```

### C1 vs C2

- **C1 编译器（Client Compiler）**：编译快，优化适度，适合**启动敏感**的应用
- **C2 编译器（Server Compiler）**：编译慢，但优化深度大，适合**长期运行**的服务

JDK 8+ 默认开启分层编译，JVM 会自动选择合适的编译级别。

### 分层编译配置

```bash
# 开启分层编译（默认开启）
-XX:+TieredCompilation

# 关闭分层编译
-XX:-TieredCompilation

# 设置 C2 编译的线程数
-XX:CICompilerCount=4
```

## JIT 编译日志

### 查看编译日志

```bash
java -XX:+PrintCompilation -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly MyApp
```

输出会显示每次 JIT 编译的详细信息。

### 查看编译决策

```bash
# 打印 JIT 编译的详细决策
-XX:+PrintCompilation -XX:+LogCompilation -XX:LogFile=jit.log
```

然后用工具分析 `jit.log`。

## 代码缓存

JIT 编译后的机器码存在**代码缓存区（Code Cache）**中。

### 相关参数

```bash
# 代码缓存大小（默认 48MB）
-XX:ReservedCodeCacheSize=240m

# 初始代码缓存大小
-XX:InitialCodeCacheSize=...
```

### 代码缓存满了会怎样？

如果代码缓存满了，JIT 编译器会停止编译，后续代码只能解释执行，程序性能骤降。

这在 JDK 8 之前是常见问题。JDK 9+ 改进了内存管理，一般不会遇到。

## JIT 优化的常见手段

JIT 编译器做了大量运行时优化，包括：

| 优化手段 | 说明 |
|---------|------|
| 方法内联 | 将方法调用替换为方法体，减少调用开销 |
| 逃逸分析 | 分析对象是否逃逸，决定是否栈上分配 |
| 死代码消除 | 移除永远不会执行的代码 |
| 常量折叠 | 编译期计算常量表达式 |
| 公共子表达式消除 | 避免重复计算相同表达式 |

方法内联和逃逸分析会在后续章节详细讲解。

## 常见问题与调优

### 问题 1：启动慢

**原因**：初期大量代码解释执行，JIT 还没来得及编译。

**解决**：
- 使用 AOT 编译器（Ahead-of-Time）预先编译，如 GraalVM Native Image
- 调整分层编译参数，让 Tier 1 更快介入

### 问题 2：预热后反而变慢

**原因**：可能是代码缓存满了，或 Tier 3 → Tier 4 的优化引入了 bug。

**解决**：
- 检查代码缓存使用情况
- 关闭分层编译回退验证：`-XX:+TieredCompilation -XX:+UnlockExperimentalVMOptions -XX:+AlwaysPreTouch`

### 问题 3：如何验证 JIT 是否生效？

```bash
java -XX:+PrintCompilation MyApp 2>&1 | head -50
```

看到有编译日志输出，说明 JIT 在工作。

## 面试追问方向

1. **JIT 编译和 AOT 编译的区别是什么？GraalVM Native Image 用的是哪种？**

提示：AOT 是编译时编译，JIT 是运行时编译。GraalVM Native Image 是 AOT。

2. **为什么 Java 长期运行的性能可以超过 C++？**

提示：JIT 可以根据运行时信息做激进优化，而 C++ 的编译是静态的。

3. **分层编译中，为什么要有 Tier 3？Tier 2 直接升到 Tier 4 不行吗？**

提示：考虑编译时间和优化深度的权衡。

---

## 留给你的思考题

JIT 编译器能够看到程序运行时的实际调用频率、分支走向、对象类型等信息。

那么问题来了：**JIT 编译后的代码，如果运行时的「假设」被打破了呢？**

比如 JIT 假设某个方法的返回值总是正数，但实际运行中出现了负数——这时候会发生什么？

这涉及到 JIT 的**去优化（Deoptimization）**机制，值得深入研究。
