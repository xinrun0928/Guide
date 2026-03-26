# 倒排索引原理与分词器（Analyzer）

你有没有想过，为什么 Google 搜索「Java 教程」能瞬间返回 millions of results，而你在数据库里用 `LIKE '%Java%'` 查几千条数据都要卡半天？

答案藏在一种叫「**倒排索引**」的数据结构里。

## 1. 正排索引 vs 倒排索引

### 1.1 正排索引（Forward Index）

传统数据库用的是正排索引——以文档 ID 为索引，存储每个文档包含哪些词。

```
文档ID  →  文档内容
─────────────────────────────────
Doc1   →  "Java 是面向对象的编程语言"
Doc2   →  "Python 是脚本语言"
Doc3   →  "Java 在企业级开发中广泛使用"
```

查询「Java」：遍历所有文档，匹配包含「Java」的文档 → O(n) 复杂度

### 1.2 倒排索引（Inverted Index）

倒排索引反其道而行——以词为索引，存储每个词出现在哪些文档中。

```
词      →  文档列表
─────────────────────────────────
Java   →  [Doc1, Doc3]
是     →  [Doc1, Doc2, Doc3]
面向对象 → [Doc1]
编程语言 → [Doc1, Doc2]
Python →  [Doc2]
...
```

查询「Java」：直接查「Java」这个词，返回文档列表 → O(1) 复杂度

### 1.3 类比理解

想象一本书的「**索引页**」：

```
索引页：
Java .................. 1, 3, 5, 8, 12, ...
Python ................. 2, 6, 9, ...
MySQL .................. 4, 7, 10, ...

正文：
第1页: Java 基础语法
第2页: Python 入门
第3页: Java 高级特性
...
```

这就是倒排索引——索引页告诉我们「**这个词在哪些页**」，而不是「**这一页有哪些词**」。

## 2. 倒排索引的内部结构

ES 的倒排索引主要由两部分组成：**词典（Term Dictionary）** 和 **posting list**。

```
┌─────────────────────────────────────────────────────┐
│                  倒排索引结构                         │
│                                                      │
│  ┌──────────────────┐   ┌──────────────────────┐   │
│  │  Term Dictionary  │   │     Posting List       │   │
│  │   (词典，有序)     │   │    (文档ID列表)         │   │
│  │                   │   │                        │   │
│  │  Java ────────────┼──→│  [1, 3, 5, 8, 12, ...]│   │
│  │  MySQL ───────────┼──→│  [4, 7, 10, 15, ...]  │   │
│  │  Python ──────────┼──→│  [2, 6, 9, 14, ...]   │   │
│  │  ...              │   │                        │   │
│  └──────────────────┘   └────────────────────────┘   │
│           │                                             │
│           ▼                                             │
│  ┌──────────────────┐                                 │
│  │   Term Index      │  ← FST（有限状态转换器）           │
│  │  (快速定位词典)     │                                 │
│  └──────────────────┘                                 │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 2.1 Term Dictionary（词典）

所有需要索引的词组成词典，按字典序排列。词典需要支持：

- **快速查找**：给定词，找到它的位置
- **有序遍历**：支持范围查询

### 2.2 Term Index（词典索引）

词典可能很大，直接扫描很慢。Term Index 是一种**前缀树（Trie）**或**FST（Finite State Transducer）**，用于快速定位词在词典中的位置。

```
传统数据库：O(n) 扫描
Hash 索引：O(1) 但不支持范围查询
FST 索引：O(k) 支持前缀和范围查询
```

### 2.3 Posting List（倒排表）

记录每个词出现在哪些文档中，以及在文档中的位置信息。

```java
// Posting List 示例
"Java": {
  docFreq: 3,              // 出现在3个文档
  posting: [
    { docId: 1, positions: [0, 5] },      // 文档1，位置0和5
    { docId: 3, positions: [2] },         // 文档3，位置2
    { docId: 8, positions: [1, 7, 12] }   // 文档8，多个位置
  ]
}
```

**位置信息有什么用？**

- **短语查询**：「Java 编程」要求 Java 和 编程 相邻且顺序正确
- **高亮显示**：知道词在文档中的位置
- **距离查询**：两个词之间的距离

## 3. 分词器（Analyzer）的工作流程

分词器是倒排索引的关键——它决定了「**哪些词会被索引**」。

ES 的分词器由三部分组成：

```
Analyzer = Character Filter（字符过滤器）
         + Tokenizer（分词器）
         + Token Filter（词过滤器）
