# ConcurrentLinkedQueue 无锁实现原理

说起无锁队列，很多人会觉得神秘莫测。

不用锁，怎么保证线程安全？

答案就是 **CAS（Compare-And-Swap）**。

今天，我们来剖析 `ConcurrentLinkedQueue` 的无锁实现。

## CAS 是什么？

CAS 是现代 CPU 提供的一条指令：

```java
// 伪代码
boolean compareAndSwap(Object obj, long offset, Object expected, Object newValue) {
    if (obj[offset] == expected) {
        obj[offset] = newValue;
        return true;
    }
    return false;
}
```

三个参数：
- `obj`：要修改的对象
- `offset`：字段的内存偏移量
- `expected`：期望的当前值
- `newValue`：新值

原子操作：如果当前值等于期望值，就修改成新值，返回 true；否则不做任何操作，返回 false。

## ConcurrentLinkedQueue 结构

```java
public class ConcurrentLinkedQueue<E> extends AbstractQueue<E>
        implements Queue<E>, java.io.Serializable {
    
    // 头节点
    private transient volatile Node<E> head;
    
    // 尾节点
    private transient volatile Node<E> tail;
    
    // 节点
    private static class Node<E> {
        volatile E item;
        volatile Node<E> next;
    }
}
```

关键：**所有字段都是 volatile**，保证可见性。

## 插入：offer()

```java
public boolean offer(E e) {
    checkNotNull(e);
    final Node<E> newNode = new Node<E>(e);
    
    for (Node<E> t = tail, p = t;;) {
        Node<E> q = p.next;
        
        if (q == null) {
            // q 是 null，说明 p 是最后一个节点，尝试插入
            if (p.casNext(null, newNode)) {
                // 插入成功
                if (p != t)
                    casTail(t, newNode);  // 更新 tail
                return true;
            }
        }
        // tail 和 p 不一致，说明 tail 落后了，更新 p
        else if (p == q)
            p = (t != (t = tail)) ? t : head;
        else
            p = (p != t && t != (t = tail)) ? t : (q != null ? q : p);
    }
}
```

### 流程图解

```
初始: head -> A -> B -> C <- tail
                (p)   (q)

q = p.next = B (不是 null)

p != t? p != tail，所以 p = t = tail

继续循环:
q = p.next = C

插入新节点 D:
p.casNext(null, D) 成功

p != t? 不等于，更新 tail = D
```

### 为什么 tail 可能落后？

因为 `offer()` 只在**可能的情况下**更新 tail：

```java
if (p != t)
    casTail(t, newNode);
```

如果 `p == t`（p 正好是 tail），就不更新 tail。这样可以**减少 CAS 竞争**。

## 移除：poll()

```java
public E poll() {
    restartFromHead:
    for (;;) {
        for (Node<E> h = head, p = h, q;;) {
            E item = p.item;
            
            if (item != null && p.casItem(item, null)) {
                // 更新 head
                if (p != h)
                    updateHead(h, ((q = p.next) != null) ? q : p);
                return item;
            }
            
            if ((q = p.next) == null) {
                updateHead(h, p);
                return null;
            }
            
            if (p == q)
                continue restartFromHead;
            
            p = q;
        }
    }
}

private final void updateHead(Node<E> h, Node<E> p) {
    if (h != p && casHead(h, p))
        lazySetNext(h, h);
}

private static <E> void lazySetNext(Node<E> node, Node<E> val) {
    lazySetObjectVolatile(node, NEXT, val);
}
```

### poll() 的要点

1. **删除节点**：用 CAS 把 `item` 改成 null（逻辑删除）
2. **更新 head**：被删除节点的下一个变成新的 head
3. **head 永远是哨兵**：真正有数据的节点在 head 后面

```
poll() 前: head -> A -> B -> C <- tail
                      ↑
                     item = A (要删除的)

poll() 后: head -> B -> C <- tail
           (A.item = null，变成垃圾)
```

## 延迟更新策略

ConcurrentLinkedQueue 用了一个精妙的设计：**延迟更新 head 和 tail**。

### tail 的延迟更新

```java
// offer() 中
if (p != t)
    casTail(t, newNode);
```

只有当 p 不等于 tail 时，才更新 tail。这意味着 tail 可能**落后**一个或多个节点。

好处：**减少 CAS 竞争**。多个线程同时 offer，只需要一个更新 tail。

### head 的延迟更新

```java
// poll() 中
if (p != h)
    updateHead(h, ((q = p.next) != null) ? q : p);
```

只有当 p 不等于 head 时，才更新 head。

## 线程安全性证明

### 为什么不用锁也能线程安全？

1. **CAS 保证原子性**：插入/删除都是 CAS 操作
2. **volatile 保证可见性**：head 和 tail 的更新对所有线程可见
3. **无锁遍历**：通过 CAS 保证遍历过程中不被干扰

### 潜在问题：ABA 问题

```java
// CAS 只能检测值是否变化，无法检测"变回来"的情况
Thread1: 读取 A
Thread2: A -> B -> A（改了又改回来）
Thread1: CAS(A, newNode)  成功！
```

ConcurrentLinkedQueue 用 `Node.item` 作为 CAS 对象，如果 item 被改过又改回来，理论上会有 ABA 问题。

但实际上**不会有影响**：
- item 是数据，不是链表指针
- 指针（next）不会变回来（单向链表）

## 性能特点

| 特性 | 说明 |
|-----|------|
| 无锁 | 所有操作都是 CAS |
| 高并发 | 读多写多场景性能好 |
| 无界 | 链表无限增长 |
| 弱一致性 | size() 是近似值 |

## 适用场景

- **高并发队列**：生产者-消费者模式
- **无界队列**：不担心内存溢出
- **实时性要求不高**：size() 不精确

## 面试追问

### Q1: ConcurrentLinkedQueue 的 size() 准确吗？

**不准确**。

```java
public int size() {
    int count = 0;
    for (Node<E> p = first(); p != null; p = succ(p)) {
        if (p.item != null)
            ++count;
    }
    return count;
}
```

遍历链表计数，但因为无锁，可能有其他线程同时修改，所以是**近似值**。

### Q2: 为什么叫"非阻塞"队列？

因为它使用 CAS 实现，不会在等待锁时阻塞线程。

当 CAS 失败时，会**自旋重试**，而不是进入等待队列。

### Q3: ConcurrentLinkedQueue 和 BlockingQueue 的区别？

| 特性 | ConcurrentLinkedQueue | BlockingQueue |
|-----|----------------------|---------------|
| API | offer/poll | offer(e)/put(e)/poll()/take() |
| 阻塞 | 非阻塞 | 支持阻塞 |
| null | 允许 null | 不允许 null |
| 容量 | 无界 | 可有界可无界 |

---

## 留给你的思考题

ConcurrentLinkedQueue 是无界的，理论上可以无限增长。

但实际生产环境中，如果 producer 太快而 consumer 太慢，会发生什么？

提示：内存会不断增长，最终可能导致 OOM。

思考：如何避免这个问题？

方案一：用 `BlockingQueue`（有界队列），满了就阻塞
方案二：用 `SynchronousQueue`，不存储元素，直接传递
方案三：监控队列大小，超过阈值就告警

理解这个问题，你就掌握了队列选型的核心。
