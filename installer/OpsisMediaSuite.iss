; Opsis Media Suite (formerly Waveframe) - Inno Setup installer script (machine-wide, Program Files; asks for administrator rights; removes an earlier per-user install).
; Build:  npm run dist        (creates release\win-unpacked and the portable exe via electron-builder)
;         ISCC.exe /DMyAppVersion=1.7.0 installer\OpsisMediaSuite.iss      -> installer\output\OpsisMediaSuite-Setup-<version>.exe
; Greek.isl is the unofficial community translation from the Inno Setup repository (copied in Languages\ so the script compiles anywhere).

#ifndef MyAppVersion
  #define MyAppVersion "2.2.0"
#endif
#define MyAppName "Opsis Media Suite"
#define MyAppExeName "Opsis Media Suite.exe"
#define OldAppId "{6F1D2C84-3B7A-4E59-A0C2-9D4E8B5A17F3}"
#define MySourceDir "..\release\win-unpacked"

[Setup]
AppId={{B3E7A5D1-4C62-4F08-9A7E-2D51C8F06B94}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=giorstergiopoulos-design
AppPublisherURL=https://github.com/giorstergiopoulos-design/waveframe
AppSupportURL=https://github.com/giorstergiopoulos-design/waveframe/issues
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=..\icon.ico
; Opsis Media Suite artwork instead of the default Inno disk-and-box (two sizes each for high-DPI)
WizardImageFile=images\wizard-164x314.bmp,images\wizard-246x471.bmp
WizardSmallImageFile=images\small-55x55.bmp,images\small-110x110.bmp
OutputDir=output
OutputBaseFilename=OpsisMediaSuite-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
CloseApplications=yes

[Languages]
Name: "greek"; MessagesFile: "Languages\Greek.isl"; LicenseFile: "..\build\license_el.txt"
Name: "english"; MessagesFile: "compiler:Default.isl"; LicenseFile: "..\build\license_en.txt"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"; LicenseFile: "..\build\license_fr.txt"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"; LicenseFile: "..\build\license_de.txt"

[CustomMessages]
greek.AssocTask=Προσθήκη του Opsis Media Suite στο «Άνοιγμα με» για αρχεία ήχου
english.AssocTask=Add Opsis Media Suite to the "Open with" list for audio files
french.AssocTask=Ajouter Opsis Media Suite à la liste « Ouvrir avec » des fichiers audio
german.AssocTask=Opsis Media Suite zur Liste „Öffnen mit“ für Audiodateien hinzufügen

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "assoc"; Description: "{cm:AssocTask}"; Flags: unchecked

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "..\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.OpsisMediaSuite.txt"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; "Open with" entries only: they never take over the user's default player.
Root: HKA; Subkey: "Software\Classes\OpsisMediaSuite.Audio"; ValueType: string; ValueData: "Opsis Media Suite audio"; Flags: uninsdeletekey; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\OpsisMediaSuite.Audio\DefaultIcon"; ValueType: string; ValueData: "{app}\{#MyAppExeName},0"; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\OpsisMediaSuite.Audio\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.mp3\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.wav\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.flac\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.ogg\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.m4a\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.opus\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.wma\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[Code]
// Product renamed from Waveframe to Opsis Media Suite (2.2.0). The old product has its own AppId, so this installer would otherwise leave a second
// copy behind: remove it first (machine-wide from Program Files, or the per-user copies of 1.6 - 1.9). Settings live in %AppData%\waveframe and are kept
// (the data folder name did not change). If the old copy had autostart on, a flag asks the new exe to register itself again on first start.
procedure RunUninstaller(Root: Integer; Key: String; Args: String);
var
  Cmd, Exe: String;
  ResultCode: Integer;
begin
  if RegQueryStringValue(Root, Key, 'UninstallString', Cmd) then
  begin
    Exe := RemoveQuotes(Cmd);
    if FileExists(Exe) then
      Exec(Exe, Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

procedure RemoveOldInstalls;
var
  Key, Dummy: String;
begin
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#OldAppId}_is1';
  RunUninstaller(HKLM64, Key, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
  RunUninstaller(HKLM32, Key, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
  RunUninstaller(HKCU, Key, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
  RunUninstaller(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\com.example.waveframe', '/S');
  // a stale autostart entry would start the removed copy: drop it and leave the flag for the new exe
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Waveframe', Dummy) then
  begin
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Waveframe');
    ForceDirectories(ExpandConstant('{userappdata}\waveframe'));
    SaveStringToFile(ExpandConstant('{userappdata}\waveframe\reenable-autostart.flag'), '1', False);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  RemoveOldInstalls;
  Result := '';
end;
