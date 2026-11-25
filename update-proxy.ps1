
$port = 8080

# Detect the active Wi-Fi hotspot gateway
$gateway = Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
    Where-Object { $_.InterfaceAlias -eq "Wi-Fi" } |
    Sort-Object RouteMetric |
    Select-Object -First 1 -ExpandProperty NextHop

if (-not $gateway) {
    Write-Host "No Wi-Fi gateway found."
    exit 1
}

# Check whether the proxy is reachable
$connection = Test-NetConnection $gateway -Port $port -WarningAction SilentlyContinue

if (-not $connection.TcpTestSucceeded) {
    Write-Host "Proxy is not reachable at $gateway`:$port"
    exit 1
}

# Update Windows user proxy environment variables
$proxy = "http://${gateway}:$port"

[Environment]::SetEnvironmentVariable("HTTP_PROXY", $proxy, "User")
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", $proxy, "User")

Write-Host "Proxy updated successfully!"
Write-Host "Address: $proxy"
