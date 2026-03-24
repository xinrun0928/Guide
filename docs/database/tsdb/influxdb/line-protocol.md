# InfluxDB Line Protocol：数据写入的秘密

InfluxDB 的 Line Protocol 看起来简单：

```
cpu,host=server01,region=us-east usage_user=45.2 1709808000000000000
```

但里面藏着很多细节。

今天，我们把 Line Protocol 的每一个部分都讲透。

---

## 完整格式解析

```
measurement,tag1=value1,tag2=value2 field1=value1,field2=value2 timestamp
──────────────────────────────────────────────────────────────────────────────
1           2              3                        4               5
```

| 部分 | 说明 | 示例 |
|-----|------|------|
| 1. measurement | 测量名称 | `cpu` |
| 2. tag set | 标签集（逗号分隔）| `host=server01,region=us-east` |
| 3. field set | 字段集（逗号分隔）| `usage_user=45.2` |
| 4. timestamp | 时间戳（纳秒）| `1709808000000000000` |

---

## 详细语法规则

### 1. Measurement 名称

```
规则：
- 大小写敏感
- 可以包含字母、数字、下划线
- 不能以 _ 开头（保留给系统表）
- 最大长度 64 字符
```

```
# 正确
cpu_monitor
ServerMetrics
system_cpu

# 错误
_cpu_monitor  # 不能以 _ 开头
cpu monitor    # 不能有空格
```

### 2. Tag Key 和 Tag Value

```
规则：
- 大小写敏感
- 可以包含字母、数字、下划线、连字符
- 逗号和空格需要转义
```

```
# 正确
host=server01
region=us-east
service-name=api-gateway

# 错误
host name=server01     # 空格
region,type=us-east    # 逗号未转义
```

### 3. Field Key 和 Field Value

```
规则：
- Field Key 和 Field Value 用 = 连接
- 多个 Field 用逗号分隔
- Value 支持多种类型：整数、浮点、字符串、布尔
```

```java
// 浮点数（默认）
temperature=25.5

// 整数（带 i 后缀）
count=100i

// 字符串（双引号）
message="Hello World"

// 布尔值
is_active=true
is_active=false
```

### 4. Timestamp

```
规则：
- Unix 时间戳
- 支持精度：小时(h)、分钟(m)、秒(s)、毫秒(ms)、微秒(u)、纳秒(ns)
- 省略时默认使用纳秒
```

```
# 完整纳秒时间戳
cpu,host=server01 value=45.2 1709808000000000000

# 毫秒精度（推荐，性能和精度平衡）
cpu,host=server01 value=45.2 1709808000000

# 秒精度
cpu,host=server01 value=45.2 1709808000
```

---

## Java 代码实践

### 基础写入

```java
import org.influxdb.dto.Point;
import org.influxdb.InfluxDB;
import java.util.concurrent.TimeUnit;

public class InfluxDBLineProtocol {
    private final InfluxDB influxDB;

    // 方式一：使用 Point 对象
    public void writeWithPoint() {
        Point point = Point.measurement("cpu")
            .tag("host", "server01")
            .tag("region", "us-east")
            .addField("usage_user", 45.2)
            .addField("usage_system", 12.3)
            .addField("usage_idle", 42.5)
            .time(System.currentTimeMillis(), TimeUnit.MILLISECONDS)
            .build();

        influxDB.write(point);
    }

    // 方式二：直接使用字符串（BatchPoints）
    public void writeWithBatchPoints() {
        BatchPoints batchPoints = BatchPoints
            .database("monitoring")
            .retentionPolicy("30d")
            .build();

        String lineProtocol = "cpu,host=server01,region=us-east " +
            "usage_user=45.2,usage_system=12.3 " +
            System.currentTimeMillis() * 1_000_000;

        batchPoints.lineProtocol(lineProtocol);
        influxDB.write(batchPoints);
    }
}
```

### 批量写入

