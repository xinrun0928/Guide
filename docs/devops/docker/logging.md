# Docker 日志驱动与日志管理

应用在容器里跑起来了，但日志去哪了？

容器化环境下，日志管理是个容易被忽视但又极其重要的问题。容器无状态，意味着日志必须外写到容器外，否则容器一删，日志就没了。

这篇文章，聊聊 Docker 的日志机制和日志管理最佳实践。

## Docker 日志驱动

Docker 使用日志驱动（Logging Driver）来收集容器日志。默认是 `json-file` 驱动。

### 查看当前日志驱动

```bash
# 查看默认日志驱动
docker info | grep "Logging Driver"

# 查看容器使用的日志驱动
docker inspect -f '&#123;&#123;.HostConfig.LogConfig.Type&#125;&#125;' container_name
```

### 常用日志驱动

| 驱动 | 说明 | 适用场景 |
|------|------|---------|
| `json-file` | JSON 格式写入文件（默认） | 开发/测试 |
| `syslog` | 写入 syslog | 系统日志集成 |
| `journald` | 写入 systemd journal | systemd 环境 |
| `gelf` | Graylog Extended Log Format | ELK 集成 |
| `fluentd` | Fluentd 日志收集 | EFK 架构 |
| `awslogs` | CloudWatch Logs | AWS 环境 |
| `gcplogs` | Google Cloud Logging | GCP 环境 |
| `splunk` | Splunk | 企业日志分析 |
| `none` | 禁用日志 | 不需要日志的场景 |

### 配置默认日志驱动

```bash
# 编辑 Docker 配置
sudo vim /etc/docker/daemon.json

{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3",
    "compress": "true"
  }
}

# 重启 Docker
sudo systemctl restart docker
```

## json-file 驱动

json-file 是 Docker 默认的日志驱动，将容器日志以 JSON 格式写入文件。

### 日志文件位置

```bash
# 日志文件位置
/var/lib/docker/containers/<container-id>/<container-id>-json.log

# 查看日志文件
sudo ls -la /var/lib/docker/containers/<container-id>/
```

### 日志轮转配置

```bash
# 限制单个日志文件最大 10MB
# 最多保留 3 个日志文件
# 超过后自动压缩旧文件
docker run -d \
    --log-driver=json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    --log-opt compress=true \
    --name myapp \
    nginx:alpine
```

### docker-compose 配置

```yaml
version: '3.8'

services:
  myapp:
    image: myapp:latest
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
        compress: "true"
```

### 日志空间计算

```
配置：max-size=10m, max-file=3

单个容器最大日志空间：10MB × 3 = 30MB

注意：如果单个日志行超过 max-size，会创建新文件
      实际空间可能略大于 30MB
```

## 查看容器日志

### 基本操作

```bash
# 查看日志（最后 100 行）
docker logs --tail 100 myapp

# 实时查看日志
docker logs -f myapp

# 查看最近 1 小时的日志
docker logs --since 1h myapp

# 查看指定时间之后的日志
docker logs --since "2024-01-01T10:00:00" myapp

# 显示时间戳
docker logs -t myapp

# 显示 STDERR 和 STDOUT
docker logs myapp 2>&1
```

### 日志格式

```bash
# 查看原始日志内容
sudo cat /var/lib/docker/containers/<container-id>/<container-id>-json.log

# 每行是一个 JSON 对象
{"log":"2024-01-01 10:00:00 INFO Application started\n","stream":"stdout","time":"2024-01-01T10:00:00.000000000Z"}
{"log":"2024-01-01 10:00:01 ERROR Connection failed\n","stream":"stderr","time":"2024-01-01T10:00:01.000000000Z"}
```

### 统计日志行数

```bash
# 统计日志行数
sudo wc -l /var/lib/docker/containers/<container-id>/<container-id>-json.log

# 统计日志大小
sudo du -h /var/lib/docker/containers/<container-id>/<container-id>-json.log*
```

## syslog 驱动

syslog 驱动将容器日志发送到 syslog 服务。

### 配置

```bash
# 启动带有 syslog 服务的容器
docker run -d \
    --log-driver=syslog \
    --log-opt syslog-address=tcp://localhost:514 \
    --log-opt syslog-facility=daemon \
    --name myapp \
    nginx:alpine

# 本地 syslog 地址
docker run -d \
    --log-driver=syslog \
    --log-opt syslog-address=unix:///dev/log \
    --name myapp \
    nginx:alpine
```

### syslog 选项

| 选项 | 说明 | 示例 |
|------|------|------|
| `syslog-address` | syslog 服务地址 | `tcp://localhost:514` |
| `syslog-facility` | 日志设施 | `daemon`, `user`, `local0-7` |
| `syslog-tag` | 日志标签 | `myapp` |
| `syslog-format` | 日志格式 | `rfc3164`, `rfc5424` |

## journald 驱动

journald 驱动将日志发送到 systemd journal。

### 配置

```bash
# 启用 journald 驱动
docker run -d \
    --log-driver=journald \
    --name myapp \
    nginx:alpine

# 查看 journal 日志
journalctl CONTAINER_NAME=myapp

# 按时间过滤
journalctl --since "1 hour ago" CONTAINER_NAME=myapp

# 实时查看
journalctl -f CONTAINER_NAME=myapp
```

