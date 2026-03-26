# Elasticsearch 聚合分析：Bucketing、Metric、Pipeline

如果搜索引擎只能「搜」，那它只是一个高级的字典。但 ES 远不止于此——它还是一个强大的**分析引擎**。

聚合分析能让你从数据中发现规律、趋势和洞察。

## 1. 聚合的三种类型

```
Aggregations
    │
    ├── Bucketing（桶聚合）
    │       ├── 按条件分组，每组一个桶
    │       └── 示例：按 category 分组、按时间分桶
    │
    ├── Metric（指标聚合）
    │       ├── 计算单一指标：sum、avg、min、max
    │       └── 示例：计算平均价格、总销售额
    │
    └── Pipeline（管道聚合）
            ├── 对聚合结果再聚合
            └── 示例：计算每月的环比增长率
```

## 2. Metric 聚合（指标聚合）

Metric 聚合计算单一指标值。

### 2.1 单值聚合

```java
// 查询平均价格
GET products/_search
{
  "aggs": {
    "avg_price": {
      "avg": { "field": "price" }
    }
  }
}

// 等同于 SQL：
// SELECT AVG(price) FROM products
```

| 聚合类型 | 说明 | 示例 |
|---------|------|------|
| avg | 平均值 | 计算平均价格 |
| sum | 总和 | 计算总销售额 |
| min | 最小值 | 最低价格 |
| max | 最大值 | 最高价格 |
| value_count | 数量 | 统计文档数 |
| cardinality | 去重数量 | 独立用户数 |
| stats | 统计汇总 | 一次返回 count/sum/avg/min/max |
| extended_stats | 扩展统计 | 加上 variance/std_deviation/sum_of_squares |

```java
// extended_stats：返回详细统计
GET products/_search
{
  "aggs": {
    "price_stats": {
      "extended_stats": { "field": "price" }
    }
  }
}

// 返回结果
{
  "aggregations": {
    "price_stats": {
      "count": 100,
      "min": 9.99,
      "max": 999.99,
      "avg": 156.75,
      "sum": 15675.00,
      "variance": 12345.67,
      "std_deviation": 111.11,
      "sum_of_squares": 3456789.00
    }
  }
}
```

### 2.2 多值聚合

```java
// percentile：百分位数
GET products/_search
{
  "aggs": {
    "price_percentiles": {
      "percentiles": {
        "field": "price",
        "percents": [25, 50, 75, 90, 95, 99]
      }
    }
  }
}

// percentile_ranks：查看某个值属于哪个百分位
GET products/_search
{
  "aggs": {
    "price_rank": {
      "percentile_ranks": {
        "field": "price",
        "values": [50, 100, 200]
      }
    }
  }
}

// 返回：50 元在 25%，100 元在 50%，200 元在 80%
```

## 3. Bucketing 聚合（桶聚合）

Bucketing 按条件将文档分组，每组一个「桶」。

### 3.1 terms 聚合

按字段值分桶。

```java
// 按 category 分桶
GET products/_search
{
  "aggs": {
    "categories": {
      "terms": {
        "field": "category",
        "size": 10    // 返回前 10 个桶
      }
    }
  }
}

// 返回结果
{
  "aggregations": {
    "categories": {
      "buckets": [
        { "key": "electronics", "doc_count": 150 },
        { "key": "clothing", "doc_count": 120 },
        { "key": "books", "doc_count": 85 }
      ]
    }
  }
}
```

### 3.2 range 聚合

按数值范围分桶。

```java
// 按价格区间分桶
GET products/_search
{
  "aggs": {
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "from": 0, "to": 50, "key": "0-50" },
          { "from": 50, "to": 100, "key": "50-100" },
          { "from": 100, "to": 500, "key": "100-500" },
          { "from": 500, "key": "500+" }
        ]
      }
    }
  }
}
```

### 3.3 date_histogram 聚合

按时间分桶，常用于时序数据分析。

