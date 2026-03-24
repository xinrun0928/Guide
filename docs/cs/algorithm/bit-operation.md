# 位运算：常用技巧与实战


## 为什么高手都爱用位运算？

看看这两段代码：

```java
// 普通写法
if (x >= 0 && x < array.length) {
    doSomething(array[x]);
}

// 位运算写法
if (x < array.length) {
    doSomething(array[x]);
}
```

等等，好像不太对？但如果数组长度是 2 的幂次：

```java
// 判断 x 是否在 [0, n) 且 n 是 2 的幂次
if ((x & (n - 1)) == x) {
    doSomething(array[x]);
}
```

位运算在大数据和算法题中无处不在。掌握它，你就是面试中的高手。


## 位运算基础

### 常用操作

| 操作 | 符号 | 含义 |
|------|------|------|
| 与 | `&` | 两位都为 1 才为 1 |
| 或 | `\|` | 任一位为 1 即为 1 |
| 非 | `~` | 按位取反 |
| 异或 | `^` | 两位不同为 1 |
| 左移 | `<<` | 左边移除，右边补 0 |
| 右移 | `>>` | 右边移除，左边补符号位 |
| 无符号右移 | `>>>` | 右边移除，左边补 0 |

### 基础技巧

```java
// 获取第 i 位的值（0 或 1）
int bit = (n >> i) & 1;

// 将第 i 位置为 1
n |= (1 << i);

// 将第 i 位置为 0
n &= ~(1 << i);

// 切换第 i 位
n ^= (1 << i);

// 判断第 i 位是否为 1
boolean isSet = (n & (1 << i)) != 0;

// 取最右边的 1
int rightmostOne = n & (-n);
// 原理：-n = ~n + 1，所以 n & -n = n & (~n + 1) = n & (n 取反 + 1)
// 例如 n = 12(1100)，-n = -12(~1100 + 1) = ...0100
```


## 常用位运算技巧

### 1. 判断奇偶

```java
// 普通写法
if (n % 2 == 1) { ... }

// 位运算写法
if ((n & 1) == 1) { ... }
// 原理：奇数的二进制最后一位是 1
```

### 2. 交换两个数

```java
// 普通写法
int temp = a;
a = b;
b = temp;

// 位运算写法
a = a ^ b;
b = a ^ b;  // b = (a ^ b) ^ b = a
a = a ^ b;  // a = (a ^ b) ^ a = b
```

**为什么异或可以交换？**
- `a ^ a = 0`
- `a ^ 0 = a`
- 异或满足交换律和结合律

### 3. 找出唯一出现一次的数

**问题**：一个数组中除了一个数字只出现一次外，其他数字都出现两次。找出那个只出现一次的。

```java
public int findSingle(int[] nums) {
    int result = 0;
    for (int num : nums) {
        result ^= num;  // 相同的数互相抵消
    }
    return result;
}
// 原理：a ^ a = 0，所以所有成对的数都变成 0，剩下唯一的数
```

### 4. 找出两个只出现一次的数

**问题**：其他数都出现两次，只有两个数各出现一次。

```java
public int[] findTwoSingles(int[] nums) {
    int xor = 0;
    for (int num : nums) {
        xor ^= num;
    }
    
    // 找到 xor 中最右边的一位 1
    int mask = xor & (-xor);
    
    int a = 0, b = 0;
    for (int num : nums) {
        if ((num & mask) == 0) {
            a ^= num;
        } else {
            b ^= num;
        }
    }
    
    return new int[]{a, b};
}
```

### 5. 求二进制中 1 的个数

```java
public int countBits(int n) {
    int count = 0;
    while (n != 0) {
        n = n & (n - 1);  // 每次消除最右边的 1
        count++;
    }
    return count;
}
// 原理：n-1 会把最右边的 1 变成 0，后面的 0 变成 1
// 例如 n = 12(1100), n-1 = 11(1011), n & (n-1) = 1000
```

### 6. 判断是否为 2 的幂次

```java
public boolean isPowerOfTwo(int n) {
    return n > 0 && (n & (n - 1)) == 0;
}
// 原理：2 的幂次只有一位是 1，如 8=1000
// 减 1 后变成 0111，与运算后为 0
```

### 7. 求两个数的平均值

```java
public int average(int a, int b) {
    return (a & b) + ((a ^ b) >> 1);
}
// 原理：(a & b) 保留相同的位，除以 2
// (a ^ b) 是不同的位，右移 1 位后加到前面
```


