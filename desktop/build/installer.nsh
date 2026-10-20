; Pare-feu Windows : autorise les autres postes du bureau (réseau privé / domaine, jamais « public ») à joindre le serveur AgriTrace (port 3000).
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="AgriTrace serveur"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="AgriTrace serveur" dir=in action=allow protocol=TCP localport=3000 profile=private,domain program="$INSTDIR\AgriTrace.exe"'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="AgriTrace serveur"'
!macroend
