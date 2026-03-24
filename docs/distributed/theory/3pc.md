# 三阶段提交（3PC）：CanCommit、PreCommit、DoCommit

在上一篇文章里，我们留下了这个问题：为什么参与者不能先提交，然后在 Commit 阶段「反悔」？

2PC 的核心问题是：**在第二阶段，参与者不知道该等还是该做**。

- 如果等，万一协调者永远不恢复呢？
- 如果直接回滚，万一协调者已经发了 Commit 呢？

3PC 的思路是：**把决策和执行分开，再加一个「预提交」阶段，让参与者在最终提交前有心理准备。**

---

## 3PC 的三个阶段

### 阶段一：CanCommit（询问阶段）

协调者问所有参与者：「你们能参与这个事务吗？」

这个阶段**不锁定资源**，只是检查参与者的状态是否正常。

```java
public class ThreePhaseCoordinator {
    public boolean canCommit(Transaction transaction) {
        for (Participant participant : participants) {
            if (!participant.canParticipate(transaction)) {
                return false; // 有人不行，放弃
            }
        }
        return true; // 所有人都 ok
    }
}
```

### 阶段二：PreCommit（预提交阶段）

协调者向所有参与者发送 PreCommit，参与者**锁定资源并执行，但**不提交**。

如果任何一个参与者超时未回复，协调者发送 Abort。

```java
public boolean preCommit(Transaction transaction) {
    for (Participant participant : participants) {
        boolean success = participant.preExecute(transaction);
        if (!success) {
            abort(transaction);
            return false;
        }
    }
    return true;
}
```

### 阶段三：DoCommit（真正提交阶段）

协调者发送 DoCommit，参与者**正式提交**。

```java
public boolean doCommit(Transaction transaction) {
    for (Participant participant : participants) {
        participant.execute(transaction); // 正式提交
    }
    return true;
}
```

---

## 关键改进：超时机制

3PC 最大的改进是引入了超时机制。

在 2PC 中，参与者等待协调者指令时是**无限等待**的。

在 3PC 中：

```java
public class ParticipantIn3PC {
    private volatile State state = State.IDLE;

    public void preExecute(Transaction transaction) {
        state = State.PRE_COMMITTED;
        lockAndExecute(transaction);
        // 设置超时：如果超时，自动提交（因为没有收到 Abort）
        scheduleTimeout(() -> {
            if (state == State.PRE_COMMITTED) {
                // 超时了，认为协调者已经决定提交
                execute(transaction);
                state = State.COMMITTED;
            }
        }, 30, TimeUnit.SECONDS);
    }

    public void receiveDoCommit() {
        // 收到 DoCommit，直接提交
        execute(transaction);
        state = State.COMMITTED;
        cancelTimeout();
    }

    public void receiveAbort() {
        // 收到 Abort，回滚
        rollback(transaction);
        state = State.ABORTED;
        cancelTimeout();
    }
}
```

**关键逻辑**：参与者在 PreCommit 阶段超时后，**默认选择提交**，而不是无限等待。

为什么？因为如果协调者决定 Abort，它会发送 Abort 消息。如果超时了还没收到 Abort，说明协调者大概率是决定 Commit 了（或者已经崩溃）。

---

## 3PC 解决了什么问题

| 问题 | 2PC | 3PC |
|------|-----|-----|
| 同步阻塞 | 整个 Prepare 阶段阻塞 | 只有 CanCommit 阶段轻微阻塞 |
| 单点问题 | 协调者崩溃后无限等待 | PreCommit 阶段超时后自动提交 |
| 阻塞时间 | 协调者决定前全程阻塞 | PreCommit 后可超时自动执行 |

3PC 把「协调者决定」和「参与者执行」分开，减少了参与者的阻塞时间。

---

## 3PC 的缺陷：仍然无法保证数据一致

**重要的事情说三遍：3PC 仍然不能保证强一致性！**

### 场景：网络分区

```
协调者：分区左侧（A、B 节点）
参与者 C：分区右侧
```

1. 协调者向 A、B、C 发送 PreCommit
2. A、B 收到并进入 PreCommit 状态
3. C 没收到（网络分区），等待超时后**自动提交**
4. 同时，协调者向 A、B 发送 DoCommit
5. A、B 提交
6. 分区恢复后，C 是提交的，A、B 也是提交的——**看起来没问题**

但再看另一个场景：

1. 协调者向 A、B 发送 PreCommit（已收到），C 没收到
2. 协调者决定 Abort，向 A、B 发送 Abort
3. A、B 回滚
4. C 超时，**自动提交**
5. **数据不一致！**

3PC 的假设是「超时后默认提交」，但这个假设在网络分区时可能出错。

---

## 3PC vs 2PC 对比

| 特性 | 2PC | 3PC |
|------|-----|-----|
| **阶段数** | 2 | 3 |
| **同步阻塞** | 有，Prepare 阶段全程阻塞 | 有，缩短了阻塞时间 |
| **单点问题** | 协调者崩溃后无限等待 | 有，PreCommit 阶段超时会出问题 |
| **数据一致性** | 不保证 | 仍不保证（网络分区时） |
| **复杂度** | 简单 | 复杂（多一个阶段，多很多状态） |
| **实际应用** | XA 事务、分布式数据库 | 很少使用 |

---

## 为什么大多数系统还是用 2PC

既然 3PC 改进了这么多，为什么工业界还是用 2PC 居多？

**三个原因：**

1. **3PC 的改进是有限的**：解决了部分阻塞问题，但数据不一致问题依然存在
2. **3PC 的复杂度增加了**：多一个阶段，代码复杂度、网络开销、超时处理都要重新设计
3. **2PC 的变种更实用**：很多系统用 2PC + 超时机制 + 日志恢复来缓解问题，效果不比 3PC 差

**真正的强一致性方案是 Paxos/Raft**，它们通过多数派投票来保证一致性，和 2PC/3PC 的思路完全不同。

---

## 面试追问方向

**3PC 能不能解决数据不一致问题？**

不能。3PC 只是在 2PC 的基础上加了超时自动处理，但超时判断本身在网络分区场景下不可靠。

**什么时候用 3PC？**

说实话，生产环境中很少用 3PC。如果你面试时面试官问你这个问题，他可能是在试探你对分布式一致性的理解深度。

**真正工业级的方案是什么？**

- **对一致性要求高**：用 Paxos/Raft（ZooKeeper 使用的是 ZAB 协议，本质上是 Paxos 的变种）
- **对性能要求高，允许最终一致**：用 Saga 模式（TCC 是 Saga 的一种实现）
- **XA 事务**：对一致性要求高、参与方少、数据量不大，用 2PC

---

## 留给你的问题

2PC 和 3PC 本质上是「中心化」的一致性协议——所有决策都通过协调者。

但你有没有想过：**如果不用协调者，改为让所有节点投票，会怎样？**

这就是 Paxos 的核心思想。关于 Paxos，我们后面会专门讲。

现在先记住：2PC/3PC 是理解分布式一致性的起点，但不是终点。