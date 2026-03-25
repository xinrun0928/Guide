# handle：携带异常信息的统一处理

`exceptionally` 只处理异常，`whenComplete` 只观察结果。

但有时候，你需要**同时处理成功和失败两种情况**——根据不同情况做不同的处理，但最终都要返回一个值。

这就是 `handle` 的职责。

---

## handle 基础

```java
public <U> CompletableFuture<U> handle(BiFunction<? super T, Throwable, ? extends U> fn)
public <U> CompletableFuture<U> handleAsync(BiFunction<? super T, Throwable, ? extends U> fn)
```

### 签名解读

```java
BiFunction<? super T, Throwable, ? extends U> fn
//   ↑ 结果类型    ↑ 异常类型    ↑ 返回值类型
```

- **成功时**：`result` 是正常结果，`Throwable` 是 `null`，返回 `U`
- **失败时**：`result` 是 `null`，`Throwable` 是异常，返回 `U`

### 核心能力

```java
// handle 可以根据结果/异常返回不同类型的值
CompletableFuture<String> cf = ...;

// handle 签名允许返回任意类型 U
CompletableFuture<Integer> handled = cf.handle((result, ex) -> {
    if (ex != null) {
        return -1;  // 失败返回 -1
    }
    return result.length();  // 成功返回长度
});
```

---

## handle vs exceptionally

| 对比点 | handle | exceptionally |
|-------|--------|--------------|
| 触发条件 | 成功或异常都执行 | 只有异常时执行 |
| 参数 | `(result, ex)` | `(Throwable)` |
| 返回值类型 | `U`（任意类型） | `T`（原始类型） |
| 异常后继续链式 | ✅ 是 | ✅ 是 |
| 能「修复」异常 | ✅ 能 | ❌ 不能 |

```java
// exceptionally：只能返回默认值
cf.exceptionally(ex -> "默认值");

// handle：可以根据情况返回不同内容
cf.handle((result, ex) -> {
    if (ex != null) {
        return "异常情况下的值";
    }
    return "正常情况: " + result;
});
```

### 关键区别：handle 可以「修复」异常

```java
// exceptionally：无法修复，只能返回默认值
CompletableFuture.supplyAsync(() -> {
    if (true) throw new RuntimeException("失败");
    return "原始结果";
})
.exceptionally(ex -> {
    return "默认值";  // 永远是默认值
})
.thenAccept(System.out::println);  // 输出：默认值

// handle：可以把异常转换为正常结果
CompletableFuture.supplyAsync(() -> {
    if (true) throw new RuntimeException("失败");
    return "原始结果";
})
.handle((result, ex) -> {
    if (ex != null) {
        return "修复后的结果";  // 把异常「修复」成正常值
    }
    return result;
})
.thenAccept(System.out::println);  // 输出：修复后的结果
```

---

## handle vs whenComplete

| 对比点 | handle | whenComplete |
|-------|--------|-------------|
| 返回值 | `U`（可以修改结果） | `Void`（不改变结果） |
| 参数 | `(result, ex)` | `(result, ex)` |
| 触发条件 | 成功或异常都执行 | 成功或异常都执行 |
| 后续链式 | ✅ 可以 | ✅ 可以 |

```java
// whenComplete：不改变结果
cf.whenComplete((r, e) -> log(r, e))
  .thenAccept(r -> System.out.println(r));  // r 仍是原始结果

// handle：可以改变结果
cf.handle((r, e) -> e != null ? "默认值" : r)
  .thenAccept(System.out::println);  // r 可能是默认值
```

---

## 实战场景

### 场景一：结果转换 + 异常兜底

```java
public CompletableFuture<UserDTO> getUserDTO(String userId) {
    return CompletableFuture
        .supplyAsync(() -> userService.findById(userId))
        .handle((user, ex) -> {
            if (ex != null) {
                // 查询失败，返回默认用户
                logger.warn("用户查询失败: {}", userId);
                return UserDTO.defaultUser(userId);
            }
            // 查询成功，转换为 DTO
            return user.toDTO();
        });
}
```

### 场景二：异常恢复为成功结果

