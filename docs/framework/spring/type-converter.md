# Spring 类型转换：PropertyEditor、Converter 与 Formatter

你有没有想过这个问题：

表单提交一个日期字符串 `"2024-01-15"`，Spring 是怎么把它变成 `LocalDate` 的？

`"true"` 怎么变成 `boolean` 的？

`"com.example.User"` 怎么变成 `Class&lt;User&gt;` 的？

这背后的功臣，就是 Spring 的**类型转换系统**。

## 类型转换的整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Spring 类型转换流程                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  String "2024-01-15"                                                   │
│         │                                                               │
│         ▼                                                               │
│  ConversionService                                                    │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ Converter / Formatter / PropertyEditor                           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│         │                                                               │
│         ▼                                                               │
│  LocalDate (2024-01-15)                                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## PropertyEditor

### 什么是 PropertyEditor？

PropertyEditor 是 Java Bean 规范的一部分，用于在 String 和其他类型之间转换。

```java
public interface PropertyEditor {
    // 获取文本值
    String getAsText();
    
    // 设置文本值
    void setAsText(String text) throws java.lang.IllegalArgumentException;
    
    // 其他方法...
}
```

### Spring 中的 PropertyEditor

Spring 使用 `PropertyEditorRegistry` 管理 PropertyEditor：

```java
// Spring 自动注册了很多 PropertyEditor
// String → Date
// String → Class
// String → Locale
// String → Currency
// String → TimeZone
```

### 自定义 PropertyEditor

```java
// 方式一：继承 PropertyEditorSupport
public class UserStatusEditor extends PropertyEditorSupport {
    
    @Override
    public String getAsText() {
        UserStatus status = (UserStatus) getValue();
        return status != null ? status.name() : "";
    }
    
    @Override
    public void setAsText(String text) throws IllegalArgumentException {
        setValue(UserStatus.valueOf(text));
    }
}

// 方式二：使用 @PropertyEditor
@Component
public class UserStatusPropertyEditor extends PropertyEditorSupport {
    
    @Override
    public String getAsText() {
        UserStatus status = (UserStatus) getValue();
        return status != null ? status.name() : "";
    }
    
    @Override
    public void setAsText(String text) throws IllegalArgumentException {
        setValue(UserStatus.valueOf(text));
    }
}

// 注册到容器
@Configuration
public class WebConfig {
    
    @Bean
    public CustomEditorConfigurer customEditorConfigurer() {
        CustomEditorConfigurer configurer = new CustomEditorConfigurer();
        configurer.setCustomEditors(Map.of(
            UserStatus.class, new UserStatusEditor()
        ));
        return configurer;
    }
}
```

## Converter

### Converter 接口

Spring 3 引入的转换器接口，比 PropertyEditor 更灵活：

```java
@FunctionalInterface
public interface Converter&lt;S, T&gt; {
    T convert(S source);
}
```

### 基本使用

```java
@Configuration
public class ConverterConfig {

    @Bean
    public ConversionServiceFactoryBean conversionService() {
        ConversionServiceFactoryBean factory = new ConversionServiceFactoryBean();
        factory.setConverters(Set.of(
            new StringToDateConverter(),
            new DateToStringConverter(),
            new StringToUserStatusConverter()
        ));
        return factory;
    }
}

// 自定义转换器
public class StringToDateConverter implements Converter&lt;String, Date&gt; {
    private final SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");

    @Override
    public Date convert(String source) {
        try {
            return sdf.parse(source);
        } catch (ParseException e) {
            throw new IllegalArgumentException("Invalid date format", e);
        }
    }
}

public class StringToUserStatusConverter implements Converter&lt;String, UserStatus&gt; {
    @Override
    public UserStatus convert(String source) {
        return UserStatus.valueOf(source.toUpperCase());
    }
}
```

### 使用 ConversionService

```java
@Service
public class ConversionServiceUsage {

    @Autowired
    private ConversionService conversionService;

    public void useConverter() {
        // String → Date
        Date date = conversionService.convert("2024-01-15", Date.class);

        // String → UserStatus
        UserStatus status = conversionService.convert("ACTIVE", UserStatus.class);
    }
}
```

## ConverterFactory

### 批量转换

```java
// ConverterFactory：为一类类型创建 Converter
public class StringToEnumConverterFactory implements ConverterFactory&lt;String, Enum&lt;?&gt;&gt; {

    @Override
    public &lt;T extends Enum&lt;?&gt;&gt; Converter&lt;String, T&gt; getConverter(Class&lt;T&gt; targetType) {
        return new StringToEnumConverter&lt;&gt;(targetType);
    }

    private static class StringToEnumConverter&lt;T extends Enum&lt;?&gt;&gt; implements Converter&lt;String, T&gt; {
        private final Class&lt;T&gt; enumType;

        public StringToEnumConverter(Class&lt;T&gt; enumType) {
            this.enumType = enumType;
        }

        @Override
        public T convert(String source) {
            return Enum.valueOf((Class&lt;Enum&gt;) enumType, source.toUpperCase());
        }
    }
}

// 注册
@Configuration
public class ConverterConfig {
    @Bean
    public ConversionServiceFactoryBean conversionService() {
        ConversionServiceFactoryBean factory = new ConversionServiceFactoryBean();
        factory.setConverters(Set.of(new StringToEnumConverterFactory()));
        return factory;
    }
}
```

