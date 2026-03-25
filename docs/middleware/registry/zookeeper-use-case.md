# ZooKeeper 使用场景

ZooKeeper 诞生于 2008 年，最初是 Hadoop 生态的一员，用于解决 HDFS 的 NameNode 高可用问题。

十几年过去了，ZooKeeper 已经成为分布式系统的「基础设施」——几乎所有主流的分布式框架（Kafka、HBase、Dubbo、Canal）都用它来做协调服务。

**为什么 ZooKeeper 能「一鱼三吃」？**

因为它提供的三个核心能力——**存储、通知、选举**——正好对应了分布式系统中最常见的三类问题。

## 场景一：配置中心

想象一下，你的系统有 100 台服务器，某天需要修改一个数据库连接池的大小。

**没有配置中心时：**
- 改 100 个配置文件
- 逐台重启服务
- 如果改错了，再改 100 次
- 深夜紧急上线，手忙脚乱

**有配置中心后：**
- 在 ZooKeeper 里改一个节点
- 所有服务器自动收到通知
- 秒级生效，无需重启

### ZooKeeper 配置中心的实现

```java
// 配置存储结构
/config
  /database  →  {"url": "jdbc:mysql://localhost:3306", "pool": 20}
  /redis     →  {"host": "localhost", "port": 6379}
  /app       →  {"featureA": true, "featureB": false}
```

```java
public class ZKConfigCenter {
    private final ZooKeeper zk;
    private final Map&lt;String, byte[]&gt; cache = new ConcurrentHashMap&lt;&gt;();

    // 读取配置（带 Watch，自动感知变化）
    public byte[] getConfig(String path) {
        // 先从本地缓存读
        if (cache.containsKey(path)) {
            return cache.get(path);
        }

        // 从 ZooKeeper 读
        Watcher watcher = event -> {
            // 数据变化了，清除缓存，重新读取
            cache.remove(path);
            getConfig(path);
        };

        byte[] data = zk.getData(path, watcher, new Stat());
        cache.put(path, data);
        return data;
    }

    // 更新配置
    public void updateConfig(String path, String value) throws InterruptedException, KeeperException {
        // ZooKeeper 的写操作会触发所有 Watch
        zk.setData(path, value.getBytes(), -1);
    }
}
```

### 配置中心的最佳实践

```java
// 方式一：全量配置
zk.setData("/config/app", JSON.toJSONString(fullConfig), -1);

// 方式二：增量配置（更灵活）
zk.setData("/config/app/featureA", "true".getBytes(), -1);
zk.setData("/config/app/featureB", "false".getBytes(), -1);

// 方式三：命名空间隔离（多环境）
zk.create("/dev/config", ...);   // 开发环境
zk.create("/test/config", ...);  // 测试环境
zk.create("/prod/config", ...);  // 生产环境
```

**什么时候用 ZooKeeper 做配置中心？**

| 适合 | 不适合 |
|-----|-------|
| 配置变更频繁 | 配置数据量很大（>1MB） |
| 需要实时通知 | 需要跨数据中心同步 |
| 对一致性要求高 | 轻量级配置（用 Apollo 更简单） |

## 场景二：命名服务

分布式系统中，给每个服务实例起一个唯一的名字，是一个看似简单却很难的问题。

**问题在哪？**

- 机器 IP 会变
- 服务实例会动态扩缩容
- 需要一个「稳定的名字」指向「变化的地址」

### 临时节点实现服务注册与发现

```java
// 服务启动时注册
public class ServiceRegistry {
    private final ZooKeeper zk;

    public void register(String serviceName, String instanceId, String address) {
        // 创建临时节点：服务实例上线
        String path = "/services/" + serviceName + "/" + instanceId;
        zk.create(path, address.getBytes(),
            ZooDefs.Ids.OPEN_ACL_UNSAFE, CreateMode.EPHEMERAL);

        System.out.println("服务注册成功: " + path + " -> " + address);
    }

    public List&lt;String&gt; discover(String serviceName) {
        // 获取所有在线实例
        String path = "/services/" + serviceName;
        List&lt;String&gt; instances = zk.getChildren(path, false);

        List&lt;String&gt; addresses = new ArrayList&lt;&gt;();
        for (String instance : instances) {
            byte[] data = zk.getData(path + "/" + instance, false, new Stat());
            addresses.add(new String(data));
        }
        return addresses;
    }
}
```

```java
// 服务提供者
ServiceRegistry registry = new ServiceRegistry(zk);
registry.register("order-service", "instance-001", "192.168.1.100:8080");

// 服务消费者
List&lt;String&gt; addresses = registry.discover("order-service");
// addresses = ["192.168.1.100:8080", "192.168.1.101:8080", ...]
// 然后用负载均衡选择一个地址调用
```

### 服务发现 + 健康检查

配合 Watch 机制，可以实现**自动感知服务上下线**：

```java
public void watchService(String serviceName) {
    String path = "/services/" + serviceName;

    // 监听子节点变化（服务上下线）
    zk.getChildren(path, event -> {
        if (event.getType() == Event.EventType.NodeChildrenChanged) {
            // 子节点变化了，重新获取列表
            List&lt;String&gt; instances = zk.getChildren(path, this);
            System.out.println("服务实例变化: " + instances);
            // 触发负载均衡器更新
            loadBalancer.update(instances);
        }
    });
}
```

**ZooKeeper 做服务发现的优缺点：**

| 优点 | 缺点 |
|-----|-----|
| 实时性好（Watch 机制） | 访问量大（每次都要问 ZooKeeper） |
| 可靠性高（强一致） | 单点瓶颈（需要保护 ZooKeeper） |
| 功能完整（选举 + 配置） | 不适合大规模服务（>1000 个实例） |

