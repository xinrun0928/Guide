# 磁盘调度算法：从磁头寻道到数据

你的机械硬盘在读取数据时，磁头在盘片上飞来飞去。
为什么有时候复制大文件很快，有时候却很慢？

答案在于**磁盘调度算法**——磁头怎么移动，决定了I/O性能。


## 磁盘结构回顾

```
┌──────────────────────────────────────────────────────────┐
│                    磁盘结构                                │
├──────────────────────────────────────────────────────────┤
│                                                          │
│         磁盘正面                                          │
│    ┌─────────────────┐                                   │
│    │                 │                                   │
│    │    盘片         │ ← 马达带动旋转（7200 RPM等）       │
│    │                 │                                   │
│    └────────┬────────┘                                   │
│             │                                             │
│      磁头臂 ←→ 寻道                                     │
│        ↓                                               │
│   ┌──────────────────────────────────────────────┐      │
│   │  磁道0  磁道1  磁道2  ...  磁道N             │      │
│   │  ┌────┬────┬────┬────┬────┬────┬────┐       │      │
│   │  │扇区│扇区│扇区│扇区│扇区│扇区│扇区│...   │      │
│   │  └────┴────┴────┴────┴────┴────┴────┘       │      │
│   │                                              │      │
│   │  扇区是读写的基本单位（通常512B或4KB）         │      │
│   └──────────────────────────────────────────────┘      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 磁盘I/O时间组成

```
┌──────────────────────────────────────────────────────────┐
│                    I/O时间组成                            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  总时间 = 寻道时间 + 旋转延迟 + 传输时间                   │
│                                                          │
│  1. 寻道时间（Seek Time）                                 │
│     - 磁头移动到目标磁道的时间                              │
│     - 通常3-15ms                                          │
│     - 最耗时的一项                                         │
│                                                          │
│  2. 旋转延迟（Rotational Latency）                         │
│     - 等待目标扇区旋转到磁头下方的时间                       │
│     - 平均 = 半圈旋转时间                                   │
│     - 7200 RPM: 平均4.16ms                                │
│                                                          │
│  3. 传输时间（Transfer Time）                             │
│     - 实际读写数据的时间                                   │
│     - 通常0.1-0.5ms                                       │
│     - 最快的一项                                          │
│                                                          │
│  优化重点：减少寻道时间！                                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```


## 调度算法

### 1. FCFS：先来先服务

**最简单的算法——按请求到达顺序处理。**

```
请求顺序:  55 → 58 → 39 → 18 → 90 → 160 → 150 → 38
磁头初始位置: 100

磁头移动轨迹:
100 → 55 → 58 → 39 → 18 → 90 → 160 → 150 → 38

寻道距离:
|100-55| + |55-58| + |58-39| + |39-18| + |18-90| + |90-160| + |160-150| + |150-38|
= 45 + 3 + 19 + 21 + 72 + 70 + 10 + 112
= 352

总寻道时间：352 × 单次寻道时间
```

```java
public class FCFSScheduler {
    public int calculateTotalSeekDistance(List<Integer> requests, int initialPosition) {
        int totalDistance = 0;
        int currentPosition = initialPosition;

        for (int request : requests) {
            totalDistance += Math.abs(request - currentPosition);
            currentPosition = request;
        }

        return totalDistance;
    }
}
```

**问题**：磁头移动杂乱无章，总寻道距离很大。

### 2. SSTF：最短寻道时间优先

**总是选择离当前磁头最近的请求。**

```
请求顺序:  55 → 58 → 39 → 18 → 90 → 160 → 150 → 38
磁头初始位置: 100

处理过程:
当前位置100，最近请求是90
→ 处理90
当前位置90，最近请求是58
→ 处理58
...

磁头移动轨迹:
100 → 90 → 58 → 55 → 39 → 38 → 150 → 160

总寻道距离:
|100-90| + |90-58| + |58-55| + |55-39| + |39-38| + |38-150| + |150-160|
= 10 + 32 + 3 + 16 + 1 + 112 + 10
= 184
```

```java
public class SSTFScheduler {
    public List<Integer> schedule(List<Integer> requests, int initialPosition) {
        List<Integer> result = new ArrayList<>();
        Set<Integer> remaining = new HashSet<>(requests);
        int currentPosition = initialPosition;

        while (!remaining.isEmpty()) {
            // 找最近的请求
            int nearest = findNearest(currentPosition, remaining);
            result.add(nearest);
            remaining.remove(nearest);
            currentPosition = nearest;
        }

        return result;
    }

    private int findNearest(int current, Set<Integer> requests) {
        int nearest = -1;
        int minDistance = Integer.MAX_VALUE;

        for (int request : requests) {
            int distance = Math.abs(request - current);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = request;
            }
        }

        return nearest;
    }
}
```

**问题**：可能导致「饥饿」——远处的请求永远得不到处理。

### 3. SCAN：电梯算法

**磁头像电梯一样单向移动，处理沿途的请求。**

```
磁头初始位置: 100，方向: 向外（磁道号增加）

处理过程:
100 → 继续向外移动 → 处理沿途请求
→ 150 → 160 → 180(边界) → 反向
→ 55 → 39 → 38

磁头移动轨迹:
100 → 150 → 160 → 180 → 反向 → 55 → 39 → 38

