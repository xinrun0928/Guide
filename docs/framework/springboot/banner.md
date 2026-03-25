# Spring Boot Banner 定制

每次启动 Spring Boot 项目，控制台都会打印一个 ASCII 艺术风格的 Banner。

这个 Banner 其实可以自定义——可以是文字、图片，甚至是动态动画。

## Banner 文件

Spring Boot 会按以下顺序查找 Banner 文件：

```
1. classpath:banner.gif
2. classpath:banner.jpg
3. classpath:banner.png
4. classpath:banner.txt    ← 最常用
```

### 禁用 Banner

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(Application.class);
        app.setBannerMode(Banner.Mode.OFF);
        app.run(args);
    }
}
```

或者：

```java
public static void main(String[] args) {
    SpringApplication.run(Application.class, args);
}

public static void main(String[] args) {
    new SpringApplicationBuilder(Application.class)
        .bannerMode(Banner.Mode.OFF)
        .run(args);
}
```

## 文字 Banner

### 基本配置

在 `src/main/resources/banner.txt` 中编写：

```
 _____ _____ _____ 
|   __|   __|     |
|__   |__   |   --|
|_____|_____|_____|
 ___   _ _____ _____ _____ 
|   | | |     |     |   __|
| | |_| |-   -|   --|   __|
|_|___|_____|_____|_____|

 :: Spring Boot ::        (v${spring-boot.version})
 :: Application ::        ${application.version}
```

### 变量占位符

Banner 中可以使用以下变量：

| 变量 | 说明 |
|-----|-----|
| `${application.version}` | 应用版本 |
| `${application.title}` | 应用标题 |
| `${spring-boot.version}` | Spring Boot 版本 |
| `${spring-boot.formatted-version}` | 格式化版本，如 `v3.0.0` |
| `${spring.application.name}` | 应用名称 |
| `${java.version}` | Java 版本 |
| `${java.vendor}` | Java 厂商 |

### 完整示例

```
 _____  _   _  ___  _____ _   _ _____ 
/  ___|| | | |/ _ \|  _  | \ | /  ___|
\ `--. | |_| / /_\ \ | | |  \| \ `--.
 `--. \|  _  |  _  | | | | . ` |`--. \
/\__/ /| | | | | | \ \_/ / |\  /\__/ /
\____/ \_| |_\_| |_/\___/\_| \_/\____/ 

:: Spring Boot ::        (v${spring-boot.version})
:: Application ::        ${application.title}
:: Java Version ::       ${java.version}
:: Profile ::           ${spring.profiles.active:-default}
```

## ANSI 颜色

Banner 支持 ANSI 转义序列，可以输出彩色文字：

```txt
${Ansi.RED}这是红色文字${Ansi.DEFAULT}
${Ansi.GREEN}这是绿色文字${Ansi.DEFAULT}
${Ansi.BLUE}这是蓝色文字${Ansi.DEFAULT}
${Ansi.YELLOW}这是黄色文字${Ansi.DEFAULT}
${Ansi.CYAN}这是青色文字${Ansi.DEFAULT}
${Ansi.MAGENTA}这是洋红文字${Ansi.DEFAULT}
${Ansi.WHITE}这是白色文字${Ansi.DEFAULT}
```

### 背景色

```txt
${AnsiBackground.BLACK}黑色背景${AnsiBackground.DEFAULT}
${AnsiBackground.RED}红色背景${AnsiBackground.DEFAULT}
${AnsiBackground.GREEN}绿色背景${AnsiBackground.DEFAULT}
```

### 样式组合

```txt
${AnsiColor.BRIGHT_RED}${AnsiStyle.BOLD}加粗红色文字${AnsiStyle.NORMAL}${AnsiColor.DEFAULT}
${AnsiColor.GREEN}${AnsiStyle.BLINK}闪烁绿色文字${AnsiStyle.NORMAL}${AnsiColor.DEFAULT}
```

### 颜色对应表

| 颜色名称 | 效果 |
|-----|-----|
| BLACK | 黑色 |
| RED | 红色 |
| GREEN | 绿色 |
| YELLOW | 黄色 |
| BLUE | 蓝色 |
| MAGENTA | 洋红色 |
| CYAN | 青色 |
| WHITE | 白色 |
| DEFAULT | 默认色 |

## 图片 Banner

### 图片格式支持

Spring Boot 支持 GIF、JPG、PNG 格式的图片作为 Banner。

### 图片 Banner 优势

1. **更精细的图形**：图片可以实现更复杂的艺术效果
2. **彩色 Banner**：图片可以包含丰富的色彩
3. **无需手动排版**：直接使用图片文件

### 生成 Banner

可以使用在线工具生成 ASCII Art：

