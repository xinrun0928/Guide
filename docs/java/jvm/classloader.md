# 类加载子系统与类加载器分类

凌晨 3 点，你正在 debug 一个诡异的 ClassNotFoundException。明明 `mvn clean install` 成功了，为什么运行时就找不到类？

答案藏在类加载子系统里。

## 类加载子系统的核心职责

类加载子系统（Class Loader Subsystem）是 JVM 的第一道关卡，负责：

1. **加载**：根据类的全限定名找到 `.class` 文件的字节流
2. **链接**：验证、准备、解析
3. **初始化**：执行类的初始化代码

```
.java 源文件
     ↓ javac 编译
.class 字节码文件
     ↓ 类加载器
  JVM 内部数据结构
     ↓
  方法区 + Class 对象（堆）
```

这里有个关键点：**「加载」只是类加载的第一步**，完整的类加载过程包含五个阶段。

## 类加载的五个阶段

### 1. 加载（Loading）

通过类的全限定名找到 `.class` 文件，将其字节流转化为方法区的运行时数据结构，然后在堆中生成一个 `java.lang.Class` 对象作为访问入口。

### 2. 验证（Verification）

确保字节流符合 JVM 规范，不会危害虚拟机安全。这是最耗时的阶段之一，因为要检查魔数、版本号、符号引用等。

### 3. 准备（Preparation）

为类的静态变量分配内存，并设置默认初始值。注意：**这个阶段只赋零值**，不是程序员写的初始值。

```java
// 准备阶段：a = 0, s = null
public static int a = 123;
public static String s = "hello";
```

### 4. 解析（Resolution）

将符号引用替换为直接引用。
- **符号引用**：一组符号描述目标，不依赖具体内存地址
- **直接引用**：指向目标的指针、偏移量或句柄

### 5. 初始化（Initialization）

执行 `<clinit>()` 方法，即静态变量赋值和静态代码块。**这是真正执行 Java 代码的阶段**。

```java
public class Demo {
    static {
        // 这里才是 a = 123 真正赋值的地方
        a = 456;
    }
    public static int a = 123;
}
```

执行顺序：先执行父类的 `<clinit>()`，再执行子类的。

## 三层类加载器

这是面试的高频考点。JVM 内置了三层类加载器，它们呈父子关系（注意：是包装关系，不是继承）：

```
┌─────────────────────────────────────────────────────┐
│            Bootstrap ClassLoader (启动类加载器)      │
│  加载 JAVA_HOME/jre/lib/rt.jar、resources.jar 等    │
│  核心 Java 类库，比如 java.lang.String               │
│                          ↓ 包含关系（不是继承）        │
│            ExtClassLoader (扩展类加载器)              │
│  加载 JAVA_HOME/jre/lib/ext/*.jar                    │
│  扩展 Java 库                                        │
│                          ↓ 包含关系                   │
│            AppClassLoader (应用类加载器)              │
│  加载 classpath 下的类（-cp 或 CLASSPATH 指定）       │
│  你写的代码基本都由它加载                             │
└─────────────────────────────────────────────────────┘
```

### Bootstrap ClassLoader

也叫**启动类加载器**，是最顶层的类加载器。用 C/C++ 实现，负责加载 Java 核心类库。

```java
// 验证 Bootstrap ClassLoader 加载的类
public class BootstrapTest {
    public static void main(String[] args) {
        String str = "hello";
        // String 由 Bootstrap ClassLoader 加载，结果是 null
        System.out.println(str.getClass().getClassLoader()); // null

        // 尝试获取 Bootstrap ClassLoader 本身
        System.out.println(String.class.getClassLoader()); // null
    }
}
```

打印 `null` 表示由 Bootstrap ClassLoader 加载。

### Extension ClassLoader

也叫**扩展类加载器**，负责加载 `jre/lib/ext` 目录下的 JAR 包。用 Java 实现，是 `sun.misc.Launcher$ExtClassLoader`。

### Application ClassLoader

也叫**应用类加载器**或**系统类加载器**，负责加载 classpath 下的类。用 Java 实现，是 `sun.misc.Launcher$AppClassLoader`。

```java
// 验证类加载器层级
public class ClassLoaderDemo {
    public static void main(String[] args) {
        // 当前类的类加载器是 AppClassLoader
        ClassLoader loader = ClassLoaderDemo.class.getClassLoader();
        System.out.println(loader); // sun.misc.Launcher$AppClassLoader@...
        System.out.println(loader.getParent()); // sun.misc.Launcher$ExtClassLoader@...
        System.out.println(loader.getParent().getParent()); // null (Bootstrap)
    }
}
```

## ClassLoader 的核心方法

`ClassLoader` 类有两个关键方法：

