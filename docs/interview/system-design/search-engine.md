# 搜索系统设计：倒排索引与相关性排序

---

## 场景切入：为什么 Google 比你更懂搜索？

你在 Google 输入「Java 面试题」，0.5 秒后返回了 1000 万条结果。

前几条都是高质量的面试题文章，相关性极高。

然后你换了个搜索引擎，输入同样的词...

结果乱七八糟，有的文章根本没提到「面试」，有的把「Java」拆成了「J」「a」「v」「a」。

为什么差距这么大？

秘密在于：**倒排索引**和**相关性排序**。

今天，我们来聊聊搜索系统的核心原理。

---

## 需求分析：搜索系统要解决什么问题？

搜索系统的核心问题：

1. **理解查询**：用户想找什么？（Query Understanding）
2. **找到文档**：哪些文档包含查询词？（召回）
3. **排序结果**：哪个文档最相关？（排序）
4. **展示结果**：如何高效展示给用户？（高亮、摘要）

### 搜索 vs 数据库查询

| 维度 | 数据库查询 | 搜索引擎 |
|---|---|---|
| 数据量 | 千万级 | 亿级 |
| 模糊匹配 | 支持有限 | 原生支持 |
| 分词 | 不支持 | 支持 |
| 全文检索 | 慢 | 快 |
| 实时性 | 高 | 中 |

---

## 容量估算

假设设计一个电商商品搜索系统：

| 指标 | 数值 |
|---|---|
| 商品数量 | 10 亿 |
| 每天新增 | 1000 万 |
| 搜索 QPS | 5 万/秒 |
| 平均响应时间 | <100ms |
| 索引大小 | ~500GB（压缩后） |

---

## 核心设计：倒排索引

### 什么是倒排索引？

**正排索引**：文档 ID → 文档内容

```
doc_1 → [标题: Java 面试题, 内容: 这是一道关于 Java 的面试题...]
doc_2 → [标题: Python 教程, 内容: Python 是一门编程语言...]
```

**倒排索引**：词 → 文档列表

```
Java → [doc_1, doc_3, doc_10, ...]（包含 Java 的文档）
面试 → [doc_1, doc_5, doc_8, ...]（包含面试的文档）
```

**为什么用倒排索引？**

如果给你一个词「Java」，正排索引要扫描所有文档内容，倒排索引直接查词表。

查询复杂度：从 O(n) 降到 O(1)。

```java
public class InvertedIndex {

    private final Map&lt;String, List&lt;Posting&gt;&gt; index = new HashMap&lt;&gt;();

    /**
     * 构建倒排索引
     * Posting 包含文档 ID、词频、位置等信息
     */
    public void addDocument(String docId, String content) {
        // 1. 分词
        List&lt;String&gt; terms = tokenizer.tokenize(content);

        // 2. 统计词频和位置
        Map&lt;String, List&lt;Integer&gt;&gt; termPositions = new HashMap&lt;&gt;();
        for (int i = 0; i &lt; terms.size(); i++) {
            String term = terms.get(i);
            termPositions.computeIfAbsent(term, k -&gt; new ArrayList&lt;&gt;()).add(i);
        }

        // 3. 构建倒排列表
        for (Map.Entry&lt;String, List&lt;Integer&gt;&gt; entry : termPositions.entrySet()) {
            String term = entry.getKey();
            List&lt;Integer&gt; positions = entry.getValue();
            Posting posting = new Posting(docId, positions.size(), positions);
            index.computeIfAbsent(term, k -&gt; new ArrayList&lt;&gt;()).add(posting);
        }
    }

    /**
     * 查询：返回包含所有查询词的文档
     */
    public Set&lt;String&gt; search(List&lt;String&gt; queryTerms) {
        if (queryTerms.isEmpty()) {
            return Collections.emptySet();
        }

        // 取所有查询词对应文档列表的交集
        Set&lt;String&gt; result = null;
        for (String term : queryTerms) {
            List&lt;Posting&gt; postings = index.getOrDefault(term, Collections.emptyList());
            Set&lt;String&gt; docIds = postings.stream()
                .map(Posting::getDocId)
                .collect(Collectors.toSet());

            if (result == null) {
                result = docIds;
            } else {
                result.retainAll(docIds); // 交集
            }
        }

        return result != null ? result : Collections.emptySet();
    }
}

/**
 * 倒排列表中的条目
 */
public class Posting {
    private final String docId;
    private final int termFrequency; // 词频
    private final List&lt;Integer&gt; positions; // 词出现位置
}
```

