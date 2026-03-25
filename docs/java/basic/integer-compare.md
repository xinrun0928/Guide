# Integer 比较：new Integer() vs Integer.valueOf()

---

你知道吗？比较两个 `Integer` 对象，用 `==` 可能得到意想不到的结果。

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b); // true

Integer c = 128;
Integer d = 128;
System.out.println(c == d); // false
```

同样的代码，只是值从 127 变成 128，结果居然不一样？这里面的门道，值得深究。

## 一切源于缓存机制

Java 为 `Integer` 设计了一个**自动装箱缓存**，范围是 -128 到 127。

当你写 `Integer a = 127;` 时，编译器实际上调用的是 `Integer.valueOf(127)`，而不是 `new Integer(127)`。

```java
// 编译器会帮你转换成：
Integer a = Integer.valueOf(127);
Integer b = Integer.valueOf(127);

// valueOf 内部会检查缓存
public static Integer valueOf(int i) {
    if (i >= IntegerCache.low && i <= IntegerCache.high) {
        return IntegerCache.cache[i + (-IntegerCache.low)];
    }
    return new Integer(i);
}
```

**所以 127 在缓存范围内，`valueOf()` 返回的是同一个对象，`==` 比较自然为 true。**

而 128 超出缓存范围，每次 `valueOf()` 都创建新对象，`==` 比较的是引用，结果自然为 false。

## new Integer() 的真相

`new Integer(127)` 和 `new Integer(128)` 呢？

```java
Integer a = new Integer(127);
Integer b = new Integer(127);
System.out.println(a == b); // false

// 每次 new 都是新对象，地址不同
```

**重要结论：**

| 写法 | 创建对象数 | 127 时 == 比较 | 128 时 == 比较 |
|---|---|---|---|
| `Integer i = 127` | 0 或 1 | true（复用缓存） | false（新建对象） |
| `Integer i = new Integer(127)` | 1 | false | false |

## 最佳实践：永远不要用 new Integer()

**不要使用构造函数创建包装类对象：**

```java
// 错误写法
Integer a = new Integer(127);

// 正确写法
Integer b = Integer.valueOf(127);
Integer c = 127; // 自动装箱，推荐
```

原因有三：

1. **构造函数已过时**：`Integer(int)` 在 JDK 9 被标记为 `@Deprecated`
2. **浪费内存**：每次创建新对象，而 `valueOf()` 有缓存可用
3. **性能差异**：频繁创建对象会增加 GC 压力

## 所有包装类的缓存策略

不只是 `Integer`，其他包装类也有各自的缓存策略：

| 包装类 | 缓存范围 | 说明 |
|---|---|---|
| `Byte` | -128 ~ 127 | 全部缓存（只有 256 个值） |
| `Short` | -128 ~ 127 | 可通过 `-XX:AutoBoxCacheMax` 调整上限 |
| `Long` | -128 ~ 127 | 同上 |
| `Integer` | -128 ~ 127 | 默认，可通过 `-XX:AutoBoxCacheMax` 调整 |
| `Float` | 无 | 浮点数不缓存 |
| `Double` | 无 | 浮点数不缓存 |
| `Boolean` | true, false | 全部缓存 |

```java
// Float 和 Double 没有缓存，每次都是新对象
Double d1 = 0.1;
Double d2 = 0.1;
System.out.println(d1 == d2); // false

// Boolean 特殊，只有两个值，缓存复用
Boolean b1 = true;
Boolean b2 = true;
System.out.println(b1 == b2); // true
```

## 实战场景：HashMap 的坑

这个缓存机制最容易踩坑的地方，是 `HashMap` 的 `get()` 操作：

```java
Map&lt;Integer, String&gt; map = new HashMap&lt;&gt;();
map.put(127, "hello");

// 用自动装箱的值取
System.out.println(map.get(127)); // "hello"

// 用 new Integer 的值取
System.out.println(map.get(new Integer(127))); // "hello"

// 用 Integer.valueOf 取
System.out.println(map.get(Integer.valueOf(127))); // "hello"
```

为什么都能取到？因为 `HashMap` 的 `get()` 方法使用 `equals()` 比较键值，而不是 `==`。

但如果自定义的 Key 类型没有正确实现 `equals()`：

```java
// 假设有个自定义类作为 Key
class MyKey {
    int value;
    MyKey(int value) { this.value = value; }
    // 忘记重写 equals 方法！
}

Map&lt;MyKey, String&gt; map = new HashMap&lt;&gt;();
map.put(new MyKey(127), "hello");

// 用同一个对象能取到
System.out.println(map.get(new MyKey(127))); // 可能是 null！
```

**教训：自定义类作为 `Map` 的 Key 时，一定要重写 `equals()` 和 `hashCode()`。**

## 为什么这样设计？

Java 设计者们不是随便拍脑袋决定缓存 -128~127 的：

1. **统计数据支撑**：这个范围内的整数使用频率最高（循环计数、数组索引等）
2. **内存权衡**：缓存太多浪费内存，太少失去意义
3. **兼容旧代码**：JLS（Java 语言规范）明确规定了这个范围

## 面试追问方向

- 为什么缓存范围是 -128~127 而不是 -128~128？
- `Integer.valueOf()` 和 `new Integer()` 在性能上有多少差异？
- 如何用 `-XX:AutoBoxCacheMax` 调整缓存上限？调整后有什么影响？

## 留给你的思考题

假设你有以下代码：

```java
Integer a = 1;
Integer b = 2;
Integer c = 3;
Integer d = 3;
Integer e = 321;
Integer f = 321;
Long g = 3L;
Long h = 2L;

System.out.println(c == d);
System.out.println(e == f);
System.out.println(c == (a + b));  // 这里考什么？
System.out.println(c.equals(a + b));  // 这里又考什么？
System.out.println(g == (a + b)); // 这里呢？
System.out.println(g.equals(a + b)); // 这里呢？
```

你能说出每一行的输出结果吗？答案背后的原理是什么？
