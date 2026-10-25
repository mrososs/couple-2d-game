# Boots the two test phones for two-phone play: a host and a guest emulator whose data lives on D:
# (C: is short of space). They are created on first use from the API 35 Google APIs image and
# booted one after the other, since two booting at once starve an ordinary laptop.
#
#   powershell -File scripts/emulators.ps1
#   powershell -File scripts/emulators.ps1 -Apk D:\b3\android\app\build\outputs\apk\release\app-release.apk
#
# Emulators cannot reach each other directly, so the host's relay port is forwarded to this PC; the
# guest joins with the code 10.0.2.2-<PIN> (10.0.2.2 is this PC as seen from an emulator).
#
# Memory is what decides whether two fit on a 16 GB laptop. Not API 36.1: with emulator 37.2.12 an
# idle 36.1 phone grew by about 1 GB of host memory a minute - with a window or headless, host or
# software GPU, Vulkan on or off - and the second phone stalled mid-boot. An API 35 phone with
# 1.5 GB of RAM and software rendering stays at about 4.3 GB.
param(
  [string] $AvdHome = 'D:\DevCache\android\avd',
  [string] $Apk,
  [int] $MemoryMB = 1536,
  [string] $Gpu = 'swiftshader_indirect'
)

$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$env:ANDROID_AVD_HOME = $AvdHome
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:TEMP = 'D:\DevCache\tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $AvdHome, $env:TEMP | Out-Null

# Booted means the package service answers too: installing on boot_completed alone failed with
# "Failure calling service package: Broken pipe".
function Wait-Boot([string] $serial) {
  $deadline = (Get-Date).AddMinutes(12)
  while ((Get-Date) -lt $deadline) {
    if ("$(& $adb -s $serial shell getprop sys.boot_completed 2>$null)".Trim() -eq '1' -and "$(& $adb -s $serial shell pm path android 2>$null)" -match 'package:') { return $true }
    Start-Sleep -Seconds 5
  }
  return $false
}

function Install-Apk([string] $serial) {
  foreach ($attempt in 1..3) {
    if ("$(& $adb -s $serial install -r $Apk 2>&1)" -match 'Success') { return $true }
    Start-Sleep -Seconds 10
  }
  return $false
}

foreach ($phone in @(@{ Name = 'BWBT_Host'; Port = 5554 }, @{ Name = 'BWBT_Guest'; Port = 5556 })) {
  $serial = "emulator-$($phone.Port)"
  if (-not (Test-Path (Join-Path $AvdHome "$($phone.Name).ini"))) {
    'no' | & (Join-Path $sdk 'cmdline-tools\latest\bin\avdmanager.bat') create avd -n $phone.Name -k 'system-images;android-35;google_apis;x86_64' -d pixel_7 | Out-Null
  }
  if ((& $adb -s $serial get-state 2>$null) -ne 'device') {
    Start-Process (Join-Path $sdk 'emulator\emulator.exe') -ArgumentList '-avd', $phone.Name, '-port', $phone.Port, '-memory', $MemoryMB, '-no-snapshot', '-no-audio', '-no-boot-anim', '-gpu', $Gpu
  }
  if (-not (Wait-Boot $serial)) { Write-Error "$serial did not finish booting"; exit 1 }
  if ($Apk -and -not (Install-Apk $serial)) { Write-Error "Could not install $Apk on $serial"; exit 1 }
  "$($phone.Name) ready as $serial"
}

& $adb -s emulator-5554 forward tcp:7777 tcp:7777 | Out-Null
'Relay forwarded: open a room on emulator-5554, join from emulator-5556 with 10.0.2.2-<PIN>'