```java
// 尝试主服务，失败则降级到备用服务
CompletableFuture.supplyAsync(() -> primaryService.getData(key))
    .handle((data, ex) -> {
        if (ex != null) {
            // 主服务失败，使用缓存
            logger.info("主服务失败，降级到缓存: {}", ex.getMessage());
            return cacheService.get(key);
        }
        return data;
    })
    .handle((data, ex) -> {
        if (ex != null) {
            // 缓存也失败，使用默认值
            logger.error("缓存也失败: {}", ex.getMessage());
            return Data.defaultData(key);
        }
        return data;
    });
```

### 场景三：统一处理 API 响应

```java
public CompletableFuture<ApiResult<T>> withErrorHandling(
    CompletableFuture<T> future) {
    
    return future
        .handle((result, ex) -> {
            if (ex != null) {
                Throwable cause = ex instanceof CompletionException 
                    ? ex.getCause() 
                    : ex;
                return ApiResult.error(cause.getMessage());
            }
            return ApiResult.success(result);
        });
}
```

---

## 链式异常处理

### 优雅的错误处理链

```java
CompletableFuture
    .supplyAsync(() -> step1())
    .handle((result, ex) -> {
        if (ex != null) {
            return fallback1();
        }
        return result;
    })
    .thenCompose(this::step2)
    .handle((result, ex) -> {
        if (ex != null) {
            return fallback2();
        }
        return result;
    })
    .thenCompose(this::step3)
    .handle((result, ex) -> {
        if (ex != null) {
            return fallback3();
        }
        return result;
    });
```

### 对比：层层嵌套的 try-catch

```java
// 这种写法太痛苦了
try {
    Result1 r1 = step1();
    try {
        Result2 r2 = step2(r1);
        try {
            return step3(r2);
        } catch (Exception e) {
            return fallback3();
        }
    } catch (Exception e) {
        return fallback2();
    }
} catch (Exception e) {
    return fallback1();
}
```

---

## 完整示例：多级降级查询

```java
public class MultiLevelQuery<T> {
    
    private final List<Supplier<T>> providers;
    private final Class<T> type;
    
    public MultiLevelQuery(List<Supplier<T>> providers, Class<T> type) {
        this.providers = providers;
        this.type = type;
    }
    
    public CompletableFuture<T> query() {
        if (providers.isEmpty()) {
            return CompletableFuture.failedFuture(
                new IllegalStateException("No providers configured"));
        }
        
        // 从第一个 provider 开始
        CompletableFuture<T> result = CompletableFuture
            .supplyAsync(providers.get(0));
        
        // 依次添加降级逻辑
        for (int i = 1; i < providers.size(); i++) {
            final int index = i;
            result = result.handle((data, ex) -> {
                if (ex != null) {
                    // 前面的 provider 失败，返回下一个 provider 的结果
                    return CompletableFuture.supplyAsync(providers.get(index));
                }
                // 前面的成功，直接返回结果
                return CompletableFuture.completedFuture(data);
            }).thenCompose(cf -> cf);
        }
        
        return result.handle((data, ex) -> {
            if (ex != null) {
                throw new RuntimeException("All providers failed", ex);
            }
            return data;
        });
    }
}

// 使用
List<Supplier<User>> providers = Arrays.asList(
    () -> redisService.getUser(id),
    () -> databaseService.getUser(id),
    () -> httpService.getUser(id),
    () -> User.anonymous(id)
);

CompletableFuture<User> userFuture = new MultiLevelQuery<>(providers, User.class).query();
```

---

## 面试追问方向

**Q1：handle 中的异常会被后续的 exceptionally 捕获吗？**

会的。`handle` 如果正常返回（不抛异常），后续的 `exceptionally` 不会触发。如果 `handle` 本身抛出异常，后续的 `exceptionally` 会捕获。

**Q2：handle 的泛型 U 可以和 T 不同吗？**

可以。这就是 `handle` 和 `whenComplete` 的核心区别。`handle` 可以进行类型转换：

```java
CompletableFuture<User> cf = ...;

// 转换为不同的类型
CompletableFuture<String> result = cf.handle((user, ex) -> {
    if (ex != null) {
        return "error";
    }
    return user.getName();  // User → String
});
```

**Q3：finally 等价于什么？**

`whenComplete` 的语义最接近 `finally`，因为它无论成功失败都会执行。但注意：`whenComplete` 不会吞掉异常，只是观察。如果你想「无论怎样都要执行清理」，用 `whenComplete`。
