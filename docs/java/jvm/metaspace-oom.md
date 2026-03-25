# Metaspace 溢出：类加载过多导致的 OOM

如果说堆溢出是「对象太多」，那 Metaspace 溢出就是「类太多」。

JDK 8 用 Metaspace 替代了 PermGen，但这并不意味着 Metaspace 就不会 OOM。

---

## Metaspace vs PermGen

```
┌─────────────────────────────────────────────────────────────┐
│  JDK 7 PermGen vs JDK 8+ Metaspace                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  JDK 7 PermGen：                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  堆内存                                              │   │
│  │  ┌───────────┬───────────┬───────────┐           │   │
│  │  │ 年轻代    │ 老年代    │  PermGen  │           │   │
│  │  │           │           │ (类信息)   │           │   │
│  │  └───────────┴───────────┴───────────┘           │   │
│  │                      ↑                              │   │
│  │              容易 OOM，难以扩展                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  JDK 8+ Metaspace：                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  堆内存                        本地内存               │   │
│  │  ┌───────────┬───────────┐ ┌─────────────────┐   │   │
│  │  │ 年轻代    │ 老年代    │ │    Metaspace    │   │   │
│  │  │           │           │ │   (类信息)      │   │   │
│  │  └───────────┴───────────┘ └─────────────────┘   │   │
│  │                                          ↑          │   │
│  │                              使用 OS 内存，可动态扩展 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 关键区别

| 特性 | PermGen | Metaspace |
|-----|---------|----------|
| 位置 | JVM 堆 | 本地内存（OS）|
| 大小 | 固定（-XX:MaxPermSize）| 动态扩展（-XX:MaxMetaspaceSize）|
| OOM | 容易 | 可能但较难 |
| 类卸载 | 需手动启用 | 默认开启 |
| 字符串常量池 | PermGen | 移到堆中 |

---

## Metaspace 溢出的原因

### 错误信息

```
java.lang.OutOfMemoryError: Metaspace
```

### 主要原因

```
┌─────────────────────────────────────────────────────────────┐
│  Metaspace 溢出原因                                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 动态类生成过多                                         │
│     - CGLIB 动态代理                                        │
│     - 字节码编织工具                                        │
│     - 脚本引擎（Groovy、JRuby）                             │
│                                                              │
│  2. JSP 频繁编译                                           │
│     - 每个 JSP 页面编译成一个类                             │
│     - 热部署时类不断累积                                    │
│                                                              │
│  3. 反射/注解处理                                          │
│     - 大量注解处理器生成类                                  │
│     - 动态代理生成类                                        │
│                                                              │
│  4. 类加载器泄漏                                           │
│     - Web 容器热部署                                        │
│     - OSGi 类加载器                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 常见场景

### 场景 1：CGLIB 动态代理

```java
public class CglibLeak {
    public static void main(String[] args) {
        // 不断生成 CGLIB 代理类
        while (true) {
            Enhancer enhancer = new Enhancer();
            enhancer.setSuperclass(MyClass.class);
            enhancer.setCallback((MethodInterceptor) (o, method, objects, methodProxy) ->
                methodProxy.invokeSuper(o, objects));
            enhancer.create();  // 每次创建新类
            // 注意：每次 create() 都会生成新的类！
        }
    }
}
```

### 场景 2：JSP 热部署

```java
// JSP 编译过程
// 每次访问 JSP 页面：
// 1. 编译 JSP → Java 源文件
// 2. 编译 Java 源文件 → Class 文件
// 3. 加载 Class → Metaspace
// 问题：热部署时，旧的 Class 还没卸载，新的又加载
```

### 场景 3：动态代理 + 反射

```java
public class DynamicProxyLeak {
    public static void main(String[] args) {
        // JDK 动态代理
        while (true) {
            Proxy.newProxyInstance(
                DynamicProxyLeak.class.getClassLoader(),
                new Class[]{MyInterface.class},
                (proxy, method, methodArgs) -> method.invoke(null, methodArgs)
            );
            // 每次都生成新的代理类
        }
    }
}
```

---

## 监控与排查

### jstat 监控

```bash
# 监控 Metaspace 使用
jstat -gc <pid> 1000

# 输出
S0C    S1C    S0U    S1U      EC       EU        OC         OU       MC     MU    CCSC   CCSU   YGC     YGCT    FGC    FGCT     GCT
8704.0 8704.0  0.0   2560.0 65536.0  32768.0  262144.0   131072.0  48128.0 46848.0 6144.0  5952.0    156    2.345   0    0.000    2.345
  MC = Metaspace Capacity（元空间容量）
  MU = Metaspace Used（元空间使用）
  CCSC = Compressed Class Space Capacity（压缩类空间容量）
  CCSU = Compressed Class Space Used（压缩类空间使用）
```

### jcmd 查看详情

