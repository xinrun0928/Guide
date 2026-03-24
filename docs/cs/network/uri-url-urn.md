# URI、URL、URN 的区别

你有没有被这三个概念绕晕过？URI、URL、URN，看起来很像，但含义完全不同。

别担心，这篇文章帮你彻底理清楚。

## 一个生活的类比

先用一个生活场景来理解：

- **URI** 是「中华人民共和国北京市朝阳区建国路 88 号现代城 1 号楼 101 室」
- **URL** 是「走到楼门口，按 101，门就开了」
- **URN** 是「这套房的房产证编号：京房权证朝私字第 XXXXX 号」

简单说：
- URI 是一个「标识符」，告诉别人「这是什么」
- URL 是一个「定位符」，告诉别人「怎么找到它」
- URN 是一个「名字」，不管东西在哪，名字不变

## 三者的定义

### URI：统一资源标识符

URI（Uniform Resource Identifier）是最高层的概念，用途是**唯一地标识一个资源**。

URI 的组成规则在 RFC 3986 中定义：

```
URI = scheme ":" hier-part [ "?" query ] [ "#" fragment ]
```

根据是否有「定位」功能，URI 分为两类：
- **URL**（Uniform Resource Locator）：定位符，能找到资源的位置
- **URN**（Uniform Resource Name）：名字，资源叫什么（不管在哪）

```
URI
 ├── URL  （能定位，告诉你资源在哪）
 │    example: https://www.example.com/path/file.html
 └── URN  （只命名，不定位）
      example: urn:isbn:978-7-115-42835-3
```

### URL：统一资源定位符

URL 是最常用的，我们每天都在写。

```
协议://用户名:密码@主机名:端口号/路径?查询参数#锚点
```

完整示例：

```
https://admin:123456@www.example.com:8080/products/list?id=1001#section2
```

各部分含义：

| 部分 | 示例 | 说明 |
|------|------|------|
| 协议 | https | 访问资源使用的协议 |
| 用户名密码 | admin:123456 | 可选，用于认证 |
| 主机名 | www.example.com | 域名或 IP 地址 |
| 端口 | 8080 | 可选，默认端口省略 |
| 路径 | /products/list | 资源在服务器上的位置 |
| 查询参数 | id=1001 | 传递给服务器的参数 |
| 锚点 | section2 | 页面内的定位 |

### URN：统一资源名称

URN 的设计初衷是：给资源起一个永久的、全球唯一的名字，不管资源在哪里，这个名字都不变。

典型示例：

```
urn:isbn:978-7-115-42835-3
urn:ietf:rfc:3986
urn:uuid:6e8bc430-9c3a-11d9-9669-0800200c9a66
```

`urn:isbn:978-7-115-42835-3` 标识一本书，只要这本书还在，ISBN 号就不变，即使这本书被烧毁了、被扫描成 PDF 放在服务器上、被改编成有声书——ISBN 号始终指向这本书的概念。

## 深度对比

### URL vs URI

```
# 这是一个 URL，也是 URI
https://www.example.com/index.html

# 这只是 URI，不是 URL
mailto:user@example.com      # mailto 是协议，没有「定位」功能
urn:isbn:978-7-115-42835-3   # URN 本身只命名，不定位
```

判断方法：URL 一定能用浏览器直接访问（前提是资源存在），URI 不一定。

### 编码问题

URL 中有些字符不能直接使用，需要编码（percent-encoding）：

```
空格 → %20
中文 → %E4%B8%AD%E6%96%87
特殊符号 → %21 等
```

浏览器会自动编码，但你需要知道原理：

```java
import java.net.URLEncoder;
import java.net.URLDecoder;

public class UrlEncoding {
    public static void main(String[] args) throws Exception {
        String original = "Hello 世界!";
        String encoded = URLEncoder.encode(original, "UTF-8");
        System.out.println("编码后: " + encoded);
        // 输出: Hello+%E4%B8%96%E7%95%8C%21

        String decoded = URLDecoder.decode(encoded, "UTF-8");
        System.out.println("解码后: " + decoded);
        // 输出: Hello 世界!
    }
}
```

### 相对 URL 与绝对 URL

```html
<!-- 绝对 URL -->
<a href="https://www.example.com/products/phone">查看详情</a>

<!-- 相对 URL（相对于当前页面） -->
<a href="phone">查看详情</a>  <!-- 相对于 /products/ -->

<!-- 相对 URL（相对于域名） -->
<a href="/products/phone">查看详情</a>  <!-- 相对于域名根路径 -->

<!-- 相对 URL（上级目录） -->
<a href="../services/phone">查看详情</a>  <!-- 回到上级目录 -->
```

## 常见误解

### 误解一：URL 和 URI 是一样的

严格来说，URL 是 URI 的子集。所有 URL 都是 URI，但并非所有 URI 都是 URL。

### 误解二：URN 已经广泛使用

实际上，URN 几乎没有在实际应用中使用。我们几乎不写 `urn:isbn:xxx` 来访问图书，而是用 ISBN 去查询图书网站。

URN 更像是一个理论概念，用来解决「资源位置会变，但名字不变」的问题。

### 误解三：查询参数和锚点都会发送到服务器

**查询参数**（`?id=1`）会发送到服务器。
**锚点**（`#section`）不会发送到服务器，浏览器用锚点做页面内定位。

## 实际应用

### Java 中的 URL 处理

```java
import java.net.URI;
import java.net.URL;
import java.net.MalformedURLException;

public class UrlDemo {
    public static void main(String[] args) throws MalformedURLException {
        String urlString = "https://admin:123456@www.example.com:8080/path/to/page?id=1001#section";

        URL url = new URL(urlString);
        System.out.println("协议: " + url.getProtocol());      // https
        System.out.println("主机: " + url.getHost());            // www.example.com
        System.out.println("端口: " + url.getPort());            // 8080
        System.out.println("路径: " + url.getPath());            // /path/to/page
        System.out.println("查询: " + url.getQuery());          // id=1001
        System.out.println("锚点: " + url.getRef());            // section
        System.out.println("用户: " + url.getUserInfo());       // admin:123456

        // URL 和 URI 互转
        URI uri = url.toURI();
        URL urlFromUri = uri.toURL();
    }
}
```

### RESTful API 中的路径设计

```java
// RESTful 风格 URL 设计
GET    /users              // 获取用户列表
GET    /users/1001         // 获取 ID 为 1001 的用户
POST   /users              // 创建用户
PUT    /users/1001         // 更新用户
DELETE /users/1001          // 删除用户

// 带查询参数
GET /users?status=active&page=1&size=20

// 带路径参数
GET /users/1001/orders     // 获取用户 1001 的订单
```

## 面试追问方向

- URI 和 URL 的区别是什么？举例说明。
- URL 中的 `#` 锚点会不会发送到服务器？为什么？
- 为什么要对 URL 进行编码？哪些字符需要编码？
- `mailto:user@example.com` 是 URL 还是 URI？
- RESTful API 的 URL 设计有什么规范？
