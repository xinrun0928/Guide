# 栈与队列：实现与应用场景


## 一行代码引发的「递归」

你有没有见过这样的代码？

```java
public static void main(String[] args) {
    // 一行代码实现了什么？
    System.out.println(new ArrayList&lt;&gt;().stream().reduce(0, Integer::sum));
}
```

表面上看，这只是一行链式调用。但如果你理解背后的原理，会发现它藏着栈的影子——每个方法调用都在栈帧中执行，嵌套越深，栈帧越多。

栈，这个看似简单的数据结构，支撑着函数调用、表达式求值、括号匹配、浏览器前进后退……几乎无处不在。

而它的「兄弟」队列，则在消息队列、任务调度、宽度优先搜索中扮演核心角色。

今天，让我们深入理解这两种「简单却强大」的数据结构。


## 栈：后进先出（LIFO）

### 栈的核心特征

栈（Stack）是一种只允许在**一端**进行操作的数据结构。这一端叫做「栈顶」，另一端叫「栈底」。

- **入栈（push）**：将元素放到栈顶
- **出栈（pop）**：从栈顶移除元素
- **查看栈顶（peek）**：查看栈顶元素但不移除

```java
public interface Stack&lt;T&gt; {
    void push(T item);      // 入栈
    T pop();                // 出栈
    T peek();               // 查看栈顶
    boolean isEmpty();      // 是否为空
    int size();             // 栈大小
}
```

### 栈的数组实现

```java
public class ArrayStack&lt;T&gt; {
    private Object[] elements;
    private int top;  // 栈顶指针，-1 表示空栈
    private int capacity;

    public ArrayStack(int capacity) {
        this.capacity = capacity;
        this.elements = new Object[capacity];
        this.top = -1;
    }

    public void push(T item) {
        if (top >= capacity - 1) {
            throw new StackOverflowError("Stack is full");
        }
        elements[++top] = item;
    }

    @SuppressWarnings("unchecked")
    public T pop() {
        if (isEmpty()) {
            throw new IllegalStateException("Stack is empty");
        }
        return (T) elements[top--];
    }

    @SuppressWarnings("unchecked")
    public T peek() {
        if (isEmpty()) {
            throw new IllegalStateException("Stack is empty");
        }
        return (T) elements[top];
    }

    public boolean isEmpty() {
        return top == -1;
    }
}
```

### 栈的链表实现

```java
public class LinkedStack&lt;T&gt; {
    private Node top;
    private int size;

    private class Node {
        T item;
        Node next;
    }

    public void push(T item) {
        Node newNode = new Node();
        newNode.item = item;
        newNode.next = top;
        top = newNode;
        size++;
    }

    public T pop() {
        if (top == null) {
            throw new IllegalStateException("Stack is empty");
        }
        T item = top.item;
        top = top.next;
        size--;
        return item;
    }
}
```


## 栈的经典应用

### 1. 函数调用栈

这是栈最重要的应用，没有之一。

```java
public int compute(int n) {
    if (n <= 1) return n;
    return compute(n - 1) + compute(n - 2);  // 递归调用
}
```

每调用一次函数，就会创建一个栈帧（Stack Frame），包含：
- 参数
- 局部变量
- 返回地址

递归深度过大时，栈会溢出——这就是「栈溢出错误」（StackOverflowError）的由来。

### 2. 括号匹配

有效的括号组合：`()、[]、{}、([]){}`  
无效的括号组合：`([)]、{[(])}`

```java
public boolean isValid(String s) {
    Stack&lt;Character&gt; stack = new Stack&lt;&gt;();
    Map&lt;Character, Character&gt; map = Map.of(')', '(', ']', '[', '}', '{');
    
    for (char c : s.toCharArray()) {
        if (map.containsKey(c)) {
            // 右括号：检查栈顶是否匹配
            if (stack.isEmpty() || stack.pop() != map.get(c)) {
                return false;
            }
        } else {
            // 左括号：入栈
            stack.push(c);
        }
    }
    return stack.isEmpty();
}
```

### 3. 单调栈：Next Greater Element

单调栈是「栈」的思想延伸——维护一个单调递增或递减的栈。

