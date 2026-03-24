# 进程状态转换：揭开PCB的神秘面纱

你有没有想过，当你双击一个程序图标，到程序完全运行起来，中间操作系统到底做了什么？

答案是：**创建进程、分配资源、调度执行**。而这一切的核心，就是**进程控制块（PCB）**。


## 进程到底是个什么东西？

从操作系统角度看，进程是一个正在执行的程序实例。但这个「实例」不只是磁盘上的那堆字节码，而是：

1. **程序的代码**（静态的，放在磁盘）
2. **进程专属的运行环境**（动态的，包括内存、寄存器、栈等）
3. **进程控制块**（PCB，记录进程状态）

> 打个比方：如果把程序比作菜谱（静态的菜谱书），那么进程就是厨师按照菜谱做菜的过程（动态的执行）。


## 五状态模型：进程的生老病死

进程不是凭空存在的，它有完整的生命周期：

```
                    ┌──────────┐
                    │   新建   │  (Created)
                    │  (New)   │
                    └────┬─────┘
                         │ 允许创建
                         ▼
        ┌────────────────────────────────┐
        │                                │
        ▼                                ▼
   ┌─────────┐                     ┌──────────┐
   │  就绪   │ ◄─────────────────► │  运行中  │
   │(Ready)  │   被调度 / 时间片用完  │ (Running)│
   └────┬────┘                     └────┬─────┘
        │                               │
        │ 等待事件完成                   │ I/O请求/等待
        ▼                               ▼
   ┌─────────┐                     ┌──────────┐
   │  阻塞   │ ──────────────────► │  终止    │
   │ (Blocked)│  事件完成          │ (Terminated)
   └─────────┘                     └──────────┘
```

### 各状态详解

**1. 新建状态（New）**
进程正在被创建，但还没获得CPU资源。
- 操作系统正在分配内存、初始化PCB
- 加载程序代码到内存

**2. 就绪状态（Ready）**
进程已准备好运行，只等CPU。
- 所有资源都已分配完毕
- 只等调度器选中它

**3. 运行状态（Running）**
进程正在CPU上执行。
- 同一时刻最多一个进程处于运行态（单核CPU）
- 多核CPU可以同时有多个进程运行

**4. 阻塞状态（Blocked）**
进程在等待某个事件完成，无法继续执行。
- 例如：等待I/O完成、等待信号量、等待消息

**5. 终止状态（Terminated）**
进程执行完毕，资源正在被回收。
- 操作系统清理PCB、释放内存


## PCB：进程的灵魂

**PCB（Process Control Block）** 是操作系统为每个进程维护的数据结构，记录了进程的所有信息。

```java
// PCB 的结构（概念性的Java表示）
public class PCB {
    // ========== 标识信息 ==========
    private long pid;                    // 进程ID
    private String processName;          // 进程名称
    private ProcessState state;         // 当前状态
    private int priority;               // 进程优先级

    // ========== CPU寄存器上下文 ==========
    // 当进程被切换出CPU时，这些值需要保存
    private long programCounter;        // 程序计数器（下一条指令地址）
    private long stackPointer;          // 栈指针
    private long baseRegister;          // 基址寄存器
    private long limitRegister;         // 界限寄存器

    // ========== 内存管理信息 ==========
    private long[] pageTable;            // 页表（分页系统）
    private long segmentTable;          // 段表（分段系统）

    // ========== 资源占用信息 ==========
    private List<Long> openFiles;       // 打开的文件描述符
    private Map<String, Long> memoryAllocation;  // 内存分配情况
    private long cpuTime;               // 已占用CPU时间

    // ========== 调度信息 ==========
    private int nice;                    // 调度优先级
    private long waitingTime;           // 等待时间
    private long turnaroundTime;        // 周转时间
}
```

### PCB在进程切换中的作用

```java
// 进程切换的伪代码
public class Scheduler {
    public void contextSwitch(PCB from, PCB to) {
        // 1. 保存当前进程的上下文（保存到PCB）
        from.programCounter = CPU.getProgramCounter();
        from.stackPointer = CPU.getStackPointer();
        from.state = ProcessState.READY;

        // 2. 恢复目标进程的上下文（从PCB恢复）
        CPU.setProgramCounter(to.programCounter);
        CPU.setStackPointer(to.stackPointer);
        to.state = ProcessState.RUNNING;

        // 3. 切换内存地址空间（如果是不同进程）
        MMU.switchAddressSpace(to.pageTable);
    }
}
```

> 进程切换（Context Switch）比线程切换慢得多，因为要切换地址空间！这就是为什么多进程程序的上下文切换开销大。


## 状态转换的触发条件