```

### 3.1 Character Filter（字符过滤器）

在分词之前，先对原始文本进行预处理。

```java
// 字符过滤器的常见作用：
// 1. 移除 HTML 标签
// 2. 转换特殊字符（如 é → e）
// 3. 映射字符（如 "①" → "1"）
```

```java
// 配置字符过滤器
PUT my_index
{
  "settings": {
    "analysis": {
      "char_filter": {
        "my_char_filter": {
          "type": "mapping",
          "mappings": ["& => and", "™ => TM"]
        }
      }
    }
  }
}
```

### 3.2 Tokenizer（分词器）

将文本切分成一个个词（Token）。这是**最核心**的步骤。

ES 内置了几种分词器：

| 分词器 | 说明 | 示例 |
|-------|------|------|
| standard | 默认分词器，按空格和标点切分 | `"Hello, World!"` → `["Hello", "World"]` |
| whitespace | 只按空格切分 | `"Hello, World!"` → `["Hello,", "World!"]` |
| keyword | 不分词，整个文本作为一个词 | `"Hello, World!"` → `["Hello, World!"]` |
| pattern | 正则表达式分词 | 可自定义切分规则 |

```java
// 测试分词效果
POST _analyze
{
  "analyzer": "standard",
  "text": "Elasticsearch is a search engine"
}

