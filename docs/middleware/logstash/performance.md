# Logstash 性能优化：线程模型、队列缓冲区、Filter 顺序调优

Logstash 跑起来了，但发现 CPU 占用率高、吞吐量上不去？这通常是性能配置出了问题。

## 1. Logstash 线程模型

理解 Logstash 的线程模型，是优化的基础。

### 1.1 线程结构

```
┌─────────────────────────────────────────────────────────────┐
│                    Logstash 线程模型                         │
│                                                               │
│  Main Thread (启动/停止)                                      │
│      │                                                         │
│      └── Pipeline Executor                                    │
│              │                                                 │
│              ├── Pipeline 1 ───── Input → Filter → Output     │
│              │                      │                          │
│              │                      ├── Input Worker (数量可配置)│
│              │                      ├── Filter Worker (数量可配置)
│              │                      └── Output Worker (数量可配置)
│              │                                                 │
│              └── Pipeline 2 ───── ...                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 默认配置

```yaml
# logstash.yml

# Pipeline worker 数量（处理 Filter 和 Output）
pipeline.workers: 2

# 每个 Pipeline 的批量大小
pipeline.batch.size: 125

# 批次延迟（毫秒）
pipeline.batch.delay: 50
```

### 1.3 查看当前配置

```bash
# 查看 Logstash 配置
curl -X GET "localhost:9600/_node/stats/pipeline?pretty"

# 查看线程信息
curl -X GET "localhost:9600/_node/stats?pretty"
```

## 2. Pipeline 配置优化

### 2.1 Pipeline Workers

```yaml
# logstash.yml

# 推荐值：CPU 核心数的倍数
# 但要注意不要超过实际需求，过多的 worker 会增加上下文切换开销
pipeline.workers: 8
```

**如何选择 worker 数量？**

```
公式：workers = CPU 核心数

实际测试：
1. 从 1 开始，逐步增加
2. 观察 CPU 使用率和吞吐量
3. 找到最优值（通常是 CPU 核心数）
```

### 2.2 批量大小

```yaml
# 每个批次处理的事件数
pipeline.batch.size: 500

# 批次延迟（毫秒）
# 超过这个时间，即使批次未满也会发送
pipeline.batch.delay: 50
```

**批量大小的权衡：**

```
批量大：
  ✓ 减少批次数，降低开销
  ✓ 提高吞吐量
  ✗ 增加延迟
  ✗ 增加内存占用

批量小：
  ✓ 降低延迟
  ✓ 减少内存占用
  ✗ 增加批次数，增加开销
  ✗ 降低吞吐量
```

**推荐值：**

| 场景 | batch.size | batch.delay |
|-----|-----------|-------------|
| 低延迟要求 | 125 | 50 |
| 高吞吐要求 | 500 | 1000 |
| 平衡 | 250 | 200 |

## 3. Input 配置优化

### 3.1 File Input

```java
input {
  file {
    path => "/var/log/**/*.log"

    # 减少文件检查开销
    discover_interval => 10           # 默认 15 秒
    stat_interval => 1                  # 默认 1 秒

    # 关闭不必要的跟踪
    close_older => "1h"                # 减少打开的文件句柄
    ignore_older => "24h"              # 忽略过老的文件

    # 批量读取
    bulk_size => 1000                  # 批量发送大小
  }
}
```

### 3.2 JDBC Input

```java
input {
  jdbc {
    jdbc_driver_library => "/path/to/driver.jar"
    jdbc_driver_class => "com.mysql.cj.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://mysql:3306/blog"
    jdbc_user => "root"
    jdbc_password => "password"

    # 性能优化
    jdbc_paging_enabled => true
    jdbc_page_size => 100000            # 分页查询大小

    # 使用游标（MySQL 8.0+）
    jdbc_fetch_size => 100000
  }
}
```

### 3.3 Kafka Input

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["logs"]
    group_id => "logstash"

    # 消费者线程数（建议等于 Kafka 分区数）
    consumer_threads => 8

    # 批量获取
    max_poll_records => 500             # 每次 poll 获取的最大记录数
    max_poll_interval_ms => 300000

    # 手动提交偏移量（更可靠但可能增加延迟）
    enable_auto_commit => false
  }
}
```

## 4. Filter 配置优化

### 4.1 插件执行顺序

Filter 插件的执行顺序很重要：

```
执行顺序（不是配置顺序）：
1. date
2. grok
3. mutate
4. ruby (按配置顺序)
5. 其他
```

### 4.2 Grok 优化

```java
filter {
  grok {
    # 方式一：使用精确匹配（更快）
    match => {
      "message" => "%{IP:client_ip} %{WORD:method} %{URIPATHPARAM:request}"
    }

    # 方式二：使用 break_on_match（匹配成功就停止）
    break_on_match => true

    # 方式三：多个 match，写在最前面的优先匹配
    match => {
      "message" => [
        "精确的日志格式",
        "次精确的日志格式",
        "通用格式"
      ]
    }

    # 方式四：使用 named_captures_only（只保留命名捕获）
    named_captures_only => true

    # 方式五：删除匹配失败的标签
    tag_on_failure => []
  }
}
```

### 4.3 条件判断优化

```java
# 慢：每个事件都执行条件判断
filter {
  if [type] == "nginx" {
    grok { ... }
    date { ... }
  }
}

# 快：使用多个 Pipeline 分别处理
# pipelines.yml
- pipeline.id: nginx
  path.config: "/etc/logstash/conf.d/nginx.conf"
- pipeline.id: app
  path.config: "/etc/logstash/conf.d/app.conf"
```

### 4.4 Ruby 优化