```java
// 模拟进程状态转换
public class ProcessStateTransition {
    public static void main(String[] args) {
        // 场景：运行一个读取文件的Java程序

        // 1. 新建 → 就绪
        // OS创建进程，分配PCB，加载程序代码
        Process p = createProcess("FileReader.java");
        // 此时状态：NEW → READY

        // 2. 就绪 → 运行
        // 调度器选中这个进程，分配CPU时间片
        scheduler.dispatch(p);
        // 此时状态：READY → RUNNING

        // 3. 运行 → 阻塞
        // 程序执行到文件读取操作
        FileInputStream fis = new FileInputStream("data.txt");
        int data = fis.read();  // 阻塞等待I/O
        // 此时状态：RUNNING → BLOCKED

        // 4. 阻塞 → 就绪
        // I/O完成，中断通知CPU
        // 此时状态：BLOCKED → READY

        // 5. 就绪 → 运行（继续）
        // 调度器再次选中
        scheduler.dispatch(p);
        // 继续执行...
    }
}
```

### 状态转换六问

| 转换 | 触发条件 | 典型场景 |
|-----|---------|---------|
| 新建→就绪 | 进程创建完成 | 启动程序 |
| 就绪→运行 | 调度器选中 | 时间片轮转 |
| 运行→就绪 | 时间片用完 | RR调度 |
| 运行→阻塞 | 等待资源 | I/O、锁、信号 |
| 阻塞→就绪 | 资源就绪 | I/O完成、锁释放 |
| 运行→终止 | 执行完毕/异常 | 程序退出 |


## Java中的进程与线程状态

Java有自己的线程状态体系，但底层也是操作系统进程/线程机制：

```java
public class JavaThreadState {
    public static void main(String[] args) throws InterruptedException {
        Thread t = new Thread(() -> {
            // 模拟不同操作系统的线程状态
        });

        // Java线程状态 vs 操作系统线程状态

        // NEW → RUNNABLE（对应就绪+运行）
        t.start();

        // 线程内部可能是 BLOCKED / WAITING / TIMED_WAITING
        // 但Java统一对外展示为 RUNNABLE

        // TIMED_WAITING: Thread.sleep(), Object.wait(timeout)
        Thread.sleep(1000);

        // WAITING: Object.wait(), Thread.join()
        t.join();
    }
}
```

**Java线程状态图：**
```
                    ┌────────┐
                    │ NEW   │
                    └───┬───┘
                        │ start()
                        ▼
      ┌───────────────────────────────────┐
      │                                   │
      │  ┌─────────┐    ┌──────────────┐  │
      │  │RUNNABLE │◄──►│ BLOCKED      │  │
      │  └────┬────┘    └──────────────┘  │
      │       │                           │
      │       │  wait()/join()            │
      │       ▼                           │
      │  ┌──────────┐                     │
      │  │ WAITING  │ ─── notify() ───────┤
      │  └──────────┘                     │
      │                                   │
      │  sleep()/wait(timeout)            │
      │       ▼                           │
      │  ┌──────────────┐                 │
      │  │ TIMED_WAITING│                │
      │  └──────────────┘                 │
      └───────────────────────────────────┘
                        │
                        │ run()结束
                        ▼
                   ┌────────┐
                   │TERMINATED│
                   └────────┘
```


## 实战：理解线程dump中的状态

当你用 `jstack` 查看线程dump时：

```bash
# 部分线程dump内容
"http-nio-8080-exec-1" #42 daemon prio=5 os_prio=0 tid=0x00007f8a4c028000 nid=0x4a2 waiting for monitor entry [0x00007f8a3c5fe000]
   java.lang.Thread.State: BLOCKED

"pool-1-thread-1" #15 prio=5 os_prio=0 tid=0x00007f8a4c080800 nid=0x2f waiting on condition [0x00007f8a3b5ff000]
   java.lang.Thread.State: WAITING
```

**线程状态含义：**
- `BLOCKED`：在等待获取对象的监视器锁（对应OS的阻塞）
- `WAITING`：调用了 `Object.wait()` 或 `Thread.join()`（不带超时）
- `TIMED_WAITING`：调用了 `Thread.sleep()`、`Object.wait(timeout)` 等


## 面试追问方向

- **进程和线程的PCB有什么不同？**
  提示：线程共享进程的地址空间，所以不需要完整的PCB，只需要少量寄存器上下文。
- **进程切换和线程切换的区别是什么？哪个开销更大？为什么？**
  提示：是否需要切换地址空间（页表）。
- **Java的WAITING和BLOCKED状态有什么区别？底层是怎么实现的？**
  提示：synchronized锁的等待队列 vs Object.wait()的条件队列。
- **为什么Java的Thread.State不直接对应操作系统的进程/线程状态？**
  提示：Java线程映射到内核线程，内核线程的状态对Java不可见，JVM做了抽象。
