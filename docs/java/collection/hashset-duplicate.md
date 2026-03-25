# HashSet 如何判断元素重复：hashCode 与 equals 的契约

你见过这种情况吗？

```java
Set<User> set = new HashSet<>();
User u1 = new User("Alice", 18);
User u2 = new User("Alice", 18);

set.add(u1);
set.add(u2);

System.out.println(set.size());  // 2？还是 1？
```

如果你答不上来，说明你对 `hashCode()` 和 `equals()` 的契约还理解得不够透彻。

**HashSet 判断元素重复，依赖的是 hashCode() 和 equals() 的配合。**

## 两个概念：相等性

Java 中有两种「相等」：

| 类型 | 方法 | 说明 |
|-----|-----|-----|
| 引用相等 | == | 同一个内存地址 |
| 对象相等 | equals() | 内容相同 |

```java
String s1 = new String("hello");
String s2 = new String("hello");

s1 == s2              // false，不同对象
s1.equals(s2)         // true，内容相同
```

## HashSet 判断重复的流程

HashSet 判断两个元素是否重复，需要**两步验证**：

```
┌─────────────────────────────────────────────────────────────┐
│                     HashSet 添加元素                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1: 计算 hashCode()                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  if (hash1 != hash2) → 一定不重复，添加成功！        │   │
│  │  if (hash1 == hash2) → 进入 Step 2                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│  Step 2: 比较 equals()                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  if (equals() == true)  → 重复，不添加              │   │
│  │  if (equals() == false) → 不重复，添加到链表        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**先比较 hashCode()，hash 相同时再比较 equals()。**

## hashCode() 的作用：快速过滤

为什么不能直接用 equals()？

因为 equals() 可能很慢。如果 HashMap 有 100 万个元素，每次 add 都比较 100 万次 equals()，那太慢了。

hashCode() 的作用是**快速过滤**：先计算 hash，不同 hash 的元素一定不相等，不需要比较 equals()。

```
添加 "hello"：

第一步：计算 hash
┌─────────────────────────────────────────┐
│  "hello".hashCode() = 99162322          │
│                                         │
│  计算 table[99162322 % 16]              │
│  找到 table[14]                         │
└─────────────────────────────────────────┘

第二步：如果桶为空，直接添加
┌─────────────────────────────────────────┐
│  table[14] → Node("hello", value)       │
└─────────────────────────────────────────┘

添加 "world"（假设 hash 不同）：
┌─────────────────────────────────────────┐
│  "world".hashCode() = 113318802         │
│  找到 table[10]（和 "hello" 不同）      │
│  直接添加到 table[10]                    │
└─────────────────────────────────────────┘

添加 "hello2"（假设 hash 相同）：
┌─────────────────────────────────────────┐
│  "hello2".hashCode() = 99162322（假设）  │
│  找到 table[14]（和 "hello" 相同）      │
│  table[14] 不为空，遍历链表比较 equals   │
│  "hello".equals("hello2") = false      │
│  不重复，添加到链表末尾                   │
└─────────────────────────────────────────┘
```

## 为什么需要 equals()？

因为不同的对象可能产生**相同的 hash**（哈希碰撞）：

```java
String s1 = "Aa";   // hashCode() = 0x2E7A2E7A
String s2 = "BB";   // hashCode() = 0x2E7A2E7B

// hash 值相差很小
(31 & 0x2E7A2E7A) = 10
(31 & 0x2E7A2E7B) = 11
// 低 5 位不同，能区分

// 但有些对象的 hash 就是会碰撞
// 此时需要 equals() 来最终判断
```

hash 相同 ≠ 对象相等。equals() 是最终的「仲裁者」。

## hashCode() 和 equals() 的契约

Java 对这两个方法有一个强制契约（来自 `Object` 类的规范）：

```
1. 一致性：如果两个对象 equals() 返回 true，
   它们的 hashCode() 必须返回相同的值。

2. 可重复性：同一个对象多次调用 hashCode()，
   必须返回相同的值（除非对象的属性被修改）。

3. 反过来不成立：hashCode() 相同，equals() 不一定返回 true。
```

### 违反契约的后果

```java
public class Student {
    private String name;
    private int age;
    
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Student student = (Student) o;
        return age == student.age && 
               Objects.equals(name, student.name);
    }
    
    // 错误：重写 equals 但没有重写 hashCode！
}

