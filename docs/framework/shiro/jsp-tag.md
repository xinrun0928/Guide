# Shiro JSP 标签库：`<shiro:principal>` 与 `<shiro:hasRole>`

在 JSP 页面中，如何根据用户权限显示/隐藏内容？

比如：普通用户看不到「删除」按钮，管理员才能看到。

Shiro 提供了 JSP 标签库来解决这个问题。

## 引入标签库

```jsp
<%@ taglib prefix="shiro" uri="http://shiro.apache.org/tags" %>
```

## Shiro JSP 标签一览

| 标签 | 说明 |
|-----|------|
| `shiro:guest` | 访客（未登录）可见 |
| `shiro:user` | 已登录或 RememberMe 可见 |
| `shiro:authenticated` | 已认证（真正登录）可见 |
| `shiro:notAuthenticated` | 未认证可见 |
| `shiro:principal` | 显示用户身份 |
| `shiro:hasRole` | 拥有指定角色时显示 |
| `shiro:lacksRole` | 没有指定角色时显示 |
| `shiro:hasAnyRole` | 拥有任一指定角色时显示 |
| `shiro:hasPermission` | 拥有指定权限时显示 |
| `shiro:lacksPermission` | 没有指定权限时显示 |

## 基础标签

### shiro:guest - 访客标签

```jsp
<shiro:guest>
    <a href="/register">注册</a> | <a href="/login">登录</a>
</shiro:guest>
```

未登录用户可以看到登录/注册链接。

### shiro:user - 用户标签

```jsp
<shiro:user>
    欢迎回来，<shiro:principal />！
    <a href="/logout">退出</a>
</shiro:user>
```

已登录或 RememberMe 用户可以看到欢迎信息和退出链接。

### shiro:authenticated - 已认证标签

```jsp
<shiro:authenticated>
    <a href="/account">我的账户</a>
</shiro:authenticated>

<shiro:notAuthenticated>
    <a href="/login">请先登录</a>
</shiro:notAuthenticated>
```

只有真正登录的用户才能看到「我的账户」链接，RememberMe 用户看到的是「请先登录」。

## principal 标签

`<shiro:principal>` 用于显示用户身份信息。

### 显示用户名

```jsp
<shiro:principal />
<!-- 输出：zhangsan -->

<shiro:principal type="java.lang.String" />
<!-- 效果相同 -->
```

### 显示用户属性

```jsp
<!-- 假设 User 对象有 username 和 email 属性 -->
<shiro:principal property="username" />
<!-- 输出：zhangsan -->

<shiro:principal property="email" />
<!-- 输出：zhangsan@example.com -->
```

### 使用 principalType

```jsp
<shiro:principal type="com.example.User" property="username" />
```

指定用户对象的类型和属性。

## 角色标签

### shiro:hasRole - 拥有角色

```jsp
<shiro:hasRole name="admin">
    <a href="/admin">管理后台</a>
</shiro:hasRole>
```

只有拥有 admin 角色的用户才能看到「管理后台」链接。

### shiro:lacksRole - 没有角色

```jsp
<shiro:lacksRole name="admin">
    <p>您不是管理员，无法访问管理后台</p>
</shiro:lacksRole>
```

没有 admin 角色的用户看到提示信息。

### shiro:hasAnyRole - 拥有任意角色

```jsp
<shiro:hasAnyRoles name="admin,manager,user">
    <a href="/dashboard">进入工作台</a>
</shiro:hasAnyRoles>
```

拥有 admin、manager 或 user 任一角色的用户都可以看到「进入工作台」链接。

## 权限标签

### shiro:hasPermission - 拥有权限

```jsp
<shiro:hasPermission name="user:create">
    <a href="/user/create">创建用户</a>
</shiro:hasPermission>
```

只有拥有 user:create 权限的用户才能看到「创建用户」链接。

### shiro:lacksPermission - 没有权限

```jsp
<shiro:lacksPermission name="user:delete">
    <span class="text-muted">您没有删除用户的权限</span>
</shiro:lacksPermission>
```

没有 user:delete 权限的用户看到提示。

## 实际应用场景

### 场景一：导航栏权限控制

```jsp
<%@ taglib prefix="shiro" uri="http://shiro.apache.org/tags" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>

<nav class="navbar">
    <div class="nav-links">
        <a href="/home">首页</a>
        <a href="/product">商品</a>
        
        <shiro:authenticated>
            <a href="/order">我的订单</a>
        </shiro:authenticated>
        
        <shiro:hasRole name="admin">
            <a href="/admin">管理后台</a>
        </shiro:hasRole>
        
        <shiro:hasRole name="manager">
            <a href="/statistics">数据统计</a>
        </shiro:hasRole>
        
        <shiro:user>
            <span class="user-info">
                欢迎，<shiro:principal property="username" />
            </span>
            <a href="/logout">退出</a>
        </shiro:user>
        
        <shiro:guest>
            <a href="/login">登录</a>
            <a href="/register">注册</a>
        </shiro:guest>
    </div>
</nav>
```

### 场景二：按钮级别权限控制

