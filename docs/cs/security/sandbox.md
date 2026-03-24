# 沙箱：隔离的艺术

你收到一封邮件，附件是一个 Word 文档。

你担心文档里有病毒，但必须打开看看内容。

你选择在**沙箱（Sandbox）**中打开——文档在一个隔离的虚拟环境中运行，任何恶意代码都无法影响到你的真实系统。

这就是沙箱的核心思想——**隔离**。

## 沙箱的原理

### 核心概念

```
┌─────────────────────────────────────────────────────────────┐
│                    沙箱隔离模型                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  传统模型：                                                  │
│  应用 ──────────────────────── 系统资源                       │
│         直接访问，无法控制                                   │
│                                                             │
│  沙箱模型：                                                  │
│  应用 ──→ 沙箱 ──→ 模拟层 ──→ 系统资源                      │
│         │        │                                         │
│         │        └── 只允许安全操作                         │
│         └── 所有系统调用被拦截                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 隔离层次

```
┌─────────────────────────────────────────────────────────────┐
│                    沙箱隔离层次                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 进程级隔离                                              │
│     - 进程间通信限制                                        │
│     - 资源配额                                              │
│     - 命名空间隔离                                          │
│                                                             │
│  2. 网络级隔离                                              │
│     - 虚拟网卡                                            │
│     - 网络命名空间                                          │
│     - 防火墙规则                                            │
│                                                             │
│  3. 文件系统隔离                                            │
│     - 只读文件系统                                          │
│     - 写时复制（Copy-on-Write）                            │
│     - 虚拟文件系统                                          │
│                                                             │
│  4. 资源隔离                                                │
│     - CPU 配额                                             │
│     - 内存限制                                              │
│     - 磁盘配额                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Linux 沙箱技术

### 1. Linux Namespaces

```bash
# 查看当前进程的命名空间
ls -la /proc/self/ns/

# 网络命名空间
ip netns add sandbox
ip netns exec sandbox ip link list

# 用户命名空间
unshare --user --map-root-user bash

# PID 命名空间
unshare --pid --fork --mount-proc bash
```

### 2. cgroups（控制组）

```bash
# 创建 cgroup
sudo cgcreate -a $USER -t $USER -g memory,cpu,pids:/sandbox

# 设置内存限制（100MB）
echo 100M | sudo tee /sys/fs/cgroup/memory/sandbox/memory.limit_in_bytes

# 设置 CPU 限制（50%）
echo 50000 | sudo tee /sys/fs/cgroup/cpu/sandbox/cpu.cfs_quota_us

# 将进程加入 cgroup
sudo cgclassify -g memory,cpu,pids:/sandbox <pid>
```

### 3. seccomp（安全计算模式）

```c
// 启用 seccomp，只允许特定系统调用
#include <linux/seccomp.h>
#include <sys/prctl.h>

int main() {
    // 设置 seccomp 模式
    // SECCOMP_STRICT：只允许 read, write, _exit, sigreturn
    prctl(PR_SET_SECCOMP, SECCOMP_STRICT);
    
    // 现在只能执行安全调用
    write(1, "Hello\n", 6);
    
    // execve 会失败
    execve("/bin/sh", NULL, NULL);  // SECCOMP 会杀死进程
    
    return 0;
}
```

```bash
# 编译并测试
gcc -o seccomp_strict seccomp_strict.c
./seccomp_strict
echo $?  # 应该是被杀死的退出码
```

### 4. AppArmor

```bash
# AppArmor 配置示例
# /etc/apparmor.d/usr.bin.firefox

#include <tunables/global>

profile firefox /usr/bin/firefox {
    # 允许读取 home 目录
    @{HOME}/** r,
    
    # 只读访问系统文件
    /etc/** r,
    /usr/** r,
    
    # 禁止写入
    /** w,
    
    # 网络访问
    network inet stream,
    network inet dgram,
    
    # 禁止执行
    /bin/** ix,
    /usr/bin/** ix,
}
```

### 5. SELinux

```bash
# SELinux 策略示例
# myapp.te
module myapp 1.0;

require {
    type httpd_t;
    type user_home_t;
    class dir { read getattr search open };
    class file { read getattr open ioctl lock };
}

# 允许 httpd_t 读取用户 home 目录
allow httpd_t user_home_t:dir { read getattr search open };
allow httpd_t user_home_t:file { read getattr open };
```

## 容器沙箱

### Docker 沙箱配置

```yaml
# docker-compose.yml
services:
  sandbox:
    image: sandbox:latest
    # 资源限制
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 128M
    
    # 安全配置
    security_opt:
      - no-new-privileges:true
      - seccomp:default
      - apparmor:nginx-profile
    
    # 网络隔离
    networks:
      - sandbox_net
    
    # 只读文件系统
    read_only: true
    
    # 临时文件系统
    tmpfs:
      - /tmp:size=100m,mode=1777
    
    # 存储卷只读
    volumes:
      - ./data:/data:ro

networks:
  sandbox_net:
    driver: bridge
```

### gVisor（用户空间内核）

```bash
# 安装 gVisor
go get github.com/google/gvisor/runsc

# 使用 gVisor 运行容器
docker run --runtime=runsc -it alpine /bin/sh

# runsc 特性：
# - 用户空间内核
# - 不依赖主机内核系统调用
# - 隔离性比 runc 强
```

