# PostgreSQL PostGIS 空间数据库扩展

想存储地图上的坐标点？

想计算两个地点之间的距离？

想查找附近的人？

PostGIS 让 PostgreSQL 成为强大的空间数据库。

今天，我们来聊聊 PostgreSQL 的 PostGIS 扩展。

## PostGIS 基础

### 什么是 PostGIS

PostGIS 是 PostgreSQL 的空间扩展，支持：
- 地理空间数据类型（点、线、面）
- 空间索引（GiST）
- 空间函数（距离计算、面积计算、投影转换）
- 空间参考系统（SRS）

### 安装

```bash
# Ubuntu/Debian
apt install postgresql-15-postgis-3

# macOS
brew install postgis

# 创建扩展
psql -d mydb -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

### 基本数据类型

```sql
-- 查看 PostGIS 版本
SELECT PostGIS_Version();

-- 常用空间类型
-- POINT：点
-- LINESTRING：线
-- POLYGON：多边形
-- MULTIPOINT：多点
-- MULTILINESTRING：多线
-- MULTIPOLYGON：多面
-- GEOMETRYCOLLECTION：几何集合
```

### 创建空间表

```sql
-- 创建商店表
CREATE TABLE stores (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    location GEOMETRY(POINT, 4326),  -- WGS84 坐标系
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建地理列
ALTER TABLE stores 
ADD COLUMN location GEOGRAPHY(POINT, 4326);

-- 插入点数据
INSERT INTO stores (name, location) VALUES
    ('Store A', ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326)),
    ('Store B', ST_SetSRID(ST_MakePoint(121.5, 31.2), 4326)),
    ('Store C', ST_SetSRID(ST_MakePoint(113.3, 23.1), 4326));
```

## 坐标系与 SRID

### 什么是 SRID

SRID（Spatial Reference System Identifier）是空间参考系统的标识符：

| SRID | 名称 | 说明 |
|------|------|------|
| 4326 | WGS84 | GPS 使用，全球经纬度 |
| 3857 | Web Mercator | Web 地图使用 |
| 4490 | CGCS2000 | 中国大地坐标系 |

### 坐标转换

```sql
-- 设置坐标系
SELECT ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326);

-- 转换为另一个坐标系
SELECT ST_Transform(
    ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326),
    3857
);

-- 获取坐标系
SELECT ST_SRID(location) FROM stores;
```

## 空间函数

### 创建几何对象

```sql
-- 点
SELECT ST_MakePoint(116.4, 39.9);
SELECT ST_PointFromText('POINT(116.4 39.9)', 4326);
SELECT ST_PointFromWKB(ST_AsEWKB('POINT(116.4 39.9)'::GEOMETRY));

-- 线
SELECT ST_MakeLine(ST_MakePoint(116.4, 39.9), ST_MakePoint(121.5, 31.2));

-- 面（多边形）
SELECT ST_MakePolygon(
    ST_ExteriorRing(
        ST_MakeLine(ARRAY[
            ST_MakePoint(0, 0),
            ST_MakePoint(1, 0),
            ST_MakePoint(1, 1),
            ST_MakePoint(0, 1),
            ST_MakePoint(0, 0)
        ]::GEOMETRY[])
    )
);
```

### 关系函数

```sql
-- 距离计算（米）
SELECT ST_Distance(
    location,
    ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326)
) FROM stores;

-- 是否相交
SELECT ST_Intersects(
    ST_MakePolygon(...),
    ST_MakePoint(0.5, 0.5)
);

-- 是否包含
SELECT ST_Contains(
    ST_MakePolygon(...),
    ST_MakePoint(0.5, 0.5)
);

-- 是否在范围内
SELECT ST_Within(
    ST_MakePoint(0.5, 0.5),
    ST_MakePolygon(...)
);
```

### 度量函数

```sql
-- 长度（米）
SELECT ST_Length(
    ST_GeomFromText('LINESTRING(116.4 39.9, 121.5 31.2)', 4326)
);

-- 面积（平方米）
SELECT ST_Area(
    ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326)
);

