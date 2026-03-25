# allOf / anyOf：批量等待与最先完成

想象这个场景：

> 你的应用需要从 5 个不同的缓存/数据源获取数据，谁先返回就用谁的。

这是 `allOf` 和 `anyOf` 最典型的应用场景。

---

## allOf：等待所有 CompletableFuture 完成

### 签名

```java
public static CompletableFuture<Void> allOf(CompletableFuture<?>... cfs)
```

### 图示

```
CF1 ────────────────┐
CF2 ────────────────┤
CF3 ────────────────┼──► allOf ──► CF<Void>
CF4 ────────────────┤
CF5 ────────────────┘

全部完成时才触发后续逻辑
```

### 基础用法

```java
CompletableFuture<String> cf1 = CompletableFuture.supplyAsync(() -> queryCache1());
CompletableFuture<String> cf2 = CompletableFuture.supplyAsync(() -> queryCache2());
CompletableFuture<String> cf3 = CompletableFuture.supplyAsync(() -> queryCache3());

// 等待全部完成
CompletableFuture<Void> allDone = CompletableFuture.allOf(cf1, cf2, cf3);

allDone.thenRun(() -> {
    System.out.println("全部完成！");
    System.out.println("结果1：" + cf1.join());
    System.out.println("结果2：" + cf2.join());
    System.out.println("结果3：" + cf3.join());
});

allDone.join();  // 阻塞等待所有完成
```

### 实际场景：多级缓存查询

```java
public String getUserName(String userId) {
    // 多级缓存同时查询
    CompletableFuture<String> l1Cache = CompletableFuture.supplyAsync(() -> l1.get(userId));
    CompletableFuture<String> l2Cache = CompletableFuture.supplyAsync(() -> l2.get(userId));
    CompletableFuture<String> redisCache = CompletableFuture.supplyAsync(() -> redis.get(userId));
    
    return CompletableFuture.anyOf(l1Cache, l2Cache, redisCache)
        .thenApply(Object::toString)
        .join();
}
```

---

## anyOf：任一 CompletableFuture 完成

### 签名

```java
public static CompletableFuture<Object> anyOf(CompletableFuture<?>... cfs)
```

### 图示

```
CF1 ────────────────┐
CF2 ────────────────┼──► anyOf ──► CF<Object> (返回最快的结果)
CF3 ────────────────┤
CF4 ────────────────┤
CF5 ────────────────┘

第一个完成时就触发，后续结果被忽略
```

### 返回值类型

```java
// anyOf 返回 CompletableFuture<Object>
// 因为不知道哪个会先完成，返回类型只能是 Object

CompletableFuture.anyOf(cf1, cf2, cf3)
    .thenAccept(result -> {
        // result 的实际类型取决于哪个先完成
        if (result instanceof String) {
            System.out.println("String 结果：" + result);
        } else if (result instanceof Integer) {
            System.out.println("Integer 结果：" + result);
        }
    });
```

### 实际场景：快速响应

```java
public String getExchangeRate(String currency) {
    // 同时查询多个数据源，谁快用谁
    CompletableFuture<String> binance = CompletableFuture.supplyAsync(() -> queryBinance(currency));
    CompletableFuture<String> huobi = CompletableFuture.supplyAsync(() -> queryHuobi(currency));
    CompletableFuture<String> okex = CompletableFuture.supplyAsync(() -> queryOkex(currency));
    
    return (String) CompletableFuture.anyOf(binance, huobi, okex)
        .thenApply(r -> r.toString().trim())
        .join();
}
```

---

## 关键区别

| 特性 | allOf | anyOf |
|-----|-------|-------|
| 触发时机 | 所有 CF 完成 | 任一 CF 完成 |
| 返回类型 | `CF<Void>` | `CF<Object>` |
| 结果获取 | 保留原 CF 引用 | 从 result 中获取 |
| 异常感知 | 不会自动感知异常 | 不会自动感知异常 |
| 典型场景 | 等待所有任务完成 | 多路查询取最快 |

---

## allOf 的陷阱：异常处理

`allOf` 最大的坑：**它不感知异常**。

```java
CompletableFuture<String> success = CompletableFuture.completedFuture("OK");
CompletableFuture<String> fail = CompletableFuture.failedFuture(new RuntimeException("错误"));

CompletableFuture<Void> allOf = CompletableFuture.allOf(success, fail);

// allOf 完成了，但 fail 实际上是失败的
allOf.thenRun(() -> System.out.println("allOf 完成"));

// 这里会抛出异常！
String result = fail.join();  // CompletionException
```