```java
// 按天统计销量
GET sales/_search
{
  "aggs": {
    "sales_over_time": {
      "date_histogram": {
        "field": "order_date",
        "calendar_interval": "day",
        "format": "yyyy-MM-dd",
        "min_doc_count": 0,
        "extended_bounds": {
          "min": "2024-01-01",
          "max": "2024-01-31"
        }
      }
    }
  }
}

// 支持的时间间隔：
// minute, hour, day, week, month, quarter, year
```

### 3.4 嵌套聚合

```java
// 先按 category 分桶，每个桶内再按 brand 分桶
GET products/_search
{
  "aggs": {
    "by_category": {
      "terms": { "field": "category" },
      "aggs": {
        "by_brand": {
          "terms": { "field": "brand", "size": 5 }
        }
      }
    }
  }
}
```

### 3.5 常用桶聚合

| 聚合类型 | 说明 | 示例 |
|---------|------|------|
| terms | 按字段值分桶 | 按分类统计 |
| range | 按数值范围分桶 | 按价格区间统计 |
| date_range | 按日期范围分桶 | 按时间段统计 |
| date_histogram | 按日期直方图分桶 | 按天/周/月统计 |
| histogram | 按数值直方图分桶 | 按固定间隔分桶 |
| filter | 过滤后分桶 | 符合条件的文档 |
| filters | 多过滤器分桶 | 多个条件分别统计 |

## 4. 组合查询与聚合

### 4.1 先过滤再聚合

```java
// 只统计 2024 年的电子产品平均价格
GET products/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "category": "electronics" } },
        { "range": { "publish_date": { "gte": "2024-01-01" } } }
      ]
    }
  },
  "aggs": {
    "avg_price": {
      "avg": { "field": "price" }
    }
  }
}
```

### 4.2 global + post_filter

```java
// 搜索结果和聚合结果分开
GET products/_search
{
  "query": {
    "match": { "name": "laptop" }
  },
  "aggs": {
    "all_products": {    // 不受 query 影响
      "global": {},
      "aggs": {
        "avg_price": {
          "avg": { "field": "price" }
        }
      }
    },
    "filtered_avg": {    // 受 query 影响
      "avg": { "field": "price" }
    }
  }
}
```

## 5. Pipeline 聚合（管道聚合）

Pipeline 聚合对其他聚合的结果进行二次计算。

### 5.1 常用管道聚合

| 类型 | 说明 |
|-----|------|
| cumulative_sum | 累计求和 |
| cumulative_cardinality | 累计去重计数 |
| moving_avg | 移动平均值 |
| moving_fn | 移动窗口函数 |
| derivative | 导数/变化率 |
| percentiles_bucket | 桶的百分位数 |
| bucket_sort | 对桶排序 |
| bucket_selector | 过滤桶 |
| bucket_script | 桶间计算 |

### 5.2 cumulative_sum：累计求和

```java
// 计算每日销售额的累计值
GET sales/_search
{
  "aggs": {
    "sales_over_time": {
      "date_histogram": {
        "field": "order_date",
        "calendar_interval": "day"
      },
      "aggs": {
        "daily_sales": {
          "sum": { "field": "amount" }
        },
        "cumulative_sales": {
          "cumulative_sum": {
            "buckets_path": "daily_sales"
          }
        }
      }
    }
  }
}
```

### 5.3 derivative：变化率

```java
// 计算日环比增长率
GET sales/_search
{
  "aggs": {
    "sales_over_time": {
      "date_histogram": {
        "field": "order_date",
        "calendar_interval": "day"
      },
      "aggs": {
        "daily_sales": {
          "sum": { "field": "amount" }
        },
        "sales_derivative": {
          "derivative": {
            "buckets_path": "daily_sales"
          }
        }
      }
    }
  }
}
```

### 5.4 moving_avg：移动平均

