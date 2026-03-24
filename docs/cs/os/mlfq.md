# 多级反馈队列：最接近「理想」的调度算法

你有没有遇到过这种情况？

面试官问：「设计一个调度算法，既能让短作业快速完成，又能让长作业不会饿死。」

你可能会想到用多种调度算法组合。但操作系统早就想到了这个——**多级反馈队列（MLFQ）**。


## MLFQ的核心思想

MLFQ的核心可以用一句话概括：**用历史表现预测未来行为**。

```
┌─────────────────────────────────────────────────────────┐
│                    多级反馈队列                          │
│                                                         │
│   队列1 (最高优先级)  ┌───┐┌───┐┌───┐  时间片=8ms       │
│   ───────────────────│ P1││ P3││ P5│  短作业在这里      │
│                      └───┘└───┘└───┘                    │
│                                                         │
│   队列2 (中优先级)    ┌─────┐┌─────┐  时间片=16ms       │
│   ───────────────────│ P2  ││ P4  │  表现一般的作业     │
│                      └─────┘└─────┘                    │
│                                                         │
│   队列3 (低优先级)    ┌───────────┐    时间片=32ms      │
│   ───────────────────│ P6 (长作业) │  优先级最低        │
│                      └───────────┘                    │
└─────────────────────────────────────────────────────────┘
```

**MLFQ的规则：**
1. 新进程进入最高优先级队列
2. 如果在当前队列用完了时间片还没完成，降级到低一级队列
3. 如果在时间片用完之前主动放弃CPU（如I/O），保留当前优先级
4. 优先级低的队列用更大的时间片执行


## MLFQ工作流程演示

### 场景：三个进程同时到达

```
进程A：预计运行时间 5ms（短作业）
进程B：预计运行时间 50ms（中等作业）
进程C：预计运行时间 100ms（长作业）
```

**执行过程：**

```
时间  0-8ms: 队列1选择A执行
       A执行5ms后主动放弃CPU（I/O等待）
       
时间  8-24ms: 队列1选择B执行（时间片8ms）
       B执行8ms后用完时间片，降级到队列2
       
时间  24-32ms: 队列1选择C执行
       C执行8ms后用完时间片，降级到队列2
       
时间  32-48ms: 队列2选择B执行（时间片16ms）
       B执行16ms后用完时间片，降级到队列3
       
... 以此类推
```

```java
public class MLFQScheduler {
    // 多级反馈队列调度器
    private List<Queue<Process>> levels;      // 多级队列
    private List<Integer> timeQuantums;        // 每级时间片
    private List<Integer> priorities;          // 每级优先级

    public MLFQScheduler(int levelCount) {
        levels = new ArrayList<>();
        timeQuantums = new ArrayList<>();
        priorities = new ArrayList<>();

        for (int i = 0; i < levelCount; i++) {
            levels.add(new LinkedList<>());
            timeQuantums.add((int) Math.pow(2, i) * 4);  // 4, 8, 16, 32...
            priorities.add(levelCount - i);  // 级别越高，优先级数值越小
        }
    }

    public void addProcess(Process p) {
        // 新进程默认进入最高优先级队列
        levels.get(0).add(p);
    }

    public void schedule() {
        int currentTime = 0;

        while (hasWork()) {
            Process current = null;

            // 从最高优先级队列中选择
            for (int i = 0; i < levels.size(); i++) {
                Queue<Process> queue = levels.get(i);
                if (!queue.isEmpty()) {
                    current = queue.poll();
                    current.level = i;  // 记录当前所在队列
                    break;
                }
            }

            if (current == null) {
                currentTime++;
                continue;
            }

            int quantum = timeQuantums.get(current.level);
            int executionTime = Math.min(quantum, current.remainingTime);

            // 模拟执行
            current.remainingTime -= executionTime;
            current.cpuBurst -= executionTime;
            currentTime += executionTime;

            // 检查是否因为I/O主动放弃CPU（保留优先级）
            if (current.cpuBurst > 0 && current.didIO()) {
                // I/O等待后返回同一队列
                levels.get(current.level).add(current);
            }
            // 检查是否用完时间片（降级）
            else if (current.remainingTime > 0) {
                // 降级到下一级队列
                int nextLevel = Math.min(current.level + 1, levels.size() - 1);
                levels.get(nextLevel).add(current);
            }
        }
    }
}
```