### 正确处理方式

```java
CompletableFuture<Void> allOf = CompletableFuture.allOf(cf1, cf2, cf3);

allOf.thenRun(() -> {
    // 检查每个 CF 的状态
    List<Object> results = Stream.of(cf1, cf2, cf3)
        .map(cf -> {
            if (cf.isCompletedExceptionally()) {
                return "FAILED";
            }
            return cf.join();
        })
        .collect(Collectors.toList());
    
    // 处理结果
    process(results);
}).exceptionally(ex -> {
    // allOf 自己的异常（比如传入 null）
    System.err.println("allOf 失败：" + ex);
    return null;
});
```

---

## 完整示例：批量数据同步

```java
public class DataSyncDemo {
    
    public CompletableFuture<SyncResult> syncAllData(List<String> entityIds) {
        // 为每个实体创建同步任务
        List<CompletableFuture<EntitySync>> syncs = entityIds.stream()
            .map(id -> CompletableFuture.supplyAsync(() -> syncEntity(id)))
            .collect(Collectors.toList());
        
        // 等待所有同步完成
        CompletableFuture<Void> allDone = CompletableFuture.allOf(
            syncs.toArray(new CompletableFuture[0])
        );
        
        return allDone.thenApply(v -> {
            // 汇总结果
            List<EntitySync> successList = new ArrayList<>();
            List<String> failedList = new ArrayList<>();
            
            for (CompletableFuture<EntitySync> sync : syncs) {
                if (sync.isCompletedExceptionally()) {
                    failedList.add("unknown");
                } else {
                    EntitySync result = sync.join();
                    if (result.isSuccess()) {
                        successList.add(result);
                    } else {
                        failedList.add(result.getEntityId());
                    }
                }
            }
            
            return new SyncResult(successList, failedList);
        });
    }
    
    private EntitySync syncEntity(String id) {
        // 模拟同步逻辑
        if (Math.random() < 0.1) {
            throw new RuntimeException("同步失败");
        }
        return new EntitySync(id, true);
    }
}
```

---

## 批量超时处理

### 场景：批量查询，最多等 3 秒

```java
public List<String> queryWithTimeout(List<String> keys) {
    // 为每个 key 创建查询任务
    List<CompletableFuture<String>> futures = keys.stream()
        .map(key -> CompletableFuture
            .supplyAsync(() -> query(key))
            .orTimeout(3, TimeUnit.SECONDS)  // 单个任务超时
        )
        .collect(Collectors.toList());
    
    // 等待全部完成或有任务超时
    return CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
        .thenApply(v -> futures.stream()
            .map(cf -> {
                try {
                    return cf.join();
                } catch (CompletionException e) {
                    return "TIMEOUT";  // 超时返回默认值
                }
            })
            .collect(Collectors.toList())
        )
        .join();
}
```

---

## 面试追问方向

**Q1：allOf 返回 Void，那怎么获取各个 CF 的结果？**

需要**保留原始 CF 的引用**。`allOf` 只负责「等待」，不负责「传递」结果。你需要这样做：

```java
CompletableFuture<String> cf1 = CompletableFuture.supplyAsync(...);
CompletableFuture<Integer> cf2 = CompletableFuture.supplyAsync(...);

CompletableFuture.allOf(cf1, cf2).thenRun(() -> {
    String r1 = cf1.join();  // 从原始 CF 获取
    Integer r2 = cf2.join();
});
```

**Q2：anyOf 的返回值类型为什么是 Object？**

因为在编译时无法确定哪个 CF 会先完成。`anyOf` 设计为通用的，所以返回 `Object`。你需要根据实际情况进行类型转换或类型检查。

**Q3：如何实现「等待所有成功，任一失败就失败」？**

```java
// 手动处理：检查所有 CF 状态
CompletableFuture.allOf(cf1, cf2, cf3)
    .thenApply(v -> {
        // 如果任一异常，重新抛出
        for (CompletableFuture<?> cf : List.of(cf1, cf2, cf3)) {
            if (cf.isCompletedExceptionally()) {
                throw new CompletionException(
                    cf.exceptionally(ex -> ex).join()
                );
            }
        }
        return null;
    });
```
