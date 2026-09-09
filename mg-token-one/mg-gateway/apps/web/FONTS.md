# 自托管字体

`public/fonts/fonts.css` 与同目录的 620 个 `.woff2` 为生成产物，由 `cn-font-split` 与 `fontTools` 产出，**不要手工编辑**。
`index.html` 通过 `<link rel="stylesheet" href="/fonts/fonts.css">` 引入；样式层由 `--mg-font-family` 与
`--mg-font-family-brand`（见 `src/styles/global.css`）消费。

## 两种字体的处理方式不同

| 家族名 | 原字体 | 处理方式 | 说明 |
| --- | --- | --- | --- |
| `mg-font-alinormal` | 阿里巴巴普惠体 3.0，400 / 500 / 600 三个字重 | 按 `unicode-range` 分包 | 字形覆盖与原字体完全一致（每字重约 2.9 万个码位），浏览器只下载页面上实际出现字符所在的分包 |
| `mg-font-ding` | 钉钉进步体 | 子集化到 ASCII（U+0020-007E） | 仅用于品牌标题 `Token One`（登录页与后台顶栏），1 MB → 8 KB |

`mg-font-ding` **只能用于 ASCII 文本**。若用它排中文，字符会逐个回退到 `--mg-font-family`，
出现同一行内混排两种字体的效果。需要中文品牌字时必须重新生成一份包含相应字符的子集。

## 重新生成

原始字体文件不入库（三个字重各约 5 MB）。来源为 `mg-design-element` 的 `font-alinormal` /
`font-ding` 包，本机另一份副本在 `C:\Projects\iam-admin-ui-prototype\src\assets\fonts\`。

```powershell
npm i cn-font-split                 # 生成分包
python -m pip install fonttools brotli   # 生成品牌字体子集

# 正文字体：每个字重跑一次，family/weight 按下表填
node node_modules/cn-font-split/dist/cli.js run `
  -i AlibabaPuHuiTi-3-55-Regular.woff2 -o out/alinormal-400 `
  --css.fontFamily mg-font-alinormal --css.fontWeight 400 --css.fontDisplay swap `
  --css.fileName result.css --css.commentBase false --css.commentNameTable false `
  --css.commentUnicodes false --css.compress true --testHtml false --reporter false

# 品牌字体：子集化到 ASCII
python -m fontTools.subset DingTalk-JinBuTi.woff2 --unicodes="U+0020-007E" `
  --flavor=woff2 --output-file=DingTalk-JinBuTi-latin.woff2
```

再把三个 `out/*/result.css` 依次拼接、追加 `mg-font-ding` 的 `@font-face`，
把全部分包 `.woff2`（文件名即内容哈希，可直接拍平到同一目录）与 `DingTalk-JinBuTi-latin.woff2`
一起放到本目录即可。

## 重新生成时的缓存陷阱

分包 `.woff2` 的文件名是内容哈希，天然带缓存击穿；但 `fonts.css` 的文件名是固定的。
如果重新生成后直接删掉旧分包，浏览器里**仍被缓存的旧 `fonts.css`** 会去请求已不存在的分包；
网关的 SPA 回退会对这些请求返回 `index.html`（HTTP 200 的 HTML），浏览器解析字体失败后
静默回退到系统字体——页面不报错，但字体全变了，很难排查。

因此重新生成时二选一：保留旧分包若干个版本周期，或者给 `fonts.css` 改名（如
`fonts.<hash>.css`）并同步改 `index.html` 的 `<link>`。

## 服务端建议

`fonts.css` 未压缩约 458 KB（绝大部分是 `unicode-range` 码位表），gzip 后约 150 KB。
网关用 `express.static` 托管前端产物，本身不做压缩；在前置 nginx 上对 `text/css`
开启 gzip 可显著降低首屏开销。
