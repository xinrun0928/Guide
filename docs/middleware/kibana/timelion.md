# Kibana Timelion 时序数据分析与趋势预测

Timelion 是 Kibana 内置的时序数据分析工具，它能让你用简单的表达式进行复杂的时间序列分析。

## 1. Timelion 简介

### 1.1 什么是 Timelion？

Timelion 是 Kibana 的时序分析扩展，让你能：

- **合并多个数据源**：在一个图表中展示多个指标
- **执行数学运算**：加减乘除、百分比计算
- **预测趋势**：基于历史数据预测未来
- **对比时间**：与过去同期对比

### 1.2 与普通可视化的区别

| 功能 | 普通可视化 | Timelion |
|-----|----------|----------|
| 多数据源 | 单一索引 | 多索引、多数据源 |
| 数学运算 | 有限 | 丰富 |
| 时间对比 | 困难 | 简单 |
| 自定义计算 | 困难 | 强大 |
| 预测能力 | 无 | 有 |

## 2. Timelion 界面

```
┌─────────────────────────────────────────────────────────────┐
│  Timelion                                                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ .es(index=logs-*).averate(response_time)              │  │
│  │ .es(index=logs-*).sum(status=500).label("Errors")     │  │
│  │                                                         │  │
│  │                                    [Run] [Save]        │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                        │  │
│  │          ~~~~~~~~折线图~~~~~~~~                        │  │
│  │        /                        \                      │  │
│  │       /                          \                     │  │
│  │      /                            \                    │  │
│  │     /                              \                   │  │
│  │    /                                \                  │  │
│  │   /                                  \                 │  │
│  │───────────────────────────────────────────────────────│  │
│  │  1/1     1/8     1/15     1/22     1/29    2/5       │  │
│  │                                                        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 3. 基本语法

### 3.1 数据源函数

```java
// 从 ES 获取数据
.es(index=logs-*, timefield=@timestamp, metric=avg:response_time)
.es(index=logs-*, q='status:500')  // 带查询条件

// 从另一个索引获取数据
.es(index=revenue-*, timefield=date, metric=sum:amount)

// 指定时间范围
.es(index=sales-*, timefield=date, metric=sum:amount, timeformat='YYYY-MM')
```

### 3.2 链式调用

Timelion 使用链式语法，每个函数返回的结果可以继续调用其他函数：

```java
// 基本链式
.es().趋势().label().color()

// 示例
.es(index=logs-*, metric=avg:response_time)
  .趋势()
  .label("Average Response Time")
  .color("#FF0000")
```

### 3.3 常用函数

| 函数 | 说明 | 示例 |
|-----|------|------|
| .es() | 从 ES 获取数据 | .es(index=logs-*) |
| .fit() | 曲线拟合 | .fit(avg) |
| .label() | 添加标签 | .label("My Series") |
| .color() | 设置颜色 | .color("#FF0000") |
| .lines() | 设置线条样式 | .lines(fill=1, width=2) |
| .points() | 设置点样式 | .points() |
| .yaxis() | Y 轴设置 | .yaxis(min=0, max=100) |

## 4. 数学运算

### 4.1 基本运算

```java
// 加法：两个系列相加
.es(index=logs-*, metric=sum:bytes).add(.es(index=logs-*, metric=sum:requests))

// 减法：差值
.es(index=logs-*, metric=sum:income).subtract(.es(index=logs-*, metric=sum:cost))

// 乘法：计算总额
.es(index=orders-*, metric=sum:quantity).multiply(.es(index=orders-*, metric=avg:price))

// 除法：计算平均值
.es(index=logs-*, metric=sum:bytes).divide(.es(index=logs-*, metric=count:status))
```

### 4.2 累计计算

```java
// 累计和
.es(index=logs-*, metric=sum:amount).cusum()

// 移动平均
.es(index=logs-*, metric=avg:response_time).movingaverage(30)
```

### 4.3 高级运算

```java
// 百分比：占总体的百分比
.es(index=logs-*, metric=count, q='status:500')
  .divide(.es(index=logs-*, metric=count))
  .multiply(100)
  .label("Error Rate %")

// 变化率
.es(index=sales-*, metric=sum:revenue).diff()
```

## 5. 时间对比

### 5.1 与过去对比

```java
// 与 7 天前对比
.es(index=logs-*)
  .label("Today")

.es(index=logs-*, offset=-7d)
  .label("7 Days Ago")
```

### 5.2 同比分析

```java
// 与上周同期对比
.es(index=logs-*, metric=avg:response_time)
  .label("Current Week")

.es(index=logs-*, metric=avg:response_time, offset=-1w)
  .label("Last Week")