## GenericConverter

### 复杂类型转换

```java
// GenericConverter：支持更复杂的类型转换
public interface GenericConverter {
    
    // 获取可转换的类型对
    Set&lt;ConvertiblePair&gt; getConvertibleTypes();
    
    // 执行转换
    Object convert(Object source, Class&lt;?&gt; sourceType, Class&lt;?&gt; targetType);
}

// 示例：String ↔ List&lt;String&gt;
public class StringToCollectionConverter implements GenericConverter {
    
    @Override
    public Set&lt;ConvertiblePair&gt; getConvertibleTypes() {
        return Set.of(
            new ConvertiblePair(String.class, Collection.class),
            new ConvertiblePair(String.class, List.class),
            new ConvertiblePair(String.class, Set.class)
        );
    }

    @Override
    public Object convert(Object source, Class&lt;?&gt; sourceType, 
                          Class&lt;?&gt; targetType) {
        if (source == null) {
            return null;
        }
        String str = (String) source;
        String[] parts = str.split(",");
        
        if (targetType.isAssignableFrom(List.class)) {
            return Arrays.asList(parts);
        } else if (targetType.isAssignableFrom(Set.class)) {
            return new HashSet&lt;&gt;(Arrays.asList(parts));
        }
        return Arrays.asList(parts);
    }
}
```

## Formatter

### Formatter 接口

Formatter 是 Spring 3 引入的，用于 Web 层的格式化：

```java
public interface Formatter&lt;T&gt; extends Printer&lt;T&gt;, Parser&lt;T&gt; {
}

public interface Printer&lt;T&gt; {
    String print(T object, Locale locale);
}

public interface Parser&lt;T&gt; {
    T parse(String text, Locale locale) throws ParseException;
}
```

### 自定义 Formatter

```java
// 日期格式化
public class DateFormatter implements Formatter&lt;LocalDate&gt; {
    
    private final String pattern;

    public DateFormatter(String pattern) {
        this.pattern = pattern;
    }

    @Override
    public String print(LocalDate date, Locale locale) {
        return date.format(DateTimeFormatter.ofPattern(pattern));
    }

    @Override
    public LocalDate parse(String text, Locale locale) throws ParseException {
        return LocalDate.parse(text, DateTimeFormatter.ofPattern(pattern));
    }
}

// 使用
@Configuration
public class WebConfig implements WebMvcConfigurer {
    
    @Override
    public void addFormatters(FormatterRegistry registry) {
        registry.addFormatter(new DateFormatter("yyyy-MM-dd"));
        registry.addFormatter(new DateFormatter("yyyy-MM-dd HH:mm:ss"));
    }
}
```

### @DateTimeFormat 注解

```java
public class UserDTO {
    
    @DateTimeFormat(pattern = "yyyy-MM-dd")
    private LocalDate birthDate;
    
    @DateTimeFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime;
    
    @NumberFormat(pattern = "#,###.##")
    private Double salary;
}
```

## FormattingConversionService

### 注册 Formatter

```java
@Configuration
public class FormattingConfig {
    
    @Bean
    public FormattingConversionServiceFactoryBean formattingConversionService() {
        FormattingConversionServiceFactoryBean factory = 
            new FormattingConversionServiceFactoryBean();
        
        factory.setFormatters(Set.of(
            new DateFormatter("yyyy-MM-dd"),
            new DateFormatter("yyyy-MM-dd HH:mm:ss")
        ));
        
        factory.setFormatterRegistrars(Set.of(
            new JodaDateTimeFormatFactory()  // Joda Time 格式化
        ));
        
        factory.setUseIsoFormat(true);  // ISO 8601 格式
        
        return factory;
    }
}
```

## ConversionService 统一使用

### Spring Boot 自动配置

Spring Boot 自动配置了 ConversionService，支持：
- 基本类型转换
- 日期时间转换
- 集合和数组转换
- 枚举转换

### 注入使用

```java
@Service
public class ConversionServiceUsage {

    @Autowired
    private ConversionService conversionService;

    // String → Date
    public Date convertToDate(String dateStr) {
        return conversionService.convert(dateStr, Date.class);
    }

    // String → LocalDate
    public LocalDate convertToLocalDate(String dateStr) {
        return conversionService.convert(dateStr, LocalDate.class);
    }

    // Integer → String
    public String convertToString(Integer num) {
        return conversionService.convert(num, String.class);
    }
}
```

