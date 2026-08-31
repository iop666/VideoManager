; VideoManager 安装版脚本（Inno Setup）
; 编译: ISCC.exe VideoManager-installer.iss
; 源码: desktop/dist/win-unpacked （electron-builder --win dir 产物）

#define MyAppName "VideoManager"
#define MyAppVersion "0.4.0"
#define MyAppPublisher "VideoManager"
#define MyAppExeName "VideoManager.exe"
;#define WinUnpacked "D:\DeepseekHarness\VideoManager\desktop\dist\win-unpacked"

[Setup]
AppId={{8F2E3C4A-5B6D-4E7F-9A1B-2C3D4E5F6A7B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=D:\DeepseekHarness\VideoManager_issue\0.4.0\Windows安装软件
OutputBaseFilename=VideoManager-{#MyAppVersion}-setup
SetupIconFile=D:\DeepseekHarness\VideoManager\desktop\resources\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
; 安装到 Program Files 不可写，数据目录自动回退 APPDATA（应用内已处理）

[Languages]
Name: "chinesesimplified"; MessagesFile: "D:\Windows\AI-Agent\Tools\InnoSetup\Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 打包 win-unpacked 全部内容
Source: "D:\DeepseekHarness\VideoManager\desktop\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 清理用户数据（绿色数据目录在 exe 旁或 APPDATA）
Type: filesandordirs; Name: "{app}\data"
