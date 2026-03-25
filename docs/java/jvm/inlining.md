# 方法内联：性能提升的「万金油」

在所有 JIT 优化手段中，**方法内联（Method Inlining）** 是最重要、最基础的一个。

它不仅本身能消除方法调用开销，更重要的是，它为其他所有优化打开了大门。可以说，没有方法内联，其他大多数 JIT 优化都无法生效。

## 什么是方法内联

方法内联，就是把**方法调用**替换为**方法体本身**。

```java
// 内联前
public int add(int a, int b) {
    return a + b;
}

public int compute() {
    return add(10, 20);  // 调用方法
}

// 内联后（等效）
public int compute() {
    return 10 + 20;  // 直接内联方法体
}
```

看起来简单，但内联的价值远不止消除一次函数调用。

## 内联的价值

### 1. 消除调用开销

方法调用有固定开销：

| 开销来源 | 说明 |
|---------|------|
| 压栈/出栈 | 参数传递、局部变量管理 |
| 保存寄存器 | 调用前保存现场，返回后恢复 |
| 控制转移 | 跳转指令，CPU 流水线中断 |

一次方法调用大约增加 **5-10 条 CPU 指令**。对于频繁调用的小方法，这个开销不可忽视。

### 2. 扩大优化范围

内联后才能做**跨方法优化**：

```java
// 内联前：两次方法调用，两段独立的代码
public double price() {
    return base() * discount();
}

// JIT 无法跨方法优化

// 内联后：优化器看到完整代码
public double price() {
    return (100 * 0.9);  // 可以进一步优化成常量 90
}
```

### 3. 启用激进优化

内联让 JIT 能够：

- **常量折叠**：`100 * 0.9` → `90.0`
- **死代码消除**：删除永远不会执行的分支
- **公共子表达式消除**：避免重复计算

## 内联的条件

不是所有方法都会被内联，JIT 有严格的判断标准。

### 热点方法

只有**热点方法**（调用频繁）才会被 JIT 优先内联。

触发条件：
- 调用计数器达到阈值（`-XX:CompileThreshold`，默认 10000）
- 或者方法体小到 JIT 主动探测

### 小方法

JIT 只内联**小方法**：

| 方法大小 | 是否内联 |
|---------|---------|
| < 35 字节 | 必然内联 |
| 35-325 字节 | 可能内联（取决于热点程度） |
| > 325 字节 | 不内联 |

为什么是 35 字节？因为 JIT 认为小于这个阈值的方法，调用开销可能比方法体本身还大。

### 内联深度限制

嵌套调用有内联深度限制：

```bash
# 最大内联深度（默认 1）
-XX:MaxInlineLevel=3

# 超过这个深度，不再内联更深的方法
```

## 虚方法内联：最精彩的部分

普通方法内联很简单——调用关系明确，JIT 直接替换即可。

但**虚方法调用**（通过接口或父类引用调用的方法）就不一样了。

### 多态的困境

```java
interface Drawable {
    void draw();
}

class Circle implements Drawable {
    @Override
    public void draw() { }
}

class Square implements Drawable {
    @Override
    public void draw() { }
}

public void render(Drawable d) {
    d.draw();  // 虚方法调用：运行时才知道是哪个实现
}
```

编译器无法在编译时确定调用哪个 `draw()`——这叫**虚分派（Virtual Dispatch）**，正常情况下不能内联。

### 虚方法内联的条件

JIT 编译器通过**类型推断**来突破这个限制：

| 类型 | 说明 | 能否内联 |
|-----|------|---------|
| 单态（Monomorphic） | 只有一个可能的实现类 | ✅ 完全内联 |
| 双态（Bimorphic） | 两个可能的实现类 | ✅ 可内联（需类型检查） |
| 多态（Megamorphic） | 多于两个实现类 | ❌ 不可内联 |

