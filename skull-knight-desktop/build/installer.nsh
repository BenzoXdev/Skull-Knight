; Custom NSIS include for Skull Knight Desktop installer

; Enable DPI awareness so the installer UI renders crisply on high-DPI displays
ManifestDPIAware true

!macro customInstall
  ; Create Start Menu shortcut
  CreateShortCut "$SMPROGRAMS\Skull Knight.lnk" "$INSTDIR\Skull Knight.exe" "" "$INSTDIR\Skull Knight.exe" 0
!macroend

!macro customUnInstall
  ; Remove Start Menu shortcut
  Delete "$SMPROGRAMS\Skull Knight.lnk"
!macroend
