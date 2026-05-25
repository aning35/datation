-- ============================================================
-- Datation 演示数据集：电商销售分析 (SQLite 兼容版)
-- 包含：客户、产品分类、产品、订单、订单明细 五张关联表
-- ============================================================

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS customers;

-- 1. 客户表
CREATE TABLE customers (
    customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    gender TEXT,
    age INTEGER,
    city TEXT,
    province TEXT,
    registration_date TEXT,
    vip_level TEXT DEFAULT 'normal'
);

INSERT INTO customers (name, gender, age, city, province, registration_date, vip_level) VALUES
('张伟', '男', 28, '上海', '上海', '2023-01-15', 'gold'),
('李娜', '女', 34, '北京', '北京', '2023-02-20', 'silver'),
('王芳', '女', 25, '杭州', '浙江', '2023-03-10', 'normal'),
('刘洋', '男', 42, '深圳', '广东', '2023-01-05', 'diamond'),
('陈静', '女', 31, '成都', '四川', '2023-04-18', 'gold'),
('赵磊', '男', 29, '广州', '广东', '2023-05-22', 'normal'),
('孙丽', '女', 38, '南京', '江苏', '2023-02-14', 'silver'),
('周杰', '男', 26, '武汉', '湖北', '2023-06-01', 'normal'),
('吴敏', '女', 45, '重庆', '重庆', '2023-03-28', 'gold'),
('郑强', '男', 33, '西安', '陕西', '2023-07-12', 'normal'),
('黄丽华', '女', 27, '苏州', '江苏', '2023-08-05', 'silver'),
('林小明', '男', 36, '厦门', '福建', '2023-01-20', 'gold'),
('何婷', '女', 30, '长沙', '湖南', '2023-09-15', 'normal'),
('马超', '男', 41, '郑州', '河南', '2023-04-02', 'diamond'),
('罗琳', '女', 24, '昆明', '云南', '2023-10-08', 'normal'),
('谢飞', '男', 35, '天津', '天津', '2023-05-30', 'silver'),
('韩梅', '女', 29, '青岛', '山东', '2023-11-11', 'gold'),
('唐亮', '男', 32, '大连', '辽宁', '2023-06-18', 'normal'),
('冯雪', '女', 40, '合肥', '安徽', '2023-07-25', 'silver'),
('曹鹏', '男', 28, '福州', '福建', '2023-12-01', 'normal');

-- 2. 产品分类表
CREATE TABLE categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL,
    parent_category TEXT
);

INSERT INTO categories (category_name, parent_category) VALUES
('电子产品', NULL),
('手机配件', '电子产品'),
('电脑办公', '电子产品'),
('家居生活', NULL),
('厨房用品', '家居生活'),
('家纺布艺', '家居生活'),
('服装鞋帽', NULL),
('男装', '服装鞋帽'),
('女装', '服装鞋帽'),
('食品饮料', NULL),
('零食', '食品饮料'),
('饮品', '食品饮料');

-- 3. 产品表
CREATE TABLE products (
    product_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(category_id),
    brand TEXT,
    unit_price REAL,
    cost_price REAL,
    stock_qty INTEGER DEFAULT 0
);

INSERT INTO products (product_name, category_id, brand, unit_price, cost_price, stock_qty) VALUES
('iPhone 15 Pro Max 256GB', 1, 'Apple', 9999.00, 7200.00, 150),
('华为 Mate 60 Pro', 1, '华为', 6999.00, 4800.00, 200),
('小米14 Ultra', 1, '小米', 5999.00, 4100.00, 300),
('AirPods Pro 2', 2, 'Apple', 1899.00, 1100.00, 500),
('手机壳透明防摔', 2, '绿联', 39.90, 8.00, 2000),
('Type-C快充数据线', 2, '安克', 59.90, 15.00, 1500),
('MacBook Air M3', 3, 'Apple', 8999.00, 6500.00, 100),
('联想小新Pro16', 3, '联想', 5499.00, 3800.00, 250),
('机械键盘87键', 3, 'IKBC', 399.00, 180.00, 800),
('空气炸锅5L', 5, '美的', 299.00, 150.00, 400),
('不粘炒锅32cm', 5, '苏泊尔', 199.00, 85.00, 600),
('保温杯500ml', 5, '象印', 259.00, 120.00, 350),
('纯棉四件套', 6, '罗莱', 599.00, 250.00, 200),
('乳胶枕头', 6, '睡眠博士', 299.00, 100.00, 450),
('羽绒被冬季加厚', 6, '富安娜', 899.00, 380.00, 180),
('男士休闲外套', 8, '优衣库', 399.00, 160.00, 500),
('男士牛仔裤', 8, 'Levis', 599.00, 220.00, 350),
('女士连衣裙', 9, 'ZARA', 499.00, 180.00, 400),
('女士羊毛大衣', 9, 'MaxMara', 2999.00, 1200.00, 100),
('坚果礼盒1kg', 11, '三只松鼠', 99.90, 45.00, 1000),
('巧克力礼盒', 11, '费列罗', 158.00, 80.00, 600),
('咖啡豆454g', 12, '星巴克', 108.00, 50.00, 800),
('气泡水24罐装', 12, '元气森林', 79.90, 35.00, 1200),
('牛肉干250g', 11, '科尔沁', 69.90, 30.00, 900);

