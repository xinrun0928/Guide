# Elasticsearch 查询 DSL：match、term、range、bool、嵌套查询

如果说倒排索引是 ES 的心脏，那 **Query DSL** 就是 ES 的大脑——它定义了「**如何找到你想要的数据**」。

ES 的查询 DSL 非常强大，支持从简单的关键词匹配到复杂的多条件组合查询。

## 1. 查询 DSL 分类

```
Query DSL
    │
    ├── 全文查询（Full-text Queries）
    │       ├── match
    │       ├── multi_match
    │       ├── query_string
    │       └── common terms
    │
    ├── 精确查询（Term-level Queries）
    │       ├── term
    │       ├── terms
    │       ├── range
    │       └── exists
    │
    ├── 复合查询（Compound Queries）
    │       ├── bool
    │       ├── constant_score
    │       ├── function_score
    │       └── dis_max
    │
    └── 嵌套查询（Nested Queries）
            ├── nested
            ├── has_child
            └── has_parent
```

## 2. 全文查询（Full-text Queries）

全文查询会**分析查询字符串**，使用分词器处理后再搜索。

### 2.1 match 查询

最常用的全文查询，**会对查询词进行分词**。

```java
// 基础用法：查询 title 包含 "Java 教程" 的文档
GET my_index/_search
{
  "query": {
    "match": {
      "title": "Java 教程"
    }
  }
}

// 实际执行过程：
// 1. "Java 教程" 被分词 → ["java", "教程"]
// 2. 在倒排索引中查找包含 "java" 或 "教程" 的文档
// 3. 计算相关性得分
```

**match 的参数：**

```java
// operator：控制多个词的关系
GET my_index/_search
{
  "query": {
    "match": {
      "title": {
        "query": "Java 教程",
        "operator": "and"    // 必须同时包含 Java 和 教程
      }
    }
  }
}

// minimum_should_match：最少匹配词数
GET my_index/_search
{
  "query": {
    "match": {
      "title": {
        "query": "Java 教程 实战",
        "minimum_should_match": 2    // 至少匹配 2 个词
      }
    }
  }
}

// fuzziness：模糊匹配
GET my_index/_search
{
  "query": {
    "match": {
      "title": {
        "query": "Java",
        "fuzziness": "AUTO"    // 允许一定的拼写错误
      }
    }
  }
}
```

### 2.2 multi_match 查询

在多个字段上同时搜索。

```java
// 在 title 和 content 字段搜索
GET my_index/_search
{
  "query": {
    "multi_match": {
      "query": "Java 教程",
      "fields": ["title", "content"]
    }
  }
}

// 字段加权：title 更重要
GET my_index/_search
{
  "query": {
    "multi_match": {
      "query": "Java 教程",
      "fields": ["title^3", "content"]    // title 加权 3 倍
    }
  }
}

// best_fields：取最佳匹配字段的分数（默认）
// most_fields：综合多个字段的分数
// cross_fields：跨字段匹配，适合结构化查询
GET my_index/_search
{
  "query": {
    "multi_match": {
      "query": "Java 教程",
      "fields": ["title", "author"],
      "type": "best_fields"    // 默认
    }
  }
}
```

## 3. 精确查询（Term-level Queries）

精确查询**不分析查询字符串**，直接匹配倒排索引中的词。

### 3.1 term 查询

```java
// 查询 status 字段等于 "published" 的文档
GET my_index/_search
{
  "query": {
    "term": {
      "status": "published"
    }
  }
}

// 注意：term 是精确匹配，不会分词
// 如果查询 "Hello World"，会找包含完整 "Hello World" 的文档
// 而不是 "Hello" 或 "World"
```

### 3.2 terms 查询

```java
// 查询 category 是 "java" 或 "python" 的文档
GET my_index/_search
{
  "query": {
    "terms": {
      "category": ["java", "python"]
    }
  }
}
```

### 3.3 range 查询

```java
// 查询 views 在 100 到 1000 之间的文档
GET my_index/_search
{
  "query": {
    "range": {
      "views": {
        "gte": 100,
        "lte": 1000
      }
    }
  }
}

// 日期范围查询
GET my_index/_search
{
  "query": {
    "range": {
      "publish_date": {
        "gte": "2024-01-01",
        "lte": "2024-12-31"
      }
    }
  }
}

// 支持的运算符：
// gt: greater than
// gte: greater than or equal
// lt: less than
// lte: less than or equal
```

