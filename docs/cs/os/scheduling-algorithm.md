# 进程调度算法：CPU如何做选择

想象你是操作系统，现在有100个进程等着用CPU。CPU只有一个核心。
你该怎么办？

这就是**进程调度**要解决的问题。


## 调度的三个层次

在深入算法之前，先理解调度的层次：

```
┌─────────────────────────────────────────────────┐
│               高级调度（作业调度）                 │
│   决定哪些作业从外存调入内存                      │
│   频率低，几秒到几分钟一次                        │
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│               中级调度（内存调度）                 │
│   决定哪些进程换出到外存（挂起）                   │
│   控制内存中的进程数量                            │
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│               低级调度（进程/线程调度）            │
│   决定哪个就绪进程获得CPU                         │
│   频率高，毫秒级                                 │
└─────────────────────────────────────────────────┘
```

**我们主要讨论低级调度**，因为这是最核心、频率最高的调度。


## 调度算法的评价指标

选择算法之前，先看看评价标准：

| 指标 | 含义 |
|-----|-----|
| **CPU利用率** | CPU忙碌时间占总时间的比例 |
| **吞吐量** | 单位时间内完成的进程数 |
| **周转时间** | 进程从提交到完成的总时间 |
| **等待时间** | 进程在就绪队列中等待的时间 |
| **响应时间** | 从提交请求到首次响应的时间 |

```java
// 周转时间 = 完成时间 - 到达时间
// 带权周转时间 = 周转时间 / 服务时间

public class TurnaroundAnalysis {
    public static void main(String[] args) {
        // 假设三个进程同时到达
        Process[] processes = {
            new Process("P1", 0, 24),  // 到达时间0，服务时间24
            new Process("P2", 0, 3),   // 到达时间0，服务时间3
            new Process("P3", 0, 3),   // 到达时间0，服务时间3
        };

        // 计算各种指标
        double avgTurnaround = calculateAverageTurnaround(processes);
        double avgWaiting = calculateAverageWaiting(processes);
        double throughput = calculateThroughput(processes);
    }
}
```

> **重要**：不同场景侧重点不同。批处理系统看重吞吐量，交互系统看重响应时间。


## 先来先服务（FCFS）

**最简单——谁先来谁先执行。**

```
时间线:  |---P1---|---P2---|---P3---|
        0        24       27       30

进程  到达时间  服务时间  开始时间  完成时间  周转时间  等待时间
P1       0        24       0        24       24        0
P2       0         3      24        27       27       24
P3       0         3      27        30       30       27

平均周转时间 = (24 + 27 + 30) / 3 = 27
平均等待时间 = (0 + 24 + 27) / 3 = 17
```

```java
public class FCFS {
    // 模拟FCFS调度
    public void schedule(List<Process> processes) {
        // 按到达时间排序
        processes.sort(Comparator.comparingInt(p -> p.arrivalTime));

        int currentTime = 0;
        for (Process p : processes) {
            if (currentTime < p.arrivalTime) {
                currentTime = p.arrivalTime;  // CPU空闲等待
            }
            p.startTime = currentTime;
            p.completionTime = currentTime + p.burstTime;
            currentTime = p.completionTime;
        }
    }
}
```

**优点**：简单、公平、易于实现

**缺点**：短作业可能要等很久（** convoy effect 护航效应**）

> 想象超市排队，一个买了100件商品的人堵住了后面所有买1件的人。


## 短作业优先（SJF）

**谁用时短谁先执行。**

```
时间线:  |P2|P3|--P1--|
        0  3  6      30

进程  到达时间  服务时间  开始时间  完成时间  周转时间  等待时间
P1       0        24       6        30       30        6
P2       0         3       0         3        3        0
P3       0         3       3         6        6        3

平均周转时间 = (30 + 3 + 6) / 3 = 13  ← 比FCFS好很多！
```

```java
public class SJF {
    // 短作业优先调度
    public void schedule(List<Process> processes) {
        int currentTime = 0;
        List<Process> remaining = new ArrayList<>(processes);
        List<Process> completed = new ArrayList<>();

        while (!remaining.isEmpty()) {
            // 选择剩余时间最短的进程
            Process shortest = remaining.stream()
                .filter(p -> p.arrivalTime <= currentTime)
                .min(Comparator.comparingInt(p -> p.burstTime))
                .orElse(null);

            if (shortest == null) {
                currentTime++;  // 没有就绪进程，时间快进
                continue;
            }

            remaining.remove(shortest);
            shortest.startTime = currentTime;
            shortest.completionTime = currentTime + shortest.burstTime;
            currentTime = shortest.completionTime;
            completed.add(shortest);
        }
    }
}
```

**优点**：平均等待时间最短

**缺点**：
1. 难以准确预估作业时间
2. 长作业可能「饥饿」（starvation）

