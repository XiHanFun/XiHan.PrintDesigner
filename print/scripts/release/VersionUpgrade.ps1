<#
  Copyright (c) 2021-Present XiHanFun and contributors.
  Licensed under the MIT License. See LICENSE in the project root for license information.
#>

# 把三个公开包的版本一起抬到下一个号，顺带把变更集收成各包的 CHANGELOG。
# 不提交、不打标签、不推送；发布由 .github/workflows/release.yml 在 main 上的 v* 标签触发。
# 参数都不给时逐项询问；给了的那项不再问。-DryRun 只打印这一次会做什么，不改任何文件。
#
#   -Level   derived | major | minor | patch     derived 按变更集推导；其余补一份合成变更集，要同时给 -Reason
#   -Reason  强制级别的理由，写进合成变更集，会进 CHANGELOG
#   -Channel keep | alpha | beta | rc | release   发布通道：保持当前、进入预发布通道、或退出预发布转正式版
#   -Yes     不再询问最后的确认
#   -DryRun  只打印计划
param(
    [ValidateSet('derived', 'major', 'minor', 'patch')]
    [string]$Level,
    [string]$Reason,
    [ValidateSet('keep', 'alpha', 'beta', 'rc', 'release')]
    [string]$Channel,
    [switch]$Yes,
    [switch]$DryRun
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

# 脚本在 <工作区>/scripts/release 下，工作区根在上两级，仓库名在上三级
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$repositoryName = Split-Path (Resolve-Path (Join-Path $workspaceRoot '..')).Path -Leaf
Set-Location $workspaceRoot

Write-Output ""
Write-Output "========================================"
Write-Output " VersionUpgrade - $repositoryName$(if ($DryRun) { '（DryRun）' })"
Write-Output "========================================"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "找不到 pnpm，请先安装：npm i -g pnpm"
}

