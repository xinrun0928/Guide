# HashMap 的扰动函数：减少哈希碰撞的奥秘

你知道吗？

即使你的 key.hashCode() 返回的值分布很均匀，HashMap 仍然会再「加工」一下。

这个「加工」过程叫做**扰动**（Tumbling），它是 HashMap 中最容易被忽视却极其重要的细节。

## 什么是扰动函数？

```java
// JDK 8+ 的扰动函数
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

短短一行代码，却暗藏玄机。

### 公式解读

```
hash(key) = key.hashCode() ^ (key.hashCode() >>> 16)
```

- `h >>> 16`：将 hashCode 右移 16 位（高位移到低位）
- `^`：异或运算
- 结果：**将 hashCode 的高 16 位混入低 16 位**

### 图解过程

```
假设 key.hashCode() = 0x12345678

二进制：
0001 0010 0011 0100 0101 0110 0111 1000
↑_________↑
高 16 位   低 16 位

右移 16 位：
0000 0000 0000 0000 0001 0010 0011 0100
                                      ↑_________↑
                                     移过来的高位

异或运算：
  0001 0010 0011 0100 0101 0110 0111 1000
^ 0000 0000 0000 0000 0001 0010 0011 0100
─────────────────────────────────────────
= 0001 0010 0011 0100 0100 0100 0100 1100
                                      ↑_________↑
                            高 16 位的信息混入了低 16 位
```

## 为什么要扰动？

### 问题的根源：n - 1 只有低位是 1

```java
// n = 16 时
n - 1 = 0b00000000000000000000000000001111
//            ↑_____________________________↑
//                     只有低 4 位是 1

// 当计算 (n-1) & hash 时
// hash 的高 28 位完全没有参与运算！
```

**如果直接用 hashCode()，只有低位参与了运算**。这会导致：
- hashCode() 的高位信息被浪费
- 如果高位变化但低位相同，就会碰撞

### 扰动的目的

将 hashCode 的**高位信息混入低位**，让最终的 hash 值更均匀。

```
原始 hashCode：
┌────────────────────────────────────────┐
│ 高 16 位 │ 低 16 位                     │
│ (未参与) │ (参与运算)                   │
└────────────────────────────────────────┘

扰动后：
┌────────────────────────────────────────┐
│ 高 16 位 │ 低 16 位                     │
│  混入了   │   参与运算                   │
└────────────────────────────────────────┘
```

### 效果对比

```java
// 两个字符串
"Aa".hashCode() = 0x2E7A2E7A =  78098210
"BB".hashCode() = 0x2E7A2E7B =  78098219

// 容量 16，n-1 = 15
(15 & 0x2E7A2E7A) = 10
(15 & 0x2E7A2E7B) = 11
// 低位不同，能区分 ✓

// 容量 32，n-1 = 31
(31 & 0x2E7A2E7A) = 10
(31 & 0x2E7A2E7B) = 11
// 低位不同，能区分 ✓
```

但如果 hashCode 的高位变化而低位相同时：

```java
// 假设 hashCode 的高 16 位变化，但低 16 位相同
hash1 = 0x00010000_ABCDEF00
hash2 = 0x00020000_ABCDEF00

// 直接用 hashCode，低 16 位相同
(31 & hash1) = 0
(31 & hash2) = 0
// 碰撞！❌

// 用扰动函数
hash1' = 0x00010000 ^ 0xABCDEF00 = 0xABCEEF00
hash2' = 0x00020000 ^ 0xABCDEF00 = 0xABCDEF00

