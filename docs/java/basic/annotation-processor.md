# 注解处理器与 Lombok：编译时代的魔法

---

你有没有想过，Lombok 怎么做到只加一个 `@Data` 注解，就能自动生成 getter、setter、equals、hashCode、toString？

```java
@Data
public class User {
    private Long id;
    private String name;
    private String email;
}
```

编译后自动变成：

```java
public class User {
    private Long id;
    private String name;
    private String email;

    public User() { }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    // ... 其他 getter/setter ...

    public boolean equals(Object o) { ... }
    public int hashCode() { ... }
    public String toString() { ... }
}
```

答案是**编译时注解处理器（Annotation Processor）**——Java 编译过程中的一道魔法。

## 编译时注解处理原理

注解处理器在**编译期间**运行，读取源代码中的注解，生成新的 `.java` 文件或 `.class` 文件。

```
Java 源文件 (.java)
       ↓
    编译阶段
       ↓
注解处理器链（可多个，按序执行）
       ↓
    .class 文件
```

**关键点**：注解处理器操作的是源码（.java），不是字节码（.class）。

## 核心 API：AbstractProcessor

自定义注解处理器需要继承 `AbstractProcessor`：

```java
@SupportedAnnotationTypes("com.example.Builder")
@SupportedSourceVersion(SourceVersion.RELEASE_8)
public class BuilderProcessor extends AbstractProcessor {

    @Override
    public boolean process(Set&lt;? extends TypeElement&gt; annotations,
                           RoundEnvironment roundEnv) {
        // 处理逻辑
        for (Element element : roundEnv.getElementsAnnotatedWith(Builder.class)) {
            processType((TypeElement) element);
        }
        return true; // 表示已处理，不再传递
    }

    private void processType(TypeElement typeElement) {
        // 生成代码
    }
}
```

### 关键方法

```java
public abstract class AbstractProcessor {

    // 处理器的初始化，可获取 Messager（用于输出错误/警告）和 Filer（用于写文件）
    public synchronized void init(ProcessingEnvironment processingEnv) { }

    // 返回此处理器支持的注解类型（可以是通配符如 "com.example.*"）
    public Set&lt;String&gt; getSupportedAnnotationTypes() { }

    // 返回支持的 Java 版本
    public SourceVersion getSupportedSourceVersion() { }

    // 核心方法：处理注解
    // annotations: 当前轮次要处理的注解集合
    // roundEnv: 当前轮次的环境信息
    public abstract boolean process(Set&lt;? extends TypeElement&gt; annotations,
                                    RoundEnvironment roundEnv);
}
```

## RoundEnvironment：处理多轮次

编译过程可能分多轮进行，注解处理器会被调用多次：

```java
@Override
public boolean process(Set&lt;? extends TypeElement&gt; annotations,
                       RoundEnvironment roundEnv) {

    // 获取所有被 @Builder 标注的元素
    Set&lt;? extends Element&gt; elements = roundEnv.getElementsAnnotatedWith(Builder.class);

    for (Element element : elements) {
        if (element.getKind() == ElementKind.CLASS) {
            processClass((TypeElement) element);
        }
    }

    // 返回 true 表示这些注解已被处理
    // 如果返回 false，其他处理器可能会继续处理
    return true;
}
```

### Element 类型层次

```java
// Element 的子类代表不同类型的源代码元素
Element
├── ExecutableElement  // 方法
├── TypeElement        // 类/接口/枚举
├── VariableElement    // 字段/局部变量/参数
├── PackageElement     // 包
└── TypeParameterElement // 泛型参数
```

## Filer：生成文件

使用 `Filer` 创建新的源文件：

```java
public class BuilderProcessor extends AbstractProcessor {

    private Filer filer;

    @Override
    public synchronized void init(ProcessingEnvironment processingEnv) {
        super.init(processingEnv);
        this.filer = processingEnv.getFiler();
    }

    private void generateBuilderClass(TypeElement typeElement) {
        String className = typeElement.getSimpleName() + "Builder";
        String qualifiedName = getPackageName(typeElement) + "." + className;

        try {
            JavaFileObject sourceFile = filer.createSourceFile(qualifiedName);

            try (PrintWriter writer = new PrintWriter(sourceFile.openWriter())) {
                writer.println("package " + getPackageName(typeElement) + ";");
                writer.println();
                writer.println("public class " + className + " {");
                writer.println("    private final " + typeElement.getSimpleName() + " target;");
                writer.println();
                writer.println("    private " + className + "() {");
                writer.println("        this.target = new " + typeElement.getSimpleName() + "();");
                writer.println("    }");
                writer.println("    // ... 更多方法 ...");
                writer.println("}");
            }
        } catch (IOException e) {
            processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR,
                "Failed to generate: " + e.getMessage());
        }
    }
}
```

## 实际案例：实现 @Builder 注解

### 定义 @Builder 注解

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface Builder {
    String builderMethodName() default "builder";
}
```

### 实现 BuilderProcessor

```java
@SupportedAnnotationTypes("com.example.Builder")
@SupportedSourceVersion(SourceVersion.RELEASE_8)
public class BuilderProcessor extends AbstractProcessor {

    @Override
    public boolean process(Set&lt;? extends TypeElement&gt; annotations,
                           RoundEnvironment roundEnv) {

        for (Element element : roundEnv.getElementsAnnotatedWith(Builder.class)) {
            TypeElement typeElement = (TypeElement) element;
            generateBuilder(typeElement);
        }

        return true;
    }

