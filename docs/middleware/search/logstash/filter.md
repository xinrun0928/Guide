# Logstash Filter 插件：Grok 正则解析、JSON 解析、Date 日期转换、Mutate 数据转换

如果说 Input 是数据的「入口」，那 Filter 就是数据的「加工车间」。Filter 插件负责解析、转换、过滤、富化数据，让原始日志变成结构化的数据。

## 1. Filter 概述

Filter 插件在 Input 和 Output 之间执行，可以：

- **解析**：将非结构化日志解析为结构化字段
- **转换**：修改变量类型、添加/删除字段
- **过滤**：根据条件决定是否保留事件
- **富化**：添加地理位置、用户代理等信息

## 2. Grok 插件：正则解析

Grok 是 Logstash 最强大的插件，用于解析非结构化日志。

### 2.1 基本原理

Grok 的核心是**用正则表达式匹配文本**，但它把复杂的正则封装成了**模式（Pattern）**，让你可以用简短的模式名匹配复杂的文本结构。

```
原始文本：
55.3.244.1 GET /index.html 15824 0.043

Grok 解析后：
{
  "client_ip": "55.3.244.1",
  "method": "GET",
  "request": "/index.html",
  "bytes": "15824",
  "duration": "0.043"
}
```

### 2.2 内置模式

Grok 提供了大量内置模式：

```java
# 常用模式对照表

# 网络相关
IP           - IP 地址                          192.168.1.1
HOSTNAME     - 主机名                           localhost
USERNAME     - 用户名                            john

# HTTP 相关
HTTPD_COMMONLOG   - Apache 普通日志格式
HTTPD_ERRORLOG     - Apache 错误日志格式
COMBINEDAPACHELOG  - Apache 组合日志格式（包含 referer 和 user-agent）

# 时间相关
TIMESTAMP_ISO8601  - ISO8601 时间戳
HTTPDATE           - HTTP 日期格式                15/Jan/2024:10:00:00 +0000

# 数字
NUMBER      - 数字                              12345
INT         - 整数                              12345
BASE10NUM   - 十进制数字                        123.45

# 路径和 URI
PATH        - 文件路径                          /var/log/app.log
URIPATHPARAM - URI 路径和参数                   /api/users?id=123
URI         - 完整 URI                          http://example.com/api

# 通用
WORD        - 单词                              hello
SPACE       - 空白字符
QUOTEDSTRING - 引号字符串                       "hello world"
GREEDYDATA  - 贪婪匹配（尽量多匹配）            anything here
```

### 2.3 实际使用

```java
filter {
  grok {
    # 方式一：直接写匹配规则
    match => {
      "message" => "%{IP:client_ip} %{USER:ident} %{USER:auth} \[%{HTTPDATE:timestamp}\] \"%{WORD:method} %{URIPATHPARAM:request} HTTP/%{NUMBER:http_version}\" %{NUMBER:status:int} %{NUMBER:bytes:int}"
    }

    # 方式二：使用 named_captures_only（只保留命名的捕获组）
    named_captures_only => true

    # 方式三：多个 match（按顺序尝试）
    match => {
      "message" => [
        "%{COMBINEDAPACHELOG}",
        "%{HTTPD_COMMONLOG}",
        "%{GREEDYDATA:raw_message}"
      ]
    }

    # tag_on_failure：匹配失败时添加的标签
    tag_on_failure => ["_grokparsefailure"]

    # overwrite：覆盖已存在的字段
    overwrite => ["message"]
  }
}
```

### 2.4 自定义模式

创建自定义模式文件：

```java
# patterns/myapp

# 自定义整数
MYINT \d+

# 自定义日志级别
LOGLEVEL [DEBUG|INFO|WARN|ERROR|FATAL]

# 自定义时间戳
MY_TIMESTAMP %{YEAR}-%{MONTHNUM}-%{MONTHDAY} %{TIME}
```

使用自定义模式：

```java
filter {
  grok {
    patterns_dir => ["./patterns"]
    match => { "message" => "%{MY_TIMESTAMP:timestamp} %{LOGLEVEL:level} %{MYINT:duration}" }
  }
}
```

### 2.5 常见日志格式解析

**Nginx 访问日志：**

```java
# 格式：
# 192.168.1.1 - - [15/Jan/2024:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 15824 "-" "Mozilla/5.0..."

filter {
  grok {
    match => {
      "message" => '%{IP:client_ip} %{USER:ident} %{USER:auth} \[%{HTTPDATE:timestamp}\] "%{WORD:method} %{URIPATHPARAM:request} HTTP/%{NUMBER:http_version}" %{NUMBER:status:int} %{NUMBER:bytes:int}'
    }
  }
}
```

**Java 日志：**

```java
# 格式：
# 2024-01-15 10:00:00 INFO [pool-1-thread-5] com.example.Service - Processing request

filter {
  grok {
    patterns_dir => ["./patterns"]
    match => {
      "message" => '%{TIMESTAMP_ISO8601:timestamp} %{LOGLEVEL:level} \[%{DATA:thread}\] %{JAVACLASS:class} - %{GREEDYDATA:log_message}'
    }
  }
}
```

