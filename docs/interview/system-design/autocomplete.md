# 设计搜索自动补全（Auto Complete）

你在 Google 搜索框里输入「如何学习」——

0.1 秒后，下拉列表出现了：「如何学习编程」「如何学习英语」「如何学习吉他」......

**这些建议是怎么来的？为什么这么快？**


## 一、问题分析

### 1.1 自动补全的应用场景

```
┌─────────────────────────────────────────────────────┐
│                  自动补全典型场景                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  搜索引擎                                            │
│  ├── Google、百度搜索建议                            │
│  ├── 输入法候选词                                    │
│  └── 电商商品搜索                                   │
│                                                     │
│  特点                                              │
│  ├── 毫秒级响应（< 50ms）                          │
│  ├── 前缀匹配（用户输入 "java"，返回所有以 java 开头的词）│
│  ├── 上下文相关（基于用户历史、热门程度）              │
│  └── 高并发（大量用户同时输入）                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 1.2 技术挑战

```
1. 低延迟：用户边打字边等待，结果必须毫秒级返回
2. 高并发：成千上万的用户同时输入
3. 前缀匹配：传统数据库 LIKE 查询太慢
4. 相关性排序：不仅匹配前缀，还要按热度排序
5. 个性化：同一输入，不同用户看到不同建议
```


## 二、容量估算

### 2.1 数据规模

```
搜索词库：
- 搜索词总数：数亿条
- 热词数量：Top 100 万（覆盖 95% 请求）
- 词长分布：平均 4-8 个字符

查询特征：
- 单次查询平均耗时：< 10ms
- QPS：10 万+/秒
- 前缀长度：通常 1-4 个字符
```


## 三、方案选择

### 3.1 常见方案对比

| 方案 | 优点 | 缺点 |
|---|---|---|
| 数据库 LIKE | 简单 | 慢，无法排序 |
| Trie 树 | 前缀查询 O(k) | 内存占用大 |
| 前缀树 + 跳表 | 高效，可排序 | 实现复杂 |
| Elasticsearch | 功能强大 | 资源消耗大 |
| Redis ZSet | 高性能，易部署 | 需要预排序 |


## 四、核心设计

### 4.1 Trie 树（前缀树）

```java
/**
 * Trie 树实现自动补全
 *
 * 核心思想：
 * - 每个节点代表一个字符
 * - 从根到叶子的路径代表一个完整词
 * - 每个节点存储以该字符为前缀的所有词
 *
 * 时间复杂度：
 * - 插入：O(k)，k 为词长度
 * - 查询：O(k + m)，k 为前缀长度，m 为返回结果数
 */
public class TrieAutoComplete {

    private final TrieNode root;

    public TrieAutoComplete() {
        root = new TrieNode('\0');
    }

    /**
     * Trie 树节点
     */
    public static class TrieNode {
        private char ch;
        private Map<Character, TrieNode> children = new HashMap<>();
        private boolean isEnd;                    // 是否是单词结尾
        private long frequency;                   // 词频（用于排序）
        private String word;                      // 完整词（只在 isEnd=true 时有效）

        public TrieNode(char ch) {
            this.ch = ch;
        }
    }

    /**
     * 添加词到 Trie 树
     */
    public void insert(String word, long frequency) {
        TrieNode current = root;

        for (char ch : word.toCharArray()) {
            current.children.computeIfAbsent(ch, TrieNode::new);
            current = current.children.get(ch);
        }

        current.isEnd = true;
        current.frequency = frequency;
        current.word = word;
    }

    /**
     * 前缀查询
     *
     * @param prefix 前缀
     * @param limit 返回数量
     * @return 匹配的词列表（按频率排序）
     */
    public List<String> search(String prefix, int limit) {
        TrieNode current = root;

        // 1. 定位到前缀最后一个字符的节点
        for (char ch : prefix.toCharArray()) {
            if (!current.children.containsKey(ch)) {
                return Collections.emptyList(); // 前缀不存在
            }
            current = current.children.get(ch);
        }

        // 2. 从该节点收集所有词
        List<String> results = new ArrayList<>();
        collectWords(current, results, limit);

        // 3. 按频率排序
        results.sort((a, b) -> {
            long freqA = getFrequency(a);
            long freqB = getFrequency(b);
            return Long.compare(freqB, freqA); // 频率高的在前
        });

        return results.subList(0, Math.min(results.size(), limit));
    }

    /**
     * 收集从某节点出发的所有词
     */
    private void collectWords(TrieNode node, List<String> results, int limit) {
        if (node == null || results.size() >= limit) {
            return;
        }

        if (node.isEnd) {
            results.add(node.word);
        }

        for (TrieNode child : node.children.values()) {
            collectWords(child, results, limit);
            if (results.size() >= limit) {
                break;
            }
        }
    }

