# MyBatis Plus 快速上手：5 分钟跑通 CRUD

你有没有想过，写一个简单的 CRUD 接口需要多久？

10 分钟？5 分钟？

用 MyBatis Plus，**3 分钟**就够了。

这一节，我们从零开始，手把手配置 MyBatis Plus，体验什么叫「开箱即用」。

## 环境准备

### 添加依赖

```xml
<dependencies>
    <!-- MyBatis Plus Spring Boot Starter -->
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-boot-starter</artifactId>
        <version>3.5.5</version>
    </dependency>

    <!-- MySQL 驱动 -->
    <dependency>
        <groupId>com.mysql</groupId>
        <artifactId>mysql-connector-j</artifactId>
        <scope>runtime</scope>
    </dependency>

    <!-- Lombok（可选，推荐使用） -->
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <optional>true</optional>
    </dependency>
</dependencies>
```

### 配置数据源

```yaml
# application.yml
spring:
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    url: jdbc:mysql://localhost:3306/mybatis_plus?useUnicode=true&characterEncoding=utf-8&useSSL=false&serverTimezone=Asia/Shanghai
    username: root
    password: root

# MyBatis Plus 配置
mybatis-plus:
  configuration:
    # 日志配置，生产环境建议关闭
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
  # Mapper XML 文件位置
  mapper-locations: classpath*:/mapper/**/*.xml
  # 实体类扫描包路径
  type-aliases-package: com.example.entity
```

### 开启注解扫描

```java
@SpringBootApplication
@MapperScan("com.example.mapper")  // 扫描 Mapper 接口
public class MyBatisPlusApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyBatisPlusApplication.class, args);
    }
}
```

## 编写实体类

```java
@Data
@NoArgsConstructor
@AllArgsConstructor
public class User {
    private Long id;
    private String name;
    private Integer age;
    private String email;
    private Long managerId;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
    private Integer version;      // 乐观锁
    private Integer deleted;       // 逻辑删除
}
```

## 核心注解

### @TableName

指定实体类对应的表名：

```java
@TableName("sys_user")  // 指定表名为 sys_user，不指定则默认类名转下划线
public class User {
    // ...
}
```

### @TableId

标识主键字段：

```java
@TableName("user")
public class User {

    // 主键自增策略
    @TableId(type = IdType.AUTO)
    private Long id;

    // 其他方式
    // @TableId(type = IdType.ASSIGN_ID)  // 分布式 ID（雪花算法）
    // @TableId(type = IdType.ASSIGN_UUID) // UUID
    // @TableId(type = IdType.INPUT)      // 用户输入
}
```

**IdType 详解**：

| 值 | 说明 |
|----|-----|
| `AUTO` | 数据库自增 |
| `NONE` | 未设置（使用全局策略） |
| `INPUT` | 用户输入 |
| `ASSIGN_ID` | 雪花算法生成（分布式 ID） |
| `ASSIGN_UUID` | UUID 生成 |

### @TableField

映射非默认字段：

```java
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    // 映射 user_name -> userName（驼峰自动映射，默认开启）
    private String userName;

    // 映射 status 字段（字段名一致时可省略）
    private Integer status;

    // 逻辑删除字段
    @TableLogic
    private Integer deleted;

    // 自动填充字段
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
```

### @TableField(fill = FieldFill)

自动填充策略：

```java
// 创建时填充
@TableField(fill = FieldFill.INSERT)
private LocalDateTime createTime;

// 创建和更新时填充
@TableField(fill = FieldFill.INSERT_UPDATE)
private LocalDateTime updateTime;
```

需要配合 MetaObjectHandler 使用：

```java
@Component
public class MyMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());
        this.strictInsertFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        this.strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }
}
```

### @TableLogic

逻辑删除：

```java
@TableLogic
private Integer deleted;
```

执行删除时，实际会变成 UPDATE：

```sql
-- 删除时
UPDATE user SET deleted = 1 WHERE id = ? AND deleted = 0

-- 查询时自动加上条件
SELECT * FROM user WHERE deleted = 0
```

### @Version

乐观锁：

```java
@Version
private Integer version;
```

## 编写 Mapper 接口

```java
@Mapper
public interface UserMapper extends BaseMapper&lt;User&gt; {
    // 继承 BaseMapper，自动拥有 CRUD 方法
}
```

## 编写 Service 接口（可选）