**自定义模式文件：**

```java
# patterns/java
JAVACLASS [a-zA-Z0-9.]+
```

## 3. JSON 插件：JSON 解析

### 3.1 基本使用

```java
filter {
  # 解析 JSON 字符串
  json {
    source => "message"
    target => "parsed"          # 解析结果存放位置，不指定则覆盖原字段
  }
}
```

**输入：**

```json
{"name": "John", "age": 30, "city": "Beijing"}
```

**输出：**

```java
{
  "name": "John",
  "age": 30,
  "city": "Beijing",
  "parsed": {
    "name": "John",
    "age": 30,
    "city": "Beijing"
  }
}
```

### 3.2 跳过无效 JSON

```java
filter {
  json {
    source => "message"
    target => "parsed"
    skip_on_invalid_json => true    # 无效 JSON 不报错，跳过此插件
  }
}
```

### 3.3 处理嵌套 JSON

```java
filter {
  json {
    source => "message"
  }

  # 提取嵌套字段
  mutate {
    add_field => {
      "user_id" => "%{[parsed][user][id]}"
      "user_name" => "%{[parsed][user][name]}"
    }
  }
}
```

## 4. Date 插件：时间解析

### 4.1 基本使用

Date 插件用于解析日志中的时间字符串，替换 `@timestamp`。

```java
filter {
  date {
    # 从哪些字段中解析时间
    match => ["timestamp", "time", "@timestamp"]

    # 时间格式（多个格式按顺序匹配）
    match => [
      "yyyy-MM-dd HH:mm:ss",
      "dd/MMM/yyyy:HH:mm:ss Z",
      "ISO8601"
    ]

    # 目标字段（默认替换 @timestamp）
    target => "@timestamp"

    # 时区
    timezone => "Asia/Shanghai"
  }
}
```

### 4.2 常见时间格式

```java
filter {
  date {
    match => ["timestamp"]
    match => [
      # 标准格式
      "ISO8601",                              # 2024-01-15T10:00:00Z
      "yyyy-MM-dd'T'HH:mm:ss.SSSZ",          # 2024-01-15T10:00:00.000+0800

      # Apache/Nginx 日志格式
      "dd/MMM/yyyy:HH:mm:ss Z",              # 15/Jan/2024:10:00:00 +0000

      # Unix 时间戳
      "UNIX",                                 # 1705312800
      "UNIX_MS"                               # 1705312800000

      # 自定义格式
      "yyyy-MM-dd HH:mm:ss"
    ]
  }
}
```

### 4.3 常见错误

```java
# 错误：时区不一致
# 日志时间是 UTC，但设置了 Asia/Shanghai
match => ["timestamp"]
timezone => "Asia/Shanghai"

# 解决：使用正确的时区
timezone => "UTC"

# 或者从日志中解析时区
match => ["timestamp", "yyyy-MM-dd HH:mm:ss Z"]
```

## 5. Mutate 插件：数据转换

Mutate 是最常用的 Filter 插件之一，用于各种数据转换操作。

### 5.1 类型转换

```java
filter {
  mutate {
    # 转换字段类型
    convert => {
      "status" => "integer"       # integer, float, string, boolean
      "bytes" => "integer"
      "duration" => "float"
      "is_active" => "boolean"
    }
  }
}
```

### 5.2 重命名字段

```java
filter {
  mutate {
    # 重命名字段
    rename => {
      "HTTP_STATUS" => "status"
      "client_ip_address" => "client_ip"
      "request_time_ms" => "duration"
    }
  }
}
```

### 5.3 添加/更新字段

```java
filter {
  mutate {
    # 添加字段
    add_field => {
      "environment" => "production"
      "version" => "1.0.0"
      "[@metadata][index_prefix]" => "app"
    }

    # 更新字段（覆盖）
    update => {
      "status" => "200"
      "message" => "Updated message"
    }

    # 替换字段（支持变量）
    replace => {
      "message" => "User %{user_id} logged in from %{client_ip}"
    }
  }
}
```

### 5.4 移除字段

```java
filter {
  mutate {
    # 移除字段
    remove_field => ["message", "raw_message", "temp_field"]

    # 移除标签
    remove_tag => ["debug", "temporary"]
  }
}
```

### 5.5 分割字段

```java
filter {
  mutate {
    # 按分隔符分割
    split => {
      "client_ips" => ","           # "192.168.1.1,192.168.1.2" → ["192.168.1.1", "192.168.1.2"]
      "tags" => "|"                 # "java|backend|mysql" → ["java", "backend", "mysql"]
    }

    # 合并字段（join）
    join => {
      "ip_parts" => "."             # ["192", "168", "1", "1"] → "192.168.1.1"
    }
  }
}
```

### 5.6 大小写转换

