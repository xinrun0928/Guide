# PriorityQueue 堆结构与排序

如果让你实现一个"总是能快速找到最大（或最小）元素"的数据结构，你会怎么做？

排序数组？太慢，每次插入/删除都要 O(n)。

平衡二叉树？可以，但太复杂。

今天介绍一个简洁又强大的数据结构：**堆**。

## 什么是堆？

堆是一种**完全二叉树**，满足堆序性质：

- **最大堆**：父节点 >= 子节点
- **最小堆**：父节点 <= 子节点

```
最大堆示例：
        10
       /  \
      8    7
     / \   / \
    3   4 2   1

数组表示：[10, 8, 7, 3, 4, 2, 1]
```

Java 的 `PriorityQueue` 是**最小堆**。

## 完全二叉树的数组表示

堆不需要节点对象，用数组就能高效表示：

```java
// 索引关系
parent(i) = (i - 1) / 2
left(i) = 2 * i + 1
right(i) = 2 * i + 2
```

```
数组: [10, 8, 7, 3, 4, 2, 1]

索引:   0  1  2  3  4  5  6

树结构:
        0(10)
       /     \
     1(8)    2(7)
     /  \    /   \
   3(3) 4(4) 5(2) 6(1)
```

## PriorityQueue 的核心操作

### 1. 入队：offer()

时间复杂度：O(log n)

```java
public boolean offer(E e) {
    if (e == null)
        throw new NullPointerException();
    modCount++;
    int i = size;
    if (i >= queue.length)
        grow(i + 1);
    size = i + 1;
    if (i == 0)
        queue[0] = e;
    else
        siftUp(i, e);  // 上浮
    return true;
}

private void siftUp(int k, E x) {
    while (k > 0) {
        int parent = (k - 1) >>> 1;
        if (compare(queue[parent], x) <= 0)
            break;
        queue[k] = queue[parent];
        k = parent;
    }
    queue[k] = x;
}
```

**上浮**：如果新元素比父节点小，就和父节点交换，重复直到满足堆序。

```
插入 1：
        10
       /  \
      8    7
     / \   / \
    3   4 2   1  <- 插入位置
    ↓
        10
       /  \
      8    7
     / \   / \
    3   4 2   1
    ↓
        10
       /  \
      8    1
     / \   / \
    3   4 2   7  <- 1 上浮
    ↓
        1     <- 最终位置
       /  \
      8    7
     / \   / \
    3   4 2   10
```

### 2. 出队：poll()

时间复杂度：O(log n)

```java
public E poll() {
    if (size == 0)
        return null;
    int s = --size;
    modCount++;
    E result = (E) queue[0];
    E x = (E) queue[s];
    queue[s] = null;
    if (s != 0)
        siftDown(0, x);  // 下沉
    return result;
}

private void siftDown(int k, E x) {
    int half = size >>> 1;
    while (k < half) {
        int child = (k << 1) + 1;
        if (child + 1 < size &&
            compare(queue[child], queue[child + 1]) > 0)
            child++;
        if (compare(x, queue[child]) <= 0)
            break;
        queue[k] = queue[child];
        k = child;
    }
    queue[k] = x;
}
```

**下沉**：把最后一个元素移到堆顶，然后和较小的子节点交换，重复直到满足堆序。

```
移除最小元素（1）：
        1
       /  \
      8    7
     / \   /
    3   4 2
    
    ↓ 移除 1，用最后一个元素填充
    
        2
       /  \
      8    7
     / \
    3   4
    
    ↓ 2 下沉
        2
       /  \
      3    7
     / \
    8   4
    
    ↓ 继续下沉
        2
       /  \
      3    4
     / \
    8   7  <- 最终结构
```

## 排序算法：堆排序

