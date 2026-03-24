# 全链路压测：流量构造、数据隔离、回放压测

双十一前夜，淘宝的技术团队在做什么？

答案是：**压测**。

但不是普通的压测——是「全链路压测」。他们要在真实流量到来之前，模拟双十一的峰值流量，验证系统能否扛得住。

阿里称之为「不灭的火焰」，京东称之为「脉冲」，核心思想是一样的：**在生产环境，用真实的流量模式，测试系统的极限。**

这篇文章介绍全链路压测的核心技术。

## 普通压测 vs 全链路压测

### 普通压测的局限

传统的压测是这样的：

```
压测机 ──▶ 单独接口
```

- 只测单个接口
- 数据是假的（测试数据）
- 不会影响真实业务
- **无法发现系统间的依赖问题**

想象一下：你的用户服务压测通过了，订单服务也通过了。但用户服务调用订单服务的时候，由于超时重试，订单服务被压垮了——这种事，普通压测根本发现不了。

### 全链路压测的优势

全链路压测是这样的：

```
┌─────────────────────────────────────────────────────────┐
│                    压测流量（隔离）                       │
│                                                         │
│  压测机 ──▶ 网关 ──▶ 用户服务 ──▶ 订单服务 ──▶ 数据库      │
│              │           │           │           │      │
│              ▼           ▼           ▼           ▼      │
│           [影子表]   [影子表]    [影子表]    [影子表]    │
└─────────────────────────────────────────────────────────┘
```

压测流量走完整的链路，**但不污染真实数据**。

## 流量构造

### 流量来源

全链路压测的第一个问题是：**从哪弄来双十一级别的流量？**

常见方案：

1. **历史流量回放**：录下去年双十一的流量，今年重放
2. **流量放大**：用较小的真实流量，通过倍率放大
3. **模拟流量生成器**：JMeter、Gatling、NGrinder

### tcpcopy：流量复制神器

tcpcopy 是由网易工程师开发的流量复制工具，能把生产环境的真实流量复制到测试环境。

```
                ┌─────────┐
   线上流量 ────▶│ tcpcopy │
                └────┬────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
    ┌─────────┐            ┌─────────┐
    │ 线上环境 │            │ 测试环境 │
    └─────────┘            └─────────┘
```

```bash
# 安装 tcpcopy
git clone https://github.com/session-replay-tools/tcpcopy.git
cd tcpcopy
./configure && make && make install

# 启动流量复制
# 将 192.168.1.100:8080 的流量复制到 192.168.2.100:8080
tcpcopy -x 192.168.1.100:8080-192.168.2.100:8080 -n 3

# -n 3 表示放大 3 倍
```

### 流量模型分析

在构造流量之前，必须先分析流量模型：

```
┌─────────────────────────────────────────────────┐
│                 流量模型                          │
│                                                 │
│  峰值 QPS：100,000                               │
│  平均 RT：50ms                                   │
│  P99 RT：200ms                                  │
│  地域分布：北京 30%, 上海 25%, 广州 20%, ...     │
│  终端分布：iOS 55%, Android 40%, Web 5%          │
│  接口分布：商品详情 40%, 搜索 25%, 下单 15%, ... │
│                                                 │
└─────────────────────────────────────────────────┘
```

只有还原真实的流量模型，压测结果才有参考价值。

## 数据隔离

全链路压测最大的挑战是：**压测流量不能影响真实业务数据。**

### 隔离策略对比

| 方案 | 优点 | 缺点 | 适用场景 |
|-----|------|------|---------|
| 独立测试环境 | 完全隔离 | 资源成本高 | 大型互联网公司 |
| 流量染色 | 资源利用率高 | 实现复杂 | 中型公司 |
| 影子表/影子库 | 改造成本低 | 数据膨胀 | 快速落地 |

### 影子库方案

影子库是最流行的压测数据隔离方案。核心思路是：**给压测流量打上标记，所有数据操作都路由到影子库。**

```
┌─────────────────────────────────────────────────┐
│                 请求携带压测标记                  │
│                                                 │
│  Header: X-Trace-Id: abc123                    │
│  Header: X-Is-Test: true                        │
│                                                 │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              数据路由中间件                        │
│                                                 │
│  if (header.isTest()) {                        │
│      dataSource = shadowDataSource;             │
│  } else {                                       │
│      dataSource = realDataSource;               │
│  }                                              │
│                                                 │
└─────────────────────────────────────────────────┘
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
┌─────────────┐            ┌─────────────┐
│   真实库    │            │   影子库    │
│ production │            │ test_shadow │
└─────────────┘            └─────────────┘
```

### 影子库实现

#### 1. 动态数据源切换

```java
public class DynamicDataSource extends AbstractRoutingDataSource {

    private static final ThreadLocal<String> dataSourceKey = ThreadLocal.withInitial(() -> "real");

    @Override
    protected Object determineCurrentLookupKey() {
        return dataSourceKey.get();
    }

    public static void setTestMode(boolean isTest) {
        dataSourceKey.set(isTest ? "shadow" : "real");
    }

    public static void clear() {
        dataSourceKey.remove();
    }
}
```

#### 2. 过滤器拦截请求

```java
@WebFilter(urlPatterns = "/*")
public class TestTrafficFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest httpRequest = (HttpServletRequest) request;

        // 检查是否压测流量
        String isTest = httpRequest.getHeader("X-Is-Test");
        if ("true".equals(isTest)) {
            DynamicDataSource.setTestMode(true);
        }

        try {
            chain.doFilter(request, response);
        } finally {
            DynamicDataSource.clear();
        }
    }
}
```

