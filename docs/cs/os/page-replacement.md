# 页面置换算法：当内存不够用的时候

凌晨3点，你的服务器内存爆了。OOM Killer开始杀掉进程。
日志里全是 `page fault`——系统在疯狂地换入换出页面。
罪魁祸首，可能是**页面置换算法**没选对。


## 为什么需要页面置换？

当物理内存不够时，操作系统需要把一些页换出到磁盘，给新页腾地方。
问题是：**换出哪个页？**

```
┌─────────────────────────────────────────────────────────┐
│                    内存分配状态                           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  物理内存:  ┌────┬────┬────┬────┬────┬────┬────┬────┐    │
│            │ P0 │ P1 │ P2 │ P3 │ P4 │ P5 │ P6 │ P7 │    │
│            └────┴────┴────┴────┴────┴────┴────┴────┘    │
│                                                          │
│  需要加载P8，但内存满了！                                 │
│                                                          │
│  问题：应该换出哪个页？                                   │
│                                                          │
│  换出策略决定：                                           │
│  - 系统性能                       │
│  - 缺页率                         │
│  - I/O次数                        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**置换算法的目标**：尽量减少缺页率，换出那些「以后不太会用」的页。


## FIFO：最朴素的想法

**最简单——最早进来的页，最先换出去。**

```
队列模拟FIFO：
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  初始状态（内存已满）：                                    │
│  队列: [P0] ← [P1] ← [P2] ← [P3]  (队首最老)           │
│                                                          │
│  访问P8时发生缺页：                                      │
│  - P0是最老的，换出                                       │
│  - P8换入，放到队尾                                      │
│  - 队列: [P1] ← [P2] ← [P3] ← [P8]                     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

```java
public class FIFOReplacement {
    private Deque<Integer> queue = new LinkedList<>();
    private int frameCount;
    private Set<Integer> frames = new HashSet<>();

    public FIFOReplacement(int frameCount) {
        this.frameCount = frameCount;
    }

    public boolean accessPage(int pageNumber) {
        if (frames.contains(pageNumber)) {
            return false;  // 命中，不需置换
        }

        // 缺页，需要置换
        if (frames.size() >= frameCount) {
            // 换出队首（最老的页）
            int victim = queue.poll();
            frames.remove(victim);
            System.out.println("置换: " + victim + " → " + pageNumber);
        }

        // 加载新页
        frames.add(pageNumber);
        queue.offer(pageNumber);
        return true;  // 缺页
    }
}
```

### FIFO的问题：Belady异常

**Belady发现：FIFO有时会增加缺页率，分配的帧越多，缺页反而越多。**

```
4帧时的访问序列: 0, 1, 2, 3, 0, 1, 4, 0, 1, 2, 3, 4
缺页次数: 10次

3帧时的访问序列: 0, 1, 2, 3, 0, 1, 4, 0, 1, 2, 3, 4
缺页次数: 9次 ← 更少！

为什么？因为FIFO不考虑页的使用频率。
```


## LRU：最近最少使用

**核心思想：如果一个页很久没被访问，将来也很可能不会访问。**

```
时间线：

时刻:  1   2   3   4   5   6   7   8   9   10
访问:  P0  P1  P2  P3  P0  P1  P4  P0  P1  P0
        ↑
      现在时刻，访问P4，需要置换

最近使用顺序（最远→最近）：
P2 → P3 → P0 → P1 → P4（当前）

LRU选择：P2（最久未使用）
```

```java
public class LRUReplacement {
    private int frameCount;
    private LinkedHashMap<Integer, Long> frames;  // 页号 → 上次访问时间

    public LRUReplacement(int frameCount) {
        this.frameCount = frameCount;
        this.frames = new LinkedHashMap<>(frameCount, 0.75f, true) {
            // 访问顺序排序
            @Override
            protected boolean removeEldestEntry(
                Map.Entry<Integer, Long> eldest) {
                return size() > frameCount;
            }
        };
    }

    public boolean accessPage(int pageNumber) {
        if (frames.containsKey(pageNumber)) {
            // 命中，更新访问时间
            frames.get(pageNumber);  // 通过get触发重新排序
            return false;
        }

        // 缺页
        if (frames.size() >= frameCount) {
            // 淘汰最老的
            int victim = frames.keySet().iterator().next();
            frames.remove(victim);
            System.out.println("置换: " + victim + " → " + pageNumber);
        }

        frames.put(pageNumber, System.nanoTime());
        return true;
    }
}
```