```java
// 找到每个元素右边第一个比它大的元素
public int[] nextGreaterElement(int[] nums) {
    int[] result = new int[nums.length];
    Stack&lt;Integer&gt; stack = new Stack&lt;&gt;();
    
    // 从右往左遍历
    for (int i = nums.length - 1; i >= 0; i--) {
        // 维护单调递减栈：弹出比当前元素小的
        while (!stack.isEmpty() && stack.peek() <= nums[i]) {
            stack.pop();
        }
        // 栈顶就是下一个更大元素
        result[i] = stack.isEmpty() ? -1 : stack.peek();
        stack.push(nums[i]);
    }
    return result;
}
```

单调栈的时间复杂度是 O(n)，因为每个元素最多入栈出栈各一次。

### 4. 表达式求值

计算器类问题（LeetCode 227）用两个栈实现：操作数栈和操作符栈。

```java
public int calculate(String s) {
    Stack&lt;Integer&gt; nums = new Stack&lt;&gt;();
    Stack&lt;Character&gt; ops = new Stack&lt;&gt;();
    int num = 0;
    
    for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (Character.isDigit(c)) {
            num = num * 10 + (c - '0');
        }
        if (!Character.isDigit(c) && c != ' ' || i == s.length() - 1) {
            nums.push(num);
            num = 0;
            
            while (!ops.isEmpty() && precedence(ops.peek()) >= precedence(c)) {
                nums.push(applyOp(ops.pop(), nums.pop(), nums.pop()));
            }
            ops.push(c);
        }
    }
    
    while (!ops.isEmpty()) {
        nums.push(applyOp(ops.pop(), nums.pop(), nums.pop()));
    }
    return nums.pop();
}
```


## 队列：先进先出（FIFO）

### 队列的核心特征

队列（Queue）只允许在**一端**插入，在**另一端**删除。

- **入队（enqueue）**：在队尾添加元素
- **出队（dequeue）**：从队首移除元素

```java
public interface Queue&lt;T&gt; {
    void enqueue(T item);    // 入队
    T dequeue();             // 出队
    T peek();                // 查看队首
    boolean isEmpty();
    int size();
}
```

### 队列的数组实现（循环队列）

普通队列用数组实现时会有「假溢出」问题——明明前面有空位，但队尾已经到数组尽头。

循环队列通过「取模」来解决这个问题。

```java
public class CircularQueue&lt;T&gt; {
    private Object[] elements;
    private int front;   // 指向队首元素
    private int rear;    // 指向下一个入队位置
    private int capacity;

    public CircularQueue(int capacity) {
        this.capacity = capacity;
        this.elements = new Object[capacity];
        this.front = 0;
        this.rear = 0;
    }

    public boolean enqueue(T item) {
        if ((rear + 1) % capacity == front) {
            return false;  // 队列已满
        }
        elements[rear] = item;
        rear = (rear + 1) % capacity;
        return true;
    }

    @SuppressWarnings("unchecked")
    public T dequeue() {
        if (isEmpty()) {
            throw new IllegalStateException("Queue is empty");
        }
        T item = (T) elements[front];
        front = (front + 1) % capacity;
        return item;
    }

    public boolean isEmpty() {
        return front == rear;
    }
}
```

### 队列的链表实现

```java
public class LinkedQueue&lt;T&gt; {
    private Node head;
    private Node tail;
    private int size;

    private class Node {
        T item;
        Node next;
    }

    public void enqueue(T item) {
        Node newNode = new Node();
        newNode.item = item;
        if (tail != null) {
            tail.next = newNode;
        }
        tail = newNode;
        if (head == null) {
            head = tail;
        }
        size++;
    }

    public T dequeue() {
        if (head == null) {
            throw new IllegalStateException("Queue is empty");
        }
        T item = head.item;
        head = head.next;
        if (head == null) {
            tail = null;
        }
        size--;
        return item;
    }
}
```


## 队列的变体

### 双端队列（Deque）

双端队列允许在两端进行入队和出队操作，兼顾了栈和队列的特性。

```java
Deque&lt;Integer&gt; deque = new ArrayDeque&lt;&gt;();
deque.addFirst(1);    // 队首入队
deque.addLast(2);     // 队尾入队
deque.removeFirst(); // 队首出队
deque.removeLast();   // 队尾出队
```

### 优先级队列（Priority Queue）

优先级队列不是 FIFO，而是根据优先级决定出队顺序。

