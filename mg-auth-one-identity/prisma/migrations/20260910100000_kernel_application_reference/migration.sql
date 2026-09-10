-- 必须先导入内核并逐项核对清单；保留关系外键，仅移除本地应用定义。
ALTER TABLE "Application" RENAME TO "ApplicationReference";
ALTER TABLE "ApplicationReference" DROP COLUMN "name", DROP COLUMN "enabled";
