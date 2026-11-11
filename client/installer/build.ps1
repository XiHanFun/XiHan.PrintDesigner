# Copyright (c) 2021-Present XiHanFun and contributors.
# Licensed under the MIT License. See LICENSE in the project root for license information.

<#
.SYNOPSIS
  编译 Windows 安装包：构建窗口界面 → 按架构编译 XiHanPrint.exe → 可选签名 → Inno Setup 编译 → 算 SHA-256。

.PARAMETER Arch
  要打的架构，缺省 x64 与 arm64。

.PARAMETER Version
  版本号，缺省读 client/Cargo.toml 里 [workspace.package] 的 version。

.PARAMETER WebView2Installer
  打进安装包的 WebView2 安装程序：缺省下载微软的 Evergreen 引导程序；内网环境可传离线安装包的路径。

.PARAMETER SkipWebView2
  不打 WebView2 安装程序：只用于本机试装，或已确知装好运行时的环境；装到没有运行时的机器上时，HTML 打印与导出 PDF 不可用。

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
    [string] $SignCommand,
    [switch] $PublishOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$client = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $client 'artifacts'
$output = Join-Path $PSScriptRoot 'output'
$triples = @{ x64 = 'x86_64-pc-windows-msvc'; arm64 = 'aarch64-pc-windows-msvc' }

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
        if (-not $SkipWebView2) {
            $defines += "/DWebView2Installer=$(Get-WebView2Installer)"
        }
        if ($SignCommand) {
            $defines += '/DSignTool'
            $defines += "/Sxihan=$SignCommand"
        }
        & $iscc @defines (Join-Path $PSScriptRoot 'XiHanPrint.iss')
        if ($LASTEXITCODE -ne 0) { throw "安装包编译失败：$target" }

        $installer = Join-Path $output "XiHanPrint-$Version-$target-setup.exe"
        $hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $(Split-Path -Leaf $installer)" | Set-Content -Encoding ascii "$installer.sha256"
        Write-Host "安装包 $installer（$((Get-Item $installer).Length) 字节，SHA-256 $hash）"
    }
}
finally {
    Pop-Location
}
