# 字符串匹配：KMP、Boyer-Moore、Rabin-Karp


## 一行日志引出的算法问题

凌晨2点，线上告警。日志里全是这样的内容：

```
ERROR: Pattern not found in text...
ERROR: Pattern not found in text...
```

你查看监控系统，发现搜索服务的 CPU 占用率飙到了 90%。这个服务做的是字符串匹配——在一个大文本里查找关键词。

如果用最朴素的方法（暴力匹配），每次匹配失败都要回退，时间复杂度是 O(n × m)，n 是文本长度，m 是模式长度。

对于每天处理上亿条日志的系统来说，这简直是灾难。

这就是为什么需要**字符串匹配算法**——让「大海捞针」变得高效。


## 朴素匹配：暴力但不愚蠢

### 暴力匹配的思想

文本 T = "AABAABAB"，模式 P = "ABAB"。

```
T: A A B A A B A B
P: A B A B
     ↑
     匹配失败，i 回退，j 重置
```

伪代码：

```java
int bruteForce(String text, String pattern) {
    int n = text.length();
    int m = pattern.length();
    
    for (int i = 0; i <= n - m; i++) {
        int j = 0;
        while (j < m && text.charAt(i + j) == pattern.charAt(j)) {
            j++;
        }
        if (j == m) {
            return i;  // 找到匹配
        }
    }
    return -1;  // 未找到
}
```

### 朴素匹配的问题

时间复杂度 O(n × m)，最坏情况下：

```
T: A A A A A A A B
P: A A B

每次都在最后一个字符失败
```

但朴素匹配也有优点：**不需要预处理，空间复杂度 O(1)**。对于小规模数据或随机文本，实际效率未必很差。


## KMP 算法：跳过已匹配的部分

### 核心思想

KMP（Knuth-Morris-Pratt）的核心是：**当匹配失败时，利用已匹配的信息，跳过不可能成功的比较**。

关键概念：**最长公共前后缀**（Longest Proper Prefix which is also Suffix，简称 LPS）。

```
模式: A B A B D
索引: 0 1 2 3 4

前缀: A, AB, ABA, ABAB（不包括最后一个）
后缀: D, BD, ABD, BABD（不包括第一个）

LPS[4] = 0 （没有公共前后缀）
```

### LPS 数组的计算

LPS[i] 表示模式[0...i] 的最长公共前后缀长度。

```java
int[] computeLPS(String pattern) {
    int m = pattern.length();
    int[] lps = new int[m];
    int len = 0;  // 当前最长公共前后缀长度
    int i = 1;
    
    lps[0] = 0;  // 第一个字符没有前后缀
    
    while (i < m) {
        if (pattern.charAt(i) == pattern.charAt(len)) {
            len++;
            lps[i] = len;
            i++;
        } else {
            if (len != 0) {
                // 尝试用更短的公共前后缀
                len = lps[len - 1];
            } else {
                lps[i] = 0;
                i++;
            }
        }
    }
    return lps;
}
```

### KMP 完整实现

```java
public int kmpSearch(String text, String pattern) {
    int n = text.length();
    int m = pattern.length();
    
    if (m == 0) return 0;
    
    int[] lps = computeLPS(pattern);
    int i = 0;  // text 的索引
    int j = 0;  // pattern 的索引
    
    while (i < n) {
        if (text.charAt(i) == pattern.charAt(j)) {
            i++;
            j++;
        }
        
        if (j == m) {
            // 找到匹配，返回起始位置
            return i - j;
        } else if (i < n && pattern.charAt(j) != text.charAt(i)) {
            // 匹配失败，利用 LPS 跳过
            if (j != 0) {
                j = lps[j - 1];
            } else {
                i++;
            }
        }
    }
    return -1;
}
```

### KMP 为什么快？

朴素匹配中，匹配失败时 i 和 j 都要回退。

KMP 中，j 跳转到 lps[j-1] 的位置（已经匹配的部分可以利用），i 保持不变或前进。

时间复杂度：**O(n + m)**，预处理 O(m)，匹配 O(n)。


## Boyer-Moore：反向匹配，从右往左

### 启发式规则

BM 算法从模式的最右端开始匹配，当匹配失败时，利用两个启发式规则跳跃：

**1. 坏字符规则（Bad Character）**

当文本字符与模式字符不匹配时，把这个文本字符称为「坏字符」。

```
Text:    ... A B C D E F ...
Pattern:   A B C X Y Z
                   ↑
                   坏字符是 F（在 Text 中），X（在 Pattern 中）
```

跳跃距离 = 坏字符在模式中最右出现位置到末尾的距离。

```java
private int getBadCharShift(char badChar, String pattern, int j) {
    // 在模式[0...j]中查找最右出现的位置
    for (int i = j; i >= 0; i--) {
        if (pattern.charAt(i) == badChar) {
            return j - i;
        }
    }
    return j + 1;  // 坏字符不在模式中，跳过整个模式
}
```

**2. 好后缀规则（Good Suffix）**

当匹配成功后（部分后缀匹配），利用这个已匹配的「好后缀」来跳跃。

```java
private int getGoodSuffixShift(String suffix, String pattern, int j) {
    // 查找模式中与 suffix 匹配的另一个位置
    for (int i = 0; i <= j; i++) {
        if (pattern.substring(i, i + suffix.length()).equals(suffix)) {
            return j - i + 1;
        }
    }
    return pattern.length();  // 没有匹配，跳过整个模式
}
```

### BM 算法实现

