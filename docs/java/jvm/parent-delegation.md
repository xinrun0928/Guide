# 双亲委派模型与打破方式

你试过创建一个 `java.lang.String` 类吗？

```java
package java.lang;

public class String {
    public static void main(String[] args) {
        System.out.println("Hello World");
    }
}
```

编译通过，运行——结果会打印 "Hello World" 吗？

答案是：**不会**。JVM 会抛出 `NoSuchMethodError: main`，或者干脆找不到你写的 `main` 方法。

为什么？因为双亲委派模型。

## 什么是双亲委派模型

双亲委派模型（Parent Delegation Model）描述的是类加载器之间的层次关系和工作方式：

> 当一个类加载器收到加载请求时，它首先不会自己去加载，而是把这个请求**委派给父加载器**处理。每层加载器都如此，直到最顶层的 Bootstrap ClassLoader。只有当父加载器无法完成请求时，子加载器才会尝试自己加载。

```
┌──────────────────────────────────────────────────────────────┐
│  AppClassLoader 收到加载 java.lang.String 的请求             │
│                         ↓                                    │
│  委托给 ExtClassLoader                                        │
│                         ↓                                    │
│  委托给 Bootstrap ClassLoader                                 │
│                         ↓                                    │
│  Bootstrap 加载 rt.jar 中的 java.lang.String ✓               │
│                         ↓                                    │
│  返回 java.lang.String.class 给 AppClassLoader                │
└──────────────────────────────────────────────────────────────┘
```

用代码表示就是：

```java
protected Class&lt;?&gt; loadClass(String name, boolean resolve) {
    // 1. 先查缓存
    Class&lt;?&gt; c = findLoadedClass(name);
    if (c != null) return c;

    try {
        // 2. 优先让父加载器加载
        if (parent != null) {
            c = parent.loadClass(name, false);
        } else {
            // 3. parent 为 null，说明是 Bootstrap
            c = findBootstrapClassOrNull(name);
        }
    } catch (ClassNotFoundException e) {
        // 父加载器抛异常，继续
    }

    // 4. 父加载器找不到，自己加载
    if (c == null) {
        c = findClass(name);
    }
    return c;
}
```

## 双亲委派模型的好处

### 1. 避免类的重复加载

如果父加载器已经加载了某个类，子加载器不需要重新加载。类的「真正加载者」是第一个完成加载的父加载器。

### 2. 保证核心类库的安全性

这是最重要的目的。假设没有双亲委派，你可以自定义 `java.lang.String`，JVM 就会加载你的版本而不是核心库的版本。后果是灾难性的——`String` 类可能没有 `length()`、`substring()` 等方法，整个 Java 生态崩溃。

**双亲委派模型确保了核心类库只能由 Bootstrap ClassLoader 加载**，自定义类永远无法替代它们。

## 你永远无法「替代」核心类

回到开头的问题：

```java
package java.lang;

public class String {
    public static void main(String[] args) {
        System.out.println("Hello World");
    }
}
```

即使你创建了 `java.lang.String` 类并编译成功，JVM 也不会执行你的 `main` 方法。因为 Bootstrap ClassLoader 早就加载了真正的 `java.lang.String`，你的版本根本没机会上场。

但如果不用双亲委派，后果更严重：

```
自定义 java.lang.String → 没有 equals() 方法
                    → Object o = "hello";
                    → o.equals() 直接崩溃
                    → 整个 JDK 无法工作
```

## 如何打破双亲委派

正常情况下，不应该打破双亲委派。但在某些场景下，确实需要「下层加载器委托上层」的反向操作。

### 方式一：线程上下文类加载器（最常用）

JDBC 是最经典的例子。

`java.sql.DriverManager` 由 Bootstrap ClassLoader 加载（因为在 `rt.jar` 中），它无法直接看到 MySQL 驱动（由 AppClassLoader 加载）。

```java
// java.sql.DriverManager 源码简化
public class DriverManager {
    static {
        // 使用线程上下文类加载器加载驱动
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        if (loader != null) {
            // 从 SPI 配置文件读取驱动类名
            ServiceLoader&lt;Driver&gt; loadedDrivers = ServiceLoader.load(Driver.class, loader);
        }
    }
}
```

流程：

```
DriverManager（Bootstrap 加载）
    ↓ 使用线程上下文类加载器（默认 AppClassLoader）
    ↓
AppClassLoader 加载 com.mysql.cj.jdbc.Driver
    ↓
Driver.registerDriver() 注册到 DriverManager
```

