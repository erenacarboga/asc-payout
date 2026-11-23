# asc-payout installer for Windows
#
#   irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.ps1 | iex
#
# Installs the latest release after checking its SHA-256 and adds it to your PATH.
#   $env:ASC_PAYOUT_VERSION = "v1.0.0"   install that version instead of the latest
#   $env:ASC_PAYOUT_BIN_DIR = "C:\tools" install somewhere else
#   $env:ASC_PAYOUT_NO_MODIFY_PATH = "1"   leave your PATH as it is
# If the direct download fails (a proxy, for example) and the GitHub CLI is installed, it is used instead.

# Everything runs in its own scope so nothing leaks into your PowerShell session.
& {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    $repo = "erenacarboga/asc-payout"
    # Native build for ARM64 Windows; x64 everywhere else
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $asset = if ($arch -eq "ARM64") { "asc-payout-windows-arm64.exe" } else { "asc-payout-windows-x64.exe" }
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
                throw "Download failed. Check your internet connection and try again."
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
        # A running asc-payout (or ascp) can be renamed, not overwritten
        if (Test-Path $exe) { Move-Item $exe "$exe.old-$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())" -Force }
        Copy-Item (Join-Path $work $asset) $exe -Force

        # The short name: ascp.exe is the same file (a hard link), so it takes no space
        $short = Join-Path $binDir "ascp.exe"
        # only an earlier asc-payout is moved aside (another program's ascp prints something else)
        if ((Test-Path $short) -and ((& $short --version 2>$null) -match '^\d+\.\d+\.\d+$')) { Move-Item $short "$short.old-$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())" -Force -ErrorAction SilentlyContinue }
        if (-not (Test-Path $short)) { New-Item -ItemType HardLink -Path $short -Target $exe -ErrorAction SilentlyContinue | Out-Null }

        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if (-not $userPath) { $userPath = "" }
        if (-not $env:ASC_PAYOUT_NO_MODIFY_PATH -and ($userPath -split ';') -notcontains $binDir) {
            [Environment]::SetEnvironmentVariable("Path", ((@($userPath.TrimEnd(';'), $binDir) | Where-Object { $_ }) -join ';'), "User")
            $env:Path = "$env:Path;$binDir"
            Write-Host "Added $binDir to your PATH (new terminals will find asc-payout)."
        }
        Write-Host "Installed $(& $exe --version) to $exe (also: ascp)"
        Write-Host "Next: asc-payout setup    (or try: asc-payout demo)"
    }
    finally {
        Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    }
}
