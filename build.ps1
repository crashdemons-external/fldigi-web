param([switch]$Debug)
$ErrorActionPreference = 'Stop'
$buildArguments = @((Join-Path $PSScriptRoot 'scripts/build.py'))
if ($Debug) { $buildArguments += '--debug' }
python @buildArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
