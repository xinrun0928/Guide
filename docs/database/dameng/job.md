# 作业调度：达梦数据库的定时任务

你有没有这样的需求：

- 每天凌晨 2 点清理 30 天前的日志
- 每周一凌晨生成上周报表
- 每小时检查数据库空间使用情况

这些重复性的任务，手动执行太累，写脚本又不好维护。

达梦数据库的**作业调度（JOB）**功能，就是来解决这个问题的。

## 作业的基本概念

达梦的作业系统由以下组件构成：

```
作业 (JOB)
    │
    ├── 作业调度器 (Scheduler)
    │       │
    │       └── 按时间规则触发
    │
    └── 作业步骤 (Step)
            │
            └── 具体执行的动作
```

## 创建作业的基本步骤

### 1. 创建作业

```sql
-- 创建作业
CALL DBMS_JOB.CREATE_JOB(
    JOB_NAME     => 'CLEAN_OLD_LOGS',
    JOB_TYPE     => 'SQL STATEMENT',
    JOB_ACTION   => 'DELETE FROM access_logs WHERE create_time < SYSDATE - 30',
    START_TIME   => TO_TIMESTAMP('02:00:00', 'HH24:MI:SS'),
    FREQ_TYPE    => 2,  -- 每天执行
    FREQ_INTERVAL=> 1   -- 间隔1天
);
```

### 2. 启用作业

```sql
-- 启用作业
CALL DBMS_JOB.SET_ENABLE('CLEAN_OLD_LOGS', TRUE);

-- 或者创建时直接启用
CALL DBMS_JOB.CREATE_JOB(
    JOB_NAME     => 'CLEAN_OLD_LOGS',
    JOB_TYPE     => 'SQL STATEMENT',
    JOB_ACTION   => 'DELETE FROM access_logs WHERE create_time < SYSDATE - 30',
    START_TIME   => TO_TIMESTAMP('02:00:00', 'HH24:MI:SS'),
    FREQ_TYPE    => 2,
    FREQ_INTERVAL=> 1,
    ENABLE_FLAG  => 1   -- 直接启用
);
```

## 作业调度频率设置

### 每天执行

```sql
-- 每天凌晨2点执行
CALL DBMS_JOB.CREATE_JOB(
    JOB_NAME    => 'DAILY_BACKUP',
    JOB_TYPE    => 'SQL STATEMENT',
    JOB_ACTION  => 'CALL SP_BACKUP_DATABASE()',
    START_TIME  => TO_TIMESTAMP('02:00:00', 'HH24:MI:SS'),
    FREQ_TYPE   => 2,   -- DAILY
    FREQ_INTERVAL=> 1   -- 每1天
);
```

### 每周执行

```sql
-- 每周一凌晨3点执行
CALL DBMS_JOB.CREATE_JOB(
    JOB_NAME    => 'WEEKLY_REPORT',
    JOB_TYPE    => 'SQL STATEMENT',
    JOB_ACTION  => 'CALL SP_GENERATE_WEEKLY_REPORT()',
    START_TIME  => TO_TIMESTAMP('03:00:00', 'HH24:MI:SS'),
    FREQ_TYPE   => 4,   -- WEEKLY
    FREQ_INTERVAL=> 1,  -- 每周
    FREQ_WEEKDAY=> 2    -- 周一
);
```

### 每月执行

```sql
-- 每月1日凌晨1点执行
CALL DBMS_JOB.CREATE_JOB(
    JOB_NAME    => 'MONTHLY_ARCHIVE',
    JOB_TYPE    => 'SQL STATEMENT',
    JOB_ACTION  => 'CALL SP_ARCHIVE_MONTHLY_DATA()',
    START_TIME  => TO_TIMESTAMP('01:00:00', 'HH24:MI:SS'),
    FREQ_TYPE   => 5,   -- MONTHLY
    FREQ_DAY_OF_MONTH=> 1  -- 每月1日
);
```

### 自定义间隔

