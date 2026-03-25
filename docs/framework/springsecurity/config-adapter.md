# WebSecurityConfigurerAdapter 配置方式演进

如果你现在维护一个 Spring Security 5.x 的老项目，你一定见过这样的代码：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
            .antMatchers("/admin/**").hasRole("ADMIN")
            .anyRequest().authenticated()
            .and()
            .formLogin();
    }
}
```

但如果你用的是 Spring Security 6.x，**这个类已经被移除了**。

今天，我们就来梳理 Spring Security 配置方式的演进历程，以及如何在新的版本中实现等效配置。

---

## 配置方式的演进历程

Spring Security 的配置方式经历了三个阶段：

| 阶段 | 版本 | 配置方式 | 特点 |
|-----|------|---------|------|
| 1 | 2.x - 4.x | XML 配置 | 冗长、难以理解 |
| 2 | 5.x | WebSecurityConfigurerAdapter | Java 配置主流 |
| 3 | 6.x+ | Lambda DSL | 更简洁、更灵活 |

---

## WebSecurityConfigurerAdapter 详解（旧方式）

`WebSecurityConfigurerAdapter` 是 Spring Security 5.x 时代的核心配置类，它提供了三个可重写的方法：

### 三个 configure 方法

```java
public abstract class WebSecurityConfigurerAdapter {
    
    // 1. 配置 Web 安全性（哪些路径需要认证，哪些不需要）
    protected void configure(HttpSecurity http) throws Exception { }
    
    // 2. 配置认证方式（内存、JDBC、UserDetailsService）
    protected void configure(AuthenticationManagerBuilder auth) throws Exception { }
    
    // 3. 配置全局认证（AuthenticationManagerBuilder）
    @Autowired
    public void setAuthenticationBuilder(AuthenticationManagerBuilder auth) { }
}
```

### 典型配置示例

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    
    // 方式一：内存用户
    @Override
    protected void configure(AuthenticationManagerBuilder auth) throws Exception {
        auth.inMemoryAuthentication()
            .withUser("user").password("{noop}password").roles("USER")
            .and()
            .withUser("admin").password("{noop}admin").roles("USER", "ADMIN");
    }
    
    // 方式二：自定义 UserDetailsService
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    @Override
    protected void configure(AuthenticationManagerBuilder auth) throws Exception {
        auth.userDetailsService(userDetailsService)
            .passwordEncoder(passwordEncoder());
    }
    
    // 配置 HttpSecurity
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
                .antMatchers("/public/**").permitAll()
                .antMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            .and()
            .formLogin()
                .loginPage("/login")
                .defaultSuccessUrl("/home")
                .permitAll()
            .and()
            .logout()
                .logoutSuccessUrl("/login?logout")
            .and()
            .csrf();
    }
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

### 多安全配置类的顺序问题

`WebSecurityConfigurerAdapter` 支持多个配置类，顺序通过 `@Order` 控制：

```java
@Order(1)
@Configuration
public static class AdminSecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.antMatcher("/admin/**").authorizeRequests().anyRequest().hasRole("ADMIN");
    }
}

@Order(2)
@Configuration
public static class ApiSecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.antMatcher("/api/**").authorizeRequests().anyRequest().authenticated();
    }
}
```

---

## Lambda DSL 配置方式（新方式）

Spring Security 6.x 移除了 `WebSecurityConfigurerAdapter`，全面转向 Lambda DSL 配置。

### 核心变化

```java
// Spring Security 5.x（旧）
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
                .antMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            .and()
            .formLogin();
    }
}

// Spring Security 6.x（新）
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .formLogin(Customizer.withDefaults());
        return http.build();
    }
}
```

### 主要方法对照表

| 5.x 方法 | 6.x Lambda 写法 | 说明 |
|---------|-----------------|------|
| `authorizeRequests()` | `authorizeHttpRequests()` | 路径授权 |
| `.antMatchers("/path")` | `.requestMatchers("/path")` | 路径匹配 |
| `.hasRole("ADMIN")` | `.hasRole("ADMIN")` | 角色判断 |
| `.authenticated()` | `.authenticated()` | 需要认证 |
| `.permitAll()` | `.permitAll()` | 允许所有人 |
| `.and().formLogin()` | `.formLogin(Customizer.withDefaults())` | 表单登录 |
| `.and().csrf()` | `.csrf(csrf -> {})` | CSRF 配置 |

---

## 完整配置迁移示例

### 用户认证配置

```java
// 5.x 方式
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    @Override
    protected void configure(AuthenticationManagerBuilder auth) throws Exception {
        auth.userDetailsService(userDetailsService)
            .passwordEncoder(passwordEncoder());
    }
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}

