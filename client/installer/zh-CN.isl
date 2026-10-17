; Copyright (c) 2021-Present XiHanFun and contributors.
; Licensed under the MIT License. See LICENSE in the project root for license information.

; 安装包的简体中文：叠在 compiler:Default.isl 之上，只覆写这个安装包在安装、升级、卸载与出错时会出现的消息，
; 其余不会出现的消息沿用英文。不要给原文没有句号的消息加句号，Inno Setup 会自己补。

[LangOptions]
LanguageName=简体中文
LanguageID=$0804
LanguageCodePage=0

[Messages]

; 标题
SetupAppTitle=安装
SetupWindowTitle=安装 - %1
UninstallAppTitle=卸载
UninstallAppFullTitle=卸载 %1
InformationTitle=提示
ConfirmTitle=确认
ErrorTitle=出错

; 启动时
LdrCannotCreateTemp=无法创建临时文件，安装已中止
LdrCannotExecTemp=无法运行临时目录里的文件，安装已中止
LastErrorMessage=%1。%n%n错误 %2：%3
SetupFileMissing=安装目录里缺少文件 %1。请重新下载安装包。
SetupFileCorrupt=安装文件已损坏。请重新下载安装包。
SetupFileCorruptOrWrongVer=安装文件已损坏，或与这个版本的安装程序不匹配。请重新下载安装包。
InvalidParameter=命令行参数无效：%n%n%1
SetupAlreadyRunning=安装程序已在运行。
WindowsVersionNotSupported=这个程序不支持当前的 Windows 版本。
OnlyOnTheseArchitectures=这个程序只能装在以下处理器架构的 Windows 上：%n%n%1
WinVersionTooLowError=这个程序需要 %1 %2 或更高版本。
WinVersionTooHighError=这个程序不能装在 %1 %2 或更高版本上。

; 常见错误
ErrorCreatingDir=无法创建文件夹“%1”
ErrorTooManyFilesInDir=文件夹“%1”里的文件太多，无法再创建文件

; 退出确认
ExitSetupTitle=退出安装
ExitSetupMessage=安装还没有完成。现在退出，程序不会装好。%n%n以后可以再运行安装程序完成安装。%n%n确定退出吗？

; 按钮
ButtonBack=< 上一步(&B)
ButtonNext=下一步(&N) >
ButtonInstall=安装(&I)
ButtonOK=确定
ButtonCancel=取消
ButtonYes=是(&Y)
ButtonYesToAll=全部是(&A)
ButtonNo=否(&N)
ButtonNoToAll=全部否(&O)
ButtonFinish=完成(&F)

ClickNext=点「下一步」继续，点「取消」退出安装。

; 选择任务
WizardSelectTasks=选择附加任务
SelectTasksDesc=要执行哪些附加任务？
SelectTasksLabel2=选择安装 [name] 时要执行的附加任务，然后点「下一步」。

; 磁盘空间
DiskSpaceWarningTitle=磁盘空间不足
DiskSpaceWarning=安装至少需要 %1 KB 可用空间，所选磁盘只有 %2 KB。%n%n仍要继续吗？

; 准备安装
WizardPreparing=准备安装
PreparingDesc=正在准备在这台电脑上安装 [name]。
PreviousInstallNotCompleted=之前有程序的安装或卸载没有完成，需要重启电脑才能完成。%n%n重启后请再运行安装程序，完成 [name] 的安装。
CannotContinue=安装无法继续。请点「取消」退出。
PrepareToInstallNeedsRestart=安装程序需要重启电脑。重启后请再运行安装程序，完成 [name] 的安装。%n%n现在重启吗？

; 正在安装
WizardInstalling=正在安装
InstallingLabel=正在把 [name] 装到这台电脑上，请稍候。

