# 代码审计

> 「与其在生产环境被黑客攻破，不如在代码里先找出漏洞。」

代码审计（Code Audit）是安全工作中最具技术含量的环节之一。它要求审计者不仅懂安全，还要懂开发；不仅要会用工具，还要能看懂代码。

很多人觉得代码审计是「安全大牛」才做的事，其实不然。只要掌握了正确的方法和工具组合，任何有一定编程基础的人都能进行代码审计。

## 代码审计的本质

代码审计的本质是**在代码层面寻找安全漏洞**。与渗透测试相比，代码审计能发现更深层次的逻辑漏洞、更隐蔽的后门，以及框架层面的安全问题。

**代码审计 vs 渗透测试：**

| 对比维度 | 代码审计 | 渗透测试 |
|---------|---------|---------|
| 视角 | 开发者视角 | 攻击者视角 |
| 发现的漏洞类型 | 逻辑漏洞、代码缺陷 | 可利用的漏洞 |
| 覆盖范围 | 全代码审计 or 指定代码审计 | 黑盒/灰盒测试 |
| 成本 | 高（需要审计者有代码能力） | 中 |
| 自动化程度 | 可使用 SAST 工具辅助 | 依赖人工和工具 |

## 代码审计方法论

### 黑白灰盒审计

**1. 白盒审计（静态分析）**

```java
// 白盒审计：直接阅读源代码
// 优点：能发现所有代码路径
// 缺点：代码量大时效率低
public class WhiteBoxAudit {
    // 直接看到代码逻辑
    void auditLogin() {
        String username = request.getParameter("username");
        String password = request.getParameter("password");
        
        // 审计点 1：密码是否明文传输
        // 审计点 2：SQL 拼接还是参数化查询
        // 审计点 3：登录失败是否有限制
        // 审计点 4：是否存在 SQL 注入
        
        // 漏洞示例：SQL 注入
        String sql = "SELECT * FROM users WHERE username='" + username + 
                     "' AND password='" + password + "'";
        // 直接拼接用户输入到 SQL
    }
}
```

**2. 黑盒审计（动态分析）**

```java
// 黑盒审计：通过输入输出分析行为
// 不看源码，只观察程序行为
// 优点：发现运行时问题
// 缺点：覆盖率低
public class BlackBoxAudit {
    void dynamicTest() {
        // 输入测试用例
        String[] inputs = {
            "admin' OR '1'='1",  // SQL 注入测试
            "<script>alert(1)</script>", // XSS 测试
            "../../../etc/passwd", // 路径遍历测试
        };
        
        // 观察输出和响应
        for (String input : inputs) {
            String response = httpPost("/login", "username=" + input);
            if (response.contains("error") || response.contains("root:")) {
                // 发现漏洞
            }
        }
    }
}
```

**3. 灰盒审计（结合两者）**

实际工作中最常用的方式：先用工具快速扫描，再人工复核关键点。

### 审计流程

```
┌─────────────────────────────────────────────────────┐
│ 1. 了解架构                                          │
│    ├── 技术栈（Java/PHP/Node.js...）                 │
│    ├── 框架（Spring/Django/Express...）              │
│    ├── 数据库（MySQL/PostgreSQL/MongoDB...）         │
│    └── 部署方式                                      │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│ 2. 寻找入口点                                        │
│    ├── 用户输入点（参数、Header、Cookie）             │
│    ├── 文件操作点（上传、读取、包含）                  │
│    ├── 数据库操作点（查询、更新）                     │
│    └── 命令执行点（system/exec/shell_exec）          │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│ 3. 追踪数据流                                        │
│    输入 → 过滤/校验 → 处理 → 存储/输出                │
│    找出数据流经的每一个环节                           │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│ 4. 分析安全机制                                      │
│    ├── 认证与会话管理                                │
│    ├── 权限控制                                      │
│    ├── 输入过滤                                      │
│    └── 输出编码                                      │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│ 5. 验证并编写报告                                    │
│    ├── 确认漏洞存在                                  │
│    ├── 评估危害程度                                  │
│    └── 给出修复建议                                  │
└─────────────────────────────────────────────────────┘
```

