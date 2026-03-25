# 浮点数精度问题与 BigDecimal

---

运行这段代码，你会得到什么结果？

```java
System.out.println(0.1 + 0.2);
```

大多数人会猜 0.3。但实际上，Java 输出的结果是：

```
0.30000000000000004
```

这不是 bug，这是 **IEEE 754 浮点数表示法** 的固有特性。理解这个问题的本质，是你进阶为靠谱 Java 程序员的必经之路。

## 为什么 0.1 + 0.2 != 0.3？

### 二进制的困境

人类习惯用十进制计数，但计算机只用二进制（0 和 1）。

十进制的 0.1，转换成二进制是一个**无限循环小数**：

```
0.1 (十进制) = 0.000110011001100110011... (二进制)
```

计算机内存是有限的，只能截取前面的位数来近似表示。这就像用 3.14 代替圆周率——有精度损失，但勉强够用。

### 精度丢失的过程

```java
// 实际存储过程（简化）
float f1 = 0.1f;  // 实际存储为 0.10000000149...
float f2 = 0.2f;  // 实际存储为 0.20000000298...
float f3 = f1 + f2; // 0.30000000447...
```

double 比 float 精度高，但问题依然存在：

```java
double d1 = 0.1;
double d2 = 0.2;
System.out.println(d1 + d2 == 0.3); // false
```

**记住这个结论：所有使用 IEEE 754 标准的浮点数，都无法精确表示某些十进制小数。**

## BigDecimal 来救场

`BigDecimal` 是 Java 提供的精确小数运算类，专治浮点数的各种不服：

```java
BigDecimal bd1 = new BigDecimal("0.1");
BigDecimal bd2 = new BigDecimal("0.2");
System.out.println(bd1.add(bd2)); // 0.3
```

**注意：构造函数一定要用字符串！**

```java
// 错误写法：仍然有精度问题
BigDecimal bd1 = new BigDecimal(0.1);
System.out.println(bd1); // 0.1000000000000000055511151231257827021181583404541015625

// 正确写法
BigDecimal bd2 = new BigDecimal("0.1");
System.out.println(bd2); // 0.1
```

为什么 `new BigDecimal(0.1)` 也有问题？因为 `0.1` 本身作为 double 传入，就已经丢失精度了。

## BigDecimal 的正确打开方式

### 创建方法对比

| 方法 | 精度问题 | 推荐程度 |
|---|---|---|
| `new BigDecimal("0.1")` | 无 | ★★★★★ |
| `BigDecimal.valueOf(0.1)` | 无 | ★★★★★ |
| `new BigDecimal(0.1)` | 有 | ❌ |
| `BigDecimal.ZERO` 常量 | 无 | ★★★★ |

```java
// 推荐：用字符串或 valueOf
BigDecimal a = new BigDecimal("0.1");
BigDecimal b = BigDecimal.valueOf(0.1); // 内部用 toString()，无精度问题

// 常用常量
BigDecimal ONE = BigDecimal.ONE;
BigDecimal TEN = BigDecimal.TEN;
BigDecimal HUNDRED = BigDecimal.valueOf(100);
```

### 常用运算

```java
BigDecimal price = new BigDecimal("19.99");
BigDecimal tax = new BigDecimal("0.13");
BigDecimal quantity = new BigDecimal("3");

// 加法
BigDecimal subtotal = price.multiply(quantity);
System.out.println("小计：" + subtotal); // 59.97

// 乘法
BigDecimal totalTax = subtotal.multiply(tax);
System.out.println("税额：" + totalTax); // 7.7961

// 除法（需要指定舍入模式）
BigDecimal total = subtotal.add(totalTax);
System.out.println("总计：" + total); // 67.7661
```

## 刻度（Scale）与精度（Precision）

```java
BigDecimal bd = new BigDecimal("123.45600");

System.out.println(bd.scale());      // 3（小数位数）
System.out.println(bd.precision());  // 6（有效数字位数）

// 去除尾部的零，精度会变
System.out.println(bd.stripTrailingZeros().scale());      // -2（科学计数法）
System.out.println(bd.stripTrailingZeros().precision());   // 3
```

## 四舍五入：setScale() 的正确姿势

除法运算必须指定舍入模式，否则会报错：