### LRU的问题

1. **实现成本高**：需要记录每个页的访问时间，每次访问都要更新
2. **硬件支持**：需要硬件记录访问顺序或时间戳
3. **性能开销**：大数据集下开销明显

> **实际系统的折中**：由于LRU开销大，很多系统使用**近似LRU**（如Clock算法）。


## LFU：最不经常使用

**核心思想：那些被访问次数少的页，将来也可能不会访问。**

```
访问序列: P0访问3次, P1访问2次, P2访问5次, P3访问1次

频率统计：
P2: 5次 ← 最常用
P0: 3次
P1: 2次
P3: 1次 ← 最不常用，应该换出
```

```java
public class LFUReplacement {
    private int frameCount;
    private Map<Integer, Integer> frequency = new HashMap<>();
    private Set<Integer> frames = new HashSet<>();

    public LFUReplacement(int frameCount) {
        this.frameCount = frameCount;
    }

    public boolean accessPage(int pageNumber) {
        if (frames.contains(pageNumber)) {
            frequency.put(pageNumber, frequency.get(pageNumber) + 1);
            return false;
        }

        // 缺页
        if (frames.size() >= frameCount) {
            // 找访问次数最少的
            int victim = frames.stream()
                .min(Comparator.comparing(frequency::get))
                .orElseThrow();
            frames.remove(victim);
            frequency.remove(victim);
            System.out.println("置换: " + victim + " → " + pageNumber);
        }

        frames.add(pageNumber);
        frequency.put(pageNumber, 1);
        return true;
    }
}
```

### LFU的问题

1. **历史权重**：一个页曾经频繁访问，但现在不用了，还占着计数器
2. **新页劣势**：新加载的页计数少，可能被误换出

**改进方案**：周期性降低所有计数（老化）


## Clock算法：LRU的近似

**Clock算法（也称第二次机会）用环形链表模拟LRU，但只需硬件支持「访问位」。**

### 基本Clock算法

```
工作原理：
1. 页表项有一个「访问位」（Access Bit/Referenced Bit）
2. 硬件在访问页时自动设置访问位=1
3. 置换时，扫描环形链表：
   - 如果访问位=0，换出
   - 如果访问位=1，清零，继续扫描
4. 循环直到找到可换出的页
```

```java
public class ClockReplacement {
    private List<Integer> pages = new ArrayList<>();
    private List<Boolean> referenceBits;  // 访问位
    private List<Boolean> dirtyBits;       // 脏位
    private int pointer;                   // 扫描指针
    private int frameCount;

    public ClockReplacement(int frameCount) {
        this.frameCount = frameCount;
        this.referenceBits = new ArrayList<>(Collections.nCopies(frameCount, false));
        this.dirtyBits = new ArrayList<>(Collections.nCopies(frameCount, false));
    }

    public boolean accessPage(int pageNumber) {
        if (pages.contains(pageNumber)) {
            // 命中，设置访问位
            int index = pages.indexOf(pageNumber);
            referenceBits.set(index, true);
            return false;
        }

        // 缺页
        if (pages.size() >= frameCount) {
            // Clock扫描
            while (true) {
                if (referenceBits.get(pointer) == false) {
                    // 这个页可以被置换
                    if (dirtyBits.get(pointer)) {
                        // 需要写回
                        System.out.println("写回脏页: " + pages.get(pointer));
                    }
                    System.out.println("置换: " + pages.get(pointer)
                        + " → " + pageNumber);
                    pages.set(pointer, pageNumber);
                    referenceBits.set(pointer, false);
                    dirtyBits.set(pointer, false);
                    pointer = (pointer + 1) % frameCount;
                    break;
                } else {
                    // 第二次机会，清除访问位，继续扫描
                    referenceBits.set(pointer, false);
                    pointer = (pointer + 1) % frameCount;
                }
            }
        } else {
            pages.add(pageNumber);
            referenceBits.add(false);
            dirtyBits.add(false);
        }

        return true;
    }
}
```

