# 支付宝配置指南

## 1. 注册支付宝开放平台账号

访问 [https://open.alipay.com](https://open.alipay.com) 注册开发者账号

## 2. 创建应用

1. 登录支付宝开放平台
2. 进入"控制台" → "网页&移动应用"
3. 点击"创建应用"
4. 选择"网页应用"
5. 填写应用信息并提交审核

## 3. 配置应用

### 3.1 生成密钥

**方式一: 使用支付宝密钥生成工具**
1. 下载工具: https://opendocs.alipay.com/common/02kipl
2. 运行工具,选择 RSA2(SHA256) 密钥长度 2048
3. 生成密钥对:
   - 应用私钥 (ALIPAY_PRIVATE_KEY)
   - 应用公钥 (上传到支付宝)

**方式二: 使用 OpenSSL**
```bash
# 生成私钥
openssl genrsa -out app_private_key.pem 2048

# 生成公钥
openssl rsa -in app_private_key.pem -pubout -out app_public_key.pem
```

### 3.2 上传公钥到支付宝

1. 进入应用详情
2. 找到"接口加签方式(密钥/证书)"
3. 选择"公钥"模式
4. 上传你的应用公钥
5. 保存后,支付宝会生成"支付宝公钥" (ALIPAY_PUBLIC_KEY)

### 3.3 配置回调地址

在应用详情中配置:
- **授权回调地址**: `https://your-domain.com`
- **异步通知地址**: `https://your-domain.com/api/webhook/alipay`

## 4. 添加功能

在应用中添加以下功能:
- **电脑网站支付** (alipay.trade.page.pay)

## 5. 配置环境变量

在 `.env` 文件中添加:

```env
# 支付宝配置
ALIPAY_APP_ID=你的应用APPID
ALIPAY_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----
ALIPAY_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
BACKEND_URL=https://your-domain.com
```

**注意事项**:
- 私钥和公钥需要包含完整的 BEGIN/END 标记
- 换行符使用 `\n` 表示
- 生产环境使用 `https://openapi.alipay.com/gateway.do`
- 沙箱环境使用 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`

## 6. 测试环境 (沙箱)

支付宝提供沙箱环境用于测试:

1. 进入"开发者中心" → "研发服务" → "沙箱"
2. 获取沙箱 APPID
3. 配置沙箱密钥
4. 使用沙箱网关: `https://openapi-sandbox.dl.alipaydev.com/gateway.do`
5. 下载"沙箱钱包"APP 进行测试

沙箱账号:
- 买家账号: 在沙箱页面查看
- 登录密码: 111111
- 支付密码: 111111

## 7. 定价说明

当前配置:
- **月度会员**: ¥68 (Stripe: $9.99)
- **年度会员**: ¥588 (Stripe: $99.99)

可在 `src/routes/payment.ts` 中的 `PRICING` 对象修改。

## 8. 前端集成

当前线上收款已切到微信支付 V3 Native 动态二维码；支付宝只保留旧订单回调/退款兼容，不再作为新订单入口。

微信支付调用示例:

```typescript
// 创建微信官方 Native 支付动态二维码
const response = await fetch('/api/payment/create-checkout-session', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    planType: 'plus_monthly',
    paymentMethod: 'wechat'
  })
});

const { data } = await response.json();
// data.qrCode 是微信官方返回的 code_url，前端将其渲染成动态二维码
```

## 9. 常见问题

### Q: 签名验证失败?
A: 检查私钥格式是否正确,确保包含 BEGIN/END 标记和换行符

### Q: 应用未上线无法使用?
A: 开发阶段使用沙箱环境,正式上线需要提交应用审核

### Q: 回调地址无法访问?
A: 确保服务器已部署到公网,本地开发可使用 ngrok 等内网穿透工具

### Q: 如何测试支付?
A: 使用沙箱环境和沙箱账号进行测试,无需真实付款

## 10. 安全建议

- ✅ 私钥严格保密,不要提交到代码仓库
- ✅ 使用环境变量管理敏感信息
- ✅ 生产环境必须使用 HTTPS
- ✅ 验证所有回调请求的签名
- ✅ 防止订单重复处理
