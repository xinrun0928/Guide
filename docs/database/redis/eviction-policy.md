# Redis 淘汰策略：noeviction ~ allkeys-lru

你的 Redis 内存满了。

新数据来了，Redis 会怎么办？

今天来聊聊 Redis 的 **内存淘汰策略**。

## 为什么需要淘汰策略？

Redis 的数据存在内存中，而内存是有限的。

```
┌─────────────────────────────────────────────────────────────────┐
│                      Redis 内存                                     │
│                                                                 │
│   ┌───────────────────────────────────────────────────────┐     │
│   │                                                       │     │
│   │   已用内存 ────────────────────────── maxmemory       │     │
│   │                                                       │     │
│   │   当已用内存 = maxmemory 时，                         │     │
│   │   新写入的数据无法存储，需要淘汰旧数据                  │     │
│   │                                                       │     │
│   └───────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 八种淘汰策略

Redis 提供了 8 种淘汰策略：

| 策略 | 说明 |
|-----|------|
| **noeviction** | 不淘汰，返回错误（默认） |
| **volatile-lru** | 从已设置过期时间的 key 中淘汰 LRU |
| **volatile-lfu** | 从已设置过期时间的 key 中淘汰 LFU |
| **volatile-ttl** | 从已设置过期时间的 key 中淘汰 TTL 最小的 |
| **volatile-random** | 从已设置过期时间的 key 中随机淘汰 |
| **allkeys-lru** | 从所有 key 中淘汰 LRU |
| **allkeys-lfu** | 从所有 key 中淘汰 LFU |
| **allkeys-random** | 从所有 key 中随机淘汰 |

### 配置方式

```bash
# redis.conf

# 最大内存（0 表示不限制）
maxmemory 2gb

# 淘汰策略
maxmemory-policy allkeys-lru
```

## LRU、LFU、TTL 详解

### LRU：Least Recently Used

**原理**：淘汰最久未使用的 key

```
访问序列：key1, key2, key3, key1, key4

LRU 链表（从新到旧）：
key4 → key1 → key3 → key2

淘汰时，删除链表尾部（最久未使用）：
key4 → key1 → key3 → [key2] 删除
```

### LFU：Least Frequently Used

**原理**：淘汰访问频率最低的 key

```
访问计数：
key1: 100次
key2: 50次
key3: 200次

淘汰时，删除访问次数最少的：
删除 key2
```

### TTL：Time To Live

**原理**：淘汰剩余 TTL 最小的 key

```
TTL 情况：
key1: 100秒
key2: 50秒  ← TTL 最小
key3: 200秒

淘汰时，删除 TTL 最小的：
删除 key2
```

## LRU 算法实现

### 简单 LRU

```c
// 简单 LRU：使用双向链表
typedef struct {
    char key[256];
    char value[1024];
    struct Node *prev;
    struct Node *next;
} Node;

// 访问时，移到链表头部
void access(Node **head, Node *node) {
    // 从当前位置移除
    if (node->prev) node->prev->next = node->next;
    if (node->next) node->next->prev = node->prev;
    
    // 移到头部
    node->next = *head;
    node->prev = NULL;
    if (*head) (*head)->prev = node;
    *head = node;
}

// 淘汰时，删除链表尾部
Node* evict(Node **tail) {
    Node *oldest = *tail;
    if (oldest->prev) {
        oldest->prev->next = NULL;
        *tail = oldest->prev;
    }
    return oldest;
}
```

**问题**：需要维护双向链表，每次访问都要移动节点。

### Redis 的近似 LRU

Redis 并没有使用真正的 LRU，而是 **近似 LRU**：

```c
// 每个 key 都记录一个 24 位的 LRU 时钟
typedef struct redisObject {
    unsigned type:4;
    unsigned encoding:4;
    unsigned lru:24;  // LRU 时钟（server.lruclock）
    // ...
} robj;

// LRU 时钟约每毫秒递增
unsigned int server.lruclock = getLRUClock();

// 淘汰时，随机采样，选择最老的
int freeMemoryIfNeeded(void) {
    // 随机采样数量（默认 5，可配置）
    int samples = server.maxmemory_samples;
    
    // 随机选择 samples 个 key
    for (int i = 0; i < samples; i++) {
        // ...
        if (bestkey == NULL || 
            current_lru - best_lru > best_lru - current_lru) {
            bestkey = key;
            best_lru = current_lru;
        }
    }
    
    // 删除最老的 key
    deleteKey(bestkey);
}
```

### 近似 LRU vs 真实 LRU

```
真实 LRU：                                        近似 LRU：

所有 key 按访问时间排序：                          随机采样 5 个 key：
┌───┬───┬───┬───┬───┬───┬───┬───┐               ┌───┐
│ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │               │ 3 │
└───┴───┴───┴───┴───┴───┴───┴───┘               └───┘
删除最久未使用的（1）：                            选择最老的（3）：
┌───┬───┬───┬───┬───┬───┬───┐                   ┌───┐
│ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │                   │ 5 │
└───┴───┴───┴───┴───┴───┴───┘                   └───┘

