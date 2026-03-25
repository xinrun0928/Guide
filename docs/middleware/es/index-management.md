# Elasticsearch 索引管理：Mapping、Settings、Alias

索引是 ES 中最重要的概念之一。合理的索引设计，能让你的查询快如闪电；糟糕的设计，会让系统陷入无尽的问题。

## 1. 索引的组成

```
Index
    │
    ├── Settings（索引设置）
    │       ├── 分片数、副本数
    │       ├── 分词器配置
    │       ├── 刷新频率
    │       └── 内存配置
    │
    └── Mappings（索引映射）
            ├── 字段名
            ├── 字段类型
            └── 字段属性（是否索引、是否分词等）
```

## 2. Settings（索引设置）

### 2.1 基本设置

```java
PUT my_index
{
  "settings": {
    "number_of_shards": 3,        // 主分片数（创建后不可改）
    "number_of_replicas": 1,      // 副本数（可动态修改）
    "refresh_interval": "1s"      // 刷新间隔
  }
}
```

### 2.2 高级设置

```java
PUT my_index
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,

    // 分词器配置
    "analysis": {
      "analyzer": { ... },
      "tokenizer": { ... },
      "filter": { ... },
      "char_filter": { ... }
    },

    // 索引级别配置
    "index": {
      "refresh_interval": "1s",
      "max_result_window": 10000,
      "max_rescore_window": 5000000,
      "store.preload": ["nvd", "dvd"],
      "indexing.slowlog.threshold.index.warn": "2s"
    }
  }
}
```

### 2.3 动态修改 Settings

```java
// 修改副本数
PUT my_index/_settings
{
  "number_of_replicas": 2
}

// 修改刷新间隔（临时关闭）
PUT my_index/_settings
{
  "refresh_interval": "-1"
}

// 恢复刷新间隔
PUT my_index/_settings
{
  "refresh_interval": "1s"
}
```

## 3. Mappings（索引映射）

### 3.1 字段类型

```java
PUT my_index
{
  "mappings": {
    "properties": {
      // 字符串类型
      "title": {
        "type": "text",        // 全文检索，会分词
        "analyzer": "standard"
      },
      "status": {
        "type": "keyword"      // 精确值，不分词
      },

      // 数值类型
      "price": {
        "type": "float"        // 浮点数
      },
      "stock": {
        "type": "integer"      // 整数
      },
      "views": {
        "type": "long"         // 长整数
      },

      // 日期类型
      "publish_date": {
        "type": "date",        // 日期
        "format": "yyyy-MM-dd||yyyy-MM-dd HH:mm:ss||epoch_millis"
      },

      // 布尔类型
      "is_published": {
        "type": "boolean"
      },

      // 地理位置
      "location": {
        "type": "geo_point"
      },

      // IP 地址
      "ip_address": {
        "type": "ip"
      },

      // 嵌套对象
      "comments": {
        "type": "nested",
        "properties": {
          "user": { "type": "keyword" },
          "content": { "type": "text" }
        }
      },

      // 对象类型（不推荐，搜索会有问题）
      "author": {
        "type": "object",
        "properties": {
          "name": { "type": "text" },
          "email": { "type": "keyword" }
        }
      }
    }
  }
}
```

### 3.2 字段属性

```java
{
  "properties": {
    "title": {
      "type": "text",

      // 是否被索引（不可搜索则设为 false）
      "index": true,

      // 是否存储原始值（开启后 _source 中看不到）
      "store": false,

      // 字段排序和聚合能力
      "fields": {
        "keyword": { "type": "keyword" }    // title 既可以全文搜索，又可以精确匹配
      }
    },

    "content": {
      "type": "text",
      "analyzer": "ik_max_word",
      "search_analyzer": "ik_smart"
    }
  }
}
```

### 3.3 动态映射

ES 支持动态创建字段映射：

```java
// 动态映射规则
PUT my_index
{
  "mappings": {
    "dynamic": "strict",    // 严格模式：遇到未知字段报错
    "properties": { ... }
  }
}

// dynamic 的取值：
// true：自动创建映射（默认）
// false：忽略未知字段
// strict：遇到未知字段报错
```

| 字段值类型 | 自动推断的 ES 类型 |
|-----------|------------------|
| "2024-01-01" | date |
| true/false | boolean |
| 123 | long |
| 123.45 | float |
| "hello world" | text + keyword |
| {"key": "value"} | object |

## 4. Alias（索引别名）

### 4.1 创建别名

```java
// 给索引添加别名
POST _aliases
{
  "actions": [
    {
      "add": {
        "index": "my_index_v1",
        "alias": "my_index"
      }
    }
  ]
}
```

### 4.2 别名的用途

**用途一：零停机切换索引**

```java
// 创建新索引
PUT my_index_v2
{
  "mappings": { ... }
}

// 批量写入数据到 v2

// 原子切换别名
POST _aliases
{
  "actions": [
    { "remove": { "index": "my_index_v1", "alias": "my_index" } },
    { "add": { "index": "my_index_v2", "alias": "my_index" } }
  ]
}
```

**用途二：一个别名指向多个索引**

```java
// 别名可以指向多个索引（类似视图）
POST _aliases
{
  "actions": [
    { "add": { "index": "logs_2024_01", "alias": "logs" } },
    { "add": { "index": "logs_2024_02", "alias": "logs" } },
    { "add": { "index": "logs_2024_03", "alias": "logs" } }
  ]
}

// 查询 logs 会搜索所有关联的索引
GET logs/_search
{
  "query": { "match_all": {} }
}
```