```java
public class HeapSort {
    
    public static void heapSort(int[] arr) {
        int n = arr.length;
        
        // 构建最大堆
        for (int i = n / 2 - 1; i >= 0; i--) {
            heapify(arr, n, i);
        }
        
        // 逐个取出堆顶
        for (int i = n - 1; i > 0; i--) {
            swap(arr, 0, i);  // 堆顶移到末尾
            heapify(arr, i, 0);  // 调整剩余堆
        }
    }
    
    private static void heapify(int[] arr, int n, int i) {
        int largest = i;
        int left = 2 * i + 1;
        int right = 2 * i + 2;
        
        if (left < n && arr[left] > arr[largest])
            largest = left;
        if (right < n && arr[right] > arr[largest])
            largest = right;
        
        if (largest != i) {
            swap(arr, i, largest);
            heapify(arr, n, largest);
        }
    }
    
    private static void swap(int[] arr, int i, int j) {
        int temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
}
```

时间复杂度：O(n log n)

## 经典应用

### Top K 问题

```java
public class TopK {
    
    public static List<Integer> findTopK(int[] arr, int k) {
        PriorityQueue<Integer> minHeap = new PriorityQueue<>();
        
        for (int num : arr) {
            if (minHeap.size() < k) {
                minHeap.offer(num);
            } else if (num > minHeap.peek()) {
                minHeap.poll();
                minHeap.offer(num);
            }
        }
        
        return new ArrayList<>(minHeap);
    }
    
    public static void main(String[] args) {
        int[] arr = {3, 2, 7, 1, 9, 5, 8, 4, 6};
        System.out.println(findTopK(arr, 3));  // [7, 8, 9] 或类似
    }
}
```

### 合并 K 个有序数组

```java
public static List<Integer> mergeKSortedLists(List<List<Integer>> lists) {
    PriorityQueue<int[]> heap = new PriorityQueue<>(
        Comparator.comparingInt(a -> a[0])
    );
    
    List<Integer> result = new ArrayList<>();
    
    // 初始化：每个列表的第一个元素
    for (int i = 0; i < lists.size(); i++) {
        List<Integer> list = lists.get(i);
        if (!list.isEmpty()) {
            heap.offer(new int[]{list.get(0), i, 0});
        }
    }
    
    // 逐个取出
    while (!heap.isEmpty()) {
        int[] curr = heap.poll();
        result.add(curr[0]);
        
        int listIdx = curr[1];
        int elemIdx = curr[2] + 1;
        
        if (elemIdx < lists.get(listIdx).size()) {
            heap.offer(new int[]{
                lists.get(listIdx).get(elemIdx),
                listIdx,
                elemIdx
            });
        }
    }
    
    return result;
}
```

## PriorityQueue vs PriorityBlockingQueue

| 特性 | PriorityQueue | PriorityBlockingQueue |
|-----|--------------|----------------------|
| 线程安全 | 否 | 是 |
| 阻塞 | 非阻塞 | 队空时 take() 阻塞 |
| 底层 | 数组 | 数组 |
| null | 不允许 | 不允许 |

```java
// 单线程优先队列
PriorityQueue<Integer> pq = new PriorityQueue<>();

// 多线程优先队列
PriorityBlockingQueue<Integer> pbq = new PriorityBlockingQueue<>();
```

## 面试追问

### Q1: PriorityQueue 能保证 FIFO 顺序吗？

**不能**。PriorityQueue 只能保证堆顶是最小（或最大）元素，遍历顺序是堆的层序遍历，不是插入顺序。

如果需要按插入顺序，可以用 `LinkedList` 或 `ArrayDeque`。

### Q2: 堆排序为什么不像快速排序那样常用？

堆排序的时间复杂度总是 O(n log n)，而快速排序平均也是 O(n log n)。

但实际应用中，快速排序通常比堆排序快，原因是：

1. **缓存局部性**：堆排序的元素访问模式不连续，缓存命中低
2. **常数因子**：堆排序需要更多比较和交换操作

堆排序的优势是**最坏情况也是 O(n log n)**，适合对稳定性要求高的场景。

### Q3: 堆的插入和删除为什么是 O(log n)？

因为完全二叉树的高度是 log n。

- 插入时最多上浮到根节点（log n 次）
- 删除时最多下沉到叶子节点（log n 次）

---

## 留给你的思考题

如何用 PriorityQueue 实现"中位数流"？

要求：
- 不断有数字流入
- 任何时刻都能 O(1) 获取当前的中位数

提示：使用两个堆，一个最大堆存储较小的一半，一个最小堆存储较大的一半。

这个问题的扩展版经常出现在 TOP K 面试题中。