# Windows PowerShell 5.1 的 Get-Content 缺省按 ANSI 读，这里一律按 UTF-8 显式读
function Read-JsonFile([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Invoke-Checked([string]$Description, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Write-Error "$Description 失败"
    }
}

# 版本真源取 core：三个公开包锁步同版
$corePackagePath = Join-Path $workspaceRoot 'packages\core\package.json'
$currentVersion = (Read-JsonFile $corePackagePath).version
Write-Output "当前版本：$currentVersion"

Invoke-Checked '锁步核对（公开包版本必须一致）' { node scripts/release/check-version-lock.mjs }

$prePath = Join-Path $workspaceRoot '.changeset\pre.json'
$preTag = $null
if (Test-Path $prePath) {
    $preTag = (Read-JsonFile $prePath).tag
    Write-Output "发布通道：预发布 $preTag（.changeset/pre.json 存在）"
}
else {
    Write-Output "发布通道：正式（没有 .changeset/pre.json）"
}

$changesets = @(Get-ChildItem (Join-Path $workspaceRoot '.changeset') -Filter *.md -File | Where-Object { $_.Name -ne 'README.md' })
Write-Output "待消费的变更集：$($changesets.Count) 份$(if ($changesets.Count -gt 0) { '（' + (($changesets | ForEach-Object { $_.Name }) -join '、') + '）' })"

# 变更集推导出的下一个号：--output 只写 JSON，不改任何文件
$planPath = Join-Path ([System.IO.Path]::GetTempPath()) "$repositoryName-release-plan.json"
if (Test-Path $planPath) { Remove-Item $planPath -Force }
& pnpm exec changeset status --output $planPath | Out-Null
$derivedVersion = $null
$derivedType = $null
if (Test-Path $planPath) {
    $plan = Read-JsonFile $planPath
    $bumping = @($plan.releases | Where-Object { $_.type -ne 'none' })
    if ($bumping.Count -gt 0) {
        $derivedVersion = $bumping[0].newVersion
        $derivedType = $bumping[0].type
    }
    Remove-Item $planPath -Force
}
if ($derivedVersion) {
    Write-Output "按变更集推导：$currentVersion -> $derivedVersion（$derivedType）"
}
else {
    Write-Output "按变更集推导：没有待发布的变更"
}

# ── 发布通道 ──
if (-not $Channel) {
    Write-Output ""
    Write-Output "请选择发布通道："
    Write-Output "0: 保持当前$(if ($preTag) { "（$preTag）" } else { '（正式）' })"
    Write-Output "1: 开发版 alpha，如 1.1.0-alpha.0"
    Write-Output "2: 测试版 beta，如 1.1.0-beta.0"
    Write-Output "3: 候选版 rc，如 1.1.0-rc.0"
    Write-Output "4: 正式版，如 1.1.0"
    switch (Read-Host ">>> 请选择发布通道 (0-4)") {
        '0' { $Channel = 'keep' }
        '1' { $Channel = 'alpha' }
        '2' { $Channel = 'beta' }
        '3' { $Channel = 'rc' }
        '4' { $Channel = 'release' }
        default { Write-Output "退出"; exit }
    }
}

# ── 升级级别 ──
if (-not $Level) {
    Write-Output ""
    Write-Output "请选择升级级别："
    Write-Output "0: 退出"
    Write-Output "1: 按变更集推导$(if ($derivedVersion) { "（$derivedVersion）" })"
    Write-Output "2: 主版本（公开面被删除或改名、旧模板读不进来时才用）"
    Write-Output "3: 次版本"
    Write-Output "4: 修订版本"
    switch (Read-Host ">>> 请选择升级级别 (0-4)") {
        '1' { $Level = 'derived' }
        '2' { $Level = 'major' }
        '3' { $Level = 'minor' }
        '4' { $Level = 'patch' }
        default { Write-Output "退出"; exit }
    }
}

$forcedLevel = $null
# 预发布期间的变更集记在 .changeset/pre.json 里，退出预发布时由它们定正式版号，没有新的变更集也能继续
$exitingPre = $preTag -and $Channel -eq 'release'
if ($Level -eq 'derived') {
    if (-not $derivedVersion -and -not $exitingPre) {
        Write-Output "没有待发布的变更，无从推导。退出"
        exit
    }
}
else {
    $forcedLevel = $Level
    # changesets 取全部变更集里最高的一级，补进来的级别低于已有的就不起作用
    $rank = @{ patch = 1; minor = 2; major = 3 }
    if ($derivedType -and $rank[$forcedLevel] -lt $rank[$derivedType]) {
        Write-Output "已有变更集里最高是 $derivedType，补一份 $forcedLevel 不会把号降下来。退出"
        exit
    }
    if ([string]::IsNullOrWhiteSpace($Reason)) {
        $Reason = Read-Host ">>> 这一版为什么是 $forcedLevel（这句会进 CHANGELOG）"
    }
    if ([string]::IsNullOrWhiteSpace($Reason)) {
        Write-Output "没有写理由，退出"
        exit
    }
}

# 通道要做的 changeset pre 动作：进入新的预发布通道、换通道（先退再进）或退出
$preActions = @()
if ($Channel -eq 'release') {
    if ($preTag) { $preActions += , @('exit') }
}
elseif ($Channel -ne 'keep' -and $preTag -ne $Channel) {
    if ($preTag) { $preActions += , @('exit') }
    $preActions += , @('enter', $Channel)
}

$targetChannel = $preTag
if ($Channel -eq 'release') { $targetChannel = $null }
elseif ($Channel -ne 'keep') { $targetChannel = $Channel }

Write-Output ""
Write-Output "计划："
if ($forcedLevel) { Write-Output "  - 补一份合成变更集：$forcedLevel，理由「$Reason」" }
foreach ($action in $preActions) { Write-Output "  - pnpm exec changeset pre $($action -join ' ')" }
Write-Output "  - pnpm run version（消费变更集、改三个包的 version、写各包 CHANGELOG、删掉用掉的变更集）"
$expected = if ($forcedLevel) { "按 $forcedLevel 提升" } elseif ($derivedVersion) { $derivedVersion } else { "按预发布期间的变更集定正式版号（去掉 -$preTag.N）" }
Write-Output "  - 版本：$currentVersion -> $expected$(if ($targetChannel) { "，带预发布后缀 -$targetChannel.N，npm dist-tag 为 $targetChannel" } else { '，正式版' })"

if ($DryRun) {
    Write-Output ""
    Write-Output "DryRun：没有改任何文件"
    exit
}

if (-not $Yes) {
    $confirm = Read-Host ">>> 确认执行 (Y|y / N|n)"
    if ($confirm -notin @('Y', 'y')) {
        Write-Output "取消"
        exit
    }
}

if ($forcedLevel) {
    $synthetic = Join-Path $workspaceRoot ".changeset\version-upgrade-$forcedLevel.md"
    $coreName = (Read-JsonFile $corePackagePath).name
    $body = "---`n`"$coreName`": $forcedLevel`n---`n`n$Reason`n"
    [System.IO.File]::WriteAllText($synthetic, $body, (New-Object System.Text.UTF8Encoding $false))
    Write-Output "已写入合成变更集：$synthetic"
}
foreach ($action in $preActions) {
    Invoke-Checked "changeset pre $($action -join ' ')" { pnpm exec changeset pre @action }
}
Invoke-Checked 'changeset version' { pnpm run version }

$newVersion = (Read-JsonFile $corePackagePath).version
Invoke-Checked '升级之后的锁步核对' { node scripts/release/check-version-lock.mjs }

Write-Output ""
Write-Output "版本已升到：$newVersion"
Write-Output ""
Write-Output "========================================"
Write-Output " 接下来（脚本不做，请手工确认后执行）"
Write-Output "========================================"
Write-Output "1. 检查改动：git status / git diff（三个包的 package.json 与 CHANGELOG.md、.changeset/）"
# 文档站的更新日志页在首发那一笔新建
$changelogPath = Join-Path $workspaceRoot '..\docs\changelog.md'
if (Test-Path $changelogPath) {
    Write-Output "2. 补文档站 docs/changelog.md 的 v$newVersion 一节，跑工作区与文档站的门禁"
}
else {
    Write-Output "2. 新建文档站 docs/changelog.md（首发）并加进导航，写 v$newVersion 一节，跑工作区与文档站的门禁"
}
Write-Output "3. 提交：git commit -m `"build: v$newVersion`""
Write-Output "4. 合进 main：release.yml 只放行 main 历史里的标签"
Write-Output "5. 打标签并推送：git tag v$newVersion; git push origin v$newVersion"
Write-Output "   -> Release 工作流核对标签、构建、核对产物、发到 npm、冒烟，再部署文档站"
Write-Output ""