## GELF 驱动（Graylog）

GELF 驱动将日志发送到 Graylog 或兼容的日志系统（如 ELK）。

### 配置

```bash
docker run -d \
    --log-driver=gelf \
    --log-opt gelf-address=udp://graylog:12201 \
    --log-opt gelf-compression-type=gzip \
    --log-opt tag="&#123;&#123;.Name&#125;&#125;/&#123;&#123;.ID&#125;&#125;" \
    --name myapp \
    nginx:alpine
```

### GELF 选项

| 选项 | 说明 | 示例 |
|------|------|------|
| `gelf-address` | Graylog 地址 | `udp://graylog:12201` |
| `gelf-compression-type` | 压缩类型 | `gzip`, `none` |
| `gelf-compression-level` | 压缩级别 | `1-9` |
| `tag` | 日志标签模板 | `&#123;&#123;.Name&#125;&#125;/&#123;&#123;.ID&#125;&#125;` |

## Fluentd 驱动

Fluentd 驱动将日志发送到 Fluentd。

### 配置

```bash
docker run -d \
    --log-driver=fluentd \
    --log-opt fluentd-address=fluentd:24224 \
    --log-opt fluentd-async-connect=true \
    --log-opt tag=myapp \
    --name myapp \
    nginx:alpine
```

### fluentd source 配置

```text
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<filter myapp>
  @type parser
  @type json
  key_name log
  time_key time
  time_type string
  time_format %Y-%m-%dT%H:%M:%S.%L%z
</filter>

<match myapp>
  @type elasticsearch
  host elasticsearch
  port 9200
  logstash_format true
  logstash_prefix myapp
</match>
```

## 结构化日志

### 应用日志结构化

```java
// Java 应用输出 JSON 格式日志
private static final Logger logger = LoggerFactory.getLogger(MyApp.class);

public void processRequest(Request request) {
    MDC.put("requestId", request.getId());
    MDC.put("userId", request.getUserId());
    
    logger.info("Processing request: type={}, path={}", 
        request.getType(), 
        request.getPath());
    
    try {
        // 处理逻辑
        logger.info("Request processed successfully");
    } catch (Exception e) {
        logger.error("Request failed: error={}", e.getMessage(), e);
        throw e;
    } finally {
        MDC.clear();
    }
}
```

### Fluentd 解析 JSON 日志

```text
<filter docker.**>
  @type parser
  key_name log
  @type json
</filter>
```

## 日志管理最佳实践

### 1. 设置日志轮转

```bash
# 始终配置日志轮转，避免磁盘空间耗尽
docker run -d \
    --log-driver=json-file \
    --log-opt max-size=10m \
    --log-opt max-file=5 \
    --name myapp \
    myapp:latest
```

### 2. 统一日志收集

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    image: myapp:latest
    logging:
      driver: fluentd
      options:
        fluentd-address: fluentd:24224
        tag: myapp

  fluentd:
    image: fluent/fluentd:v1.16
    ports:
      - "24224:24224"
      - "24224:24224/udp"
    volumes:
      - ./fluent.conf:/etc/fluent/fluent.conf
    environment:
      - FLUENTD_CONF=fluent.conf

  elasticsearch:
    image: elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
    volumes:
      - es-data:/usr/share/elasticsearch/data

  kibana:
    image: kibana:8.11.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

volumes:
  es-data:
```

### 3. 应用最佳实践

```java
// 推荐：结构化日志
private static final Logger logger = LoggerFactory.getLogger(MyApp.class);

// 好的日志实践
logger.info("Request processed: requestId={}, duration={}ms, status={}",
    requestId, duration, status);

// 避免：字符串拼接
logger.info("Request processed: " + requestId + " " + duration); // ❌

// 错误日志要包含堆栈
logger.error("Database error", e); // ✅
logger.error("Database error: " + e.getMessage()); // ❌
```

### 4. 日志级别管理

```bash
# 生产环境降低日志级别
docker run -d \
    --env LOG_LEVEL=info \
    --name myapp \
    myapp:latest

# 应用读取环境变量设置日志级别
if (System.getenv("LOG_LEVEL").equals("debug")) {
    logger.setLevel(Level.DEBUG);
}
```

## 清理日志

```bash
# 清理所有未使用的日志
docker system prune --volumes

# 查看 Docker 占用的磁盘空间
docker system df

# 详细查看
docker system df -v

# 手动清理特定容器的日志
sudo truncate -s 0 /var/lib/docker/containers/<container-id>/<container-id>-json.log
```

## 面试追问

1. **Docker 默认的日志驱动是什么？日志文件存在哪里？**
2. **如何防止日志文件无限增长撑满磁盘？**
3. **json-file 和 syslog 驱动的区别是什么？各自适合什么场景？**
4. **容器日志和宿主机日志的关系是什么？**
5. **如何实现容器日志的集中收集？有哪些方案？**

> "日志是生产环境排查问题的第一手资料。好的日志管理，不只是收集和存储，更重要的是：日志格式要统一、日志级别要合理、日志内容要有用。记一堆垃圾日志，等于没记。"
