# ArrayList 扩容机制：位运算与动态数组的秘密

你有没有想过这个问题：

ArrayList 每次 add 元素时，它怎么知道什么时候该扩容？扩容又是一次性扩多少？

如果你觉得这只是简单的「数组满了就翻倍」，那你可能错过了几个面试官很爱问的细节。

## 从空数组开始

ArrayList 有一个「懒加载」的初始化策略：

```java
public class ArrayList<E> {
    // 默认空数组，第一次 add 时才真正创建
    private static final Object[] DEFAULTCAPACITY_EMPTY_ELEMENTDATA = {};
    
    // 存储元素的数组
    transient Object[] elementData;
    
    public ArrayList() {
        // 创建一个空数组，容量为 0
        this.elementData = DEFAULTCAPACITY_EMPTY_ELEMENTDATA;
    }
}
```

创建 ArrayList 时，并没有立即分配 10 个元素的数组。只有当你第一次 `add()` 时，才会触发初始化。

## 第一次 add：容量从 0 到 10

当你调用第一个 `add()` 时：

```java
public boolean add(E e) {
    // 确保容量够用（核心方法）
    ensureCapacityInternal(size + 1);
    elementData[size++] = e;
    return true;
}

private void ensureCapacityInternal(int minCapacity) {
    // 如果是空数组，计算最小容量（取 DEFAULT_CAPACITY 和 minCapacity 的最大值）
    if (elementData == DEFAULTCAPACITY_EMPTY_ELEMENTDATA) {
        minCapacity = Math.max(DEFAULT_CAPACITY, minCapacity);
    }
    ensureExplicitCapacity(minCapacity);
}

// 默认容量是 10
private static final int DEFAULT_CAPACITY = 10;
```

所以第一次 add 后，数组容量变成 10（即使你只 add 了一个元素）。

## 扩容公式：1.5 倍

当容量不够时，ArrayList 会扩容。扩容公式是：

```
newCapacity = oldCapacity + (oldCapacity >> 1)
            = oldCapacity + oldCapacity / 2
            = 1.5 * oldCapacity
```

这就是位运算的妙用——**`>> 1` 等价于除以 2**，但性能更高。

### 为什么用位运算？

```java
// 性能对比
int a = 16;
int b = a >> 1;   // 位运算：8，CPU 一条指令
int c = a / 2;    // 除法：8，CPU 可能多周期

// 当数据量很大时，这个差距会放大
int large = 1_000_000_000;
int result1 = large >> 1;  // 极快
int result2 = large / 2;  // 相对较慢
```

位运算在底层就是移位，CPU 可以一条指令完成。而除法需要多步操作。

### 扩容过程

```java
private void grow(int minCapacity) {
    // 旧容量
    int oldCapacity = elementData.length;
    
    // 新容量 = 1.5 倍旧容量
    int newCapacity = oldCapacity + (oldCapacity >> 1);
    
    // 如果还不够，直接用 minCapacity
    if (newCapacity - minCapacity < 0) {
        newCapacity = minCapacity;
    }
    
    // 容量上限是 MAX_ARRAY_SIZE = Integer.MAX_VALUE - 8
    if (newCapacity - MAX_ARRAY_SIZE > 0) {
        newCapacity = hugeCapacity(minCapacity);
    }
    
    // 拷贝数组（核心操作）
    elementData = Arrays.copyOf(elementData, newCapacity);
}
```

### 扩容示例

| 当前 size | 当前 capacity | add 后触发扩容？ | 新 capacity |
|----------|---------------|----------------|-------------|
| 9 | 10 | 是 | 15 |
| 14 | 15 | 是 | 22 |
| 21 | 22 | 是 | 33 |
| 32 | 33 | 否 | 33 |
| 33 | 33 | 是 | 49 |

```
容量变化：0 → 10 → 15 → 22 → 33 → 49 → 73 → 109 → 163 → 244 → ...
```

## 扩容的核心操作：Arrays.copyOf()

每次扩容，ArrayList 都会执行数组拷贝：

```java
elementData = Arrays.copyOf(elementData, newCapacity);
```

这个操作做了什么？

1. 创建一个**新数组**（新的容量大小）
2. 把**旧数组的内容复制**到新数组
3. 丢弃旧数组（等待 GC 回收）

**这是 ArrayList 扩容的最大开销。**

```java
// 模拟 Arrays.copyOf 的过程
E[] newArray = (E[]) new Object[newCapacity];
for (int i = 0; i < size; i++) {
    newArray[i] = elementData[i];  // 一个一个复制
}
elementData = newArray;
```

## 扩容的代价：为什么它很慢

扩容操作有三个性能问题：

1. **内存分配**：需要分配一块更大的连续内存
2. **数据拷贝**：所有元素都要复制一遍
3. **GC 压力**：旧数组变成垃圾，增加 GC 负担