```sql
-- 每6小时执行一次
CALL DBMS_JOB.CREATE_JOB(
    JOB_NAME    => 'MONITOR_STATUS',
    JOB_TYPE    => 'SQL STATEMENT',
    JOB_ACTION  => 'CALL SP_CHECK_DB_STATUS()',
    START_TIME  => TO_TIMESTAMP('00:00:00', 'HH24:MI:SS'),
    FREQ_TYPE   => 3,   -- INTERVAL
    FREQ_INTERVAL=> 6   -- 每6个时间单位
);
```

## 作业步骤与存储过程

### 调用存储过程

```sql
-- 创建存储过程
CREATE OR REPLACE PROCEDURE SP_CLEAN_OLD_DATA AS
BEGIN
    -- 清理30天前的日志
    DELETE FROM access_logs
    WHERE create_time < SYSDATE - 30;

    -- 清理30天前的订单快照
    DELETE FROM order_snapshots
    WHERE snapshot_date < SYSDATE - 30;

    -- 提交事务
    COMMIT;
END;
/

-- 创建作业调用存储过程
CALL DBMS_JOB.CREATE_JOB(
    JOB_NAME    => 'CLEAN_OLD_DATA',
    JOB_TYPE    => 'SQL STATEMENT',
    JOB_ACTION  => 'CALL SP_CLEAN_OLD_DATA()',
    START_TIME  => TO_TIMESTAMP('02:00:00', 'HH24:MI:SS'),
    FREQ_TYPE   => 2,
    FREQ_INTERVAL=> 1,
    ENABLE_FLAG => 1
);
```

```java
// Java 中调用带参数的存储过程
public class JobWithParams {

    public void createParameterizedJob() {
        String sql = "CALL DBMS_JOB.CREATE_JOB(" +
            "JOB_NAME => 'CUSTOM_CLEAN', " +
            "JOB_TYPE => 'SQL STATEMENT', " +
            "JOB_ACTION => 'DELETE FROM logs WHERE created_at < SYSDATE - ?', " +
            "START_TIME => TO_TIMESTAMP(?), " +
            "FREQ_TYPE => ?, " +
            "FREQ_INTERVAL => ? " +
            ")";

        jdbcTemplate.update(sql,
            30,                    // 保留30天
            "02:00:00",            // 执行时间
            2,                     // 每天
            1                      // 间隔1天
        );
    }
}
```

## 作业管理

### 查看作业状态

```sql
-- 查看所有作业
SELECT
    JOB_NAME,
    JOB_TYPE,
    STATE,
    LAST_START_TIME,
    LAST_END_TIME,
    NEXT_RUN_TIME
FROM USER_JOBS;
```

### 手动执行作业

```sql
-- 立即执行作业
CALL DBMS_JOB.RUN('CLEAN_OLD_DATA');

-- 停止正在执行的作业
CALL DBMS_JOB.BROKEN('CLEAN_OLD_DATA', TRUE);
```

### 修改作业

```sql
-- 修改作业执行时间
CALL DBMS_JOB.MODIFY_JOB(
    JOB_NAME   => 'CLEAN_OLD_DATA',
    START_TIME => TO_TIMESTAMP('03:00:00', 'HH24:MI:SS')
);

-- 修改作业执行频率
CALL DBMS_JOB.MODIFY_JOB(
    JOB_NAME    => 'CLEAN_OLD_DATA',
    FREQ_TYPE   => 4,
    FREQ_WEEKDAY=> 1   -- 改为每周一
);

-- 禁用作业
CALL DBMS_JOB.SET_ENABLE('CLEAN_OLD_DATA', FALSE);
```

### 删除作业

```sql
-- 删除作业
CALL DBMS_JOB.REMOVE('OLD_JOB_NAME');
```

## 作业监控与日志

### 查看作业执行历史