## 自动化代码审计工具

### 静态应用安全测试（SAST）

SAST（Static Application Security Testing）工具在不运行代码的情况下分析源代码。

**1. SonarQube**

```bash
# 安装 SonarQube
docker run -d --name sonarqube -p 9000:9000 sonarqube:latest

# 扫描 Java 项目
mvn sonar:sonar \
  -Dsonar.projectKey=myproject \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.login=<token>
```

```java
// SonarQube 规则示例
// 规则：S3649 - SQL 注入
// 检测到：用户输入直接拼接到 SQL 语句中
public class SonarRuleViolation {
    void bad() {
        String query = "SELECT * FROM users WHERE name = '" + userInput + "'";
        // S3649: SQL 注入漏洞
    }
    
    void good() {
        // 正确：使用参数化查询
        PreparedStatement stmt = connection.prepareStatement(
            "SELECT * FROM users WHERE name = ?"
        );
        stmt.setString(1, userInput);
    }
}
```

**2. Fortify Static Code Analyzer（SCA）**

Fortify 是商业级静态代码分析工具，准确率高，规则库丰富。

```bash
# 扫描命令
sourceanalyzer -b myproject -fs /path/to/source
sourceanalyzer -b myproject -scan -f report.fpr

# 生成报告
AuditWorkbench -o report.html -f report.fpr
```

**3. Checkmarx**

另一个商业级 SAST 工具，擅长 Java 和 .NET 项目分析。

### IDE 插件

在开发阶段就发现问题，成本最低。

```bash
# IntelliJ IDEA 安全插件
# 1. SonarLint
# 实时检测代码中的安全问题
# 安装：Settings → Plugins → SonarLint

# 2. FindBugs
# 检测 Java 字节码中的潜在 bug
# 检测漏洞类型：
# - SQL 注入
# - XSS
# - 硬编码密码
# - 不安全的随机数
```

### 代码审计工具链

```java
// 综合代码审计工具链
public class AuditToolChain {
    // 1. 基础扫描
    String[] basicScanners = {
        "SonarQube",      // 综合代码质量 + 安全
        "PMD",            // 代码规范检查
        "FindBugs/SpotBugs", // 字节码分析
    };
    
    // 2. 专业安全扫描
    String[] securityScanners = {
        "Fortify",        // 商业 SAST
        "Checkmarx",      // 商业 SAST
        "Semgrep",        // 开源轻量级 SAST
        "CodeQL",         // GitHub 出品，强大的代码分析
    };
    
    // 3. 依赖漏洞扫描
    String[] dependencyScanners = {
        "OWASP Dependency-Check",  // 检测第三方依赖漏洞
        "Snyk",                     // 支持 CI/CD 集成
        "Dependabot",               // GitHub 原生
    };
    
    // 4. 秘钥扫描
    String[] secretScanners = {
        "GitLeaks",        // 检测 Git 仓库中的秘钥
        "TruffleHog",      // 深度扫描历史提交
        "detect-secrets",  // AWS 出品，企业级
    };
}
```

## 常见漏洞审计要点

### SQL 注入

