; VideoManager installer script (Inno Setup)
; Usage:
;   ISCC.exe "/DVmRoot=<repo root>" "/DIssueOut=<output dir>" "/DInnoLang=<Inno Setup Languages dir>" VideoManager-installer.iss
; Source tree: <VmRoot>\desktop\dist\win-unpacked  (electron-builder --win dir output)

#ifndef VmRoot
#define VmRoot "..\.."
#endif
#ifndef IssueOut
#define IssueOut "output"
#endif
#ifndef InnoLang
#define InnoLang ""
#endif

#define MyAppName "VideoManager"
#define MyAppVersion "0.6.0"
#define MyAppPublisher "VideoManager"
#define MyAppExeName "VideoManager.exe"

[Setup]
AppId={{8F2E3C4A-5B6D-4E7F-9A1B-2C3D4E5F6A7B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#IssueOut}
OutputBaseFilename=VideoManager-{#MyAppVersion}-setup
SetupIconFile={#VmRoot}\desktop\resources\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
; Data dir under Program Files is not writable - app falls back to APPDATA automatically

[Languages]
Name: "chinesesimplified"; MessagesFile: "{#InnoLang}\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Package all content of win-unpacked
Source: "{#VmRoot}\desktop\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean user data (portable data dir next to exe, or APPDATA)
Type: filesandordirs; Name: "{app}\data"
