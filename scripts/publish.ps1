# 一键发布到 GitHub（在 Windows PowerShell 5.1 / 7 下均可运行）
# 由仓库根目录的 publish.cmd 调用
# 也可以带参数、完全不交互：
#   publish.cmd <GitHub用户名> <GitHub邮箱> <仓库地址>
param(
  [string]$GitName = '',
  [string]$GitEmail = '',
  [string]$RepoUrl = ''
)
$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

try { Start-Transcript -Path (Join-Path $repoRoot 'publish.log') -Force | Out-Null } catch { }

Write-Host ''
Write-Host '=== Publish survey-autofill-helper to GitHub ===' -ForegroundColor Cyan
Write-Host '=== 问卷填表助手 · 发布到 GitHub ===' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host '未找到 git，请先安装 Git for Windows：https://git-scm.com/download/win' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
  git init -b main | Out-Null
  Write-Host '已初始化 git 仓库（分支 main）'
}

# 本机 schannel 连 GitHub 会报 SEC_E_NO_CREDENTIALS，改用 OpenSSL 后端（已实测可用）
git config --local http.sslBackend openssl
git config --local core.autocrlf false

$name = git config user.name
if (-not $name -and $GitName) {
  git config user.name $GitName
  $name = $GitName
}
if (-not $name) {
  if ([Console]::IsInputRedirected) {
    Write-Host 'No git username. Run: publish.cmd <username> <email> <repo-url>' -ForegroundColor Red
    exit 1
  }
  $name = Read-Host 'GitHub username (login name, e.g. octocat)'
  if ($name) { git config user.name $name }
}

$email = git config user.email
if (-not $email -and $GitEmail) {
  git config user.email $GitEmail
  $email = $GitEmail
}
if (-not $email) {
  if ([Console]::IsInputRedirected) {
    Write-Host 'No git email. Run: publish.cmd <username> <email> <repo-url>' -ForegroundColor Red
    exit 1
  }
  $email = Read-Host 'GitHub email (e.g. octocat@users.noreply.github.com)'
  if ($email) { git config user.email $email }
}

if (-not (git config user.name) -or -not (git config user.email)) {
  Write-Host 'Git identity is still empty. Set user.name / user.email and re-run.' -ForegroundColor Red
  exit 1
}

git -c core.autocrlf=false add -A
git rev-parse --verify HEAD *> $null
$hasHead = ($LASTEXITCODE -eq 0)
if (-not $hasHead) {
  git commit -m 'feat: initial release v1.0.2' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'git commit failed. Check user.name / user.email above.' -ForegroundColor Red
    exit 1
  }
  Write-Host '已创建首个提交'
} else {
  $dirty = git status --porcelain
  if ($dirty) {
    git commit -m 'chore: update project files' | Out-Null
    Write-Host '已提交本地改动'
  }
}

$branch = git branch --show-current
if (-not $branch) { $branch = 'main' }

$remote = ''
git remote get-url origin *> $null
if ($LASTEXITCODE -eq 0) { $remote = git remote get-url origin }

if (-not $remote) {
  if ($RepoUrl) {
    git remote add origin $RepoUrl
    if ($LASTEXITCODE -ne 0) { git remote set-url origin $RepoUrl }
    Write-Host "已设置远程仓库：$RepoUrl"
    $remote = $RepoUrl
  } else {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($gh) {
      Write-Host '检测到 GitHub CLI。' -ForegroundColor Green
      gh auth status *> $null
      if ($LASTEXITCODE -ne 0) {
        Write-Host '需要登录 GitHub（会打开浏览器）...'
        gh auth login
      }
      Write-Host '正在创建公开仓库 survey-autofill-helper ...'
      gh repo create survey-autofill-helper --public --source . --remote origin --push --description '一键填入问卷星 / 腾讯问卷 / WPS 表单的篡改猴脚本：模板化答案，只填不交'
      if ($LASTEXITCODE -ne 0) {
        Write-Host 'gh 创建仓库失败。可以改用网页方式：删掉刚创建的空仓库后重跑，或手动配置 remote。' -ForegroundColor Red
        exit 1
      }
      $remote = git remote get-url origin
    } else {
      Write-Host ''
      Write-Host '没有检测到 GitHub CLI，用浏览器建一个空仓库：' -ForegroundColor Yellow
      Write-Host '  1) 打开 https://github.com/new'
      Write-Host '  2) 仓库名填 survey-autofill-helper，选择 Public'
      Write-Host '  3) 不要勾选 README / .gitignore / License（本地已经有了）'
      Write-Host '  4) 建好后把仓库地址复制回来'
      Write-Host ''
      Start-Process 'https://github.com/new'
      if ([Console]::IsInputRedirected) {
        Write-Host 'No repo URL. Run: publish.cmd <username> <email> <repo-url>' -ForegroundColor Red
        exit 1
      }
      $remote = Read-Host 'Paste repo URL (https://github.com/<you>/survey-autofill-helper.git)'
      if (-not $remote) {
        Write-Host '没有提供仓库地址，已退出。' -ForegroundColor Red
        exit 1
      }
      git remote add origin $remote
    }
  }
}

Write-Host '正在推送（首次可能需要浏览器登录 GitHub）...'
git push -u origin $branch
if ($LASTEXITCODE -ne 0) {
  Write-Host '推送失败：确认网络、仓库地址和登录状态后重新运行本脚本。' -ForegroundColor Red
  exit 1
}

# 把占位符换成真实仓库地址，并补一次提交
$remote = (git remote get-url origin).Trim()
if ($remote -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/]+?)(\.git)?$') {
  $owner = $Matches['owner']
  $repo = $Matches['repo']

  foreach ($f in @('survey-autofill-helper.user.js', 'README.md', 'README.zh-CN.md')) {
    $p = Join-Path $repoRoot $f
    if (Test-Path -LiteralPath $p) {
      $t = [IO.File]::ReadAllText($p)
      $t = $t.Replace('__GITHUB_OWNER__', $owner).Replace('__REPO__', $repo)
      [IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))
    }
  }

  git -c core.autocrlf=false add -A
  $dirty = git status --porcelain
  if ($dirty) {
    git commit -m "chore: point userscript update URLs to $owner/$repo" | Out-Null
    git push
  }

  if (Get-Command gh -ErrorAction SilentlyContinue) {
    gh repo edit --add-topic tampermonkey,userscript,autofill,survey,forms,wjx,questionnaire,tencent-survey,wps-form,edge *> $null
    if (Test-Path -LiteralPath (Join-Path $repoRoot 'docs\release-notes-v1.0.2.md')) {
      gh release create v1.0.2 'survey-autofill-helper.user.js' --title 'v1.0.2 — WPS 表单支持' --notes-file 'docs\release-notes-v1.0.2.md' *> $null
    }
  }

  Write-Host ''
  Write-Host '发布完成。' -ForegroundColor Green
  Write-Host "仓库地址：https://github.com/$owner/$repo"
  Write-Host "安装地址：https://raw.githubusercontent.com/$owner/$repo/$branch/survey-autofill-helper.user.js"
  Write-Host ''
  Write-Host '还差一步（手动，2 分钟）：' -ForegroundColor Yellow
  Write-Host '  仓库页右上 About 齿轮 → 填描述 + Topics（文案见 docs/PUBLISH.md）'
} else {
  Write-Host '无法从 remote 解析 GitHub 仓库地址，请手动把 __GITHUB_OWNER__ / __REPO__ 替换后重新提交。' -ForegroundColor Yellow
}

try { Stop-Transcript | Out-Null } catch { }
Write-Host ''
