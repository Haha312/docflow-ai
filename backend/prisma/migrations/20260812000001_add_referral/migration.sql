-- 邀请奖励:User 增加奖励次数与邀请码,新增 Referral 表。
-- 增量迁移,不触碰既有表的任何数据。

-- 1) 邀请状态枚举
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'REJECTED');

-- 2) User:奖励次数(与档位额度相加)+ 邀请码
--    bonusQuota 给默认值 0,已有用户不受影响;referralCode 可空,首次打开邀请页时才生成。
ALTER TABLE "User" ADD COLUMN "bonusQuota" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- 3) Referral:一条记录 = 一次邀请关系
--    inviteeId 唯一 —— 一个人只能被邀请一次,这是防刷的第一道结构性约束。
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "signupIp" TEXT,
    "rejectReason" TEXT,
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Referral_inviteeId_key" ON "Referral"("inviteeId");
CREATE INDEX "Referral_referrerId_status_idx" ON "Referral"("referrerId", "status");
CREATE INDEX "Referral_createdAt_idx" ON "Referral"("createdAt");

ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey"
    FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_inviteeId_fkey"
    FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