优势：不需要维护链表                             优势：O(1) 时间复杂度
劣势：不是真正的 LRU                            劣势：可能选错
```

## LFU 算法实现

Redis 4.0 引入了 LFU：

```c
// LFU 计数器（16 位）
typedef struct redisObject {
    unsigned type:4;
    unsigned encoding:4;
    unsigned lru:24;  // LFU: 16位计数器 + 8位衰减时间
    // ...
} robj;

// 访问时，递增计数器
void incrementLFU(robj *o) {
    // 计数器上限
    uint16_t counter = o->lru >> 8;
    if (counter < 255) {
        // 概率性递增（基于访问频率的衰减）
        double probability = 1.0 / (1.0 + counter);
        if (random() < probability) {
            counter++;
        }
    }
    o->lru = (counter << 8) | (current_time & 0xFF);
}

// 衰减：定期降低计数器
void LFUDecay(void) {
    for (key in database) {
        uint16_t counter = key->lru >> 8;
        // 衰减因子
        counter = counter / lfu_decay_time;
        key->lru = (counter << 8) | current_time;
    }
}
```

## 如何选择淘汰策略？

### 选择决策树

```
内存使用情况？
        │
        ├─ 内存充足，想保护热点数据？
        │       └─→ volatile-lru / allkeys-lru
        │
        ├─ 内存充足，想保护高频访问数据？
        │       └─→ volatile-lfu / allkeys-lfu
        │
        ├─ 想优先淘汰即将过期的数据？
        │       └─→ volatile-ttl
        │
        ├─ 所有 key 平等，随机淘汰？
        │       └─→ allkeys-random
        │
        └─ 不允许淘汰，宁可返回错误？
                └─→ noeviction
```

### 实际场景选择

| 场景 | 推荐策略 |
|-----|---------|
| Redis 作为缓存 | allkeys-lru / allkeys-lfu |
| 有明确 TTL 要求的缓存 | volatile-lru / volatile-ttl |
| Session 管理 | allkeys-lru |
| 排行榜 | volatile-lfu |
| 禁止数据丢失的缓存 | noeviction |

## 淘汰策略配置

```bash
# redis.conf

# 最大内存（建议设置，留 10% 余量）
maxmemory 2gb

# 淘汰策略
maxmemory-policy allkeys-lru

# LRU 采样数量（越大越精确，越慢）
maxmemory-samples 5

# LFU 衰减时间（分钟）
lfu-decay-time 1
```

## 淘汰过程详解

### 淘汰触发时机

1. **客户端执行命令时**：
   - 命令可能导致内存增长
   - 执行淘汰检查

2. **后台任务**：
   - 定时检查内存使用情况
   - 主动淘汰

### 淘汰流程

```c
int processCommand(client *c) {
    // 执行命令
    call(c);
    
    // 检查内存
    if (server.maxmemory > 0) {
        size_t used = zmalloc_used_memory();
        if (used > server.maxmemory) {
            // 需要淘汰
            freeMemoryIfNeeded();
        }
    }
}

int freeMemoryIfNeeded(void) {
    // 1. 如果有从节点同步延迟，减少内存使用
    if (server.repl_backlog_size > 0) {
        shrinkBacklog();
    }
    
    // 2. 计算需要释放的内存
    long long mem_to_free = server.maxmemory - zmalloc_used_memory();
    
    // 3. 按策略淘汰
    while (mem_freed < mem_to_free) {
        // 采样 + 淘汰
        evict = evictionPoolPopulate(key, server.db, pool);
        if (evict) {
            deleteKey(evict.key);
            mem_freed += evict.bytes;
        }
    }
}
```

## 监控与告警

### 监控指标

```bash
redis-cli INFO stats | grep evicted
# evicted_keys:0  # 淘汰的 key 数量

redis-cli INFO memory | grep used_memory
# used_memory:1048576
# used_memory_human:1.00M
# maxmemory:2147483648
```

### Prometheus 告警

```yaml
groups:
  - name: redis_memory_alerts
    rules:
      - alert: RedisHighMemoryUsage
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis 内存使用率超过 80%"
          
      - alert: RedisHighEvictionRate
        expr: rate(redis_evicted_keys_total[5m]) > 100
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Redis 淘汰速率过高"
```

## 总结

Redis 的内存淘汰策略：

| 策略 | 适用场景 |
|-----|---------|
| allkeys-lru | 通用缓存，热点数据 |
| volatile-lru | 有明确 TTL 的缓存 |
| allkeys-lfu | 访问频率差异明显 |
| volatile-lfu | 访问频率 + TTL |
| allkeys-random | 无差别缓存 |
| volatile-random | 有 TTL 的随机淘汰 |
| volatile-ttl | 优先淘汰快过期数据 |
| noeviction | 不允许淘汰 |

## 留给你的问题

allkeys-lru 会淘汰所有 key，但如果业务需要保留某些 key（如配置 key），该怎么办？

**如何实现「不淘汰某些特定 key」的策略？**