// 6.x 方式
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    // 方式一：通过 @Bean 提供 AuthenticationManager
    @Bean
    public UserDetailsService userDetailsService() {
        return userDetailsService;
    }
    
    // 方式二：暴露 AuthenticationManager
    @Bean
    public AuthenticationManager authenticationManager(
            AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

### HttpSecurity 配置

```java
// 5.x 方式
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
                .antMatchers("/public/**", "/login").permitAll()
                .antMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            .and()
            .formLogin()
                .loginPage("/login")
                .defaultSuccessUrl("/home", true)
                .failureUrl("/login?error")
                .permitAll()
            .and()
            .logout()
                .logoutUrl("/logout")
                .logoutSuccessUrl("/login?logout")
                .deleteCookies("JSESSIONID")
            .and()
            .rememberMe()
                .tokenValiditySeconds(604800)
                .key("mySecretKey")
            .and()
            .csrf();
    }
}

// 6.x 方式
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**", "/login").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                .loginPage("/login")
                .defaultSuccessUrl("/home", true)
                .failureUrl("/login?error")
                .permitAll()
            )
            .logout(logout -> logout
                .logoutUrl("/logout")
                .logoutSuccessUrl("/login?logout")
                .deleteCookies("JSESSIONID")
            )
            .rememberMe(remember -> remember
                .tokenValiditySeconds(604800)
                .key("mySecretKey")
            )
            .csrf(csrf -> csrf.disable());  // 注意：6.x 需要显式配置
        
        return http.build();
    }
}
```

---

## 6.x 中的新写法

### 多 SecurityFilterChain 配置

6.x 中，通过 `@Order` 或 `securityMatcher` 来区分不同的过滤器链：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    // 第一条链：API 专用（无状态）
    @Bean
    @Order(1)
    public SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/api/**")
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
            .csrf(csrf -> csrf.disable());
        
        return http.build();
    }
    
    // 第二条链：后台管理（Session 模式）
    @Bean
    @Order(2)
    public SecurityFilterChain adminFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/admin/**")
            .authorizeHttpRequests(auth -> auth
                .anyRequest().hasRole("ADMIN")
            )
            .formLogin(form -> form
                .loginPage("/admin/login")
            )
            .sessionManagement(session -> session
                .maximumSessions(1)
            );
        
        return http.build();
    }
    
    // 第三条链：默认配置
    @Bean
    public SecurityFilterChain defaultFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .formLogin(Customizer.withDefaults())
            .csrf(csrf -> csrf.disable());
        
        return http.build();
    }
}
```

### SecurityMatcher 替代 antMatcher

```java
// 5.x 方式：在 configure 方法中指定
public class AdminSecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.antMatcher("/admin/**");  // 只匹配 /admin/**
    }
}

// 6.x 方式：通过 securityMatcher
@Bean
public SecurityFilterChain adminFilterChain(HttpSecurity http) throws Exception {
    http.securityMatcher("/admin/**");  // 只匹配 /admin/**
    // ...
}
```

---

## CORS 配置迁移

```java
// 5.x 方式
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .cors().and()  // 启用 CORS
            .csrf().disable();
    }
    
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.asList("http://localhost:3000"));
        config.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE"));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}

// 6.x 方式
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(csrf -> csrf.disable());
        
        return http.build();
    }
    
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.asList("http://localhost:3000"));
        config.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE"));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
```

---

## 方法级安全配置

```java
// 5.x 方式
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
                .anyRequest().authenticated()
                .and()
            .authorizeRequests()
                .antMatchers("/admin/**").hasRole("ADMIN");
    }
    
    // 需要额外开启方法级安全
    @EnableGlobalMethodSecurity(prePostEnabled = true, securedEnabled = true)
    protected void configureGlobal(AuthenticationManagerBuilder auth) throws Exception {
        // ...
    }
}

// 6.x 方式
@Configuration
@EnableMethodSecurity(prePostEnabled = true, securedEnabled = true)
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            );
        
        return http.build();
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| WebSecurityConfigurerAdapter 为什么被移除？ | 版本理解 | 6.x 新特性 |
| 如何实现多安全配置共存？ | 配置能力 | securityMatcher |
| 5.x 到 6.x 的配置迁移需要注意什么？ | 迁移能力 | 本篇 |
| Lambda DSL 相比之前的写法有什么优势？ | 语法理解 | 本篇 |

---

## 总结

Spring Security 6.x 的配置方式变化主要体现在：

1. **移除 WebSecurityConfigurerAdapter**：全面转向 `@Bean` + Lambda DSL 方式
2. **`authorizeRequests()` 改为 `authorizeHttpRequests()`**：方法名更直观
3. **`antMatchers()` 改为 `requestMatchers()`**：统一命名风格
4. **Lambda 写法更简洁**：链式调用更易读
5. **多过滤器链通过 `@Order` 或 `securityMatcher` 区分**

建议：新项目直接使用 6.x 的 Lambda DSL 方式，老项目迁移时注意 breaking changes。

---

## 下一步

- 想了解更多 6.x 变化？→ [Spring Security 6.x 新特性](/framework/springsecurity/v6)
- 想继续学习认证机制？→ [UserDetailsService 与自定义认证](/framework/springsecurity/userdetails)
- 想了解过滤器链原理？→ [Spring Security 过滤器链](/framework/springsecurity/filter-chain)
