# RBAC：权限管理的艺术

一个医院系统有这些角色：挂号员、医生、护士、药剂师、财务、管理员。

挂号员能做什么？挂号的操作。
医生能做什么？开处方、看报告。
管理员能做什么？什么都行。

但如果给每个用户单独配置权限，你会发现：
- 1000 个用户 = 1000 套权限
- 新增一个功能 = 修改 N 个人的权限
- 某人离职 = N 个地方删权限

**RBAC（Role-Based Access Control，基于角色的访问控制）** 就是来解决这个问题的。

## RBAC 的核心思想

RBAC 的核心是**引入「角色」作为权限的载体**：

```
用户 → 角色 → 权限

不是：用户 → 权限（每个用户独立配置）
而是：用户 → 角色 → 权限（通过角色批量分配）
```

### RBAC 的四层模型

```
┌─────────────────────────────────────────────────────────────┐
│                    RBAC 四层模型                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐                 │
│  │   用户   │────▶│   角色   │────▶│  权限   │                 │
│  └─────────┘     └─────────┘     └─────────┘                 │
│       │               │               │                      │
│       │               │               │                      │
│       ▼               ▼               ▼                      │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐                 │
│  │  User   │     │   Role  │     │Permission│                │
│  │  张三   │     │  医生   │     │ 开处方   │                 │
│  │  李四   │     │  护士   │     │ 查报告   │                 │
│  │  王五   │     │  药师   │     │ 发药    │                 │
│  └─────────┘     └─────────┘     └─────────┘                 │
│                                                             │
│  ┌─────────────────────────────────────────────┐            │
│  │ 用户-角色关系表（User-Role）                  │            │
│  │ user_id | role_id                            │            │
│  │   1     |    2                               │            │
│  │   2     |    3                               │            │
│  └─────────────────────────────────────────────┘            │
│                                                             │
│  ┌─────────────────────────────────────────────┐            │
│  │ 角色-权限关系表（Role-Permission）            │            │
│  │ role_id | permission_id                       │            │
│  │   2     |    101                              │            │
│  │   2     |    102                              │            │
│  │   3     |    103                              │            │
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## RBAC 的 Java 实现

### 1. 数据模型

```java
// 用户实体
@Entity
public class User {
    @Id
    private Long id;
    private String username;
    private String password;
    
    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
        name = "user_role",
        joinColumns = @JoinColumn(name = "user_id"),
        inverseJoinColumns = @JoinColumn(name = "role_id")
    )
    private Set<Role> roles;
    
    // getters and setters
}

// 角色实体
@Entity
public class Role {
    @Id
    private Long id;
    private String code;  // 角色代码：ADMIN, DOCTOR, NURSE
    private String name;  // 角色名称
    
    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
        name = "role_permission",
        joinColumns = @JoinColumn(name = "role_id"),
        inverseJoinColumns = @JoinColumn(name = "permission_id")
    )
    private Set<Permission> permissions;
    
    // getters and setters
}

// 权限实体
@Entity
public class Permission {
    @Id
    private Long id;
    private String code;  // 权限代码：prescription:create, report:read
    private String name;
    private String type;  // MENU, BUTTON, API
    
    // getters and setters
}
```

### 2. 权限校验

```java
// 自定义权限注解
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequirePermission {
    String value();  // 如：prescription:create
}

// 权限校验切面
@Component
@Aspect
@Slf4j
public class PermissionAspect {
    
    @Autowired
    private UserService userService;
    
    @Around("@annotation(requirePermission)")
    public Object checkPermission(ProceedingJoinPoint joinPoint,
                                   RequirePermission requirePermission) throws Throwable {
        String requiredPermission = requirePermission.value();
        
        // 获取当前用户
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            throw new UnauthorizedException("未登录");
        }
        
        // 获取用户所有权限
        Set<String> userPermissions = getUserPermissions(auth);
        
        // 检查是否有权限
        if (!userPermissions.contains(requiredPermission)) {
            log.warn("用户 {} 试图访问 {} 但权限不足", 
                     auth.getName(), requiredPermission);
            throw new ForbiddenException("没有权限: " + requiredPermission);
        }
        
        return joinPoint.proceed();
    }
    
    private Set<String> getUserPermissions(Authentication auth) {
        return auth.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.toSet());
    }
}

// 使用示例
@RestController
@RequestMapping("/api/prescription")
public class PrescriptionController {
    
    @PostMapping
    @RequirePermission("prescription:create")
    public Result create(@RequestBody PrescriptionDTO dto) {
        // 只有有 prescription:create 权限的人才能执行
        return prescriptionService.create(dto);
    }
    
