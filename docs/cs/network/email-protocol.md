# SMTP、POP3、IMAP 邮件协议

你每天都在用邮箱，但你有没有想过：邮件是怎么从你的邮箱客户端发送到收件人的邮箱的？

答案是 **邮件协议**——SMTP、POP3、IMAP。

理解这些协议，是理解电子邮件系统运作原理的关键。

## 电子邮件系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    电子邮件系统架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  发件人邮箱                                              │
│      │                                                     │
│      │ SMTP（发送）                                         │
│      ▼                                                     │
│  发送方邮件服务器（MTA）                                      │
│      │                                                     │
│      │ SMTP（转发）                                         │
│      ▼                                                     │
│  收件方邮件服务器（MTA）                                      │
│      │                                                     │
│      │ POP3/IMAP（接收）                                   │
│      ▼                                                     │
│  收件人邮箱                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 协议分工

```
SMTP（Simple Mail Transfer Protocol）：
- 发送邮件
- 邮件服务器之间转发邮件
- 端口：25（SMTP）、465（SMTPS）、587（邮件提交）

POP3（Post Office Protocol）：
- 接收邮件
- 下载到本地
- 删除服务器上的邮件

IMAP（Internet Message Access Protocol）：
- 接收邮件
- 服务器上管理邮件
- 支持多设备同步
```

## SMTP：发送邮件

### 工作原理

```
SMTP 使用命令-响应模式：

客户端 ──── HELO example.com ──────────────────> 服务器
客户端 <─── 250 OK ──────────────────────────── 服务器

客户端 ──── MAIL FROM:<sender@example.com> ──> 服务器
客户端 <─── 250 OK ──────────────────────────── 服务器

客户端 ──── RCPT TO:<receiver@example.com> ───> 服务器
客户端 <─── 250 OK ──────────────────────────── 服务器

客户端 ──── DATA ────────────────────────────────> 服务器
客户端 <─── 354 Start mail input ──────────────── 服务器

客户端 ──── From: sender@example.com ──────────> 服务器
            To: receiver@example.com
            Subject: Test

            Hello, this is a test email.
            .

客户端 <─── 250 OK Message accepted ────────── 服务器

客户端 ──── QUIT ────────────────────────────────> 服务器
客户端 <─── 221 Bye ──────────────────────────── 服务器
```

### SMTP 命令

| 命令 | 用途 |
|------|------|
| HELO/EHLO | 标识发送方身份 |
| AUTH | 身份认证 |
| MAIL FROM | 发件人地址 |
| RCPT TO | 收件人地址 |
| DATA | 开始邮件内容 |
| QUIT | 关闭连接 |

### SMTP 响应码

| 响应码 | 含义 |
|--------|------|
| 220 | 服务就绪 |
| 250 | 请求成功 |
| 354 | 开始邮件输入 |
| 421 | 服务不可用 |
| 450 | 邮箱不可用（忙） |
| 550 | 命令不可执行（邮箱不存在） |
| 553 | 邮箱名不可接受 |

## POP3：下载邮件

### 工作原理

```
POP3 三个阶段：

1. 授权阶段（Authorization）
   用户名/密码验证

2. 事务阶段（Transaction）
   列出邮件
   下载邮件
   删除邮件（可选）

3. 更新阶段（Update）
   确认删除
   关闭连接
```

### POP3 命令

```
┌─────────────────────────────────────────────────────────────┐
│                    POP3 命令                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  授权阶段：                                                 │
│  USER username          ──> 设置用户名                      │
│  PASS password          ──> 设置密码                        │
│  APOP name digest      ──> 加密认证                        │
│                                                             │
│  事务阶段：                                                 │
│  STAT                  ──> 显示邮件数量和总大小              │
│  LIST [msg]           ──> 列出邮件列表                    │
│  RETR msg              ──> 下载指定邮件                    │
│  DELE msg              ──> 删除指定邮件                    │
│  NOOP                  ──> 空操作                          │
│  RSET                  ──> 重置状态                        │
│                                                             │
│  更新阶段：                                                 │
│  QUIT                  ──> 确认删除，关闭连接               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### POP3 会话示例

```
S: +OK POP3 server ready
C: USER alice
S: +OK
C: PASS secret
S: +OK user logged in

