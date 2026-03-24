# 分布式唯一任务执行：乐观锁 + 分布式锁双保险

你有没有遇到过这种情况：

定时任务设置了每天凌晨 3 点执行对账，结果两个节点同时执行，对账数据翻倍了。

这不是 bug，这是分布式任务调度的经典问题：**同一个任务在多台机器上被重复执行**。

## 分布式任务调度的挑战

分布式环境下，定时任务可能部署在多个节点上：

```
                   ┌─────────────┐
  ┌─────────────┐  │             │  ┌─────────────┐
  │   节点 1    │──│  调度中心    │──│   节点 2    │
  │  执行任务   │  │  分配任务    │  │  执行任务   │
  └─────────────┘  │             │  └─────────────┘
                   └─────────────┘
```

问题：
1. **任务重复执行**：调度中心给两个节点都分配了同一个任务
2. **任务漏执行**：节点挂了，任务没有执行
3. **任务超时**：任务执行时间过长，调度中心以为失败了

## 方案一：分布式锁

分布式锁是最直接的方案：**同一时刻只有一个节点能抢到锁，抢到锁的节点才能执行任务**。

### Redis 分布式锁

```java
@Service
public class DistributedLockJob {

    private static final String LOCK_KEY = "job:settlement";
    private static final long LOCK_TIMEOUT = 30 * 60 * 1000;  // 30 分钟

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void execute() {
        // 尝试获取锁
        Boolean acquired = redisTemplate.opsForValue()
            .setIfAbsent(LOCK_KEY, Thread.currentThread().getId(), LOCK_TIMEOUT, TimeUnit.MILLISECONDS);

        if (!Boolean.TRUE.equals(acquired)) {
            log.info("未获取到锁，任务已被其他节点执行");
            return;
        }

        try {
            // 执行任务
            doSettlement();
        } finally {
            // 释放锁
            redisTemplate.delete(LOCK_KEY);
        }
    }

    private void doSettlement() {
        // 对账逻辑
    }
}
```

### 分布式锁的问题

1. **抢锁失败的任务无法补执行**：节点 B 抢锁失败后，不知道任务是否被执行
2. **锁续期问题**：任务执行时间长，锁过期了怎么办
3. **锁释放问题**：节点崩溃了，锁没有释放

## 方案二：乐观锁

乐观锁通过**版本号控制**，确保只有一个节点能成功执行：

```java
@Service
public class OptimisticLockJob {

    @Autowired
    private JobMapper jobMapper;

    public void execute(Long taskId) {
        // 查询任务
        JobTask task = jobMapper.selectById(taskId);

        if (task.getStatus() != JobStatus.PENDING) {
            return;  // 任务已被执行
        }

        // 乐观锁更新
        int updated = jobMapper.updateStatus(taskId, JobStatus.EXECUTING, task.getVersion());
        if (updated == 0) {
            log.info("乐观锁更新失败，任务已被其他节点执行");
            return;
        }

        try {
            // 执行任务
            doTask(task);

            // 更新为完成状态
            jobMapper.updateStatus(taskId, JobStatus.COMPLETED);
        } catch (Exception e) {
            // 更新为失败状态
            jobMapper.updateStatus(taskId, JobStatus.FAILED);
            throw e;
        }
    }
}
```

### 乐观锁的问题

1. **并发时只有一个成功**：其他节点的更新都失败了
2. **需要轮询重试**：失败的节点需要等待下次调度

## 方案三：双保险（推荐）

分布式锁 + 乐观锁，双重保险：

```java
@Service
public class DualProtectionJob {

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private JobMapper jobMapper;

    private static final String LOCK_KEY = "job:settlement:";

    public void execute(Long taskId) {
        String lockKey = LOCK_KEY + taskId;

        // 1. 先尝试获取分布式锁
        Boolean lockAcquired = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "1", 30, TimeUnit.MINUTES);

        if (!Boolean.TRUE.equals(lockAcquired)) {
            log.info("未获取到锁，跳过");
            return;
        }

        try {
            // 2. 再检查任务状态
            JobTask task = jobMapper.selectById(taskId);
            if (task.getStatus() != JobStatus.PENDING) {
                log.info("任务状态不是待执行，跳过");
                return;
            }

            // 3. 乐观锁更新
            int updated = jobMapper.updateStatusWithVersion(taskId);
            if (updated == 0) {
                log.info("乐观锁更新失败，跳过");
                return;
            }

            // 4. 执行任务
            doTask(task);
        } finally {
            redisTemplate.delete(lockKey);
        }
    }
}
```

## 面试追问方向

- 分布式锁的续期问题怎么解决？（答：用 watchdog 机制续期，或将锁超时时间设长一些）
- 任务执行失败后如何处理？（答：重试机制、失败告警、人工处理）
- 如何处理任务超时？（答：心跳机制、超时中断、重新调度）
- 分布式锁和乐观锁的取舍？（答：分布式锁适合实时性要求高的场景，乐观锁适合允许延迟的场景）

## 小结

分布式唯一任务执行的核心是**防止重复执行**：

1. **分布式锁**：保证同一时刻只有一个节点在执行
2. **乐观锁**：保证任务状态更新的原子性
3. **双保险**：分布式锁 + 乐观锁，最可靠的方案
4. **补偿机制**：任务失败后的重试和告警