```java
// 小顶堆实现
PriorityQueue&lt;Integer&gt; minHeap = new PriorityQueue&lt;&gt;();

// 大顶堆实现
PriorityQueue&lt;Integer&gt; maxHeap = new PriorityQueue&lt;&gt;(Collections.reverseOrder());
```

Java 的 `PriorityQueue` 底层是二叉堆（完全二叉树，用数组存储）。


## 队列的经典应用

### 1. 广度优先搜索（BFS）

```java
public void bfs(int[][] grid, int startX, int startY) {
    Queue&lt;int[]&gt; queue = new LinkedList&lt;&gt;();
    boolean[][] visited = new boolean[grid.length][grid[0].length];
    
    queue.offer(new int[]{startX, startY});
    visited[startX][startY] = true;
    
    int[][] directions = {{0,1}, {0,-1}, {1,0}, {-1,0}};
    
    while (!queue.isEmpty()) {
        int[] pos = queue.poll();
        int x = pos[0], y = pos[1];
        
        for (int[] d : directions) {
            int nx = x + d[0], ny = y + d[1];
            if (nx >= 0 && nx < grid.length && ny >= 0 && ny < grid[0].length
                && !visited[nx][ny]) {
                visited[nx][ny] = true;
                queue.offer(new int[]{nx, ny});
            }
        }
    }
}
```

### 2. 滑动窗口最大值

单调队列的经典应用（LeetCode 239）：

```java
public int[] maxSlidingWindow(int[] nums, int k) {
    if (nums == null || k <= 0) return new int[0];
    
    int[] result = new int[nums.length - k + 1];
    Deque&lt;Integer&gt; deque = new ArrayDeque&lt;&gt;();  // 存索引
    
    for (int i = 0; i < nums.length; i++) {
        // 维护单调递减队列：移除超出窗口的元素
        while (!deque.isEmpty() && deque.peekFirst() <= i - k) {
            deque.pollFirst();
        }
        // 移除比当前元素小的（它们不可能是最大值）
        while (!deque.isEmpty() && nums[deque.peekLast()] < nums[i]) {
            deque.pollLast();
        }
        deque.offerLast(i);
        
        // 窗口形成后记录最大值
        if (i >= k - 1) {
            result[i - k + 1] = nums[deque.peekFirst()];
        }
    }
    return result;
}
```

### 3. 生产者-消费者模式

消息队列（Kafka、RabbitMQ）的核心思想就是队列——生产者往队列放消息，消费者从队列取消息。

```java
// 简单的生产者-消费者
public class ProducerConsumer {
    private Queue&lt;Task&gt; queue = new LinkedList&lt;&gt;();
    private int capacity = 100;
    
    public synchronized void produce(Task task) throws InterruptedException {
        while (queue.size() >= capacity) {
            wait();
        }
        queue.offer(task);
        notifyAll();  // 通知消费者
    }
    
    public synchronized Task consume() throws InterruptedException {
        while (queue.isEmpty()) {
            wait();
        }
        Task task = queue.poll();
        notifyAll();  // 通知生产者
        return task;
    }
}
```


## 栈与队列的对比

| 特性 | 栈 | 队列 |
|------|------|------|
| 操作原则 | LIFO（后进先出） | FIFO（先进先出） |
| 主要操作端 | 一端（栈顶） | 两端（队首/队尾） |
| 主要应用 | 函数调用、括号匹配、单调栈 | BFS、任务调度、消息队列 |
| 变体 | 单调栈 | 双端队列、优先级队列 |


## 总结

栈和队列是两种「正交」的数据结构——一个反向，一个正向。

但它们的价值不在于本身简单，而在于**支撑了更复杂的算法和系统**：
- 函数调用栈是程序运行的基础
- 单调栈解决「下一个更大元素」类问题
- 优先级队列是堆排序思想的工程化
- BFS + 队列是图遍历的基石

## 面试追问方向

- 如何用两个栈实现队列？（入队用栈A，出队用栈B，B空时把A全部倒入B）
- 如何用两个队列实现栈？（每次操作后把前n-1个移到另一个队列）
- 单调栈在有哪些变形应用？（接雨水、柱状图最大矩形）
- 什么是「スタックオーバーフロー」？（栈溢出，和 JVM 栈帧的关系）
