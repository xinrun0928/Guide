# 哈夫曼树与哈夫曼编码


## 压缩的艺术

你知道吗？

英文中最常见的字母是「E」，出现的频率高达 12.7%。而字母「Z」出现的频率只有 0.07%。

如果都用同样的二进制位数来表示每个字母，显然是浪费——「E」应该用更短的编码，「Z」可以用更长的编码。

这就是**哈夫曼编码**的核心思想：**用更短的编码表示高频字符，用更长的编码表示低频字符**。

而实现这个思想的树形结构，就是**哈夫曼树**。


## 哈夫曼树的定义

### 什么是哈夫曼树？

哈夫曼树（最优二叉树）是一种带权路径长度最短的二叉树。

**关键概念：**
- **权值**：每个叶子节点有一个权值（通常表示频率）
- **路径长度**：从根到该节点的路径长度
- **带权路径长度（WPL）**：Σ(权值 × 路径长度)

**哈夫曼树的定义**：对于给定的权值集合，带权路径长度最小的二叉树。

### 哈夫曼树的构建过程

**步骤：**
1. 将所有节点放入一个最小堆
2. 取出两个权值最小的节点，合并成一个新节点（权值为两者之和）
3. 将新节点放回堆中
4. 重复 2-3，直到只剩一个节点

**例子**：权值集合 {5, 10, 15, 20, 25}

```
第1步：取出 5 和 10，合并成 15
       [5] [10] → [15]
       
第2步：取出 15(新) 和 15，合并成 30
       [15] [15] → [30]
       
第3步：取出 20 和 25，合并成 45
       [20] [25] → [45]
       
第4步：取出 30 和 45，合并成 75（根节点）
       [30] [45] → [75]

最终树:
           75(根)
          /    \
        30      45
       /  \    /  \
      15  15  20  25
     / \
    5  10
```

### 哈夫曼树的 Java 实现

```java
import java.util.*;

public class HuffmanTree {
    
    private class Node implements Comparable&lt;Node&gt; {
        int weight;
        Node left;
        Node right;
        
        Node(int weight) {
            this.weight = weight;
        }
        
        @Override
        public int compareTo(Node other) {
            return this.weight - other.weight;
        }
    }
    
    public Node build(int[] weights) {
        // 1. 将所有权值放入最小堆
        PriorityQueue&lt;Node&gt; minHeap = new PriorityQueue&lt;&gt;();
        for (int w : weights) {
            minHeap.offer(new Node(w));
        }
        
        // 2. 反复取出最小的两个节点，合并
        while (minHeap.size() > 1) {
            Node left = minHeap.poll();
            Node right = minHeap.poll();
            
            Node parent = new Node(left.weight + right.weight);
            parent.left = left;
            parent.right = right;
            
            minHeap.offer(parent);
        }
        
        return minHeap.poll();
    }
    
    // 计算带权路径长度
    public int calculateWPL(Node root) {
        return calculateWPL(root, 0);
    }
    
    private int calculateWPL(Node node, int depth) {
        if (node == null) return 0;
        if (node.left == null && node.right == null) {
            return node.weight * depth;
        }
        return calculateWPL(node.left, depth + 1) 
             + calculateWPL(node.right, depth + 1);
    }
}
```


## 哈夫曼编码

### 编码规则

哈夫曼编码的规则很简单：**左分支为 0，右分支为 1**。

从根到叶子节点的路径上的所有 0/1 组合，就是该叶子节点的编码。

```
哈夫曼树:
           根
          /  \
        0/    \1
        ●      ●
       / \    / \
      0/  \1 0/  \1
      A    B  C    D

A: 0      B: 10    C: 110    D: 111
```

### 编码 vs 定长编码

假设字符集 {A, B, C, D}，频率 {45, 30, 15, 10}：

**定长编码**（需要 2 位）：
- A: 00, B: 01, C: 10, D: 11
- WPL = 45×2 + 30×2 + 15×2 + 10×2 = 200

**哈夫曼编码**：
- A: 0, B: 10, C: 110, D: 111
- WPL = 45×1 + 30×2 + 15×3 + 10×3 = 180

压缩率 = (200 - 180) / 200 = 10%

### 哈夫曼编码的特点

1. **前缀唯一性**：任何一个字符的编码都不是另一个字符编码的前缀
2. **无歧义解码**：可以唯一地还原原始字符串
3. **最优性**：在所有前缀编码中，哈夫曼编码的 WPL 最小


## 实战：哈夫曼编码的实现

