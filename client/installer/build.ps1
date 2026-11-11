# Copyright (c) 2021-Present XiHanFun and contributors.
# Licensed under the MIT License. See LICENSE in the project root for license information.

<#
.SYNOPSIS
  编译 Windows 安装包：构建窗口界面 → 按架构编译 XiHanPrint.exe → 可选签名 → Inno Setup 编译在线安装包（给了固定版运行时的架构再编离线安装包）→ 算 SHA-256。

.PARAMETER Arch
  要打的架构，缺省 x64 与 arm64。

.PARAMETER Version
  版本号，缺省读 client/Cargo.toml 里 [workspace.package] 的 version。

.PARAMETER WebView2Installer
  打进在线安装包的 WebView2 安装程序：缺省下载微软的 Evergreen 引导程序；内网环境可传 Evergreen 独立安装程序的路径。

.PARAMETER SkipWebView2
  在线安装包不打 WebView2 安装程序：只用于本机试装，或已确知装好运行时的环境；装到没有运行时的机器上时，HTML 打印与导出 PDF 不可用。

.PARAMETER WebView2FixedRuntime
  按架构给 WebView2 固定版运行时，如 @{ x64 = 'Microsoft.WebView2.FixedVersionRuntime.157.0.4341.46.x64.cab'; arm64 = 'D:\webview2\arm64' }：
  值是微软发布的 .cab（用 expand.exe 解开），或已解开的目录（目录本身或它唯一的子目录里有 msedgewebview2.exe）。
  给了的架构在在线安装包之外再出离线安装包 XiHanPrint-<版本>-<架构>-offline-setup.exe：运行时装到安装目录的 WebView2 子目录，不装 Evergreen 运行时，安装时不联网。
  编译前核对 msedgewebview2.exe 的签名是微软、架构与安装包相同。

.PARAMETER SignCommand
  签名命令，文件路径用 $f 占位，如 signtool sign /f cert.pfx /p ****** /fd sha256 /tr http://timestamp.digicert.com /td sha256 $f；为空不签名。

.PARAMETER PublishOnly
  只编译程序，不编译安装包。
#>
[CmdletBinding()]
param(
    [ValidateSet('x64', 'arm64')]
    [string[]] $Arch = @('x64', 'arm64'),
    [string] $Version,
    [string] $WebView2Installer,
    [switch] $SkipWebView2,
    [hashtable] $WebView2FixedRuntime = @{},
    [string] $SignCommand,
    [switch] $PublishOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$client = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $client 'artifacts'
$output = Join-Path $PSScriptRoot 'output'
$triples = @{ x64 = 'x86_64-pc-windows-msvc'; arm64 = 'aarch64-pc-windows-msvc' }
$machines = @{ x64 = 0x8664; arm64 = 0xAA64 }

foreach ($target in $WebView2FixedRuntime.Keys) {
    if ($target -notin $Arch) { throw "-WebView2FixedRuntime 给了 $target，但 -Arch 里没有这个架构" }
}
if ($PublishOnly -and $WebView2FixedRuntime.Count -gt 0) { throw '-PublishOnly 不编译安装包，不能同时给 -WebView2FixedRuntime' }

if (-not $Version) {
    $manifest = Get-Content (Join-Path $client 'Cargo.toml') -Raw
    if ($manifest -notmatch '(?ms)^\[workspace\.package\].*?^version\s*=\s*"([^"]+)"') {
        throw '在 client/Cargo.toml 里找不到 [workspace.package] 的 version'
    }
    $Version = $Matches[1]
}
if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$') {
    throw "版本号写法不对：$Version"
}
$fileVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"

function Invoke-Checked([string] $what, [scriptblock] $command) {
    & $command
    if ($LASTEXITCODE -ne 0) { throw "$what 失败（退出码 $LASTEXITCODE）" }
}

