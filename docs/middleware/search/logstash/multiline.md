# Logstash 多行处理：Multiline 与 Codec 编码器

你有没有见过这样的日志？

```
java.lang.NullPointerException
    at com.example.Service.process(Service.java:45)
    at com.example.Controller.handle(Controller.java:123)
    at javax.servlet.http.HttpServlet.service(HttpServlet.java:123)
```

这是一个 Java 异常堆栈，所有内容应该作为**一条日志**处理，而不是被拆成 4 条。

这就是 Logstash 的**多行处理**要解决的问题。

## 1. 为什么需要多行处理？

### 1.1 问题场景

```
单行日志（正常）：
2024-01-15 10:00:00 INFO Application started

多行日志（问题）：
2024-01-15 10:00:00 ERROR Exception occurred
java.lang.NullPointerException
    at com.example.Service.process(Service.java:45)
    at com.example.Controller.handle(Controller.java:123)
```

如果直接处理，多行日志会被拆成多条事件：
- Event 1: `2024-01-15 10:00:00 ERROR Exception occurred`
- Event 2: `java.lang.NullPointerException`
- Event 3: `at com.example...`

这显然不对。

### 1.2 解决方案

Logstash 提供了两种多行处理方式：

1. **Multiline codec**：在 Input 阶段处理
2. **Multiline filter**：在 Filter 阶段处理

## 2. Multiline Codec

### 2.1 基本配置

```java
input {
  file {
    path => "/var/log/application.log"
    codec => multiline {
      # 合并哪些行？
      # pattern：匹配什么内容的行要和上一行合并？
      pattern => "^%{TIMESTAMP_ISO8601}"

      # 匹配后的行为
      # what：previous（与上一行合并）或 next（与下一行合并）
      what => "previous"

      # 多行匹配时使用 negate
      negate => true

      # 超时设置
      max_lines => 500
      max_bytes => "10MB"
    }
  }
}
```

### 2.2 模式解释

```java
pattern => "^%{TIMESTAMP_ISO8601}"
negate => true
what => "previous"
```

这句话的意思是：

```
如果一行不以时间戳开头（negate: true），
就把它和上一行合并（what: previous）。
```

### 2.3 常见模式

**Java 异常堆栈：**

```java
codec => multiline {
  pattern => "^Caused by:|^	at |^java\\.|^javax\\.|^org\\."
  negate => false
  what => "previous"
}
```

**XML 格式：**

```java
codec => multiline {
  pattern => "^<\\?xml"
  negate => true
  what => "previous"
}
```

**Python 错误：**

```java
codec => multiline {
  pattern => "^\\d{4}-\\d{2}-\\d{2}"
  negate => true
  what => "previous"
}
```

## 3. Multiline Filter

### 3.1 基本配置

```java
input {
  file {
    path => "/var/log/application.log"
  }
}

filter {
  multiline {
    # 要合并的行
    pattern => "^%{TIMESTAMP_ISO8601}"

    # 合并方向
    what => "previous"

    # 是否取反
    negate => true

    # 源字段
    source => "message"

    # 超时（超过这个时间没匹配就输出当前行）
    max_age => "10s"

    # 添加标签
    tag_on_failure => ["_multilinefailure"]
  }
}
```

### 3.2 多条件匹配

```java
filter {
  multiline {
    # 匹配多种开始行
    pattern => "(^%{TIMESTAMP_ISO8601}|Exception|^\\tat |Caused by:)"

    negate => false
    what => "previous"
  }
}
```

## 4. 实际案例

### 4.1 Java Stack Trace

```java
# 原始日志
2024-01-15 10:00:00 ERROR com.example.Service - Error occurred
java.lang.NullPointerException: Cannot invoke method on null object
    at com.example.Service.process(Service.java:45)
    at com.example.Controller.handle(Controller.java:123)
Caused by: java.lang.IllegalStateException: Invalid state
    at com.example.Service.init(Service.java:30)
2024-01-15 10:00:01 INFO com.example.Service - Request processed
```

配置：

```java
input {
  file {
    path => "/var/log/application.log"
    codec => multiline {
      pattern => "^%{TIMESTAMP_ISO8601}"
      negate => true
      what => "previous"
      max_lines => 1000
    }
  }
}

filter {
  # 解析第一行
  grok {
    match => {
      "message" => "%{TIMESTAMP_ISO8601:timestamp} %{LOGLEVEL:level} %{JAVACLASS:class} - %{GREEDYDATA:error_message}"
    }
  }

  # 提取异常类型
  grok {
    match => {
      "message" => "^(%{JAVACLASS:class} - )?%{GREEDYDATA:error_message}\n(%{JAVASTACKTRACE:stack_trace})?"
    }
    match => {
      "error_message" => "^(%{JAVACLASS:exception_class}: %{GREEDYDATA:exception_message})?"
    }
  }
}
```