```java
BigDecimal dividend = new BigDecimal("10");
BigDecimal divisor = new BigDecimal("3");

// 错误：抛出 ArithmeticException
// dividend.divide(divisor);

// 正确：指定舍入模式
BigDecimal result = dividend.divide(divisor, 2, RoundingMode.HALF_UP);
System.out.println(result); // 3.33
```

### 常用舍入模式

| 模式 | 说明 | 示例（2.345 保留一位小数） |
|---|---|---|
| `HALF_UP` | 四舍五入 | 2.3 |
| `HALF_DOWN` | 五舍六入 | 2.3 |
| `HALF_EVEN` | 银行家舍入 | 2.3 |
| `UP` | 始终进位 | 2.4 |
| `DOWN` | 始终舍去 | 2.3 |
| `CEILING` | 向正无穷 | 2.4 |
| `FLOOR` | 向负无穷 | 2.3 |

**金融领域常用 `HALF_EVEN`（银行家舍入）**：

```java
// 1.5 -> 2, 2.5 -> 2（偶数）
BigDecimal bg1 = new BigDecimal("2.5").setScale(0, RoundingMode.HALF_EVEN); // 2
BigDecimal bg2 = new BigDecimal("3.5").setScale(0, RoundingMode.HALF_EVEN); // 4
```

## BigDecimal 比较：equals() vs compareTo()

这是另一个容易踩坑的地方：

```java
BigDecimal bd1 = new BigDecimal("1.0");
BigDecimal bd2 = new BigDecimal("1.00");
BigDecimal bd3 = new BigDecimal("1");

System.out.println(bd1.equals(bd2));     // false
System.out.println(bd1.compareTo(bd2));  // 0（相等）

System.out.println(bd1.equals(bd3));     // false
System.out.println(bd1.compareTo(bd3)); // 0（相等）
```

**`equals()` 比较的是值和精度，`compareTo()` 只比较数值大小。**

对于金钱计算，应该用 `compareTo()`：

```java
// 判断金额是否为 0
if (amount.compareTo(BigDecimal.ZERO) == 0) { ... }

// 判断是否大于 0
if (amount.compareTo(BigDecimal.ZERO) > 0) { ... }

// 判断是否相等（推荐这种方式）
if (amount.compareTo(expectedAmount) == 0) { ... }
```

## 实战案例：订单金额计算

```java
public class OrderCalculator {

    public BigDecimal calculateTotal(BigDecimal price, BigDecimal quantity, BigDecimal discountRate) {
        // 参数校验
        if (price == null || quantity == null || discountRate == null) {
            throw new IllegalArgumentException("参数不能为空");
        }

        // 使用 String 构造避免精度问题
        BigDecimal ZERO = BigDecimal.ZERO;
        if (price.compareTo(ZERO) &lt;= 0 || quantity.compareTo(ZERO) &lt;= 0) {
            throw new IllegalArgumentException("价格和数量必须大于 0");
        }

        // 计算小计
        BigDecimal subtotal = price.multiply(quantity);

        // 计算折扣
        BigDecimal discount = subtotal.multiply(discountRate);

        // 计算最终金额，保留 2 位小数
        BigDecimal total = subtotal.subtract(discount).setScale(2, RoundingMode.HALF_UP);

        return total;
    }
}
```

## 面试追问方向

- 为什么 `new BigDecimal(0.1)` 仍有精度问题？
- `RoundingMode.HALF_UP` 和 `RoundingMode.HALF_EVEN` 在什么场景下分别适用？
- BigDecimal 的性能如何？有没有更好的替代方案？

## 留给你的思考题

有这样一个需求：电商网站显示商品价格，需要精确到分。

```java
// 原价
BigDecimal originalPrice = new BigDecimal("99.9");

// 折扣率（8 折）
BigDecimal discountRate = new BigDecimal("0.8");

// 计算折后价
BigDecimal discountedPrice = originalPrice.multiply(discountRate);
System.out.println(discountedPrice); // 79.92
```

问题来了：折后价应该是 79.92 还是 79.90？

如果你在做一个金融系统，老板要求**精确到分，不多也不少**，你应该如何处理？考虑 `setScale()` 的不同模式对最终金额的影响。
