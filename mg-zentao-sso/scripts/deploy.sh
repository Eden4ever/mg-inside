#!/bin/sh
# 把扩展放进禅道容器的 custom 扩展目录，并在宿主机留一份副本。
# 扩展默认 turnon=false，放置后不改变任何现有行为；开启需另行在 config/my.php 配置。
# 回滚：docker exec zentao-app rm -rf /apps/zentao/extension/custom/sso
set -e

SRC=${1:-/tmp/mgsso}
KEEP=/opt/zentao/mg-sso-extension
DEST=/apps/zentao/extension/custom/sso/ext

test -f "$SRC/control/mgauthen.php"
test -f "$SRC/control/mglogin.php"
test -f "$SRC/config/mg.php"
test -f "$SRC/lang/zh-cn.php"

echo "=== 宿主机保留副本：$KEEP ==="
mkdir -p "$KEEP"
cp -a "$SRC/." "$KEEP/"

echo "=== 部署前检查是否已存在 ==="
docker exec zentao-app sh -lc "ls -d $DEST 2>/dev/null && echo '已存在，将被覆盖' || echo '首次部署'"

echo "=== 建目录并拷贝 ==="
docker exec zentao-app sh -lc "mkdir -p $DEST/control $DEST/config $DEST/lang"
docker cp "$SRC/control/mgauthen.php" "zentao-app:$DEST/control/mgauthen.php"
docker cp "$SRC/control/mglogin.php"  "zentao-app:$DEST/control/mglogin.php"
docker cp "$SRC/config/mg.php"        "zentao-app:$DEST/config/mg.php"
docker cp "$SRC/lang/zh-cn.php"       "zentao-app:$DEST/lang/zh-cn.php"

echo "=== 归属与权限对齐同目录既有文件 ==="
OWNER=$(docker exec zentao-app sh -lc "stat -c '%u:%g' /apps/zentao/extension/custom/index.html")
docker exec zentao-app sh -lc "chown -R $OWNER /apps/zentao/extension/custom/sso && chmod -R u=rwX,go=rX /apps/zentao/extension/custom/sso"

echo "=== 部署结果 ==="
docker exec zentao-app sh -lc "find /apps/zentao/extension/custom/sso -type f -exec ls -l {} +"
echo "=== 清理禅道缓存目录中的合并产物（若有） ==="
docker exec zentao-app sh -lc "ls /apps/zentao/tmp/ 2>/dev/null | head -5"
echo "完成。扩展当前处于关闭状态（turnon=false），未改变现有登录行为。"
