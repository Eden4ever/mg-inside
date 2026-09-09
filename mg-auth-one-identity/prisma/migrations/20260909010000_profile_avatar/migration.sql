-- 缓存已有企业微信资料权限返回的头像；不新增授权或修改现有账号身份。
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
