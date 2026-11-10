; Opsis Media Suite (formerly Waveframe) - Inno Setup installer script (machine-wide, Program Files; asks for administrator rights; removes an earlier per-user install).
; Build:  npm run dist        (creates release\win-unpacked and the portable exe via electron-builder)
;         ISCC.exe /DMyAppVersion=1.7.0 installer\OpsisMediaSuite.iss      -> installer\output\OpsisMediaSuite-Setup-<version>.exe
; Greek.isl is the unofficial community translation from the Inno Setup repository (copied in Languages\ so the script compiles anywhere).

#if Ver < EncodeVer(7, 0, 0)
  #error This script needs Inno Setup 7 or newer.
#endif

#ifndef MyAppVersion
  #define MyAppVersion "2.3.0"
#endif
#define MyAppName "Opsis Media Suite"
#define MyAppExeName "Opsis Media Suite.exe"
#define OldAppId "{6F1D2C84-3B7A-4E59-A0C2-9D4E8B5A17F3}"   ; the AppId never changes: the product was renamed, not replaced
#define MySourceDir "..\release\win-unpacked"

[Setup]
AppId={{6F1D2C84-3B7A-4E59-A0C2-9D4E8B5A17F3}
UsePreviousAppDir=no
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=giorstergiopoulos-design
AppCopyright=Copyright (c) 2026 giorstergiopoulos-design
VersionInfoCompany=giorstergiopoulos-design
VersionInfoDescription={#MyAppName} Setup
VersionInfoVersion={#MyAppVersion}
VersionInfoCopyright=Copyright (c) 2026 giorstergiopoulos-design
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
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
greek.AssocVideoTask=Προσθήκη του Opsis Media Suite στο «Άνοιγμα με» για αρχεία βίντεο
english.AssocVideoTask=Add Opsis Media Suite to the "Open with" list for video files
french.AssocVideoTask=Ajouter Opsis Media Suite à la liste « Ouvrir avec » des fichiers vidéo
german.AssocVideoTask=Opsis Media Suite zur Liste „Öffnen mit“ für Videodateien hinzufügen
german.AssocTask=Opsis Media Suite zur Liste „Öffnen mit“ für Audiodateien hinzufügen

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "assoc"; Description: "{cm:AssocTask}"; Flags: unchecked
Name: "assocvideo"; Description: "{cm:AssocVideoTask}"; Flags: unchecked

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "..\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.OpsisMediaSuite.txt"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; video "Open with" (2.3.0, taken over from Media Player Pro): same rule, never the default player
Root: HKA; Subkey: "Software\Classes\OpsisMediaSuite.Video"; ValueType: string; ValueData: "Opsis Media Suite video"; Flags: uninsdeletekey; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\OpsisMediaSuite.Video\DefaultIcon"; ValueType: string; ValueData: "{app}\{#MyAppExeName},0"; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\OpsisMediaSuite.Video\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.mp4\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.mkv\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.avi\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.mov\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.webm\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.m4v\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.wmv\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.mpg\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.mpeg\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
Root: HKA; Subkey: "Software\Classes\.ogv\OpenWithProgids"; ValueType: string; ValueName: "OpsisMediaSuite.Video"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocvideo
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
// The product was renamed from Waveframe to Opsis Media Suite (2.2/2.3) WITHOUT changing the AppId, so this setup is a normal upgrade for Windows and for
// the update helper of old versions. Only the files differ: the old product lived in Program Files\Waveframe (or %LocalAppData%\Programs\Waveframe) with
// Waveframe.exe, shortcuts and "Open with" entries of its own. Its uninstaller (found through the same uninstall key) removes all of that first, silently.
// Settings live in %AppData%\waveframe and are kept. If the old copy had autostart on, a flag asks the new exe to register itself again on first start.
function OldProductUninstaller(var Root: Integer; var Cmd: String): Boolean;
var
  Key, Name: String;
begin
  Result := False;
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#OldAppId}_is1';
  if RegQueryStringValue(HKLM64, Key, 'DisplayName', Name) and (Pos('Waveframe', Name) = 1) and RegQueryStringValue(HKLM64, Key, 'UninstallString', Cmd) then begin Root := HKLM64; Result := True; end
  else if RegQueryStringValue(HKLM32, Key, 'DisplayName', Name) and (Pos('Waveframe', Name) = 1) and RegQueryStringValue(HKLM32, Key, 'UninstallString', Cmd) then begin Root := HKLM32; Result := True; end
  else if RegQueryStringValue(HKCU, Key, 'DisplayName', Name) and (Pos('Waveframe', Name) = 1) and RegQueryStringValue(HKCU, Key, 'UninstallString', Cmd) then begin Root := HKCU; Result := True; end;
end;

procedure RunUninstaller(Cmd: String; Args: String);
var
  Exe: String;
  ResultCode: Integer;
begin
  Exe := RemoveQuotes(Cmd);
  if FileExists(Exe) then
    Exec(Exe, Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure RemoveOldInstalls;
var
  Root: Integer;
  Cmd, Dummy: String;
begin
  if OldProductUninstaller(Root, Cmd) then
    RunUninstaller(Cmd, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
  // the NSIS installer of 1.6 / 1.7
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\com.example.waveframe', 'UninstallString', Cmd) then
    RunUninstaller(Cmd, '/S');
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
