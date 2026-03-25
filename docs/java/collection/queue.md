# Queue 接口与实现类

你有没有想过：为什么队列的方法命名这么奇怪？`add` 和 `offer` 有什么区别？`remove` 和 `poll` 有什么区别？

这些细微的区别，藏着 Java 设计者的深思熟虑。

## Queue 的两类方法

Queue 定义了两套方法，区别在于"失败时的行为"：

```java
public interface Queue<E> extends Collection<E> {
    
    // 抛异常
    boolean add(E e);      // 队满抛 IllegalStateException
    E remove();            // 队空抛 NoSuchElementException
    E element();           // 队空抛 NoSuchElementException
    
    // 返回特殊值
    boolean offer(E e);    // 队满返回 false
    E poll();              // 队空返回 null
    E peek();              // 队空返回 null
}
```

| 操作 | 抛异常 | 返回特殊值 |
|-----|--------|-----------|
| 插入 | `add(e)` | `offer(e)` |
| 移除 | `remove()` | `poll()` |
| 检查 | `element()` | `peek()` |

### 什么时候用哪个？

```java
Queue<String> queue = new LinkedList<>();

// 期望队列有界，用 offer 更安全
if (queue.offer("item")) {
    // 插入成功
} else {
    // 队列满了
}

// 队列应该不会空，用 remove
try {
    String item = queue.remove();
} catch (NoSuchElementException e) {
    // 队列为空
}

// 队列可能为空，用 poll
String item = queue.poll();
if (item != null) {
    // 有元素
}
```

## 单端队列 vs 双端队列

Queue 是**单端队列**，只能从队尾插入、队头移除。

Deque 是**双端队列**，两端都可以插入和移除：

```java
public interface Deque<E> extends Queue<E> {
    
    // 队头操作
    void addFirst(E e);
    void addLast(E e);
    E removeFirst();
    E removeLast();
    
    // 队尾操作
    void push(E e);        // 等价于 addFirst
    E pop();                // 等价于 removeFirst
}
```

### Deque 的额外方法

```java
Deque<String> deque = new ArrayDeque<>();

// 两端都可以添加
deque.addFirst("first");
deque.addLast("last");

// 两端都可以移除
String f = deque.removeFirst();  // "first"
String l = deque.removeLast();   // "last"

// 作为栈使用
deque.push("A");
deque.push("B");
String top = deque.pop();  // "B"（后进先出）
```

## 队列类型分类

```
Queue
├── 非阻塞队列
│   ├── ArrayDeque（双端队列，比 LinkedList 快）
│   ├── PriorityQueue（优先级队列）
│   └── ConcurrentLinkedQueue（无界无锁队列）
│
└── 阻塞队列
    ├── ArrayBlockingQueue（有界）
    ├── LinkedBlockingQueue（可选有界）
    ├── PriorityBlockingQueue（优先级）
    └── DelayQueue（延迟）
```

## Deque 的应用

### 作为栈使用

```java
// ArrayDeque 作为栈
Deque<Integer> stack = new ArrayDeque<>();

stack.push(1);
stack.push(2);
stack.push(3);

while (!stack.isEmpty()) {
    System.out.println(stack.pop());  // 3, 2, 1
}
```

### 作为队列使用

```java
// ArrayDeque 作为队列
Deque<Integer> queue = new ArrayDeque<>();

queue.add(1);
queue.add(2);
queue.add(3);

while (!queue.isEmpty()) {
    System.out.println(queue.remove());  // 1, 2, 3
}
```

### ArrayDeque vs LinkedList

| 特性 | ArrayDeque | LinkedList |
|-----|-----------|-----------|
| 底层 | 循环数组 | 双向链表 |
| 速度 | 快（数组缓存友好） | 慢（节点对象开销） |
| 内存 | 连续，预分配 | 按需分配 |
| null | 不允许 | 允许 |
| 迭代器 | 弱一致 | 弱一致 |

## 队列的实现选择

```java
// 作为栈：ArrayDeque 比 Stack 快
Deque<Integer> stack = new ArrayDeque<>();

// 作为队列：ArrayDeque 比 LinkedList 快
Deque<Integer> queue = new ArrayDeque<>();

// 需要线程安全：ConcurrentLinkedQueue（非阻塞）
ConcurrentLinkedQueue<Integer> concurrent = new ConcurrentLinkedQueue<>();

// 需要阻塞能力：LinkedBlockingQueue
BlockingQueue<Integer> blocking = new LinkedBlockingQueue<>();
```

## 经典应用：约瑟夫环

```java
public class JosephusProblem {
    
    public static void main(String[] args) {
        int n = 7;  // 7 个人
        int k = 3;  // 每次数到 3 就出局
        
        Queue<Integer> queue = new LinkedList<>();
        
        // 初始化
        for (int i = 1; i <= n; i++) {
            queue.offer(i);
        }
        
        // 报数
        while (queue.size() > 1) {
            // 数 k-1 个
            for (int i = 1; i < k; i++) {
                queue.offer(queue.poll());
            }
            // 第 k 个出局
            System.out.println("Out: " + queue.poll());
        }
        
        // 最后一个人
        System.out.println("Winner: " + queue.peek());
    }
}
```

## 面试追问

### Q1: 什么情况下 Queue 会满？

对于有界队列（如 ArrayBlockingQueue），容量满了就不能再插入。

对于无界队列（如 LinkedList、ArrayDeque、PriorityQueue），理论上不会满（直到内存耗尽）。

### Q2: ArrayDeque 为什么比 LinkedList 快？

1. **缓存友好**：数组元素在内存中是连续的，CPU 缓存可以预加载
2. **无节点对象开销**：LinkedList 每个节点都是单独的对象，有额外的内存分配和指针引用
3. **无 GC 压力**：节点少，GC 需要扫描的对象少

### Q3: Deque 和 Queue 的关系是什么？

Deque extends Queue，双端队列是队列的扩展。

Deque 既可以当队列用（FIFO），也可以当栈用（LIFO）。

---

## 留给你的思考题

实现一个"滑动窗口"算法：给定数组和窗口大小 k，返回每个窗口的最大值。

例如：`[1,3,-1,-3,5,3,6,7]`，k=3

结果：`[3,3,5,5,6,7]`

提示：用 Deque 存储窗口中的元素索引，保持递减顺序。

这个问题的变体经常出现在算法面试中，理解其思想很有价值。
