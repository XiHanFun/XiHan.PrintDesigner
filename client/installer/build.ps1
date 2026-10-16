# Copyright (c) 2021-Present XiHanFun and contributors.
# Licensed under the MIT License. See LICENSE in the project root for license information.

<#
.SYNOPSIS
  发布客户端并编译安装包：自包含发布 → 可选签名 → Inno Setup 编译 → 算 SHA-256 → 可选生成更新清单。

.PARAMETER Arch
  要打的架构，缺省 x64 与 arm64。

.PARAMETER Version
  版本号，缺省读 client/Directory.Build.props 的 Version。

.PARAMETER WebView2Installer
  打进安装包的 WebView2 安装程序：缺省下载微软的 Evergreen 引导程序；内网环境可传离线安装包的路径。

.PARAMETER SignCommand
  签名命令，文件路径用 $f 占位，如 signtool sign /f cert.pfx /p ****** /fd sha256 /tr http://timestamp.digicert.com /td sha256 $f；为空不签名。

.PARAMETER ReleaseBaseUrl
  安装包的下载地址前缀；给出时在输出目录生成 update.json。

.PARAMETER NotesFile
  发布说明文件，写进 update.json。

.PARAMETER PublishOnly
  只发布，不编译安装包。
#>
[CmdletBinding()]
param(
    [ValidateSet('x64', 'arm64')]
    [string[]] $Arch = @('x64', 'arm64'),
    [string] $Version,
    [string] $WebView2Installer,
    [string] $SignCommand,
    [string] $ReleaseBaseUrl,
    [string] $NotesFile,
    [switch] $PublishOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$client = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $client 'artifacts'
$output = Join-Path $PSScriptRoot 'output'
$project = Join-Path $client 'src/XiHan.PrintClient/XiHan.PrintClient.csproj'

if (-not $Version) {
    $Version = ([xml](Get-Content (Join-Path $client 'Directory.Build.props') -Raw)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
}
if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$') {
    throw "版本号写法不对：$Version"
}
$fileVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"

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

$assets = @()
foreach ($target in $Arch) {
    $publish = Join-Path $artifacts "publish/win-$target"
    if (Test-Path $publish) { Remove-Item -Recurse -Force $publish }
    Write-Host "发布 win-$target $Version"
    dotnet publish $project -c Release -r "win-$target" -o $publish "-p:Version=$Version"
    if ($LASTEXITCODE -ne 0) { throw "发布失败：win-$target" }
    Get-ChildItem $publish -File | Where-Object { $_.Name -like 'XiHanPrint.exe' -or $_.Name -like 'XiHan.PrintClient*.dll' -or $_.Name -like 'XiHanPrint.dll' } | ForEach-Object { Invoke-Sign $_.FullName }
    if ($PublishOnly) { continue }

    $iscc = Find-Iscc
    $defines = @(
        "/DAppVersion=$Version",
        "/DFileVersion=$fileVersion",
        "/DArch=$target",
        "/DSourceDir=$publish",
        "/DOutputDir=$output",
        "/DWebView2Installer=$(Get-WebView2Installer)"
    )
    if ($SignCommand) {
        $defines += '/DSignTool'
        $defines += "/Sxihan=$SignCommand"
    }
    & $iscc @defines (Join-Path $PSScriptRoot 'XiHanPrint.iss')
    if ($LASTEXITCODE -ne 0) { throw "安装包编译失败：$target" }

    $installer = Join-Path $output "XiHanPrint-$Version-$target-setup.exe"
    $hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path -Leaf $installer)" | Set-Content -Encoding ascii "$installer.sha256"
    $assets += [ordered]@{ arch = $target; file = (Split-Path -Leaf $installer); sha256 = $hash; size = (Get-Item $installer).Length }
    Write-Host "安装包 $installer（$((Get-Item $installer).Length) 字节，SHA-256 $hash）"
}

if ($ReleaseBaseUrl -and $assets.Count -gt 0) {
    $notes = if ($NotesFile) { Get-Content $NotesFile -Raw } else { $null }
    $manifest = [ordered]@{
        version = $Version
        notes = $notes
        assets = @($assets | ForEach-Object { [ordered]@{ arch = $_.arch; url = "$($ReleaseBaseUrl.TrimEnd('/'))/$($_.file)"; sha256 = $_.sha256; size = $_.size } })
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM (Join-Path $output 'update.json')
    Write-Host "更新清单 $(Join-Path $output 'update.json')"
}