**对于大规模服务发现，通常的做法是：**

```
ZooKeeper（控制面） → 配置「服务在哪里」
本地缓存（数据面） → 客户端缓存服务列表
定期同步 → ZooKeeper 变化时更新缓存
```

## 场景三：Master 选举

分布式系统中，只有一个节点能执行「关键任务」——比如定时任务、批处理、写数据。

**问题：如何确保只有一个节点在工作，其他节点都待命？**

### 基于 ZooKeeper 的 Master 选举

```java
public class MasterElection {
    private final ZooKeeper zk;
    private final String electionPath;
    private final String myId;
    private volatile boolean isMaster = false;

    public MasterElection(ZooKeeper zk, String electionPath, String myId) {
        this.zk = zk;
        this.electionPath = electionPath;
        this.myId = myId;
    }

    public void startElection() {
        try {
            // 创建临时顺序节点
            String myNode = zk.create(
                electionPath + "/master-",
                myId.getBytes(),
                ZooDefs.Ids.OPEN_ACL_UNSAFE,
                CreateMode.EPHEMERAL_SEQUENTIAL
            );

            // 获取所有候选节点
            List&lt;String&gt; nodes = zk.getChildren(electionPath, false);
            Collections.sort(nodes);

            String smallest = nodes.get(0);

            if (myNode.endsWith(smallest)) {
                // 我是最小的，成为 Master
                isMaster = true;
                System.out.println("我成为 Master: " + myId);
                doMasterWork();
            } else {
                // 不是最小的，监听前一个节点
                String previousNode = electionPath + "/" + getPreviousNode(nodes, myNode);
                watchPrevious(previousNode);
            }
        } catch (Exception e) {
            handleError(e);
        }
    }

    private void watchPrevious(String previousNode) {
        try {
            Stat stat = zk.exists(previousNode, event -> {
                if (event.getType() == Event.EventType.NodeDeleted) {
                    // 前一个 Master 挂了，重新选举
                    System.out.println("检测到 Master 下线，重新选举");
                    startElection();
                }
            });

            if (stat == null) {
                // 前一个节点已经不存在，立即重新选举
                startElection();
            }
        } catch (Exception e) {
            handleError(e);
        }
    }

    private void doMasterWork() {
        // Master 节点执行任务
        while (isMaster) {
            try {
                // 执行定时任务
                executeScheduledTask();
                Thread.sleep(interval);
            } catch (InterruptedException e) {
                break;
            }
        }
    }
}
```

### 选举的变体：竞争上岗 vs 指定

**竞争上岗（所有节点都可能成为 Master）：**
- 谁先创建节点谁就是 Master
- Master 挂了，下一个节点自动顶上

**指定 Master（特定节点优先）：**
- 给节点设置优先级（权重）
- 优先级最高的节点优先成为 Master

```java
// 指定优先级的 Master 选举
// 每个节点创建带优先级的节点名
zk.create("/election/master-10-", ...);  // 优先级 10
zk.create("/election/master-5-", ...);   // 优先级 5
zk.create("/election/master-1-", ...);   // 优先级 1

// 排序后，优先级最高的在前
List&lt;String&gt; nodes = zk.getChildren("/election", false);
// nodes = ["master-10-xxx", "master-5-xxx", "master-1-xxx"]
```

## 典型应用：Kafka 的 Controller 选举

Kafka 是用 ZooKeeper 做集群协调的典型案例。

Kafka 集群中有一个特殊的角色叫 **Controller**，它负责：

- 管理分区的 Leader 选举
- 感知 broker 的上下线
- 同步 topic 元数据

**Controller 只有一个，通过 ZooKeeper 选举产生：**

```
1. 所有 broker 启动时都尝试创建 /controller 临时节点
2. 第一个创建成功的成为 Controller
3. 其他 broker 监听 /controller 节点
4. Controller 挂了，节点消失，其他 broker 重新竞争
```

```java
// Kafka Controller 选举简化逻辑
String controllerPath = "/controller";
try {
    zk.create(controllerPath, brokerId.getBytes(),
        ZooDefs.Ids.OPEN_ACL_UNSAFE, CreateMode.EPHEMERAL);
    // 成为 Controller
    becomeController();
} catch (KeeperException.NodeExistsException e) {
    // 创建失败，说明已有 Controller，监听其变化
    watchController(controllerPath);
}
```

## 总结

ZooKeeper 的三大应用场景，对应了三种核心能力：

| 场景 | 核心能力 | ZNode 类型 | 典型用法 |
|-----|---------|-----------|---------|
| 配置中心 | 数据存储 + Watch | 持久节点 | 集中管理配置 |
| 服务发现 | 临时节点 + Watch | 临时节点 | 感知实例上下线 |
| Master 选举 | 临时顺序节点 | 临时顺序节点 | 竞争成为主节点 |

**什么时候用 ZooKeeper？**

- 需要强一致性
- 需要实时感知变化
- 需要可靠的选举机制

**什么时候不用 ZooKeeper？**

- 数据量大（ZooKeeper 不适合存大量数据）
- 需要 AP（可用性优先）
- 服务实例极多（考虑 Nacos 或 Consul）

---

**留给你的问题：**

假设你用 ZooKeeper 做 Master 选举，Master 节点执行一个耗时很长的任务（比如 10 分钟）。在这个过程中，Master 的 ZooKeeper 连接突然闪断了一下（只有一瞬间），然后恢复了。

会发生什么？

这个问题涉及到临时节点的生命周期，以及业务逻辑和 ZooKeeper 连接状态的解耦。
