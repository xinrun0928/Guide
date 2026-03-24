# Linux进程与线程：深入理解Linux的任务管理

你知道Linux系统里，进程和线程几乎没有区别吗？
当你用`ps`命令查看系统进程时，线程和进程混在一起显示。
这背后是什么设计哲学？


## Linux的进程/线程模型

### 一切皆文件，一切皆task_struct

Linux内核中，**进程和线程使用同一个数据结构**：`task_struct`。

```c
// 内核源码中的task_struct（简化版）
struct task_struct {
    // 进程标识
    pid_t pid;           // 进程ID
    pid_t tgid;          // 线程组ID（同一进程的线程共享）
    pid_t parent_pid;    // 父进程PID

    // 调度相关
    int prio;            // 动态优先级
    unsigned int policy; // 调度策略
    struct sched_entity se;  // 调度实体

    // 内存管理
    struct mm_struct *mm;    // 进程的地址空间
    struct mm_struct *active_mm;

    // 文件系统
    struct fs_struct *fs;    // 文件系统信息
    struct files_struct *files;  // 文件描述符表

    // 信号处理
    struct signal_struct *signal;
    struct sighand_struct *sighand;

    // 时间信息
    struct timespec start_time;  // 启动时间
    unsigned long long sum_exec_runtime;  // CPU运行时间
};
```

### 进程 vs 线程：共享什么？

```
┌─────────────────────────────────────────────────────────────┐
│                    进程 vs 线程（Linux视角）                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  进程：独立的地址空间（mm）                                    │
│                                                             │
│  线程：共享地址空间（mm）                                      │
│                                                             │
│  ┌────────────────────────────────────────────────────┐   │
│  │              共享的（共享mm）                       │   │
│  │  代码段、数据段、堆、共享内存、文件描述符、信号...      │   │
│  └────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌────────────────────────────────────────────────────┐   │
│  │              独立的                                  │   │
│  │  栈、寄存器上下文、程序计数器、线程ID...              │   │
│  └────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


## 进程的创建

### fork + exec模型

Linux使用经典的`fork + exec`模型创建新进程：

```c
// 经典的fork模式
#include <unistd.h>
#include <sys/wait.h>

int main() {
    pid_t pid = fork();  // 创建子进程

    if (pid < 0) {
        // fork失败
        perror("fork failed");
    } else if (pid == 0) {
        // 子进程
        execlp("ls", "ls", "-la", NULL);  // 替换为新程序
    } else {
        // 父进程
        wait(NULL);  // 等待子进程结束
    }

    return 0;
}
```

### fork的工作原理

```
fork前：
┌────────────────────────────────────────────┐
│                    父进程                    │
│                                            │
│  代码、数据、堆、栈                         │
│                                            │
│  文件描述符表、信号处理...                    │
│                                            │
└────────────────────────────────────────────┘

fork时（写时复制）：
┌────────────────────────────────────────────┐
│                    父进程                    │
│                                            │
│  代码（共享，只读）                         │
│  数据（共享，只读）                         │
│  堆（写时复制）                            │
│  栈（各自独立）                            │
│                                            │
│  文件描述符（共享）                        │
└────────────────────────────────────────────┘
                    ↓ fork
┌────────────────────────────────────────────┐
│                    子进程                    │
│                                            │
│  代码（指向父进程）                        │
│  数据（指向父进程）                        │
│  堆（开始指向，后复制）                    │
│  栈（独立副本）                            │
│                                            │
│  文件描述符（指向父进程）                  │
└────────────────────────────────────────────┘
```

### 写时复制（Copy-on-Write）

```c
// fork并不真正复制内存，只复制页表
// 当任一方尝试写入时，才真正复制页面

// 内核源码中的写时复制
int do_fork(unsigned long clone_flags, ...) {
    struct task_struct *p;

    // 1. 分配新的task_struct
    p = dup_task_struct(current);

    // 2. 复制/共享资源
    if (clone_flags & CLONE_VM) {
        // 线程：共享内存空间
        p->mm = current->mm;
        p->active_mm = current->active_mm;
    } else {
        // 进程：复制内存空间
        retval = copy_mm(clone_flags, p);
    }

    // 3. 返回子进程PID
    return task_pid_vnr(p);
}
```


## 线程的创建

### pthread_create

```c
#include <pthread.h>

void* thread_function(void* arg) {
    int* num = (int*)arg;
    printf("Thread: %d\n", *num);
    return NULL;
}