function Invoke-Sign([string] $path) {
    if (-not $SignCommand) { return }
    $command = $SignCommand.Replace('$f', "`"$path`"")
    Write-Host "签名 $path"
    & cmd /c $command
    if ($LASTEXITCODE -ne 0) { throw "签名失败：$path" }
}

function Find-Iscc {
    $command = Get-Command iscc -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")) {
        if (Test-Path $candidate) { return $candidate }
    }
    throw '找不到 Inno Setup 6 的 ISCC.exe'
}

function Get-WebView2Installer {
    if ($WebView2Installer) { return (Resolve-Path $WebView2Installer).Path }
    $path = Join-Path $artifacts 'webview2/MicrosoftEdgeWebview2Setup.exe'
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
        Write-Host '下载 WebView2 Evergreen 引导程序'
        Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $path
    }
    $signature = Get-AuthenticodeSignature $path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        Remove-Item $path
        throw "WebView2 引导程序的签名不对：$($signature.Status) $($signature.SignerCertificate.Subject)"
    }
    return $path
}

# PE 文件头里的处理器类型
function Get-PeMachine([string] $path) {
    $stream = [IO.File]::OpenRead($path)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        $stream.Position = 0x3C
        $stream.Position = $reader.ReadInt32() + 4
        return $reader.ReadUInt16()
    }
    finally {
        $stream.Dispose()
    }
}

# 解开（给的是 .cab 时）并核对一个架构的 WebView2 固定版运行时，返回直接装着 msedgewebview2.exe 的目录
function Get-WebView2FixedRuntime([string] $target, [string] $source) {
    $source = (Resolve-Path $source).Path
    $directory = $source
    if (Test-Path $source -PathType Leaf) {
        $directory = Join-Path $artifacts "webview2/fixed-$target"
        if (Test-Path $directory) { Remove-Item -Recurse -Force $directory }
        New-Item -ItemType Directory -Force $directory | Out-Null
        Write-Host "解开 WebView2 固定版运行时 $source"
        Invoke-Checked "解开 $source" { expand.exe $source -F:* $directory | Out-Null }
    }
    $root = $directory
    if (-not (Test-Path (Join-Path $root 'msedgewebview2.exe') -PathType Leaf)) {
        $found = @(Get-ChildItem $directory -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'msedgewebview2.exe') -PathType Leaf })
        if ($found.Count -ne 1) { throw "在 $source 里找不到 WebView2 固定版运行时：目录本身或它唯一的子目录里要有 msedgewebview2.exe" }
        $root = $found[0].FullName
    }
    $browser = Join-Path $root 'msedgewebview2.exe'
    $signature = Get-AuthenticodeSignature $browser
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        $signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '没有签名者' }
        throw "WebView2 固定版运行时的签名不对：$browser $($signature.Status) $signer"
    }
    $machine = Get-PeMachine $browser
    if ($machine -ne $machines[$target]) {
        throw ('WebView2 固定版运行时的架构不是 {0}：{1} 的处理器类型是 0x{2:X4}' -f $target, $browser, $machine)
    }
    Write-Host "WebView2 固定版运行时 $target $((Get-Item $browser).VersionInfo.FileVersion)：$root"
    return $root
}

function New-Installer([string] $iscc, [string[]] $defines, [string] $name) {
    & $iscc @defines (Join-Path $PSScriptRoot 'XiHanPrint.iss')
    if ($LASTEXITCODE -ne 0) { throw "安装包编译失败：$name" }
    $installer = Join-Path $output $name
    $hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $name" | Set-Content -Encoding ascii "$installer.sha256"
    Write-Host "安装包 $installer（$((Get-Item $installer).Length) 字节，SHA-256 $hash）"
}

$fixedRuntimes = @{}
foreach ($target in $WebView2FixedRuntime.Keys) {
    $fixedRuntimes[$target] = Get-WebView2FixedRuntime $target $WebView2FixedRuntime[$target]
}

Push-Location $client
try {
    Write-Host '构建窗口界面'
    Invoke-Checked 'pnpm install' { pnpm install --frozen-lockfile }
    Invoke-Checked '构建窗口界面' { pnpm build }

    foreach ($target in $Arch) {
        $triple = $triples[$target]
        $publish = Join-Path $artifacts "publish/win-$target"
        if (Test-Path $publish) { Remove-Item -Recurse -Force $publish }
        New-Item -ItemType Directory -Force $publish | Out-Null
        Write-Host "编译 $triple $Version"
        Invoke-Checked "编译 $triple" { rustup target add $triple }
        Invoke-Checked "编译 $triple" { cargo build --release --locked -p xihan-print-client --features custom-protocol --target $triple }
        Copy-Item (Join-Path $client "target/$triple/release/XiHanPrint.exe") $publish
        Invoke-Sign (Join-Path $publish 'XiHanPrint.exe')
        if ($PublishOnly) { continue }

        $iscc = Find-Iscc
        $defines = @(
            "/DAppVersion=$Version",
            "/DFileVersion=$fileVersion",
            "/DArch=$target",
            "/DSourceDir=$publish",
            "/DOutputDir=$output"
        )
        if ($SignCommand) {
            $defines += '/DSignTool'
            $defines += "/Sxihan=$SignCommand"
        }
        $online = $defines
        if (-not $SkipWebView2) {
            $online += "/DWebView2Installer=$(Get-WebView2Installer)"
        }
        New-Installer $iscc $online "XiHanPrint-$Version-$target-setup.exe"
        if ($fixedRuntimes.ContainsKey($target)) {
            New-Installer $iscc ($defines + "/DWebView2FixedRuntime=$($fixedRuntimes[$target])") "XiHanPrint-$Version-$target-offline-setup.exe"
        }
    }
}
finally {
    Pop-Location
}
