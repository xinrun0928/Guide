# FTP 协议工作原理

FTP（File Transfer Protocol）是互联网上历史最悠久的协议之一。

即使在云存储普及的今天，FTP 仍然是管理服务器文件、部署网站的常用工具。

理解 FTP 的工作原理，对系统管理员和后端工程师都很有价值。

## FTP 是什么？

FTP 是一种用于在客户端和服务器之间传输文件的标准协议。

```
┌─────────────────────────────────────────────────────────────┐
│                      FTP 使用场景                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 网站部署                                                │
│     本地代码 ────────────► 服务器                          │
│     (IDE)          FTP            (Web Server)             │
│                                                             │
│  2. 服务器管理                                              │
│     运维 ────────────────► 服务器                          │
│     (本地)           FTP            (VPS/IDC)               │
│                                                             │
│  3. 文件共享                                                │
│     用户 A ─────────────► FTP 服务器                       │
│     用户 B ◄───────────── FTP 服务器                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## FTP 的双连接模式

FTP 使用**两个连接**：

```
┌─────────────────────────────────────────────────────────────┐
│                    FTP 双连接模式                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  控制连接（Port 21）：                                       │
│  发送命令和响应                                             │
│  整个会话期间保持                                            │
│                                                             │
│  数据连接（动态端口）：                                       │
│  传输文件列表和文件内容                                       │
│  按需建立和关闭                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 控制连接

```
客户端 ──── 控制连接（21） ───────────────────────────────> FTP 服务器
         │
         │ 发送命令
         │ USER alice
         │ PASS secret
         │ LIST
         │ RETR file.txt
         │
         │ 接收响应
         │ 331 Please specify password
         │ 230 Login successful
         │ 150 File status okay
         │
         ▼
    保持连接
```

### 数据连接

数据连接用于传输实际的文件或目录列表。

## 主动模式 vs 被动模式

### 主动模式（PORT）

```
FTP 服务器主动连接客户端的数据端口

步骤：
1. 客户端打开一个随机高端口号（如 50000）
2. 客户端发送 PORT 命令，告知服务器
3. 服务器从端口 20 连接到客户端的 50000 端口
4. 开始传输数据

问题：如果客户端在 NAT 后面，服务器无法连接
```

```
客户端                                    FTP 服务器
   │                                          │
   │ ─── USER / PASS（控制连接） ───────────> │
   │                                          │
   │ <── 331 Please specify password ────────── │
   │ <── 230 Login successful ──────────────── │
   │                                          │
   │  客户端打开端口 50000                     │
   │                                          │
   │ ─── PORT 192,168,1,100,195,80 ────────> │
   │                                          │
   │ ─── LIST ────────────────────────────────> │
   │                                          │
   │     <─── 端口 20 连接客户端 50000 ──────── │
   │     ──── 数据连接（文件列表） ────────────> │
   │     <─── 连接关闭 ─────────────────────── │
```

### 被动模式（PASV）

```
客户端主动连接服务器的数据端口

步骤：
1. 客户端发送 PASV 命令
2. 服务器打开一个随机高端口号，告知客户端
3. 客户端连接到服务器的该端口
4. 开始传输数据

问题：如果服务器在 NAT 后面，客户端无法连接
```

```
客户端                                    FTP 服务器
   │                                          │
   │ ─── USER / PASS ────────────────────────> │
   │ <── 331 / 230 ─────────────────────────── │
   │                                          │
   │ ─── PASV ────────────────────────────────> │
   │                                          │
   │ <── 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2) <── │
   │     服务器打开高端口，如 60000               │
   │                                          │
   │     客户端连接服务器的 60000                  │
   │ ─────────────────────────────────────────> │
   │                                          │
   │ ─── LIST ────────────────────────────────> │
   │                                          │
   │     ──── 数据连接（文件列表） ──────────────> │
   │     <─── 连接关闭 ─────────────────────── │
```

### 模式选择建议