## MLFQ为什么优秀？

### 它解决了什么问题？

| 问题 | FCFS | SJF | RR | MLFQ |
|-----|------|-----|-----|------|
| 短作业响应快 | ❌ | ✅ | ✅ | ✅ |
| 长作业不饿死 | ✅ | ❌ | ✅ | ✅ |
| I/O密集型友好 | ❌ | ❌ | ✅ | ✅ |
| 不用预知时间 | ✅ | ❌ | ✅ | ✅ |

### MLFQ的核心优势

**1. 短作业优先**
短作业在最高优先级队列，用很少的时间片就能完成。

**2. 自适应调整**
系统自动学习每个作业的特征：
- 频繁I/O → 保留高优先级
- 长期占用CPU → 逐渐降级

**3. 防止饥饿**
低优先级的长作业最终也能执行（只要高优先级队列为空）。


## MLFQ的挑战与改进

### 问题一：长作业饥饿

如果一直有短作业到来，长作业可能等很久。

**解决方案：提升所有进程的优先级**

```java
// 每隔一段时间，提升所有进程的优先级
public void boostAllPriorities() {
    for (Queue<Process> queue : levels) {
        List<Process> temp = new ArrayList<>(queue);
        queue.clear();
        for (Process p : temp) {
            // 提升到更高优先级队列
            int newLevel = Math.max(0, p.level - 1);
            queue.add(p);
        }
    }
}
```

### 问题二：进程作弊

恶意进程可能通过不断发起小I/O来保持高优先级。

**解决方案：计数I/O次数**

```java
public class Process {
    private int ioCount = 0;

    public void simulateIO() {
        ioCount++;
        if (ioCount > 10) {
            // 频繁I/O超过阈值，降级
            this.level++;
        }
    }
}
```


## 实际案例：Linux的CFS调度器

Linux的CFS（完全公平调度器）虽然不是严格的MLFQ，但其思想有异曲同工之妙。

```java
// CFS的核心概念：虚拟运行时间
public class CFSScheduler {
    // 每个进程有一个"虚拟运行时间"(vruntime)
    // 调度器总是选择vruntime最小的进程
    // 进程运行得越久，vruntime越大
    // 这样CPU时间分配是"公平"的

    public Process pickNext() {
        // 红黑树中找vruntime最小的节点
        return tree.min();
    }

    public void enqueue(Process p) {
        p.vruntime = p.execTime * (NICE_0_WEIGHT / p.weight);
        tree.insert(p);
    }
}
```

**CFS的特点：**
- 不使用固定时间片
- 使用红黑树管理就绪队列
- 通过 `nice` 值调整进程权重
- 目标是「完美的多任务公平」


## Java中的调度

Java的线程调度也有类似思想：

```java
public class JavaScheduling {
    public static void main(String[] args) {
        // 线程优先级（1-10）
        Thread highPriority = new Thread(() -> {});
        highPriority.setPriority(Thread.MAX_PRIORITY);  // 10

        Thread lowPriority = new Thread(() -> {});
        lowPriority.setPriority(Thread.MIN_PRIORITY);  // 1

        // 但Java线程优先级只是"提示"，
        // 最终由底层操作系统决定
        // Windows对优先级的实现接近MLFQ
        // Linux的CFS则完全忽略线程优先级
    }
}
```


## 总结：MLFQ vs 其他算法

```
                    MLFQ
                     │
        ┌────────────┼────────────┐
        │            │            │
    照顾短作业    照顾I/O作业    防止饥饿
        │            │            │
        └────────────┴────────────┘
                     │
              SJF + RR 的结合
              
本质上：MLFQ = RR(短作业) + FCFS(长作业)
```


## 面试追问方向

- **MLFQ和单纯的RR有什么区别？**
  提示：MLFQ有多个队列，每个队列时间片不同，进程会根据表现动态调整队列。
- **如果一个进程运行到一半需要I/O，MLFQ怎么处理？**
  提示：I/O完成后保留原队列优先级，这样I/O密集型进程不会被降级。
- **Linux的CFS调度器和MLFQ有什么关系？**
  提示：CFS是另一种思路，不使用固定时间片，用vruntime实现公平调度。
- **如何用MLFQ实现公平调度？**
  提示：定期提升所有进程优先级，防止低优先级进程饿死。
