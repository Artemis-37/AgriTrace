; AgriTrace — script Inno Setup (alternative à l'installateur NSIS généré par electron-builder).
; Il emballe le dossier « win-unpacked » produit par electron-builder.
; Mode d'emploi complet : desktop/installer/LISEZMOI.md
;
; Compilation (sur Windows, Inno Setup 6.x installé) :
;   1. cd desktop && npm ci && node scripts/prepare-payload.js && npm run dist:dir
;   2. Ouvrir installer\agritrace.iss dans Inno Setup puis « Compiler » (F9),
;      ou en ligne de commande :  ISCC.exe installer\agritrace.iss /DAppVersion=0.1.0
; Résultat : desktop\dist\AgriTrace-Setup-<version>.exe

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define AppName "AgriTrace"
#define AppExe  "AgriTrace.exe"
; Dossier produit par « electron-builder --win --dir » (relatif à ce fichier)
#ifndef SourceDir
  #define SourceDir "..\dist\win-unpacked"
#endif

[Setup]
; Identifiant unique : NE JAMAIS le changer d'une version à l'autre (permet la mise à jour par-dessus l'existant).
AppId={{773253FB-99AE-4FDA-B582-04915E13C3E9}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=AgriTrace
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Contrat de licence (EULA) : « J'accepte » obligatoire pour continuer
LicenseFile=..\build\license_fr.txt
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
OutputDir=..\dist
OutputBaseFilename=AgriTrace-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Installation pour tous les utilisateurs du poste (droits administrateur) : le pare-feu l'exige
PrivilegesRequired=admin
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; Pare-feu Windows : autorise les autres postes du bureau (réseau privé / domaine, jamais « public ») à joindre le serveur AgriTrace (port 3000)
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AgriTrace serveur"""; Flags: runhidden; StatusMsg: "Configuration du pare-feu..."
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AgriTrace recherche"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""AgriTrace recherche"" dir=in action=allow protocol=UDP localport=8099 profile=private,domain program=""{app}\{#AppExe}"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""AgriTrace serveur"" dir=in action=allow protocol=TCP localport=3000 profile=private,domain program=""{app}\{#AppExe}"""; Flags: runhidden
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AgriTrace recherche"""; Flags: runhidden; RunOnceId: "FwRecherche"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AgriTrace serveur"""; Flags: runhidden; RunOnceId: "FwServeur"

; Les données (base PostgreSQL, sauvegardes, paramètres) vivent hors du dossier d'installation (profil utilisateur) :
; la désinstallation et la mise à jour ne les suppriment donc pas.
