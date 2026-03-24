# LDAP：企业目录服务的基石

一个跨国公司有 10 万员工，分布在 50 个国家，使用 1000 个 IT 系统。

每个系统都需要用户账号。如果每个系统都维护一套用户数据：
- 密码策略不一致
- 离职时要在 1000 个系统中删除账号
- 用户要记住 1000 个密码
- 员工信息分散在不同系统，不一致

**LDAP（Lightweight Directory Access Protocol，轻量级目录访问协议）** 就是来解决这个问题的——**企业级的统一身份目录**。

## LDAP 是什么

LDAP 是一种协议，用于访问和维护分布式目录服务。简单来说，它是一个**层次化的用户数据库**。

### LDAP 的典型应用

```
LDAP 目录服务：
                          dc=company,dc=com（根域）
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
    ou=people                ou=groups               ou=servers
    （人员）                  （组织）                  （服务器）
        │                        │                        │
    uid=alice             cn=engineers            cn=app1
    uid=bob               cn=managers             cn=app2
    uid=charlie           cn=admins               cn=db
```

常见的 LDAP 实现：
- **OpenLDAP**：开源实现，最流行
- **Microsoft Active Directory（AD）**：Windows Server 内置
- **389 Directory Server**：Red Hat 的开源 LDAP

## LDAP 的数据模型

### 1. 条目（Entry）

LDAP 的基本单元，每条记录是一个条目：

```java
// LDAP 条目示例：用户 Alice
dn: uid=alice,ou=people,dc=company,dc=com
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
cn: Alice Zhang
sn: Zhang
uid: alice
uidNumber: 1001
gidNumber: 100
homeDirectory: /home/alice
loginShell: /bin/bash
mail: alice@company.com
departmentNumber: engineering
```

### 2. 属性（Attribute）

每个条目由属性组成：

| 属性 | 含义 |
|------|------|
| dn（Distinguished Name） | 唯一标识名 |
| cn（Common Name） | 通用名称 |
| sn（SurName） | 姓 |
| uid（User ID） | 用户ID |
| mail | 邮箱 |
| member | 组成员 |

### 3. 对象类（ObjectClass）

定义条目的属性集合：

| ObjectClass | 用途 |
|-------------|------|
| top | 基类 |
| person | 基本人员信息 |
| organizationalPerson | 组织人员 |
| inetOrgPerson | 互联网人员（最常用） |
| posixAccount | POSIX 账户 |
| groupOfNames | 用户组 |

## LDAP 的 Java 使用

### Spring LDAP

```java
// 1. 配置 LDAP
@Configuration
public class LdapConfig {
    
    @Value("${ldap.urls}")
    private String ldapUrl;
    
    @Value("${ldap.base}")
    private String ldapBase;
    
    @Value("${ldap.username}")
    private String ldapUsername;
    
    @Value("${ldap.password}")
    private String ldapPassword;
    
    @Bean
    public LdapContextSource contextSource() {
        LdapContextSource contextSource = new LdapContextSource();
        contextSource.setUrl(ldapUrl);
        contextSource.setBase(ldapBase);
        contextSource.setUserDn(ldapUsername);
        contextSource.setPassword(ldapPassword);
        contextSource.afterPropertiesSet();
        return contextSource;
    }
    
    @Bean
    public LdapTemplate ldapTemplate() {
        return new LdapTemplate(contextSource());
    }
}
```

### 2. 用户查询

```java
@Service
public class LdapUserService {
    
    @Autowired
    private LdapTemplate ldapTemplate;
    
    /**
     * 根据用户名查询用户
     */
    public LdapUser findByUsername(String username) {
        // LDAP 查询过滤器
        String filter = "(&(objectClass=inetOrgPerson)(uid=" + username + "))";
        
        List<LdapUser> users = ldapTemplate.search(
            LdapModuleScanner.of(LdapUser.class),
            query()..where("uid").is(username),
            new AttributesMapper<LdapUser>() {
                @Override
                public LdapUser mapFromAttributes(Attributes attrs) throws NamingException {
                    LdapUser user = new LdapUser();
                    user.setUid(getAttr(attrs, "uid"));
                    user.setCn(getAttr(attrs, "cn"));
                    user.setSn(getAttr(attrs, "sn"));
                    user.setMail(getAttr(attrs, "mail"));
                    user.setDepartment(getAttr(attrs, "departmentNumber"));
                    return user;
                }
            }
        );
        
        return users.isEmpty() ? null : users.get(0);
    }
    
    /**
     * 认证用户
     */
    public boolean authenticate(String username, String password) {
        try {
            AndOperation search = ldapTemplate.searchForObject(
                query().where("uid").is(username),
                (ctx, mapper) -> {
                    String userDn = ctx.getNameInNamespace();
                    // 用用户名和密码尝试绑定
                    DirContext authContext = ldapTemplate.getContextSource()
                        .getReadOnlyContext()
                        .newInstance(
                            new Hashtable<String, String>() {{
                                put(Context.SECURITY_AUTHENTICATION, "simple");
                                put(Context.SECURITY_PRINCIPAL, userDn);
                                put(Context.SECURITY_CREDENTIALS, password);
                            }}
                        );
                    return true;
                }
            );
            return true;
        } catch (AuthenticationException e) {
            return false;
        }
    }
    
    /**
     * 查询用户组
     */
    public Set<String> getUserGroups(String username) {
        String filter = "(&(objectClass=groupOfNames)(member=uid=" + username + ",ou=people,dc=company,dc=com))";
        
        return ldapTemplate.search(
            query().where("objectClass").is("groupOfNames")
                   .and("member").is("uid=" + username + ",ou=people," + ldapBase),
            (AttributesMapper<String>) attrs -> getAttr(attrs, "cn")
        ).stream().collect(Collectors.toSet());
    }
    
    private String getAttr(Attributes attrs, String name) throws NamingException {
        Attribute attr = attrs.get(name);
        return attr == null ? null : (String) attr.get();
    }
}
```

