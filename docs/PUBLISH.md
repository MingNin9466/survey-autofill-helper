# 发布与宣传清单

这份文件给仓库 owner 自己看：仓库描述、Topics、Release 文案、宣传短文案，以及发布后的自检步骤。

## 1. 仓库信息

**仓库名**：`survey-autofill-helper`

**About（英文，≤350 字符）**

> Tampermonkey userscript that fills 问卷星 / 腾讯问卷 / WPS 表单 from reusable answer templates. Scans questions, matches by keyword, fills in one click. Fills only — never auto-submits. Templates stay local.

**About（中文）**

> 问卷填表助手：把答案存成模板，一键填入问卷星 / 腾讯问卷 / WPS 表单。支持抓题建模板、逐题核对；只填不交，数据只存本机。

**Topics（设置 → About 齿轮 → Topics）**

```
tampermonkey, userscript, autofill, survey, forms, wjx, questionnaire,
tencent-survey, wps-form, edge, chromium, chinese
```

**Website**：留空即可（README 里已有安装地址）。

## 2. Release v1.0.2

标题：`v1.0.2 — WPS 表单支持 / WPS Forms support`

正文见 [release-notes-v1.0.2.md](release-notes-v1.0.2.md)。附件上传 `survey-autofill-helper.user.js`，方便直接下载安装。

## 3. 宣传文案

### 一句话版

- 中文：**别再重复填同一份问卷了：答案存成模板，问卷星 / 腾讯问卷 / WPS 表单 一键填完，只填不交。**
- 英文：**Stop retyping survey answers — fill WJX / Tencent Survey / WPS Forms in one click, and submit manually.**

### 同学 / 群聊版（短，适合 QQ 群、微信群）

> 做了个油猴脚本：问卷星、腾讯问卷、WPS 表单都能用。第一次把答案填一遍存成模板，以后同类问卷点一下「一键填充」就填好，只填不交，提交还是自己点。
> 装法：装篡改猴 → 拖入 `survey-autofill-helper.user.js`。
> 仓库：`https://github.com/<你的用户名>/survey-autofill-helper`

### 通用版（稍正式，适合朋友圈、空间）

> 每次填问卷都在翻上次的答案？写了个 Tampermonkey 脚本，把「题干关键词 → 答案」存成模板，问卷星 / 腾讯问卷 / WPS 表单 一键填入，逐题回读校验，绿框成功、红框失败。
> 三个原则：只填不交、不联网、模板只存本机。
> 已实测 30 题问卷星、腾讯问卷、WPS 表单；矩阵/排序/上传题不猜答案，直接标「手动填写」。
> 仓库：`https://github.com/<你的用户名>/survey-autofill-helper`

### B 站动态 / 知乎想法 / 小红书

> 填问卷的神器（自用向）：Tampermonkey 脚本「问卷填表助手」
> · 问卷星 / 腾讯问卷 / WPS 表单 都适配
> · 第一次：抓题 → 逐题写答案 → 存模板
> · 以后：一键填充，绿框=成功，红框=失败，自己核对后提交
> · 不自动提交、不联网、不上传
> 仓库在评论区 / 主页。

### English (X / Reddit / Hacker News Show)

> I built a Tampermonkey userscript for Chinese survey platforms (问卷星, 腾讯问卷, WPS 表单): save answers as templates, fill a form in one click, with per-question verification.
> It fills but never submits, and stores everything locally.
> Repo: https://github.com/<your-name>/survey-autofill-helper

## 4. 发布步骤

1. 双击仓库根目录的 `publish.cmd`。
2. 第一次会让你填 Git 用户名 / 邮箱（只写入本地仓库配置）。
3. 没有 GitHub CLI 时，脚本会打开 <https://github.com/new>：
   - 仓库名 `survey-autofill-helper`，选 **Public**；
   - **不要**勾选 README / .gitignore / License（本地已经有了）；
   - 建好后把仓库地址粘回脚本。
4. 首次推送时 Git Credential Manager 会弹浏览器，登录 GitHub 授权即可。
5. 脚本会自动把 README 和脚本头里的 `__GITHUB_OWNER__` / `__REPO__` 替换成真实地址，再补一次提交。
6. 到仓库 **Releases → Draft a new release**，选 tag `v1.0.2`，上传 `survey-autofill-helper.user.js`，正文粘贴 release notes。
7. 仓库页右上 **About** 齿轮：填描述、加 Topics（见第 1 节）。

## 5. 发布后自检

- [ ] 打开 `https://raw.githubusercontent.com/<owner>/<repo>/main/survey-autofill-helper.user.js`，能看到脚本且头部的 `@updateURL` 已是真实地址
- [ ] 在干净浏览器里点 raw 地址，篡改猴能弹出安装页
- [ ] 安装后打开问卷星测试页，右下角出现「填」
- [ ] README 里两张截图能正常显示
- [ ] About 描述、Topics 已填
- [ ] Release 附件可下载
