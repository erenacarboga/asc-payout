# asc-payout installer for Windows
#
#   irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.ps1 | iex
#
# Installs the latest release after checking its SHA-256 and adds it to your PATH.
#   $env:ASC_PAYOUT_VERSION = "v1.0.0"   install that version instead of the latest
#   $env:ASC_PAYOUT_BIN_DIR = "C:\tools" install somewhere else
# Without direct access to the release (a private repository), the GitHub CLI is used.

# Everything runs in its own scope so nothing leaks into your PowerShell session.
& {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    $repo = "erenacarboga/asc-payout"
    $asset = "asc-payout-windows-x64.exe"
    $version = $env:ASC_PAYOUT_VERSION
    $binDir = if ($env:ASC_PAYOUT_BIN_DIR) { $env:ASC_PAYOUT_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\asc-payout" }

    if (-not [Environment]::Is64BitOperatingSystem) { throw "asc-payout needs 64-bit Windows." }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $work = Join-Path ([IO.Path]::GetTempPath()) ("asc-payout-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        $url = if ($version) { "https://github.com/$repo/releases/download/$version" } else { "https://github.com/$repo/releases/latest/download" }
        Write-Host "Downloading $asset $(if ($version) { $version } else { '(latest)' })"
        try {
            Invoke-WebRequest -UseBasicParsing "$url/$asset" -OutFile (Join-Path $work $asset)
            Invoke-WebRequest -UseBasicParsing "$url/SHA256SUMS" -OutFile (Join-Path $work "SHA256SUMS")
        }
        catch {
            if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
                throw "Download failed. For a private repository, install the GitHub CLI and run: gh auth login"
            }
            Write-Host "Direct download not possible; using the GitHub CLI"
            $tag = @(); if ($version) { $tag = @($version) }
            gh release download @tag -R $repo -p $asset -p SHA256SUMS -D $work --clobber
            if ($LASTEXITCODE -ne 0) { throw "gh could not download the release." }
        }

        $want = (Select-String -Path (Join-Path $work "SHA256SUMS") -Pattern ([regex]::Escape($asset) + '$') | Select-Object -First 1).Line -split '\s+' | Select-Object -First 1
        $have = (Get-FileHash (Join-Path $work $asset) -Algorithm SHA256).Hash
        if (-not $want -or $want.ToLower() -ne $have.ToLower()) { throw "Checksum does not match; nothing installed." }

        New-Item -ItemType Directory -Force -Path $binDir | Out-Null
        $exe = Join-Path $binDir "asc-payout.exe"
        Copy-Item (Join-Path $work $asset) $exe -Force

        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if (-not $userPath) { $userPath = "" }
        if (($userPath -split ';') -notcontains $binDir) {
            [Environment]::SetEnvironmentVariable("Path", ((@($userPath.TrimEnd(';'), $binDir) | Where-Object { $_ }) -join ';'), "User")
            $env:Path = "$env:Path;$binDir"
            Write-Host "Added $binDir to your PATH (new terminals will find asc-payout)."
        }
        Write-Host "Installed $(& $exe --version) to $exe"
        Write-Host "Next: asc-payout setup    (or try: asc-payout demo)"
    }
    finally {
        Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    }
}
