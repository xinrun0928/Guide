# 注解分类与保留策略：元数据的魔力

---

你有没有想过，Spring 怎么知道 `@Controller` 标注的类是控制器？Lombok 怎么自动生成 getter 和 setter？

答案就是**注解（Annotation）**——Java 提供的一种元数据机制，让代码自带「说明书」。

```java
@Override
public void onClick() {
    // 这个方法重写了父类方法
}
```

这一行 `@Override` 看似简单，背后的设计却相当精妙。

## 注解的本质：继承自 Annotation 的接口

和枚举一样，注解也是一种语法糖。`@interface` 声明的注解，实际上是一个继承自 `java.lang.annotation.Annotation` 的接口。

```java
// 你写的
public @interface Author {
    String name();
    String date();
}

// 编译器帮你生成的（等价于）
public interface Author extends Annotation {
    String name();
    String date();
}
```

**注解本身不是类，是接口**。这一点很容易搞错。

## 保留策略：注解能存活多久？

这是理解注解的第一个关键概念：**注解保留在哪个阶段决定它能做什么**。

| 保留策略 | 说明 | 能做什么 |
|---|---|---|
| `SOURCE` | 只保留在源码中，编译后丢弃 | 编译检查（如 `@Override`） |
| `CLASS` | 保留到编译期，运行时丢弃（默认） | 编译时增强（如 ASM） |
| `RUNTIME` | 保留到运行期 | 运行时反射（如 Spring） |

```java
// 源码级注解：编译检查
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.SOURCE)
public @interface Override {
}

// 编译期注解：代码生成
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.CLASS)
public @interface Generated {
    String value();
}

// 运行时注解：反射处理
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface Component {
    String value() default "";
}
```

**如果没有指定 `@Retention`，默认是 `CLASS`**。但大部分时候，我们想要运行时反射，应该显式指定 `RUNTIME`。

## @Target：注解能用在什么地方？

```java
// 只能用在方法上
@Target(ElementType.METHOD)
public @interface Test {
}

// 能用在方法和字段上
@Target({ElementType.METHOD, ElementType.FIELD})
public @interface Valid {
}

// 能用在几乎所有地方
@Target(ElementType.TYPE) // 类、接口、枚举
@Target(ElementType.METHOD)
@Target(ElementType.FIELD)
@Target(ElementType.PARAMETER)
@Target(ElementType.CONSTRUCTOR)
@Target(ElementType.LOCAL_VARIABLE)
@Target(ElementType.ANNOTATION_TYPE) // 注解类型
@Target(ElementType.PACKAGE)
```

## 内置注解：Java 自带的元数据

JDK 内置了一些常用注解：

```java
// 编译检查：方法是否覆盖了父类方法
@Override
public void onClick() { ... }

// 编译检查：方法已过时
@Deprecated
public void oldMethod() { ... }

// 压制警告
@SuppressWarnings("unchecked")
List&lt;String&gt; list = new ArrayList();

// 函数式接口标记
@FunctionalInterface
public interface Runnable {
    void run();
}

// 重复注解（Java 8+）
@Repeatable(Authors.class)
public @interface Author {
    String name();
}
```

### @SuppressWarnings 的常用参数

| 参数 | 说明 |
|---|---|
| `"unchecked"` | 未检查的类型转换 |
| `"deprecation"` | 使用了已过时的 API |
| `"rawtypes"` | 使用了原始类型 |
| `"unused"` | 未使用的变量或方法 |
| `"serial"` | 缺少 serialVersionUID |
| `"all"` | 压制所有警告 |

```java
// 压制多种警告
@SuppressWarnings({"unchecked", "deprecation"})
public void legacyMethod() {
    // ...
}
```

## 注解的属性类型

注解的属性（方法）只能使用以下类型：

```java
public @interface AnnotationDemo {
    // 基本类型
    int value() default 0;
    boolean enabled() default true;

    // String
    String name();

    // Class
    Class&lt;?&gt; clazz() default Object.class;

    // 枚举
    ElementType type() default ElementType.TYPE;

    // 注解
    Author author() default @Author(name = "anonymous");

    // 以上类型的数组
    String[] tags() default {};
}
```

**注意**：注解的属性不能是复杂类型（除非是上面列出的类型）。

### 特殊属性：value()

如果注解只有一个属性且名为 `value`，使用时可以省略属性名：

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Log {
    String value();
}

public class Example {
    // 省略 value=
    @Log("user login")
    public void login() { ... }

    // 如果有其他属性，不能省略
    @Log(value = "user login", level = "INFO")
    public void logout() { ... }
}
```

## 元注解：注解的注解

元注解是用来标注其他注解的注解：

### @Documented

```java
@Documented
public @interface Author {
    String name();
}
```

被 `@Documented` 标记的注解，会出现在 Javadoc 中。

### @Inherited

```java
@Inherited
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface Persistent {
}

@Persistent
public class Entity { }

// User 类会继承 @Persistent 注解
public class User extends Entity { }
```

被 `@Inherited` 标记的父类注解，会自动被子类继承。

## 实际应用：自定义配置注解

### 定义注解

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Cacheable {
    String key();
    int expireSeconds() default 300;
}
```

### 使用注解

```java
public class UserService {

    @Cacheable(key = "user:#{id}", expireSeconds = 600)
    public User findById(Long id) {
        // 查询数据库
        return userRepository.findById(id);
    }
}
```

### 处理注解（反射）

```java
public class CacheInterceptor {

    public Object around(Method method, Object[] args) throws Throwable {
        Cacheable cacheable = method.getAnnotation(Cacheable.class);
        if (cacheable == null) {
            // 没有 @Cacheable 注解，直接执行
            return method.invoke(this, args);
        }

        // 生成缓存 key
        String key = resolveKey(cacheable.key(), method, args);

        // 尝试从缓存获取
        Object cached = Cache.get(key);
        if (cached != null) {
            return cached;
        }

        // 执行方法
        Object result = method.invoke(this, args);

        // 存入缓存
        Cache.put(key, result, cacheable.expireSeconds());

        return result;
    }
}
```

## 注解 vs XML 配置

| 特性 | 注解 | XML |
|---|---|---|
| 配置位置 | 代码中 | 独立文件 |
| 修改方式 | 修改代码 | 修改配置文件 |
| 可读性 | 高（配置就在代码旁） | 低（配置分散） |
| 灵活性 | 低（编译后固定） | 高（可运行时读取） |
| 维护成本 | 低 | 高 |
| 适用场景 | 简单、确定的配置 | 复杂、可能频繁变化的配置 |

Spring Boot 的风格：**约定优于配置**，倾向于用注解而非 XML。

## 面试追问方向

- `@Inherited` 的继承规则是什么？
- 注解的属性为什么不能是 List？
- 如何用注解实现一个简单的依赖注入框架？

## 留给你的思考题

假设你要设计一个 API 限流框架，需要用户这样使用：

```java
@RateLimit(limit = 100, period = 60) // 60秒内最多100次请求
public void apiEndpoint() {
    // 业务逻辑
}
```

请思考：

1. 这个注解应该使用什么 `@Retention`？
2. 如何在方法执行前检查是否超过限流？
3. 如果限流触发，应该抛什么异常？
4. 如何让注解支持 SpEL 表达式，如 `@RateLimit(key = "#userId")`？

实际动手实现一个简化版，你会对注解有更深的理解。
