# PostgreSQL 全文检索：tsvector、tsquery 与全文索引

MySQL 有全文索引，但限制多、功能弱。

PostgreSQL 呢？

PostgreSQL 的全文搜索强大到可以直接替代 Elasticsearch 的简单场景。

今天，我们来聊聊 PostgreSQL 的全文检索。

## 全文检索基础

### 核心概念

PostgreSQL 全文检索有三个核心概念：

| 概念 | 说明 |
|------|------|
| tsvector | 文档的分词向量表示 |
| tsquery | 查询条件的分词表示 |
| @@ | 全文搜索匹配操作符 |

### 分词器（Text Search Parser）

PostgreSQL 使用内置分词器处理文本：

```sql
-- 将文本转为 tsvector
SELECT to_tsvector('english', 'PostgreSQL is a powerful open source database');

-- 结果：
-- 'databases':3 'power':4 'postgresql':1 'sourc':6 'strong':5

-- 注意：分词后变成词根（stemming）
-- PostgreSQL -> postgresql, powerful -> strong
```

### 支持的语言

```sql
-- 支持多种语言
SELECT to_tsvector('simple', 'PostgreSQL 数据库');   -- simple：不做词根处理
SELECT to_tsvector('english', 'PostgreSQL 数据库');  -- english：英语词根处理
SELECT to_tsvector('chinese', 'PostgreSQL 数据库'); -- chinese：中文分词
SELECT to_tsvector('jiebaych', 'PostgreSQL 数据库'); -- jieba+ch：jieba 中文分词

-- 安装中文分词（需要扩展）
CREATE EXTENSION zhparser;  -- 需要先安装 zhparser
```

## tsvector

### 基本操作

```sql
-- 将文本转为 tsvector
SELECT to_tsvector('english', 'The PostgreSQL database is very powerful');

-- 自定义配置
SELECT to_tsvector('simple', 'PostgreSQL Database');

-- 带权重的 tsvector
SELECT setweight(to_tsvector('english', 'PostgreSQL'), 'A') ||
       setweight(to_tsvector('english', 'database'), 'B') ||
       setweight(to_tsvector('english', 'powerful'), 'C');
```

### 从表中提取 tsvector

```sql
-- 创建文章表
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200),
    content TEXT,
    author VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 为每篇文章生成 tsvector
SELECT id, 
       title,
       to_tsvector('english', title) ||
       to_tsvector('english', content) AS search_vector
FROM articles;

-- 创建全文搜索专用列
ALTER TABLE articles ADD COLUMN search_vector tsvector;

UPDATE articles 
SET search_vector = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''));

-- 或者使用触发器自动更新
CREATE OR REPLACE FUNCTION articles_search_trigger() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tsvector_update BEFORE INSERT OR UPDATE
ON articles FOR EACH ROW EXECUTE PROCEDURE articles_search_trigger();
```

## tsquery

### 基本操作

```sql
-- 将查询转为 tsquery
SELECT to_tsquery('english', 'PostgreSQL & database');

-- 结果：
-- 'postgresql' & 'databases'

-- 支持的操作符
SELECT to_tsquery('english', 'PostgreSQL | MySQL');       -- OR
SELECT to_tsquery('english', 'PostgreSQL & database');   -- AND
SELECT to_tsquery('english', 'PostgreSQL ! MySQL');     -- NOT

-- 短语查询（用 & 连接多个词）
SELECT to_tsquery('english', 'PostgreSQL <-> database');  -- 邻近搜索
```

### 查询语法

```sql
-- 简单词
SELECT to_tsquery('english', 'database');

-- AND 连接
SELECT to_tsquery('english', 'postgresql & database');

-- OR 连接
SELECT to_tsquery('english', 'postgresql | mysql');

-- NOT
SELECT to_tsquery('english', 'database & !mysql');

-- 组合
SELECT to_tsquery('english', '(postgresql | mysql) & database');
```

### 查询格式化

```sql
-- plainto_tsquery：自动处理 AND
SELECT plainto_tsquery('english', 'PostgreSQL database');
-- 结果：'postgresql' & 'databases'

-- phraseto_tsquery：短语匹配
SELECT phraseto_tsquery('english', 'PostgreSQL database');
-- 结果：'postgresql' <-> 'databases'

-- websearch_to_tsquery：宽松语法
SELECT websearch_to_tsquery('english', 'PostgreSQL "full text" search');
-- 结果：'postgresql' & ('full' <-> 'text')
```

## 全文搜索

### 匹配操作