```
┌─────────────────────────────────────────────────────────────┐
│                    模式选择建议                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  主动模式（PORT）：                                          │
│  - 适用于客户端在公网、服务器在防火墙后                       │
│  - 需要客户端开放入站端口                                     │
│                                                             │
│  被动模式（PASV）：                                          │
│  - 适用于服务器在公网、客户端在防火墙后                       │
│  - 需要服务器开放大量被动端口                                 │
│  - 现代 FTP 客户端默认使用                                    │
│                                                             │
│  最佳实践：                                                  │
│  - 客户端和服务端都使用被动模式                               │
│  - 配置防火墙/负载均衡器支持 FTP                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## FTP 命令与响应

### 常用命令

```
┌─────────────────────────────────────────────────────────────┐
│                    FTP 命令                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  连接控制：                                                 │
│  USER username    ── 设置用户名                             │
│  PASS password    ── 设置密码                              │
│  QUIT             ── 关闭连接                              │
│                                                             │
│  文件操作：                                                 │
│  RETR filename   ── 下载文件                              │
│  STOR filename   ── 上传文件                              │
│  DELE filename   ── 删除文件                              │
│  RNFR/RNTO       ── 重命名文件                           │
│                                                             │
│  目录操作：                                                 │
│  CWD directory   ── 改变目录                             │
│  PWD             ── 显示当前目录                          │
│  MKD directory   ── 创建目录                              │
│  RMD directory   ── 删除目录                              │
│  LIST            ── 列出目录内容                          │
│  NLST            ── 列出文件名称                         │
│                                                             │
│  传输模式：                                                 │
│  TYPE I         ── 二进制模式                            │
│  TYPE A         ── ASCII 模式                            │
│  MODE S         ── 流模式                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 常用响应码

```
┌─────────────────────────────────────────────────────────────┐
│                    FTP 响应码                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1xx ─ 信息                                                │
│  125  打开数据连接，开始传输                               │
│  150  文件状态正常，准备传输                               │
│                                                             │
│  2xx ─ 成功                                               │
│  200  命令成功                                             │
│  220  服务就绪                                             │
│  226  传输完成                                             │
│  230  用户登录成功                                         │
│  250  文件操作完成                                          │
│                                                             │
│  3xx ─ 需要更多信息                                        │
│  331  需要密码                                             │
│  332  需要账户                                             │
│  350  文件操作暂停，等待进一步命令                           │
│                                                             │
│  4xx ─ 暂时错误                                            │
│  421  服务不可用                                           │
│  425  无法打开数据连接                                      │
│  426  连接关闭，传输中止                                    │
│  450  文件操作不可用（文件忙）                               │
│  451  操作中止，本地错误                                     │
│                                                             │
│  5xx ─ 永久错误                                            │
│  500  语法错误                                             │
│  501  参数语法错误                                          │
│  530  未登录                                               │
│  550  文件不可用（找不到文件、无权限）                       │
│  553  文件名不允许                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## FTP 会话示例

```
$ ftp example.com
Connected to example.com.
220 (vsFTPd 3.0.3)
Name (example.com:alice): alice
331 Please specify a password.
Password:
230 Login successful.
Remote system type is UNIX.
Using binary mode to transfer files.

ftp> pwd
257 /home/alice

ftp> ls -la
200 PORT command successful. Consider using PASV.
150 Here comes the directory listing.
drwxr-xr-x  2 alice   alice   4096 Mar 24 10:00    .
drwxr-xr-x  2 alice   alice   4096 Apr  1 09:00    ..
-rw-r--r--  1 alice   alice   4096 Mar 24 10:00    readme.txt
-rw-r--r--  1 alice   alice  10240 Mar 24 10:00    data.csv

ftp> binary
200 Switching to Binary mode.

ftp> get data.csv
local: data.csv remote: data.csv
227 Entering Passive Mode (93,184,216,34,195,80).
150 Opening BINARY mode data connection for data.csv (10240 bytes).
226 Transfer complete.
10240 bytes received in 0.01 secs (1.0 MB/s)

ftp> put report.pdf
local: report.pdf remote: report.pdf
227 Entering Passive Mode (93,184,216,34,195,81).
150 Ok to send data.
226 Transfer complete.

ftp> quit
221 Goodbye.
```

## FTPS vs SFTP

### FTPS（FTP over TLS）

```
FTPS = FTP + TLS 加密

两种模式：
- 显式 FTPS（Explicit TLS）：21 端口，命令 STARTTLS 升级
- 隐式 FTPS（Implicit TLS）：990 端口，全程加密

端口：
- 控制：21（显式）或 990（隐式）
- 数据：动态（显式）或 989（隐式）
```

### SFTP（SSH File Transfer Protocol）

```
SFTP ≠ FTP！

SFTP 是基于 SSH 的文件传输协议：
- 与 SSH 相同的端口（22）
- 完全不同的协议
- 自带加密
- 二进制编码

常见误解：
- SFTP 不是 FTP over SSH
- SFTP 不是 FTPS
```

| 特性 | FTP | FTPS | SFTP |
|------|-----|------|------|
| 协议基础 | TCP | TCP + TLS | SSH |
| 端口 | 21 | 21/990 | 22 |
| 加密 | 无 | 有 | 有 |
| 防火墙友好 | 一般 | 一般 | 是 |
| 客户端支持 | 广泛 | 广泛 | 一般 |

## Java 实现

### 使用 Apache Commons Net

```java
import org.apache.commons.net.ftp.*;
import java.io.*;

