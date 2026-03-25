# Spring 资源加载：Resource 与 ResourceLoader

你有没有遇到过这种场景？

读取一个配置文件，可以是：
- `classpath:config/application.properties`
- `file:/opt/config/application.properties`
- `http://example.com/config/application.properties`

每种来源的加载方式都不一样，要写三套代码？

Spring 的 `Resource` 和 `ResourceLoader`，提供了统一的资源访问方式。

## Resource 抽象

### 为什么需要 Resource？

Java 的 `java.io.File` 和 `java.net.URL` 只支持特定类型的资源：
- `File` 只能访问文件系统
- `URL` 只能访问网络资源

Spring 的 `Resource` 接口，统一了所有资源类型的访问。

### Resource 接口

```java
public interface Resource extends InputStreamSource {

    // 判断资源是否存在
    boolean exists();

    // 是否可读
    boolean isReadable();

    // 是否打开（流是否占用）
    boolean isOpen();

    // 获取 URL
    URL getURL() throws IOException;

    // 获取 File
    File getFile() throws IOException;

    // 获取 InputStream
    InputStream getInputStream() throws IOException;

    // 获取描述信息
    String getDescription();
}
```

### Resource 的实现类

| 实现类 | 前缀 | 说明 |
|-------|------|------|
| ClassPathResource | `classpath:` | 从 classpath 加载 |
| FileSystemResource | `file:` | 从文件系统加载 |
| UrlResource | `http:`, `ftp:` | 从 URL 加载 |
| ServletContextResource | 无 | 从 ServletContext 加载 |
| ByteArrayResource | 无 | 从字节数组加载 |
| InputStreamResource | 无 | 从 InputStream 加载 |

## Resource 的使用

### ClassPathResource

```java
// 方式一：使用构造器
Resource resource = new ClassPathResource("config/application.properties");

// 方式二：使用 ClassLoader
ClassLoader classLoader = Thread.currentThread().getContextClassLoader();
Resource resource = classLoader.getResourceAsStream("config/application.properties");

// 方式三：从指定 Class 所在包开始查找
Resource resource = new ClassPathResource("config/application.properties", MyClass.class);
```

### FileSystemResource

```java
// 绝对路径
Resource resource = new FileSystemResource("/opt/config/application.properties");

// 相对路径（相对于项目根目录）
Resource resource = new FileSystemResource("config/application.properties");
```

### UrlResource

```java
// HTTP 资源
Resource httpResource = new UrlResource("http://example.com/config/application.properties");

// FTP 资源
Resource ftpResource = new UrlResource("ftp://example.com/config/application.properties");

// 文件系统 URL
Resource fileUrlResource = new UrlResource("file:/opt/config/application.properties");
```

## ResourceLoader 接口

### 接口定义

```java
public interface ResourceLoader {
    // 获取 Resource 实例
    Resource getResource(String location);
}
```

### 使用 ResourceLoader

```java
@Service
public class ConfigLoader {

    @Autowired
    private ResourceLoader resourceLoader;

    public void loadConfig() throws IOException {
        // 加载 classpath 资源
        Resource classpathResource = resourceLoader.getResource("classpath:config/app.properties");

        // 加载文件系统资源
        Resource fileResource = resourceLoader.getResource("file:/opt/config/app.properties");

        // 加载 URL 资源
        Resource urlResource = resourceLoader.getResource("http://example.com/config/app.properties");
    }
}
```

### ApplicationContext 是 ResourceLoader

`ApplicationContext` 继承了 `ResourceLoader`：

```java
@Service
public class ResourceService {

    @Autowired
    private ApplicationContext context;

    public void loadResource() {
        // ApplicationContext 本身就是 ResourceLoader
        Resource resource = context.getResource("classpath:config/app.properties");

        // 还可以使用通配符
        Resource[] resources = context.getResources("classpath*:config/*.properties");
    }
}
```

## Resource 通配符

### classpath*: 前缀

```java
// 加载所有 classpath 下 matching 的资源
Resource[] resources = context.getResources("classpath*:META-INF/spring.factories");

// 常见应用：加载多个配置文件中定义的 Bean
// spring.factories 分布在多个 jar 包中
```

### Ant 风格通配符

