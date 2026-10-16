; Copyright (c) 2021-Present XiHanFun and contributors.
; Licensed under the MIT License. See LICENSE in the project root for license information.

; 曦寒打印客户端安装包：按当前用户安装到 %LocalAppData%\Programs\XiHanFun\PrintClient，不要管理员权限。
; 由 build.ps1 调用 ISCC 编译，参数经 /D 传入：AppVersion、FileVersion、Arch、SourceDir、OutputDir，可选 WebView2Installer、SignTool。

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef FileVersion
  #define FileVersion "0.0.0.0"
#endif
#ifndef Arch
  #define Arch "x64"
#endif
#ifndef SourceDir
  #define SourceDir "..\artifacts\publish\win-" + Arch
#endif
#ifndef OutputDir
  #define OutputDir "output"
#endif

#define AppName "曦寒打印客户端"
#define AppExe "XiHanPrint.exe"
#define AppGuid "6B1D7A0E-3C2F-4E5B-9A8D-2F4C1E7B9D30"

[Setup]
AppId={{{#AppGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=XiHanFun
AppPublisherURL=https://www.xihanfun.com
AppSupportURL=https://github.com/XiHanFun/XiHan.PrintDesigner/issues
VersionInfoVersion={#FileVersion}
VersionInfoProductName={#AppName}
DefaultDirName={localappdata}\Programs\XiHanFun\PrintClient
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=XiHanPrint-{#AppVersion}-{#Arch}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
CloseApplications=no
RestartApplications=no
#ifdef SignTool
SignTool=xihan
SignedUninstaller=yes
#endif

[Languages]
#if FileExists(CompilerPath + "Languages\ChineseSimplified.isl")
Name: "zh"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
#else
Name: "zh"; MessagesFile: "compiler:Default.isl"
#endif

[CustomMessages]
zh.AutoStart=开机时自动启动曦寒打印客户端
zh.LaunchNow=启动曦寒打印客户端
zh.InstallingWebView2=正在安装 WebView2 运行时…
zh.WebView2Failed=WebView2 运行时没有装好，HTML 打印与导出 PDF 暂不可用，可以稍后再装。
zh.RemoveData=是否同时删除曦寒打印客户端的设置、来源名单与日志？

[Tasks]
Name: "autostart"; Description: "{cm:AutoStart}"; Check: not IsUpgrade

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifdef WebView2Installer
Source: "{#WebView2Installer}"; DestDir: "{tmp}"; DestName: "WebView2Setup.exe"; Flags: ignoreversion; Check: NeedsWebView2
#endif

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchNow}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: LaunchRequested

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\XiHanFun\PrintClient\webview"
Type: filesandordirs; Name: "{localappdata}\XiHanFun\PrintClient\updates"

[Code]
const
  WebView2Client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  RunValue = 'XiHanPrint';

var
  Upgrading: Boolean;
  HadAutoStart: Boolean;

{ 已装过本程序时为真：升级时不再问开机自启，沿用原来的设置 }
function IsUpgrade: Boolean;
begin
  Result := Upgrading;
end;

{ 机器级或当前用户级装了 WebView2 Evergreen 运行时 }
function WebView2Installed: Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2Client, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\' + WebView2Client, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function NeedsWebView2: Boolean;
begin
  Result := not WebView2Installed;
end;

{ 命令行带 /LAUNCH 时装完启动客户端：客户端自动更新时用 }
function LaunchRequested: Boolean;
var
  Index: Integer;
begin
  Result := False;
  for Index := 1 to ParamCount do
    if CompareText(ParamStr(Index), '/LAUNCH') = 0 then
      Result := True;
end;

{ 结束正在运行的客户端及其渲染进程 }
procedure StopClient;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function InitializeSetup: Boolean;
begin
  Upgrading := RegKeyExists(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{#AppGuid}}_is1');
  HadAutoStart := RegValueExists(HKCU, RunKey, RunValue);
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopClient;
  Sleep(500);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
begin
  if CurStep <> ssPostInstall then
    Exit;
  if (Upgrading and HadAutoStart) or ((not Upgrading) and WizardIsTaskSelected('autostart')) then
    RegWriteStringValue(HKCU, RunKey, RunValue, '"' + ExpandConstant('{app}\{#AppExe}') + '" --autostart');
#ifdef WebView2Installer
  if NeedsWebView2 then
  begin
    WizardForm.StatusLabel.Caption := CustomMessage('InstallingWebView2');
    if (not Exec(ExpandConstant('{tmp}\WebView2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code)) or (Code <> 0) then
      if not WizardSilent then
        MsgBox(CustomMessage('WebView2Failed'), mbInformation, MB_OK);
  end;
#endif
end;

function InitializeUninstall: Boolean;
begin
  StopClient;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RegDeleteValue(HKCU, RunKey, RunValue);
  if CurUninstallStep <> usPostUninstall then
    Exit;
  if UninstallSilent or (MsgBox(CustomMessage('RemoveData'), mbConfirmation, MB_YESNO) = IDYES) then
  begin
    DelTree(ExpandConstant('{userappdata}\XiHanFun\PrintClient'), True, True, True);
    DelTree(ExpandConstant('{localappdata}\XiHanFun\PrintClient'), True, True, True);
    RemoveDir(ExpandConstant('{userappdata}\XiHanFun'));
    RemoveDir(ExpandConstant('{localappdata}\XiHanFun'));
  end;
  RemoveDir(ExpandConstant('{localappdata}\Programs\XiHanFun'));
end;
