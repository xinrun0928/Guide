# ClassLoader 源码解析与自定义类加载器

你写了一个自定义类加载器，但发现类加载了两次；你尝试热部署，但旧类迟迟不能被回收。问题出在哪里？

答案藏在 ClassLoader 源码里。

## ClassLoader 的核心结构

`ClassLoader` 是所有类加载器的基类，用 Java 实现（Bootstrap ClassLoader 除外）。先看它的核心属性：

```java
public abstract class ClassLoader {

    // 父加载器（注意：是包装关系，不是继承）
    private final ClassLoader parent;

    // 类加载器名称（用于调试）
    private final String name;

    // 类的全限定名 → Class 对象的缓存
    private final ConcurrentHashMap&lt;String, Class&lt;?&gt;&gt; classCache = new ConcurrentHashMap&lt;&gt;();
}
```

关键点：**父加载器通过构造函数传入**，而不是继承获得。

## loadClass() 方法的完整流程

这是 ClassLoader 的核心方法：

```java
protected Class&lt;?&gt; loadClass(String name, boolean resolve) throws ClassNotFoundException {
    // 第一步：查缓存，避免重复加载
    Class&lt;?&gt; c = findLoadedClass(name);
    if (c != null) {
        if (resolve) {
            resolveClass(c);
        }
        return c;
    }

    // 第二步：父加载器加载（递归）
    // 注意：先检查是否被 Bootstrap 加载过
    try {
        if (parent != null) {
            c = parent.loadClass(name, false);
        } else {
            // parent 为 null，说明当前是 AppClassLoader
            // 委托给 Bootstrap ClassLoader
            c = findBootstrapClassOrNull(name);
        }
    } catch (ClassNotFoundException e) {
        // 父加载器找不到，继续往下走
    }

    // 第三步：自己加载
    if (c == null) {
        c = findClass(name);
    }

    return c;
}
```

这个流程保证了**双亲委派**：缓存 → 父加载器 → 自己加载。

## findClass() vs defineClass()

ClassLoader 提供了两个方法供子类重写：

```java
// 由子类重写，实现自定义加载逻辑
protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
    throw new ClassNotFoundException(name);
}

// 由 findClass() 调用，将字节数组转换为 Class 对象
protected final Class&lt;?&gt; defineClass(byte[] b, int off, int len) throws ClassFormatError {
    // ... native 方法，真正的类解析
}
```

**正确做法**：重写 `findClass()`，不要重写 `loadClass()`（除非你需要打破双亲委派）。

```java
public class MyClassLoader extends ClassLoader {

    @Override
    protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
        // 1. 找到 .class 文件
        String path = name.replace('.', '/') + ".class";
        byte[] bytes = loadClassData(path);

        // 2. 调用 defineClass 转换为 Class 对象
        return defineClass(name, bytes, 0, bytes.length);
    }

    private byte[] loadClassData(String path) {
        // 读取文件实现
    }
}
```

## Launcher 源码解析

`Launcher` 是 JVM 启动时初始化的类加载器入口。看它的源码：

```java
public class Launcher {
    private static Launcher launcher = new Launcher();

    // 扩展类加载器
    private ClassLoader extClassLoader;

    // 应用类加载器
    private ClassLoader appClassLoader;

    public Launcher() {
        // 创建扩展类加载器，parent 为 null（委托给 Bootstrap）
        ClassLoader extcl;
        extcl = ExtClassLoader.getExtClassLoader();
        // 创建应用类加载器，parent 为扩展类加载器
        appClassLoader = new AppClassLoader(extcl);
        // 将应用类加载器设为线程上下文类加载器
        Thread.currentThread().setContextClassLoader(appClassLoader);
    }
}
```

层级关系：

```
Bootstrap ClassLoader (C++, 无 parent)
        ↓ (parent = null)
ExtClassLoader (parent = null，但会先查 Bootstrap)
        ↓
AppClassLoader (parent = ExtClassLoader)
        ↓
线程上下文类加载器 = AppClassLoader
```

## URLClassLoader 的实现

`AppClassLoader` 继承自 `URLClassLoader`，而 `URLClassLoader` 实现了 `findClass()`：

```java
public class URLClassLoader extends SecureClassLoader {

    // 从 URLs（文件、jar、http 等）加载类
    @Override
    protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
        // 遍历所有 URL，查找 .class 文件
        for (URL url : urls) {
            try {
                // 1. 将 URL 转换为字节流
                // 2. 调用 defineClass
                return defineClass(name, bytes, 0, bytes.length);
            } catch (Exception e) {
                // 继续尝试下一个 URL
            }
        }
        throw new ClassNotFoundException(name);
    }
}
```

`AppClassLoader` 的 URLs 就是 classpath 指定的路径（`-cp` 参数）。

## 自定义类加载器实战

### 场景一：文件系统类加载器