```sql
-- 查看作业执行历史
SELECT
    JOB_NAME,
    JOB_STATE,
    START_TIME,
    END_TIME,
    DURATION,
    ERROR_CODE,
    ERROR_MSG
FROM V$JOB_HISTORY
WHERE JOB_NAME = 'CLEAN_OLD_DATA'
ORDER BY START_TIME DESC;
```

```java
// Java 中查询作业执行日志
public class JobMonitor {

    public List&lt;JobHistory&gt; getJobHistory(String jobName, int days) {
        String sql = "SELECT * FROM V$JOB_HISTORY " +
            "WHERE JOB_NAME = ? AND START_TIME > SYSDATE - ? " +
            "ORDER BY START_TIME DESC";

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            JobHistory history = new JobHistory();
            history.setJobName(rs.getString("JOB_NAME"));
            history.setState(rs.getString("JOB_STATE"));
            history.setStartTime(rs.getTimestamp("START_TIME"));
            history.setDuration(rs.getLong("DURATION"));
            history.setErrorMsg(rs.getString("ERROR_MSG"));
            return history;
        }, jobName, days);
    }
}
```

### 作业失败告警

```sql
-- 监控失败的作业
SELECT * FROM V$JOB_HISTORY
WHERE JOB_STATE = 'FAILED'
AND START_TIME > SYSDATE - 1;
```

## 常见作业场景

### 场景一：数据归档

```sql
-- 每月1日归档上月数据
CREATE OR REPLACE PROCEDURE SP_ARCHIVE_MONTHLY AS
BEGIN
    -- 将上月订单归档到历史表
    INSERT INTO orders_archive
    SELECT * FROM orders
    WHERE order_date >= TRUNC(SYSDATE, 'MM') - 1
      AND order_date < TRUNC(SYSDATE, 'MM');

    -- 从主表删除已归档数据
    DELETE FROM orders
    WHERE order_date >= TRUNC(SYSDATE, 'MM') - 1
      AND order_date < TRUNC(SYSDATE, 'MM');

    COMMIT;
END;
/
```

### 场景二：统计报表

```sql
-- 每天凌晨生成日报
CREATE OR REPLACE PROCEDURE SP_GENERATE_DAILY_REPORT AS
BEGIN
    INSERT INTO daily_reports (report_date, total_orders, total_amount)
    SELECT
        TRUNC(SYSDATE - 1) AS report_date,
        COUNT(*) AS total_orders,
        SUM(amount) AS total_amount
    FROM orders
    WHERE order_date >= TRUNC(SYSDATE - 1)
      AND order_date < TRUNC(SYSDATE);

    COMMIT;
END;
/
```

### 场景三：健康检查

```sql
-- 每小时检查表空间使用率
CREATE OR REPLACE PROCEDURE SP_CHECK_TABLESPACE AS
BEGIN
    INSERT INTO tablespace_check_log (check_time, ts_name, used_percent)
    SELECT
        SYSDATE,
        TABLESPACE_NAME,
        ROUND((TOTAL_SIZE - FREE_SIZE) * 100 / TOTAL_SIZE, 2)
    FROM V$TABLESPACE;

    -- 告警逻辑：使用率超过80%
    FOR rec IN (
        SELECT TABLESPACE_NAME
        FROM V$TABLESPACE
        WHERE (TOTAL_SIZE - FREE_SIZE) * 100 / TOTAL_SIZE > 80
    ) LOOP
        -- 发送告警通知
        INSERT INTO alert_log (alert_time, alert_type, message)
        VALUES (SYSDATE, 'TABLESPACE_FULL', '表空间 ' || rec.TABLESPACE_NAME || ' 使用率超过80%');
    END LOOP;

    COMMIT;
END;
/
```

## 面试追问方向

- 作业执行失败后会自动重试吗？
- 多个作业同时执行会影响数据库性能吗？
- 如何设计一个高可用的定时任务方案？

---

## 一句话总结

作业调度是数据库的「定时闹钟」：设定好规则，它就会准时执行。虽然不是万能的，但对于定时清理、报表生成这类需求，足够好用。
