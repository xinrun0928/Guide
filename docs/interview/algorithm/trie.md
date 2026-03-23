# 字典树（Trie）：前缀匹配与异或问题

> 假设你有 10 万个字符串，现在给你一个前缀，问你以这个前缀开头的字符串有多少个。

暴力做法是遍历所有字符串，一个一个匹配。但如果我告诉你，有一类数据结构专门为这种场景设计，查一次就能得到答案呢？

字典树（Trie），就是这把钥匙。


## 字典树是什么

字典树是一种树形结构，每个节点代表一个字符，从根到某个节点的路径就是一个前缀。

想象一下查字典的过程：你想找以 "ab" 开头的词，先翻到 "ab" 那一页——字典树就是这样工作的。

### 字典树的结构

```java
class TrieNode {
    // 子节点，最多 26 个字母（如果是英文）
    private TrieNode[] children;
    // 是否是单词结尾（用于判断是否存在某个单词）
    private boolean isEnd;
    // 以该节点为结尾的单词数量（用于前缀计数）
    private int prefixCount;

    public TrieNode() {
        children = new TrieNode[26];
        isEnd = false;
        prefixCount = 0;
    }
}

class Trie {
    private TrieNode root;

    public Trie() {
        root = new TrieNode();
    }
}
```


## 字典树的基本操作

### 插入

```java
public void insert(String word) {
    TrieNode node = root;
    for (char c : word.toCharArray()) {
        int idx = c - 'a';
        if (node.children[idx] == null) {
            node.children[idx] = new TrieNode();
        }
        node = node.children[idx];
        node.prefixCount++; // 每经过一个节点，前缀计数加 1
    }
    node.isEnd = true;
}
```

### 查找

```java
public boolean search(String word) {
    TrieNode node = searchPrefix(word);
    return node != null && node.isEnd;
}

// 查找前缀，返回最后一个节点
private TrieNode searchPrefix(String prefix) {
    TrieNode node = root;
    for (char c : prefix.toCharArray()) {
        int idx = c - 'a';
        if (node.children[idx] == null) {
            return null;
        }
        node = node.children[idx];
    }
    return node;
}
```

### 查找前缀

```java
public int countPrefix(String prefix) {
    TrieNode node = searchPrefix(prefix);
    return node == null ? 0 : node.prefixCount;
}
```

**为什么 TrieNode 要存 prefixCount？**

因为查询「以某前缀开头的单词数量」，需要知道有多少个字符串经过这个节点。插入时累加，查询时直接返回，时间复杂度 O(字符串长度)。


## 经典问题：前缀计数

> 题目：实现一个 Trie 类，支持 insert(插入字符串)、search(精确匹配)、startsWith(前缀匹配)。

```java
class Trie {
    private TrieNode root;

    public Trie() {
        root = new TrieNode();
    }

    public void insert(String word) {
        TrieNode node = root;
        for (char c : word.toCharArray()) {
            int idx = c - 'a';
            if (node.children[idx] == null) {
                node.children[idx] = new TrieNode();
            }
            node = node.children[idx];
            node.prefixCount++;
        }
        node.isEnd = true;
    }

    public boolean search(String word) {
        TrieNode node = searchPrefix(word);
        return node != null && node.isEnd;
    }

    public boolean startsWith(String prefix) {
        TrieNode node = searchPrefix(prefix);
        return node != null;
    }

    private TrieNode searchPrefix(String prefix) {
        TrieNode node = root;
        for (char c : prefix.toCharArray()) {
            int idx = c - 'a';
            if (node.children[idx] == null) {
                return null;
            }
            node = node.children[idx];
        }
        return node;
    }
}
```


## 经典问题：添加与搜索

> 题目：在 Trie 中，除了普通字符，还支持 '.' 可以匹配任意字符。如何实现？

```java
public boolean searchWithWildcard(String word) {
    return dfsSearch(root, word, 0);
}

private boolean dfsSearch(TrieNode node, String word, int idx) {
    if (idx == word.length()) {
        return node.isEnd;
    }

    char c = word.charAt(idx);
    if (c == '.') {
        // 遍历所有子节点，递归匹配
        for (TrieNode child : node.children) {
            if (child != null && dfsSearch(child, word, idx + 1)) {
                return true;
            }
        }
        return false;
    } else {
        int i = c - 'a';
        if (node.children[i] == null) {
            return false;
        }
        return dfsSearch(node.children[i], word, idx + 1);
    }
}
```

**为什么用 DFS 而不是循环？**

因为 '.' 可以匹配任意字符，需要尝试所有可能的分支，递归天然适合这种「不确定」的匹配。


## 经典问题：单词搜索 II

