# HBase Java API：与 HBase 交互

HBase 提供了丰富的 Java API，让我们来看看常见操作。

---

## 连接管理

### 1. ConnectionFactory

```java
// 创建连接（推荐方式）
public class HBaseConnection {
    public static Connection createConnection() throws IOException {
        Configuration config = HBaseConfiguration.create();

        // ZooKeeper 配置
        config.set("hbase.zookeeper.quorum", "zk1,zk2,zk3");
        config.set("hbase.zookeeper.property.clientPort", "2181");

        // 创建连接
        Connection connection = ConnectionFactory.createConnection(config);
        return connection;
    }

    // 使用完记得关闭
    public static void close(Connection connection) throws IOException {
        if (connection != null && !connection.isClosed()) {
            connection.close();
        }
    }
}
```

### 2. Connection Pool

```java
// 连接池（高并发场景推荐）
public class HBaseConnectionPool {
    private final GenericKeyedObjectPool<Connection> pool;

    public HBaseConnectionPool(Configuration config, int poolSize) {
        pool = new GenericKeyedObjectPool<>(
            new ConnectionFactory(config), poolSize);
    }

    public Connection getConnection() throws Exception {
        return pool.borrowObject();
    }

    public void returnConnection(Connection connection) {
        try {
            pool.returnObject(connection);
        } catch (Exception e) {
            // 忽略
        }
    }
}
```

---

## 表操作

### 1. 创建表

```java
// 创建表
public class TableOperations {
    private final Admin admin;

    public void createTable(String tableName) throws IOException {
        TableName tn = TableName.valueOf(tableName);

        if (admin.tableExists(tn)) {
            return;
        }

        TableDescriptor table = TableDescriptorBuilder
            .newBuilder(tn)
            .setColumnFamilies(
                ColumnFamilyDescriptorBuilder
                    .of("info")
                    .setBloomFilterType(BloomType.ROW)
                    .setCompressionType(Compression.Algorithm.SNAPPY)
                    .setBlockCacheEnabled(true)
                    .setMaxVersions(3)
                    .build(),
                ColumnFamilyDescriptorBuilder
                    .of("data")
                    .setBloomFilterType(BloomType.ROWCOL)
                    .setCompressionType(Compression.Algorithm.SNAPPY)
                    .build()
            )
            .build();

        admin.createTable(table);
    }

    // 创建预分区表
    public void createTableWithSplit(String tableName, int numRegions)
            throws IOException {
        TableName tn = TableName.valueOf(tableName);
        byte[][] splitKeys = new byte[numRegions - 1][];

        // 均匀分布的分裂点
        for (int i = 1; i < numRegions; i++) {
            splitKeys[i - 1] = Bytes.toBytes(String.format("%03d", i * 256 / numRegions));
        }

        TableDescriptor table = TableDescriptorBuilder
            .newBuilder(tn)
            .setColumnFamilies(
                ColumnFamilyDescriptorBuilder.of("info")
            )
            .build();

        admin.createTable(table, splitKeys);
    }
}
```

### 2. 写入数据

```java
// 写入数据
public class WriteOperations {
    private final Table table;

    public void putData(String rowKey, String cf, String cq, String value)
            throws IOException {
        Put put = new Put(Bytes.toBytes(rowKey));
        put.addColumn(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq),
            Bytes.toBytes(value)
        );
        table.put(put);
    }

    // 批量写入
    public void batchPut(List<Put> puts) throws IOException {
        Object[] results = new Object[puts.size()];
        table.batch(puts, results);
    }

    // 原子递增
    public long increment(String rowKey, String cf, String cq)
            throws IOException {
        Increment increment = new Increment(Bytes.toBytes(rowKey));
        increment.addColumn(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq),
            1L
        );
        Result result = table.increment(increment);
        return Bytes.toLong(result.getValue(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq)
        ));
    }

    // Check-And-Put（原子操作）
    public void checkAndPut(String rowKey, String cf, String cq,
                            String expectedValue, String newValue)
            throws IOException {
        Put put = new Put(Bytes.toBytes(rowKey));
        put.addColumn(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq),
            Bytes.toBytes(newValue)
        );

        table.checkAndPut(
            Bytes.toBytes(rowKey),
            Bytes.toBytes(cf),
            Bytes.toBytes(cq),
            Bytes.toBytes(expectedValue),
            put
        );
    }
}
```

### 3. 读取数据

