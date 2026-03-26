# Quartz Job 状态与持久化

你有没有遇到过这种情况？

任务执行到一半，服务器重启了。
然后任务状态丢失，不知道执行到哪了，也不知道要不要重跑。

这就是 Quartz 要解决的 Job 状态问题。

## Job 的三种状态标记

Quartz 提供了三个注解来控制 Job 的行为：

```
┌─────────────────────────────────────────────────────────────┐
│                    Job 状态标记注解                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   @PersistJobDataAfterExecution                              │
│   │   └── 执行完成后，持久化 JobDataMap 数据                  │
│   │                                                          │
│   @DisallowConcurrentExecution                               │
│   │   └── 禁止并发执行，同一 JobDetail 只能同时运行一个实例    │
│   │                                                          │
│   @Volatile                                                  │
│   │   └── Job 实例不持久化（已废弃，很少使用）               │
│   │                                                          │
└─────────────────────────────────────────────────────────────┘
```

## @PersistJobDataAfterExecution：数据持久化

### 问题：数据丢失

```java
// 普通 Job：每次执行都是新实例，JobDataMap 不共享
public class CounterJob implements Job {
    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        JobDataMap dataMap = context.getJobDetail().getJobDataMap();
        
        // 获取计数
        int count = dataMap.getInt("count");
        
        // 累加
        count++;
        
        // 存回去
        dataMap.put("count", count);
        
        System.out.println("执行次数：" + count);
        
        // 下次执行时，count 会回到初始值！因为每次都是新实例
    }
}
```

### 解决：持久化数据

```java
// 使用 @PersistJobDataAfterExecution 后，数据会被保存到数据库
@PersistJobDataAfterExecution
public class CounterJob implements Job {
    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        JobDataMap dataMap = context.getJobDetail().getJobDataMap();
        
        int count = dataMap.getInt("count");
        count++;
        dataMap.put("count", count);
        
        System.out.println("执行次数：" + count);
        // 下次执行时，count 会保留上一次的值！
    }
}
```

### 执行流程

```
┌─────────────────────────────────────────────────────────────┐
│         @PersistJobDataAfterExecution 执行流程               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   第1次执行                                                 │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ dataMap.count = 0                                   │   │
│   │ count++ → dataMap.count = 1                         │   │
│   │ 执行完成，持久化到数据库                               │   │
│   └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│   第2次执行                                                 │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ 从数据库加载 dataMap.count = 1                       │   │
│   │ count++ → dataMap.count = 2                         │   │
│   │ 执行完成，持久化到数据库                               │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 注意：需要配合 @DisallowConcurrentExecution

如果同一个 JobDetail 的多个执行实例可能同时运行，需要同时使用 `@DisallowConcurrentExecution`，否则可能出现数据竞争。

```java
@PersistJobDataAfterExecution
@DisallowConcurrentExecution
public class SafeCounterJob implements Job {
    // 同时使用：保证不并发 + 保证数据持久化
}
```

## @DisallowConcurrentExecution：禁止并发

### 问题：并发执行

```
┌─────────────────────────────────────────────────────────────┐
│ 问题：同一个任务被并发执行                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   场景：任务执行时间 > 触发间隔                               │
│                                                             │
│   触发时间：T=0s ──▶ T=5s ──▶ T=10s ──▶ T=15s              │
│   执行耗时：10秒                                             │
│                                                             │
│   T=0s: 开始执行（预计10:00-10:10）                          │
│   T=5s: 再次触发！开始执行（预计10:05-10:15）                │
│                                                             │
│   问题：两个实例同时运行，可能导致数据不一致！                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 解决：禁止并发

```java
@DisallowConcurrentExecution
public class MyJob implements Job {
    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        // 即使触发时间到了，如果上一个实例还在执行，就等待
        // 同一个 JobDetail 只能同时运行一个实例
        doWork();
    }
}
```

### 执行对比