```java
public class BatchWriteExample {
    public void batchWrite(int batchSize) {
        // 使用 WriteApi 实现批量写入
        WriteOptions writeOptions = WriteOptions.builder()
            .batchSize(batchSize)        // 每批数量
            .flushInterval(1000)        // 刷新间隔（毫秒）
            .bufferLimit(10000)         // 缓冲区上限
            .build();

        // 异步写入，性能更好
        WriteApi writeApi = influxDB.createWriteApi(writeOptions);

        for (int i = 0; i < 100000; i++) {
            Point point = Point.measurement("metrics")
                .tag("host", "server-" + (i % 10))
                .addField("value", Math.random() * 100)
                .time(System.currentTimeMillis(), TimeUnit.MILLISECONDS)
                .build();

            writeApi.writePoint(point);
        }

        // 关闭时刷新缓冲区
        writeApi.close();
    }
}
```

### 异步写入

```java
public class AsyncWriteExample {
    public void asyncWrite(Callback callback) {
        // 使用回调函数
        influxDB.writeAsync(
            Point.measurement("cpu")
                .tag("host", "server01")
                .addField("value", 45.2)
                .time(System.currentTimeMillis(), TimeUnit.MILLISECONDS)
                .build(),
            (exception, point) -> {
                if (exception != null) {
                    callback.onFailure(exception);
                } else {
                    callback.onSuccess();
                }
            }
        );

        // 使用 CompletableFuture
        CompletableFuture&lt;Void&gt; future = influxDB.writeAsync(
            Point.measurement("cpu")
                .tag("host", "server01")
                .addField("value", 45.2)
                .build()
        );
        future.thenRun(() -> System.out.println("Write completed"));
    }
}
```

---

## HTTP API 写入

除了 Java SDK，还可以通过 HTTP API 直接写入：

```bash
# 单条写入
curl -X POST "http://localhost:8086/write?db=monitoring" \
    --data-binary "cpu,host=server01 value=45.2"

# 批量写入（多行）
curl -X POST "http://localhost:8086/write?db=monitoring" \
    --data-binary "
cpu,host=server01 value=45.2
cpu,host=server02 value=50.3
memory,host=server01 used=8192
"
```

### Java HTTP 客户端

```java
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class InfluxDBHttpWrite {
    private final HttpClient httpClient;
    private final String url;

    public InfluxDBHttpWrite(String url) {
        this.httpClient = HttpClient.newHttpClient();
        this.url = url;
    }

    public void write(String database, String lineProtocol) {
        String fullUrl = url + "/write?db=" + database;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(fullUrl))
            .header("Content-Type", "text/plain")
            .POST(HttpRequest.BodyPublishers.ofString(lineProtocol))
            .build();

        try {
            HttpResponse&lt;String&gt; response = httpClient.send(request,
                HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 204) {
                throw new RuntimeException("Write failed: " + response.body());
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

---

## 性能优化技巧

### 1. 批量写入

```java
// 错误：单条写入（性能差）
for (Metric metric : metrics) {
    influxDB.write(toPoint(metric));  // 每条一次网络往返
}

// 正确：批量写入（性能好）
BatchPoints batchPoints = BatchPoints.database("monitoring").build();
for (Metric metric : metrics) {
    batchPoints.add(toPoint(metric));
}
influxDB.write(batchPoints);  // 一次网络往返
```

### 2. 合理选择时间精度

```java
// 纳秒精度（存储开销大）
point.time(System.currentTimeMillis() * 1_000_000, TimeUnit.NANOSECONDS);

// 毫秒精度（推荐）
point.time(System.currentTimeMillis(), TimeUnit.MILLISECONDS);

// 秒精度（性能最好，但精度损失）
point.time(System.currentTimeMillis() / 1000, TimeUnit.SECONDS);
```

### 3. 控制 Tag 数量

```java
// 错误：太多 Tag
Point.measurement("metric")
    .tag("host", "server01")
    .tag("region", "us-east")
    .tag("zone", "zone-a")
    .tag("role", "web")
    .tag("env", "prod")
    .tag("version", "v1.2.3")  // 太多唯一值
    .addField("value", 45.2)
    .build();

// 正确：精简 Tag
Point.measurement("metric")
    .tag("host", "server01")
    .tag("role", "web")
    .addField("value", 45.2)
    .build();
```

---

## 面试追问方向

- Line Protocol 和普通 SQL INSERT 有什么区别？
- 如何处理写入高峰？（提示：背压控制）

下一节，我们来了解 InfluxDB 的连续查询。