### 4.2 JSON 多行日志

某些 JSON 日志可能被拆成多行：

```json
{
  "timestamp": "2024-01-15T10:00:00Z",
  "level": "ERROR",
  "message": "Error details",
  "stack_trace": "at java.lang.Thread.run"
}
```

处理方式：

```java
# 方式一：将整个 JSON 作为单行处理
input {
  file {
    path => "/var/log/app.log"
    codec => multiline {
      pattern => "^\\{"
      negate => true
      what => "previous"
    }
  }
}

# 方式二：JSON codec（如果 JSON 本身是完整的）
input {
  file {
    path => "/var/log/app.log"
    codec => json {
      charset => "UTF-8"
      skip_on_invalid_json => true
    }
  }
}
```

## 5. Codec 编码器详解

### 5.1 Codec 是什么？

Codec（编码器）负责 Input 和 Output 阶段的数据编解码。

```
Input → Codec（解码）→ Filter → Output → Codec（编码）→ Output
```

### 5.2 常用 Codec

**Plain Codec：**

```java
input {
  stdin {
    codec => plain {
      charset => "UTF-8"
    }
  }
}
```

**JSON Codec：**

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["logs"]

    # 自动解析 JSON
    codec => json {
      charset => "UTF-8"
      skip_on_invalid_json => true
    }
  }
}
```

**Line Codec：**

```java
input {
  file {
    path => "/var/log/app.log"

    # 按行读取
    codec => line {
      format => "%{message}"
      delimiter => "\n"
    }
  }
}
```

### 5.3 多 Codec 组合

```java
# 读取 gzip 压缩的 JSON 文件
input {
  file {
    path => "/var/log/app.json.gz"

    # 先解压，再按行读取，再解析 JSON
    codec => gzip_lines {
      charset => "UTF-8"
    }
  }
}
```

## 6. 常见问题与解决

### 6.1 问题一：多行合并不完整

**现象**：长堆栈被截断

**原因**：`max_lines` 限制太小

**解决**：

```java
codec => multiline {
  pattern => "^%{TIMESTAMP_ISO8601}"
  negate => true
  what => "previous"
  max_lines => 5000    # 增大限制
  max_bytes => "50MB"   # 或增大字节限制
}
```

### 6.2 问题二：事件顺序混乱

**现象**：日志时间顺序不对

**原因**：多行合并影响处理顺序

**解决**：

```java
filter {
  # 合并后再排序
  ruby {
    code => "event.set('@timestamp', event.get('timestamp'))"
  }
}
```

### 6.3 问题三：第一行和第二行顺序问题

**现象**：Java 异常，第一行是空行或次要信息

**原因**：negate 和 what 的配置不对

**解决**：

```java
# Java 堆栈的另一种配置
codec => multiline {
  # 以 at 开头的行和上一行合并
  pattern => "^	at "
  negate => false
  what => "previous"
}
```

## 7. 性能考虑

### 7.1 多行处理的性能影响

```
Multiline 是状态相关的处理，需要等待匹配结果才能输出事件。
这会影响吞吐量。
```

### 7.2 优化建议

```java
# 1. 限制最大行数和字节数
codec => multiline {
  max_lines => 500
  max_bytes => "10MB"
}

# 2. 设置超时，避免无限等待
filter {
  multiline {
    pattern => "^%{TIMESTAMP_ISO8601}"
    negate => true
    what => "previous"
    max_age => "5s"    # 超过 5 秒没匹配就输出
  }
}

# 3. 在 Filebeat 端处理多行（推荐）
# Filebeat 配置多行比 Logstash 效率更高
```

## 8. Filebeat vs Logstash 多行处理

**推荐：在 Filebeat 端处理多行**

Filebeat 端配置：

```java
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/app.log
    multiline:
      pattern: '^%{TIMESTAMP_ISO8601}'
      negate: true
      match: previous
```

优点：
- 减少网络传输（合并后发送）
- 降低 Logstash 负担
- 更快响应文件变化

## 总结

多行处理的关键要点：

1. **Multiline Codec**：在 Input 阶段处理，适合简单的多行场景
2. **Multiline Filter**：在 Filter 阶段处理，更灵活但稍慢
3. **pattern + negate + what**：理解这三个参数是掌握多行处理的关键
4. **性能考虑**：限制 max_lines/max_bytes，设置超时
5. **推荐做法**：尽量在 Filebeat 端处理多行

---

**留给你的问题**：

假设有以下几种日志混在一起：

1. 普通访问日志：`2024-01-15 10:00:00 GET /api/users`
2. Java 异常堆栈
3. JSON 格式日志

你会如何设计多行处理策略？需要注意什么？

这个场景需要组合使用多种多行处理方式。
