$ErrorActionPreference = 'Stop'

$designlangCommit = 'a9e832efe304330a7fc491511c0ca30a34bc0106'
$installRoot = Join-Path $PSScriptRoot '..\.tools\designlang'

npm.cmd install --prefix $installRoot "github:Manavarya09/design-extract#$designlangCommit" --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$cliPath = Join-Path $installRoot 'node_modules\designlang\bin\design-extract.js'
node $cliPath --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

