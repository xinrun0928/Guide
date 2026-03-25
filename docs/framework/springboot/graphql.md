# GraphQL 整合：一种更灵活的 API 设计

你有没有遇到过这种情况？

前端只需要用户的姓名和邮箱，但后端返回了 20 个字段。

或者，需要调用 5 个接口才能拼出一个页面。

GraphQL 就是来解决这个问题的——**你需要什么，我给你什么**。

这一节，我们来学习 Spring Boot 如何整合 GraphQL。

## GraphQL 是什么？

GraphQL 是一种 API 查询语言，由 Facebook 在 2012 年开发，2015 年开源。

```
┌─────────────────────────────────────────────────────────────────┐
│                    REST vs GraphQL                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  REST（多个端点）                                               │
│  GET /api/users/1          → 用户基本信息                      │
│  GET /api/users/1/orders   → 用户订单                          │
│  GET /api/users/1/profile  → 用户资料                          │
│                                                                 │
│  GraphQL（单一端点）                                            │
│  POST /graphql                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  query {                                               │   │
│  │    user(id: 1) {                                       │   │
│  │      name                                              │   │
│  │      email                                             │   │
│  │      orders {                                          │   │
│  │        orderNo                                         │   │
│  │        amount                                          │   │
│  │      }                                                 │   │
│  │    }                                                   │   │
│  │  }                                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│  → 一次请求，返回你需要的所有数据                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## GraphQL 核心概念

### 类型系统

```graphql
type User {
    id: ID!
    name: String!
    email: String
    age: Int
    orders: [Order]
}

type Order {
    id: ID!
    orderNo: String!
    amount: Float
}

type Query {
    user(id: ID!): User
    users: [User]
}

type Mutation {
    createUser(name: String!, email: String): User
    updateUser(id: ID!, name: String): User
}
```

### Schema 定义

```graphql
schema {
    query: Query
    mutation: Mutation
}
```

## Spring Boot 整合 GraphQL

### Maven 依赖

```xml
<dependency>
    <groupId>com.graphql-java</groupId>
    <artifactId>graphql-spring-boot-starter</artifactId>
    <version>5.0.2</version>
</dependency>

<dependency>
    <groupId>com.graphql-java</groupId>
    <artifactId>graphiql-spring-boot-starter</artifactId>
    <version>5.0.2</version>
