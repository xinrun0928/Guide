# HashMap.put() 全流程源码解析

大多数人会用 HashMap，但面试时被问到 `put()` 方法的完整流程，十个人里有八个只能说出"计算 hash，然后插入"。

如果你能完整说出 JDK 8 的 `put()` 流程，说明你对 HashMap 的理解已经超越了 CRUD 程序员。

今天，我们来死磕源码。

## 入口：put() 方法

```java
public V put(K key, V value) {
    return putVal(hash(key), key, value, false, true);
}
```

只有一个参数的 `put()`，内部调用 `putVal()`。关键参数：

- `hash(key)`：计算 key 的 hash
- `onlyIfAbsent`：false 表示 key 存在时覆盖
- `evict`：true 表示创建模式（LinkedHashMap 用）

## 第一步：计算 hash

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

这就是**扰动函数**。JDK 8 简化版，只需要一步异或：

- `(h = key.hashCode())` 获取原始 hash
- `h >>> 16` 右移 16 位
- `h ^ (h >>> 16)` 高位信息混入低位

null key 的 hash 是 0，所以 null key 永远在 table[0]。

## 第二步：putVal() 核心逻辑

```java
final V putVal(int hash, K key, V value, boolean onlyIfAbsent,
               boolean evict) {
    Node<K,V>[] tab;
    Node<K,V> p;
    int n, i;
    
    // 1. 初始化：如果 table 为空或长度为 0，扩容
    if ((tab = table) == null || (n = tab.length) == 0)
        n = (tab = resize()).length;
    
    // 2. 定位数组下标：如果该位置为空，直接创建节点
    if ((p = tab[i = (n - 1) & hash]) == null)
        tab[i] = newNode(hash, key, value, null);
    else {
        // 3. 该位置有值，发生了哈希碰撞
        Node<K,V> e;
        K k;
        
        // 4. 判断第一个节点的 key 是否匹配
        if (p.hash == hash &&
            ((k = p.key) == key || (key != null && key.equals(k))))
            e = p;
        else if (p instanceof TreeNode)
            // 5. 第一个节点是红黑树节点，插入树中
            e = ((TreeNode<K,V>) p).putTreeVal(this, tab, hash, key, value);
        else {
            // 6. 链表，遍历查找
            for (int binCount = 0; ; ++binCount) {
                if ((e = p.next) == null) {
                    // 7. 链表尾部，插入新节点
                    p.next = newNode(hash, key, value, null);
                    
                    // 8. 检查是否需要树化
                    if (binCount >= TREEIFY_THRESHOLD - 1) // -1 for 1st
                        treeifyBin(tab, hash);
                    break;
                }
                
                // 9. 遍历过程中找到 key，退出循环
                if (e.hash == hash &&
                    ((k = e.key) == key || (key != null && key.equals(k))))
                    break;
                    
                p = e;
            }
        }
        
        // 10. key 存在，覆盖 value
        if (e != null) {
            V oldValue = e.value;
            if (!onlyIfAbsent || oldValue == null)
                e.value = value;
            afterNodeAccess(e);  // LinkedHashMap 用
            return oldValue;
        }
    }
    
    // 11. 结构修改计数 + 1
    ++modCount;
    
    // 12. 检查是否需要扩容
    if (++size > threshold)
        resize();
    
    afterNodeInsertion(evict);  // LinkedHashMap 用
    return null;
}
```

## 流程图解

```
put(key, value)
    │
    ▼
hash(key)  ─────────► 计算 hash 值
    │
    ▼
table 为空？ ────Yes──► resize() 初始化
    │No
    ▼
i = (n-1) & hash ──► 定位数组下标
    │
    ▼
tab[i] == null？ ──Yes──► 直接插入节点，结束
    │No
    ▼
遍历链表/红黑树
    │
    ├──► 找到 key ──► 覆盖 value，返回旧值
    │
    └──► 没找到 key ──► 插入尾部
                              │
                              ▼
                       binCount >= 7？
                              │
                    ┌─────────┴─────────┐
                   Yes                  No
                    │                    │
                    ▼                    ▼
              treeifyBin()          检查是否扩容
                    │                    │
                    └────────┬───────────┘
                             ▼
                        size++
```

## 关键点解析

### 1. 定位下标：`(n - 1) & hash`

为什么用 `&`（按位与）而不是 `%`（取模）？

因为 `(n-1) & hash` **等价于** `hash % n`，但速度更快。当 n 是 2 的幂次时，`n-1` 的二进制是全 1，位运算可以直接定位。