    private long getFrequency(String word) {
        TrieNode current = root;
        for (char ch : word.toCharArray()) {
            if (!current.children.containsKey(ch)) {
                return 0;
            }
            current = current.children.get(ch);
        }
        return current.frequency;
    }
}
```

### 4.2 Redis ZSet 方案（生产推荐）

```java
/**
 * 基于 Redis ZSet 的自动补全
 *
 * 思路：
 * - 每个前缀对应一个 ZSet
 * - ZSet 的 member 是完整词，score 是词频
 * - 使用 ZREVRANGE 获取 Top N
 *
 * 优化：
 * - 预构建所有前缀的 ZSet
 * - 使用 Lua 脚本批量查询
 */
public class RedisAutoComplete {

    private StringRedisTemplate redis;

    /**
     * 添加/更新搜索词
     *
     * @param word     搜索词
     * @param frequency 词频（同时用于排序和去重）
     */
    public void addWord(String word, long frequency) {
        // 1. 更新词频
        redis.opsForZSet().add("word:all", word, frequency);

        // 2. 为该词的所有前缀添加关联
        // 例如 "java" → 生成 "j", "ja", "jav", "java" 四个前缀
        for (int i = 1; i <= word.length(); i++) {
            String prefix = word.substring(0, i).toLowerCase();
            String key = "prefix:" + prefix;

            // 添加到前缀集合，score 使用全局词频
            redis.opsForZSet().add(key, word, frequency);
        }
    }

    /**
     * 批量添加搜索词
     */
    public void batchAddWords(Map<String, Long> words) {
        for (Map.Entry<String, Long> entry : words.entrySet()) {
            addWord(entry.getKey(), entry.getValue());
        }
    }

    /**
     * 查询前缀匹配
     *
     * @param prefix 前缀
     * @param limit 返回数量
     * @return 匹配的词列表（按频率排序）
     */
    public List<AutoCompleteResult> search(String prefix, int limit) {
        if (prefix == null || prefix.isEmpty()) {
            return Collections.emptyList();
        }

        String key = "prefix:" + prefix.toLowerCase();

        // 获取 Top N（按分数从高到低）
        Set<ZSetOperations.TypedTuple<String>> results =
            redis.opsForZSet().reverseRangeWithScores(key, 0, limit - 1);

        if (results == null || results.isEmpty()) {
            return Collections.emptyList();
        }

        return results.stream()
            .map(tuple -> new AutoCompleteResult(
                tuple.getValue(),
                tuple.getScore() != null ? tuple.getScore().longValue() : 0
            ))
            .collect(Collectors.toList());
    }

    /**
     * 获取前缀匹配的词频（用于前端显示热度）
     */
    public List<AutoCompleteResult> searchWithCount(String prefix, int limit) {
        List<AutoCompleteResult> results = search(prefix, limit);

        // 补充搜索次数（从全量词表查询）
        for (AutoCompleteResult result : results) {
            Double score = redis.opsForZSet().score("word:all", result.getWord());
            if (score != null) {
                result.setFrequency(score.longValue());
            }
        }

        return results;
    }
}

/**
 * 自动补全结果
 */
public class AutoCompleteResult {
    private String word;
    private long frequency;

    // 构造函数、getter、setter
}
```

### 4.3 个性化排序

```java
/**
 * 个性化自动补全
 *
 * 在通用热词基础上，融合用户历史搜索
 */
public class PersonalizedAutoComplete {

    private RedisAutoComplete baseAutoComplete;
    private RedisTemplate<String, Object> redis;

    private static final double HISTORY_WEIGHT = 0.6; // 历史搜索权重
    private static final double HOT_WEIGHT = 0.4;     // 热词权重

    /**
     * 个性化搜索
     *
     * @param prefix    前缀
     * @param userId    用户 ID
     * @param limit     返回数量
     */
    public List<AutoCompleteResult> personalizedSearch(String prefix,
                                                        String userId,
                                                        int limit) {
        // 1. 获取用户历史搜索词（按最近搜索时间排序）
        List<String> userHistory = getUserHistory(prefix, userId);

        // 2. 获取通用热词
        List<AutoCompleteResult> hotResults = baseAutoComplete.search(prefix, limit * 2);

        // 3. 合并并重新排序
        Map<String, Double> scoreMap = new HashMap<>();

        // 历史搜索词加分（越近搜索的加分越多）
        for (int i = 0; i < userHistory.size(); i++) {
            String word = userHistory.get(i);
            double historyScore = HISTORY_WEIGHT * (userHistory.size() - i) / userHistory.size();
            scoreMap.merge(word, historyScore, Double::sum);
        }

        // 热词加分
        for (AutoCompleteResult result : hotResults) {
            double hotScore = HOT_WEIGHT * result.getFrequency() / getMaxFrequency();
            scoreMap.merge(result.getWord(), hotScore, Double::sum);
        }

        // 4. 按综合分数排序
        return scoreMap.entrySet().stream()
            .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
            .limit(limit)
            .map(e -> new AutoCompleteResult(e.getKey(), e.getValue()))
            .collect(Collectors.toList());
    }

