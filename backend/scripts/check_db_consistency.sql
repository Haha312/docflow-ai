-- 数据库一致性检查脚本

-- 1. 检查所有用户的订阅状态
SELECT 
    "subscriptionStatus", 
    COUNT(*) as count 
FROM "User" 
GROUP BY "subscriptionStatus";

-- 2. 检查是否有旧的订阅状态
SELECT 
    email, 
    "subscriptionStatus",
    "subscriptionEndDate"
FROM "User" 
WHERE "subscriptionStatus" NOT IN ('FREE', 'PRO', 'TEAM');

-- 3. 查看管理员账号状态
SELECT 
    email,
    "subscriptionStatus",
    "subscriptionEndDate",
    "createdAt"
FROM "User"
WHERE email = 'admin@docuflow.ai';

-- 4. 检查最近的使用记录
SELECT 
    u.email,
    u."subscriptionStatus",
    COUNT(ul.id) as usage_count,
    MAX(ul."createdAt") as last_used
FROM "User" u
LEFT JOIN "UsageLog" ul ON u.id = ul."userId"
GROUP BY u.id, u.email, u."subscriptionStatus"
ORDER BY last_used DESC NULLS LAST
LIMIT 10;

-- 5. 检查订单表中的 planType
SELECT DISTINCT "planType" FROM "Order";