> **SJF的问题**：如果一直有新短作业到来，长作业永远得不到执行。


## 时间片轮转（RR）

**每个进程执行一小段时间，然后排队到末尾。**

```
时间片 = 4

时间线:  |P1|P2|P3|P1|P1|P1|P1|P1|P1|P1|P1|P1|P1|P1|P1|P1|
        0  4  8 12 16 20 24 28 32 36 40 44 48 52 56 60 64 68 72

进程  服务时间  周转时间  等待时间
P1       68       72       4
P2        4        8       4
P3        4       12       8
```

```java
public class RoundRobin {
    private int timeQuantum;  // 时间片大小

    public void schedule(List<Process> processes, int timeQuantum) {
        Queue<Process> readyQueue = new LinkedList<>();
        int currentTime = 0;

        // 按到达时间排序
        processes.sort(Comparator.comparingInt(p -> p.arrivalTime));
        int index = 0;

        while (!readyQueue.isEmpty() || index < processes.size()) {
            // 添加新到达的进程到就绪队列
            while (index < processes.size()
                    && processes.get(index).arrivalTime <= currentTime) {
                readyQueue.add(processes.get(index++));
            }

            if (readyQueue.isEmpty()) {
                currentTime++;
                continue;
            }

            Process p = readyQueue.poll();
            // 执行 min(时间片, 剩余时间)
            int executeTime = Math.min(timeQuantum, p.remainingTime);
            p.remainingTime -= executeTime;
            currentTime += executeTime;

            // 如果还没完成，重新加入队列
            if (p.remainingTime > 0) {
                readyQueue.add(p);
            }
        }
    }
}
```

**时间片的选择很关键：**
- 时间片太大 → 退化成FCFS，响应差
- 时间片太小 → 上下文切换开销大，吞吐量低

> 一般选择：**时间片 ≈ 80%的进程需要的时间**


## 优先级调度

**优先级高的先执行。**

```java
public class PriorityScheduling {
    // 优先级调度
    public void schedule(List<Process> processes) {
        // 按优先级排序（数值越小优先级越高）
        processes.sort(Comparator.comparingInt(p -> -p.priority));

        int currentTime = 0;
        for (Process p : processes) {
            if (currentTime < p.arrivalTime) {
                currentTime = p.arrivalTime;
            }
            p.startTime = currentTime;
            p.completionTime = currentTime + p.burstTime;
            currentTime = p.completionTime;
        }
    }
}
```

### 优先级调度的问题：饥饿

```
高优先级进程不断到来
        ↓
低优先级进程永远得不到CPU
        ↓
低优先级进程「饿死」
```

**解决方案：老化（Aging）**

```java
public class PriorityWithAging {
    // 随着等待时间增加，优先级提高
    public void ageProcess(Process p, int waitingTime) {
        // 每等待10个时间单位，优先级提升1级
        int agingBonus = waitingTime / 10;
        p.dynamicPriority = p.basePriority - agingBonus;
    }
}
```


## 算法对比

| 算法 | 优点 | 缺点 | 适用场景 |
|-----|-----|-----|---------|
| FCFS | 简单、公平 | 对短作业不友好 | 很少单独使用 |
| SJF | 平均等待时间最短 | 难以预测时间、长作业饥饿 | 批处理系统 |
| RR | 响应时间确定、公平 | 开销大、时间片难选 | 交互式系统 |
| 优先级 | 可控性强 | 可能饥饿 | 有紧急任务的系统 |


## 实际应用：Java线程池的调度

Java的线程池也有调度逻辑：

```java
public class ThreadPoolScheduling {
    public static void main(String[] args) {
        // 创建一个固定大小的线程池
        ExecutorService pool = Executors.newFixedThreadPool(4);

        // 提交多个任务
        for (int i = 0; i < 100; i++) {
            final int taskId = i;
            pool.submit(() -> {
                // 任务被线程池调度执行
                // 内部使用的是阻塞队列 + 工作线程的模式
            });
        }

        pool.shutdown();
    }
}
```

**线程池的调度策略：**
1. **无界队列**（如 `LinkedBlockingQueue`）：任务来了直接入队，线程慢慢消化
2. **有界队列**（如 `ArrayBlockingQueue`）：队列满则拒绝或扩容
3. **优先级队列**（如 `PriorityBlockingQueue`）：按优先级调度


## 面试追问方向

- **SJF和FCFS，哪个的平均等待时间更短？为什么？**
  提示：画甘特图，计算平均等待时间。
- **时间片轮转中，如何选择合适的时间片大小？**
  提示：考虑上下文切换开销和响应时间。
- **什么是老化（Aging）机制？如何实现？**
  提示：动态调整进程优先级。
- **多级反馈队列调度算法是怎么回事？**
  提示：结合多种算法的优点，既照顾短作业，也防止长作业饥饿。
