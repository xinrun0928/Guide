# try-with-resources：优雅的资源管理

---

想象一个场景：你打开了一个文件读取数据，代码执行到一半，抛出了异常。

```java
FileInputStream fis = new FileInputStream("data.txt");
 BufferedReader reader = new BufferedReader(new InputStreamReader(fis));
String line = reader.readLine();
// 假设这里抛出了异常...

reader.close();  // 这行永远执行不到
fis.close();     // 这行也执行不到
```

文件句柄泄漏了。如果这个场景在生产环境高频发生，你的应用迟早会报「too many open files」。

JDK 7 之前，人们用 `finally` 块来解决这个问题。但 `finally` 的写法繁琐，容易出错。**try-with-resources 就是来解决这个问题的。**

## AutoCloseable 接口：资源的契约

任何需要自动关闭的资源，都应该实现 `AutoCloseable` 接口：

```java
public interface AutoCloseable {
    void close() throws Exception;
}
```

JDK 7 之后，几乎所有涉及资源关闭的类都实现了这个接口：

- `InputStream` / `OutputStream` 系列
- `Reader` / `Writer` 系列
- `Connection`（JDBC）
- `Statement` / `ResultSet`（JDBC）
- `Channel`（NIO）
- `Lock`（JUC）

## 基本语法

```java
// JDK 7 之前：繁琐的 try-finally
FileInputStream fis = null;
try {
    fis = new FileInputStream("data.txt");
    // 使用 fis
} finally {
    if (fis != null) {
        fis.close();
    }
}

// JDK 7+：try-with-resources
try (FileInputStream fis = new FileInputStream("data.txt")) {
    // 使用 fis
} // 自动调用 fis.close()
```

**简单、直观、不易出错。**

## 多资源声明

多个资源用分号隔开，**先开后关，后开先关**：

```java
try (
    FileInputStream fis = new FileInputStream("input.txt");
    FileOutputStream fos = new FileOutputStream("output.txt")
) {
    byte[] buffer = new byte[1024];
    int bytesRead;
    while ((bytesRead = fis.read(buffer)) != -1) {
        fos.write(buffer, 0, bytesRead);
    }
} // fos 先关闭，然后 fis 关闭
```

**关闭顺序很重要**：`fos` 依赖 `fis` 的数据，所以应该先关闭 `fos`。在 try-with-resources 中，`fos` 后声明，所以先关闭。

## catch 和 finally 配合使用

```java
try (
    Connection conn = DriverManager.getConnection(url, user, password);
    PreparedStatement ps = conn.prepareStatement(sql);
    ResultSet rs = ps.executeQuery()
) {
    while (rs.next()) {
        // 处理结果
    }
} catch (SQLException e) {
    // 异常处理
} finally {
    // 这里可以做一些额外清理，但通常不需要
}
```

`try-with-resources` 可以像普通 try 一样配合 `catch` 和 `finally` 使用。

## 资源关闭的顺序：后开先关

```java
public class ResourceOrderDemo {

    static class Resource implements AutoCloseable {
        private final String name;

        Resource(String name) {
            this.name = name;
            System.out.println("打开: " + name);
        }

        @Override
        public void close() {
            System.out.println("关闭: " + name);
        }
    }

    public static void main(String[] args) {
        try (
            Resource r1 = new Resource("资源1");
            Resource r2 = new Resource("资源2");
            Resource r3 = new Resource("资源3")
        ) {
            System.out.println("使用资源中...");
        }
    }
}
```

输出：

```
打开: 资源1
打开: 资源2
打开: 资源3
使用资源中...
关闭: 资源3
关闭: 资源2
关闭: 资源1
```

**栈的 LIFO（后进先出）顺序，确保依赖关系正确的资源能正确关闭。**

## suppress 异常链：主异常 vs 关闭异常

当资源关闭时也可能抛出异常，这时怎么办？

```java
try (
    Resource r = new Resource("资源")
) {
    throw new RuntimeException("使用资源时出错");
} // close() 也可能抛异常
```

有两个异常要处理：业务异常和关闭异常。Java 7 的解决方案是**抑制关闭异常**：