C: STAT
S: +OK 3 4567

C: LIST
S: +OK 3 messages (4567 octets)
S: 1 1234
S: 2 567
S: 3 2766
S: .

C: RETR 1
S: +OK 1234 octets
S: [邮件内容]
S: .

C: DELE 1
S: +OK message 1 deleted

C: QUIT
S: +OK POP3 server signing off
```

## IMAP：同步管理邮件

### 为什么需要 IMAP？

```
POP3 的问题：
- 只能在本地查看
- 多设备不同步
- 删除后无法恢复

IMAP 的优势：
- 服务器上管理邮件
- 多设备实时同步
- 支持文件夹
- 支持搜索服务器端邮件
```

### IMAP 工作原理

```
IMAP 会话示例：

连接（端口 143 或 IMAPS 端口 993）

C: A001 LOGIN alice password
S: A001 OK LOGIN completed

C: A002 SELECT INBOX
S: * 23 EXISTS          ← 23 封邮件
S: * 1 RECENT          ← 1 封新邮件
S: * FLAGS (\Seen \Answered \Flagged \Deleted \Draft \Recent)
S: A002 OK [READ-WRITE] SELECT completed

C: A003 FETCH 1 BODY[TEXT]
S: * 1 FETCH (BODY[TEXT] {1234}
S: [邮件内容]
S: )
S: A003 OK FETCH completed

C: A004 STORE 1 +FLAGS (\Seen)
S: * 1 FETCH (FLAGS (\Seen \Recent))
S: A004 OK STORE completed

C: A005 LOGOUT
S: * BYE IMAP4rev1 server logging out
S: A005 OK LOGOUT completed
```

### IMAP 命令

| 命令 | 用途 |
|------|------|
| LOGIN/AUTHENTICATE | 登录 |
| SELECT | 选择邮箱 |
| EXAMINE | 只读打开邮箱 |
| LIST | 列出文件夹 |
| FETCH | 获取邮件内容 |
| STORE | 修改邮件标志 |
| COPY | 复制邮件 |
| MOVE | 移动邮件 |
| SEARCH | 搜索邮件 |
| CREATE/DELETE/RENAME | 文件夹管理 |
| LOGOUT | 退出 |

### 邮件标志

```
\Seen      ─ 已读
\Answered  ─ 已回复
\Flagged   ─ 已标记
\Deleted   ─ 已删除
\Draft     ─ 草稿
\Recent    ─ 新邮件
```

## 协议对比

```
┌─────────────────────────────────────────────────────────────┐
│                    协议对比                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┬──────────┬──────────┬──────────────┐          │
│  │          │   SMTP   │   POP3   │    IMAP     │          │
│  ├──────────┼──────────┼──────────┼──────────────┤          │
│  │ 方向      │ 发送/转发 │  下载    │ 同步管理     │          │
│  │ 端口      │ 25/587   │  110     │ 143/993     │          │
│  │ 加密      │ 465      │  995     │ IMAPS       │          │
│  │ 多设备    │ 不支持    │  不支持   │ 支持        │          │
│  │ 离线访问  │ 不支持    │  支持    │ 支持        │          │
│  │ 带宽      │ 较低     │  较高    │ 可选        │          │
│  │ 复杂性    │ 简单     │  简单    │ 复杂        │          │
│  │ 用途      │ 发邮件   │  本地备份 │ 实时同步    │          │
│  └──────────┴──────────┴──────────┴──────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 实际应用

### Java 发送邮件