### 改进Clock算法（Enhanced Clock）

考虑两个维度：访问位 + 脏位

| (R, M) | 含义 | 处理 |
|--------|-----|-----|
| (0, 0) | 最近未访问，未修改 | 直接置换 |
| (0, 1) | 最近未访问，已修改 | 需要写回 |
| (1, 0) | 最近访问，未修改 | 清除R，继续 |
| (1, 1) | 最近访问，已修改 | 清除R，继续 |


## 工作集模型

**理论基础：程序在某一时刻只访问有限的页（工作集）。**

```
工作集 W(t, Δ) = {页P | P在[t-Δ+1, t]时间段内被访问过}

例如：Δ = 10ms
时刻t=100ms时的工作集 = {P0, P2, P5}（过去10ms内访问过的页）

工作集变化：
t=0ms:   {P0}
t=10ms:  {P0, P1}
t=20ms:  {P0, P1, P2}
t=50ms:  {P1, P2, P3}  ← 工作集移动
t=100ms: {P2, P3, P5}
```

```java
public class WorkingSetModel {
    private int delta;  // 时间窗口大小(ms)
    private Map<Integer, List<Long>> accessHistory;  // 页 → 访问时间列表

    public WorkingSetModel(int delta) {
        this.delta = delta;
        this.accessHistory = new HashMap<>();
    }

    public void recordAccess(int pageNumber) {
        long now = System.currentTimeMillis();
        accessHistory.computeIfAbsent(pageNumber, k -> new ArrayList<>())
            .add(now);
    }

    public Set<Integer> getWorkingSet(long currentTime) {
        long windowStart = currentTime - delta;
        Set<Integer> workingSet = new HashSet<>();

        for (Map.Entry<Integer, List<Long>> entry : accessHistory.entrySet()) {
            List<Long> times = entry.getValue();
            // 检查是否有访问在时间窗口内
            boolean inWindow = times.stream()
                .anyMatch(t -> t >= windowStart && t <= currentTime);
            if (inWindow) {
                workingSet.add(entry.getKey());
            }
        }

        return workingSet;
    }

    public int getWorkingSetSize(long currentTime) {
        return getWorkingSet(currentTime).size();
    }
}
```


## 算法对比

| 算法 | 优点 | 缺点 | 实现难度 |
|-----|-----|-----|---------|
| FIFO | 简单 | Belady异常、忽略使用频率 | ⭐ |
| LRU | 效果好 | 开销大、可能污染 | ⭐⭐⭐ |
| LFU | 考虑频率 | 历史权重、新页劣势 | ⭐⭐ |
| Clock | 近似LRU、开销小 | 不如LRU精确 | ⭐⭐ |
| 工作集 | 理论基础强 | 实现复杂 | ⭐⭐⭐ |


## 实际案例：Linux的页面置换

Linux使用**改进的Clock算法（也称二次机会）**：

```c
// Linux的页面置换考虑因素：
// 1. 引用位（页被访问过吗？）
// 2. 脏位（页被修改过吗？）
// 3. LRU链表（活跃链表 vs 非活跃链表）
// 4. cgroup内存限制

// 活跃LRU：最近访问过的页
// 非活跃LRU：最近没访问的页

// 页面回收策略：
// 1. 先从不活跃链表尾部开始
// 2. 跳过脏页（需要写回）
// 3. 写回后加入非活跃链表
// 4. 活跃链表也要降级
```


## 面试追问方向

- **什么是Belady异常？为什么FIFO会产生Belady异常？**
  提示：FIFO不考虑访问频率。
- **LRU和Clock算法各有什么优缺点？**
  提示：LRU精确但开销大，Clock近似但开销小。
- **脏位的作用是什么？为什么脏页换出要慢一些？**
  提示：需要写回磁盘。
- **什么是工作集？为什么工作集大小会影响缺页率？**
  提示：工作集内的页不会缺页。