```jsp
<table class="user-table">
    <thead>
        <tr>
            <th>用户名</th>
            <th>邮箱</th>
            <th>操作</th>
        </tr>
    </thead>
    <tbody>
        <c:forEach items="${users}" var="user">
            <tr>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td>
                    <a href="/user/view/${user.id}">查看</a>
                    
                    <shiro:hasPermission name="user:edit">
                        <a href="/user/edit/${user.id}">编辑</a>
                    </shiro:hasPermission>
                    
                    <shiro:hasPermission name="user:delete">
                        <a href="/user/delete/${user.id}" 
                           onclick="return confirm('确定删除？')">删除</a>
                    </shiro:hasPermission>
                </td>
            </tr>
        </c:forEach>
    </tbody>
</table>
```

### 场景三：内容区块权限控制

```jsp
<div class="content">
    <h1>仪表盘</h1>
    
    <div class="panel">
        <h3>基本信息</h3>
        <p>用户：<shiro:principal property="username" /></p>
        <p>部门：<shiro:principal property="department" /></p>
    </div>
    
    <shiro:hasRole name="admin">
        <div class="panel panel-danger">
            <h3>系统管理</h3>
            <ul>
                <li><a href="/admin/user">用户管理</a></li>
                <li><a href="/admin/role">角色管理</a></li>
                <li><a href="/admin/permission">权限管理</a></li>
            </ul>
        </div>
    </shiro:hasRole>
    
    <shiro:hasPermission name="order:view">
        <div class="panel">
            <h3>订单统计</h3>
            <p>本月订单：${orderCount}</p>
        </div>
    </shiro:hasPermission>
</div>
```

### 场景四：条件显示

```jsp
<shiro:hasRole name="vip">
    <div class="vip-banner">
        <img src="/images/vip-banner.jpg" alt="VIP 会员专享">
    </div>
</shiro:hasRole>

<shiro:lacksRole name="vip">
    <div class="upgrade-banner">
        <p>升级为 VIP 会员，享受更多特权</p>
        <a href="/vip/upgrade">立即升级</a>
    </div>
</shiro:lacksRole>
```

## Thymeleaf 整合

如果使用 Thymeleaf 模板引擎，可以使用 shiro-dialect：

```xml
<dependency>
    <groupId>com.github.theborakompanioni</groupId>
    <artifactId>thymeleaf-extras-shiro</artifactId>
    <version>2.1.0</version>
</dependency>
```

### Thymeleaf 配置

```java
@Configuration
public class ThymeleafConfig {
    
    @Bean
    public ShiroDialect shiroDialect() {
        return new ShiroDialect();
    }
}
```

### Thymeleaf 使用

```html
<div th:if="${#authorization.expression('isAuthenticated()')}">
    <p>欢迎回来，<span th:text="${#authentication.name}">User</span></p>
</div>

<div th:if="${#authorization.expression('hasRole(''admin'')')}">
    <a href="/admin">管理后台</a>
</div>

<div th:if="${#authorization.expression('hasPermission(''user:create'')')}">
    <a href="/user/create">创建用户</a>
</div>
```

## Freemarker 整合

如果使用 Freemarker：

```xml
<dependency>
    <groupId>org.apache.shiro</groupId>
    <artifactId>shiro-freemarker-tags</artifactId>
    <version>1.5.0</version>
</dependency>
```

```html
<#import "shiro.ftl" as shiro>

<@shiro.guest>
    <a href="/login">登录</a>
</@shiro.guest>

<@shiro.authenticated>
    <p>欢迎，<@shiro.principal /></p>
</@shiro.authenticated>

<@shiro.hasRole name="admin">
    <a href="/admin">管理后台</a>
</@shiro.hasRole>
```

## 注意事项

### 1. 标签必须在 Subject 上下文中使用

```jsp
<%-- 错误：Subject 未初始化 --%>
<shiro:hasRole name="admin">...</shiro:hasRole>

<%-- 正确：确保 Subject 已初始化 --%>
<shiro:user>
    <shiro:hasRole name="admin">...</shiro:hasRole>
</shiro:user>
```

### 2. 避免在循环中使用大段权限判断

```jsp
<%-- 性能较差：每次循环都查询权限 --%>
<c:forEach items="${users}" var="user">
    <tr>
        <td>${user.name}</td>
        <td>
            <shiro:hasPermission name="user:edit">
                <a href="/user/edit/${user.id}">编辑</a>
            </shiro:hasPermission>
        </td>
    </tr>
</c:forEach>

<%-- 优化：预先判断一次 --%>
<shiro:hasPermission name="user:edit" var="canEdit" />

<c:forEach items="${users}" var="user">
    <tr>
        <td>${user.name}</td>
        <td>
            <c:if test="${canEdit}">
                <a href="/user/edit/${user.id}">编辑</a>
            </c:if>
        </td>
    </tr>
</c:forEach>
```

### 3. JSP 标签与控制器注解配合使用

```jsp
<%-- JSP 标签用于显示控制 --%>
<shiro:hasPermission name="user:delete">
    <button onclick="deleteUser(${user.id})">删除</button>
</shiro:hasPermission>

<%-- 控制器注解用于安全防护 --%>
@RequiresPermissions("user:delete")
@PostMapping("/user/delete/{id}")
public Result<Void> deleteUser(@PathVariable Long id) {
    // 即使前端绕过显示控制，后端依然会校验权限
}
```

---

## 留给你的问题

JSP 标签可以控制页面显示，但权限数据每次都要从数据库读取吗？

下一节，我们来学习 Shiro 的缓存机制——EhCache / Redis + CacheManager。