```java
import javax.mail.*;
import javax.mail.internet.*;
import java.util.Properties;

public class SendEmail {
    public static void main(String[] args) {
        // 配置
        Properties props = new Properties();
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.host", "smtp.example.com");
        props.put("mail.smtp.port", "587");

        // 创建 Session
        Session session = Session.getInstance(props,
            new Authenticator() {
                protected PasswordAuthentication getPasswordAuthentication() {
                    return new PasswordAuthentication(
                        "alice@example.com", "password");
                }
            });

        try {
            // 创建邮件
            Message message = new MimeMessage(session);
            message.setFrom(new InternetAddress("alice@example.com"));
            message.setRecipients(Message.RecipientType.TO,
                InternetAddress.parse("bob@example.com"));
            message.setSubject("测试邮件");
            message.setText("这是一封测试邮件");

            // 发送
            Transport.send(message);
            System.out.println("邮件发送成功");

        } catch (MessagingException e) {
            e.printStackTrace();
        }
    }
}
```

### Java 接收邮件（POP3）

```java
import javax.mail.*;
import javax.mail.internet.*;
import java.util.Properties;

public class ReceiveEmail {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put("mail.pop3.host", "pop.example.com");
        props.put("mail.pop3.port", "995");
        props.put("mail.pop3.starttls.enable", "true");

        Session session = Session.getInstance(props);
        Store store = null;

        try {
            store = session.getStore("pop3s");
            store.connect("pop.example.com", "alice", "password");

            Folder inbox = store.getFolder("INBOX");
            inbox.open(Folder.READ_ONLY);

            Message[] messages = inbox.getMessages();
            System.out.println("邮件数量: " + messages.length);

            for (Message message : messages) {
                System.out.println("主题: " + message.getSubject());
                System.out.println("发件人: " +
                    message.getFrom()[0]);
            }

            inbox.close(false);
            store.close();

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

### Java 接收邮件（IMAP）

```java
import javax.mail.*;
import javax.mail.internet.*;
import java.util.Properties;

public class ImapReceive {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put("mail.imap.host", "imap.example.com");
        props.put("mail.imap.port", "993");
        props.put("mail.imap.starttls.enable", "true");

        Session session = Session.getInstance(props);
        Store store = null;

        try {
            store = session.getStore("imaps");
            store.connect("imap.example.com", "alice", "password");

            Folder inbox = store.getFolder("INBOX");
            inbox.open(Folder.READ_WRITE);

            // 搜索未读邮件
            FlagTerm unseen = new FlagTerm(
                new Flags(Flags.Flag.SEEN), false);
            Message[] unseenMessages = inbox.search(unseen);

            System.out.println("未读邮件数量: " + unseenMessages.length);

            // 标记为已读
            for (Message message : unseenMessages) {
                message.setFlag(Flags.Flag.SEEN, true);
            }

            inbox.close(true);
            store.close();

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

## 安全考虑

### TLS/SSL 加密

```
明文协议：
- SMTP: 25（无加密）
- POP3: 110（无加密）
- IMAP: 143（无加密）

加密协议：
- SMTPS: 465
- POP3S: 995
- IMAPS: 993
```

### SMTP 认证

```
SMTP 认证（SMTP AUTH）：
- 防止匿名转发
- 常用机制：
  - PLAIN（Base64 编码的用户名密码）
  - LOGIN（独立发送用户名密码）
  - CRAM-MD5（Challenge-Response）
```

### SPF、DKIM、DMARC

```
这些是防止邮件伪造的技术：

SPF（Sender Policy Framework）：
- DNS TXT 记录
- 指定哪些服务器可以发送该域名的邮件

DKIM（DomainKeys Identified Mail）：
- 邮件签名
- DNS 存储公钥

DMARC（Domain-based Message Authentication...）：
- 综合 SPF 和 DKIM
- 指定验证失败的处理方式
```

## 面试追问方向

- SMTP、POP3、IMAP 各自的用途是什么？
- 为什么有多个端口（SMTP 的 25、465、587）？
- IMAP 和 POP3 的区别是什么？各自适合什么场景？
- 邮件发送的完整流程是什么？
- 什么是 SPF、DKIM、DMARC？
- 如何在 Java 中发送邮件？
- 如何使用 Java 读取邮件？
- 为什么现代邮件客户端普遍使用 IMAP 而不是 POP3？
- SMTP 响应码有哪些？220、250、354、550 分别代表什么？
- 邮件协议的安全性如何保证？