; 安装完成
FinishedHeadingLabel=[name] 安装完成
FinishedLabelNoIcons=[name] 已装好。
FinishedLabel=[name] 已装好，可以从开始菜单打开。
ClickFinish=点「完成」退出安装。
FinishedRestartLabel=需要重启电脑才能完成 [name] 的安装。现在重启吗？
FinishedRestartMessage=需要重启电脑才能完成 [name] 的安装。%n%n现在重启吗？
YesRadio=是，现在重启(&Y)
NoRadio=否，稍后自己重启(&N)

; 安装过程中出错
SetupAborted=安装没有完成。%n%n请处理好问题后再运行安装程序。
AbortRetryIgnoreSelectAction=选择操作
AbortRetryIgnoreRetry=重试(&T)
AbortRetryIgnoreIgnore=忽略这个错误并继续(&I)
AbortRetryIgnoreCancel=取消安装
RetryCancelSelectAction=选择操作
RetryCancelRetry=重试(&T)
RetryCancelCancel=取消

; 安装进度
StatusClosingApplications=正在关闭程序...
StatusCreateDirs=正在创建文件夹...
StatusExtractFiles=正在解压文件...
StatusCreateRegistryEntries=正在写入注册表...
StatusSavingUninstall=正在保存卸载信息...
StatusRunProgram=正在完成安装...
StatusRollback=正在撤销更改...

; 其他错误
ErrorInternal2=内部错误：%1
ErrorFunctionFailedNoCode=%1 失败
ErrorFunctionFailed=%1 失败，错误码 %2
ErrorFunctionFailedWithMessage=%1 失败，错误码 %2。%n%3
ErrorExecutingProgram=无法运行文件：%n%1
ErrorRegOpenKey=打开注册表项出错：%n%1\%2
ErrorRegCreateKey=创建注册表项出错：%n%1\%2
ErrorRegWriteKey=写入注册表项出错：%n%1\%2

; 复制文件出错
FileAbortRetryIgnoreSkipNotRecommended=跳过这个文件（不建议）(&S)
FileAbortRetryIgnoreIgnoreNotRecommended=忽略这个错误并继续（不建议）(&I)
SourceIsCorrupted=源文件已损坏
SourceDoesntExist=源文件“%1”不存在
ExistingFileReadOnly2=已有的文件是只读的，无法替换。
ExistingFileReadOnlyRetry=去掉只读属性后重试(&R)
ExistingFileReadOnlyKeepExisting=保留已有的文件(&K)
ErrorReadingExistingDest=读取已有的文件时出错：
ErrorChangingAttr=更改已有文件的属性时出错：
ErrorCreatingTemp=在安装目录里创建文件时出错：
ErrorReadingSource=读取源文件时出错：
ErrorCopying=复制文件时出错：
ErrorReplacingExistingFile=替换已有的文件时出错：
ErrorRestartReplace=重启后替换文件失败：
ErrorRenamingTemp=在安装目录里重命名文件时出错：

; 装完之后
ErrorRestartingComputer=安装程序无法重启电脑，请手动重启。

; 卸载
UninstallNotFound=文件“%1”不存在，无法卸载。
UninstallOpenError=无法打开文件“%1”，无法卸载
UninstallUnsupportedVer=卸载程序不认识卸载记录“%1”的格式，无法卸载
UninstallUnknownEntry=卸载记录里有无法识别的条目（%1）
ConfirmUninstall=确定要从这台电脑上完全删除 %1 吗？
UninstallOnlyOnWin64=只能在 64 位 Windows 上卸载。
UninstallStatusLabel=正在从这台电脑上删除 %1，请稍候。
UninstalledAll=%1 已从这台电脑上删除。
UninstalledMost=%1 已卸载。%n%n有些内容没能删除，可以手动删除。
UninstalledAndNeedsRestart=需要重启电脑才能完成 %1 的卸载。%n%n现在重启吗？
UninstallDataCorrupted=文件“%1”已损坏，无法卸载
WizardUninstalling=卸载进度
StatusUninstalling=正在卸载 %1...

; 关机时
ShutdownBlockReasonInstallingApp=正在安装 %1。
ShutdownBlockReasonUninstallingApp=正在卸载 %1。