```java
// ? 匹配单个字符
Resource resource = context.getResource("classpath:config/application?.properties");
// 匹配: application-dev.properties, application-prod.properties

// * 匹配多个字符
Resource resource = context.getResource("classpath:config/*.properties");
// 匹配: 所有 properties 文件

// ** 匹配多个目录
Resource[] resources = context.getResources("classpath:**/beans.xml");
// 匹配: 任意层级目录下的 beans.xml
```

## @Value 注入 Resource

### 基本注入

```java
@Service
public class ConfigService {

    @Value("classpath:config/app.properties")
    private Resource configFile;

    @Value("file:/opt/config/data.json")
    private Resource dataFile;

    public void loadConfig() throws IOException {
        Properties properties = new Properties();
        properties.load(configFile.getInputStream());
        System.out.println(properties);
    }
}
```

### 注入数组

```java
@Service
public class MultiConfigService {

    // 注入多个 Resource
    @Value("classpath:config/*.properties")
    private Resource[] propertyFiles;

    public void loadAllConfigs() throws IOException {
        for (Resource resource : propertyFiles) {
            System.out.println("Loading: " + resource.getFilename());
        }
    }
}
```

## PathMatchingResourcePatternResolver

### 高级资源匹配

```java
@Service
public class AdvancedResourceLoader {

    public void loadResources() throws IOException {
        PathMatchingResourcePatternResolver resolver = 
            new PathMatchingResourcePatternResolver();

        // 加载单个资源
        Resource resource = resolver.getResource("classpath:config/app.properties");

        // 加载多个资源
        Resource[] resources = resolver.getResources("classpath:config/**/*.xml");

        // 扫描 classpath 下所有 jar 包中的配置文件
        Resource[] springConfigs = resolver.getResources("classpath*:META-INF/spring.factories");
    }
}
```

### 扫描包下所有类

```java
public void scanClasses() throws IOException {
    PathMatchingResourcePatternResolver resolver = 
        new PathMatchingResourcePatternResolver();

    // 获取包下所有 .class 文件
    Resource[] classResources = resolver.getResources(
        "classpath*:com/example/**/*.class"
    );

    for (Resource resource : classResources) {
        System.out.println(resource.getURL());
    }
}
```

## 资源内容读取

### 读取文本内容

```java
@Service
public class TextResourceService {

    public String readText(Resource resource) throws IOException {
        // 方式一：手动读取
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(resource.getInputStream()))) {
            StringBuilder content = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line).append("\n");
            }
            return content.toString();
        }

        // 方式二：使用 FileCopyUtils
        // byte[] bytes = FileCopyUtils.copyToByteArray(resource.getInputStream());
        // String content = new String(bytes);

        // 方式三：StreamUtils（Spring 5）
        // String content = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
    }
}
```

### 读取 Properties

```java
@Service
public class PropertiesResourceService {

    public Properties loadProperties(Resource resource) throws IOException {
        Properties properties = new Properties();

        // 方式一：load()
        try (InputStream is = resource.getInputStream()) {
            properties.load(is);
        }

        return properties;
    }

    public Map&lt;String, String&gt; loadPropertiesAsMap(Resource resource) throws IOException {
        Properties properties = loadProperties(resource);
        return new HashMap&lt;&gt;((Map) properties);
    }
}
```

### 读取 JSON

```java
@Service
public class JsonResourceService {

    private final ObjectMapper objectMapper = new ObjectMapper();

    public &lt;T&gt; T readJson(Resource resource, Class&lt;T&gt; clazz) throws IOException {
        return objectMapper.readValue(resource.getInputStream(), clazz);
    }

    public &lt;T&gt; List&lt;T&gt; readJsonArray(Resource resource, Class&lt;T&gt; elementType) throws IOException {
        return objectMapper.readValue(
            resource.getInputStream(),
            objectMapper.getTypeFactory().constructCollectionType(List.class, elementType)
        );
    }
}
```

## ClassPathResource vs FileSystemResource

### 对比

| 特性 | ClassPathResource | FileSystemResource |
|-----|------------------|-------------------|
| 前缀 | `classpath:` | `file:` |
| 资源位置 | 从 classpath 加载 | 从文件系统加载 |
| 打包后 | 可以访问 jar 包内资源 | 需要外部文件系统 |
| getFile() | 可能抛出异常（jar 内） | 正常工作 |

### 注意事项