| 场景 | 无 @DisallowConcurrentExecution | 有 @DisallowConcurrentExecution |
|---|---|---|
| 触发间隔 < 执行时间 | 可能并发执行 | 排队等待 |
| 触发间隔 > 执行时间 | 正常执行 | 正常执行 |

```
┌─────────────────────────────────────────────────────────────┐
│      无并发控制 vs 有并发控制                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   无并发控制：                                               │
│   │ T=0 ──▶ [执行1 ────────────]                            │
│   │ T=5 ──▶        [执行2 ────────────]                   │
│   │                                                    │
│   │ 结果：并发执行，可能数据冲突                            │
│                                                             │
│   有并发控制：                                               │
│   │ T=0 ──▶ [执行1 ────────────]                           │
│   │ T=5 ──▶              [等待]────▶ [执行2 ────────────]│
│   │                                                    │
│   │ 结果：串行执行，数据安全                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## StatefulJob：状态ful Job

在 Quartz 早期版本中，使用 `StatefulJob` 接口来表示有状态的 Job。

现在已经被 `@PersistJobDataAfterExecution` + `@DisallowConcurrentExecution` 替代。

```java
// 旧写法（已废弃）
public class MyStatefulJob implements StatefulJob {
    // ...
}

// 新写法
@PersistJobDataAfterExecution
@DisallowConcurrentExecution
public class MyStatefulJob implements Job {
    // ...
}
```

## Job 的生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                    Job 生命周期                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Trigger 触发                                              │
│       │                                                     │
│       ▼                                                     │
│   ┌─────────────────────────────────────────────────────┐  │
│   │              Scheduler 创建 Job 实例                  │  │
│   │                                                      │  │
│   │   注意：每次执行都会创建新实例！                        │  │
│   └─────────────────────────────────────────────────────┘  │
│       │                                                     │
│       ▼                                                     │
│   ┌─────────────────────────────────────────────────────┐  │
│   │              调用 execute() 方法                     │  │
│   │                                                      │  │
│   │   如果有 @PersistJobDataAfterExecution              │  │
│   │   → 将 JobDataMap 持久化到数据库                      │  │
│   └─────────────────────────────────────────────────────┘  │
│       │                                                     │
│       ▼                                                     │
│   ┌─────────────────────────────────────────────────────┐  │
│   │              销毁 Job 实例                           │  │
│   │                                                      │  │
│   │   除非 JobDetail 设置了 storeDurably()              │  │
│   │   → 否则 Job 实例会被丢弃                             │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 组合使用建议

### 场景一：计数器（需要持久化 + 需要串行）

```java
@PersistJobDataAfterExecution
@DisallowConcurrentExecution
public class CounterJob implements Job {
    // 保证计数准确，不会因为并发导致数据丢失
}
```

### 场景二：只读任务（不需要持久化 + 不需要串行）

```java
public class ReadOnlyJob implements Job {
    // 只是发送邮件，不需要保存状态
    // 也不需要禁止并发，因为每次执行都是独立的
}
```

### 场景三：写任务（不需要持久化 + 需要串行）

```java
@DisallowConcurrentExecution
public class WriteJob implements Job {
    // 写数据库，但不需要保存状态
    // 需要串行，防止数据库锁冲突
}
```

## 总结

| 注解 | 作用 | 使用场景 |
|---|---|---|
| @PersistJobDataAfterExecution | 执行后将 JobDataMap 持久化 | 需要跨执行保持状态 |
| @DisallowConcurrentExecution | 禁止并发执行 | 执行时间较长、涉及共享资源 |
| 无注解 | 默认行为 | 简单独立任务 |

**最佳实践**：
1. 如果 Job 需要持久化状态，同时使用两个注解
2. 如果 Job 只是执行独立操作，可以不加注解
3. 避免在 Job 中存储大量数据到 JobDataMap（它存储在数据库中）

## 思考题

如果一个 Job 同时使用了 `@PersistJobDataAfterExecution` 和 `@DisallowConcurrentExecution`，但 Job 在执行过程中抛出异常，数据会持久化吗？

这涉及到异常处理和事务管理的边界问题。