这就是「**上级委托下级**」的反向操作，打破了双亲委派。

### 方式二：自定义 ClassLoader + 重写 loadClass()

直接不遵循双亲委派的逻辑，自己决定加载顺序：

```java
public class CustomClassLoader extends ClassLoader {

    @Override
    protected Class&lt;?&gt; loadClass(String name, boolean resolve) throws ClassNotFoundException {
        // 直接自己加载，不委托父加载器（危险操作！）
        Class&lt;?&gt; c = findLoadedClass(name);
        if (c == null) {
            c = findClass(name);
        }
        if (c == null && !name.startsWith("java.")) {
            // 对于非核心类，让父加载器尝试
            c = getParent().loadClass(name);
        }
        if (resolve) {
            resolveClass(c);
        }
        return c;
    }
}
```

### 方式三：OSGi 模块化框架

OSGi（Open Service Gateway Initiative）是一个模块化框架，每个 Bundle（模块）有自己的类加载器。OSGi 采用「**按需加载**」策略，不严格遵循双亲委派。

### 方式四：Tomcat 的类加载机制

Tomcat 为了实现 Web 应用隔离，打破了双亲委派：

```
Bootstrap ClassLoader
        ↓
  System ClassLoader
        ↓
  Common ClassLoader (Tomcat 公共类)
        ↓
  WebApp ClassLoader 1 (WebApp A 的类)
  WebApp ClassLoader 2 (WebApp B 的类)
```

每个 Web 应用有自己的 ClassLoader，先加载自己的类，再委托给父加载器。这保证了：
- 两个 Web 应用可以有不同版本的同一个类
- Web 应用的类不会覆盖 JDK 的类

### 方式五：热部署

热部署的原理是：**每次重新加载类时，创建一个新的 ClassLoader**，旧 ClassLoader 加载的类成为垃圾被回收。

```java
public class HotReloadClassLoader {

    private ClassLoader currentLoader;

    public void reload(String className) throws Exception {
        // 创建新的 ClassLoader
        ClassLoader newLoader = new URLClassLoader(
            ((URLClassLoader)getClass().getClassLoader()).getURLs()
        );
        // 用新 ClassLoader 加载新版本的类
        Class&lt;?&gt; newClass = newLoader.loadClass(className);
        // 旧 loader 成为垃圾，等待 GC 回收
        currentLoader = newLoader;
    }
}
```

## 打破双亲委派的场景总结

| 场景 | 打破方式 | 原因 |
|-----|---------|------|
| JDBC 驱动加载 | 线程上下文类加载器 | 核心类加载器无法加载应用类 |
| Tomcat Web 应用隔离 | 自定义 ClassLoader 顺序 | 不同应用需要不同版本的类 |
| OSGi 模块化 | 按需加载 | 模块化需要更灵活的加载策略 |
| 热部署 | 新建 ClassLoader | 旧版本的类需要被卸载 |

## 面试高频问题

**Q1：双亲委派模型的作用是什么？**

保证 Java 核心类库的安全性，避免核心类被篡改；同时避免类的重复加载。

**Q2：如何破坏双亲委派模型？**

自定义 ClassLoader 并重写 `loadClass()` 方法；使用线程上下文类加载器；OSGi 框架等。

**Q3：为什么 JDBC 需要打破双亲委派？**

`DriverManager` 由 Bootstrap ClassLoader 加载，无法看到由 AppClassLoader 加载的数据库驱动。通过线程上下文类加载器，实现「上层加载器使用下层加载器加载的类」。

**Q4：Tomcat 为什么要打破双亲委派？**

保证多个 Web 应用之间的类隔离，不同应用可能依赖不同版本的同一个库。

## 总结

双亲委派模型是 JVM 类加载的核心机制，通过「**父优先**」的策略保证了安全性和类的唯一性。但某些场景（JDBC、Tomcat、OSGi）需要打破这个模型，通过线程上下文类加载器、自定义 ClassLoader 等方式实现更灵活的加载策略。

理解双亲委派，不仅是面试需要，更是理解 Java 模块化、热部署等高级特性的基础。

---

**留给你的思考题：**

如果我有两个 Web 应用 A 和 B：
- A 依赖 `commons-collections v3.2.1`
- B 依赖 `commons-collections v3.2.2`

Tomcat 能否同时满足这两个依赖？为什么？

提示：考虑类加载器的层级关系和类的唯一性判定标准。
