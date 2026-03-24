# Trie 树（前缀树）：字符串检索


## 输入法的「聪明」背后

你正在用拼音输入法打字。

输入「zhong」，候选词出现了：「中国」「中间」「终于」「重要」「重视」……

按空格选了「中国」，下一个输入「guo」，候选词马上变成：「国家」「国外」「国庆」「果然」……

输入法怎么知道，当你输入「zhong」后，最可能接的是哪些词？它又是怎么快速找到这些候选词的？

答案就是**Trie 树**（前缀树，又叫字典树）。


## Trie 树的核心思想

### 什么是 Trie 树？

Trie 树是一种专门处理字符串的树形数据结构。它的核心特点是：**共享前缀的字符串，共享同一路径**。

```java
// Trie 树节点
class TrieNode {
    char ch;              // 当前字符
    boolean isEnd;        // 是否是某个字符串的结尾
    TrieNode[] children;  // 26 个子节点（假设只处理小写字母）
    
    // 其他信息
    int count;            // 以此节点为前缀的字符串数量
    String word;          // 如果是结尾，存储完整的字符串
}
```

### Trie 树 vs 哈希表

| 特性 | Trie 树 | 哈希表 |
|------|---------|--------|
| 插入/查找 | O(m)，m 为字符串长度 | O(1)（均摊） |
| 空间效率 | 前缀共享，空间可节省 | 各字符串独立存储 |
| 前缀匹配 | 原生支持 | 需要额外处理 |
| 排序 | 按字典序遍历 | 不支持 |
| 适用范围 | 字符串集合 | 任意 key |

### Trie 树的结构

```
以 ["app", "apple", "apply", "ban", "band", "bank"] 为例：

root
├── a
│   └── p
│       ├── p          ← "app"
│       │   └── l
│       │       ├── e  ← "apple"
│       │       └── y  ← "apply"
│       └── p
│           └── ...
└── b
    └── a
        └── n
            ├── d     ← "band"
            └── k     ← "bank"
```

可以看到：
- "app"、"apple"、"apply" 共享前 3 个字符
- "band"、"bank" 共享 "ban" 前缀
- 每个叶子节点代表一个完整的字符串


## Trie 树的基本操作

### 插入

```java
public void insert(String word) {
    TrieNode cur = root;
    
    for (char ch : word.toCharArray()) {
        int index = ch - 'a';
        if (cur.children[index] == null) {
            cur.children[index] = new TrieNode(ch);
        }
        cur = cur.children[index];
        cur.count++;  // 前缀计数 +1
    }
    
    cur.isEnd = true;
    cur.word = word;
}
```

### 查找

```java
public boolean search(String word) {
    TrieNode node = findNode(word);
    return node != null && node.isEnd;
}

// 查找完整路径（不包括 isEnd 判断）
private TrieNode findNode(String prefix) {
    TrieNode cur = root;
    for (char ch : prefix.toCharArray()) {
        int index = ch - 'a';
        if (cur.children[index] == null) {
            return null;
        }
        cur = cur.children[index];
    }
    return cur;
}
```

### 前缀匹配

```java
public List&lt;String&gt; startsWith(String prefix) {
    List&lt;String&gt; result = new ArrayList&lt;&gt;();
    TrieNode node = findNode(prefix);
    
    if (node != null) {
        dfs(node, result);
    }
    return result;
}

// 深度优先遍历，收集所有以 prefix 为前缀的字符串
private void dfs(TrieNode node, List&lt;String&gt; result) {
    if (node.isEnd) {
        result.add(node.word);
    }
    
    for (TrieNode child : node.children) {
        if (child != null) {
            dfs(child, result);
        }
    }
}
```

### 删除

```java
public void delete(String word) {
    delete(root, word, 0);
}

private boolean delete(TrieNode node, String word, int depth) {
    if (node == null) return false;
    
    if (depth == word.length()) {
        if (!node.isEnd) return false;
        node.isEnd = false;
        node.word = null;
        // 如果没有子节点，可以删除（递归向上处理）
        return hasNoChildren(node);
    }
    
    char ch = word.charAt(depth);
    TrieNode child = node.children[ch - 'a'];
    
    if (child == null) return false;
    
    boolean shouldDeleteChild = delete(child, word, depth + 1);
    
    if (shouldDeleteChild) {
        node.children[ch - 'a'] = null;
        // 如果当前节点不是某个字符串的结尾，且没有子节点，向上递归删除
        return !node.isEnd && hasNoChildren(node);
    }
    
    return false;
}

private boolean hasNoChildren(TrieNode node) {
    for (TrieNode child : node.children) {
        if (child != null) return false;
    }
    return true;
}
```


## Trie 树的变体与优化

### 1. 压缩前缀树（Compressed Trie）

将只有单个孩子的链压缩成一个节点，减少空间开销。