</dependency>
```

### 配置

```yaml
graphql:
  schema:
    # Schema 文件位置
    locations: classpath:graphql/**
    # 是否自动扫描
    auto-complete:
      enabled: true
  graphiql:
    enabled: true  # 开启 GraphiQL 可视化工具
```

### Schema 文件

创建 `src/main/resources/graphql/user.graphqls`：

```graphql
type User {
    id: ID!
    name: String!
    email: String
    age: Int
    orders: [Order]
    createdAt: String
}

type Order {
    id: ID!
    orderNo: String!
    amount: Float
    status: String
}

type Query {
    # 获取单个用户
    user(id: ID!): User
    # 获取所有用户
    users: [User]
    # 条件查询
    usersByAge(age: Int!): [User]
}

type Mutation {
    # 创建用户
    createUser(name: String!, email: String, age: Int): User
    # 更新用户
    updateUser(id: ID!, name: String, email: String): User
    # 删除用户
    deleteUser(id: ID!): Boolean
}
```

### Java 代码

```java
@Component
public class GraphQLProvider {
    private GraphQL graphQL;

    @Autowired
    private UserQuery userQuery;

    @Autowired
    private UserMutation userMutation;

    @PostConstruct
    public void init() throws IOException {
        // 加载 Schema
        ResourcesSchemaFileSchemaFinder schemaFinder = new ResourcesSchemaFileSchemaFinder();
        TypeDefinitionRegistry registry = schemaFinder.findSchemaDefinitionResources().stream()
                .map(r -> {
                    try {
                        return Utf8GraphQLResourceUtil.getResource(r.getURL());
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                })
                .reduce(new TypeDefinitionRegistry(), (a, b) -> {
                    a.merge(b);
                    return a;
                });

        // 构建运行时
        RuntimeWiring runtimeWiring = RuntimeWiring.newRuntimeWiring()
                .type("Query", builder -> builder
                        .dataFetcher("user", userQuery.getUser())
                        .dataFetcher("users", userQuery.getUsers())
                        .dataFetcher("usersByAge", userQuery.getUsersByAge()))
                .type("Mutation", builder -> builder
                        .dataFetcher("createUser", userMutation.createUser())
                        .dataFetcher("updateUser", userMutation.updateUser())
                        .dataFetcher("deleteUser", userMutation.deleteUser()))
                .build();

        // 生成 GraphQL
        SchemaGenerator schemaGenerator = new SchemaGenerator();
        GraphQLSchema schema = schemaGenerator.makeExecutableSchema(registry, runtimeWiring);
        graphQL = GraphQL.newGraphQL(schema).build();
    }

    public GraphQL getGraphQL() {
        return graphQL;
    }
}
```

### 查询 Resolver

```java
@Component
public class UserQuery {
    @Autowired
    private UserService userService;

    public DataFetcher<User> getUser() {
        return environment -> {
            Long id = Long.parseLong(environment.getArgument("id"));
            return userService.findById(id);
        };
    }

    public DataFetcher<List<User>> getUsers() {
        return environment -> userService.findAll();
    }

    public DataFetcher<List<User>> getUsersByAge() {
        return environment -> {
            Integer age = environment.getArgument("age");
            return userService.findByAge(age);
        };
    }
}
```

### 变更 Resolver

```java
@Component
public class UserMutation {
    @Autowired
    private UserService userService;

    public DataFetcher<User> createUser() {
        return environment -> {
            String name = environment.getArgument("name");
            String email = environment.getArgument("email");
            Integer age = environment.getArgument("age");

            User user = new User();
            user.setName(name);
            user.setEmail(email);
            user.setAge(age);
            return userService.save(user);
        };
    }

    public DataFetcher<Boolean> deleteUser() {
        return environment -> {
            Long id = Long.parseLong(environment.getArgument("id"));
            return userService.delete(id);
        };
    }
}
```

### Controller

```java
@RestController
@RequestMapping("/graphql")
public class GraphQLController {
    @Autowired
    private GraphQLProvider graphQLProvider;

    @PostMapping
    public ResponseEntity<Object> execute(@RequestBody String query) {
        ExecutionResult result = graphQLProvider.getGraphQL().execute(query);
        return ResponseEntity.ok(result.toSpecification());
    }
}
```

## GraphQL 查询示例

### 查询所有用户

```graphql
query {
    users {
        id
        name
        email
    }
}
```

### 嵌套查询

```graphql
query {
    user(id: "1") {
        name
        email
        orders {
            orderNo
            amount
        }
    }
}
```

### 带参数查询

```graphql
query {
    usersByAge(age: 18) {
        name
        age
    }
}
```

### 变更操作

```graphql
mutation {
    createUser(name: "Tom", email: "tom@example.com", age: 18) {
        id
        name
    }
}
```

## N+1 问题解决

GraphQL 容易产生 N+1 问题，需要 DataLoader：

```java
@Component
public class UserDataLoader implements TypeDataFetcher {
    @Autowired
    private UserService userService;

    @Override
    public CompletableFuture<User> get(DataFetchingEnvironment environment) {
        Long id = environment.getArgument("id");
        return CompletableFuture.supplyAsync(() -> userService.findById(id));
    }
}
```

```java
RuntimeWiring.newRuntimeWiring()
    .type("Query", builder -> builder
        .dataFetcher("user", newUserDataLoader())
        .dataFetcher("orders", newOrderDataLoader()))
    .build();
```

## 常见问题

### 问题一：POST 和 GET

```java
@RestController
@RequestMapping("/graphql")
public class GraphQLController {
    @PostMapping
    public ResponseEntity<Object> post(@RequestBody String query) {
        return executeQuery(query);
    }

    @GetMapping
    public ResponseEntity<Object> get(@RequestParam String query) {
        return executeQuery(query);
    }
}
```

### 问题二：GraphQL vs REST

| 维度 | REST | GraphQL |
|-----|------|---------|
| 数据获取 | 多个端点 | 单一端点 |
| 返回数据 | 固定字段 | 按需获取 |
| 文档 | Swagger | 自带 introspection |
| 缓存 | HTTP 缓存 | 需要特殊处理 |
| 适用场景 | 简单 CRUD | 复杂数据需求 |

---

## 面试高频问题

### Q1：GraphQL 的优缺点？

**优点**：按需获取、单一端点、自带文档、类型安全。

**缺点**：学习曲线、缓存复杂、错误处理。

### Q2：GraphQL 如何解决 N+1 问题？

使用 DataLoader 进行批量加载和缓存。

### Q3：GraphQL 适用场景？

移动端、复杂前端需求、微服务聚合。

---

## 最佳实践

1. **Schema 优先设计**：先定义 Schema，再实现
2. **使用 DataLoader**：避免 N+1 问题
3. **错误处理**：自定义错误类型
4. **性能监控**：记录查询耗时
5. **安全控制**：限制查询复杂度

---

## 思考题

GraphQL 让前端可以自由获取数据，但可能带来什么问题？

比如前端请求了 10000 个用户的详细信息...

下一节，我们学习 [Spring Boot 面试高频问题汇总](/framework/springboot/interview-summary)，准备面试。
