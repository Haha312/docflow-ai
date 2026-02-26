$ErrorActionPreference = "Stop"
$FrontendUrl = "http://localhost:3000"
$BackendUrl = "http://localhost:3001"

Write-Host "🚀 Starting System Backend Test..." -ForegroundColor Cyan

# 1. Health Check
Write-Host "`n[1/4] Checking Backend Health..."
try {
    $health = Invoke-RestMethod -Uri "$BackendUrl/health" -Method Get
    if ($health.status -eq 'ok') {
        Write-Host "✅ Backend is HEALTHY" -ForegroundColor Green
    } else {
        Write-Host "❌ Backend Health Check FAILED" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Failed to connect to Backend: $_" -ForegroundColor Red
    exit 1
}

# 2. Register/Login Auto User
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$email = "auto_test_$timestamp@test.com"
$password = "TestApp123!"

Write-Host "`n[2/4] Registering Test User ($email)..."
$registerBody = @{
    email = $email
    password = $password
    name = "Auto Tester"
} | ConvertTo-Json

try {
    $auth = Invoke-RestMethod -Uri "$BackendUrl/api/auth/register" -Method Post -Body $registerBody -ContentType "application/json"
    $token = $auth.token
    Write-Host "✅ Registration Successful. Token acquired." -ForegroundColor Green
} catch {
    # If already exists (unlikely with timestamp), try login
    Write-Host "⚠️ Registration failed (maybe user exists), trying login..."
    try {
        $loginBody = @{ email = $email; password = $password } | ConvertTo-Json
        $auth = Invoke-RestMethod -Uri "$BackendUrl/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
        $token = $auth.token
        Write-Host "✅ Login Successful. Token acquired." -ForegroundColor Green
    } catch {
        Write-Host "❌ Auth Failed: $_" -ForegroundColor Red
        exit 1
    }
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# 3. Create Payment Order (Alipay QR)
Write-Host "`n[3/4] Creating Payment Order (Alipay QR)..."
$orderBody = @{
    planType = "pro_monthly"
    paymentMethod = "qrcode"  # Testing the QR code flow we modified
} | ConvertTo-Json

try {
    $order = Invoke-RestMethod -Uri "$BackendUrl/api/payment/create-checkout-session" -Method Post -Headers $headers -Body $orderBody
    
    if ($order.success -eq $true -and $order.data.orderId) {
        Write-Host "✅ Order Created Successfully." -ForegroundColor Green
        Write-Host "   Order ID: $($order.data.orderId)"
        Write-Host "   Alipay QR URL: $($order.data.alipayQrUrl)"
        Write-Host "   WeChat QR URL: $($order.data.wechatQrUrl)"
    } else {
        Write-Host "❌ Order Creation Failed or Unexpected Response" -ForegroundColor Red
        Write-Host ($order | ConvertTo-Json -Depth 5)
    }
} catch {
    Write-Host "❌ Order Creation Failed: $_" -ForegroundColor Red
    exit 1
}

# 4. Verify Static Assets (QR Images)
Write-Host "`n[4/4] Verifying QR Code Images..."
$qrPath = $order.data.alipayQrUrl
try {
    $img = Invoke-WebRequest -Uri "$BackendUrl$qrPath" -Method Get
    if ($img.StatusCode -eq 200) {
        Write-Host "✅ QR Image Accessible ($qrPath)" -ForegroundColor Green
    } else {
        Write-Host "❌ QR Image Not Found ($qrPath)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Failed to fetch QR Image: $_" -ForegroundColor Red
}

Write-Host "`n🎉 All Backend Tests Completed!" -ForegroundColor Cyan
