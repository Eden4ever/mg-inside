-- 新员工只在中心建号；业务侧自动维护映射，历史用户 ID 仍然保留。
ALTER TABLE "ApplicationUser" ALTER COLUMN "localUserId" DROP NOT NULL;