```java
# 慢：每次都执行 Ruby 代码
filter {
  ruby {
    code => "some complex computation"
  }
}

# 快：使用 Ruby 内置函数或优化算法
filter {
  ruby {
    code => "
      # 使用高效的方法
      event.set('field', event.get('other_field').to_s.upcase)
    "
    # 加载外部库（如果需要）
    path => "/etc/logstash/ruby/my_filter.rb"
  }
}
```

## 5. Output 配置优化

### 5.1 Elasticsearch Output

```java
output {
  elasticsearch {
    hosts => ["http://localhost:9200"]

    # 批量写入
    workers => 4                      # 输出线程数
    flush_size => 5000                # 达到多少条刷新一次
    idle_flush_time => 1              # 超过多少秒刷新一次

    # 压缩
    compression => true              # 启用 gzip 压缩

    # 超时配置
    connect_timeout => 60
    timeout => 300

    # 死信队列
    dlq_codec_retry_max => 3
  }
}
```

### 5.2 Kafka Output

```java
output {
  kafka {
    bootstrap_servers => "kafka:9092"
    topic_id => "logs"

    # 批量发送
    batch_size => 16384              # 批量大小（字节）
    linger_ms => 10                  # 等待时间
    compression_type => "lz4"        # 压缩类型

    # acks 配置
    acks => "1"                      # 性能优先用 1，可靠性优先用 all

    # 序列化
    key_serializer => "org.apache.kafka.common.serialization.StringSerializer"
    value_serializer => "org.apache.kafka.common.serialization.StringSerializer"
  }
}
```

## 6. 队列优化

### 6.1 内存队列 vs 持久化队列

```yaml
# logstash.yml

# 内存队列（默认）
queue.type: memory
queue.max_bytes: 1gb

# 持久化队列（推荐生产环境）
queue.type: persisted
queue.page_capacity: 64mb           # 页面大小
queue.max_events: 0                  # 无限制
queue.max_bytes: 4gb                 # 队列最大占用
queue.checkpoint.writes: 1024        # checkpoint 间隔
queue.checkpoint.compress: true      # 压缩 checkpoint
```

### 6.2 持久化队列配置

```yaml
queue.type: persisted
queue.page_capacity: 64mb
queue.max_bytes: 10gb
queue.checkpoint.writes: 1024
queue.checkpoint.compress: true
```

## 7. JVM 优化

### 7.1 JVM 配置

```bash
# bin/jvm.options

# 堆内存大小（建议为系统内存的 50%，最大 31GB）
-Xms4g
-Xmx4g

# 垃圾回收器
-XX:+UseG1GC
-XX:MaxGCPauseMillis=500

# 其他优化
-XX:+UseCompressedOops
-XX:+AlwaysPreTouch
```

### 7.2 常见问题

```bash
# 问题：GC 停顿时间过长
# 解决：调整 GC 参数
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200

# 问题：内存溢出
# 解决：增加堆内存或优化 Pipeline 配置
-Xms8g
-Xmx8g
```

## 8. 性能监控

### 8.1 查看监控指标

```bash
# 查看 Pipeline 统计
curl -X GET "localhost:9600/_node/stats/pipeline?pretty"

# 查看内存使用
curl -X GET "localhost:9600/_node/stats/jvm?pretty"

# 查看线程
curl -X GET "localhost:9600/_node/stats/threads?pretty"
```

### 8.2 关键指标

| 指标 | 说明 | 正常范围 |
|-----|------|----------|
| pipeline.events.in | 输入事件数 | 持续增长 |
| pipeline.events.out | 输出事件数 | 持续增长 |
| pipeline.events.filtered | 过滤后事件数 | 与输入接近 |
| pipeline.queueSize | 队列大小 | < queue.max_bytes |
| jvm.heap.used | 堆内存使用 | < Xmx 的 80% |

### 8.3 常见瓶颈判断

```bash
# 观察哪个阶段是瓶颈：

# Input 慢：events.in 增长慢
curl -X GET "localhost:9600/_node/stats/pipeline?pretty" | jq '.pipelines.main.plugins.inputs'

# Filter 慢：events.filtered 跟不上 events.in
curl -X GET "localhost:9600/_node/stats/pipeline?pretty" | jq '.pipelines.main.events'

# Output 慢：events.out 跟不上 events.filtered
curl -X GET "localhost:9600/_node/stats/pipeline?pretty" | jq '.pipelines.main.plugins.outputs'
```

## 9. 优化清单

```
性能优化检查清单：

□ Pipeline Workers = CPU 核心数
□ Batch Size 调整到 250-500
□ Grok 使用精确匹配
□ 使用 filter 而非 query
□ Elasticsearch 使用批量写入
□ 启用持久化队列
□ JVM 堆内存配置正确
□ GC 参数调优
□ 监控关键指标
□ 发现瓶颈针对性优化
```

## 总结

Logstash 性能优化的核心要点：

1. **Pipeline Workers**：设置为 CPU 核心数
2. **Batch Size**：根据延迟和吞吐需求调整（250-500）
3. **Filter 优化**：使用精确的 Grok 模式，减少条件判断
4. **Output 优化**：批量写入，启用压缩
5. **队列配置**：生产环境使用持久化队列
6. **JVM 配置**：堆内存和 GC 参数

---

**留给你的问题**：

假设你的 Logstash 配置如下，但吞吐量只有 5000 events/s，CPU 占用率 30%，你觉得瓶颈在哪里？

```yaml
pipeline.workers: 2
pipeline.batch.size: 125
pipeline.batch.delay: 50
```

如果要提升到 20000 events/s，你会做哪些调整？为什么？

这个分析需要理解线程模型和批量处理的原理。