```java
filter {
  mutate {
    lowercase => ["user_agent", "referer"]
    uppercase => ["status_code"]
  }
}
```

## 6. 条件判断

### 6.1 基本语法

```java
filter {
  # if-else 语法
  if [status] >= 500 {
    mutate {
      add_tag => ["error"]
      add_field => { "alert_level" => "high" }
    }
  } else if [status] >= 400 {
    mutate {
      add_tag => ["warning"]
      add_field => { "alert_level" => "medium" }
    }
  } else {
    mutate {
      add_tag => ["normal"]
      add_field => { "alert_level" => "low" }
    }
  }
}
```

### 6.2 比较运算符

```java
# 数值比较
if [bytes] > 1000000 { ... }    # 大于
if [status] >= 200 and [status] < 300 { ... }

# 字符串比较
if [method] == "POST" { ... }
if [status] != "200" { ... }

# 正则匹配
if [request] =~ /\/api\/v[0-9]+/ { ... }
if [user_agent] !~ /bot/i { ... }

# 字段存在性
if [field] { ... }              # 字段存在且非空
if ![field] { ... }             # 字段不存在或为空
if [field] == "" { ... }        # 字段为空字符串

# 多条件组合
if [type] == "nginx" and [status] >= 500 {
  ...
}

# 包含判断
if "error" in [tags] { ... }
```

### 6.3 实战示例

```java
filter {
  # 根据日志类型分别处理
  if [type] == "nginx" {
    grok {
      match => { "message" => "%{COMBINEDAPACHELOG}" }
    }
    date {
      match => [ "timestamp", "dd/MMM/yyyy:HH:mm:ss Z" ]
      target => "@timestamp"
    }
  } else if [type] == "application" {
    grok {
      match => { "message" => "%{APP_LOG_PATTERN}" }
    }
    json {
      source => "extra_data"
    }
  }

  # 错误日志添加告警标签
  if [level] == "ERROR" or [level] == "FATAL" {
    mutate {
      add_tag => ["alert"]
    }
  }

  # 慢请求记录
  if [duration] and [duration] > 1000 {
    mutate {
      add_tag => ["slow_request"]
    }
  }
}
```

## 7. 其他常用 Filter

### 7.1 GeoIP 插件：IP 地理位置

```java
filter {
  geoip {
    source => "client_ip"
    target => "geoip"

    # 不在数据库中的字段不添加
    add_tag => ["geoip"]

    # 使用城市数据库
    # database => "/etc/logstash/GeoLite2-City.mmdb"
  }
}
```

### 7.2 Useragent 插件：浏览器识别

```java
filter {
  useragent {
    source => "user_agent"
    target => "ua"
  }
}
```

### 7.3 Fingerprint 插件：数据指纹

```java
filter {
  fingerprint {
    source => ["client_ip", "timestamp", "request"]
    target => "fingerprint"
    method => "MD5"
    key => "secret"
  }
}
```

### 7.4 Dissect 插件：结构化解析

类似 Grok，但更适合固定分隔符的格式：

```java
filter {
  dissect {
    mapping => {
      "message" => "%{timestamp} %{+timestamp} %{level} %{+level} %{message}"
    }
  }
}
```

## 8. Filter 组合实战

```java
# 一个完整的 Filter 配置示例
filter {
  # 解析日志格式
  grok {
    match => { "message" => "%{COMBINEDAPACHELOG}" }
    tag_on_failure => ["_grokparsefailure"]
  }

  # 解析时间
  date {
    match => ["timestamp", "dd/MMM/yyyy:HH:mm:ss Z"]
    target => "@timestamp"
  }

  # IP 地理位置
  geoip {
    source => "client_ip"
    target => "geoip"
  }

  # 浏览器识别
  useragent {
    source => "agent"
    target => "ua"
  }

  # 类型转换
  mutate {
    convert => {
      "status" => "integer"
      "bytes" => "integer"
    }
  }

  # 条件处理
  if [status] >= 500 {
    mutate {
      add_tag => ["error"]
    }
  }

  # 移除不需要的字段
  mutate {
    remove_field => ["message", "agent"]
  }
}
```

## 总结

Filter 插件的核心用法：

1. **Grok**：解析非结构化日志为结构化字段
2. **JSON**：解析 JSON 格式数据
3. **Date**：解析时间字符串
4. **Mutate**：字段的重命名、转换、增删
5. **GeoIP**：IP 地址转换为地理位置
6. **条件判断**：根据条件执行不同的处理逻辑

Filter 是 Logstash 的精髓，掌握这些插件能让你处理各种复杂的数据场景。

---

**留给你的问题**：

假设有以下日志格式，需要提取所有字段：

```
2024-01-15 10:30:45.123 INFO [pool-2-thread-1] com.example.UserService - User login: userId=12345, ip=192.168.1.100, duration=125ms
```

你会如何编写 Filter 配置？需要注意哪些细节？

这个配置会用到 grok、date、mutate 等多个插件。