```sql
-- @@ 操作符匹配
SELECT * FROM articles 
WHERE search_vector @@ to_tsquery('english', 'PostgreSQL & database');

-- 使用 websearch_to_tsquery 更方便
SELECT * FROM articles 
WHERE search_vector @@ websearch_to_tsquery('english', 'PostgreSQL database');
```

### 搜索结果排序

```sql
-- 按相关性排序
SELECT id, title, ts_rank(search_vector, query) AS rank
FROM articles, 
     to_tsquery('english', 'PostgreSQL & database') query
WHERE search_vector @@ query
ORDER BY rank DESC;

-- 使用 ts_rank_cd（更复杂的排名算法）
SELECT id, title, ts_rank_cd(search_vector, query, 32) AS rank
FROM articles,
     to_tsquery('english', 'PostgreSQL & database') query
WHERE search_vector @@ query
ORDER BY rank DESC;
```

### 高亮显示

```sql
-- 使用 ts_headline 生成高亮片段
SELECT 
    id,
    ts_headline(
        'english',
        content,
        query,
        'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>'
    ) AS headline
FROM articles,
     to_tsquery('english', 'PostgreSQL') query
WHERE search_vector @@ query;

-- 返回类似：
-- ...PostgreSQL is a powerful <mark>database</mark> system...
```

## 全文索引

### GIN 索引

```sql
-- 为 tsvector 列创建 GIN 索引
CREATE INDEX idx_articles_search ON articles USING GIN (search_vector);

-- 创建表达式索引
CREATE INDEX idx_articles_title_search ON articles USING GIN (to_tsvector('english', title));
```

### 索引的优缺点

```
GIN 索引特点：

优点：
- 对于全文搜索非常高效
- 适合多值列（数组、tsvector）
- 插入性能比 B-Tree 好（对于文本搜索）

缺点：
- 索引较大
- 某些操作不支持
```

### 索引使用示例

```sql
-- 创建表
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200),
    body TEXT,
    search_vector tsvector
);

-- 创建 GIN 索引
CREATE INDEX idx_posts_search ON posts USING GIN (search_vector);

-- 创建触发器自动更新
CREATE TRIGGER posts_search_update BEFORE INSERT OR UPDATE
ON posts FOR EACH ROW EXECUTE PROCEDURE tsvector_update_trigger('search_vector', 'pg_catalog.english', 'title', 'body');

-- 执行搜索
EXPLAIN SELECT * FROM posts 
WHERE search_vector @@ websearch_to_tsquery('english', 'PostgreSQL performance optimization');
```

## 高级搜索

### 邻近搜索

```sql
-- 查找 title 中 'PostgreSQL' 紧跟在 'database' 后面
SELECT * FROM articles 
WHERE to_tsvector('english', title) @@ 
      to_tsquery('english', 'database <-> PostgreSQL');

-- 允许一个词间隔
SELECT * FROM articles 
WHERE to_tsvector('english', title) @@ 
      to_tsquery('english', 'database <-> 1 PostgreSQL');
```

### 加权搜索

```sql
-- 为不同字段设置权重
ALTER TABLE articles ADD COLUMN search_vector tsvector;

UPDATE articles SET search_vector =
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||    -- 标题权重最高
    setweight(to_tsvector('english', coalesce(content, '')), 'B');   -- 内容权重较低

-- 搜索时也设置权重
SELECT id, title, 
       ts_rank_cd(
           setweight(to_tsvector('english', title), 'A') ||
           setweight(to_tsvector('english', content), 'B'),
           query
       ) AS rank
FROM articles,
     websearch_to_tsquery('english', 'PostgreSQL') query
WHERE search_vector @@ query
ORDER BY rank DESC;
```

### 多语言支持

```sql
-- 创建多语言搜索
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    title_en TEXT,
    title_zh TEXT,
    content_en TEXT,
    content_zh TEXT
);

-- 合并多语言 tsvector
ALTER TABLE documents ADD COLUMN search_vector tsvector;

UPDATE documents SET search_vector =
    setweight(to_tsvector('english', coalesce(title_en, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_en, '')), 'B') ||
    setweight(to_tsvector('chinese', coalesce(title_zh, '')), 'A') ||
    setweight(to_tsvector('chinese', coalesce(content_zh, '')), 'B');

-- 搜索
SELECT * FROM documents
WHERE search_vector @@ websearch_to_tsquery('english', 'PostgreSQL');
```

## 中文分词

### 安装 zhparser