**用途三：读写分离**

```java
// 写操作指向主索引
POST logs_write/_doc
{ "message": "log entry" }

// 读操作指向别名（可能包含多个索引）
GET logs_read/_search
```

### 4.3 管理别名

```java
// 查看索引的别名
GET my_index/_alias

// 查看别名的索引
GET my_index/_alias/_all

// 删除别名
POST _aliases
{
  "actions": [
    { "remove": { "index": "my_index", "alias": "old_alias" } }
  ]
}
```

## 5. 索引模板（Index Template）

索引模板让你在创建索引时自动应用配置。

### 5.1 创建模板

```java
PUT _index_template/logs_template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "refresh_interval": "5s"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "level": { "type": "keyword" },
        "message": { "type": "text" },
        "service": { "type": "keyword" }
      }
    }
  },
  "priority": 100
}
```

### 5.2 模板匹配

```java
// 创建 logs-2024.01.01 时，模板自动应用
PUT logs-2024.01.01/_doc
{
  "@timestamp": "2024-01-01T00:00:00Z",
  "level": "INFO",
  "message": "Application started",
  "service": "user-service"
}

// 创建 orders-2024.01.01 时，模板不匹配（pattern 是 logs-*）
PUT orders-2024.01.01/_doc
{
  "message": "New order"
}
```

### 5.3 组件模板

```java
// 创建公共的 settings 组件
PUT _component_template/common_settings
{
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "refresh_interval": "5s"
    }
  }
}

// 创建公共的 mappings 组件
PUT _component_template/common_mappings
{
  "template": {
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" }
      }
    }
  }
}

// 组合使用
PUT _index_template/logs_template
{
  "index_patterns": ["logs-*"],
  "composed_of": ["common_settings", "common_mappings"]
}
```

## 6. 索引生命周期管理（ILM）

ILM 自动管理索引的整个生命周期。

### 6.1 ILM 策略

```java
PUT _ilm/policy/my_policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "7d",
            "max_docs": 10000000
          },
          "set_priority": {
            "priority": 100
          }
        }
      },
      "warm": {
        "min_age": "30d",
        "actions": {
          "shrink": {
            "number_of_shards": 1
          },
          "forcemerge": {
            "max_num_segments": 1
          },
          "allocate": {
            "require": {
              "box_type": "warm"
            }
          },
          "set_priority": {
            "priority": 50
          }
        }
      },
      "cold": {
        "min_age": "90d",
        "actions": {
          "allocate": {
            "require": {
              "box_type": "cold"
            }
          },
          "set_priority": {
            "priority": 0
          }
        }
      },
      "delete": {
        "min_age": "365d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

### 6.2 应用 ILM 策略

```java
// 方式一：通过索引模板
PUT _index_template/logs_template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "my_policy",
      "index.lifecycle.rollover_alias": "logs"
    }
  }
}

// 方式二：直接应用
PUT logs-000001
{
  "aliases": {
    "logs": { "is_write_index": true }
  }
}
```

## 7. 索引常用操作

### 7.1 查看索引信息

```java
// 查看所有索引
GET _cat/indices

// 查看某个索引的 mapping
GET my_index/_mapping

// 查看某个索引的 settings
GET my_index/_settings
```

### 7.2 打开/关闭索引

```java
// 关闭索引（节省资源，但不接收读写）
POST my_index/_close

// 打开索引
POST my_index/_open
```

### 7.3 克隆索引

```java
// 将索引克隆到新索引
POST my_index/_clone/my_index_replica
{
  "settings": {
    "index.number_of_replicas": 1
  }
}
```

### 7.4 删除索引

```java
// 删除索引（不可恢复！）
DELETE my_index

// 批量删除
DELETE /my_index_v1,my_index_v2

// 通配符删除（小心使用）
DELETE /logs-*
```

## 8. 面试高频问题

### Q1：text 和 keyword 字段的区别？

**答案**：

- text：全文检索字段，会经过分词器处理，适合搜索
- keyword：精确值字段，不分词，适合过滤、排序、聚合

两者可以共存：

```java
{
  "properties": {
    "email": {
      "type": "text",
      "fields": {
        "keyword": { "type": "keyword" }
      }
    }
  }
}
```

### Q2：主分片数为什么不能改？

**答案**：因为 ES 使用 `hash(doc_id) % num_shards` 路由文档。如果修改主分片数，所有文档的路由位置都会改变，需要重新分布数据，代价巨大。

### Q3：如何实现零停机索引切换？

**答案**：使用别名 + 原子操作：

1. 创建新索引
2. 迁移数据
3. 通过 `_aliases` 原子切换别名

## 总结

索引管理的核心要点：

1. **Settings**：分片数（不可改）、副本数（可改）、刷新间隔
2. **Mappings**：字段类型选择、动态映射、字段属性
3. **Alias**：零停机切换、读写分离、多索引聚合
4. **Index Template**：批量应用配置
5. **ILM**：自动管理索引生命周期

---

**留给你的问题**：

假设你的系统每天产生 100GB 日志数据，需要保存 1 年。你会如何设计索引策略？

需要考虑的问题：
- 分片数如何设置？
- 是否需要冷热分离？
- ILM 策略如何设计？
- 保留多少个索引？

这个设计在实际生产中非常重要。
