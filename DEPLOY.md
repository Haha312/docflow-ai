# DocFlow 部署指南(腾讯云轻量应用服务器)

技术栈:Node.js/Express 后端(TypeScript,编译后用 PM2 常驻)+ Prisma/PostgreSQL 数据库 + React/Vite 前端(静态文件,Nginx 直接托管)+ Nginx 反向代理与 HTTPS。不用 Docker,轻量服务器上直接装环境最省事。

**部署域名:`docflow.kunlunjz.com.cn`**(单域名,前端静态文件 + `/api/` 反代到后端,同源,不用配 CORS)。
`kunlunjz.com.cn` 下的 `autoflow` 子域名已被 FlowAI 项目占用,本项目用 `docflow` 前缀,注意别混。

---

## 0. 部署前必须确认(否则起不来或起来了也是坏的)

- [x] 域名 `docflow.kunlunjz.com.cn` 已在 DNSPod 加了 A 记录指向服务器公网 IP
- [ ] **ICP 备案**(腾讯云对绑定域名的 80/443 访问有备案要求,不备案很多场景会被拦;`kunlunjz.com.cn` 主域名如果已经备案过,子域名通常不用重新备案,双重确认一下)
- [ ] `backend/.env` 在**服务器上**单独配置(不是从本地复制开发用的那份——本地那份 `BACKEND_URL`/`PUBLIC_URL` 还写着 FlowAI 的 `autoflow.kunlunjz.com.cn`,不能照抄):
  - `NODE_ENV=production`
  - `BACKEND_URL` / `PUBLIC_URL` = `https://docflow.kunlunjz.com.cn`
  - `FRONTEND_URL` = `https://docflow.kunlunjz.com.cn`(单域名部署下主要是满足启动校验,浏览器请求本来就同源)
  - `DATABASE_URL`、`JWT_SECRET`、腾讯云短信 5 项、微信支付 7 项均已填真实值(参照 `backend/.env.example`)
  - `REDIS_URL` 选填;不填会用内存版,重启会清空验证码/封号/支付回调防重放状态(团队已评估接受此风险,见 `server.ts` 的 `validateProductionEnv`)
- [ ] `frontend/.env.production.local` 的 `VITE_API_URL=https://docflow.kunlunjz.com.cn`——**这个是打包时写死进静态文件的,构建前必须改对,改完要重新 build**
- [ ] 微信支付回调地址、腾讯云短信签名的报备信息与 `docflow.kunlunjz.com.cn` 一致(如果之前报备的是别的域名,微信支付那边可能需要重新配置回调地址白名单)

---

## 1. 服务器基础环境

SSH 登录轻量服务器(以 Ubuntu 为例):

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# PM2(进程守护 + 开机自启)
sudo npm install -g pm2

# 可选:本地 Redis(比云托管版省钱,单机够用)
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
```

---

## 2. 拉取代码

```bash
sudo mkdir -p /var/www && sudo chown $USER:$USER /var/www
cd /var/www
git clone https://<token>@github.com/Haha312/docflow-ai.git
cd docflow-ai
```

私有仓库,`<token>` 用 GitHub Fine-grained Personal Access Token(只给 `docflow-ai` 仓库 Contents 只读权限)。国内服务器直连 GitHub 偶发 TLS 中断/超时,多试几次;持续失败就换 SSH 协议或从本地直传。

---

## 3. 后端部署

```bash
cd backend
npm install

# 手动创建生产 .env(不要从本地 scp 开发版过来,里面全是 localhost)
nano .env   # 按 .env.example 填,NODE_ENV=production

npx prisma generate
npx prisma migrate deploy      # 应用数据库迁移(不是 migrate dev)
npm run build                  # tsc 编译到 dist/

# 首次创建管理员账号(可选,按需)
node scripts/seed-admin.js

pm2 start dist/server.js --name docflow-backend
pm2 save
pm2 startup                    # 按提示执行它输出的那条命令,设置开机自启
```

改代码后重新部署:`git pull && npm run build && pm2 restart docflow-backend`。

---

## 4. 前端部署

```bash
cd ../frontend
echo "VITE_API_URL=https://docflow.kunlunjz.com.cn" > .env.production.local
npm install
npm run build       # 产物在 frontend/dist/
```

`dist/` 目录直接交给 Nginx 托管(见下一步),不需要 PM2 常驻——它是纯静态文件。

---

## 5. Nginx 配置

`/etc/nginx/sites-available/docflow`:

```nginx
server {
    listen 80;
    server_name docflow.kunlunjz.com.cn;
    root /var/www/docflow-ai/frontend/dist;
    index index.html;

    # /api/ 开头的请求转给后端,其余交给前端静态文件(单域名同源,不用配 CORS)
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 关键:/api/generate 是 SSE 流式接口,且 AI_TIMEOUT_MS 默认 240000(240秒)。
        # 这两项不加,长文档生成会被 Nginx 提前掐断或缓冲到用户看不到流式效果。
        proxy_buffering off;
        proxy_read_timeout 260s;
    }

    location / {
        try_files $uri $uri/ /index.html;   # SPA 路由回退
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/docflow /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d docflow.kunlunjz.com.cn
```

证书到期 certbot 会自动续期(装的时候会自动加定时任务)。微信支付回调、腾讯云短信都要求 HTTPS,这一步不能省。

HTTPS 生效后,回到 `backend/.env` 把 `ENABLE_HSTS=true` 打开(参照 `.env.example` 注释,加了 HSTS 之后如果哪天想退回 HTTP 会很麻烦,确认证书稳定了再开)。

---

## 7. 部署后验证清单

- [ ] 服务器上 `curl http://127.0.0.1:3001/health` 返回正常(`/health` 没在 `/api/` 前缀下,Nginx 配置没对外代理它,是给服务器内部监控用的,不用暴露到公网)
- [ ] 前端首页能打开,浏览器控制台没有跨域报错
- [ ] 真机测试手机号登录收验证码
- [ ] 跑一次真实文档生成,确认流式输出正常、没有卡在 260s 超时
- [ ] 微信支付走一次沙箱或小额真实支付,确认回调正常记账(**如果没配 Redis,重点测一下"支付中途重启服务"这种边界情况**)
- [ ] 手机号登录后能访问 `/admin`(`ADMIN_PHONES` 配置的号码)
- [ ] `pm2 logs docflow-backend` 看一眼启动日志,确认没有 `[FATAL]` 或异常 `[WARN]`

---

## 常见坑

- **忘记改 `VITE_API_URL` 就 build 了前端**:打包产物里域名是写死的,发现问题必须改完重新 `npm run build`,不能只重启。
- **Nginx 没配 `proxy_buffering off`**:流式生成在前端表现为"卡住很久然后突然全部出现",而不是逐字流出。
- **忘记 ICP 备案**:腾讯云对大陆节点绑定域名有备案要求,不备案域名可能无法正常对外提供 80/443 服务。
- **`prisma migrate deploy` 和 `migrate dev` 搞混**:生产环境永远用 `deploy`,`dev` 会尝试交互式创建迁移,在服务器上会卡住或产生非预期的迁移文件。