    @GetMapping("/{id}")
    @RequirePermission("prescription:read")
    public Result get(@PathVariable Long id) {
        return prescriptionService.getById(id);
    }
}
```

### 3. Spring Security 集成

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login", "/error").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .requestMatchers("/doctor/**").hasAnyRole("DOCTOR", "ADMIN")
                .requestMatchers("/nurse/**").hasAnyRole("NURSE", "ADMIN")
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                .loginProcessingUrl("/login")
                .successHandler((request, response, authentication) -> {
                    response.setContentType("application/json");
                    response.getWriter().write("{\"code\":0,\"message\":\"登录成功\"}");
                })
                .failureHandler((request, response, exception) -> {
                    response.setContentType("application/json");
                    response.getWriter().write("{\"code\":401,\"message\":\"登录失败\"}");
                })
            )
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((request, response, authException) -> {
                    response.setContentType("application/json");
                    response.getWriter().write("{\"code\":401,\"message\":\"未登录\"}");
                })
                .accessDeniedHandler((request, response, accessDeniedException) -> {
                    response.setContentType("application/json");
                    response.getWriter().write("{\"code\":403,\"message\":\"没有权限\"}");
                })
            )
            .userDetailsService(userDetailsService);
        
        return http.build();
    }
}
```

## RBAC 的扩展：RBAC 模型家族

### RBAC0：基础模型
最简单的情况：用户、角色、权限三元关系。

### RBAC1：角色继承
子角色继承父角色的权限：

```
角色层级：
     管理员（所有权限）
        ↑
   ┌────┴────┐
医生       护士
```

### RBAC2：职责分离
禁止某些角色组合：

```
静态职责分离：医生不能同时是财务
动态职责分离：护士不能同时操作多个病区
```

### RBAC3：完整模型
RBAC1 + RBAC2 的组合。

## ABAC：更灵活的权限模型

RBAC 按角色分配权限，但有时候权限判断需要更细粒度：

```
RBAC 能表达的：
- 医生可以开处方 ✓

RBAC 难以表达的：
- 医生只能给自己科室的患者开处方
- 只能在工作时间开处方
- 只能开科室常用药品清单中的药
```

**ABAC（Attribute-Based Access Control，基于属性的访问控制）** 通过评估属性来决策：

```java
// ABAC 策略示例
@Component
public class PrescriptionPolicy {
    
    public boolean canCreatePrescription(Doctor doctor, Patient patient) {
        // 属性评估
        EvaluationContext context = new PropertyBasedEvaluationContext(
            "prescription",
            new DoctorAttributes(doctor),
            new PatientAttributes(patient),
            new EnvironmentAttributes()  // 时间、地点等环境属性
        );
        
        // 策略：医生只能给自己科室的患者开处方
        Policy policy = new Policy("doctor-department-match",
            "doctor.department == patient.department");
        
        return policy.evaluate(context);
    }
}
```

## 实际应用场景

### 菜单权限

```java
// 根据用户权限动态生成菜单
@Component
public class MenuService {
    
    public List<Menu> buildMenus(User user) {
        List<Menu> allMenus = menuRepository.findAll();
        Set<String> userPermissions = getUserPermissions(user);
        
        return allMenus.stream()
            .filter(menu -> menu.getPermission() == null || 
                           userPermissions.contains(menu.getPermission()))
            .filter(menu -> menu.getParent() == null)
            .peek(menu -> menu.setChildren(getChildren(menu, allMenus, userPermissions)))
            .collect(Collectors.toList());
    }
}
```

### 数据权限

```java
// 数据范围过滤
@Component
public class DataScopeFilter {
    
    @Autowired
    private CurrentUser currentUser;
    
    public Specification<Patient> filter(Specification<Patient> spec) {
        User user = currentUser.getUser();
        
        // 不同角色看不同范围的数据
        if (user.hasRole("ADMIN")) {
            return spec;  // 管理员看全部
        } else if (user.hasRole("DOCTOR")) {
            // 医生只看自己科室的患者
            return spec.and((root, query, cb) -> 
                cb.equal(root.get("department"), user.getDepartment())
            );
        } else if (user.hasRole("NURSE")) {
            // 护士只看自己负责的患者
            return spec.and((root, query, cb) -> 
                cb.equal(root.get("nurseId"), user.getId())
            );
        }
        
        return spec.and((root, query, cb) -> cb.disjunction());  // 无权限
    }
}
```

## 面试追问方向

1. **RBAC 和 ACL 的区别？** —— ACL 直接给用户分配权限，RBAC 通过角色间接分配，更易管理
2. **RBAC 的缺点？** —— 粒度不够细，对于「医生只能看自己科室的患者」这种规则难以表达
3. **角色继承有什么问题？** —— 可能导致权限扩散（医生继承实习生权限？），需要谨慎设计
4. **ABAC 和 RBAC 的选择？** —— 简单场景用 RBAC，复杂规则用 ABAC，或两者结合
5. **如何防止越权访问？** —— 后端每次请求都验证权限，不要信任前端展示的菜单

> "RBAC 是权限管理的经典模型。理解它的核心思想和局限性，才能在实际项目中做出合理的设计选择。"