// 使用时
public class Main {
    public static void main(String[] args) {
        Set<Student> set = new HashSet<>();
        Student s1 = new Student("Alice", 18);
        Student s2 = new Student("Alice", 18);
        
        set.add(s1);
        System.out.println(set.contains(s2));  // false？！！
    }
}
```

因为 `s1` 和 `s2` 是不同对象，JVM 默认的 hashCode() 基于内存地址生成，所以很可能 hash 不同，导致 HashSet 无法正确识别它们是「相同」的。

## 正确的实现方式

```java
public class Student {
    private String name;
    private int age;
    
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Student student = (Student) o;
        return age == student.age && 
               Objects.equals(name, student.name);
    }
    
    @Override
    public int hashCode() {
        // 用 Objects.hash() 组合多个字段的 hashCode
        return Objects.hash(name, age);
        // 等价于：
        // int result = name != null ? name.hashCode() : 0;
        // result = 31 * result + age;
        // return result;
    }
}
```

### IDEA 自动生成的 hashCode()

```java
@Override
public int hashCode() {
    int result = name != null ? name.hashCode() : 0;
    result = 31 * result + age;
    return result;
}
```

这个公式的原理：
- 用 31 是因为它是质数，可以减少哈希碰撞
- 乘以 31 可以让高位信息参与运算
- 31 * i = (i << 5) - i，JVM 会优化为移位和减法

## 常见场景：String 的 hashCode

String 类重写了 hashCode()，确保内容相同的字符串 hashCode 也相同：

```java
"hello".hashCode() = 99162322
"hello".hashCode() = 99162322  // 相同

// 所以
Set<String> set = new HashSet<>();
set.add("hello");
set.contains("hello");  // true
```

这正是 HashSet/HashMap 用 String 作为 key 时性能好的原因之一。

## 为什么 hash 相同但 equals 不同？

这是**哈希碰撞**，是正常现象：

```java
// 模拟哈希碰撞
// 故意找两个 hashCode() 相同的字符串
// （实际中很少见，但原理存在）

"Aa".hashCode() = 0x2E7A2E7A
"BB".hashCode() = 0x2E7A2E7B

// 某些情况下它们会碰撞
// 例如容量很小时
(7 & 0x2E7A2E7A) = 0b...010 = 2
(7 & 0x2E7A2E7B) = 0b...010 = 2
// 碰撞了！

// 但
"Aa".equals("BB") = false
// 所以 HashMap 会正确处理
```

## hashCode 计算的性能优化

HashMap 在 put 时会计算 hash 并缓存，避免重复计算：

```java
static class Node<K, V> {
    final int hash;  // 缓存 hash
    final K key;
    V value;
    Node<K, V> next;
    
    Node(int hash, K key, V value, Node<K, V> next) {
        this.hash = hash;
        this.key = key;
        this.value = value;
        this.next = next;
    }
}
```

put 时计算一次 hash，之后遍历链表时直接用缓存的 hash：

```java
if (e.hash == hash && 
    (e.key == key || (key != null && key.equals(e.key))))
```

## 面试追问方向

1. **为什么重写 equals() 时必须重写 hashCode()？**

因为 HashSet/HashMap 依赖「相等的对象必须有相同的 hashCode」这一契约。如果只重写 equals() 不重写 hashCode()，相等的对象可能 hash 不同，导致集合操作失败。

2. **hashCode() 返回相同的值，equals() 一定返回 true 吗？**

不一定。hash 相同只是说明元素可能相等，需要 equals() 来最终确认。这是哈希碰撞，不是错误。

3. **为什么 String 的 hashCode() 用 31 作为乘数？**

31 是质数，且 31 = 32 - 1 = 1 << 5 - 1，JVM 会优化为 `(i << 5) - i`，性能好。质数相乘可以减少碰撞。

4. **如果 hashCode() 总是返回相同的值会怎样？**

HashMap 会退化为链表，所有元素都存在同一个桶里。put 和 get 的复杂度从 O(1) 退化为 O(n)。

5. **为什么 Integer、Long 等包装类的 hashCode() 就是自己的值？**

因为它们是「值对象」，相等意味着值相同，值相同意味着 hashCode 相同。直接返回自己是最优选择。

---

hashCode() 和 equals() 的契约是 Java 中最重要的设计规范之一。理解了它，你就理解了 HashSet/HashMap 去重的本质，也能在面试中应对各种追问。

下一节，我们来看看 LinkedHashSet——它是如何保持插入顺序的。