    private void generateBuilder(TypeElement typeElement) {
        String className = typeElement.getSimpleName().toString();
        String builderClassName = className + "Builder";
        String qualifiedBuilderName = getPackageName(typeElement) + "." + builderClassName;

        try {
            // 获取被 @Builder 标注的类的所有字段
            List&lt;VariableElement&gt; fields = getFields(typeElement);

            // 生成 Builder 类
            JavaFileObject sourceFile = filer.createSourceFile(qualifiedBuilderName);

            try (PrintWriter writer = new PrintWriter(sourceFile.openWriter())) {
                writePackage(writer, typeElement);
                writeClassStart(writer, builderClassName, className);
                writeFields(writer, fields);
                writeBuilderMethod(writer, fields, builderClassName);
                writeBuildMethod(writer, fields, className);
                writer.println("}");
            }
        } catch (IOException e) {
            error("Failed to create builder: " + e.getMessage());
        }
    }

    // 获取类中的所有字段
    private List&lt;VariableElement&gt; getFields(TypeElement typeElement) {
        List&lt;VariableElement&gt; fields = new ArrayList&lt;&gt;();
        for (Element enclosed : typeElement.getEnclosedElements()) {
            if (enclosed.getKind() == ElementKind.FIELD) {
                VariableElement field = (VariableElement) enclosed;
                // 排除 static 字段
                if (!field.getModifiers().contains(Modifier.STATIC)) {
                    fields.add(field);
                }
            }
        }
        return fields;
    }

    // ... 其他辅助方法 ...
}
```

### 注册处理器

需要在 `META-INF/services` 目录创建配置文件：

```
META-INF/services/javax.annotation.processing.Processor
```

文件内容：

```
com.example.BuilderProcessor
```

## Lombok 原理：比你想象的更简单

Lombok 本质上就是一套编译时注解处理器：

| Lombok 注解 | 生成的代码 |
|---|---|
| `@Data` | getter/setter/equals/hashCode/toString/构造函数 |
| `@Getter` | getter |
| `@Setter` | setter |
| `@NoArgsConstructor` | 无参构造函数 |
| `@AllArgsConstructor` | 全参构造函数 |
| `@Builder` | Builder 模式 |
| `@Slf4j` | `private static final Logger log = LoggerFactory.getLogger(...)` |

### Lombok 的处理流程

```java
// 源码阶段
@Data
public class User { ... }

// Lombok Processor 处理
// 1. 解析 @Data 注解
// 2. 分析类结构
// 3. 生成 getter/setter/equals/hashCode/toString 方法
// 4. 将生成的代码插入到 .class 文件中

// 编译后 .class 文件
public class User {
    private Long id;
    private String name;

    public User() { }

    public Long getId() { return this.id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return this.name; }
    public void setName(String name) { this.name = name; }
    // equals, hashCode, toString ...
}
```

## Lombok 的问题与争议

### 优点

1. **减少样板代码**：不用写几十行 getter/setter
2. **提高可读性**：聚焦业务逻辑而非模板
3. **降低维护成本**：修改字段时不用手动更新 getter/setter

### 缺点

| 问题 | 说明 |
|---|---|
| IDE 支持 | 需要安装 Lombok 插件 |
| 调试困难 | 生成的代码在 .class 中，源码中没有 |
| 可读性争议 | 「魔法」注解让代码行为不透明 |
| IDE 提示 | 字段上的警告「从未被使用」 |

### 注意事项

```java
// Lombok 生成的代码在编译后才存在
// 所以 IDE 可能提示字段「从未被使用」是正常的

@Data
public class User {
    private Long id; // IDE 警告：从未被使用
                       // 但 Lombok 会在编译时生成 getter/setter
}

// 解决方案：安装 Lombok 插件
// 或者在 IDE 中启用 "Annotation Processing"
```

## 注册 Lombok 处理器

```xml
&lt;!-- pom.xml --&gt;
&lt;dependency&gt;
    &lt;groupId&gt;org.projectlombok&lt;/groupId&gt;
    &lt;artifactId&gt;lombok&lt;/artifactId&gt;
    &lt;version&gt;1.18.30&lt;/version&gt;
    &lt;scope&gt;provided&lt;/scope&gt;
&lt;/dependency&gt;

&lt;!-- maven-compiler-plugin 配置 --&gt;
&lt;plugin&gt;
    &lt;groupId&gt;org.apache.maven.plugins&lt;/groupId&gt;
    &lt;artifactId&gt;maven-compiler-plugin&lt;/artifactId&gt;
    &lt;configuration&gt;
        &lt;annotationProcessorPaths&gt;
            &lt;path&gt;
                &lt;groupId&gt;org.projectlombok&lt;/groupId&gt;
                &lt;artifactId&gt;lombok&lt;/artifactId&gt;
                &lt;version&gt;1.18.30&lt;/version&gt;
            &lt;/path&gt;
        &lt;/annotationProcessorPaths&gt;
    &lt;/configuration&gt;
&lt;/plugin&gt;
```

## 面试追问方向

- 注解处理器能修改已有的类吗？
- 为什么 Lombok 不需要注册处理器（之前需要）？
- 注解处理器和 Java 反射有什么区别？

## 留给你的思考题

假设你要实现一个 `@Required` 注解，标注哪些字段是必填的：

```java
public class UserRegistrationRequest {
    @Required
    private String username;

    @Required
    private String password;

    @Required
    private String email;

    private String phone; // 可选
}
```

然后在运行时自动校验：

```java
UserRegistrationRequest req = new UserRegistrationRequest();
// req.setUsername("...");
// req.setPassword("...");
// req.setEmail("...");

validate(req); // 应该抛出异常：username, password, email 不能为空
```

请思考：

1. 这个校验逻辑应该放在注解处理器还是运行时？
2. 如果放在运行时，需要什么技术手段获取类的字段信息？
3. 如果想同时支持编译时检查（如 IDE 提示）和运行时检查，如何设计？

这道题涉及注解处理器和反射的权衡，实际工作中经常会遇到。
