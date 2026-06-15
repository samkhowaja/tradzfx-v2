# Run graphify on the tradzfx-v2 repo using the local Python venv.
# This script builds a code-only knowledge graph (no LLM required).
# For semantic/doc extraction, set GEMINI_API_KEY or GOOGLE_API_KEY and
# replace "update" with ". --mode deep --svg" below.
$venvPython = "C:\tradzfx-v2\.venv\Scripts\python.exe"
$venvGraphify = "C:\tradzfx-v2\.venv\Scripts\graphify.exe"

if (-not (Test-Path $venvGraphify)) {
    Write-Host "Installing graphifyy into local .venv..."
    & $venvPython -m pip install graphifyy -q
}

Write-Host "Running graphify code-only update on C:\tradzfx-v2 ..."
& $venvGraphify update . --force

Write-Host "Done. Output: graphify-out/"