```java
// SQL 注入审计流程
public class SqlInjectionAudit {
    // 1. 搜索可疑关键字
    String[] suspiciousPatterns = {
        "executeQuery",    // JDBC
        "Statement",       // 非参数化 Statement
        "queryForObject",  // MyBatis ${}
        "selectList",      // MyBatis ${}
        "rawQuery",        // Android Room
    };
    
    // 2. MyBatis 特别关注 ${} vs #{}
    void mybatisAudit() {
        // 危险：使用 ${} 直接拼接
        @Select("SELECT * FROM user WHERE name = '${name}'")
        User findByName(String name);
        
        // 安全：使用 #{} 参数化
        @Select("SELECT * FROM user WHERE name = #{name}")
        User findByNameSafe(String name);
    }
    
    // 3. Hibernate 原生 SQL
    void hibernateAudit() {
        // 危险：createSQLQuery 拼接
        Query query = session.createSQLQuery(
            "SELECT * FROM users WHERE name = '" + name + "'"
        );
        
        // 安全：使用参数绑定
        Query query = session.createSQLQuery(
            "SELECT * FROM users WHERE name = :name"
        ).setParameter("name", name);
    }
    
    // 4. JPA 审计重点
    void jpaAudit() {
        // JPQL 也支持参数化
        @Query("SELECT u FROM User u WHERE u.name = :name")
        User findByName(@Param("name") String name);
        
        // 危险：CONCAT 拼接
        @Query("SELECT u FROM User u WHERE u.name LIKE '%' || :name || '%'")
        // 这个相对安全，但要注意 % 的处理
    }
}
```

### XSS 跨站脚本

```java
// XSS 审计流程
public class XssAudit {
    // 1. 搜索输出点
    String[] outputPoints = {
        "response.getWriter()",  // Servlet 输出
        "out.print()",            // JSP 输出
        "${}",                   // JSP EL 表达式
        "innerHTML",             // JavaScript DOM 操作
        "document.write",        // JavaScript 输出
        "th:text",               // Thymeleaf（自动编码）
        "@{ }",                  // Thymeleaf 链接
    };
    
    // 2. 检查输出编码
    void checkEncoding() {
        // Spring MVC: Model 数据默认经过 HTML 编码
        model.addAttribute("userInput", userInput);  // 安全
        
        // 危险：关闭了 Thymeleaf 的安全编码
        // th:utext 不转义
        // th:fragment 或 th:insert 可能引入 XSS
        
        // JavaScript 上下文需要 JS 编码
        // <script>var name = "${name}";</script>  // 可能被绕过
        // 正确：<script>var name = /*[[${name}]]*/ '';</script>
    }
    
    // 3. 富文本处理
    void richTextAudit() {
        // 富文本需要特殊处理
        // 白名单过滤：只允许特定标签
        // 库： OWASP Java HTML Sanitizer
        
        String sanitized = HtmlUtil.sanitize(userHtml);
    }
}
```

### 文件上传漏洞

```java
// 文件上传审计
public class FileUploadAudit {
    // 1. 检查上传路径
    void checkUploadPath() {
        // 危险：使用用户提供的文件名
        String filename = uploadedFile.getOriginalFilename();
        File dest = new File(uploadDir, filename);
        
        // 安全：使用 UUID 或随机文件名
        String filename = UUID.randomUUID().toString() + 
                         getExtension(uploadedFile.getOriginalFilename());
    }
    
    // 2. 检查文件类型验证
    void checkFileTypeValidation() {
        // 危险：只检查扩展名
        if (filename.endsWith(".jpg")) {
            // 可上传 webshell.jpg.jsp
        }
        
        // 安全：检查 MIME 类型
        String contentType = uploadedFile.getContentType();
        if (!contentType.startsWith("image/")) {
            throw new SecurityException("Invalid file type");
        }
        
        // 更安全：检查文件内容（Magic Number）
        byte[] header = getFileHeader(uploadedFile.getInputStream());
        if (!isValidImageHeader(header)) {
            throw new SecurityException("Invalid file content");
        }
    }
    
    // 3. 检查存储位置
    void checkStorageLocation() {
        // 危险：上传到 web 目录
        // 可以直接访问执行
        
        // 安全：上传到非 web 目录或对象存储
        String uploadPath = "/var/app/uploads/";  // 非 web 目录
        // 或者使用 S3/OSS 等对象存储
    }
    
    // 4. 检查文件名处理
    void checkFilenameHandling() {
        // 危险：路径穿越
        String filename = "../../../etc/passwd";
        
        // 安全：规范化和验证路径
        Path normalizedPath = Paths.get(uploadDir).resolve(filename).normalize();
        if (!normalizedPath.startsWith(uploadDir)) {
            throw new SecurityException("Invalid path");
        }
    }
}
```

