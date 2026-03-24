# SQLite 与 Android 嵌入式开发

你知道吗？

你手机里几乎每个 App 都在用 SQLite：微信的聊天记录、支付宝的交易明细、地图的离线数据、音乐播放器的播放列表……

Android 从第一天起就把 SQLite 作为首选本地存储方案。十年过去了，尽管 Room、DataStore 等新框架层出不穷，SQLite 依然是 Android 开发者绕不开的技能。

---

## 为什么 Android 选择 SQLite？

早期 Android 面临一个难题：手机存储空间有限，不能装重型数据库。

SQLite 的优势完美契合移动端需求：

| 特性 | 优势 |
|-----|------|
| 零配置 | 不需要安装数据库服务 |
| 单文件 | 易于备份、迁移、清理 |
| 低内存占用 | 运行时只需几百 KB |
| C 语言实现 | 性能好，跨平台 |
| 事务支持 | 数据安全有保障 |

Google 的选择，今天看来依然正确。

---

## Android SQLite API 的「原始之美」

如果你用惯了 MySQL 的客户端工具，第一次接触 Android 的 SQLite API，可能会「不适应」：

```java
// 打开数据库（没有密码、没有连接池）
SQLiteDatabase db = openOrCreateDatabase("mydb.db", MODE_PRIVATE, null);

// 执行 SQL（没有预编译？）
db.execSQL("INSERT INTO users (name, age) VALUES ('张三', 25)");

// 查询要手动遍历
Cursor cursor = db.rawQuery("SELECT * FROM users WHERE age > ?", new String[]{"20"});
while (cursor.moveToNext()) {
    String name = cursor.getString(cursor.getColumnIndex("name"));
    int age = cursor.getInt(cursor.getColumnIndex("age"));
}
cursor.close();
```

**这套 API 有什么问题？**

- SQL 拼接容易出错
- 没有编译期检查
- 类型安全全靠开发者自律
- 容易写出 SQL 注入漏洞

---

## Room：Google 推荐的现代方案

为了解决这些问题，Google 在 2017 年推出了 Room 数据库，专门为 Android 优化。

### 基本用法

```java
// 1. 定义 Entity（对应数据库表）
@Entity(tableName = "users")
public class User {
    @PrimaryKey(autoGenerate = true)
    private long id;

    @ColumnInfo(name = "name")
    private String name;

    @ColumnInfo(name = "age")
    private int age;
}

// 2. 定义 DAO（Data Access Object）
@Dao
public interface UserDao {
    @Query("SELECT * FROM users WHERE age > :minAge")
    List&lt;User&gt; findByAge(int minAge);

    @Insert
    long insert(User user);

    @Update
    void update(User user);

    @Delete
    void delete(User user);
}

// 3. 定义 Database
@Database(entities = {User.class}, version = 1)
public abstract class AppDatabase extends RoomDatabase {
    public abstract UserDao userDao();
}

// 4. 使用
AppDatabase db = Room.databaseBuilder(context, AppDatabase.class, "mydb.db")
                     .build();
UserDao dao = db.userDao();

List&lt;User&gt; users = dao.findByAge(20);  // 类型安全、编译期检查
```

### Room 编译时注解

Room 最强大的特性是**编译时注解处理**：

```java
@Query("SELECT * FROM users WHERE age > :minAge")
List&lt;User&gt; findByAge(int minAge);
```

在编译时，Room 会生成 `UserDao_Impl.java`，检查 SQL 语法、验证列名、生成数据库操作代码。

**这意味着**：写错的 SQL 在编译时就会报错，而不是运行时才崩溃。

---

## LiveData + Room：响应式数据

Room 和 LiveData 结合，可以实现数据变化自动通知 UI：

```java
@Dao
public interface UserDao {
    // 返回 LiveData，数据变化时自动通知观察者
    @Query("SELECT * FROM users")
    LiveData&lt;List&lt;User&gt;&gt; getAllUsers();
}

// ViewModel 中使用
public class UserViewModel extends ViewModel {
    private final LiveData&lt;List&lt;User&gt;&gt; users;

    public UserViewModel(Application app) {
        AppDatabase db = Room.databaseBuilder(app, AppDatabase.class, "mydb.db").build();
        users = db.userDao().getAllUsers();
    }

    public LiveData&lt;List&lt;User&gt;&gt; getUsers() {
        return users;
    }
}

// Activity/Fragment 中观察
viewModel.getUsers().observe(this, userList -> {
    // 数据变化时自动回调，UI 自动更新
    adapter.submitList(userList);
});
```

---

## 性能优化：在 Android 上跑 SQLite

### 1. 批量插入

```java
// 错误的做法
for (User user : users) {
    dao.insert(user);  // 每条一个事务，慢
}

// 正确的做法：支持批量
@Insert(onConflict = OnConflictStrategy.REPLACE)
void insertAll(List&lt;User&gt; users);  // Room 内部优化为单事务
```

### 2. 索引加速

```java
@Entity(indices = {@Index(value = {"email"}, unique = true)})
public class User {
    // email 列会自动创建唯一索引
    private String email;
}
```

### 3. 分页加载

```java
@Query("SELECT * FROM users ORDER BY id LIMIT :limit OFFSET :offset")
List&lt;User&gt; getUsersPaged(int limit, int offset);
```

### 4. 避免主线程操作

```java
// 错误：主线程执行数据库操作会卡 UI
new Thread(() -> {
    dao.insert(user);
}).start();

// 推荐：使用 Kotlin Coroutines 或 RxJava
@Dao
public interface UserDao {
    @Insert
    suspend fun insert(user: User);  // suspend 函数，协程调用
}

// ViewModel 中
viewModelScope.launch {
    dao.insert(user)  // 协程安全执行
}
```

---

## SQLite 在 Android 上的坑

### 1. WAL 模式不是默认的

```java
// 要手动开启 WAL
Room.databaseBuilder(context, AppDatabase.class, "mydb.db")
    .setJournalMode(JournalMode.WRITE_AHEAD_LOGING)
    .build();
```

### 2. 跨进程访问需要特殊处理

```java
// ContentProvider 实现跨进程访问
public class UserProvider extends ContentProvider {
    // 提供标准化的 URI 访问接口
}
```

### 3. 数据库迁移

```java
Room.databaseBuilder(context, AppDatabase.class, "mydb.db")
    .addMigrations(migration1to2, migration2to3)  // 必须处理版本升级
    .build();
```

---

## 面试追问方向

- Room 相比直接使用 SQLite API 有哪些优势？
- Android SQLite 数据库放在哪里？应用卸载后数据还在吗？（提示：`/data/data/&lt;package&gt;/databases/`，会删除）

下一节，我们来聊聊 SQLite 的适用场景与局限性——什么时候用它，什么时候该换方案。