```java
// 计算 7 天移动平均销售额
GET sales/_search
{
  "aggs": {
    "sales_over_time": {
      "date_histogram": {
        "field": "order_date",
        "calendar_interval": "day"
      },
      "aggs": {
        "daily_sales": {
          "sum": { "field": "amount" }
        },
        "moving_avg_sales": {
          "moving_avg": {
            "buckets_path": "daily_sales",
            "window": 7,
            "model": "simple"    // 简单移动平均
          }
        }
      }
    }
  }
}

// 支持的模型：
// simple：简单移动平均
// linear：线性加权移动平均
// ewma：指数加权移动平均
// holt：Holt-Lines 指数平滑（考虑趋势）
// holt_winters：Holt-Winters（考虑季节性）
```

### 5.5 bucket_selector：过滤桶

```java
// 只保留销售额超过 10000 的月份
GET sales/_search
{
  "aggs": {
    "sales_over_time": {
      "date_histogram": {
        "field": "order_date",
        "calendar_interval": "month"
      },
      "aggs": {
        "monthly_sales": {
          "sum": { "field": "amount" }
        },
        "sales_filter": {
          "bucket_selector": {
            "buckets_path": { "sales": "monthly_sales" },
            "script": "params.sales > 10000"
          }
        }
      }
    }
  }
}
```

### 5.6 bucket_sort：排序

```java
// 按月销售额降序排序
GET sales/_search
{
  "aggs": {
    "sales_over_time": {
      "date_histogram": {
        "field": "order_date",
        "calendar_interval": "month"
      },
      "aggs": {
        "monthly_sales": {
          "sum": { "field": "amount" }
        },
        "sorted_buckets": {
          "bucket_sort": {
            "sort": [
              { "monthly_sales": "desc" }
            ],
            "size": 10
          }
        }
      }
    }
  }
}
```

## 6. Top Hits 聚合

```java
// 每个分类下销售最好的 3 个产品
GET products/_search
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category" },
      "aggs": {
        "top_products": {
          "top_hits": {
            "size": 3,
            "sort": [
              { "sales": "desc" }
            ],
            "_source": ["name", "price", "sales"]
          }
        }
      }
    }
  }
}
```

## 7. 性能优化建议

### 7.1 减少桶的数量

```java
// 限制返回的桶数量
{
  "aggs": {
    "categories": {
      "terms": {
        "field": "category",
        "size": 10    // 只返回前 10 个桶
      }
    }
  }
}
```

### 7.2 使用 filter 代替 query

```java
// 慢：query 会计算评分
{
  "query": { "match": { "name": "laptop" } }
}

// 快：filter 不计算评分
{
  "filter": { "term": { "status": "published" } }
}
```

### 7.3 避免深层嵌套

嵌套聚合越深，性能越差。尽量控制在 2-3 层。

## 8. 面试高频问题

### Q1：聚合和搜索有什么关系？

**答案**：聚合是在搜索结果基础上进行的分析。可以同时执行搜索和聚合，也可以只有聚合（设置 `size: 0`）。

### Q2：bucket 和 metric 的区别？

**答案**：

- bucket：将文档分组，每组一个桶
- metric：对桶内的文档计算指标（平均、总和等）

可以理解为：bucket 是 GROUP BY，metric 是聚合函数。

### Q3：Pipeline 聚合有什么限制？

**答案**：Pipeline 聚合需要引用其他聚合的结果，通过 `buckets_path` 指定。注意只支持 sibling（兄弟）和 parent（父子）两种引用方式。

## 总结

ES 聚合分析的三大类型：

1. **Metric 聚合**：计算单一指标（avg、sum、max、min、stats）
2. **Bucket 聚合**：将文档分组（terms、range、date_histogram）
3. **Pipeline 聚合**：对聚合结果再计算（cumulative_sum、moving_avg）

理解这些聚合类型和它们的组合方式，是做数据分析的基础。

---

**留给你的问题**：

假设你有一个电商订单数据集，包含 `order_date`、`category`、`amount` 字段。你需要分析：

1. 每月每种分类的销售额
2. 每月每种分类销售额的环比增长率
3. 销售额连续 3 个月下降的分类

你会如何设计这个聚合查询？

这个需求在商业分析中非常常见，值得深入研究。