```bash
# 查看 Metaspace 详情
jcmd <pid> VM.native_memory summary

# 或者
jcmd <pid> GC.class_stats
```

### jmap 查看类加载信息

```bash
# 查看类加载统计
jmap -clstats <pid>

# 查看类直方图
jmap -histo <pid> | grep Class
```

---

## 参数配置

### Metaspace 大小配置

```bash
# JDK 8
-XX:MetaspaceSize=128m      # 初始元空间大小（触发 Full GC 的阈值）
-XX:MaxMetaspaceSize=512m    # 最大元空间大小

# JDK 11+
-XX:MetaspaceSize=256m
-XX:MaxMetaspaceSize=1g

# 无限制（不推荐）
-XX:MaxMetaspaceSize=-1
```

### 监控与告警

```bash
# GC 日志监控 Metaspace
java -XX:+UseG1GC \
     -Xlog:gc*=info:file=gc.log \
     -XX:MetaspaceSize=128m \
     -XX:MaxMetaspaceSize=512m \
     your.Application
```

### 日志中的 Metaspace 信息

```text
# JDK 9+ 统一日志格式
[2024-01-15T10:30:00.123+0800] [gc,metadata] GC(10) Metaspace: 128M->128M(256M)
    # Metaspace 使用 128MB，未达到阈值
    # 容量 256MB

# 当 Metaspace 接近阈值时
[2024-01-15T10:35:00.456+0800] [gc,metadata] GC(20) Metaspace: 240M->240M(256M)
    # 即将触发 Full GC 加载类元数据
```

---

## 实战排查案例

### 案例：CGLIB 代理泄漏

```java
// 问题代码
public class ProxyCache {
    private static final Map<String, Object> proxies = new HashMap<>();

    public static Object getProxy(Class<?> clazz) {
        if (!proxies.containsKey(clazz.getName())) {
            Enhancer enhancer = new Enhancer();
            enhancer.setSuperclass(clazz);
            enhancer.setCallback((MethodInterceptor) (o, method, objects, methodProxy) ->
                methodProxy.invokeSuper(o, objects));
            proxies.put(clazz.getName(), enhancer.create());
            // 问题：enhancer.create() 每次都生成新类！
        }
        return proxies.get(clazz.getName());
    }
}
```

### 排查步骤

```bash
# 1. 观察 Metaspace 增长
jstat -gc <pid> 1000
# MC 列持续增长

# 2. 生成堆转储
jmap -dump:format=b,file=metaspace.hprof <pid>

# 3. MAT 分析
# 查看 class loader 数量
# 查看生成的代理类数量
```

### 修复方案

```java
// 修复后：复用代理类
public class ProxyCacheFixed {
    // 使用 WeakReference 保存类加载器，避免类加载器泄漏
    private static final Map<Class<?>, WeakReference<ClassLoader>> cachedClassLoaders =
        new WeakHashMap<>();

    // 缓存代理类，而不是每次生成新的
    private static final Map<Class<?>, Object> proxies = new ConcurrentHashMap<>();

    public static <T> T getProxy(Class<T> clazz) {
        return clazz.cast(proxies.computeIfAbsent(clazz, c -> {
            Enhancer enhancer = new Enhancer();
            enhancer.setSuperclass(c);
            enhancer.setCallback((MethodInterceptor) (o, method, objects, methodProxy) ->
                methodProxy.invokeSuper(o, objects));
            return enhancer.create();
        }));
    }
}
```

---

## 类加载泄漏防护

### 最佳实践

```java
// 1. 使用线程上下文类加载器
public class ClassLoaderLeakPrevention {
    public static void init() {
        // 使用当前线程的类加载器加载资源
        Thread.currentThread().getContextClassLoader()
            .getResourceAsStream("config.xml");
    }
}

// 2. 及时释放类加载器
public class ClassLoaderLeakFix {
    private ClassLoader customLoader;

    public void loadClasses() {
        customLoader = new URLClassLoader(urls);
        // 使用完后
    }

    public void cleanup() {
        if (customLoader != null) {
            // 帮助卸载类
            customLoader = null;
        }
    }
}

// 3. 使用 WeakReference 持有类加载器
public class WeakClassLoaderHolder {
    private final WeakReference<ClassLoader> loaderRef;

    public WeakClassLoaderHolder(ClassLoader loader) {
        this.loaderRef = new WeakReference<>(loader);
    }

    public ClassLoader get() {
        return loaderRef.get();
    }
}
```

---

## 面试追问方向

- JDK 8 为什么去掉 PermGen？换成 Metaspace 有什么好处？
- Metaspace 在哪块内存中？默认大小是多少？
- 什么情况下会导致 Metaspace OOM？
- Metaspace 的 `-XX:MetaspaceSize` 和 `-XX:MaxMetaspaceSize` 有什么区别？
- 如何监控 Metaspace 的使用情况？有哪些工具？
- 类卸载的条件是什么？如何触发类卸载？