> 题目：给定一个二维网格和一个字典，找出所有在网格中出现的单词。单词必须按字母顺序相邻的单元格构成。

```java
public List<String> findWords(char[][] board, String[] words) {
    List<String> result = new ArrayList<>();
    Trie trie = new Trie();

    // 先把所有单词插入 Trie
    for (String word : words) {
        trie.insert(word);
    }

    int m = board.length;
    int n = board[0].length;

    // DFS 遍历网格
    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            dfs(board, i, j, trie.root, "", result);
        }
    }
    return result;
}

private void dfs(char[][] board, int i, int j, TrieNode node, String path, List<String> result) {
    // 越界检查
    if (i < 0 || i >= board.length || j < 0 || j >= board[0].length) {
        return;
    }

    char c = board[i][j];
    TrieNode next = ((Trie) (Object) node).searchChild(c); // 查找子节点

    if (next == null) return; // 不存在这个前缀，直接返回

    String newPath = path + c;
    if (next.isEnd) {
        result.add(newPath);
        next.isEnd = false; // 防止重复添加
    }

    // 标记已访问，继续 DFS
    board[i][j] = '#';
    int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
    for (int[] d : dirs) {
        dfs(board, i + d[0], j + d[1], next, newPath, result);
    }
    board[i][j] = c; // 回溯
}
```

**为什么要标记已访问？**

因为网格中的格子不能重复使用，走过的路不能回头。回溯时恢复原值，为其他路径腾出可能。


## 进阶：字典树与异或问题

字典树不仅能处理前缀问题，还能处理一类特殊的「异或」问题。

> 题目：给定一个数组，找出其中的两个数，使得它们的异或值最大。

核心思想：**把数字的二进制表示插入 Trie，从高位到低位贪心**。

```java
public int findMaximumXOR(int[] nums) {
    TrieNode root = new TrieNode();

    // 先插入第一个数字
    insert(nums[0]);

    int maxXor = 0;
    for (int i = 1; i < nums.length; i++) {
        // 找与 nums[i] 异或最大的数
        maxXor = Math.max(maxXor, findMaxXor(nums[i]));
        // 把 nums[i] 插入 Trie
        insert(nums[i]);
    }
    return maxXor;
}

// 向 Trie 插入一个数字（从高位到低位）
private void insert(int num) {
    TrieNode node = root;
    for (int i = 31; i >= 0; i--) {
        int bit = (num >> i) & 1;
        if (node.children[bit] == null) {
            node.children[bit] = new TrieNode();
        }
        node = node.children[bit];
    }
}

// 找与 num 异或最大的数
private int findMaxXor(int num) {
    TrieNode node = root;
    int maxNum = 0;
    for (int i = 31; i >= 0; i--) {
        int bit = (num >> i) & 1;
        // 贪心：尽量走相反的位（1^1=0, 1^0=1）
        int opposite = bit ^ 1;
        if (node.children[opposite] != null) {
            maxNum |= (1 << i);
            node = node.children[opposite];
        } else {
            node = node.children[bit];
        }
    }
    return maxNum;
}
```

**为什么从高位到低位贪心？**

因为高位的变化对结果影响更大。如果高位能取到 1，就一定要取到 1（异或运算中，1 xor 0 = 1，0 xor 1 = 1）。


## 字典树小结

| 操作 | 时间复杂度 | 空间复杂度 |
|------|------------|------------|
| 插入 | O(L) | O(L) |
| 查找 | O(L) | - |
| 前缀计数 | O(L) | - |
| 异或最大 | O(L) | O(L) |

L 是字符串/数字的长度。


## 面试追问预判

1. **字典树和哈希表相比，有什么优劣？**
   - 字典树：支持前缀查询，节省前缀相同的存储空间
   - 哈希表：单次查询 O(1)，但不支持前缀

2. **字典树能节省多少空间？**
   - 如果有 10000 个字符串，平均长度 10，前缀相同率 50%
   - 哈希表需要 100000 个节点，字典树可能只需要 50000 个

3. **字典树能删除节点吗？**
   - 可以，但需要更新路径上所有节点的计数
   - 如果 prefixCount 变成 0，可以删除子树（可选优化）


## 记忆口诀

> **字典树，前缀搜。**
> **插入时，计数增。**
> **搜索时，从根走。**
> **遇到点，递归搜。**
> **异或题，从高走。**


## 练习建议

1. **入门**：实现 Trie → 前缀计数
2. **进阶**：添加与搜索（带通配符）→ 单词搜索 II
3. **挑战**：数组中两数最大异或值 → 前缀异或

字典树教会我们：**共享前缀，节省空间**。在算法世界里，复用是一种美德。
