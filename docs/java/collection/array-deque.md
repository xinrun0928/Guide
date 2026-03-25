# ArrayDeque：比 LinkedList 更快的双端队列

大多数 Java 开发者知道 `LinkedList` 可以用作队列和栈。

但很少有人知道，**ArrayDeque 比 LinkedList 更快**。

JDK 的官方文档甚至建议：用 ArrayDeque 替代 LinkedList 作为栈，用 ArrayDeque 替代 LinkedList 作为队列。

为什么？让我们深入探究。

## ArrayDeque 的实现

```java
public class ArrayDeque<E> extends AbstractCollection<E>
        implements Deque<E>, Cloneable, Serializable {
    
    // 循环数组
    private transient Object[] elements;
    
    // 头尾指针
    private transient int head;
    private transient int tail;
    
    // 构造方法
    public ArrayDeque() {
        elements = new Object[16];  // 默认容量 16
    }
    
    public ArrayDeque(int numElements) {
        elements = new Object[numElements];
    }
}
```

关键点：**循环数组 + 头尾指针**。

## 循环数组的秘密

普通数组删除第一个元素需要 O(n)（搬移后面的元素）。

循环数组通过**头指针**解决这个问题：

```
初始状态：[null, null, A, B, C, null, null]
              ↑head         ↑tail

addFirst(D) 后：[null, D, A, B, C, null, null]
                    ↑head    ↑tail

removeFirst() 后：[null, null, A, B, C, null, null]
                      ↑head    ↑tail
```

当 head 或 tail 超出数组边界时，**自动回绕到数组开头**：

```java
private static int calcNext(int index, int length) {
    return (index + 1) & (length - 1);  // 用位运算实现回绕
}
```

因为容量总是 2 的幂次，可以用 `& (length - 1)` 替代 `% length`。

## 核心操作

### addFirst()：O(1) 均摊

```java
public void addFirst(E e) {
    if (e == null)
        throw new NullPointerException();
    elements[head = (head - 1) & (elements.length - 1)] = e;
    if (head == tail)
        doubleCapacity();  // 扩容
}

private void doubleCapacity() {
    int p = head;
    int n = elements.length;
    int r = n - p;  // head 右边的元素数
    
    Object[] a = new Object[n << 1];
    
    // 复制 head 右边的部分
    System.arraycopy(elements, p, a, 0, r);
    // 复制 head 左边的部分
    System.arraycopy(elements, 0, a, r, p);
    
    head = 0;
    tail = n;
    elements = a;
}
```

### addLast()：O(1) 均摊

```java
public void addLast(E e) {
    if (e == null)
        throw new NullPointerException();
    elements[tail] = e;
    if ((tail = (tail + 1) & (elements.length - 1)) == head)
        doubleCapacity();
}
```

### pollFirst() / pollLast()：O(1)

```java
public E pollFirst() {
    int h = head;
    E result = (E) elements[h];
    if (result == null)
        return null;
    elements[h] = null;
    head = (head + 1) & (elements.length - 1);
    return result;
}

public E pollLast() {
    int t = (tail - 1) & (elements.length - 1);
    E result = (E) elements[t];
    if (result == null)
        return null;
    elements[t] = null;
    tail = t;
    return result;
}
```

## 为什么比 LinkedList 快？

### 1. 数组缓存友好

```java
// LinkedList：节点分散在堆中
class Node<E> {
    E item;
    Node<E> prev;
    Node<E> next;
}

// ArrayDeque：数组元素连续
Object[] elements;  // 连续内存
```

CPU 缓存可以预加载连续内存，而 LinkedList 的节点分散在堆各处，缓存命中极低。

### 2. 无节点对象开销

```java
// LinkedList 每个节点都是单独的对象
Node<E> node = new Node<>(e);  // 额外分配、GC 开销

// ArrayDeque 直接操作数组
elements[tail] = e;  // 简单赋值
```

### 3. 无指针引用

LinkedList 的每个节点有 prev 和 next 引用，这些引用本身也占用内存。

ArrayDeque 只有数组和两个整数索引。

## ArrayDeque vs LinkedList