```java
// Service 接口
public interface UserService extends IService&lt;User&gt; {
    // 继承 IService，自动拥有 CRUD 方法
}

// Service 实现类
@Service
public class UserServiceImpl extends ServiceImpl&lt;UserMapper, User&gt; implements UserService {
    // 继承 ServiceImpl，获得 CRUD 实现
}
```

## CRUD 操作演示

### 插入数据

```java
@Test
public void testInsert() {
    User user = new User();
    user.setName("Tom");
    user.setAge(18);
    user.setEmail("tom@example.com");

    int rows = userMapper.insert(user);
    System.out.println("影响行数: " + rows);
    System.out.println("返回主键: " + user.getId());
}
```

### 根据 ID 查询

```java
@Test
public void testSelectById() {
    User user = userMapper.selectById(1L);
    System.out.println(user);
}
```

### 条件查询

```java
@Test
public void testSelect() {
    // 方式一：QueryWrapper
    QueryWrapper&lt;User&gt; wrapper = new QueryWrapper&lt;&gt;();
    wrapper.eq("age", 18)
           .like("name", "Tom")
           .orderByDesc("create_time");
    List&lt;User&gt; users = userMapper.selectList(wrapper);

    // 方式二：Lambda QueryWrapper（推荐）
    LambdaQueryWrapper&lt;User&gt; lambdaWrapper = new QueryWrapper&lt;&gt;().lambda();
    lambdaWrapper.select(User::getName, User::getEmail)
                 .eq(User::getAge, 18)
                 .orderByDesc(User::getCreateTime);
    List&lt;User&gt; users2 = userMapper.selectList(lambdaWrapper);
}
```

### 更新数据

```java
@Test
public void testUpdate() {
    User user = new User();
    user.setId(1L);
    user.setName("Jerry");

    int rows = userMapper.updateById(user);
    System.out.println("影响行数: " + rows);
}
```

### 删除数据

```java
@Test
public void testDelete() {
    // 方式一：根据 ID 删除
    int rows = userMapper.deleteById(1L);

    // 方式二：条件删除
    int rows2 = userMapper.delete(new QueryWrapper&lt;User&gt;().eq("age", 18));
}
```

## 完整示例

### 实体类

```java
@Data
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private Integer age;

    private String email;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    @Version
    private Integer version;

    @TableLogic
    private Integer deleted;
}
```

### Mapper

```java
@Mapper
public interface UserMapper extends BaseMapper&lt;User&gt; {
}
```

### Service

```java
public interface UserService extends IService&lt;User&gt; {
}

@Service
public class UserServiceImpl extends ServiceImpl&lt;UserMapper, User&gt; implements UserService {
}
```

### Controller

```java
@RestController
@RequestMapping("/user")
public class UserController {

    @Autowired
    private UserService userService;

    @GetMapping("/{id}")
    public User getById(@PathVariable Long id) {
        return userService.getById(id);
    }

    @PostMapping
    public boolean save(@RequestBody User user) {
        return userService.save(user);
    }

    @PutMapping
    public boolean update(@RequestBody User user) {
        return userService.updateById(user);
    }

    @DeleteMapping("/{id}")
    public boolean delete(@PathVariable Long id) {
        return userService.removeById(id);
    }
}
```

---

## 面试高频问题

### Q1：MyBatis Plus 和 MyBatis 的区别？

MyBatis Plus 在 MyBatis 基础上增强了 CRUD 操作，无需手写简单 SQL，但复杂查询仍可使用原生 MyBatis。

### Q2：MyBatis Plus 的自动填充是怎么实现的？

通过实现 `MetaObjectHandler` 接口，在插入和更新时自动填充字段。

### Q3：@TableLogic 和物理删除的区别？

逻辑删除不会真正删除数据，只是标记 `deleted = 1`，查询时会自动过滤。

---

## 最佳实践

1. **实体类注解要完整**：@TableName、@TableId、@TableField 等注解要正确使用
2. **Service 层封装业务逻辑**：复杂业务在 Service 层处理，不要把所有逻辑写在 Mapper 中
3. **合理使用自动填充**：createTime、updateTime 等字段使用自动填充，减少代码量
4. **善用 Lambda 条件构造器**：避免硬编码列名

---

## 思考题

MyBatis Plus 提供了强大的 CRUD 能力，但实际项目中，查询条件往往很复杂。比如：一个用户查询页面，需要支持按姓名模糊搜索、按年龄范围查询、按状态筛选、按创建时间排序……这种场景下，如何优雅地使用 MyBatis Plus？

下一节，我们深入学习 [条件构造器](/framework/mybatis-plus/wrapper)，掌握复杂查询的写法。
