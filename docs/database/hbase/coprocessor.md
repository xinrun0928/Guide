# HBase 协处理器：扩展 HBase 的能力

想给 HBase 加功能，但不想改源码？

协处理器就是为此而生的。

---

## 协处理器是什么？

协处理器（Coprocessor）是运行在 RegionServer 上的插件，可以在数据写入/读取时执行自定义逻辑。

```
┌─────────────────────────────────────────────────────────────┐
│                    协处理器执行位置                            │
│                                                             │
│  写入流程：                                                  │
│  Client → WAL → MemStore → 协处理器 → 返回                   │
│                                                             │
│  读取流程：                                                  │
│  Client → BlockCache/MemStore/HFile → 协处理器 → 返回        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 协处理器类型

### 1. Observer（观察者）

类似于数据库触发器，在特定事件发生时执行。

| 类型 | 触发时机 |
|-----|---------|
| RegionObserver | Get/Put/Delete/Scan 等操作前后 |
| WALCoprocessor | WAL 写入前后 |
| MasterObserver | 创建表、删除表等操作前后 |

```java
// RegionObserver 示例
public class MyRegionObserver extends RegionObserver {
    @Override
    public void preGetOp(ObserverContext&lt;Region&gt; c, Get get,
                         List&lt;Cell&gt; result) throws IOException {
        // Get 操作前执行
        // 可以修改 Get、决定是否继续执行
    }

    @Override
    public void postGetOp(ObserverContext&lt;Region&gt; c, Get get,
                          List&lt;Cell&gt; result) throws IOException {
        // Get 操作后执行
        // 可以修改结果
    }

    @Override
    public Result prePut(ObserverContext&lt;Region&gt; c, Put put,
                         List&lt;Mutation&gt; redo) throws IOException {
        // Put 操作前执行
        // 可以验证数据、添加默认值

        // 验证年龄必须大于 0
        Cell ageCell = put.get(Bytes.toBytes("info"),
                              Bytes.toBytes("age")).get(0);
        int age = Bytes.toInt(CellUtil.cloneValue(ageCell));
        if (age < 0) {
            throw new IOException("Age must be positive");
        }
        return Result.create(redo);
    }
}
```

### 2. Endpoint（端点）

类似存储过程，在 RegionServer 上执行计算。

```java
// Endpoint 示例：计算列的和
public class SumEndpoint extends RegionServerCoprocessor
        implements RegionServerService {
    @Override
    public void start(CoprocessorHost.Environment env) {}

    @Override
    public void stop(CoprocessorHost.Environment env) {}

    // 定义服务方法
    public interface SumService extends CoprocessorService {
        void getSum(RpcController controller,
                    SumRequest request,
                    RpcCallback&lt;SumResponse&gt; done);
    }

    @Override
    public Service getService() {
        return new SumService() {
            @Override
            public void getSum(RpcController controller,
                              SumRequest request,
                              RpcCallback&lt;SumResponse&gt; done) {
                // 在 RegionServer 上计算
                long sum = 0;
                for (KeyValue kv : region.getScanner(scan)) {
                    sum += Bytes.toLong(kv.getValue());
                }

                SumResponse response = SumResponse.newBuilder()
                    .setSum(sum)
                    .build();
                done.run(response);
            }
        };
    }
}
```

### 3. MasterObserver

监控 DDL 操作。

```java
// MasterObserver 示例
public class AuditMasterObserver extends MasterObserver {
    @Override
    public void postCreateTable(ObserverContext&lt;MasterCoprocessorEnvironment&gt; env,
                                 TableDescriptor desc,
                                 RegionInfo[] regions) throws IOException {
        // 创建表后记录审计日志
        logger.info("Table created: " + desc.getTableName());
    }

    @Override
    public void preDeleteTable(ObserverContext&lt;MasterCoprocessorEnvironment&gt; env,
                                TableName tableName) throws IOException {
        // 删除表前备份数据
        backupTable(tableName);
    }
}
```

---

## 协处理器配置

### 1. 表级配置

```java
// 创建带协处理器的表
public class CoprocessorConfig {
    public void createTableWithCoprocessor() throws IOException {
        TableDescriptor table = TableDescriptorBuilder
            .newBuilder(TableName.valueOf("t_audit"))
            .setColumnFamilies(
                ColumnFamilyDescriptorBuilder.of("audit")
            )
            // 添加协处理器
            .setCoprocessor("hdfs:///path/to/AuditCoprocessor.jar")
            .build();

        admin.createTable(table);
    }
}
```

### 2. HBase 配置

```xml
<!-- hbase-site.xml -->
<property>
    <name>hbase.coprocessor.master.classes</name>
    <value>com.example.AuditMasterObserver</value>