| 特性 | ArrayDeque | LinkedList |
|-----|-----------|-----------|
| 底层 | 循环数组 | 双向链表 |
| 两端操作 | O(1) 均摊 | O(1) |
| 中间操作 | O(n) | O(n) |
| 内存占用 | 连续，预分配 | 分散，按需分配 |
| 缓存命中 | 高 | 低 |
| null 支持 | 不允许 | 允许 |
| 迭代器 | 弱一致 | 弱一致 |

## 使用场景

### 作为栈

```java
// 推荐：比 Stack 快
ArrayDeque<Integer> stack = new ArrayDeque<>();
stack.push(1);
stack.push(2);
stack.push(3);

while (!stack.isEmpty()) {
    System.out.println(stack.pop());  // 3, 2, 1
}
```

### 作为队列

```java
// 推荐：比 LinkedList 快
ArrayDeque<Integer> queue = new ArrayDeque<>();
queue.add(1);
queue.add(2);
queue.add(3);

while (!queue.isEmpty()) {
    System.out.println(queue.remove());  // 1, 2, 3
}
```

### 作为双端队列

```java
ArrayDeque<String> deque = new ArrayDeque<>();

deque.addFirst("first");
deque.addLast("last");
deque.addFirst("newFirst");

System.out.println(deque.removeFirst());  // "newFirst"
System.out.println(deque.removeLast());  // "last"
```

## 注意事项

### 1. 不允许 null

```java
ArrayDeque<String> deque = new ArrayDeque<>();
deque.add(null);  // NullPointerException
```

原因：`null` 被用来判断队列是否为空，和 `poll()` 的返回值冲突。

### 2. 容量自动扩展

```java
ArrayDeque<String> deque = new ArrayDeque<>();
// 初始容量 16
// 满后自动扩容为 32, 64, 128...
```

### 3. 适合作为临时容器

ArrayDeque 扩容时需要复制数组，不适合作为长期持有大量元素的容器。

如果需要长期持有大量数据，考虑 `ArrayList`。

## 经典应用：滑动窗口

```java
public class SlidingWindow {
    
    public static List<Integer> maxSlidingWindow(int[] nums, int k) {
        List<Integer> result = new ArrayList<>();
        ArrayDeque<Integer> deque = new ArrayDeque<>();  // 存储索引
        
        for (int i = 0; i < nums.length; i++) {
            // 移除窗口外的索引
            if (!deque.isEmpty() && deque.peekFirst() <= i - k) {
                deque.pollFirst();
            }
            
            // 移除比当前元素小的索引（它们永远不会是最大值）
            while (!deque.isEmpty() && nums[deque.peekLast()] <= nums[i]) {
                deque.pollLast();
            }
            
            deque.addLast(i);
            
            // 窗口形成后记录最大值
            if (i >= k - 1) {
                result.add(nums[deque.peekFirst()]);
            }
        }
        
        return result;
    }
    
    public static void main(String[] args) {
        int[] nums = {1, 3, -1, -3, 5, 3, 6, 7};
        int k = 3;
        System.out.println(maxSlidingWindow(nums, k));  // [3, 3, 5, 5, 6, 7]
    }
}
```

## 面试追问

### Q1: ArrayDeque 的容量为什么是 2 的幂次？

1. **位运算优化**：`head = (head - 1) & (length - 1)` 比 `head = (head - 1) % length` 快
2. **扩容方便**：翻倍后仍然是 2 的幂次

### Q2: ArrayDeque 是线程安全的吗？

**不是**。ArrayDeque 不是为并发设计的。

如果需要线程安全的队列，用 `ConcurrentLinkedQueue` 或 `LinkedBlockingQueue`。

### Q3: ArrayDeque 可以替代 ArrayList 吗？

不完全可以。

ArrayDeque 不支持随机访问（`get(int index)` 需要遍历），也不支持在中间插入/删除。

ArrayList 更适合需要随机访问的场景。

---

## 留给你的思考题

ArrayDeque 的 `toString()` 是怎么实现的？

```java
ArrayDeque<String> deque = new ArrayDeque<>();
deque.add("a");
deque.add("b");
deque.add("c");

System.out.println(deque);  // [a, b, c]
```

提示：由于是循环数组，head 不一定是 0，tail 也不一定大于 head。

遍历时需要"解开"循环，这和普通数组的遍历不同。

理解这个问题，你就完全掌握了循环数组的实现原理。