// 与上月同期对比
.es(index=sales-*, metric=sum:revenue, offset=-1M)
  .label("Last Month")
```

### 5.3 增长率计算

```java
// 计算周环比增长率
.es(index=sales-*, metric=sum:revenue)
  .subtract(.es(index=sales-*, metric=sum:revenue, offset=-7d))
  .divide(.es(index=sales-*, metric=sum:revenue, offset=-7d))
  .multiply(100)
  .label("WoW Growth %")
```

## 6. 多系列绑定

### 6.1 分类绑定

```java
// 按服务分类
.es(index=logs-*, metric=avg:response_time, split=service:5)
  .label("$service")
```

### 6.2 条件绑定

```java
// 成功和失败分开
.es(index=logs-*, q='status:200').label("Success")
.es(index=logs-*, q='status:500').label("Error")
```

## 7. 样式设置

### 7.1 线条样式

```java
.es()
  .lines(fill=1, width=2)      // 填充和宽度
  .color(blue)                 // 颜色
  .hide()                      // 隐藏（用于计算）
```

### 7.2 点样式

```java
.es()
  .points(symbol=circle, radius=3)  // 点符号和大小
```

### 7.3 Y 轴设置

```java
.es()
  .yaxis(min=0, max=100, position=right)  // 最小值、最大值、位置
```

### 7.4 完整示例

```java
// 完整的 Timelion 表达式
.es(index=logs-*, metric=avg:response_time, split=service:3)
  .label(["$service"])
  .color(["#1E90FF", "#FF6347", "#32CD32"])
  .lines(fill=1, width=1)
  .points(symbol=circle, radius=2)
  .yaxis(min=0, position=left)
  .title("Response Time by Service")
```

## 8. 趋势预测

### 8.1 Holt-Winters 预测

```java
// 使用 Holt-Winters 进行预测
.es(index=sales-*, metric=sum:revenue)
  .holt(alpha=0.5, beta=0.2, gamma=0.1, gamma='seasonal', period=7)
  .predict("holt", 30)  // 预测未来 30 天
```

### 8.2 移动平均预测

```java
// 使用移动平均预测
.es(index=logs-*, metric=avg:response_time)
  .movingaverage(7)    // 7 天移动平均
  .predict("movingavg", 14)  // 预测未来 14 天
```

### 8.3 预测参数说明

| 参数 | 说明 | 建议值 |
|-----|------|--------|
| alpha | 水平平滑系数 | 0-1，越大越敏感 |
| beta | 趋势平滑系数 | 0-1 |
| gamma | 季节性平滑系数 | 0-1 |
| period | 季节性周期 | 数据周期 |

## 9. 实用案例

### 9.1 错误率监控

```java
// 错误率
.es(index=logs-*, q='status:500', metric=count)
  .divide(.es(index=logs-*, metric=count))
  .multiply(100)
  .label("Error Rate %")
  .yaxis(min=0, max=100)
  .color(red)
```

### 9.2 性能趋势

```java
// 响应时间趋势
.es(index=logs-*, metric=avg:response_time)
  .label("Average RT")

.es(index=logs-*, metric=p95:response_time)
  .label("P95 RT")

.es(index=logs-*, metric=p99:response_time)
  .label("P99 RT")
```

### 9.3 容量规划

```java
// CPU 使用率趋势
.es(index=metrics-*, metric=avg:cpu_usage)
  .label("CPU %")

// 预测未来趋势
.es(index=metrics-*, metric=avg:cpu_usage)
  .holt(alpha=0.3)
  .predict("holt", 30)
```

## 10. 常见问题

### Q1：Timelion 数据和 Discover 不一致？

**答案**：Timelion 使用的时间范围和 Discover 可能不同。检查 `.es()` 函数中是否指定了正确的时间范围。

### Q2：预测不准确怎么办？

**答案**：调整平滑系数（alpha, beta, gamma）。对于稳定数据，用较小的值；对于波动大的数据，用较大的值。

### Q3：如何保存 Timelion 图表？

**答案**：点击 Save，输入名称和描述。保存后可以在 Dashboard 中添加 Timelion 可视化。

## 总结

Timelion 的核心能力：

1. **链式语法**：用 `.function()` 组合多个操作
2. **数学运算**：加减乘除、累计、变化率
3. **时间对比**：与过去同期对比
4. **趋势预测**：Holt-Winters、移动平均
5. **多系列绑定**：在单一图表中展示多个指标

---

**留给你的问题**：

假设你要分析网站的日活趋势，并预测下周的日活。你会如何使用 Timelion 实现？

需要考虑：
1. 如何获取日活数据？
2. 如何展示历史趋势？
3. 如何添加预测？
4. 如何与上周同期对比？