```java
public class FileSystemClassLoader extends ClassLoader {

    private final String baseDir;

    public FileSystemClassLoader(String baseDir) {
        this.baseDir = baseDir;
    }

    @Override
    protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
        // 防止核心类被覆盖
        if (name.startsWith("java.")) {
            throw new SecurityException("Cannot load java.* classes");
        }

        try {
            // 构建文件路径
            String fileName = name.replace('.', File.separatorChar) + ".class";
            File file = new File(baseDir, fileName);

            if (!file.exists()) {
                throw new ClassNotFoundException("File not found: " + file);
            }

            // 读取字节码
            byte[] classData = Files.readAllBytes(file.toPath());

            // 转换为 Class 对象
            return defineClass(name, classData, 0, classData.length);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }
}
```

### 场景二：热部署类加载器

热部署的核心是**每次重新加载都创建新的 ClassLoader**：

```java
public class HotDeployClassLoader {

    private ClassLoader currentLoader;
    private final String classPath;

    public HotDeployClassLoader(String classPath) {
        this.classPath = classPath;
        // 初始加载器
        this.currentLoader = new URLClassLoader(
            new URL[]{new File(classPath).toURI().toURL()},
            getClass().getClassLoader()  // parent
        );
    }

    /**
     * 重新加载类（新创建 ClassLoader，旧 loader 成为垃圾）
     */
    public Class&lt;?&gt; reload(String className) throws Exception {
        // 1. 创建新的 ClassLoader
        URLClassLoader newLoader = new URLClassLoader(
            new URL[]{new File(classPath).toURI().toURL()},
            getClass().getClassLoader()
        );

        // 2. 加载新类
        Class&lt;?&gt; newClass = newLoader.loadClass(className);

        // 3. 更新引用
        this.currentLoader = newLoader;

        // 4. 旧 loader 不再被引用，等待 GC 回收
        // （前提是该 loader 加载的类实例都已不可达）
        return newClass;
    }

    public Class&lt;?&gt; loadClass(String className) throws ClassNotFoundException {
        return currentLoader.loadClass(className);
    }
}
```

**关键点**：旧 ClassLoader 必须没有任何活跃引用，加载的类实例也要全部不可达，GC 才能回收它们。

### 场景三：加密类加载器

可以先加密 `.class` 文件，加载时解密：

```java
public class EncryptedClassLoader extends ClassLoader {

    private final String baseDir;
    private final byte[] secretKey;

    @Override
    protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
        // 解密逻辑
        byte[] encrypted = loadEncryptedData(name);
        byte[] decrypted = decrypt(encrypted, secretKey);

        return defineClass(name, decrypted, 0, decrypted.length);
    }

    private byte[] decrypt(byte[] data, byte[] key) {
        // XOR 或 AES 解密
        byte[] result = new byte[data.length];
        for (int i = 0; i < data.length; i++) {
            result[i] = (byte) (data[i] ^ key[i % key.length]);
        }
        return result;
    }
}
```

## 常见问题排查

### 问题一：类加载了两次

```java
public class DoubleLoadClassLoader extends ClassLoader {

    @Override
    protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
        // ❌ 错误：忘记调用父类的 findLoadedClass
        // 可能导致同一个类被加载两次

        byte[] data = loadClassData(name);
        return defineClass(name, data, 0, data.length);
    }
}
```

**正确做法**：先调用 `findLoadedClass()` 检查缓存：

```java
@Override
protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
    // ✅ 先检查缓存
    Class&lt;?&gt; cached = findLoadedClass(name);
    if (cached != null) {
        return cached;
    }

    byte[] data = loadClassData(name);
    return defineClass(name, data, 0, data.length);
}
```

### 问题二：类找不到

自定义类加载器的 parent 通常是 AppClassLoader。如果要加载的类依赖 classpath 中的类，需要确保 parent 能找到它们。

解决方案：

```java
public class CustomClassLoader extends ClassLoader {

    public CustomClassLoader() {
        // 设置 parent 为系统类加载器，确保能加载依赖
        super(Thread.currentThread().getContextClassLoader());
    }
}
```

### 问题三：线程上下文类加载器被错误设置

如果线程的上下文类加载器被错误设置，可能导致类加载异常。可以用以下方式恢复：

```java
ClassLoader original = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(customLoader);
    // 执行需要自定义类加载器的代码
} finally {
    Thread.currentThread().setContextClassLoader(original);
}
```

## 总结

ClassLoader 的源码解析揭示了双亲委派的核心逻辑：

1. `loadClass()` 先查缓存，再委托父加载器，最后自己加载
2. `findClass()` 是子类重写的入口
3. `defineClass()` 将字节数组转换为 Class 对象

自定义类加载器时，**优先重写 `findClass()` 而不是 `loadClass()`**，除非你需要打破双亲委派。

---

**留给你的思考题：**

为什么 JDK 9 之后不再推荐使用 `SecureClassLoader` 的子类 `URLClassLoader`，而是推荐使用 `Layer` 和 `PlatformClassLoader`？

提示：考虑 JDK 9 的模块化系统（JPMS）对类加载器层级的影响。