</property>
<property>
    <name>hbase.coprocessor.region.classes</name>
    <value>com.example.RowCountEndpoint</value>
</property>
```

---

## 协处理器的应用场景

### 1. 二级索引

```java
// 二级索引实现
public class SecondaryIndexObserver extends RegionObserver {
    private Table indexTable;

    @Override
    public void postPut(ObserverContext&lt;Region&gt; c, Put put, WALEdit edit) throws IOException {
        // 获取原始数据的索引列
        String email = getEmailFromPut(put);
        String rowKey = getRowKeyFromPut(put);

        // 写入索引表：email → rowKey
        Put indexPut = new Put(Bytes.toBytes(email));
        indexPut.addColumn(Bytes.toBytes("idx"),
                          Bytes.toBytes("rowKey"),
                          Bytes.toBytes(rowKey));
        indexTable.put(indexPut);
    }
}
```

### 2. 数据验证

```java
// 数据验证
public class ValidationObserver extends RegionObserver {
    @Override
    public Result prePut(ObserverContext&lt;Region&gt; c, Put put,
                         List&lt;Mutation&gt; redo) throws IOException {
        // 验证必填字段
        if (!hasRequiredColumns(put)) {
            throw new IOException("Missing required columns");
        }

        // 验证数据格式
        if (!validateDataFormat(put)) {
            throw new IOException("Invalid data format");
        }

        return super.prePut(c, put, redo);
    }
}
```

### 3. 审计日志

```java
// 审计日志
public class AuditObserver extends RegionObserver {
    private AuditLogger logger;

    @Override
    public void postPut(ObserverContext&lt;Region&gt; c, Put put,
                         List&lt;Mutation&gt; redo) throws IOException {
        logger.log("PUT",
                   Bytes.toString(put.getRow()),
                   getUserFromContext(),
                   getTimestamp());
    }

    @Override
    public void postDelete(ObserverContext&lt;Region&gt; c,
                            Delete delete,
                            WALEdit edit) throws IOException {
        logger.log("DELETE",
                   Bytes.toString(delete.getRow()),
                   getUserFromContext(),
                   getTimestamp());
    }
}
```

### 4. 聚合计算

```java
// 聚合计算（类似 SQL 的 COUNT、SUM）
public class AggregationEndpoint extends RegionServerCoprocessor {
    public long sum(Region region, byte[] family, byte[] column) {
        long sum = 0;
        Scan scan = new Scan();
        scan.addColumn(family, column);

        InternalScanner scanner = region.getScanner(scan);
        List&lt;Cell&gt; cells = new ArrayList&lt;&gt;();

        while (scanner.next(cells)) {
            for (Cell cell : cells) {
                sum += Bytes.toLong(CellUtil.cloneValue(cell));
            }
            cells.clear();
        }
        return sum;
    }
}
```

---

## 协处理器的注意事项

```
┌─────────────────────────────────────────────────────────────┐
│                    协处理器注意事项                            │
│                                                             │
│  1. 性能影响                                               │
│     - 每个操作都会执行协处理器                               │
│     - 复杂逻辑会导致延迟增加                                 │
│     - 建议异步执行或批量处理                                 │
│                                                             │
│  2. 异常处理                                               │
│     - 异常会导致操作失败                                     │
│     - 使用 ObserverContext.setBypassed() 跳过处理            │
│                                                             │
│  3. 资源管理                                               │
│     - 协处理器运行在 RegionServer 进程内                     │
│     - 资源泄漏会影响 RegionServer                           │
│     - 使用完资源要及时释放                                   │
│                                                             │
│  4. 版本兼容                                               │
│     - 升级协处理器需要重启 Region                           │
│     - 建议使用版本号管理                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 面试追问方向

- 协处理器和触发器有什么区别？
- 协处理器如何保证事务一致性？

下一节，我们来了解 HBase 的快照管理。
