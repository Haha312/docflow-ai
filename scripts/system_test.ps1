$ErrorActionPreference = "Stop"
$BackendUrl = $env:SYSTEM_TEST_BACKEND_URL
if (-not $BackendUrl) { $BackendUrl = "http://localhost:3001" }

$TestEmail = $env:SYSTEM_TEST_EMAIL
$TestPassword = $env:SYSTEM_TEST_PASSWORD

Write-Host "Starting backend smoke test against $BackendUrl" -ForegroundColor Cyan

# 1) Health check
Write-Host "`n[1/5] Health check"
try {
    $health = Invoke-RestMethod -Uri "$BackendUrl/health" -Method Get -TimeoutSec 10
    if ($health.status -ne 'ok') {
        throw "Health response status is not ok"
    }
    Write-Host "PASS: backend is healthy" -ForegroundColor Green
} catch {
    Write-Host "FAIL: health check failed: $_" -ForegroundColor Red
    exit 1
}

# 2) Credential check
Write-Host "`n[2/5] Validate test credentials"
if ([string]::IsNullOrWhiteSpace($TestEmail) -or [string]::IsNullOrWhiteSpace($TestPassword)) {
    Write-Host "FAIL: Please set SYSTEM_TEST_EMAIL and SYSTEM_TEST_PASSWORD before running this script." -ForegroundColor Red
    Write-Host "Example: `$env:SYSTEM_TEST_EMAIL='qa@example.com'; `$env:SYSTEM_TEST_PASSWORD='StrongPass123!'" -ForegroundColor Yellow
    exit 1
}
Write-Host "PASS: test credentials found for $TestEmail" -ForegroundColor Green

# 3) Login
Write-Host "`n[3/5] Login"
try {
    $loginBody = @{ email = $TestEmail; password = $TestPassword } | ConvertTo-Json
    $authResp = Invoke-RestMethod -Uri "$BackendUrl/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"

    $token = $null
    if ($authResp.data -and $authResp.data.token) {
        $token = $authResp.data.token
    } elseif ($authResp.token) {
        $token = $authResp.token
    }

    if (-not $token) {
        throw "Login succeeded but token not found in response"
    }

    Write-Host "PASS: login succeeded" -ForegroundColor Green
} catch {
    Write-Host "FAIL: login failed: $_" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# 4) Create checkout session
Write-Host "`n[4/5] Create checkout session"
try {
    $orderBody = @{ planType = "pro_monthly"; paymentMethod = "qrcode" } | ConvertTo-Json
    $orderResp = Invoke-RestMethod -Uri "$BackendUrl/api/payment/create-checkout-session" -Method Post -Headers $headers -Body $orderBody

    if (-not $orderResp.data -or -not $orderResp.data.orderId) {
        throw "Missing orderId in response"
    }

    if (-not $orderResp.data.alipayQrUrl -or -not $orderResp.data.wechatQrUrl) {
        throw "Missing QR image URLs in response"
    }

    Write-Host "PASS: checkout session created" -ForegroundColor Green
    Write-Host "      Order ID: $($orderResp.data.orderId)"
} catch {
    Write-Host "FAIL: checkout session creation failed: $_" -ForegroundColor Red
    exit 1
}

# 5) Verify payment status + QR images
Write-Host "`n[5/5] Verify status and QR assets"
try {
    $orderId = $orderResp.data.orderId
    $statusResp = Invoke-RestMethod -Uri "$BackendUrl/api/payment/status/$orderId" -Method Get -Headers @{ "Authorization" = "Bearer $token" }
    $status = $statusResp.data.status
    if (-not $status) {
        throw "Missing payment status"
    }

    $alipayUrl = "$BackendUrl$($orderResp.data.alipayQrUrl)"
    $wechatUrl = "$BackendUrl$($orderResp.data.wechatQrUrl)"

    $alipayImg = Invoke-WebRequest -Uri $alipayUrl -Method Get -TimeoutSec 10
    $wechatImg = Invoke-WebRequest -Uri $wechatUrl -Method Get -TimeoutSec 10

    if ($alipayImg.StatusCode -ne 200 -or $wechatImg.StatusCode -ne 200) {
        throw "QR image status is not 200"
    }

    Write-Host "PASS: payment status = $status" -ForegroundColor Green
    Write-Host "PASS: QR assets are accessible" -ForegroundColor Green
} catch {
    Write-Host "FAIL: verification step failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nAll smoke checks passed." -ForegroundColor Cyan