总寻道距离:
|100-150| + |150-160| + |160-180| + |180-55| + |55-39| + |39-38|
= 50 + 10 + 20 + 125 + 16 + 1
= 222
```

```java
public class SCANScheduler {
    public List<Integer> schedule(List<Integer> requests, int initialPosition,
                                  int maxTrack, boolean directionOutward) {
        List<Integer> result = new ArrayList<>();
        List<Integer> sorted = new ArrayList<>(requests);
        Collections.sort(sorted);

        int currentPosition = initialPosition;
        int direction = directionOutward ? 1 : -1;

        // 先处理同一方向的所有请求
        List<Integer> sameDirection = new ArrayList<>();
        List<Integer> oppositeDirection = new ArrayList<>();

        for (int request : sorted) {
            if (direction == 1 && request >= currentPosition) {
                sameDirection.add(request);
            } else if (direction == -1 && request <= currentPosition) {
                sameDirection.add(request);
            } else {
                oppositeDirection.add(request);
            }
        }

        // 处理同向请求
        result.addAll(sameDirection);

        // 到达边界后反向
        if (!oppositeDirection.isEmpty()) {
            Collections.sort(oppositeDirection);
            if (direction == -1) {
                Collections.reverse(oppositeDirection);
            }
            result.addAll(oppositeDirection);
        }

        return result;
    }
}
```

**优点**：所有请求都有机会被处理，不会饥饿。

### 4. C-SCAN：循环扫描

**磁头单向扫描，到达边界后快速返回起点重新开始。**

```
磁头初始位置: 100，方向: 向外

处理过程:
100 → 向外移动 → 处理所有请求
→ 150 → 160 → 180(边界)
→ 快速返回起点0
→ 重新向外处理剩余请求

磁头移动轨迹:
100 → 150 → 160 → 180 → 0 → 38 → 39 → 55 → 58 → 90

总寻道距离:
|100-150| + |150-160| + |160-180| + |180-0| + |0-38| + |38-39| + |39-55| + |55-58| + |58-90|
= 50 + 10 + 20 + 180 + 38 + 1 + 16 + 3 + 32
= 350
```

**特点**：保证所有请求的等待时间更均匀。

### 5. LOOK：改进的SCAN

**不需要到达边界，到达最后一个请求就反向。**

```
磁头初始位置: 100

处理过程:
100 → 向外 → 处理90, 150, 160
→ 反向（最后一个请求是160，不需要到180）
→ 向内 → 处理58, 55, 39, 38

磁头移动轨迹:
100 → 150 → 160 → 反向 → 58 → 55 → 39 → 38

总寻道距离:
|100-150| + |150-160| + |160-58| + |58-55| + |55-39| + |39-38|
= 50 + 10 + 102 + 3 + 16 + 1
= 182
```

### 6. C-LOOK：改进的C-SCAN

```java
public class CLOOKScheduler {
    public List<Integer> schedule(List<Integer> requests, int initialPosition) {
        List<Integer> result = new ArrayList<>();
        List<Integer> sorted = new ArrayList<>(requests);
        Collections.sort(sorted);

        int currentPosition = initialPosition;

        // 找第一个大于当前位置的请求
        List<Integer> forward = new ArrayList<>();
        List<Integer> wrapped = new ArrayList<>();

        for (int request : sorted) {
            if (request >= currentPosition) {
                forward.add(request);
            } else {
                wrapped.add(request);
            }
        }

        // 先处理向前的请求
        result.addAll(forward);
        // 然后快速返回到最小的请求
        if (!wrapped.isEmpty()) {
            result.addAll(wrapped);
        }

        return result;
    }
}
```


## 算法对比

| 算法 | 平均寻道距离 | 公平性 | 实现复杂度 |
|-----|------------|-------|-----------|
| FCFS | 长 | 公平 | ⭐ |
| SSTF | 短 | 可能饥饿 | ⭐⭐ |
| SCAN | 中等 | 公平 | ⭐⭐⭐ |
| C-SCAN | 中等 | 非常公平 | ⭐⭐⭐ |
| LOOK | 短 | 公平 | ⭐⭐⭐ |
| C-LOOK | 短 | 非常公平 | ⭐⭐⭐ |


## 实际案例：Linux的I/O调度器

Linux有多种I/O调度器，策略各有不同：

```bash
# 查看当前I/O调度器
cat /sys/block/sda/queue/scheduler

# 输出可能是:
# none noop deadline [cfq]
# 当前使用的是cfq

# noop: 最简单的FIFO，适合SSD
# deadline: 基于期限的调度，保证延迟
# cfq: 完全公平队列，按进程分组
# mq-deadline: 多队列版本的deadline
# bfq: Budget Fair Queueing，适合多媒体
```

```c
// Linux I/O调度器的选择策略
// SSD: noop（不需要寻道优化）
// 机械硬盘: deadline或cfq（优化寻道）
// 延迟敏感: mq-deadline
```


## 面试追问方向

- **为什么说寻道时间是磁盘I/O中最大的开销？**
  提示：寻道时间3-15ms，旋转延迟0-8ms，传输时间<1ms。
- **SSTF算法会产生饥饿现象吗？如何在SSTF中避免饥饿？**
  提示：远处的请求可能永远得不到服务。
- **SCAN和C-SCAN的区别是什么？**
  提示：返回时是否处理请求。
- **为什么现代SSD推荐使用noop调度器？**
  提示：SSD没有机械部件，没有寻道时间。