这就是为什么 HashMap 的容量都是 2 的幂次：16, 32, 64...

### 2. 链表遍历时的 key 比较

```java
e.hash == hash && ((k = e.key) == key || key.equals(k))
```

三步检查：

1. `e.hash == hash`：hash 相等（快速过滤）
2. `(k = e.key) == key`：key 引用相等（最快）
3. `key.equals(k)`：equals 方法比较（字符串等需要字符级比较）

为什么顺序是这样？因为 `hash ==` 是最快的整数比较，放在最前面可以快速过滤。

### 3. onlyIfAbsent 参数

`put()` 调用时 `onlyIfAbsent = false`，意味着**覆盖已有值**。

但 `putIfAbsent()` 调用时 `onlyIfAbsent = true`，只在新 key 不存在时才插入。

```java
// put() - 覆盖
public V put(K key, V value) {
    return putVal(hash(key), key, value, false, true);
}

// putIfAbsent() - 不覆盖
public V putIfAbsent(K key, V value) {
    return putVal(hash(key), key, value, true, true);
}
```

### 4. 返回值

- key 不存在：返回 `null`
- key 存在：返回**旧值**

注意：`null` 也可能是旧值（比如 `map.put("a", null)` 后再 put 返回的就是 null）。要区分"不存在"和"值是 null"，用 `containsKey()` 先判断。

### 5. treeifyBin() 不一定树化

```java
final void treeifyBin(Node<K,V>[] tab, int hash) {
    int n, index;
    Node<K,V> e;
    
    if (tab == null || (n = tab.length) < MIN_TREEIFY_CAPACITY)
        resize();  // 容量 < 64，扩容而不是树化
    else
        // 真正树化
        ...
}
```

容量小于 64 时，**优先扩容**，而不是树化。只有容量 >= 64 时，才会把链表转成红黑树。

## putIfAbsent vs put 的区别

```java
Map<String, Integer> map = new HashMap<>();

// put - 总是返回旧值
Integer old1 = map.put("a", 1);  // old1 = null
Integer old2 = map.put("a", 2); // old2 = 1（新值覆盖）

// putIfAbsent - key 存在时不覆盖
Integer old3 = map.putIfAbsent("a", 3); // old3 = 2（不覆盖）
Integer old4 = map.putIfAbsent("b", 4); // old4 = null（插入成功）
```

实战场景：`putIfAbsent` 常用于"懒加载"缓存：

```java
// 不好的写法
if (!map.containsKey(key)) {
    map.put(key, computeValue());
}

// 好的写法 - 原子操作
map.putIfAbsent(key, computeValue());
```

但注意：`putIfAbsent` 不能完全替代同步，因为 `computeValue()` 可能被调用多次（取决于具体实现）。

## 面试追问

### Q1: HashMap 的 key 可以是 null 吗？

可以，但最多只能有一个 null key（因为 key 唯一）。

`hash(null) = 0`，所以 null key 固定在 `table[0]` 位置。

```java
map.put(null, "value1");  // OK
map.put(null, "value2");  // value2 覆盖 value1
map.get(null);            // 返回 "value2"
```

### Q2: HashMap 的 value 可以是 null 吗？

可以，可以有多个 null value。

```java
map.put("a", null);  // OK
map.put("b", null);  // OK
map.get("a");        // 返回 null（可能是 null，也可能是 key 不存在）
```

要判断是"值为 null"还是"key 不存在"，用 `containsKey()`。

### Q3: 扩容后节点一定在新位置的"原位置"或"原位置 + 旧容量"吗？

是的，JDK 8 的优化保证：

```java
int newIndex = (e.hash & oldCap) == 0 ? oldIndex : oldIndex + oldCap;
```

如果 `(hash & oldCap) == 0`，位置不变；否则，位置 = 原位置 + 旧容量。

这要求**容量必须是 2 的幂次**，否则这个优化不成立。

---

## 留给你的思考题

JDK 8 的 `put()` 方法在**并发**场景下，有什么问题？

提示：考虑以下场景

1. 线程 A 和 B 同时 put，key 不同，但 hash 碰撞，都定位到 `table[i]`
2. 线程 A 判断 `p instanceof TreeNode`，正在执行 `putTreeVal()`
3. 线程 B 同时也在遍历这个链表

并发 put 会导致数据不一致，但不会死循环——为什么？

理解这个问题，你就完全掌握了 HashMap 的并发特性。