## 位运算在算法中的应用

### 1. 状态压缩 DP

**问题**：旅行商问题的简化版，城市数量 <= 20。

```java
// 用 bitmask 表示已访问的城市
// dp[mask][i] = 从 i 出发，访问状态为 mask 的最小成本

int n = cities.length;
int[][] dp = new int[1 << n][n];
Arrays.fill(dp, Integer.MAX_VALUE / 2);

for (int i = 0; i < n; i++) {
    dp[1 << i][i] = 0;
}

for (int mask = 1; mask < (1 << n); mask++) {
    for (int last = 0; last < n; last++) {
        if ((mask & (1 << last)) == 0) continue;
        
        int prevMask = mask ^ (1 << last);
        if (prevMask == 0) continue;
        
        for (int prev = 0; prev < n; prev++) {
            if ((prevMask & (1 << prev)) == 0) continue;
            dp[mask][last] = Math.min(dp[mask][last],
                dp[prevMask][prev] + dist[prev][last]);
        }
    }
}

int fullMask = (1 << n) - 1;
int answer = Integer.MAX_VALUE;
for (int i = 0; i < n; i++) {
    answer = Math.min(answer, dp[fullMask][i]);
}
```

### 2. 求子集

```java
public List&lt;List&lt;Integer&gt;&gt; subsets(int[] nums) {
    List&lt;List&lt;Integer&gt;&gt; result = new ArrayList&lt;&gt;();
    int n = nums.length;
    int total = 1 << n;
    
    for (int mask = 0; mask < total; mask++) {
        List&lt;Integer&gt; subset = new ArrayList&lt;&gt;();
        for (int i = 0; i < n; i++) {
            if ((mask & (1 << i)) != 0) {
                subset.add(nums[i]);
            }
        }
        result.add(subset);
    }
    return result;
}
```

### 3. 求子集和

```java
public int subsetSum(int[] nums, int target) {
    int[] dp = new int[target + 1];
    dp[0] = 1;
    
    for (int num : nums) {
        for (int i = target; i >= num; i--) {
            dp[i] += dp[i - num];
        }
    }
    return dp[target];
}
```


## 实战：汉明距离

**问题**：两个整数对应二进制位不同的位置数。

```java
public int hammingDistance(int x, int y) {
    int xor = x ^ y;
    int count = 0;
    while (xor != 0) {
        xor &= (xor - 1);
        count++;
    }
    return count;
}
```

**或者用 Java 内置函数**：

```java
public int hammingDistanceBuiltin(int x, int y) {
    return Integer.bitCount(x ^ y);
}
```


## 实战：数字范围按位与

**问题**：求 [m, n] 范围内所有数字按位与的结果。

```java
public int rangeBitwiseAnd(int m, int n) {
    int shift = 0;
    while (m != n) {
        m >>= 1;
        n >>= 1;
        shift++;
    }
    return m << shift;
}
// 原理：找到 m 和 n 的公共前缀
```


## 实战：UTF-8 编码验证

```java
public boolean validUtf8(int[] data) {
    int count = 0;
    for (int num : data) {
        if (count == 0) {
            if ((num >> 7) == 0b0) {
                count = 0;
            } else if ((num >> 5) == 0b110) {
                count = 1;
            } else if ((num >> 4) == 0b1110) {
                count = 2;
            } else if ((num >> 3) == 0b11110) {
                count = 3;
            } else {
                return false;
            }
        } else {
            if ((num >> 6) != 0b10) {
                return false;
            }
            count--;
        }
    }
    return count == 0;
}
```


## 总结

位运算是算法中的「瑞士军刀」，掌握它们可以：

1. **加速计算**：位运算比普通运算快
2. **节省空间**：用 bit 表示状态
3. **简化代码**：一行解决复杂逻辑

常用技巧：
- `n & (n-1)` 消除最右边的 1
- `n & (-n)` 获取最右边的 1
- `x ^ y` 交换、抵消、配对
- 状态压缩 DP 用 bitmask 表示集合

## 面试追问方向

- `n & (n-1)` 有什么用途？（消除最右边的 1、判断是否为 2 的幂次）
- `n & (-n)` 有什么用途？（获取最右边的 1）
- 如何用位运算判断奇偶？（n & 1）
- 什么是状态压缩 DP？什么时候用？（用 bit 表示集合，适合 n <= 20）
- 异或有什么性质？（a ^ a = 0, a ^ 0 = a, 满足交换律和结合律）
