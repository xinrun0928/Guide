# 中断与异常处理：CPU如何响应突发事件

当你敲击键盘时，屏幕上的字符几乎瞬间出现。但CPU在敲击前可能在做完全无关的计算。
是什么让CPU「知道」你有输入？

答案是**中断**——计算机世界中最伟大的设计之一。


## 为什么需要中断？

```
没有中断时（轮询方式）：
CPU: "键盘有输入吗？"
     "没有"
     "键盘有输入吗？"
     "没有"
     "键盘有输入吗？"
     "没有"
     ... 无限循环 ...
     效率极低！

有了中断：
CPU: 正在做其他事...
     键盘按下 → 硬件信号 → 中断控制器 → CPU
     CPU保存上下文 → 处理键盘 → 恢复继续
     效率极高！
```


## 中断的分类

```
┌─────────────────────────────────────────────────────────────┐
│                        中断分类                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 硬件中断（外部中断）                                       │
│     - 由外部设备产生                                          │
│     - 键盘、鼠标、网卡、磁盘I/O完成                             │
│     - 异步：随时可能发生                                       │
│                                                             │
│  2. 软件中断（软中断）                                         │
│     - 由程序主动触发                                          │
│     - 系统调用（INT 0x80 / syscall）                           │
│     - 同步：可预测                                            │
│                                                             │
│  3. 异常（Exception）                                         │
│     - 程序执行过程中的错误                                     │
│     - 除零、非法内存访问、越界                                 │
│     - 同步：错误触发                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 常见异常类型

| 类型 | 名称 | 产生条件 |
|-----|------|---------|
| Fault | 故障 | 可恢复的错误（缺页异常） |
| Trap | 陷阱 | 有意触发的异常（系统调用） |
| Abort | 终止 | 不可恢复的错误 |
| Interrupt | 中断 | 外部异步事件 |


## 中断处理过程

```
┌─────────────────────────────────────────────────────────────┐
│                    中断处理流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 硬件检测到中断                                            │
│     ↓                                                       │
│  2. 中断控制器（8259A/APIC）发送信号给CPU                    │
│     ↓                                                       │
│  3. CPU完成当前指令                                          │
│     ↓                                                       │
│  4. CPU自动保存程序计数器（PC）和状态寄存器                   │
│     ↓                                                       │
│  5. CPU切换到内核态，设置特权级                               │
│     ↓                                                       │
│  6. CPU查询中断向量表，获取处理程序入口                       │
│     ↓                                                       │
│  7. 执行中断处理程序                                          │
│     ↓                                                       │
│  8. 恢复保存的状态                                           │
│     ↓                                                       │
│  9. 返回到中断前的位置继续执行                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 中断向量表

```
┌─────────────────────────────────────────────────────────────┐
│                    中断向量表（x86示例）                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  向量号  │  说明                     │ 处理程序             │
│  ───────┼────────────────────────────┼─────────────        │
│    0    │  除法错误                   │ DE #DE             │
│    1    │  调试异常                   │ DB #DB             │
│    2    │  NMI中断                    │ NMI                │
│    3    │  断点                       │ BP #BP             │
│    4    │  溢出                       │ OF #OF             │
│    5    │  边界检查                    │ BR #BR             │
│    6    │  无效操作码                  │ UD #UD             │
│    7    │  设备不可用                  │ NM #NM             │
│    ...  │  ...                       │ ...                │
│    13   │  通用保护错误                │ GP #GP             │
│    14   │  缺页异常                   │ PF #PF             │
│    ...  │  ...                       │ ...                │
│    128  │  Linux系统调用              │ 0x80               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```java
// 中断处理程序的简化模拟
public class InterruptHandling {
    // 中断向量表
    private static InterruptHandler[] idt = new InterruptHandler[256];

    static {
        // 注册中断处理程序
        idt[0] = new DivisionByZeroHandler();    // 除零错误
        idt[13] = new GeneralProtectionHandler(); // 保护错误
        idt[14] = new PageFaultHandler();        // 缺页异常
        idt[0x80] = new SystemCallHandler();     // Linux系统调用
    }

