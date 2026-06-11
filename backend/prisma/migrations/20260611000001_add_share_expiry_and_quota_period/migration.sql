-- AddColumn: 分享链接过期时间 (Document)
ALTER TABLE "Document" ADD COLUMN "shareExpiresAt" TIMESTAMP(3);

-- AddColumn: 额度按订阅周期重置的起点 (User)
ALTER TABLE "User" ADD COLUMN "quotaPeriodStart" TIMESTAMP(3);