1. [ASCII Generator](http://www.network-science.de/ascii/)
2. [Text to ASCII Art Generator](https://patorjk.com/software/taag/)
3. [IMG to ASCII Art](https://www.ascii-art-generators.com/)

### 配置

将图片文件放在 `src/main/resources/` 目录下：

```
src/main/resources/
├── banner.png
└── application.yml
```

## 自定义 Banner 类

### 实现 Banner 接口

```java
package com.example;

import org.springframework.boot.Banner;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.io.PrintStream;

@Component
public class CustomBanner implements Banner {
    
    private static final String BANNER = """
            ╔═══════════════════════════════════════════════════╗
            ║                                                   ║
            ║     ███████╗██╗     ██╗      ██████╗ ███████╗   ║
            ║     ██╔════╝██║     ██║     ██╔═══██╗██╔════╝   ║
            ║     █████╗  ██║     ██║     ██║   ██║█████╗     ║
            ║     ██╔══╝  ██║     ██║     ██║   ██║██╔══╝     ║
            ║     ██║     ███████╗██║     ╚██████╔╝██║        ║
            ║     ╚═╝     ╚══════╝╚═╝      ╚═════╝ ╚═╝        ║
            ║                                                   ║
            ╚═══════════════════════════════════════════════════╝
            """;
    
    @Override
    public void printBanner(Environment environment, Class<?> sourceClass, PrintStream out) {
        out.println(BANNER);
        out.println();
        out.printf("Application: %s%n", environment.getProperty("spring.application.name", "Unknown"));
        out.printf("Spring Boot: %s%n", environment.getProperty("spring.boot.version"));
        out.printf("Java Version: %s%n", System.getProperty("java.version"));
    }
}
```

### 彩色动态 Banner

```java
@Component
public class ColorfulBanner implements Banner {
    
    private static final String[] COLORS = {
        "\033[31m",  // Red
        "\033[33m",  // Yellow
        "\033[32m",  // Green
        "\033[36m",  // Cyan
        "\033[34m",  // Blue
        "\033[35m"   // Magenta
    };
    private static final String RESET = "\033[0m";
    
    @Override
    public void printBanner(Environment environment, Class<?> sourceClass, PrintStream out) {
        String banner = """
                ╔════════════════════════════╗
                ║     Spring Boot Started     ║
                ╚════════════════════════════╝
                """;
        
        // 为每行添加颜色
        String[] lines = banner.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String color = COLORS[i % COLORS.length];
            out.println(color + lines[i] + RESET);
        }
    }
}
```

### 关闭默认 Banner

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(Application.class);
        app.setBanner(new CustomBanner());  // 设置自定义 Banner
        app.setBannerMode(Banner.Mode.CONSOLE);
        app.run(args);
    }
}
```

## Banner 配置

### application.yml 中配置

```yaml
spring:
  main:
    banner-mode: console  # console | log | off
  banner:
    image:
      location: classpath:banner.png  # 图片位置
      width: 80                       # 宽度
      height: 40                       # 高度
      margin: 2                       # 边距
      invert: false                   # 是否反色
```

### Banner 位置

```yaml
spring:
  banner:
    image:
      location: classpath:banner.png
      # 支持多个位置，会按顺序尝试
      locations: 
        - classpath:banner.gif
        - classpath:banner.png
        - classpath:banner.jpg
```

## 企业 Banner 示例

### 简洁商务风

```
================================================================================
                        Welcome to ${application.title}
                        Version: ${application.version}
                        Spring Boot: ${spring-boot.formatted-version}
================================================================================
  Profile: ${spring.profiles.active}
  Java Version: ${java.version}
  Server Port: ${server.port}
================================================================================
```

### 复古终端风

```
┌──────────────────────────────────────────┐
│  ___  _  _  ___  _  _  ___               │
│ | __|| \| || __|| \| || _ \              │
│ | _| | .` || _| | .` ||   /              │
│ |___||_|\_||___||_|\_||_|_\              │
│                                          │
│   Spring Boot ${spring-boot.formatted-version}                  │
│   Application ${application.version}                    │
└──────────────────────────────────────────┘
```

### 动态彩虹风

```
  ████████╗██╗  ██╗███████╗    ██╗     ██╗███████╗███████╗
  ╚══██╔══╝██║  ██║██╔════╝    ██║     ██║╭────────╯╭──────╯
     ██║   ███████║█████╗      ██║     ██║╰──────╮     │
     ██║   ██╔══██║██╔══╝      ██║     ██║╭──────╯     │
     ██║   ██║  ██║███████╗    ███████╗██║╰──────╮     │
     ╚═╝   ╚═╝  ╚═╝╚══════╝    ╚═══════╝╚═╝╰──────╯     │
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| 如何自定义 Spring Boot Banner？ | Banner 定制 |
| Banner 文件的加载顺序是怎样的？ | Spring Boot 资源加载 |
| Banner 支持哪些变量？ | Banner 模板变量 |

---

> Banner 定制虽然是小功能，但它展示了 Spring Boot 的设计理念：**一切皆可配置**。即使是启动时打印的一行字，你也可以完全掌控。