// 结果
{
  "tokens": [
    { "token": "elasticsearch", ... },
    { "token": "is", ... },
    { "token": "a", ... },
    { "token": "search", ... },
    { "token": "engine", ... }
  ]
}
```

### 3.3 Token Filter（词过滤器）

对切分后的词进行进一步处理。

```java
// 常见的 Token Filter
// 1. lowercase：转小写
// 2. stop：移除停用词（the, is, a...）
// 3. stemmer：词干提取（running → run）
// 4. synonym：同义词处理
// 5. ngram：滑动窗口切分
```

```java
// 配置自定义分词器
PUT my_index
{
  "settings": {
    "analysis": {
      "analyzer": {
        "my_analyzer": {
          "type": "custom",
          "char_filter": ["html_strip"],
          "tokenizer": "standard",
          "filter": ["lowercase", "stop", "snowball"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "content": {
        "analyzer": "my_analyzer"
      }
    }
  }
}
```

## 4. 中文分词器

英文分词很简单（空格分隔），但中文的词边界不明确——「武汉市长江大桥」可以切成：

- `["武汉市", "长江", "大桥"]`
- `["武汉", "市长", "江大桥"]`
- `["武汉市", "市长", "江大桥"]`

需要专门的中文分词器。

### 4.1 常用中文分词器对比

| 分词器 | 特点 | 缺点 |
|-------|------|------|
| IK | 社区活跃，支持自定义词典 | 词典维护成本 |
| jieba | 效果好，支持多种模式 | 资源消耗较高 |
| hanlp | 词性标注、命名实体识别 | 配置复杂 |

### 4.2 IK 分词器配置

```java
// 安装：./bin/elasticsearch-plugin install analysis-ik

// 两种模式
// 1. ik_smart：粗粒度分词
POST _analyze
{
  "analyzer": "ik_smart",
  "text": "武汉市长江大桥"
}
// 结果：["武汉市", "长江大桥"]

// 2. ik_max_word：细粒度分词（穷举所有组合）
POST _analyze
{
  "analyzer": "ik_max_word",
  "text": "武汉市长江大桥"
}
// 结果：["武汉市", "武汉", "市长", "长江", "长江大桥", "大桥"]
```

### 4.3 自定义词典

```java
// ik/config IKAnalyzer.cfg.xml
<entry key="ext_dict">custom/mydict.dic</entry>

// custom/mydict.dic
高并发
分布式系统
微服务架构
```

## 5. 分词器的使用场景

### 5.1 索引时分词 vs 搜索时分词

```
索引时（Index Time）：
  原始文本 → 分词器处理 → 存入倒排索引

搜索时（Search Time）：
  用户查询 → 分词器处理 → 在倒排索引中查找
```

**重要**：索引时分词器和搜索时分词器**应该保持一致**。

```java
// 错误示例：索引用 IK，搜索用 standard
{
  "mappings": {
    "properties": {
      "content": {
        "analyzer": "ik_max_word"   // 索引时分词
      }
    }
  }
}

// 搜索时使用默认分词器，无法正确匹配中文
{
  "query": {
    "match": {
      "content": "武汉市"   // standard 分词：["武汉", "市"]
    }
  }
}
```

### 5.2 分词与字段类型

```java
// text 类型：会被分词
"content": {
  "type": "text",
  "analyzer": "ik_max_word"
}

// keyword 类型：不分词，精确匹配
"status": {
  "type": "keyword"
}

// search_as_you_type：搜索时自动补全
"suggest": {
  "type": "search_as_you_type"
}
```

## 6. 倒排索引的构建过程

```
文档 → 解析文本 → 字符过滤 → 分词 → 词过滤 → 写入倒排索引

具体步骤：
1. 读取文档内容
2. 字符过滤器处理（移除 HTML、转换字符）
3. 分词器切分文本
4. 词过滤器处理（小写化、停用词、词干）
5. 将词和文档ID写入倒排索引
6. 记录词频、位置、偏移量
```

## 7. 面试高频问题

### Q1：倒排索引为什么比正排索引快？

**答案**：倒排索引以词为索引，查询时直接定位词；而正排索引以文档为索引，查询时需要遍历所有文档。

可以这样理解：图书馆的索引页比逐页翻书快，是因为索引页按主题组织好了。

### Q2：ES 的倒排索引和 MySQL 的索引有什么区别？

**答案**：MySQL 的 B+ Tree 索引是「一个字段 + 多个值」，适合等值查询和范围查询；ES 的倒排索引是「一个词 + 多个文档」，适合全文搜索。

| 维度 | MySQL B+ Tree | ES 倒排索引 |
|-----|--------------|-------------|
| 索引方向 | 正排 | 倒排 |
| 适用查询 | 等值、范围 | 全文搜索 |
| 数据结构 | B+ Tree | FST + Posting List |
| 中文支持 | 需要 LIKE | 需要分词器 |

### Q3：什么情况下不适合用 ES？

**答案**：

- 精确数值查询（如金额范围）- MySQL B+ Tree 更合适
- 事务性要求高的场景 - ES 不支持真正的 ACID 事务
- 频繁更新的场景 - ES 写入性能会下降
- 数据量很小（< 10万）- 直接用 MySQL 可能更简单

## 总结

倒排索引是 ES 快如闪电的秘密：

1. **正排 vs 倒排**：倒排索引以词为索引，查询时直接定位
2. **词典 + Posting List**：词典存储词，Posting List 存储文档ID
3. **分词器是关键**：分词器决定了哪些词会被索引
4. **中文需要专门分词器**：如 IK、jieba、hanlp
5. **索引和搜索时分词要一致**：否则查不到结果

---

**留给你的问题**：

假设你要实现一个搜索功能，支持「**搜索建议**」（输入「武汉」提示「武汉市长江大桥」「武汉大学」「武汉肺炎」），应该怎么设计？

这个问题涉及到分词器的选择、ngram 的使用，以及 search_as_you_type 类型。值得你动手实验一下。