### @RequestParam 参数转换

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    // Spring 自动使用 ConversionService 转换 @RequestParam
    @GetMapping
    public List&lt;User&gt; getUsers(
            @RequestParam Date startDate,  // String → Date
            @RequestParam UserStatus status) {  // String → Enum
        return userService.findByDateAndStatus(startDate, status);
    }

    // @PathVariable 也支持
    @GetMapping("/{status}")
    public List&lt;User&gt; getUsersByStatus(@PathVariable UserStatus status) {
        return userService.findByStatus(status);
    }
}
```

## 条件转换

### ConditionalConverter

```java
// ConditionalConverter：根据条件决定是否转换
public interface ConditionalConverter {
    boolean matches(TypeDescriptor sourceType, TypeDescriptor targetType);
}

// ConditionalGenericConverter：组合 Conditional 和 Generic
public interface ConditionalGenericConverter 
        extends GenericConverter, ConditionalConverter {
}

// 示例：只有特定格式才转换
public class ConditionalDateConverter implements ConditionalGenericConverter {
    
    @Override
    public Set&lt;ConvertiblePair&gt; getConvertibleTypes() {
        return Set.of(new ConvertiblePair(String.class, Date.class));
    }

    @Override
    public boolean matches(TypeDescriptor sourceType, TypeDescriptor targetType) {
        // 只有 yyyy-MM-dd 格式才转换
        String source = (String) sourceType;
        return source.matches("\\d{4}-\\d{2}-\\d{2}");
    }

    @Override
    public Object convert(Object source, TypeDescriptor sourceType, 
                          TypeDescriptor targetType) {
        // 转换逻辑
    }
}
```

## Spring Boot 中的类型转换

### 自动配置

Spring Boot 自动配置了 `WebConversionService`：

```java
// 默认支持：
// - String → 基本类型
// - String → Date/LocalDate/LocalDateTime
// - String → Enum
// - String → Collection/List/Set/Map
// - String → File
// - String → URI/URL
// - String → Class
```

### 自定义转换器

```java
@Configuration
public class CustomConverterConfig implements WebMvcConfigurer {

    @Override
    public void addFormatters(FormatterRegistry registry) {
        // 添加 Formatter
        registry.addFormatter(new DateFormatter("yyyy-MM-dd"));
        
        // 添加 Converter
        registry.addConverter(new StringToUserStatusConverter());
        
        // 添加 ConverterFactory
        registry.addConverterFactory(new StringToEnumConverterFactory());
    }
}
```

## 常见问题

### 1. 转换失败

```java
// 转换失败会抛出 ConversionFailedException
try {
    UserStatus status = conversionService.convert("INVALID", UserStatus.class);
} catch (ConversionFailedException e) {
    // 处理转换失败
}

// 解决方案：提供默认转换器
@Configuration
public class FallbackConverterConfig {
    @Bean
    public ConversionServiceFactoryBean conversionService() {
        ConversionServiceFactoryBean factory = new ConversionServiceFactoryBean();
        factory.setConverters(Set.of(
            new FallbackStringToEnumConverter()
        ));
        return factory;
    }
}
```

### 2. @RequestParam 转换失败

```java
// 请求 /api/users?status=INVALID
// Spring 会抛出 MethodArgumentTypeMismatchException

@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result&lt;Void&gt; handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        String message = String.format("参数 %s 的值 %s 无法转换为 %s",
            ex.getName(),
            ex.getValue(),
            ex.getRequiredType().getSimpleName()
        );
        return Result.error(400, message);
    }
}
```

### 3. 日期格式不一致

```java
// 解决方案一：使用 @DateTimeFormat
public class UserDTO {
    @DateTimeFormat(pattern = "yyyy-MM-dd")
    private LocalDate birthDate;
}

// 解决方案二：配置全局格式化
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addFormatters(FormatterRegistry registry) {
        registry.addFormatter(new DateFormatter("yyyy-MM-dd"));
    }
}
```

## 面试核心问题

### Q1：PropertyEditor 和 Converter 的区别？

| 特性 | PropertyEditor | Converter |
|-----|---------------|-----------|
| 引入 | Java Bean 规范 | Spring 3 |
| 方向 | 双向（String ↔ 其他） | 单向 |
| 泛型 | 不支持 | 支持 |
| 使用场景 | 旧代码兼容 | 新代码推荐 |

### Q2：Formatter 和 Converter 的区别？

| 特性 | Formatter | Converter |
|-----|-----------|-----------|
| 上下文 | 支持 Locale | 不关心 Locale |
| 使用场景 | Web 层 | 通用 |
| 注解支持 | @DateTimeFormat 等 | 无 |

### Q3：Spring Boot 如何自动配置转换器？

Spring Boot 通过 `WebMvcAutoConfiguration` 自动注册 `FormattingConversionService`，支持日期、数字、枚举等常用类型的转换。

---

**下节预告**：[Spring Bean 作用域深度解析](/framework/spring/bean-scope) —— 理解 singleton、prototype、request、session、websocket 等作用域的区别和使用场景。