-- 周长（米）
SELECT ST_Perimeter(
    ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326)
);
```

### 访问函数

```sql
-- 获取 X 坐标
SELECT ST_X(location) FROM stores;

-- 获取 Y 坐标
SELECT ST_Y(location) FROM stores;

-- 获取边界框
SELECT ST_BoundingBox(location) FROM stores;

-- 获取几何类型
SELECT ST_GeometryType(location) FROM stores;
```

## 空间索引

### 创建空间索引

```sql
-- 创建 GiST 索引（必须）
CREATE INDEX idx_stores_location ON stores USING GIST (location);

-- 或者使用 CAST 为 GEOGRAPHY 类型创建索引
CREATE INDEX idx_stores_location_geo ON stores USING GIST ((location::GEOGRAPHY));
```

### 使用索引查询

```sql
-- 查看是否使用索引
EXPLAIN
SELECT * FROM stores 
WHERE location && ST_MakeEnvelope(116.0, 39.0, 117.0, 40.0, 4326);

-- 空间索引会大幅提升查询性能
-- && 是空间相交操作符
```

## 实际应用

### 场景一：查找附近的门店

```sql
-- 查找距离用户 10 公里内的所有门店
SELECT 
    id,
    name,
    ST_Distance(
        location, 
        ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326)
    ) AS distance_meters
FROM stores
WHERE ST_DWithin(
    location,  -- 使用 GEOGRAPHY 才能正确计算距离
    ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326)::GEOGRAPHY,
    10000  -- 10 公里
)
ORDER BY distance_meters;