### 3.4 exists 和 missing 查询

```java
// 查询有 title 字段的文档
GET my_index/_search
{
  "query": {
    "exists": {
      "field": "title"
    }
  }
}

// 查询没有 title 字段的文档
GET my_index/_search
{
  "query": {
    "bool": {
      "must_not": [
        { "exists": { "field": "title" } }
      ]
    }
  }
}
```

## 4. 复合查询（Compound Queries）

### 4.1 bool 查询

bool 是最强大的组合查询，由四个子句组成：

```java
// bool 查询结构
{
  "query": {
    "bool": {
      "must": [ ... ],      // 必须匹配（计算评分）
      "should": [ ... ],    // 应该匹配（计算评分）
      "filter": [ ... ],    // 必须匹配（不计算评分）
      "must_not": [ ... ]   // 必须不匹配（不计算评分）
    }
  }
}
```

**各子句的区别：**

| 子句 | 评分 | 说明 |
|-----|------|------|
| must | ✓ | 必须匹配，影响得分 |
| should | ✓ | 应该匹配，影响得分 |
| filter | ✗ | 必须匹配，不影响得分（被缓存） |
| must_not | ✗ | 必须不匹配，不影响得分（被缓存） |

**实战示例：**

```java
// 查询满足以下条件的文章：
// 1. title 或 content 包含 "Java"（must）
// 2. category 必须是 "tutorial"（filter）
// 3. status 必须是 "published"（filter）
// 4. author 不能是 "admin"（must_not）
// 5. 如果有 "featured" 标签，得分更高（should）

GET my_index/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "Java",
            "fields": ["title", "content"]
          }
        }
      ],
      "filter": [
        { "term": { "category": "tutorial" } },
        { "term": { "status": "published" } }
      ],
      "must_not": [
        { "term": { "author": "admin" } }
      ],
      "should": [
        { "term": { "tags": "featured" } }
      ],
      "minimum_should_match": 1    // 至少满足一个 should
    }
  }
}
```

**boost 参数：调整权重**

```java
// 增加 must 中某个条件的权重
{
  "bool": {
    "must": [
      { "match": { "title": { "query": "Java", "boost": 2 } } }
    ]
  }
}
```

### 4.2 constant_score 查询

包装一个查询，返回固定的评分。

```java
// 所有匹配 filter 的文档得分都是 1.0
GET my_index/_search
{
  "query": {
    "constant_score": {
      "filter": {
        "term": { "status": "published" }
      },
      "boost": 1.2
    }
  }
}
```

### 4.3 function_score 查询

使用函数计算评分，可以实现自定义排序逻辑。

```java
// 根据 views 字段影响最终得分
GET my_index/_search
{
  "query": {
    "function_score": {
      "query": {
        "match": { "title": "Java 教程" }
      },
      "functions": [
        {
          "field_value_factor": {
            "field": "views",
            "factor": 1.2,
            "modifier": "log1p",    // 取对数，避免极端值影响过大
            "missing": 1
          }
        },
        {
          "gauss": {
            "publish_date": {
              "origin": "now",
              "scale": "30d",
              "decay": 0.5
            }
          }
        }
      ],
      "score_mode": "sum",    // 多个函数得分求和
      "boost_mode": "multiply"  // 最终得分 = 原始分 × 函数分
    }
  }
}
```

## 5. 嵌套查询（Nested Queries）

ES 中有一个特殊的数据类型：`nested`，用于存储嵌套对象。

### 5.1 nested 类型定义

```java
PUT my_index
{
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      // 嵌套字段
      "comments": {
        "type": "nested",
        "properties": {
          "user": { "type": "keyword" },
          "content": { "type": "text" },
          "date": { "type": "date" }
        }
      }
    }
  }
}
```

### 5.2 nested 查询