#### 3. MyBatis 动态 SQL 路由

```java
public class ShadowTableInterceptor implements Interceptor {

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        // 如果是压测流量，修改 SQL 指向影子表
        if (DynamicDataSource.isTestMode()) {
            MappedStatement ms = (MappedStatement) invocation.getArgs()[0];
            SqlSource originalSqlSource = ms.getSqlSource();

            // 将 user 替换为 user_shadow
            SqlSource shadowSqlSource = new ShadowSqlSource(originalSqlSource);

            // 重新构建 MappedStatement
            invocation.getArgs()[0] = new MappedStatement.Builder(ms)
                .sqlSource(shadowSqlSource)
                .build();
        }

        return invocation.proceed();
    }

    private static class ShadowSqlSource implements SqlSource {
        // 实际实现中需要解析原始 SQL，将表名替换为影子表名
        // 这里简化处理
    }
}
```

#### 4. 创建影子表

```sql
-- 生产表
CREATE TABLE order (
    id BIGINT PRIMARY KEY,
    user_id BIGINT,
    amount DECIMAL(10,2),
    created_at TIMESTAMP
);

-- 影子表（压测用）
CREATE TABLE order_shadow (
    id BIGINT PRIMARY KEY,
    user_id BIGINT,
    amount DECIMAL(10,2),
    created_at TIMESTAMP
);

-- 定期清理影子表数据
TRUNCATE TABLE order_shadow;
```

### 其他隔离手段

**影子消息队列：**

```yaml
# Kafka 配置示例
test:
  bootstrap-servers: localhost:9092
  topic:
    order: order_shadow_topic
```

**影子缓存：**

```java
public class ShadowRedisTemplate {

    private final RedisTemplate realTemplate;
    private final RedisTemplate shadowTemplate;

    public void set(String key, Object value) {
        if (DynamicDataSource.isTestMode()) {
            shadowTemplate.opsForValue().set(key, value);
        } else {
            realTemplate.opsForValue().set(key, value);
        }
    }
}
```

## 回放压测

### 流量回放原理

流量回放是把**已经录制的真实流量**重新播放。

```
录制阶段：
  真实流量 ──▶ 流量录制 ──▶ 流量文件

回放阶段：
  流量文件 ──▶ 流量回放 ──▶ 测试环境
```

### goreplay：Go 实现的流量回放

goreplay 是一个高性能的流量录制和回放工具。

```bash
# 安装
go install github.com/buger/goreplay@latest

# 录制流量到文件
goreplay --input-raw :8080 --output-file requests.gor

# 回放流量（可设置倍率）
goreplay --input-file requests.gor --output-http "http://test-server:8080"

# 回放时放大 5 倍流量
goreplay --input-file requests.gor --output-http "http://test-server:8080" --rate 5
```

### 流量录制与回放的注意事项

1. **敏感数据脱敏**：用户密码、身份证号、手机号等必须脱敏
2. **时间戳处理**：录音的请求可能包含时间戳，需要修正
3. **幂等性验证**：回放的请求必须是幂等的，否则会产生副作用
4. **带宽限制**：录制的流量可能超过测试环境的网络带宽

## 压测执行

### 压测步骤

```
1. 准备阶段
   ├── 创建影子库/影子表
   ├── 配置数据路由
   ├── 部署压测节点
   └── 验证隔离效果

2. 预热阶段
   ├── 低流量预热（10% 峰值）
   ├── JVM 预热（JIT 编译）
   └── 缓存预热

3. 压测阶段
   ├── 逐步加压（阶梯式）
   ├── 记录各项指标
   └── 监控异常

4. 收尾阶段
   ├── 记录瓶颈点
   ├── 清理影子数据
   └── 生成压测报告
```

### JMeter 压测脚本示例

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan>
  <hashTree>
    <TestPlan>
      <stringProp name="TestPlan.name">全链路压测脚本</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
    </TestPlan>

    <hashTree>
      <ThreadGroup>
        <stringProp name="ThreadGroup.num_threads">1000</stringProp>
        <stringProp name="ThreadGroup.ramp_time">60</stringProp>
        <stringProp name="ThreadGroup.duration">600</stringProp>
        <stringProp name="ThreadGroup.delay">0</stringProp>
      </ThreadGroup>

      <hashTree>
        <HTTPSamplerProxy>
          <stringProp name="HTTPSampler.domain">api.example.com</stringProp>
          <stringProp name="HTTPSampler.port">443</stringProp>
          <stringProp name="HTTPSampler.path">/order/create</stringProp>
          <stringProp name="HTTPSampler.method">POST</stringProp>
          <boolProp name="HTTPSampler.add_header">true</boolProp>
          <elementProp name="HTTPsampler.Arguments">
            <elementProp name="Header.Authorization">
              <stringProp name="Header.value">Bearer ${token}</stringProp>
            </elementProp>
            <elementProp name="Header.X-Is-Test">
              <stringProp name="Header.value">true</stringProp>
            </elementProp>
          </elementProp>
        </HTTPSamplerProxy>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
```

## 总结

全链路压测是保障系统稳定性的「核武器」：

1. **流量构造**：真实复现业务流量模式
2. **数据隔离**：影子表/影子库避免污染
3. **回放压测**：用历史流量验证系统能力

全链路压测不是银弹，但它是**上线前最后一道防线**。

---

## 思考题

1. 你们的系统做过全链路压测吗？如果没有，最难落地的环节是什么？

2. 影子库方案中，影子表的数据如何清理？每次压测前清空还是保留？

3. 如果压测时发现系统只能承受峰值流量的 60%，你会怎么向领导汇报？优化方案是什么？