-- 注意：ST_DWithin 使用 GEOGRAPHY 类型更准确
```

### 场景二：区域查询

```sql
-- 定义北京市区域（简化多边形）
WITH beijing AS (
    SELECT ST_GeomFromText('
        POLYGON((
            115.4 39.4,
            117.5 39.4,
            117.5 41.1,
            115.4 41.1,
            115.4 39.4
        ))
    ', 4326) AS geom
)
SELECT s.*
FROM stores s, beijing b
WHERE ST_Contains(b.geom, s.location);
```

### 场景三：路线分析

```sql
-- 创建道路表
CREATE TABLE roads (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    route GEOMETRY(LINESTRING, 4326)
);

-- 计算路线长度
SELECT 
    name,
    ST_Length(route) AS length_meters
FROM roads
ORDER BY length_meters DESC;

-- 查找经过某点的道路
SELECT r.*
FROM roads r
WHERE ST_DWithin(
    r.route,
    ST_SetSRID(ST_MakePoint(116.4, 39.9), 4326),
    100  -- 100 米范围内
);
```

### 场景四：碰撞检测

```sql
-- 检查配送区域是否重叠
SELECT 
    a.id AS area_a,
    b.id AS area_b
FROM delivery_areas a
JOIN delivery_areas b ON a.id < b.id
WHERE ST_Intersects(a.boundary, b.boundary);

-- 计算重叠面积
SELECT 
    a.id AS area_a,
    b.id AS area_b,
    ST_Area(ST_Intersection(a.boundary, b.boundary)) AS overlap_area
FROM delivery_areas a
JOIN delivery_areas b ON a.id < b.id
WHERE ST_Intersects(a.boundary, b.boundary);
```

## 地理计算

### Haversine 距离（球面距离）

```sql
-- 计算两个经纬度点之间的距离
SELECT 
    ST_DistanceSphere(
        ST_MakePoint(116.4, 39.9),
        ST_MakePoint(121.5, 31.2)
    ) AS distance_meters;

-- 或使用 PostGIS 扩展
SELECT 
    ST_Distance(
        ST_MakePoint(116.4, 39.9)::GEOGRAPHY,
        ST_MakePoint(121.5, 31.2)::GEOGRAPHY
    ) AS distance_meters;
```

### 缓冲区分析

```sql
-- 为门店创建 5 公里服务范围
SELECT 
    id,
    name,
    ST_Buffer(location, 5000) AS service_area
FROM stores;

-- 查找被某个门店服务范围覆盖的区域
SELECT r.*
FROM regions r
JOIN stores s ON ST_Contains(ST_Buffer(s.location, 5000), r.boundary)
WHERE s.id = 1;
```

## Java 应用

### JPA 空间类型映射

```java
@Entity
@Table(name = "stores")
public class Store {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String name;
    
    @Column(name = "location", columnDefinition = "geometry(Point, 4326)")
    private Point location;  // JTS Point
}

public class Point {
    private double x;  // 经度
    private double y;  // 纬度
    
    // getter/setter
}
```

### MyBatis 空间查询

```java
@Select("""
    SELECT id, name, ST_X(location) as lon, ST_Y(location) as lat
    FROM stores
    WHERE ST_DWithin(
        location::GEOGRAPHY,
        ST_SetSRID(ST_MakePoint(#{lon}, #{lat}), 4326)::GEOGRAPHY,
        #{radiusMeters}
    )
    ORDER BY ST_Distance(
        location::GEOGRAPHY,
        ST_SetSRID(ST_MakePoint(#{lon}, #{lat}), 4326)::GEOGRAPHY
    )
    """)
List<Store> findNearbyStores(
    @Param("lon") double longitude,
    @Param("lat") double latitude,
    @Param("radiusMeters") double radiusMeters
);
```

## 常见问题

### 坐标系选择

```sql
-- 中国常用坐标系
-- 4326 (WGS84)：GPS、互联网地图
-- 4490 (CGCS2000)：中国测绘
-- 3857 (Web Mercator)：Google Maps、OpenStreetMap

-- 推荐：使用 4326 (WGS84) 作为默认
-- 因为 GPS 和大多数 Web 地图都使用这个坐标系
```

### 性能优化

```sql
-- 1. 确保空间索引存在
CREATE INDEX idx_stores_location ON stores USING GIST (location);

-- 2. 使用空间边界过滤
SELECT * FROM stores 
WHERE location && ST_MakeEnvelope(115, 39, 117, 41, 4326)  -- 先过滤边界
AND ST_DWithin(location, ST_MakePoint(116.4, 39.9)::GEOGRAPHY, 10000);  -- 再精确计算

-- 3. 使用 GEOGRAPHY 类型进行距离计算
-- GEOGRAPHY 使用球面计算，更准确（适合大范围）
-- GEOMETRY 使用平面计算，更快（适合小范围）
```

## 面试高频问题

### Q1: PostGIS 支持哪些空间数据类型？

**考察点**：空间数据类型

**参考答案**：
- POINT：点
- LINESTRING：线
- POLYGON：多边形
- MULTI*：多几何对象
- GEOMETRYCOLLECTION：几何集合

### Q2: SRID 是什么？

**考察点**：坐标系

**参考答案**：
- Spatial Reference System Identifier
- 4326：WGS84（GPS）
- 3857：Web Mercator
- 4490：CGCS2000

### Q3: 如何优化空间查询性能？

**考察点**：性能优化

**参考答案**：
1. 创建 GiST 索引
2. 使用空间边界过滤（&&）
3. 正确选择 GEOMETRY vs GEOGRAPHY
4. 对大表进行分区

### Q4: 如何计算两点之间的距离？

**考察点**：空间函数

**参考答案**：
- `ST_Distance`：计算距离
- 使用 GEOGRAPHY 类型更准确
- `ST_DWithin`：快速判断是否在范围内

## 总结

PostGIS 让 PostgreSQL 成为强大的空间数据库：

| 功能 | 说明 |
|------|------|
| 空间类型 | POINT、LINESTRING、POLYGON |
| 空间索引 | GiST 索引 |
| 空间函数 | 距离、面积、包含、相交 |
| 坐标系 | 支持多种 SRID |

使用场景：
- LBS 应用（附近的人/门店）
- 地理分析
- 路线规划
- 配送区域管理
- 空间查询

PostGIS + PostgreSQL = 企业级空间数据库解决方案。
