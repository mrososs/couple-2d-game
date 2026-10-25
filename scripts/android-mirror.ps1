# Mirrors the project to a short path and runs Gradle there.
#
# React Native's C++ build (ninja under CMake 3.22) refuses object paths over 260 characters, and
# from "D:\Study\2D Couple Game\before-we-become-three" the codegen objects of
# react-native-safe-area-context exceed it. A `subst` drive does not help: Expo's autolinking
# cannot find package.json at a drive root. So native builds run from a mirror at D:\b3, kept in
# sync by this script; JavaScript still comes from this folder's Metro in debug builds.
#
#   powershell -File scripts/android-mirror.ps1 app:assembleDebug -PreactNativeArchitectures=x86_64
#   powershell -File scripts/android-mirror.ps1 app:assembleRelease -PreactNativeArchitectures=x86_64
param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $GradleArgs)

$ErrorActionPreference = 'Stop'
$source = Resolve-Path (Join-Path $PSScriptRoot '..')
$mirror = 'D:\b3'
New-Item -ItemType Directory -Force $mirror | Out-Null

# Top-level files the build reads.
foreach ($file in 'package.json', 'package-lock.json', 'app.json', 'metro.config.js', 'tsconfig.json', 'index.html', 'game.html') {
  Copy-Item (Join-Path $source $file) (Join-Path $mirror $file) -Force
}
# Source, assets and dependencies; generated native output stays where Gradle left it.
foreach ($dir in 'src', 'assets', 'scripts', 'modules') {
  robocopy (Join-Path $source $dir) (Join-Path $mirror $dir) /MIR /NFL /NDL /NJH /NJS /NP /MT:16 | Out-Null
}
robocopy (Join-Path $source 'node_modules') (Join-Path $mirror 'node_modules') /MIR /NFL /NDL /NJH /NJS /NP /MT:32 /XD .cxx | Out-Null
robocopy (Join-Path $source 'android') (Join-Path $mirror 'android') /MIR /NFL /NDL /NJH /NJS /NP /MT:16 /XD build .cxx .gradle | Out-Null

& (Join-Path $mirror 'scripts\gradle.ps1') @GradleArgs
exit $LASTEXITCODE
