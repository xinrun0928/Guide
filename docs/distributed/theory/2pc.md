# 二阶段提交（2PC）：流程与缺陷

想象你要组织一场会议，需要同时预订会议室和机票。

**第一阶段**：你分别给会议室和机票代理打电话，问：「今天下午 3 点能安排吗？」

**第二阶段**：
- 如果两个都说「能」，你说「好，定了」，两边都正式确认
- 如果任何一个说「不能」，你说「取消」，两边都撤销

这就是二阶段提交（Two-Phase Commit，2PC）的核心思想。

---

## 2PC 的两个阶段

### 阶段一：Prepare（准备阶段）

协调者（Coordinator）向所有参与者（Participant）发送 Prepare 请求，询问：「你们准备好了吗？」

每个参与者执行本地事务（锁定资源），但不提交。然后回复「可以提交」或「不能提交」。

```java
// 协调者代码简化
public class TwoPhaseCommitCoordinator {
    private List<Participant> participants = Arrays.asList(
        new Participant("账户A"),
        new Participant("账户B")
    );

    public boolean commit(Transaction transaction) {
        // 阶段一：Prepare
        for (Participant participant : participants) {
            boolean canCommit = participant.prepare(transaction);
            if (!canCommit) {
                // 任何参与者不能提交，全部回滚
                rollback(transaction);
                return false;
            }
        }
        // 阶段二：Commit
        return doCommit(transaction);
    }

    private void rollback(Transaction transaction) {
        for (Participant participant : participants) {
            participant.rollback(transaction);
        }
    }

    private boolean doCommit(Transaction transaction) {
        for (Participant participant : participants) {
            participant.commit(transaction);
        }
        return true;
    }
}
```

### 阶段二：Commit（提交阶段）

协调者根据所有参与者的回复决定：

- **全部回复「可以」**：发送 Commit 请求，所有参与者正式提交
- **任何一个回复「不能」**：发送 Rollback 请求，所有参与者回滚

---

## 2PC 的 Java 实现

```java
// 参与者代码简化
public class Participant {
    private String name;

    public Participant(String name) {
        this.name = name;
    }

    // 阶段一：Prepare，返回是否可以提交
    public synchronized boolean prepare(Transaction transaction) {
        try {
            // 锁定资源，执行本地操作（但不提交）
            lockResource(transaction);
            executeLocal(transaction);
            return true; // 可以提交
        } catch (Exception e) {
            return false; // 不能提交
        }
    }

    // 阶段二：Commit
    public synchronized void commit(Transaction transaction) {
        // 真正提交事务
        realCommit(transaction);
        releaseResource(transaction);
    }

    // 阶段二：Rollback
    public synchronized void rollback(Transaction transaction) {
        // 回滚事务
        realRollback(transaction);
        releaseResource(transaction);
    }
}
```

---

## 2PC 的三大缺陷

### 缺陷一：同步阻塞

这是最容易理解的问题。

在 Prepare 阶段，所有参与者持有锁等待协调者的指令。在协调者做出决定之前，**这些资源是锁定的，其他事务无法访问**。

```java
// 场景模拟
public class BlockingScenario {
    public static void main(String[] args) {
        // 参与者 A：扣款
        // 参与者 B：发货
        // 参与者 C：积分

        // 如果协调者在 Prepare 阶段崩溃了...
        // 参与者 A、B、C 都卡住了：资源锁着，业务停摆
    }
}
```

如果参与者数量多，或者网络延迟大，这个阻塞时间会很长。

### 缺陷二：单点问题

协调者是单点。

如果协调者在 Prepare 阶段发送了请求后崩溃，参与者不知道该等待还是回滚，只能**无限等待**。

```java
// 场景：协调者崩溃后的惨状
public class CoordinatorCrashScenario {
    public void simulate() {
        // 时间 T：协调者发送 Prepare 到参与者 A、B、C
        // 时间 T + 1ms：协调者崩溃，只发送了到 A 的 Prepare
        // 参与者 B、C：没收到 Prepare，也不知道该干啥
        // 参与者 A：收到 Prepare，锁定资源，等待 Commit

        // 业务彻底卡住！
        // 除非人工介入，否则无法恢复
    }
}
```

### 缺陷三：数据不一致

这是最严重的问题。

如果协调者发送 Commit 后崩溃，只有一部分参与者收到了 Commit，另一部分没收到。

```java
// 场景：Commit 消息丢失
public class DataInconsistencyScenario {
    public void simulate() {
        // 协调者决定 Commit，发送 Commit 消息
        // 参与者 A 收到，提交成功
        // 参与者 B 没收到（网络抖动），一直等待
        // 参与者 C 收到，提交成功

        // 结果：账户 A 和 C 提交了，B 回滚了
        // 数据彻底不一致！
    }
}
```

---

## 2PC 的适用场景

尽管有这么多缺陷，2PC 仍然被广泛使用。

因为在**参与者少、系统不频繁**的场景下，这些缺陷是可以容忍的。

**最典型的应用：分布式数据库的 XA 事务**

MySQL、PostgreSQL、Oracle 都支持 XA 协议，XA 本质上就是 2PC 的实现。在银行、电商等强一致性要求、高价值事务的场景，2PC 仍然是主流选择。

```sql
-- MySQL XA 事务示例
XA START 'transaction-id';
UPDATE account SET balance = balance - 100 WHERE user_id = 1;
XA END 'transaction-id';
XA PREPARE 'transaction-id';
-- ... 其他参与者 ...
XA COMMIT 'transaction-id';
```

---

## 面试高频追问

### 追问一：协调者崩溃后参与者怎么办？

这是面试官最常问的问题。

**标准答案**：

1. **设计协议时约定超时机制**：参与者在等待 Prepare 响应时设置超时，超时后自动回滚
2. **日志记录**：协调者和参与者都要写日志，协调者恢复后从日志恢复状态
3. **改良方案**：用三阶段提交（3PC）或者 Paxos/Raft 做协调者选主

### 追问二：如何设计超时机制？

```java
// 参与者的超时处理
public class ParticipantWithTimeout {
    private volatile boolean prepared = false;
    private ScheduledFuture<?> timeoutTask;

    public boolean prepare(Transaction transaction) {
        prepared = false;
        executeLocal(transaction);

        // 设置超时：如果 30 秒内没收到 Commit/Rollback，自动回滚
        timeoutTask = scheduler.schedule(() -> {
            if (!prepared) {
                rollback(transaction); // 超时回滚
            }
        }, 30, TimeUnit.SECONDS);

        prepared = true;
        return true;
    }

    public void commit(Transaction transaction) {
        if (timeoutTask != null) {
            timeoutTask.cancel(false); // 收到 Commit，取消超时
        }
        realCommit(transaction);
    }
}
```

---

## 留给你的问题

2PC 的同步阻塞问题，本质上是因为「锁定资源等待确认」。

但你有没有想过：为什么参与者不能先提交，然后在 Commit 阶段「反悔」？

这就是 3PC 试图解决的问题。但 3PC 真的解决了吗？

带着这个问题，去看下一篇文章。