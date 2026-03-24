# MetaSpace 溢出排查

线上报警：`java.lang.OutOfMemoryError: Metaspace`

等等，Metaspace 是什么？怎么 Metaspace 也会 OOM？

从 JDK 8 开始，JVM 把永久代换成了元空间（Metaspace）。Metaspace 使用的不是堆内存，而是本地内存（Native Memory）。

今天，我们就来彻底搞懂 Metaspace 溢出的原因和排查方法。

---

## 一、Metaspace 是什么？

### 1.1 Metaspace vs PermGen

| 特性 | PermGen（永久代）| Metaspace（元空间）|
|-----|-----------------|-------------------|
| **位置** | JVM 堆内存 | 本地内存（Native Memory）|
| **大小** | 固定，启动时指定 | 动态，可增长 |
| **存储内容** | 类元数据、字符串常量池 | 类元数据 |
| **字符串常量池** | PermGen 中 | 移到了堆内存（StringTable）|
| **溢出表现** | java.lang.OutOfMemoryError: PermGen space | java.lang.OutOfMemoryError: Metaspace |

### 1.2 Metaspace 存储的内容

Metaspace 主要存储以下内容：

- 类的结构信息（字段表、方法表、字节码）
- 类的继承关系
- 类的修饰符
- 常量池
- 编译器编译后的代码缓存
- 符号表
- 动态生成的类（动态代理、CGLIB 生成的类）

### 1.3 Metaspace 相关参数

```bash
# MetaspaceSize：初始大小，也是触发第一次 Full GC 的阈值
-XX:MetaspaceSize=256m

# MaxMetaspaceSize：最大大小（默认无限制，建议设置）
-XX:MaxMetaspaceSize=1g

# CompressedClassSpaceSize：压缩类指针空间大小
-XX:CompressedClassSpaceSize=1g
```

---

## 二、Metaspace 溢出的原因

### 2.1 常见原因一览

| 原因 | 典型场景 | 表现 |
|-----|---------|-----|
| **类加载器泄漏** | Tomcat 反复部署、OSGi | 类数量持续增长 |
| **动态类生成过多** | 大量使用动态代理、CGLIB | 特定阶段类数量突增 |
| **MetaspaceSize 过小** | 启动参数设置不当 | 频繁触发 Metaspace GC |
| **MetaspaceSize 未设置** | 默认无限制 | 可能耗尽本地内存 |

### 2.2 典型场景分析

**场景 1：Tomcat 反复部署**

```bash
# 问题表现
java.lang.OutOfMemoryError: Metaspace

# 原因：Tomcat 反复部署时，旧应用的类加载器未被正确卸载
```

**场景 2：大量使用动态代理**

```java
// 问题代码示例
for (int i = 0; i < 100000; i++) {
    // 每次循环都生成新的代理类
    Object proxy = Proxy.newProxyInstance(
        loader,
        interfaces,
        (p, method, args) -> method.invoke(target, args)
    );
    // 生成的代理类会占用 Metaspace
}
// 这些代理类永远不会被卸载
```

**场景 3：JSP 编译**

```xml
<!-- JSP 每次访问都会编译成 servlet 类 -->
<!-- 如果 JSP 被频繁修改，会产生大量 servlet 类 -->
```

### 2.3 MetaspaceSize 设置不当的问题

**问题 1：MetaspaceSize 太小**

```bash
# 设置过小会导致频繁 Metaspace GC
-XX:MetaspaceSize=64m
# JVM 启动后很快就会触发 Metaspace GC，影响性能
```

**问题 2：MetaspaceSize 未设置上限**

```bash
# 默认无限制，可能耗尽本地内存
# 在容器环境中可能导致进程被 OOM Killer 杀死
```

---

## 三、Metaspace 溢出排查流程

### 3.1 排查步骤

```
1. 检查是否真的 Metaspace OOM
   ↓
2. 查看 Metaspace 使用趋势
   ↓
3. 分析类加载情况
   ↓
4. 使用工具分析
   ↓
5. 定位问题代码
```

### 3.2 确认 Metaspace OOM

```bash
# 查看错误日志
grep -i "metaspace" /var/log/myapp-error.log

# 典型错误信息
java.lang.OutOfMemoryError: Metaspace
    at java.lang.ClassLoader.defineClass1(Native Method)
    at java.lang.ClassLoader.defineClass(ClassLoader.java:...)
```

### 3.3 查看 Metaspace 使用

```bash
# jstat 查看 Metaspace
jstat -gc <pid>

# 输出解读
MC: 元空间committed大小（KB）
MU: 元空间使用大小（KB）
CCSM: 压缩类空间committed大小
CCSU: 压缩类空间使用大小
```

### 3.4 使用 Arthas 分析

```bash
# 启动 Arthas
java -jar arthas-boot.jar
# 选择进程

# 查看类加载信息
classloader

# 查看加载的类数量趋势
dashboard -d 1

# 查看特定类的实例
sc -d com.example.DynamicClass

# 查找可疑的类加载器
classloader | grep -E "数量|ClassLoader"
```