```java
protected Class&lt;?&gt; loadClass(String name, boolean resolve) throws ClassNotFoundException {
    // 1. 先查缓存，看是否已经加载过
    Class&lt;?&gt; c = findLoadedClass(name);
    if (c == null) {
        try {
            // 2. 如果有父加载器，委托给父加载器
            if (parent != null) {
                c = parent.loadClass(name, false);
            } else {
                // 3. 没有父加载器，尝试 Bootstrap
                c = findBootstrapClassOrNull(name);
            }
        } catch (ClassNotFoundException e) {
            // 父加载器找不到，抛出异常
        }
        // 4. 父加载器找不到，自己加载
        if (c == null) {
            c = findClass(name);
        }
    }
    // 5. 如果需要链接，这里会触发 resolve
    if (resolve) {
        resolveClass(c);
    }
    return c;
}

protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
    // 子类重写这个方法自定义加载逻辑
    throw new ClassNotFoundException(name);
}
```

这个 `loadClass()` 方法的逻辑就是**双亲委派模型**的核心，后面会有专题讲解。

## 线程上下文类加载器

除了上面说的三层类加载器，还有一个重要的概念：**线程上下文类加载器**（Thread Context ClassLoader）。

每个线程都有一个关联的类加载器，默认是 AppClassLoader。你可以通过 `setContextClassLoader()` 设置。

```java
// 获取当前线程的上下文类加载器
ClassLoader loader = Thread.currentThread().getContextClassLoader();

// 设置上下文类加载器
Thread.currentThread().setContextClassLoader(customLoader);
```

这个类加载器有什么用？答案是：**打破双亲委派**。

JDBC 的驱动加载就是一个典型例子。JDBC 规范在 `java.sql.DriverManager` 中定义接口，具体驱动由各厂商实现（如 MySQL、PostgreSQL）。但 `DriverManager` 由 Bootstrap ClassLoader 加载，它无法看到 AppClassLoader 加载的驱动类。

解决方案：JDBC 用线程上下文类加载器来加载驱动，实现「下层委托上层」的反向查找。

## 自定义类加载器

什么时候需要自定义类加载器？

- **热部署**：不重启 JVM 加载新版本的类
- **隔离**：同一个 JVM 中运行多个版本或多个来源的同名类
- **加密**：对 class 文件加密，防止反编译
- **动态生成**：运行时生成字节码并加载

```java
public class MyClassLoader extends ClassLoader {

    private String classPath;

    public MyClassLoader(String classPath) {
        this.classPath = classPath;
    }

    @Override
    protected Class&lt;?&gt; findClass(String name) throws ClassNotFoundException {
        // 1. 读取 .class 文件字节流
        byte[] classData = loadClassData(name);
        if (classData == null) {
            throw new ClassNotFoundException(name);
        }
        // 2. 调用 defineClass 将字节流转换为 Class 对象
        return defineClass(name, classData, 0, classData.length);
    }

    private byte[] loadClassData(String className) {
        String fileName = className.replace('.', '/') + ".class";
        try (FileInputStream fis = new FileInputStream(classPath + "/" + fileName);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            int data;
            while ((data = fis.read()) != -1) {
                bos.write(data);
            }
            return bos.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }
}
```

## 类加载器与类的唯一性

在 JVM 中，类的唯一性由「**类加载器 + 类名**」共同决定。同一个类，被不同的类加载器加载，会被视为两个不同的类。

```java
public class LoaderIdentity {
    public static void main(String[] args) throws Exception {
        MyClassLoader loader1 = new MyClassLoader("/path1");
        MyClassLoader loader2 = new MyClassLoader("/path2");

        // 即使加载的是同一个类，identity 也不一样
        Class&lt;?&gt; class1 = loader1.loadClass("com.example.Foo");
        Class&lt;?&gt; class2 = loader2.loadClass("com.example.Foo");

        System.out.println(class1 == class2); // false！
    }
}
```

这在 OSGi、热部署等场景下非常有用。

## 总结

类加载子系统是 JVM 的「入职培训部」，负责将 `.class` 文件引入 JVM 并完成初始化。三层类加载器各司其职，通过双亲委派模型保证类的加载顺序和安全。

面试中，面试官可能会问：

- 「类加载的五个阶段分别做了什么？」
- 「为什么需要自定义类加载器？」
- 「线程上下文类加载器解决的是什么问题？」

---

**留给你的思考题：**

我们说 Bootstrap ClassLoader 是最顶层的加载器，但代码里 `ClassLoader.getParent()` 返回 `null`。这里的 `null` 到底是「没有父加载器」还是「父加载器是 Bootstrap」？

提示：查看 `sun.misc.Launcher` 的源码会有答案。
