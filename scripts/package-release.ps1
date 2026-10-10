param([string]$Commit = 'HEAD', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$resolvedCommit = (& git -C $repoRoot rev-parse --verify "$Commit^{commit}" | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $resolvedCommit -notmatch '^[a-f0-9]{40}$') { throw 'Invalid release commit' }
function Read-ReleaseBlob([string]$RelativePath) {
  if ($RelativePath -notmatch '^[A-Za-z0-9_./-]+$' -or $RelativePath.StartsWith('/') -or $RelativePath.Split('/') -contains '..') { throw 'Unsafe archive path' }
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = 'git'
  $start.Arguments = '-C "' + $repoRoot + '" cat-file blob ' + $resolvedCommit + ':' + $RelativePath
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  $buffer = New-Object System.IO.MemoryStream
  try {
    if (-not $process.Start()) { throw 'Could not read Git blob' }
    $process.StandardOutput.BaseStream.CopyTo($buffer)
    $diagnostic = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Missing committed release file ${RelativePath}: $diagnostic" }
    return ,$buffer.ToArray()
  } finally { $buffer.Dispose(); $process.Dispose() }
}
function Get-ReleaseDigest([byte[]]$Bytes) {
  $digest = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($digest.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $digest.Dispose() }
}
$encoding = New-Object System.Text.UTF8Encoding($false)
$manifest = $encoding.GetString((Read-ReleaseBlob 'manifest.json')) | ConvertFrom-Json
$package = $encoding.GetString((Read-ReleaseBlob 'package.json')) | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$' -or $package.version -ne $version) { throw 'Release version mismatch' }
$paths = @(
  'manifest.json','background.js','content.js','facebook.js','fb-detect.js','fb-net-probe.js',
  'filters.js','core-filters.js','advanced-rules.js','procedural-engine.js','scriptlet-engine.js',
  'youtube.js','youtube-main.js','youtube-sanitizer.js','instagram.js','twitter.js','inject.js','popclose.js',
  'popup.html','popup.js','LICENSE','README.md','MAINTENANCE_NOTES.md','RELEASE_NOTES.md',
  'rulesets/core-source.json','rulesets/SOURCES.md','rulesets/UPSTREAM_LICENSE.txt'
)
$paths += @($manifest.icons.PSObject.Properties | ForEach-Object { [string]$_.Value })
$paths += @($manifest.action.default_icon.PSObject.Properties | ForEach-Object { [string]$_.Value })
foreach ($scripts in $manifest.content_scripts) { $paths += @($scripts.js) }
foreach ($entry in $manifest.web_accessible_resources) { $paths += @($entry.resources) }
foreach ($resource in $manifest.declarative_net_request.rule_resources) {
  $rules = $encoding.GetString((Read-ReleaseBlob $resource.path)) | ConvertFrom-Json
  if ($resource.path.StartsWith('rulesets/regex/') -or @($rules | Where-Object { $null -ne $_.condition.PSObject.Properties['regexFilter'] }).Count) {
    throw "Unvalidated boot-time regex in $($resource.id)"
  }
  $paths += $resource.path
}
$provenance = $encoding.GetString((Read-ReleaseBlob 'rulesets/core-source.json')) | ConvertFrom-Json
foreach ($source in $provenance.rulesets) {
  $sourcePath = 'rulesets/' + $source.kind + '/' + $source.id + '.json'
  if ((Get-ReleaseDigest (Read-ReleaseBlob $sourcePath)) -ne $source.sha256) { throw "Upstream byte identity mismatch: $sourcePath" }
  $paths += $sourcePath
}
$paths = @($paths | Sort-Object -Unique)
if ($paths | Where-Object { $_ -match '(^|/)(_metadata|tests|scripts|\.git|old_v\d+|BACKUP[^/]*)(/|$)' }) { throw 'Non-runtime files entered the package' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot ('scratch/releases/v' + $version + '/' + $resolvedCommit.Substring(0, 12)) }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $OutputDirectory.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must remain inside this workspace' }
$zipPath = Join-Path $OutputDirectory ('AdBlocker-Pro-Ultimate-v' + $version + '.zip')
if (Test-Path -LiteralPath $zipPath) { throw "Refusing to overwrite existing release ZIP: $zipPath" }
[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$timestamp = [DateTimeOffset]::FromUnixTimeSeconds([long](& git -C $repoRoot show -s --format=%ct $resolvedCommit))
$stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
$expected = @{}
try {
  foreach ($relativePath in $paths) {
    $bytes = Read-ReleaseBlob $relativePath
    $entry = $archive.CreateEntry($relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $timestamp
    $output = $entry.Open()
    try { $output.Write($bytes, 0, $bytes.Length) } finally { $output.Dispose() }
    $expected[$relativePath] = @{ size = $bytes.Length; sha256 = Get-ReleaseDigest $bytes }
  }
} finally { $archive.Dispose(); $stream.Dispose() }
$readback = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  if ($readback.Entries.Count -ne $paths.Count) { throw 'ZIP entry count mismatch' }
  foreach ($entry in $readback.Entries) {
    $buffer = New-Object System.IO.MemoryStream
    $input = $entry.Open()
    try { $input.CopyTo($buffer); $bytes = $buffer.ToArray() }
    finally { $input.Dispose(); $buffer.Dispose() }
    if (-not $expected.ContainsKey($entry.FullName) -or $expected[$entry.FullName].size -ne $bytes.Length -or
        $expected[$entry.FullName].sha256 -ne (Get-ReleaseDigest $bytes)) { throw "ZIP differs from commit: $($entry.FullName)" }
  }
} finally { $readback.Dispose() }
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sumsPath = Join-Path $OutputDirectory 'SHA256SUMS.txt'
[System.IO.File]::WriteAllText($sumsPath, $zipHash + '  ' + [System.IO.Path]::GetFileName($zipPath) + "`n", $encoding)
$verificationPath = Join-Path $OutputDirectory 'PACKAGE_VERIFICATION.json'
$verification = @{ version = $version; commit = $resolvedCommit; files = $paths.Count; zipSha256 = $zipHash;
  minimumChrome = $manifest.minimum_chrome_version; byteVerifiedAgainstCommit = $true; entries = $expected }
[System.IO.File]::WriteAllText($verificationPath, ($verification | ConvertTo-Json -Depth 6), $encoding)
[PSCustomObject]@{ Version = $version; Commit = $resolvedCommit; Files = $paths.Count;
  ZipPath = $zipPath; Sha256 = $zipHash; SumsPath = $sumsPath; VerificationPath = $verificationPath } | ConvertTo-Json
