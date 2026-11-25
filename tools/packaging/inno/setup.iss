; 3178 联机平台：每用户安装，不写 HKLM，不默认删除用户数据。
#define MyAppName "3178 联机平台"
#define MyAppVersion "0.1.0"
#define MyAppExeName "3178.exe"

[Setup]
AppId={{7C0B0D2E-4F4A-4D3E-9A57-3178BATTLE01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=3178-battle-platform contributors
DefaultDirName={localappdata}\Programs\3178
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\..\dist-win
OutputBaseFilename=3178-setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
Source: "..\..\..\dist-win\3178\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

; 卸载默认保留 %LOCALAPPDATA%\3178-battle-platform 下的会话与游戏包。