int main() {
    pthread_t thread1, thread2;
    int arg1 = 1, arg2 = 2;

    // 创建线程
    pthread_create(&thread1, NULL, thread_function, &arg1);
    pthread_create(&thread2, NULL, thread_function, &arg2);

    // 等待线程结束
    pthread_join(thread1, NULL);
    pthread_join(thread2, NULL);

    return 0;
}
```

### Java线程和Linux线程的映射

```java
public class JavaThreadLinuxMapping {
    public static void main(String[] args) {
        // JVM线程 → Linux线程（LWP轻量级进程）
        // 可以通过ps命令查看：
        // ps -eLf | grep java

        // JVM线程和LWP是一一对应的
        Thread t1 = new Thread(() -> {
            System.out.println("Thread: " + Thread.currentThread().getName());
        });
        t1.start();

        // 每个Java线程对应一个Linux线程
        // 虚拟线程（Java 21）虽然更轻量
        // 但底层仍然映射到LWP
    }
}
```


## 进程调度

### 调度策略

```bash
# 查看进程的调度策略
ps -eo pid,cls,rt_priority,cmd

# cls列：
# -2: IDLE（空闲）
# -1: NORMAL（普通）
#  0: BATCH（批处理）
#  1: RR/FIFO（实时）

# 修改进程调度策略
chrt -f 50 ./my_program   # FIFO，优先级50
chrt -r 50 ./my_program   # RR，优先级50
```

### 调度算法

```c
// CFS（完全公平调度器）核心概念

struct sched_entity {
    struct load_weight load;           // 权重（nice值决定）
    struct rb_node run_node;          // 红黑树节点
    unsigned int on_rq;              // 是否在运行队列

    // 虚拟运行时间
    u64 vruntime;                    // 越久没运行，vruntime越小

    // 时间片
    unsigned long execution;          // 本周期已运行时间
};
```

### CFS的工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    CFS调度原理                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  红黑树中按vruntime排序：                                   │
│                                                             │
│          虚拟运行时间（vruntime）                            │
│              小 ─────────────────────── 大                  │
│                │                                        │    │
│                ▼                                        ▼    │
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                     │    │
│  │    [P3]    [P1]    [P2]    [P4]    [P5]          │    │
│  │   vruntime  vruntime  vruntime  vruntime  vruntime │    │
│  │     最小     中等      中等      较大      最大     │    │
│  │                                                     │    │
│  │         红黑树按vruntime从左到右排列                 │    │
│  │                                                     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                             │
│  调度器总是选择最左边的进程执行（vruntime最小）              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


## 进程间通信

### Linux提供的IPC机制

```bash
# 查看系统IPC资源
ipcs

# 共享内存
ipcs -m

# 信号量
ipcs -s

# 消息队列
ipcs -q
```

### pipe管道

```c
#include <unistd.h>

int main() {
    int pipefd[2];
    pipe(pipefd);  // 创建管道

    pid_t pid = fork();

    if (pid == 0) {
        // 子进程写
        close(pipefd[0]);  // 关闭读端
        write(pipefd[1], "hello", 5);
        close(pipefd[1]);
    } else {
        // 父进程读
        close(pipefd[1]);  // 关闭写端
        char buf[100];
        read(pipefd[0], buf, 100);
        close(pipefd[0]);
    }

    return 0;
}
```

### Unix域Socket

```c
// 使用Unix域Socket进行进程通信
#include <sys/socket.h>
#include <sys/un.h>

// 创建Unix域Socket
int sock = socket(AF_UNIX, SOCK_STREAM, 0);

// 绑定到路径
struct sockaddr_un addr;
addr.sun_family = AF_UNIX;
strcpy(addr.sun_path, "/tmp/mysocket");
bind(sock, (struct sockaddr*)&addr, sizeof(addr));
```


## 实战命令

```bash
# 查看进程
ps aux                    # 详细格式
ps -ef                    # 标准格式
ps -eo pid,tid,pcpu,pmem,cmd  # 自定义格式

# 查看线程
ps -eLf | grep java       # 查看Java进程的所有线程
top -H -p <pid>          # 查看某进程的线程

# 查看进程树
pstree                    # 进程树
pstree -p 1              # 查看PID 1的进程树

# 查看进程打开的文件
lsof -p <pid>            # 查看某进程打开的文件
lsof -i :8080            # 查看占用端口8080的进程

# 实时监控进程
top                       # 实时监控
htop                      # 更友好的top
iotop                     # 监控I/O
```


## 面试追问方向

- **Linux中进程和线程的区别是什么？**
  提示：task_struct是否共享mm。
- **fork和vfork的区别是什么？**
  提示：vfork共享地址空间，写时复制。
- **CFS调度器的核心思想是什么？**
  提示：虚拟运行时间、红黑树、vruntime最小优先。
- **为什么说Linux的线程是「轻量级进程」？**
  提示：线程创建不需要额外内存分配，只复制少量资源。