```java
// 查询包含特定嵌套条件的文档
GET my_index/_search
{
  "query": {
    "nested": {
      "path": "comments",
      "query": {
        "bool": {
          "must": [
            { "term": { "comments.user": "alice" } },
            { "match": { "comments.content": "good" } }
          ]
        }
      },
      "inner_hits": {}    // 返回匹配的嵌套对象
    }
  }
}

// 返回结果
{
  "hits": {
    "hits": [
      {
        "_source": {
          "title": "ES 教程",
          "comments": [
            { "user": "alice", "content": "very good", "date": "2024-01-01" },
            { "user": "bob", "content": "not bad", "date": "2024-01-02" }
          ]
        },
        "inner_hits": {
          "comments": {
            "hits": {
              "hits": [
                {
                  "_source": { "user": "alice", "content": "very good" }
                }
              ]
            }
          }
        }
      }
    ]
  }
}
```

### 5.3 has_child 和 has_parent

```java
// has_child：父文档是否有符合条件的子文档
GET my_index/_search
{
  "query": {
    "has_child": {
      "type": "comment",
      "query": {
        "term": { "user": "alice" }
      }
    }
  }
}

// has_parent：子文档是否有符合条件的父文档
GET my_index/_search
{
  "query": {
    "has_parent": {
      "parent_type": "blog",
      "query": {
        "term": { "status": "published" }
      }
    }
  }
}
```

## 6. 高频查询模式

### 6.1 搜索 + 过滤 + 聚合

```java
GET my_index/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Java" } }
      ],
      "filter": [
        { "term": { "status": "published" } },
        { "range": { "publish_date": { "gte": "2024-01-01" } } }
      ]
    }
  },
  "aggs": {
    "by_category": {
      "terms": { "field": "category" }
    }
  },
  "size": 10
}
```

### 6.2 多条件组合

```java
// 搜索 "Java" 或 "Python"，但不包含 "入门"
// category 是 tutorial 或进阶
// publish_date 在 2024 年内

GET my_index/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "bool": {
            "should": [
              { "match": { "title": "Java" } },
              { "match": { "title": "Python" } }
            ]
          }
        }
      ],
      "must_not": [
        { "match": { "title": "入门" } }
      ],
      "filter": [
        {
          "bool": {
            "should": [
              { "term": { "category": "tutorial" } },
              { "term": { "category": "进阶" } }
            ]
          }
        },
        {
          "range": {
            "publish_date": {
              "gte": "2024-01-01",
              "lte": "2024-12-31"
            }
          }
        }
      ]
    }
  }
}
```

## 7. 面试高频问题

### Q1：match 和 term 查询的区别？

**答案**：match 会分析查询字符串（分词），term 不会分析，精确匹配倒排索引中的词。

```java
// 搜索 "Java Tutorial"
match: "java" AND "tutorial"     // 分词后匹配
term: "Java Tutorial"            // 精确匹配完整字符串
```

### Q2：must 和 filter 的区别？

**答案**：

- must 计算评分，结果会被缓存
- filter 不计算评分（更快），结果一定会被缓存
- filter 适合精确匹配条件，must 适合需要相关性的搜索

### Q3：bool 查询的 minimum_should_match 怎么用？

**答案**：

```java
// 2 个 should，至少匹配 1 个
{ "should": [...], "minimum_should_match": 1 }

// 3 个 should，至少匹配 2 个
{ "should": [...], "minimum_should_match": 2 }

// 只有 1 个 should 时，minimum_should_match: 1 等同于 must
```

## 总结

ES Query DSL 的核心要点：

1. **全文查询用 match**：分析查询词，适合搜索场景
2. **精确查询用 term**：不分析查询词，适合过滤场景
3. **组合查询用 bool**：must/should/filter/must_not 灵活组合
4. **嵌套查询用 nested**：处理嵌套对象
5. **filter > must**：精确过滤用 filter，更快

---

**留给你的问题**：

假设你要实现一个搜索功能，用户输入「Java 教程」，要求：

1. 优先返回标题包含完整「Java 教程」的文档
2. 其次返回标题包含「Java」的文档
3. 最后返回内容包含「Java 教程」的文档

你怎么用 ES 的 bool + should + boost 来实现这个需求？

这个需求在电商搜索中很常见，值得动手实践一下。