### 3. Spring Security 集成

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Autowired
    private LdapUserService ldapUserService;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login").permitAll()
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                .loginProcessingUrl("/login")
                .successHandler((request, response, authentication) -> {
                    // 获取用户在 LDAP 中的组信息
                    String username = authentication.getName();
                    Set<String> groups = ldapUserService.getUserGroups(username);
                    
                    response.setContentType("application/json");
                    response.getWriter().write("{\"code\":0,\"username\":\"" + username + "\"}");
                })
            )
            .logout(logout -> logout
                .logoutUrl("/logout")
                .addLogoutHandler((request, response, authentication) -> {
                    // 可选：禁用 LDAP 账户
                })
            );
        
        return http.build();
    }
}
```

## LDAP 认证流程

```
┌─────────────────────────────────────────────────────────────┐
│  LDAP 认证流程                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户 ──▶ 应用 ──▶ LDAP Server                               │
│           │           │                                     │
│           │           │ 1. 用户提交用户名密码                  │
│           │──────────▶│                                     │
│           │           │                                     │
│           │           │ 2. LDAP 查询用户 DN                   │
│           │◀──────────│                                     │
│           │           │                                     │
│           │           │ 3. LDAP 用 DN + 密码绑定验证           │
│           │◀──────────│                                     │
│           │           │                                     │
│           │ 4. 返回认证结果                                  │
│           ◀───────────│                                     │
│           │           │                                     │
│           ▼           ▼                                     │
│      登录成功/失败                                           │
└─────────────────────────────────────────────────────────────┘
```

## LDAP 与 SSO

LDAP 通常作为企业 SSO 的**身份源（IdP）**：

```
┌─────────────────────────────────────────────────────────────┐
│                    企业 SSO 架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    ┌──────────────────┐                     │
│                    │   LDAP / AD     │                     │
│                    │   (身份源)       │                     │
│                    └────────┬─────────┘                     │
│                             │                                │
│                    ┌────────▼─────────┐                     │
│                    │   SSO Server     │                     │
│                    │ (CAS / SAML /   │                     │
│                    │  OIDC)          │                     │
│                    └────────┬─────────┘                     │
│                             │                                │
│         ┌───────────────────┼───────────────────┐          │
│         │                   │                   │          │
│         ▼                   ▼                   ▼          │
│    ┌─────────┐        ┌─────────┐        ┌─────────┐       │
│    │  邮件   │        │   OA    │        │  代码库  │       │
│    │ System  │        │ System  │        │  GitLab │       │
│    └─────────┘        └─────────┘        └─────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## LDAP 安全最佳实践

### 1. 使用 LDAPS（LDAP over SSL）

```properties
# 配置 LDAPS
ldap.url=ldaps://ldap.company.com:636
```

### 2. 限制匿名访问

```java
// 禁止匿名查询
contextSource.setAnonymousReadOnly(false);
```

### 3. 密码策略

```
LDAP 密码策略（pwdPolicy）：
- 最小长度
- 复杂度要求
- 强制修改周期
- 禁止重用密码
- 账户锁定阈值
```

## 面试追问方向

1. **LDAP 和数据库的区别？** —— LDAP 是层次化的读优化目录，数据库是关系化的支持事务
2. **LDAP 为什么用 DN 而不是 ID？** —— DN 是目录路径，适合层次结构，且全局唯一
3. **LDAP 认证和数据库认证的区别？** —— LDAP 集中管理用户，多系统共享；数据库每个系统独立管理
4. **LDAP 如何保证安全？** —— LDAPS 加密传输、密码策略、账户锁定
5. **LDAP 和 Active Directory 的关系？** —— AD 是微软的目录服务实现，兼容 LDAP 并扩展了更多功能

> "LDAP 是企业级身份管理的基石。理解它的数据模型和使用方式，是接入企业 IT 系统的必备技能。"
