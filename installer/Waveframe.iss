; Waveframe - Inno Setup installer script (machine-wide, Program Files; asks for administrator rights; removes an earlier per-user install).
; Build:  npm run dist        (creates release\win-unpacked and the portable exe via electron-builder)
;         ISCC.exe /DMyAppVersion=1.7.0 installer\Waveframe.iss      -> installer\output\Waveframe.Setup.<version>.exe
; Greek.isl is the unofficial community translation from the Inno Setup repository (copied in Languages\ so the script compiles anywhere).

#ifndef MyAppVersion
  #define MyAppVersion "2.0.0"
#endif
#define MyAppName "Waveframe"
#define MyAppExeName "Waveframe.exe"
#define MySourceDir "..\release\win-unpacked"

[Setup]
AppId={{6F1D2C84-3B7A-4E59-A0C2-9D4E8B5A17F3}
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
; Waveframe artwork instead of the default Inno disk-and-box (two sizes each for high-DPI)
WizardImageFile=images\wizard-164x314.bmp,images\wizard-246x471.bmp
WizardSmallImageFile=images\small-55x55.bmp,images\small-110x110.bmp
OutputDir=output
OutputBaseFilename=Waveframe.Setup.{#MyAppVersion}
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
greek.AssocTask=Προσθήκη του Waveframe στο «Άνοιγμα με» για αρχεία ήχου
english.AssocTask=Add Waveframe to the "Open with" list for audio files
french.AssocTask=Ajouter Waveframe à la liste « Ouvrir avec » des fichiers audio
german.AssocTask=Waveframe zur Liste „Öffnen mit“ für Audiodateien hinzufügen

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "assoc"; Description: "{cm:AssocTask}"; Flags: unchecked

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "..\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.Waveframe.txt"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; "Open with" entries only: they never take over the user's default player.
Root: HKA; Subkey: "Software\Classes\Waveframe.Audio"; ValueType: string; ValueData: "Waveframe audio"; Flags: uninsdeletekey; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Waveframe.Audio\DefaultIcon"; ValueType: string; ValueData: "{app}\{#MyAppExeName},0"; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Waveframe.Audio\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.mp3\OpenWithProgids"; ValueType: string; ValueName: "Waveframe.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.wav\OpenWithProgids"; ValueType: string; ValueName: "Waveframe.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.flac\OpenWithProgids"; ValueType: string; ValueName: "Waveframe.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.ogg\OpenWithProgids"; ValueType: string; ValueName: "Waveframe.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.m4a\OpenWithProgids"; ValueType: string; ValueName: "Waveframe.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.opus\OpenWithProgids"; ValueType: string; ValueName: "Waveframe.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.wma\OpenWithProgids"; ValueType: string; ValueName: "Waveframe.Audio"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[Code]
// Earlier builds (1.6 - 1.9) were installed per user (%LocalAppData%\Programs\Waveframe, HKCU uninstall entry; 1.6/1.7 also had an
// electron-builder NSIS entry). This version installs machine-wide into Program Files: remove the per-user copy first (its settings live in
// %AppData%\waveframe and are kept) so there are no duplicate shortcuts or autostart entries.
procedure RunUninstaller(Key: String; Args: String);
var
  Cmd, Exe: String;
  ResultCode: Integer;
begin
  if RegQueryStringValue(HKCU, Key, 'UninstallString', Cmd) then
  begin
    Exe := RemoveQuotes(Cmd);
    if FileExists(Exe) then
      Exec(Exe, Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

procedure RemovePerUserInstall;
begin
  RunUninstaller('Software\Microsoft\Windows\CurrentVersion\Uninstall\{6F1D2C84-3B7A-4E59-A0C2-9D4E8B5A17F3}_is1', '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
  RunUninstaller('Software\Microsoft\Windows\CurrentVersion\Uninstall\com.example.waveframe', '/S');
  // a stale per-user autostart entry would start the removed copy
  RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Waveframe');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  RemovePerUserInstall;
  Result := '';
end;