```java
// 读取数据
public class ReadOperations {
    private final Table table;

    // 读取单条
    public String get(String rowKey, String cf, String cq)
            throws IOException {
        Get get = new Get(Bytes.toBytes(rowKey));
        get.addColumn(Bytes.toBytes(cf), Bytes.toBytes(cq));

        Result result = table.get(get);
        if (result.isEmpty()) {
            return null;
        }
        return Bytes.toString(result.getValue(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq)
        ));
    }

    // 读取多版本
    public List<String> getVersions(String rowKey, String cf, String cq,
                                 int maxVersions) throws IOException {
        Get get = new Get(Bytes.toBytes(rowKey));
        get.addColumn(Bytes.toBytes(cf), Bytes.toBytes(cq));
        get.setMaxVersions(maxVersions);

        Result result = table.get(get);
        List<String> versions = new ArrayList<>();

        for (Cell cell : result.getColumnCells(
                Bytes.toBytes(cf),
                Bytes.toBytes(cq))) {
            versions.add(Bytes.toString(CellUtil.cloneValue(cell)));
        }
        return versions;
    }

    // 范围扫描
    public List<Result> scan(String startRow, String stopRow,
                             int limit) throws IOException {
        Scan scan = new Scan();
        scan.withStartRow(Bytes.toBytes(startRow));
        scan.withStopRow(Bytes.toBytes(stopRow));
        scan.setLimit(limit);

        List<Result> results = new ArrayList<>();
        try (ResultScanner scanner = table.getScanner(scan)) {
            for (Result result : scanner) {
                results.add(result);
            }
        }
        return results;
    }

    // 使用过滤器
    public List<Result> scanWithFilter(String startRow, String stopRow,
                                      String cf, String valueRegex)
            throws IOException {
        Scan scan = new Scan();
        scan.withStartRow(Bytes.toBytes(startRow));
        scan.withStopRow(Bytes.toBytes(stopRow));

        // 值过滤器
        ValueFilter filter = new ValueFilter(
            CompareOperator.EQUAL,
            new RegexStringComparator(valueRegex)
        );
        scan.setFilter(filter);

        List<Result> results = new ArrayList<>();
        try (ResultScanner scanner = table.getScanner(scan)) {
            for (Result result : scanner) {
                results.add(result);
            }
        }
        return results;
    }
}
```

### 4. 删除数据

```java
// 删除数据
public class DeleteOperations {
    private final Table table;

    // 删除单列
    public void deleteColumn(String rowKey, String cf, String cq)
            throws IOException {
        Delete delete = new Delete(Bytes.toBytes(rowKey));
        delete.addColumn(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq)
        );
        table.delete(delete);
    }

    // 删除所有版本
    public void deleteAllColumns(String rowKey, String cf, String cq)
            throws IOException {
        Delete delete = new Delete(Bytes.toBytes(rowKey));
        delete.addColumns(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq)
        );
        table.delete(delete);
    }

    // 删除行
    public void deleteRow(String rowKey) throws IOException {
        Delete delete = new Delete(Bytes.toBytes(rowKey));
        table.delete(delete);
    }

    // 删除指定版本
    public void deleteVersion(String rowKey, String cf, String cq,
                            long timestamp) throws IOException {
        Delete delete = new Delete(Bytes.toBytes(rowKey));
        delete.addColumn(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq),
            timestamp
        );
        table.delete(delete);
    }
}
```

---

## 完整示例

```java
// 用户表 CRUD 示例
public class UserTable {
    private final Table table;

    // RowKey 设计：hash(userId) + "_" + userId
    public String designRowKey(String userId) {
        String hash = MD5(userId).substring(0, 8);
        return hash + "_" + userId;
    }

    // 保存用户
    public void saveUser(User user) throws IOException {
        String rowKey = designRowKey(user.getId());

        Put put = new Put(Bytes.toBytes(rowKey));

        // 基本信息列族
        put.addColumn(Bytes.toBytes("info"), Bytes.toBytes("name"),
            Bytes.toBytes(user.getName()));
        put.addColumn(Bytes.toBytes("info"), Bytes.toBytes("email"),
            Bytes.toBytes(user.getEmail()));
        put.addColumn(Bytes.toBytes("info"), Bytes.toBytes("created"),
            Bytes.toBytes(user.getCreatedAt().toString()));

        // 扩展信息列族
        put.addColumn(Bytes.toBytes("extra"), Bytes.toBytes("phone"),
            Bytes.toBytes(user.getPhone()));
        put.addColumn(Bytes.toBytes("extra"), Bytes.toBytes("bio"),
            Bytes.toBytes(user.getBio()));

        table.put(put);
    }

    // 获取用户
    public User getUser(String userId) throws IOException {
        String rowKey = designRowKey(userId);

        Get get = new Get(Bytes.toBytes(rowKey));
        get.addFamily(Bytes.toBytes("info"));
        get.addFamily(Bytes.toBytes("extra"));

        Result result = table.get(get);
        if (result.isEmpty()) {
            return null;
        }

        // 解析结果
        User user = new User();
        user.setId(userId);
        user.setName(getString(result, "info", "name"));
        user.setEmail(getString(result, "info", "email"));
        user.setPhone(getString(result, "extra", "phone"));
        user.setBio(getString(result, "extra", "bio"));
        return user;
    }

    // 批量获取用户
    public List<User> getUsers(List<String> userIds) throws IOException {
        List<Get> gets = userIds.stream()
            .map(id -> {
                Get get = new Get(Bytes.toBytes(designRowKey(id)));
                get.addFamily(Bytes.toBytes("info"));
                return get;
            })
            .collect(Collectors.toList());

        Result[] results = table.get(gets);

        return IntStream.range(0, userIds.size())
            .mapToObj(i -> parseUser(userIds.get(i), results[i]))
            .collect(Collectors.toList());
    }

    // 删除用户
    public void deleteUser(String userId) throws IOException {
        String rowKey = designRowKey(userId);
        Delete delete = new Delete(Bytes.toBytes(rowKey));
        table.delete(delete);
    }
}
```

---

## 面试追问方向

- HBase 的 Put 和 Delete 是如何保证原子性的？
- 如何设计一个高效的用户 Feed 系统？

下一节，我们来了解 Phoenix SQL 层。
