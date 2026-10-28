; Установщик AveSTT (Inno Setup 6)
; Полный:     ISCC /DAppVersion=1.0.0 /DWithModel AveSTT.iss   -> AveSTT-Setup-1.0.0.exe
; Обновление: ISCC /DAppVersion=1.0.0 AveSTT.iss               -> AveSTT-Update-1.0.0.exe

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "AveSTT"
#define AppExe "AveSTT.exe"
#define Root ".."

[Setup]
AppId={{6F1C9A3E-7B42-4C8E-9D21-AE57B0C3F8D4}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=AveSTT
AppPublisherURL=https://github.com/imkita339-afk/AveSTT
AppSupportURL=https://github.com/imkita339-afk/AveSTT/issues
AppUpdatesURL=https://github.com/imkita339-afk/AveSTT/releases
; Установка в профиль пользователя: не нужны права администратора, обновления ставятся без запросов UAC
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
DisableWelcomePage=no
UsePreviousAppDir=yes
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
SetupIconFile={#Root}\assets\icon.ico
WizardStyle=modern
WizardSizePercent=110
WizardImageFile={#Root}\assets\wizard-100.bmp,{#Root}\assets\wizard-200.bmp
WizardSmallImageFile={#Root}\assets\wizard-small-100.bmp,{#Root}\assets\wizard-small-200.bmp
ShowLanguageDialog=auto
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=force
RestartApplications=no
OutputDir={#Root}\dist
#ifdef WithModel
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
#else
OutputBaseFilename={#AppName}-Update-{#AppVersion}
#endif

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ru.LaunchApp=Запустить AveSTT
en.LaunchApp=Launch AveSTT
ru.InstallingWebView=Устанавливаем компонент Microsoft Edge WebView2…
en.InstallingWebView=Installing Microsoft Edge WebView2…

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; Старые файлы программы удаляем перед обновлением, модели и данные пользователя не трогаем
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "{#Root}\dist\AveSTT\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifdef WithModel
Source: "{#Root}\bundle\models\small\*"; DestDir: "{app}\models\small"; Flags: ignoreversion recursesubdirs
#endif
Source: "{#Root}\packaging\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "{cm:InstallingWebView}"; Check: NeedsWebView2; Flags: waituntilterminated
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent
; После тихого обновления из программы — открыть её снова
Filename: "{app}\{#AppExe}"; Flags: nowait skipifnotsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function WebView2Installed(): Boolean;
var
  V: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) and (V <> '') and (V <> '0.0.0.0'));
end;

function NeedsWebView2(): Boolean;
begin
  Result := not WebView2Installed();
end;
