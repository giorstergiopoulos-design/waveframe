; Waveframe - Inno Setup installer script (per-user, no admin rights needed).
; Build:  npm run dist        (creates release\win-unpacked and the portable exe via electron-builder)
;         ISCC.exe /DMyAppVersion=1.7.0 installer\Waveframe.iss      -> installer\output\Waveframe.Setup.<version>.exe
; Greek.isl is the unofficial community translation from the Inno Setup repository (copied in Languages\ so the script compiles anywhere).

#ifndef MyAppVersion
  #define MyAppVersion "1.7.0"
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
OutputDir=output
OutputBaseFilename=Waveframe.Setup.{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
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