```
普通 Trie:           压缩 Trie:
root                 root
└── a                └── a
    └── b                └── bc  ← 合并 bc 链
        └── c
            └── d
```

### 2. Ternary Search Tree（三叉树）

用 BST 代替数组，每个节点有 left、eq、right 三个指针。

```java
class TernaryNode {
    char ch;
    boolean isEnd;
    TernaryNode left, eq, right;
}
```

**优势**：节省空间（只需要 3 个指针），适合字符集大的场景（如 Unicode）。

### 3. 双数组 Trie（Double Array Trie）

用两个数组实现 Trie，兼具有限自动机的高效和 Trie 的功能。常用于输入法引擎。


## Trie 树的复杂度分析

### 时间复杂度

| 操作 | 时间复杂度 |
|------|-----------|
| 插入 | O(m)，m 为字符串长度 |
| 查找 | O(m) |
| 前缀匹配 | O(m + k)，k 为匹配数量 |
| 删除 | O(m) |

### 空间复杂度

- **最坏情况**：O(m × n)，当所有字符串没有任何公共前缀
- **最优情况**：O(m + n)，当所有字符串共享前缀（m 是最长字符串长度，n 是字符串数量）


## Trie 树的实际应用

### 1. 输入法词库

```java
// 简化的输入法候选词逻辑
public List&lt;String&gt; getCandidates(String pinyin) {
    String word = pinyinToWord(pinyin);  // 拼音转拼音索引
    TrieNode node = trie.findNode(word);
    
    if (node != null) {
        // 按词频排序返回候选词
        return node.getTopWords(10);
    }
    return Collections.emptyList();
}
```

### 2. 前缀匹配提示（Auto Complete）

搜索框输入时，显示以当前输入为前缀的热门搜索词。

### 3. IP 路由表（最长前缀匹配）

路由器需要找到与目标 IP 最长匹配的前缀。Trie 树完美支持这个场景。

### 4. 字符串统计

统计一批字符串中，每个前缀出现的次数。

```java
// 统计前缀出现次数
public int countPrefix(String prefix) {
    TrieNode node = findNode(prefix);
    return node == null ? 0 : node.count;
}
```

### 5. 敏感词过滤

检测一段文本中是否包含敏感词。

```java
public class SensitiveWordFilter {
    private TrieNode root = new TrieNode();
    
    public void addSensitiveWord(String word) {
        insert(word);
    }
    
    public boolean containsSensitiveWord(String text) {
        for (int i = 0; i < text.length(); i++) {
            if (hasSensitiveWordStartingAt(text, i)) {
                return true;
            }
        }
        return false;
    }
    
    private boolean hasSensitiveWordStartingAt(String text, int start) {
        TrieNode node = root;
        for (int i = start; i < text.length(); i++) {
            char ch = text.charAt(i);
            int index = getIndex(ch);
            if (index < 0) break;  // 遇到非法字符，终止
            
            if (node.children[index] == null) break;
            node = node.children[index];
            
            if (node.isEnd) return true;  // 找到敏感词
        }
        return false;
    }
}
```


## 经典面试题

### 题目：前 K 个高频词缀（LeetCode 692）

```java
public List&lt;String&gt; topKFrequent(String[] words, int k) {
    // 1. 统计词频
    Map&lt;String, Integer&gt; freq = new HashMap&lt;&gt;();
    for (String word : words) {
        freq.put(word, freq.getOrDefault(word, 0) + 1);
    }
    
    // 2. 建立 Trie，每个节点存储以该前缀开头的所有词
    TrieNode root = new TrieNode();
    for (String word : freq.keySet()) {
        insertWord(root, word, freq.get(word));
    }
    
    // 3. 收集并排序
    List&lt;String&gt; result = new ArrayList&lt;&gt;();
    dfsCollect(root, new StringBuilder(), result);
    
    // 按词频和字典序排序
    result.sort((a, b) -> {
        int freqCompare = freq.get(b) - freq.get(a);
        return freqCompare != 0 ? freqCompare : a.compareTo(b);
    });
    
    return result.subList(0, k);
}
```


## 总结

Trie 树是处理字符串前缀匹配的神器，核心价值在于：

1. **前缀共享**：相同前缀的字符串只存储一次
2. **高效查找**：O(m) 时间复杂度，m 是字符串长度
3. **原生支持前缀匹配**：不需要额外的数据结构

适用场景：
- 输入法词库
- 搜索框自动补全
- 前缀统计
- 敏感词过滤
- IP 路由最长前缀匹配

## 面试追问方向

- Trie 树的时间空间复杂度？（时间 O(m)，空间取决于字符串相似度）
- Trie 树和哈希表的对比？（前缀匹配、排序、空间效率）
- Trie 树有什么缺点？（空间开销大，字符集大时稀疏）
- 如何优化 Trie 树的空间？（压缩、折叠、使用 Map 而非数组）
- Trie 树和前缀哈希表的区别？（哈希表无法高效前缀匹配）
