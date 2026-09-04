# 下载并解压 FFmpeg（gyan.dev essentials，含 ffmpeg.exe + ffprobe.exe）到 resources/ffmpeg
# 用法：powershell -ExecutionPolicy Bypass -File scripts/download-ffmpeg.ps1
param(
    [string]$Url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'resources\ffmpeg'
$tmpZip = Join-Path $env:TEMP 'ffmpeg-essentials.zip'
$tmpDir = Join-Path $env:TEMP 'ffmpeg-essentials-x'

New-Item -ItemType Directory -Force -Path $dest | Out-Null

Write-Host "下载 $Url ..."
Invoke-WebRequest -Uri $Url -OutFile $tmpZip -UseBasicParsing

if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

$exes = Get-ChildItem $tmpDir -Recurse -Filter '*.exe' |
    Where-Object { $_.Name -in @('ffmpeg.exe', 'ffprobe.exe') }
foreach ($f in $exes) {
    Copy-Item $f.FullName (Join-Path $dest $f.Name) -Force
    Write-Host "  -> $dest\$($f.Name)"
}
Write-Host '完成。'