    // CPU执行中断的过程
    public static void handleInterrupt(int vectorNumber) {
        // 1. 保存上下文
        CPUState savedState = CPU.saveState();

        // 2. 切换到内核栈
        switchToKernelStack();

        // 3. 调用中断处理程序
        if (idt[vectorNumber] != null) {
            idt[vectorNumber].handle();
        } else {
            // 未定义中断
            handleUnknownInterrupt(vectorNumber);
        }

        // 4. 检查是否有待处理的中断
        processPendingInterrupts();

        // 5. 恢复上下文
        CPU.restoreState(savedState);
    }
}
```


## 缺页异常详解

缺页异常是中断处理最复杂的场景之一：

```java
public class PageFaultHandling {
    public void handlePageFault(int virtualAddress) {
        // 1. 判断地址是否合法
        if (!isValidAddress(virtualAddress)) {
            throw new SegFaultException("Segmentation fault");
        }

        // 2. 计算页号和偏移
        int pageNumber = virtualAddress / PAGE_SIZE;
        int offset = virtualAddress % PAGE_SIZE;

        // 3. 检查页是否在交换区
        if (isInSwapSpace(pageNumber)) {
            // 页被换出到磁盘，需要加载回来
            int frameNumber = allocateFrame();

            // 4. 如果需要换出其他页
            if (frameNumber == -1) {
                int victimPage = selectVictim();  // LRU等算法
                int victimFrame = getFrameOfPage(victimPage);

                if (isDirty(victimPage)) {
                    swapOut(victimPage, victimFrame);  // 写回磁盘
                }
                invalidatePage(victimPage);
                frameNumber = victimFrame;
            }

            // 5. 从磁盘加载页
            swapIn(pageNumber, frameNumber);

            // 6. 更新页表
            updatePageTable(pageNumber, frameNumber);

        } else {
            // 页是第一次访问，需要初始化
            // 例如：.bss段、堆扩展、内存映射文件
            int frameNumber = allocateFrame();
            initializeFrame(frameNumber);
            updatePageTable(pageNumber, frameNumber);
        }

        // 7. 重新执行触发缺页的指令
        restartInstruction();
    }
}
```


## 操作系统如何处理键盘输入

```
完整的键盘中断流程：

1. 用户按下键盘
         ↓
2. 键盘控制器检测并发送中断信号（IRQ1）
         ↓
3. 中断控制器（APIC）接收并转发给CPU
         ↓
4. CPU完成当前指令，触发中断向量1
         ↓
5. 执行键盘中断处理程序
         ↓
6. 从键盘控制器读取扫描码
         ↓
7. 将扫描码转换为ASCII码
         ↓
8. 将字符放入键盘缓冲区
         ↓
9. 通知等待的进程（有输入了）
         ↓
10. 应用程序从缓冲区读取字符，显示到屏幕
```

```java
// Java中的键盘输入处理
public class KeyboardInput {
    public static void main(String[] args) throws IOException {
        // Scanner使用阻塞I/O，实际上依赖于系统中断
        Scanner scanner = new Scanner(System.in);
        String line = scanner.nextLine();

        // BufferedReader同理
        BufferedReader reader = new BufferedReader(
            new InputStreamReader(System.in));
        String input = reader.readLine();

        // NIO的异步处理
        // Channel注册到Selector，Selector轮询就绪事件
        // 不阻塞等待中断，而是主动检查
    }
}
```


## 中断的优先级和嵌套

```
┌─────────────────────────────────────────────────────────────┐
│                    中断优先级（x86示例）                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  优先级高 ←                                          → 低   │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│  │ NMI│ │ IRQi│ │ IRQi│ │ 软 │ │ IRQi│ │ IRQi│ │ IRQi│  │  │
│  │    │ │ -n  │ │ -n  │ │中断│ │ -n  │ │ -n  │ │ -n  │  │  │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │
│  不可屏蔽 │ 键盘  │ 串口  │ 系统 │ 硬盘  │ 网卡  │ 其他  │  │
│  中断    │(IRQ1) │(IRQ3)│ 调用 │(IRQ14)│(IRQ12)│       │  │
│                                                             │
│  高优先级中断可以打断低优先级中断的处理                        │
│  同一优先级的多个中断按固定顺序处理                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


## 实际案例：Linux的中断处理

```c
// Linux中断处理框架
irqreturn_t handle_irq(int irq, void *dev_id) {
    // 1. 标记中断处理开始
    irq_enter();

    // 2. 调用具体的中断处理函数
    ret = generic_handle_irq_desc(irq_desc, irq);

    // 3. 标记中断处理结束
    irq_exit();

    return ret;
}

// 中断处理函数（Top Half vs Bottom Half）
void do_irq(int irq) {
    // Top Half：必须立即处理的部分
    // - 响应硬件
    // - 记录中断
    // - 非常快，几微秒
    disable_irq(irq);  // 禁用后续中断

    // 调度Bottom Half
    schedule_work(&work_struct);

    // Bottom Half：耗时处理
    // - 数据处理
    // - 进程唤醒
    // - 可以延迟执行
}
```


## 面试追问方向

- **中断和异常有什么区别？各自的处理方式有什么不同？**
  提示：异步vs同步、是否可恢复。
- **缺页异常和普通内存访问错误有什么区别？**
  提示：缺页可能是正常的（按需加载）。
- **为什么中断处理要区分Top Half和Bottom Half？**
  提示：快速响应硬件，避免长时间关闭中断。
- **如何减少中断带来的性能开销？**
  提示：中断合并、轮询、事件驱动。