```java
public int boyerMooreSearch(String text, String pattern) {
    int n = text.length();
    int m = pattern.length();
    
    if (m == 0) return 0;
    if (m > n) return -1;
    
    // 从模式最右端开始匹配
    int i = m - 1;
    
    while (i < n) {
        int j = m - 1;
        
        // 从右向左比较
        while (j >= 0 && text.charAt(i) == pattern.charAt(j)) {
            i--;
            j--;
        }
        
        if (j < 0) {
            return i + 1;  // 找到匹配
        }
        
        // 匹配失败，取两个规则的最大跳跃距离
        int badCharShift = getBadCharShift(text.charAt(i), pattern, j);
        int goodSuffixShift = getGoodSuffixShift(
            pattern.substring(j + 1), pattern, j);
        i += Math.max(badCharShift, goodSuffixShift);
    }
    return -1;
}
```

### BM 为什么在实际中很快？

BM 在匹配过程中，模式移动的幅度通常很大，特别是当文本中出现的坏字符不在模式中时，可以直接跳过整个模式。

平均复杂度：**O(n / m)**，实践中往往比 KMP 更快。


## Rabin-Karp：哈希的妙用

### 核心思想

使用滚动哈希，把模式转换为一个数值，然后比较文本子串和模式的哈希值。

```java
private static final int BASE = 31;  // 哈希基数
private static final int MOD = 1000000007;  // 大素数取模

public int rabinKarpSearch(String text, String pattern) {
    int n = text.length();
    int m = pattern.length();
    
    if (m > n) return -1;
    
    // 计算模式的哈希值
    int patternHash = hash(pattern, 0, m);
    
    // 计算文本第一个窗口的哈希值
    int textHash = hash(text, 0, m);
    
    // 遍历所有可能的起始位置
    for (int i = 0; i <= n - m; i++) {
        // 哈希值相同，再逐字符比较（防止哈希碰撞）
        if (textHash == patternHash) {
            boolean match = true;
            for (int j = 0; j < m; j++) {
                if (text.charAt(i + j) != pattern.charAt(j)) {
                    match = false;
                    break;
                }
            }
            if (match) return i;
        }
        
        // 计算下一个窗口的哈希值（滚动哈希）
        if (i < n - m) {
            textHash = nextHash(text, textHash, i, m);
        }
    }
    return -1;
}

private int hash(String s, int start, int len) {
    int hash = 0;
    for (int i = start; i < start + len; i++) {
        hash = (hash * BASE + s.charAt(i)) % MOD;
    }
    return hash;
}

// 滚动计算下一个哈希值
private int nextHash(String text, int prevHash, int start, int len) {
    int high = text.charAt(start + len - 1);
    int low = text.charAt(start);
    int newHash = ((prevHash - low * pow(BASE, len - 1) % MOD + MOD) % MOD * BASE + high) % MOD;
    return newHash;
}
```

### Rabin-Karp 的特点

**优点：**
- 实现简单
- 可以同时匹配多个模式（一次计算，多个比较）
- 适合大数据场景（文本搜索、DNA 匹配）

**缺点：**
- 存在哈希碰撞，需要二次验证
- 取模运算可能溢出
- 最坏情况 O(n × m)


## 三种算法的对比

| 算法 | 预处理时间 | 匹配时间 | 空间复杂度 | 特点 |
|------|------------|----------|------------|------|
| 朴素匹配 | 无 | O(n × m) | O(1) | 简单，适用于小数据 |
| KMP | O(m) | O(n) | O(m) | 利用已匹配信息 |
| Boyer-Moore | O(m) | O(n / m) ~ O(n × m) | O(m) | 从右向左，适合大字符集 |
| Rabin-Karp | O(m) | O(n × m)（碰撞多时） | O(1) | 哈希思想，可多模式 |

### 实际选择

- **字符集较小（如 DNA）**：Boyer-Moore 非常快
- **一般文本搜索**：KMP 稳定可靠
- **需要同时匹配多模式**：Rabin-Karp
- **小数据量**：朴素匹配足够


## 实战：找出所有匹配位置

```java
public List&lt;Integer&gt; findAllMatches(String text, String pattern) {
    List&lt;Integer&gt; result = new ArrayList&lt;&gt;();
    int[] lps = computeLPS(pattern);
    
    int i = 0, j = 0;
    while (i < text.length()) {
        if (text.charAt(i) == pattern.charAt(j)) {
            i++;
            j++;
        }
        
        if (j == pattern.length()) {
            result.add(i - j);  // 找到一个匹配
            j = lps[j - 1];  // 继续找下一个
        } else if (i < text.length() && pattern.charAt(j) != text.charAt(i)) {
            if (j != 0) {
                j = lps[j - 1];
            } else {
                i++;
            }
        }
    }
    return result;
}
```


## 总结

字符串匹配算法的演进，体现了算法设计的核心思想：

1. **朴素匹配**：不依赖额外信息，简单但低效
2. **KMP**：利用「记忆」，跳过已知的无用比较
3. **Boyer-Moore**：逆向思考，从最特殊的情况出发
4. **Rabin-Karp**：空间换时间，用哈希压缩信息

没有「最好」的算法，只有「最适合」的算法。

## 面试追问方向

- KMP 的 LPS 数组是什么？它为什么能让匹配跳过已经匹配的部分？
- BM 算法的好后缀规则和坏字符规则哪个更重要？（通常坏字符规则贡献更大跳跃）
- Rabin-Karp 如何处理哈希碰撞？（二次验证）
- 除了这三种，还有哪些字符串匹配算法？（Sunday 算法、Shift-And/Shift-Or）
- 如果要在一亿条日志中搜索一万个关键词，怎么做？（AC 自动机——多模式匹配）