### 反序列化漏洞

```java
// 反序列化审计（Java）
public class DeserializationAudit {
    // 1. 搜索反序列化点
    String[] deserializationPoints = {
        "ObjectInputStream",     // Java 原生反序列化
        "readObject",            // 调用点
        "XMLDecoder",            // XML 反序列化
        "XStream",               // XML/JSON 反序列化
        "ObjectMapper",          // Jackson JSON
        "fastjson",              // fastjson（历史漏洞多）
    };
    
    // 2. 检查反序列化配置
    void checkDeserializationConfig() {
        // 危险：未配置类型限制
        ObjectMapper mapper = new ObjectMapper();
        mapper.enableDefaultTyping();  // 开启类型处理
        
        // 安全：配置类型白名单
        ObjectMapper mapper = new ObjectMapper();
        mapper.activateDefaultTyping(
            BasicPolymorphicTypeValidator.builder()
                .allowIfBaseType(Object.class)
                .build()
        );
    }
    
    // 3. XStream 反序列化
    void xstreamAudit() {
        // 危险：默认不安全
        XStream xstream = new XStream();
        // 可以执行任意代码
        
        // 安全：配置权限控制
        XStream xstream = new XStream();
        xstream.addPermission(NoTypePermission.NONE);
        xstream.addPermission(NullPermission.NULL);
        xstream.addPermission(PrimitiveTypePermission.PRIMITIVES);
        xstream.allowTypes(new Class[]{MyClass.class});
    }
    
    // 4. 替代方案
    void alternativeAudit() {
        // 使用安全的序列化方案
        // - JSON（Jackson、Gson）
        // - Protobuf
        // - MessagePack
        
        // 避免使用
        // - Java 原生序列化
        // - XMLDecoder
        // - 有漏洞版本的 fastjson
    }
}
```

## 审计报告编写

一份合格的代码审计报告应该包含：

```markdown
# 代码审计报告

## 基本信息
- 项目名称：XXX 系统
- 审计范围：核心业务模块（登录、支付、订单）
- 审计时间：2024-XX-XX
- 审计方法：白盒审计 + 工具辅助

## 发现的漏洞

### 漏洞 1：SQL 注入
- 严重程度：高危
- 位置：`src/main/java/com/example/UserService.java:56`
- 代码：
```java
String sql = "SELECT * FROM users WHERE name = '" + username + "'";
```
- 危害：可获取数据库中所有用户数据
- 修复建议：使用参数化查询

### 漏洞 2：存储型 XSS
- 严重程度：中危
- 位置：`src/main/java/com/example/CommentController.java:88`
- 代码：
```java
model.addAttribute("comment", userInput);  // 未转义
```
- 危害：用户评论中的恶意脚本会执行
- 修复建议：使用 Thymeleaf 的 `th:text` 或手动 HTML 编码

## 总体评估
- 高危漏洞：2 个
- 中危漏洞：5 个
- 低危漏洞：8 个
- 建议优先修复高危漏洞
```

## 总结

代码审计是安全开发周期（SDL）中不可或缺的环节。

**核心要点回顾：**

1. **工具 + 人工**：先用工具快速扫描，再人工深入分析关键代码
2. **入口点追踪**：从用户输入开始，追踪数据在代码中的流向
3. **框架安全机制**：了解所用框架的安全特性，避免绕过框架的保护
4. **修复成本意识**：发现问题的阶段越早，修复成本越低
5. **持续集成**：将安全扫描集成到 CI/CD 流程中

> 代码审计不是一次性工作，而是持续的安全实践。把安全扫描融入开发流程，才能从根本上提升代码安全性。


## 面试追问方向

- 如何审计一个你不熟悉的技术栈？
- MyBatis 中 `${}` 和 `#{}` 的区别是什么？
- 如何发现代码中的后门？
- 代码审计工具的误报率如何处理？
- 如何审计微服务架构的应用？