public class FTPDemo {
    public static void main(String[] args) {
        String server = "ftp.example.com";
        String username = "alice";
        String password = "secret";

        FTPClient ftp = new FTPClient();

        try {
            // 连接
            ftp.connect(server);
            System.out.println("已连接到 " + server);

            // 登录
            boolean success = ftp.login(username, password);
            if (!success) {
                System.out.println("登录失败");
                return;
            }
            System.out.println("登录成功");

            // 设置被动模式
            ftp.enterLocalPassiveMode();

            // 设置二进制模式
            ftp.setFileType(FTP.BINARY_FILE_TYPE);

            // 下载文件
            String remoteFile = "/data/report.pdf";
            String localFile = "/tmp/report.pdf";

            try (OutputStream output =
                    new BufferedOutputStream(
                        new FileOutputStream(localFile))) {
                success = ftp.retrieveFile(remoteFile, output);
                System.out.println("下载 " +
                    (success ? "成功" : "失败"));
            }

            // 上传文件
            String uploadRemote = "/data/newfile.txt";
            try (InputStream input =
                    new BufferedInputStream(
                        new FileInputStream("/tmp/newfile.txt"))) {
                success = ftp.storeFile(uploadRemote, input);
                System.out.println("上传 " +
                    (success ? "成功" : "失败"));
            }

            // 列出文件
            FTPFile[] files = ftp.listFiles("/data");
            System.out.println("目录内容：");
            for (FTPFile file : files) {
                System.out.println("  " + file.getName());
            }

            // 退出
            ftp.logout();
            System.out.println("已登出");

        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            if (ftp.isConnected()) {
                try {
                    ftp.disconnect();
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
```

### 使用 JSch（SFTP）

```java
import com.jcraft.jsch.*;
import java.io.*;

public class SFTPDemo {
    public static void main(String[] args) {
        String host = "sftp.example.com";
        String username = "alice";
        String password = "secret";

        JSch jsch = new JSch();

        try {
            // 创建会话
            Session session = jsch.getSession(username, host, 22);
            session.setPassword(password);
            session.setConfig("StrictHostKeyChecking", "no");
            session.connect();

            // 打开 SFTP 频道
            ChannelSftp sftp = (ChannelSftp) session.openChannel("sftp");
            sftp.connect();

            // 列出文件
            Vector<ChannelSftp.LsEntry> files = sftp.ls("/data");
            System.out.println("文件列表：");
            for (ChannelSftp.LsEntry file : files) {
                System.out.println("  " + file.getFilename());
            }

            // 下载文件
            String remotePath = "/data/report.pdf";
            String localPath = "/tmp/report.pdf";
            sftp.get(remotePath, localPath);
            System.out.println("下载完成");

            // 上传文件
            String uploadRemote = "/data/newfile.txt";
            String uploadLocal = "/tmp/newfile.txt";
            sftp.put(uploadLocal, uploadRemote);
            System.out.println("上传完成");

            sftp.disconnect();
            session.disconnect();

        } catch (JSchException | SftpException e) {
            e.printStackTrace();
        }
    }
}
```

## 常见问题

### 防火墙问题

```
问题：FTP 连接超时

原因：防火墙阻止了 FTP 的控制或数据连接

解决：
1. 客户端和服务端都使用被动模式
2. 在防火墙上开放 FTP 相关端口
3. 使用 SFTP 替代
```

### 中文文件名

```
问题：文件名乱码

原因：FTP 服务器和客户端编码不一致

解决：
1. 使用支持 UTF-8 的 FTP 服务器
2. 客户端使用 UTF-8 编码
3. SFTP 不存在这个问题
```

### 断点续传

```
问题：大文件传输中断

解决：
1. FTP 原生支持断点续传
   REST 命令指定偏移量
   APPE 命令追加上传

2. 使用支持断点续传的客户端
```

## 面试追问方向

- FTP 使用什么端口？主动模式和被动模式的区别是什么？
- FTP 为什么需要两个连接？
- FTP 和 SFTP 的区别是什么？
- FTPS 和 SFTP 有什么区别？
- FTP 的响应码有哪些？226、550、553 分别代表什么？
- 如何排查 FTP 连接问题？
- FTP 传输大文件时需要注意什么？
- 为什么 FTP 不适合穿越防火墙？
- 如何在 Java 中实现 FTP 文件传输？
- FTP 的优缺点是什么？什么场景下使用 FTP？