```java
// 如果你知道大概会放多少元素，预分配容量可以避免扩容
public class BadExample {
    public static void main(String[] args) {
        // 反面教材：边添加边扩容，性能很差
        ArrayList<Integer> list = new ArrayList<>();
        for (int i = 0; i < 10000; i++) {
            list.add(i);  // 可能触发多次扩容
        }
    }
}

public class GoodExample {
    public static void main(String[] args) {
        // 预分配容量，只扩容 1 次
        ArrayList<Integer> list = new ArrayList<>(10000);
        for (int i = 0; i < 10000; i++) {
            list.add(i);  // 容量够用，不需要扩容
        }
    }
}
```

## 最佳实践：预分配容量

如果你能预估元素数量，**一定要预分配容量**：

```java
// 场景1：从数据库加载大量数据
List<User> users = new ArrayList<>(expectedUserCount);

// 场景2：使用 List 作为缓存
List<Config> configs = new ArrayList<>(100);

// 场景3：批量添加
List<String> batch = new ArrayList<>(batchSize);
for (Item item : items) {
    batch.add(processItem(item));
}
```

### 预分配的计算公式

```java
// 预估容量 = 预期元素数 / 负载因子 + 1
// 但 ArrayList 没有负载因子，所以直接预估即可

// 如果你不确定，宁可多估一点也不要少估
List<String> list = new ArrayList<>(estimatedSize * 2);
```

## 容量与大小的区别

| 概念 | 说明 | 相关方法 |
|-----|-----|---------|
| capacity（容量） | 数组能容纳的元素数量 | `ensureCapacity()` |
| size（大小） | 实际存储的元素数量 | `size()` |

```java
ArrayList<String> list = new ArrayList<>(100);
System.out.println(list.size());      // 0
System.out.println(list.capacity());  // 100（这个方法 JDK 11 后删除了）
```

**容量不等于大小**。容量是数组的长度，大小是实际元素的数量。

## trimToSize()：释放多余容量

如果你的 ArrayList 已经不会再添加元素了，可以通过 `trimToSize()` 释放多余的容量：

```java
ArrayList<String> list = new ArrayList<>(1000);
list.add("Java");
list.add("Python");
// 现在只用了 2 个位置，998 个是空的

list.trimToSize();
// 容量从 1000 缩小到 2，节省内存
```

但要注意，这个操作也会触发数组拷贝。

## ensureCapacity()：主动扩容

JDK 提供了公开方法让你主动触发扩容：

```java
ArrayList<String> list = new ArrayList<>();
list.ensureCapacity(1000);  // 提前确保容量够 1000 个元素
// 现在 add 不会触发扩容，直到元素超过 1000
```

这个方法的好处是：**如果一次添加大量元素，先调用 ensureCapacity 可以减少扩容次数**。

```java
// 原始代码：可能触发多次扩容
ArrayList<Integer> list = new ArrayList<>();
for (int i = 0; i < 10000; i++) {
    list.add(i);
}

// 优化后：只扩容 1 次
ArrayList<Integer> list = new ArrayList<>();
list.ensureCapacity(10000);
for (int i = 0; i < 10000; i++) {
    list.add(i);
}
```

## 位运算的更多秘密

ArrayList 中用到的位运算不仅是 `>> 1`，还有其他地方：

### 计算中间位置

```java
// 二分查找中计算 mid
int mid = (low + high) >>> 1;  // 无符号右移，防止溢出
```

### 容量计算（HashMap 中）

HashMap 的 `tableSizeFor()` 方法用位运算快速找到 >= 目标值的最小 2 的幂次：

```java
// 找 >= cap 的最小 2 的幂次
static final int tableSizeFor(int cap) {
    int n = cap - 1;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    return n + 1;
}
```

## 面试追问方向

1. **ArrayList 的初始容量是 10 还是 0？**

是 0。ArrayList 懒加载，第一次 add 时才初始化为 10。

2. **ArrayList 扩容 1.5 倍，Vector 扩容多少倍？**

Vector 默认扩容 2 倍（`oldCapacity * 2`），但可以通过构造函数设置扩容因子。

3. **为什么 Arrays.copyOf() 能保持泛型类型？**

因为 JVM 的类型擦除只针对源码，编译后的字节码中泛型信息以签名（Signature）形式保留，`Arrays.copyOf` 可以通过反射恢复具体类型。

4. **ArrayList 在多线程下 add 会有什么后果？**

数据覆盖（多个线程写到同一个位置）、size 计数错误、数组越界、ConcurrentModificationException。解决方案：用 `CopyOnWriteArrayList` 或加锁。

5. **能一边遍历 ArrayList 一边删除元素吗？**

不能，会触发 fail-fast。正确做法是用 Iterator 的 `remove()` 方法，或者倒序遍历。

---

ArrayList 的扩容机制是 Java 基础中的基础。理解了「懒加载」「1.5 倍扩容」「位运算优化」这些细节，你在面试中就能从容应对各种追问。接下来，我们把 ArrayList 和 LinkedList 放在一起深度对比——这是面试中出现频率最高的比较题。