(31 & hash1') = 16  // 0b10000
(31 & hash2') = 0   // 0b00000
// 区分了！✓
```

## 为什么用异或（^）而不是与（&）或或（|）？

| 运算 | 特点 | 效果 |
|-----|-----|-----|
| & | 有 0 则 0 | 会让结果偏向 0 |
| \| | 有 1 则 1 | 会让结果偏向 1 |
| ^ | 相同为 0，不同为 1 | 0 和 1 概率均等，更均匀 |

异或的特点：
1. **不损失信息**：a ^ b ^ b = a
2. **概率均匀**：每一位的 0 和 1 概率相等
3. **可逆性**：`hash ^ (hash >>> 16)` 可以通过再次异或还原

```java
// 异或的数学性质
a ^ a = 0        // 自己异或其本身为 0
a ^ 0 = a        // 异或 0 不变
a ^ b = b ^ a    // 交换律

// 扰动函数可逆
original = (h ^ (h >>> 16))
restored = original ^ (original >>> 16)  // 近似恢复（不完全相同）
```

## JDK 7 vs JDK 8 的扰动函数

### JDK 7：更复杂的扰动

```java
// JDK 7 的 hash()
final int hash(Object k) {
    int h = hashSeed;
    if (0 != k && k instanceof String) {
        // String 有特殊优化
        return sun.misc.Hashing.stringHash32((String) k);
    }
    h ^= k.hashCode();
    
    // 多重扰动：多次异或+移位
    h ^= (h >>> 9)  ^ (h >>> 17);
    h ^= (h >>> 14) ^ (h >>> 28);
    return h;
}
```

JDK 7 的扰动更复杂，但性能开销也更大。

### JDK 8：简化扰动

```java
// JDK 8 的 hash()
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

JDK 8 简化了扰动函数，减少了计算开销。只要 hashCode() 本身质量够好（JDK 的 String、Integer 等都经过优化），一次异或就足够了。

## 扰动函数的效果验证

```java
public class HashDistributionTest {
    public static void main(String[] args) {
        // 测试 String 的 hash 分布
        String[] keys = {
            "Aa", "BB", "Cc", "Dd", "Ee",
            "Ff", "Gg", "Hh", "Ii", "Jj"
        };
        
        int n = 16;  // 数组容量
        System.out.println("扰动前 hashCode() 分布：");
        for (String key : keys) {
            int idx = key.hashCode() & (n - 1);
            System.out.printf("%s: hashCode=%d, idx=%d%n", 
                key, key.hashCode(), idx);
        }
        
        System.out.println("\n扰动后分布：");
        for (String key : keys) {
            int hash = key.hashCode() ^ (key.hashCode() >>> 16);
            int idx = (n - 1) & hash;
            System.out.printf("%s: hash=%d, idx=%d%n", 
                key, hash, idx);
        }
    }
}
```

## 哈希冲突的解决方法

HashMap 用的是**链地址法**（Separate Chaining）。常见的冲突解决方法还有：

| 方法 | 原理 | HashMap 用了吗 |
|-----|-----|--------------|
| 开放定址法 | 探测下一个空位置 | 否 |
| 再哈希法 | 用另一个哈希函数 | 否 |
| 链地址法 | 在同位置用链表/红黑树 | **是** |
| 建立公共溢出区 | 冲突元素放到溢出区 | 否 |

### 链地址法的优势

1. **实现简单**：只需维护 next 指针
2. **插入删除快**：O(1) 定位 + O(1) 操作
3. **不易聚集**：元素分布更均匀
4. **易于扩容**：只需重新哈希，不需要重新探测

```java
// HashMap 的链表结构
Node<K, V> next;  // 指向下一个节点

// 插入新节点
if (e.hash == hash && (e.key == key || key.equals(e.key))) {
    // key 已存在，覆盖
    V oldValue = e.value;
    e.value = value;
    return oldValue;
}
addNode(hash, key, value, null);  // 新节点接到链表末尾
```

## 面试追问方向

1. **扰动函数中的 >>> 16 是什么意思？**

无符号右移 16 位。`h >>> 16` 把 hashCode 的高 16 位移到低 16 位，原来的高 16 位填 0。

2. **为什么是异或（^）而不是与（&）或或（|）？**

异或的结果更均匀。与会让结果偏向 0，或会让结果偏向 1，只有异或的 0 和 1 概率均等。

3. **JDK 8 为什么简化了扰动函数？**

JDK 7 的多重扰动开销较大，而 JDK 的 String.hashCode() 本身分布已经足够均匀（JDK 内部做了优化）。简化后性能更好，效果差异不大。

4. **自定义对象的 hashCode() 怎么写比较好？**

要让 hashCode() 返回的值足够分散。常见做法：用 31、17 等质数作为乘数，混合多个字段的 hashCode。IDE 自动生成的一般质量都不错。

5. **HashMap 的 hash() 方法对 null 做了什么特殊处理？**

返回 0。null 的 hash 是 0，null 只能存在 table[0] 的链表/红黑树中。

---

扰动函数是 HashMap 中「低调但关键」的存在。它不改变元素的 hashCode 本质，但通过混合高位信息，让最终的分布更加均匀。理解了这一点，你就理解了 HashMap 高效运行的一半秘密。

下一节，我们来分析负载因子 0.75——这个看似随意的数字背后，藏着什么数学原理。
