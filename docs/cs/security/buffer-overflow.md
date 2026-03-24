# 缓冲区溢出：程序员的噩梦

1988 年，Morris 蠕虫感染了 6000 台联网计算机。

它利用了 Unix finger 服务的一个漏洞——**缓冲区溢出**。

三十多年后，缓冲区溢出依然是软件安全中最危险、最经典的漏洞类型之一。

理解它，才能理解系统安全。

## 缓冲区溢出的原理

### 内存布局

```
程序内存布局（简化）：
┌─────────────────────────────────────────────────────────────┐
│                     高地址                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                                       │
│  │     返回地址     │ ← 函数返回后跳转到这里                │
│  ├─────────────────┤                                       │
│  │    旧基址指针   │                                       │
│  ├─────────────────┤                                       │
│  │     ...        │                                       │
│  ├─────────────────┤                                       │
│  │   局部变量      │ ← 缓冲区通常在这里                    │
│  ├─────────────────┤                                       │
│  │   缓冲区        │ ← 我们的输入存储在这里                 │
│  └─────────────────┘                                       │
│                                                             │
│                     低地址                                 │
└─────────────────────────────────────────────────────────────┘
```

### 溢出发生

```c
// 漏洞代码
void vulnerable_function(char *input) {
    char buffer[64];  // 缓冲区，只有 64 字节
    
    // 没有边界检查！
    strcpy(buffer, input);  // 如果 input > 64 字节，会溢出！
}

int main() {
    char *malicious_input = 
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"  // 溢出数据
        "\x41\x42\x43\x44";  // 覆盖返回地址为 0x44434241
    
    vulnerable_function(malicious_input);
    // 返回时，程序跳转到 0x44434241（ABCD），而不是正确的返回地址
}
```

### 溢出后果

```
┌─────────────────────────────────────────────────────────────┐
│                    缓冲区溢出后果                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 程序崩溃                                                │
│     返回地址被破坏，跳转到无效地址                            │
│                                                             │
│  2. 执行任意代码                                            │
│     覆盖返回地址为 shellcode，跳转到 shellcode 执行          │
│                                                             │
│  3. 绕过安全检查                                            │
│     覆盖安全变量（如权限标志）                               │
│                                                             │
│  4. 改变程序行为                                            │
│     修改函数指针、虚表指针                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 溢出利用

### Shellcode

```c
// Linux x86 shellcode：执行 /bin/sh
unsigned char shellcode[] = 
    "\x31\xc0"              // xor    %eax,%eax
    "\x50"                  // push   %eax
    "\x68\x2f\x2f\x73\x68" // push   $0x68732f2f
    "\x68\x2f\x62\x69\x6e" // push   $0x6e69622f
    "\x89\xe3"              // mov    %esp,%ebx
    "\x50"                  // push   %eax
    "\x53"                  // push   %ebx
    "\x89\xe1"              // mov    %esp,%ecx
    "\xb0\x0b"              // mov    $0xb,%al
    "\x31\xdb"              // xor    %ebx,%ebx
    "\xcd\x80"              // int    $0x80
;
```

### 利用步骤

```
1. 定位漏洞函数
2. 确定溢出距离（offset）
3. 构造 payload：
   [padding][NOP slide][shellcode][new return address]
4. 触发漏洞
5. 程序跳转到 shellcode，执行
```

## 防御机制

### 1. Stack Canaries（金丝雀）

在返回地址前放置一个特殊值：

```c
// 带 Stack Canary 的函数
void protected_function(char *input) {
    char buffer[64];
    unsigned long canary;
    
    // 放置金丝雀值
    canary = get_random_canary();
    
    // 金丝雀值在缓冲区之后
    // __stack_chk_fail() 检查返回前金丝雀是否被破坏
    strcpy(buffer, input);
    
    // 函数返回前检查
    if (canary != get_random_canary()) {
        __stack_chk_fail();  // 检测到溢出，终止程序
    }
}
```

### 2. 地址空间布局随机化（ASLR）

```bash
# 开启 ASLR
echo 2 > /proc/sys/kernel/randomize_va_space

# 关闭 ASLR（调试用）
echo 0 > /proc/sys/kernel/randomize_va_space

# 值含义：
# 0 - 关闭
# 1 - 堆栈随机化
# 2 - 堆栈、库、mmap、VDSO 全部随机化
```

### 3. NX/DEP（No-eXecute）

禁止执行栈上的代码：

```bash
# NX 位：内存页标记为不可执行
# 攻击者的 shellcode 放在栈上，但栈不可执行
```

### 4. 编译选项

```bash
# 编译时启用所有安全特性
gcc -fstack-protector-strong -fPIE -pie -z relro -z now -o program program.c

# -fstack-protector：启用栈保护
# -fstack-protector-strong：更强的栈保护
# -fPIE -pie：生成位置无关代码
# -z relro -z now：完全 RELRO，防止 GOT 覆写
```

### 5. SafeSEH / SEHOP

结构化异常处理保护：

```c
// SafeSEH：异常处理函数地址在白名单中
// SEHOP：验证异常处理链完整性
```

## Java 中的缓冲区问题

虽然 Java 有边界检查，但也有类似问题：

```java
// 数组越界
int[] array = new int[10];
array[20] = 100;  // ArrayIndexOutOfBoundsException

// ByteBuffer 溢出
ByteBuffer buffer = ByteBuffer.allocateDirect(1024);
buffer.putLong(0, value);  // 如果 value 超出范围？

// 本地方法（JNI）
// JNI 调用 C/C++ 代码时，可能存在溢出
public class NativeLib {
    public native void process(String input);
    // 本地实现中可能存在溢出漏洞
}
```

## 检测与防护

### 静态分析

```bash
# 使用静态分析工具检测
# 1. FlawFinder
flawfinder vulnerable.c

# 2. Cppcheck
cppcheck --enable=all vulnerable.c

# 3. Coverity
coverity scan --dir <build-dir>
```

### 动态检测

```bash
# AddressSanitizer
gcc -fsanitize=address -o program program.c
./program

# Valgrind
valgrind --leak-check=full ./program

# Memcheck
valgrind --tool=memcheck ./program
```

### Fuzzing

```python
# 模糊测试示例
import subprocess

def fuzz(target, payload):
    proc = subprocess.Popen([target], stdin=subprocess.PIPE)
    proc.communicate(input=payload)
    return proc.returncode

# 生成随机输入
for i in range(10000):
    payload = generate_random_bytes(100 + i % 1000)
    fuzz('./vulnerable_program', payload)
```

## 面试追问方向

1. **缓冲区溢出的根本原因？** —— 没有边界检查，用户输入超出缓冲区边界，覆写相邻内存
2. **Stack Canary 如何检测溢出？** —— 溢出到返回地址会先破坏 Canary，函数返回前检查 Canary 是否被改变
3. **ASLR 为什么能防止利用？** —— 随机化内存布局，攻击者不知道 shellcode 的准确地址
4. **NX 位如何工作？** —— CPU 支持内存页的 NX 位，栈页标记为不可执行，shellcode 无法运行
5. **为什么 Java 相对安全？** —— Java 有边界检查，本地代码仍然可能有问题

> "缓冲区溢出是系统安全的经典问题。理解它的原理和防护机制，是每个系统程序员的必修课。"