```java
// 单态场景：JIT 能推断 d 只有一种可能
public void render(Drawable d) {
    if (d instanceof Circle) {
        ((Circle) d).draw();  // 可能是 Circle，直接内联
    }
}
```

### CHA：类层次结构分析

**CHA（Class Hierarchy Analysis）** 是 JIT 做虚方法内联的核心技术：

```java
// 编译时检查：Drawable 有多少个实现？
interface Drawable { ... }
class Circle implements Drawable { ... }
class Square implements Drawable { ... }
// 目前只有两个实现 → 双态，可以内联

// 后来有人加了：
class Triangle implements Drawable { ... }
// 现在有三个实现 → 多态，虚方法不能再内联
// 触发去优化，重新编译
```

### 去优化（Deoptimization）

如果 CHA 判断可以内联，但运行时发现类型超出了预期：

```java
// JIT 以为只有 Circle 会调用，实际出现了 Square
public void draw() {
    // JIT 内联了 Circle.draw() 的代码
    // 运行时发现实际是 Square...
    // 触发去优化，回到解释执行或重新编译
}
```

## 内联与 JIT 优化的关系

方法内联是其他所有优化的**前提**：

```
方法内联
    ↓
跨方法优化（常量折叠、死代码消除、公共子表达式）
    ↓
进一步逃逸分析（标量替换、栈上分配、同步消除）
    ↓
寄存器分配优化
    ↓
最终机器码生成
```

没有内联，后续优化都无从谈起。这也是为什么 JIT 把方法内联放在最优先级。

## 查看内联日志

```bash
# 打印内联决策
-XX:+PrintInlining

# 配合 PrintCompilation 一起使用
-XX:+PrintCompilation -XX:+PrintInlining
```

输出示例：

```
    3   %     com.example.MyClass::compute @ 12 (22 bytes)
    3   %     com.example.MyClass::compute @ 12 (22 bytes)   inline (hot)
```

| 标记 | 含义 |
|-----|------|
| `inline (hot)` | 内联成功，方法很热 |
| `inline (callee too large)` | 被调用方法太大，不内联 |
| `no static binding` | 没有静态绑定（虚方法），不内联 |

## 常见问题

### 问题 1：为什么我的方法没有被内联？

检查：
1. 方法是否足够小（< 325 字节）？
2. 方法是否足够热（调用次数够多）？
3. 是否是多态/虚方法调用？
4. 内联深度是否超限？

### 问题 2：大量小方法会不会导致代码膨胀？

会。内联是以空间换时间——内联后的代码量会增加。JIT 会权衡：内联收益 > 代码膨胀成本，才会执行。

### 问题 3：反射调用能被内联吗？

正常情况下，反射调用不能内联。但 JDK 9+ 引入了 **invokedynamic** 和 **MethodHandle**，配合 JIT 的激进优化，某些场景下可以接近内联的效果。

## 面试追问方向

1. **虚方法内联的原理是什么？CHA 是怎么工作的？**

提示：类型推断、单态/双态/多态判断、运行时去优化。

2. **既然内联这么好，为什么不内联所有方法？**

提示：代码膨胀、二八定律、编译时间成本。

3. **方法内联和泛型有什么关系？为什么泛型不增加运行时开销？**

提示：类型擦除 + 内联 = 泛型在运行时无额外成本（JIT 帮你抹平了）。

---

## 留给你的思考题

考虑一个经典场景：

```java
public class InliningTest {
    private final List<String> list = new ArrayList<>();
    
    public void add(String s) {
        list.add(s);  // ArrayList.add() 会内联吗？
    }
}
```

`ArrayList.add()` 是一个频繁调用的方法，它的字节码超过 35 字节，正常情况下不会被内联。

但 JDK 11 引入了**快速路径内联（Fast-path Inlining）**技术——把方法拆分，只内联热路径。

问题来了：**如果 JIT 认为某个方法「太热了」，会不会突破内联限制？**

这涉及到 JIT 的**分层编译**和**狂热优化（C2 编译器）**，值得深入了解。
