-- 微信扫码登录:openid 用于本应用内匹配,unionid 预留跨应用打通,昵称仅作展示。
-- 三列均可空:存量用户没有微信,手机号登录的用户也可能永远不绑。
ALTER TABLE "User" ADD COLUMN "wxOpenid" TEXT;
ALTER TABLE "User" ADD COLUMN "wxUnionid" TEXT;
ALTER TABLE "User" ADD COLUMN "wxNickname" TEXT;

-- 唯一索引必须建:否则同一个微信号并发登录会创建出两个账号(额度、订单各挂一半)。
-- Postgres 的唯一索引允许多行 NULL,所以不影响未绑定微信的用户。
CREATE UNIQUE INDEX "User_wxOpenid_key" ON "User"("wxOpenid");
CREATE UNIQUE INDEX "User_wxUnionid_key" ON "User"("wxUnionid");