### 分词器

分词是中文搜索的核心。「Java 面试题」可以分出：

- 精确分词：Java、面试题
- 模糊分词：Java、面试、题
- NGram：Ja、av、va、Jav、ava、...

```java
public class ChineseTokenizer {

    /**
     * 双向最大匹配分词
     */
    public List&lt;String&gt; tokenize(String text) {
        // 1. 正向最大匹配
        List&lt;String&gt; fmm = forwardMaximumMatch(text);

        // 2. 逆向最大匹配
        List&lt;String&gt; bmm = backwardMaximumMatch(text);

        // 3. 选择词数少的结果
        return fmm.size() &lt;= bmm.size() ? fmm : bmm;
    }

    /**
     * 正向最大匹配
     */
    private List&lt;String&gt; forwardMaximumMatch(String text) {
        List&lt;String&gt; result = new ArrayList&lt;&gt;();
        int i = 0;
        while (i &lt; text.length()) {
            String word = longestMatch(text.substring(i), true);
            result.add(word);
            i += word.length();
        }
        return result;
    }
}
```

---

## 核心设计：相关性排序

找到文档后，如何排序？

### TF-IDF 算法

**TF（Term Frequency）**：词在文档中出现越多，越相关

```
TF(t,d) = 词 t 在文档 d 中出现的次数
```

**IDF（Inverse Document Frequency）**：词在所有文档中出现越少，越有区分度

```
IDF(t) = log(总文档数 / 包含词 t 的文档数)
```

**相关性 = TF × IDF**

```java
public class TfIdfScorer {

    private final int totalDocs;
    private final Map&lt;String, Integer&gt; docFreqCache = new HashMap&lt;&gt;();

    /**
     * 计算 TF-IDF 得分
     */
    public double score(String term, String docId) {
        // 1. 计算 TF
        int termCount = getTermCount(term, docId);
        double tf = 1 + Math.log(termCount); // 使用对数平滑，避免极端值

        // 2. 计算 IDF
        double idf = calculateIdf(term);

        // 3. TF-IDF
        return tf * idf;
    }

    /**
     * 计算 IDF
     */
    private double calculateIdf(String term) {
        int df = docFreqCache.getOrDefault(term, 0);
        if (df == 0) {
            return Math.log(totalDocs + 1); // 避免除零
        }
        return Math.log((double) totalDocs / df + 1);
    }
}
```

### BM25 算法（业界主流）

BM25 是对 TF-IDF 的改进，解决了词频饱和的问题。

```java
public class BM25Scorer {

    private static final double k1 = 1.5; // 词频饱和参数
    private static final double b = 0.75; // 文档长度归一化参数

    private final double avgDocLen;

    /**
     * BM25 公式
     * 对 TF 进行饱和处理：TF 越大，增量越小
     */
    public double score(String term, String docId, int termFreq, int docLen) {
        double idf = calculateIdf(term);
        double tf = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * docLen / avgDocLen));
        return idf * tf;
    }
}
```

### 多因素排序

实际搜索系统不会只用一种算法，而是综合多种因素：

