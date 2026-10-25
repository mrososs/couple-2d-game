# Runs the Android Gradle wrapper with the environment this machine needs:
# - JAVA_HOME on Android Studio's bundled JDK 21 (the system JDK 25 is newer than AGP supports),
# - a short temp directory, because the JDK's NIO selector failed with
#   "Unable to establish loopback connection" when its AF_UNIX socket lived under the default TEMP.
#
#   powershell -File scripts/gradle.ps1 app:assembleDebug -PreactNativeArchitectures=x86_64
param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $GradleArgs)

$ErrorActionPreference = 'Stop'
$tmp = 'D:\DevCache\tmp'
New-Item -ItemType Directory -Force $tmp | Out-Null
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:TEMP = $tmp
$env:TMP = $tmp
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$tmp -Djava.io.tmpdir=$tmp"

Push-Location (Join-Path $PSScriptRoot '..\android')
try {
  & .\gradlew.bat @GradleArgs --console=plain
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
