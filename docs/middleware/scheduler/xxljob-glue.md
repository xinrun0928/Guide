# XXL-Job GLUE 代码开发模式

传统方式下，改一行代码需要：修改代码 → 编译 → 测试 → 打包 → 部署。

对于临时需求、紧急修复，这个流程太慢了。

**GLUE 模式**就是为了解决这个问题——在线编写代码，实时生效，无需部署。

## 什么是 GLUE 模式？

```
┌─────────────────────────────────────────────────────────────┐
│                    GLUE 模式原理                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   传统模式：                                                 │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  编写代码 → 编译 → 测试 → 部署                       │  │
│   │                          至少 30 分钟                 │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   GLUE 模式：                                               │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  在 Web 界面写代码 → 保存 → 立即生效                   │  │
│   │                          几秒钟！                      │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   就像「胶水」一样，把代码「粘」到任务上                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## GLUE 模式类型

XXL-Job 支持多种 GLUE 类型：

| 类型 | 说明 | 执行方式 |
|---|---|---|
| GLUE_JAVA | Java 代码 | 动态编译 |
| GLUE_SHELL | Shell 脚本 | ProcessBuilder |
| GLUE_PYTHON | Python 脚本 | ProcessBuilder |
| GLUE_NODEJS | Node.js | ProcessBuilder |
| GLUE_PHP | PHP 脚本 | ProcessBuilder |
| GLUE_GO | Go 程序 | ProcessBuilder |
| GLUE_POWERSHELL | PowerShell | ProcessBuilder |

## GLUE_JAVA：在线编写 Java 代码

### 编写 GLUE 代码

在调度中心编写代码：

```java
package com.xxl.job.service.handler;

import com.xxl.job.core.context.XxlJobHelper;
import com.xxl.job.core.handler.IJobHandler;

public class MyGlueJob extends IJobHandler {

    @Override
    public void execute() throws Exception {
        String param = XxlJobHelper.getJobParam();
        XxlJobHelper.log("开始执行 GLUE 任务，参数：" + param);

        // 执行业务逻辑
        for (int i = 0; i < 10; i++) {
            XxlJobHelper.log("处理第 " + i + " 条数据");
            
            // 模拟处理
            Thread.sleep(1000);
        }

        XxlJobHelper.log("GLUE 任务执行完成");
    }
}
```

### 代码更新机制

```
┌─────────────────────────────────────────────────────────────┐
│                    GLUE 代码更新流程                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. 修改代码并保存                                         │
│      ┌─────────────────────────────────────────────────┐   │
│      │ UPDATE xxl_job_info                              │   │
│      │ SET glue_source = '新代码',                        │   │
│      │     glue_updatetime = NOW()                       │   │
│      │ WHERE id = :jobId                                │   │
│      └─────────────────────────────────────────────────┘   │
│                                                             │
│   2. 下次执行时，加载最新代码                               │
│      ┌─────────────────────────────────────────────────┐   │
│      │ SELECT glue_source FROM xxl_job_info             │   │
│      │ WHERE id = :jobId                                │   │
│      └─────────────────────────────────────────────────┘   │
│                            │                               │
│                            ▼                               │
│   3. 动态编译                                              │
│      ┌─────────────────────────────────────────────────┐   │
│      │ 使用 JavaCompiler API 编译源代码                  │   │
│      │ 生成的 .class 文件存入内存或临时文件              │   │
│      └─────────────────────────────────────────────────┘   │
│                            │                               │
│                            ▼                               │
│   4. 反射调用                                              │
│      ┌─────────────────────────────────────────────────┐   │
│      │ Class cls = loader.loadClass(className);        │   │
│      │ IJobHandler handler = (IJobHandler) cls.newInstance();│
│      │ handler.execute();                               │   │
│      └─────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 编译实现

```java
public class GlueCompiler {
    
    public IJobHandler compile(String javaSource) {
        // 1. 获取 Java 编译器
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        
        // 2. 创建临时文件
        String className = extractClassName(javaSource);
        JavaSourceFromString sourceCode = new JavaSourceFromString(className, javaSource);
        
        // 3. 编译
        StandardJavaFileManager fileManager = compiler.getStandardFileManager(null, null, null);
        Iterable<? extends JavaFileObject> compilationUnits = Arrays.asList(sourceCode);
        
        boolean success = compiler.getTask(null, fileManager, null, null, null, compilationUnits).call();
        
        if (!success) {
            throw new RuntimeException("GLUE 代码编译失败");
        }
        
        // 4. 加载类
        ClassLoader loader = new MemoryClassLoader();
        return (IJobHandler) loader.loadClass(className).newInstance();
    }
}
```

## GLUE_SHELL：执行 Shell 脚本

### 编写 Shell 脚本

```bash
#!/bin/bash

echo "========================================="
echo "开始执行 Shell 脚本任务"
echo "参数: $1"
echo "========================================="

# 模拟业务逻辑
for i in {1..5}
do
    echo "处理第 $i 批数据..."
    sleep 1
done

# 检查上一个命令的退出状态
if [ $? -eq 0 ]; then
    echo "脚本执行成功"
    exit 0
else
    echo "脚本执行失败"
    exit 1
fi
```

### 执行过程