```java
import java.util.*;

public class HuffmanCoding {
    
    // 统计字符频率
    public Map&lt;Character, Integer&gt; buildFreqTable(String text) {
        Map&lt;Character, Integer&gt; freq = new HashMap&lt;&gt;();
        for (char c : text.toCharArray()) {
            freq.put(c, freq.getOrDefault(c, 0) + 1);
        }
        return freq;
    }
    
    // 构建哈夫曼树
    public Node buildHuffmanTree(Map&lt;Character, Integer&gt; freq) {
        PriorityQueue&lt;Node&gt; minHeap = new PriorityQueue&lt;&gt;();
        
        for (Map.Entry&lt;Character, Integer&gt; entry : freq.entrySet()) {
            minHeap.offer(new Node(entry.getKey(), entry.getValue()));
        }
        
        while (minHeap.size() > 1) {
            Node left = minHeap.poll();
            Node right = minHeap.poll();
            Node parent = new Node(null, left.weight + right.weight);
            parent.left = left;
            parent.right = right;
            minHeap.offer(parent);
        }
        
        return minHeap.poll();
    }
    
    // 生成编码表
    public Map&lt;Character, String&gt; generateCodes(Node root) {
        Map&lt;Character, String&gt; codes = new HashMap&lt;&gt;();
        generateCodes(root, "", codes);
        return codes;
    }
    
    private void generateCodes(Node node, String code, 
                              Map&lt;Character, String&gt; codes) {
        if (node == null) return;
        
        if (node.ch != null) {
            codes.put(node.ch, code);
            return;
        }
        
        generateCodes(node.left, code + "0", codes);
        generateCodes(node.right, code + "1", codes);
    }
    
    // 编码
    public String encode(String text, Map&lt;Character, String&gt; codes) {
        StringBuilder sb = new StringBuilder();
        for (char c : text.toCharArray()) {
            sb.append(codes.get(c));
        }
        return sb.toString();
    }
    
    // 解码
    public String decode(String encoded, Node root) {
        StringBuilder sb = new StringBuilder();
        Node cur = root;
        
        for (char bit : encoded.toCharArray()) {
            cur = (bit == '0') ? cur.left : cur.right;
            
            if (cur.ch != null) {
                sb.append(cur.ch);
                cur = root;
            }
        }
        
        return sb.toString();
    }
    
    private class Node {
        Character ch;       // 字符（叶子节点才有）
        int weight;         // 权值
        Node left, right;
        
        Node(Character ch, int weight) {
            this.ch = ch;
            this.weight = weight;
        }
    }
}
```

### 使用示例

```java
public static void main(String[] args) {
    HuffmanCoding huffman = new HuffmanCoding();
    
    String text = "AAAAAABCCD";
    
    // 1. 统计频率
    Map&lt;Character, Integer&gt; freq = huffman.buildFreqTable(text);
    System.out.println("频率表: " + freq);
    // {A=6, B=2, C=2, D=1}
    
    // 2. 构建哈夫曼树
    Node root = huffman.buildHuffmanTree(freq);
    
    // 3. 生成编码
    Map&lt;Character, String&gt; codes = huffman.generateCodes(root);
    System.out.println("编码表: " + codes);
    // {A=0, B=10, C=110, D=111} 或类似
    
    // 4. 编码
    String encoded = huffman.encode(text, codes);
    System.out.println("编码后: " + encoded);
    
    // 5. 解码
    String decoded = huffman.decode(encoded, root);
    System.out.println("解码后: " + decoded);
}
```


## 哈夫曼编码的应用

### 1. 文件压缩

zip、gzip、png、jpeg 等压缩格式都用到了哈夫曼编码或其变体。

### 2. 数据传输

网络协议中常用哈夫曼编码压缩数据，减少传输量。

### 3. 内存优化

对于内存受限的嵌入式系统，可以用哈夫曼编码压缩存储。

### 4. 分词（中文 NLP）

将常用词组编码，减少存储和计算开销。


## 哈夫曼树的性质

### 性质一：哈夫曼树不唯一

当有多个权值相同的节点时，合并顺序可以不同，导致不同的树结构。但**所有哈夫曼树的 WPL 是相同的**。

### 性质二：没有度为 1 的节点

哈夫曼树是满二叉树（除了叶子节点，每个内部节点都有两个子节点）。

### 性质三：权值大的叶子节点距离根更近

哈夫曼树的贪心选择保证了高频字符路径更短。


## 总结

哈夫曼树和哈夫曼编码是「变长编码」的经典实现，核心思想是：

1. **用频率决定编码长度**：高频字符短编码，低频字符长编码
2. **前缀无歧义**：任何一个编码都不是另一个编码的前缀
3. **最优性**：在所有前缀编码中，WPL 最小

理解哈夫曼编码的关键是理解**贪心算法**的应用——每次选择两个最小权值合并，最终得到最优解。

## 面试追问方向

- 哈夫曼树的构建过程？（最小堆 + 贪心）
- 哈夫曼编码为什么能保证前缀无歧义？（每个字符都在叶子节点）
- 哈夫曼编码的 WPL 如何计算？（所有叶子节点权值 × 路径长度之和）
- 哈夫曼树和普通二叉树有什么区别？（哈夫曼树没有度为 1 的节点，是满二叉树）
- 为什么哈夫曼编码是最优前缀编码？（数学证明：任何前缀编码的 WPL 都 ≥ 哈夫曼编码的 WPL）