```java
public class SearchRanker {

    private final TfIdfScorer tfIdfScorer;
    private final BM25Scorer bm25Scorer;
    private final PageRankScorer pageRankScorer;

    /**
     * 综合排序
     */
    public double rank(SearchResult result, SearchQuery query) {
        // 1. BM25 相关性得分
        double bm25Score = bm25Scorer.score(result, query);

        // 2. 文档质量得分（PageRank）
        double pageRankScore = pageRankScorer.getScore(result.getDocId());

        // 3. 时效性得分（越新的文档分数越高）
        double recencyScore = calculateRecencyScore(result.getPublishTime());

        // 4. 商业权重（广告、付费推广）
        double commercialScore = result.getCommercialWeight();

        // 5. 综合得分
        return 0.4 * bm25Score + 0.3 * pageRankScore + 0.2 * recencyScore + 0.1 * commercialScore;
    }
}
```

---

## 核心设计：分布式搜索

单机无法支撑海量数据，需要分布式。

### 分片策略

```java
public class ShardedSearcher {

    private final List&lt;Searcher&gt; shards;

    /**
     * 广播查询：所有分片并行搜索
     */
    public List&lt;SearchResult&gt; search(SearchQuery query) {
        // 1. 并行查询所有分片
        List&lt;Future&lt;List&lt;SearchResult&gt;&gt;&gt; futures = new ArrayList&lt;&gt;();
        for (Searcher shard : shards) {
            futures.add(executor.submit(() -&gt; shard.search(query)));
        }

        // 2. 收集所有分片结果
        List&lt;SearchResult&gt; allResults = new ArrayList&lt;&gt;();
        for (Future&lt;List&lt;SearchResult&gt;&gt; future : futures) {
            try {
                allResults.addAll(future.get());
            } catch (Exception e) {
                log.error("分片查询失败", e);
            }
        }

        // 3. 合并、排序、截断
        return mergeAndSort(allResults, query.getLimit());
    }
}
```

---

## 延伸问题

### Q1：搜索如何实现自动补全？

使用 **Trie（前缀树）**：

```java
public class TrieAutoComplete {

    private final TrieNode root = new TrieNode();

    /**
     * 插入搜索词
     */
    public void insert(String query, int count) {
        TrieNode node = root;
        for (char c : query.toCharArray()) {
            node = node.getOrCreateChild(c);
        }
        node.incrementCount(count);
    }

    /**
     * 自动补全：返回 top N 个匹配结果
     */
    public List&lt;String&gt; autocomplete(String prefix, int limit) {
        TrieNode node = findNode(prefix);
        if (node == null) {
            return Collections.emptyList();
        }

        // DFS 收集所有以 prefix 为前缀的词
        List&lt;Pair&lt;String, Integer&gt;&gt; results = new ArrayList&lt;&gt;();
        dfsCollect(node, prefix, results);

        // 按热度排序，返回 top N
        results.sort((a, b) -&gt; b.getValue().compareTo(a.getValue()));
        return results.stream()
            .limit(limit)
            .map(Pair::getKey)
            .collect(Collectors.toList());
    }
}
```

### Q2：如何处理拼写错误？

1. **编辑距离**：计算用户输入与词典词的编辑距离，推荐最近的词
2. **同义词**：把「电脑」映射到「计算机」
3. **拼音搜索**：支持拼音输入

### Q3：Elasticsearch 如何保证搜索性能？

| 优化手段 | 说明 |
|---|---|
| 分片 | 数据分片，并行查询 |
| 副本 | 数据副本，高可用 |
| 缓存 | 查询结果缓存 |
| 路由 | 根据 doc_id 精确定位分片 |

---

## 总结

搜索系统的核心组件：

| 组件 | 作用 |
|---|---|
| 倒排索引 | 快速定位包含查询词的文档 |
| 分词器 | 把文本切分成可搜索的单元 |
| 相关性算法 | BM25、TF-IDF 等 |
| 多因素排序 | 综合多种信号排序 |

记住：**搜索的本质是「找到」和「排序」。**

找到要靠倒排索引，排序要靠相关性算法。两者配合，才能给用户又快又准的结果。