### Kata Containers（硬件虚拟化）

```bash
# 安装 Kata Containers
sudo apt install -y kata-runtime

# 使用 Kata 运行容器
docker run --runtime=kata-runtime -it alpine /bin/sh

# 特性：
# - 每个容器一个轻量级 VM
# - 硬件虚拟化隔离
# - 接近 native 性能
```

## Java 沙箱

### SecurityManager

```java
// Java 安全管理器（Java 17 已废弃，但仍可演示）
public class JavaSandbox {
    
    public static void main(String[] args) {
        // 创建安全策略
        Policy.setPolicy(new Policy() {
            @Override
            public PermissionCollection getPermissions(CodeSource codesource) {
                Permissions perms = new Permissions();
                
                // 只允许读取 home 目录
                perms.add(new FilePermission(System.getProperty("user.home") + "/-", "read"));
                
                // 只允许网络连接到特定端口
                perms.add(new SocketPermission("localhost:8080", "connect,resolve"));
                
                // 不允许执行进程
                perms.add(new RuntimePermission("exitVM"));
                
                return perms;
            }
        });
        
        // 启用安全管理器
        System.setSecurityManager(new SecurityManager());
        
        // 在沙箱中运行代码
        try {
            // 这会失败：无法写文件
            new FileWriter("/tmp/test.txt");
        } catch (SecurityException e) {
            System.out.println("访问被沙箱阻止: " + e.getMessage());
        }
    }
}
```

### 进程级隔离（Java 17+）

```java
// 使用 ProcessBuilder 隔离执行
public class IsolatedProcess {
    
    public ProcessResult execute(String command) {
        ProcessBuilder pb = new ProcessBuilder(command.split("\\s+"));
        
        // 设置工作目录
        pb.directory(new File("/sandbox"));
        
        // 环境变量清理
        Map<String, String> env = new HashMap<>(pb.environment());
        env.keySet().removeIf(k -> k.startsWith("SECRET_"));
        pb.environment().clear();
        pb.environment().putAll(env);
        
        // 限制资源
        // 需要操作系统层面的 cgroups 配合
        
        try {
            Process process = pb.start();
            
            // 读取输出（限制大小）
            String output = new String(process.getInputStream().readNBytes(1024 * 1024));
            String error = new String(process.getErrorStream().readNBytes(1024 * 1024));
            
            int exitCode = process.waitFor(10, TimeUnit.SECONDS) ? 
                process.exitValue() : -1;
            
            return new ProcessResult(exitCode, output, error);
            
        } catch (Exception e) {
            return new ProcessResult(-1, "", e.getMessage());
        }
    }
}
```

## 浏览器沙箱

现代浏览器使用多进程 + 沙箱架构：

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome 沙箱架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  浏览器主进程                                               │
│      │                                                      │
│      ├── 渲染进程（每个标签页独立）                           │
│      │     ├── 沙箱限制系统调用                             │
│      │     └── 无访问本地文件权限                           │
│      │                                                      │
│      ├── GPU 进程                                          │
│      │     └── 隔离渲染加速                                │
│      │                                                      │
│      └── 网络进程                                          │
│            └── 处理所有网络请求                             │
│                                                             │
│  关键安全机制：                                             │
│  - Site Isolation：不同源的页面在不同进程                  │
│  - 特权代码在浏览器主进程                                   │
│  - 渲染进程无法直接访问文件系统                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 安全沙箱设计原则

### 1. 最小权限

```java
// 每次授权只给需要的最小权限
// ❌ 错误：给所有权限
sandbox.grantAllPermissions();

// ✅ 正确：只给需要的
sandbox.addPermission(new FilePermission("/tmp/*", "read,write"));
sandbox.addPermission(new SocketPermission("api.example.com:443", "connect"));
```

### 2. 深度防御

```
┌─────────────────────────────────────────────────────────────┐
│                    纵深防御沙箱                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  第一层：应用层沙箱                                           │
│      ↓                                                      │
│  第二层：容器沙箱                                           │
│      ↓                                                      │
│  第三层：VM 隔离                                            │
│      ↓                                                      │
│  第四层：网络隔离                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. 审计与监控

```java
@Service
public class SandboxMonitor {
    
    /**
     * 监控沙箱行为
     */
    public void monitorSandbox(String sandboxId) {
        // 1. 记录所有系统调用
        // 2. 检测异常行为
        // 3. 超过阈值自动终止
    }
}
```

## 面试追问方向

1. **沙箱和虚拟机的区别？** —— 沙箱共享内核，虚拟机独立内核；沙箱轻量，虚拟机隔离更强
2. **Linux Namespace 和 cgroup 的区别？** —— Namespace 隔离资源视图，cgroup 限制资源使用
3. **seccomp 是什么？** —— 限制进程可用的系统调用，减少攻击面
4. **容器和 VM 哪个更安全？** —— VM 隔离更强，但容器更轻量；高安全场景用 VM
5. **浏览器沙箱如何工作？** —— 多进程架构，每个渲染进程在受限环境运行，无法直接访问系统资源

> "沙箱是安全的艺术。通过隔离，我们可以运行不受信任的代码而不危及其他系统。"