```java
public class ShellGlueExecutor {
    
    public int execute(String scriptContent, String params) {
        // 1. 创建临时脚本文件
        File tempFile = File.createTempFile("xxl-job-", ".sh");
        tempFile.deleteOnExit();
        
        // 2. 写入脚本内容
        Files.write(tempFile.toPath(), scriptContent.getBytes());
        
        // 3. 设置执行权限
        tempFile.setExecutable(true);
        
        // 4. 执行脚本
        ProcessBuilder pb = new ProcessBuilder("/bin/bash", tempFile.getPath(), params);
        pb.redirectErrorStream(true);
        
        Process process = pb.start();
        
        // 5. 读取输出
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                XxlJobHelper.log(line);
            }
        }
        
        // 6. 等待完成
        int exitCode = process.waitFor();
        
        // 7. 删除临时文件
        tempFile.delete();
        
        return exitCode;
    }
}
```

## GLUE_PYTHON：执行 Python 脚本

### 编写 Python 脚本

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import time

def main():
    print("=" * 40)
    print("开始执行 Python 脚本任务")
    
    # 获取参数
    params = sys.argv[1] if len(sys.argv) > 1 else "无参数"
    print(f"参数: {params}")
    
    # 模拟业务逻辑
    for i in range(1, 6):
        print(f"处理第 {i} 批数据...")
        time.sleep(1)
    
    print("脚本执行成功")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

## 版本管理

GLUE 代码支持版本管理：

```
┌─────────────────────────────────────────────────────────────┐
│                    GLUE 版本管理                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ 版本历史                                             │  │
│   ├─────────────────────────────────────────────────────┤  │
│   │ v1  2024-01-01 10:00:00  初始版本                    │  │
│   │ v2  2024-01-02 14:30:00  修复 BUG                    │  │
│   │ v3  2024-01-03 09:15:00  新增功能                    │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   [查看] [回滚] [对比]                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 回滚功能

```java
public class GlueVersionService {
    
    public void rollback(long jobId, int version) {
        // 1. 获取指定版本的代码
        GlueSource oldSource = glueSourceDao.findByJobIdAndVersion(jobId, version);
        
        if (oldSource == null) {
            throw new RuntimeException("版本不存在");
        }
        
        // 2. 恢复到当前版本
        JobInfo job = jobInfoDao.findById(jobId);
        job.setGlueSource(oldSource.getSource());
        jobInfoDao.update(job);
        
        // 3. 记录操作日志
        log("回滚任务 " + jobId + " 到版本 " + version);
    }
}
```

## 安全机制

GLUE 模式虽然方便，但也带来安全风险，需要注意：

### 风险一：代码注入

```
❌ 危险写法
String userInput = XxlJobHelper.getJobParam();
String code = "SELECT * FROM users WHERE name = '" + userInput + "'";

// 如果 userInput = "'; DROP TABLE users; --"
// 实际执行的 SQL 变成：
// SELECT * FROM users WHERE name = ''; DROP TABLE users; --'
```

```
✅ 安全写法
String userInput = XxlJobHelper.getJobParam();
String code = "SELECT * FROM users WHERE name = ?";
// 使用参数化查询
```

### 风险二：资源耗尽

```
❌ 危险写法：无限循环
while (true) {
    processData();
}
```

```
✅ 安全写法：设置超时
long startTime = System.currentTimeMillis();
while (true) {
    if (System.currentTimeMillis() - startTime > 60000) {
        throw new RuntimeException("执行超时");
    }
    if (!hasMoreData()) {
        break;
    }
    processData();
}
```

### 风险三：权限控制

```java
// 限制可使用的包
public class GlueSecurityManager {
    
    private static final Set&lt;String&gt; ALLOWED_PACKAGES = new HashSet&lt;&gt;(
        Arrays.asList(
            "com.xxl.job.core",
            "java.util",
            "java.lang",
            "java.text",
            "java.math"
        )
    );
    
    public void validateCode(String code) {
        // 禁止使用反射
        if (code.contains("java.lang.reflect")) {
            throw new SecurityException("禁止使用反射");
        }
        
        // 禁止使用 Runtime.exec
        if (code.contains("Runtime.getRuntime().exec")) {
            throw new SecurityException("禁止执行系统命令");
        }
        
        // 禁止访问文件系统
        if (code.contains("java.io.File")) {
            throw new SecurityException("禁止访问文件系统");
        }
    }
}
```

## 适用场景

```
┌─────────────────────────────────────────────────────────────┐
│                    GLUE 模式适用场景                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ✅ 适合使用 GLUE 的场景：                                   │
│   · 临时需求、快速验证                                       │
│   · 紧急修复线上问题                                         │
│   · 简单脚本任务                                             │
│   · 不经常修改的一次性任务                                   │
│                                                             │
│   ❌ 不适合使用 GLUE 的场景：                                 │
│   · 复杂业务逻辑                                             │
│   · 需要单元测试                                             │
│   · 频繁修改的核心任务                                       │
│   · 需要版本控制                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 总结

| 维度 | GLUE 模式 | Bean 模式 |
|---|---|---|
| 部署 | 无需部署 | 需要重新部署 |
| 生效速度 | 实时 | 需要构建 |
| 代码管理 | 界面编辑 | IDE 开发 |
| 版本控制 | 简单记录 | Git 管理 |
| 调试 | 日志输出 | IDE 断点 |
| 安全性 | 风险较高 | 较安全 |
| 适用场景 | 临时/简单 | 正式/复杂 |

## 思考题

GLUE 代码存在数据库中，每次执行都需要从数据库读取并编译。

如果任务并发执行 1000 次，编译会成为瓶颈吗？

如何优化 GLUE 代码的编译和执行性能？