-- 4. 订单表
CREATE TABLE orders (
    order_id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(customer_id),
    order_date TEXT NOT NULL,
    payment_method TEXT,
    total_amount REAL,
    discount_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'completed'
);

-- 5. 订单明细表
CREATE TABLE order_items (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(order_id),
    product_id INTEGER REFERENCES products(product_id),
    quantity INTEGER NOT NULL,
    unit_price REAL,
    subtotal REAL
);

-- ============================================================
-- 生成 2024 全年的订单数据（~200 条订单）
-- 使用 SQLite 递归 CTE 替代 PostgreSQL 的 generate_series
-- ============================================================

-- 插入 200 条订单（随机客户、日期、支付方式、状态）
WITH RECURSIVE seq(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 200
)
INSERT INTO orders (customer_id, order_date, payment_method, total_amount, discount_amount, status)
SELECT
    ABS(RANDOM()) % 20 + 1 AS customer_id,
    datetime('2024-01-01',
        '+' || (ABS(RANDOM()) % 365) || ' days',
        '+' || (ABS(RANDOM()) % 24) || ' hours',
        '+' || (ABS(RANDOM()) % 60) || ' minutes'
    ) AS order_date,
    CASE ABS(RANDOM()) % 5
        WHEN 0 THEN '支付宝'
        WHEN 1 THEN '微信支付'
        WHEN 2 THEN '银行卡'
        WHEN 3 THEN '花呗'
        ELSE '信用卡'
    END AS payment_method,
    0 AS total_amount,
    ROUND(ABS(RANDOM()) % 5000 / 100.0, 2) AS discount_amount,
    CASE ABS(RANDOM()) % 7
        WHEN 0 THEN 'completed'
        WHEN 1 THEN 'completed'
        WHEN 2 THEN 'completed'
        WHEN 3 THEN 'completed'
        WHEN 4 THEN 'shipped'
        WHEN 5 THEN 'refunded'
        ELSE 'cancelled'
    END AS status
FROM seq;

-- 为每个订单插入第 1 件商品（所有订单都有）
INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
SELECT
    t.order_id,
    t.pid,
    t.qty,
    p.unit_price,
    ROUND(p.unit_price * t.qty, 2)
FROM (
    SELECT order_id,
           ABS(RANDOM()) % 24 + 1 AS pid,
           ABS(RANDOM()) % 3 + 1 AS qty
    FROM orders
) t
JOIN products p ON p.product_id = t.pid;

-- 为 ~70% 的订单插入第 2 件商品
INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
SELECT
    t.order_id,
    t.pid,
    t.qty,
    p.unit_price,
    ROUND(p.unit_price * t.qty, 2)
FROM (
    SELECT order_id,
           ABS(RANDOM()) % 24 + 1 AS pid,
           ABS(RANDOM()) % 2 + 1 AS qty
    FROM orders
    WHERE ABS(RANDOM()) % 100 < 70
) t
JOIN products p ON p.product_id = t.pid;

-- 为 ~30% 的订单插入第 3 件商品
INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
SELECT
    t.order_id,
    t.pid,
    1 AS qty,
    p.unit_price,
    p.unit_price
FROM (
    SELECT order_id,
           ABS(RANDOM()) % 24 + 1 AS pid
    FROM orders
    WHERE ABS(RANDOM()) % 100 < 30
) t
JOIN products p ON p.product_id = t.pid;

-- 更新订单总金额 = 该订单所有明细 subtotal 之和
UPDATE orders
SET total_amount = (
    SELECT COALESCE(SUM(oi.subtotal), 0)
    FROM order_items oi
    WHERE oi.order_id = orders.order_id
);