### 3.5 使用 jcmd 分析

```bash
# JDK 8
jcmd <pid> GC.class_histogram | head -50

# JDK 11+
jcmd <pid> VM.classloader_stats
```

---

## 四、Metaspace 分析工具

### 4.1 MAT 分析

对于 Metaspace OOM，也可以使用 MAT 分析：

1. 生成堆转储：`jmap -dump:format=b,file=heap.hprof <pid>`
2. 打开 MAT，加载堆转储
3. 使用 Histogram 查看 `ClassLoader` 和类对象
4. 分析是哪个类加载器加载了大量类

### 4.2 jcmd 详细分析

```bash
# 生成类直方图
jcmd <pid> GC.class_histogram > class_histogram.txt

# 分析输出
# 查找加载数量最多的类
# 查找可疑的类加载器
```

### 4.3 arthas-classloader 命令

```bash
# 查看所有类加载器
[arthas@12345]$ classloader

 name                                        numberOfInstances  loadedCount  parent
 BootstrapClassLoader                        1                  3256         null
 com.example.CustomClassLoader               1                  12345        sun.misc.Launcher$AppClassLoader@12345678
 sun.misc.Launcher$AppClassLoader            1                  2345         sun.misc.Launcher$ExtClassLoader@23456789
```

### 4.4 堆转储中的 Metaspace 信息

从 JDK 8 开始，堆转储中也会包含一些 Metaspace 信息：

- `java.lang.Class` 对象
- `java.lang.ClassLoader` 对象
- 类的实例数量

---

## 五、典型案例分析与解决

### 5.1 案例一：Tomcat 类加载器泄漏

**问题**：

```
Tomcat 反复部署后，Metaspace 持续增长，最终 OOM
```

**排查步骤**：

1. 使用 Arthas 观察类加载数量
2. 每次部署后类加载数量是否增加
3. 旧应用的类是否被卸载

**解决方案**：

```xml
<!-- 1. 升级 Tomcat 版本 -->

<!-- 2. 禁用 JSP 缓存 -->
&lt;Context reloadable="true" swallowOutput="true"&gt;
    &lt;Manager pathname="" /&gt;
&lt;/Context&gt;

<!-- 3. 应用关闭时正确清理资源 -->
@Override
public void contextDestroyed(ServletContextEvent sce) {
    // 清理缓存
    // 关闭连接
    // 注销监听器
}
```

### 5.2 案例二：动态代理类过多

**问题**：

```
接口调用频繁，每次调用都生成新的代理类
```

**排查步骤**：

1. 使用 Arthas 查找动态生成的代理类
2. 查看代码中是否有频繁创建代理的逻辑

**解决方案**：

```java
// 问题代码
public Object invoke(String method) {
    // 每次都创建新的代理
    return Proxy.newProxyInstance(...);
}

// 解决后：缓存代理
private final Map&lt;String, Object&gt; proxyCache = new ConcurrentHashMap&lt;&gt;();

public Object invoke(String method) {
    return proxyCache.computeIfAbsent(method, m -&gt; {
        return Proxy.newProxyInstance(...);
    });
}
```

### 5.3 案例三：Spring CGLIB 代理过多

**问题**：

```
Spring 使用 CGLIB 生成大量代理类
```

**解决方案**：

```java
// 1. 使用接口代理代替类代理
@EnableAspectJAutoProxy(proxyTargetClass = false)

// 2. 配置代理类缓存大小
spring.aop.proxy-target-class=false

// 3. 升级 Spring 版本
```

---

## 六、预防措施

### 6.1 参数配置

```bash
# 设置合理的 Metaspace 大小
-XX:MetaspaceSize=256m \
-XX:MaxMetaspaceSize=1g \
-XX:CompressedClassSpaceSize=1g
```

### 6.2 监控配置

```yaml
# Prometheus 告警
- alert: MetaspaceUsageHigh
  expr: jvm_metaspace_used / jvm_metaspace_max > 0.8
  for: 5m
  annotations:
    summary: "Metaspace 使用率超过 80%"

- alert: MetaspaceOOM
  expr: jvm_oom_total{type="metaspace"} > 0
  annotations:
    summary: "Metaspace OOM 发生"
```

### 6.3 代码规范

1. **避免频繁创建类加载器**
2. **动态代理类要复用**
3. **应用关闭时正确清理资源**
4. **定期检查类加载数量趋势**

---

## 总结

Metaspace 溢出的排查要点：

1. **理解本质**：Metaspace 使用本地内存，不受堆大小限制
2. **设置上限**：MaxMetaspaceSize 必须设置
3. **关注类加载器**：类加载器泄漏是主要原因
4. **使用 Arthas**：在线诊断类加载情况
5. **预防为主**：正确清理资源，避免频繁创建类

---

## 思考题

应用启动后 Metaspace 使用量持续增长，但增长速度很慢。这种情况需要担心吗？

提示：考虑正常情况下的类加载，以及可能存在的类加载器泄漏问题。