```java
// ClassPathResource 在 WAR/JAR 包中可能无法获取 File
Resource resource = new ClassPathResource("config/app.properties");

// jar 包内资源：不能调用 getFile()
try {
    resource.getFile();  // 可能抛出 FileNotFoundException
} catch (FileNotFoundException e) {
    // jar 包内的资源没有真实的文件系统路径
}

// 解决方案：使用 getInputStream()
try (InputStream is = resource.getInputStream()) {
    // 总是可以工作
}
```

## ServletContextResource

在 Web 应用中使用：

```java
@Controller
public class FileController {

    // 自动注入 ServletContext
    @Autowired
    private ServletContext servletContext;

    public void loadWebResource() {
        // 从 webapp 目录加载资源
        Resource resource = new ServletContextResource(servletContext, "/WEB-INF/config/app.properties");
    }
}
```

## 自定义 Resource

### 实现 Resource 接口

```java
public class CustomResource implements Resource {

    private final String path;

    public CustomResource(String path) {
        this.path = path;
    }

    @Override
    public boolean exists() {
        return Files.exists(Paths.get(path));
    }

    @Override
    public boolean isReadable() {
        return Files.isReadable(Paths.get(path));
    }

    @Override
    public boolean isOpen() {
        return false;
    }

    @Override
    public URL getURL() throws IOException {
        return Paths.get(path).toUri().toURL();
    }

    @Override
    public File getFile() throws IOException {
        return Paths.get(path).toFile();
    }

    @Override
    public InputStream getInputStream() throws IOException {
        return Files.newInputStream(Paths.get(path));
    }

    @Override
    public String getDescription() {
        return "Custom resource: " + path;
    }
}
```

### 注册自定义 Resource

```java
@Configuration
public class CustomResourceConfig {

    @Bean
    public ResourceLoader resourceLoader() {
        return new PathMatchingResourcePatternResolver() {
            @Override
            public Resource getResource(String location) {
                if (location.startsWith("custom:")) {
                    String path = location.substring("custom:".length());
                    return new CustomResource(path);
                }
                return super.getResource(location);
            }
        };
    }
}
```

## 常见问题

### 1. classpath 资源找不到

```java
// 检查：资源是否在 classpath 下
// src/main/resources/config/app.properties
// 编译后会打包到 classpath

// 解决：确保资源文件被包含在构建中
// Maven pom.xml
&lt;build&gt;
    &lt;resources&gt;
        &lt;resource&gt;
            &lt;directory&gt;src/main/resources&lt;/directory&gt;
        &lt;/resource&gt;
    &lt;/resources&gt;
&lt;/build&gt;
```

### 2. jar 包内资源 getFile() 失败

```java
// jar 包内的 ClassPathResource 不要调用 getFile()
// 改用 getInputStream()
Resource resource = new ClassPathResource("data.json");
try (InputStream is = resource.getInputStream()) {
    // 总是可以工作
}
```

### 3. 多个 classpath 下资源冲突

```java
// classpath*: 会从所有 classpath 加载
Resource[] resources = resolver.getResources("classpath*:META-INF/spring.factories");
// 如果多个 jar 包都有 spring.factories，会全部加载

// 解决：根据需要使用 classpath: 或 classpath*:
```

## 面试核心问题

### Q1：Resource 的主要实现类有哪些？

| 实现类 | 说明 |
|-------|------|
| ClassPathResource | 从 classpath 加载 |
| FileSystemResource | 从文件系统加载 |
| UrlResource | 从 URL 加载 |
| ServletContextResource | 从 Web 应用加载 |

### Q2：classpath 和 classpath* 的区别？

- `classpath:config/app.properties`：只从第一个 classpath 加载
- `classpath*:config/app.properties`：从所有 classpath 加载

### Q3：如何读取 classpath 下的文件？

```java
// 方式一：ResourceLoader
@Autowired
private ResourceLoader loader;

public void load() {
    Resource resource = loader.getResource("classpath:config/app.properties");
    InputStream is = resource.getInputStream();
}

// 方式二：ClassPathResource
public void load() {
    Resource resource = new ClassPathResource("config/app.properties");
    InputStream is = resource.getInputStream();
}
```

---

**下节预告**：[Spring 国际化（i18n）](/framework/spring/i18n) —— 深入理解 MessageSource 的使用，实现多语言支持。