    /**
     * 获取用户历史搜索词（带前缀过滤）
     */
    private List<String> getUserHistory(String prefix, String userId) {
        String key = "history:" + userId;

        // 获取最近 100 条历史搜索
        List<String> history = redis.opsForList().range(key, 0, 99);

        if (history == null) {
            return Collections.emptyList();
        }

        // 过滤并返回匹配前缀的词
        return history.stream()
            .filter(word -> word.toLowerCase().startsWith(prefix.toLowerCase()))
            .collect(Collectors.toList());
    }

    /**
     * 记录用户搜索词
     */
    public void recordSearch(String userId, String word) {
        String key = "history:" + userId;

        // 左边插入（最新的在最前面）
        redis.opsForList().leftPush(key, word);

        // 只保留最近 100 条
        redis.opsForList().trim(key, 0, 99);

        // 设置过期时间（30 天不活跃则清除）
        redis.expire(key, Duration.ofDays(30));
    }

    private double getMaxFrequency() {
        // 返回全局最大词频，用于归一化
        return 1_000_000.0;
    }
}
```

### 4.4 高性能优化

```java
/**
 * 自动补全性能优化
 *
 * 策略：
 * 1. 本地缓存：减少 Redis 请求
 * 2. 请求合并：批量查询
 * 3. 异步预取：猜测用户下一步输入
 */
public class OptimizedAutoComplete {

    private PersonalizedAutoComplete autoComplete;

    // 本地缓存（Guava Cache / Caffeine）
    private Cache<String, List<AutoCompleteResult>> localCache = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(5))
        .build();

    /**
     * 查询（带本地缓存）
     */
    public List<AutoCompleteResult> search(String prefix, String userId, int limit) {
        String cacheKey = prefix.toLowerCase();

        // 1. 先查本地缓存
        List<AutoCompleteResult> cached = localCache.getIfPresent(cacheKey);
        if (cached != null) {
            return cached.subList(0, Math.min(cached.size(), limit));
        }

        // 2. 本地缓存未命中，查 Redis
        List<AutoCompleteResult> results = autoComplete.personalizedSearch(
            prefix, userId, limit
        );

        // 3. 回填本地缓存
        if (!results.isEmpty()) {
            localCache.put(cacheKey, results);
        }

        return results;
    }

    /**
     * 批量查询（用于前端预取）
     *
     * 用户输入 "j"，预取 "ja", "jav", "java" 等
     */
    public Map<String, List<AutoCompleteResult>> batchSearch(
            String prefix, String userId, int limit) {

        Map<String, List<AutoCompleteResult>> results = new HashMap<>();

        // 生成可能的下一个字符
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        for (char c : chars.toCharArray()) {
            String nextPrefix = prefix + c;
            List<AutoCompleteResult> result = search(nextPrefix, userId, 3);
            if (!result.isEmpty()) {
                results.put(nextPrefix, result);
            }
        }

        return results;
    }

    /**
     * 前端预取建议
     *
     * 前端可以基于当前输入，异步预取可能的补全选项
     */
    public void prefetch(String currentInput, String userId, Consumer<Map<String, List<AutoCompleteResult>>> callback) {
        // 异步预取
        CompletableFuture.runAsync(() -> {
            Map<String, List<AutoCompleteResult>> prefetchResults = batchSearch(
                currentInput, userId, 5
            );
            callback.accept(prefetchResults);
        });
    }
}
```


## 五、延伸问题

### 问题一：如何处理新词（热词实时更新）？

```
方案：
1. 定时任务：每小时从搜索日志聚合热词
2. 实时流处理：用 Flink/Kafka 实时计算热词
3. 降级策略：新词冷启动时，使用较低分数
```

### 问题二：如何处理敏感词过滤？

```
方案：
1. 加载时过滤：入库前过滤敏感词
2. 查询时过滤：返回结果时过滤
3. 前端过滤：前端也做一层过滤
推荐：多层过滤，层层保障
```

### 问题三：如何处理超长文本？

```
场景：用户粘贴了一段很长的文本
方案：
1. 前端限制输入长度
2. 后端只取前 N 个字符作为前缀
3. 超过长度的查询降级为全匹配
```


## 六、总结

```
┌─────────────────────────────────────────────────────┐
│              自动补全系统核心知识点                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  数据结构选择                                        │
│  ├── Trie 树：内存换时间                            │
│  └── Redis ZSet：高性能 + 可排序                    │
│                                                     │
│  排序策略                                            │
│  ├── 纯热词：按词频排序                             │
│  └── 个性化：历史搜索 + 热词融合                    │
│                                                     │
│  性能优化                                            │
│  ├── 本地缓存：减少 Redis 请求                      │
│  ├── 批量查询：减少网络往返                        │
│  └── 异步预取：猜测用户下一步                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**面试加分点**：
- 能解释 Trie 树的原理和时间复杂度
- 能说出 Redis ZSet 在自动补全中的应用
- 能设计个性化排序策略
- 能分析为什么传统 LIKE 查询不适合