```bash
# Linux/macOS
git clone https://github.com/amutu/zhparser.git
cd zhparser
make && make install

# PostgreSQL 中创建扩展
psql -d mydb -c "CREATE EXTENSION zhparser;"
```

### 使用中文分词

```sql
-- 创建文本搜索配置
CREATE TEXT SEARCH CONFIGURATION zhcfg (PARSER = zhparser);

-- 添加词典映射
ALTER TEXT SEARCH CONFIGURATION zhcfg ADD MAPPING FOR n,v,a,i,e,l WITH simple;

-- 测试中文分词
SELECT to_tsvector('zhcfg', 'PostgreSQL是最强大的开源数据库');
-- 结果：'postgresql':1 '数据':6 '库':8 '开源':4 '最':2 '强大':5

-- 中文搜索
SELECT * FROM articles
WHERE to_tsvector('zhcfg', title || ' ' || content) @@ 
      to_tsquery('zhcfg', '数据库 & PostgreSQL');
```

## Java 实现

### JPA 全文搜索

```java
@Entity
@Table(name = "articles")
public class Article {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String title;
    
    @Column(columnDefinition = "tsvector")
    private String searchVector;  // 使用 @Column 存储 tsvector
    
    @Query(value = """
        SELECT * FROM articles 
        WHERE search_vector @@ plainto_tsquery('english', :keyword)
        ORDER BY ts_rank(search_vector, plainto_tsquery('english', :keyword)) DESC
        """, nativeQuery = true)
    List<Article> searchArticles(@Param("keyword") String keyword);
}
```

### MyBatis 全文搜索

```java
@Select("""
    SELECT id, title, 
           ts_headline('english', content, query, 
                       'MaxWords=50, MinWords=20') AS snippet
    FROM articles,
         websearch_to_tsquery('english', #{keyword}) query
    WHERE search_vector @@ query
    ORDER BY ts_rank(search_vector, query) DESC
    LIMIT 10
    """)
List<ArticleSearchResult> searchArticles(@Param("keyword") String keyword);
```

## 性能优化

### 索引 vs 全表扫描

```sql
-- 查看是否使用索引
EXPLAIN SELECT * FROM articles 
WHERE search_vector @@ to_tsquery('english', 'PostgreSQL');

-- 确保索引存在
\d articles  -- 查看表结构
\d idx_articles_search  -- 查看索引
```

### 批量插入优化

```sql
-- 禁用索引更新，批量插入后再重建
ALTER TABLE articles DISABLE TRIGGER tsvector_update;

COPY articles (id, title, content) FROM '/tmp/articles.csv';

ALTER TABLE articles ENABLE TRIGGER tsvector_update;

UPDATE articles SET search_vector = 
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''));

REINDEX INDEX idx_articles_search;
```

## 面试高频问题

### Q1: PostgreSQL 全文搜索的核心概念是什么？

**考察点**：基本概念

**参考答案**：
- tsvector：文档的分词向量表示
- tsquery：查询的分词表示
- @@：全文匹配操作符
- GIN 索引：加速全文搜索

### Q2: GIN 索引和 B-Tree 索引有什么区别？

**考察点**：索引原理

**参考答案**：
- GIN：倒排索引，适合多值和全文搜索
- B-Tree：有序索引，适合等值和范围查询
- 全文搜索必须用 GIN 索引

### Q3: 如何实现中文全文搜索？

**考察点**：高级特性

**参考答案**：
1. 安装 zhparser 扩展
2. 创建文本搜索配置
3. 使用中文分词配置创建 tsvector
4. 为 tsvector 创建 GIN 索引
5. 使用 @@ 操作符匹配

### Q4: 如何提高相关性排序？

**考察点**：搜索优化

**参考答案**：
1. 为不同字段设置权重（标题 > 内容）
2. 使用 ts_rank_cd 替代 ts_rank
3. 考虑查询词的位置和密度
4. 调整排名参数

## 总结

PostgreSQL 全文检索体系：

| 组件 | 说明 |
|------|------|
| to_tsvector | 文本 → 分词向量 |
| to_tsquery | 查询 → 分词查询 |
| ts_rank | 相关性排名 |
| GIN 索引 | 加速搜索 |
| zhparser | 中文分词 |

适用场景：
- 简单的搜索需求（替代 Elasticsearch）
- 需要精确控制的搜索
- 多语言搜索
- 加权搜索

对于复杂的搜索需求，可能仍需要 Elasticsearch，但 PostgreSQL 可以作为轻量级替代。
