# Office 中文字体

2026-09-09 已安装到 43.139.78.226 的 ONLYOFFICE Docs 9.3.1 引擎。

| 显示名称 | 文档字体名称 | 来源 |
| --- | --- | --- |
| 方正小标宋简体 | FZXiaoBiaoSong-B05S | 用户提供的方正小标宋简.TTF |
| 仿宋_GB2312 | FangSong_GB2312 | 用户提供的仿宋_GB2312.ttf |
| 楷体_GB2312 | KaiTi_GB2312 | 用户提供的楷体_GB2312.TTF |
| 黑体 | SimHei | 当前用户 Windows 字体目录 simhei.ttf |
| 宋体 | SimSun | 当前用户 Windows 字体目录 simsun.ttc，含新宋体 |

字体不改名、不修改字体嵌入属性。二进制仅保存在发布产物与引擎 Data 持久卷的 `custom-fonts/mg-chinese-fonts` 中，未写入前端源码或作为页面 UI 字体。编辑器与导出转换器共同使用该字体索引。

安装脚本为 `deploy/install-office-fonts.py`，打包脚本为 `scripts/package-office-fonts.py`。包 SHA256：`fd8163f21c63a9e8fbea6cc40d9fc8c456e4badfc9ea92f3906f3f13a2ac3474`。安装及原索引备份：`/opt/mg-office/backups/fonts-20260909T020000Z`。依照引擎现有生成脚本扫描 Data/custom-fonts、刷新索引和缓存，并重启 docservice/converter；容器与数据卷均保留。后续容器重建会重新生成索引。

核验：五个目标字体均进入 AllFonts.js；正式编辑器字体菜单显示方正小标宋简体；实际引擎 x2t 将包含五种字体的 DOCX 转为 PDF，渲染检查五行中文字形及换行正常。PDF 内仿宋、楷体、黑体、宋体为对应字体资源；方正附件的 fsType=2，引擎将其输出为矢量轮廓，保留视觉效果但该行 PDF 文字无法作为文本提取。原 DOCX 中字体名称与文字仍保留，不改动附件的限制标记。

验证产物：`artifacts/office-font-verification/font-check.docx`、`font-check.pdf`、`font-check.png`。正式既有文档仅打开字体菜单检查，未修改内容；健康检查通过。

安装依据：[ONLYOFFICE 官方 Docker 字体安装说明](https://helpcenter.onlyoffice.com/docs/installation/docs-install-fonts-docker.aspx)及当前镜像内 `/usr/bin/documentserver-generate-allfonts.sh` 的实际实现。