```java
public class SuppressDemo {

    static class Resource implements AutoCloseable {
        @Override
        public void close() throws RuntimeException {
            throw new RuntimeException("关闭时出错");
        }
    }

    public static void main(String[] args) {
        try {
            try (Resource r = new Resource()) {
                throw new RuntimeException("使用时出错");
            }
        } catch (RuntimeException e) {
            System.out.println("主异常: " + e.getMessage());

            // 获取被抑制的异常
            Throwable[] suppressed = e.getSuppressed();
            System.out.println("被抑制的异常数量: " + suppressed.length);
            for (Throwable t : suppressed) {
                System.out.println("  被抑制: " + t.getMessage());
            }
        }
    }
}
```

输出：

```
主异常: 使用时出错
被抑制的异常数量: 1
  被抑制: 关闭时出错
```

**规则**：正常执行时抛出的异常是主异常，close() 时抛出的异常被抑制（放入主异常的 suppress 列表）。

## 有效利用 suppress 机制

### 手动添加被抑制的异常

```java
try (Resource r = new Resource()) {
    throw new RuntimeException("主异常");
} catch (RuntimeException e) {
    // 手动添加被抑制的异常
    e.addSuppressed(new RuntimeException("补充说明"));
    throw e;
}
```

### 避免在 finally 块中抛出异常

```java
// JDK 7 之前的糟糕写法
try {
    doSomething();
} finally {
    closeQuietly(); // 可能覆盖原异常！
}

private void closeQuietly() {
    try {
        // 关闭操作
    } catch (IOException e) {
        // 吞掉了原始异常！
    }
}
```

**try-with-resources 自动处理异常抑制，避免了这个问题。**

## 实战：JDBC 资源管理

```java
// JDK 7 之前的写法
Connection conn = null;
PreparedStatement ps = null;
ResultSet rs = null;
try {
    conn = ds.getConnection();
    ps = conn.prepareStatement(sql);
    rs = ps.executeQuery();
    // 处理结果
} catch (SQLException e) {
    // 处理异常
} finally {
    if (rs != null) try { rs.close(); } catch (SQLException e) {}
    if (ps != null) try { ps.close(); } catch (SQLException e) {}
    if (conn != null) try { conn.close(); } catch (SQLException e) {}
}
```

```java
// JDK 7+ try-with-resources
try (
    Connection conn = ds.getConnection();
    PreparedStatement ps = conn.prepareStatement(sql);
    ResultSet rs = ps.executeQuery()
) {
    // 处理结果
} catch (SQLException e) {
    // 处理异常
}
```

简洁、清晰、不易出错。

## 自定义 AutoCloseable 资源

你也可以让自己的类实现 `AutoCloseable`：

```java
public class DatabaseTransaction implements AutoCloseable {

    private final Connection conn;

    public DatabaseTransaction(String url, String user, String password)
            throws SQLException {
        conn = DriverManager.getConnection(url, user, password);
        conn.setAutoCommit(false);
    }

    public void commit() throws SQLException {
        conn.commit();
    }

    public void rollback() {
        try {
            conn.rollback();
        } catch (SQLException e) {
            throw new RuntimeException("回滚失败", e);
        }
    }

    @Override
    public void close() {
        if (conn != null) {
            try {
                conn.setAutoCommit(true);
                conn.close();
            } catch (SQLException e) {
                // 可以记录日志或添加为被抑制异常
                throw new RuntimeException("关闭连接失败", e);
            }
        }
    }
}
```

使用方式：

```java
try (DatabaseTransaction tx = new DatabaseTransaction(url, user, password)) {
    // 执行多个数据库操作
    tx.commit();
} // 自动回滚并关闭
```

## 面试追问方向

- try-with-resources 中 close() 抛出的异常会覆盖业务异常吗？
- 多个资源同时关闭时，如果某个资源关闭失败，其他资源还会关闭吗？
- 如何让一个类同时持有多个资源并确保它们都能正确关闭？

## 留给你的思考题

考虑以下代码：

```java
try (
    Resource1 r1 = new Resource1();
    Resource2 r2 = new Resource2();
) {
    // ...
}
```

问题：

1. 如果 `Resource1` 的构造方法抛出异常，`Resource2` 需要关闭吗？
2. 如果 `Resource2` 的构造方法抛出异常，`Resource1` 需要关闭吗？
3. 如果 try 块中抛异常，同时 `Resource1.close()` 也抛异常，最终捕获到的是哪个？

理解了这些问题，你对 try-with-resources 的资源管理机制就算掌握透彻了。
