import React from 'react';
import { Link } from 'react-router-dom';

/**
 * 隐私政策页面。
 *
 * ⚠️ 本页文案为**占位模板**,上线前必须由法务/运营完成 review,并替换:
 *   - {{COMPANY_NAME}}    — 公司主体名称
 *   - {{CONTACT_EMAIL}}   — 隐私事务联系邮箱
 *   - {{DPO_EMAIL}}       — 数据保护官 (DPO) 邮箱(欧盟用户)
 *   - {{EFFECTIVE_DATE}}  — 隐私政策生效日期
 *
 * 国内运营需符合《个人信息保护法》《数据安全法》《网络安全法》;
 * 欧盟用户需符合 GDPR;加州用户需符合 CCPA。
 */
export function Privacy() {
  return (
    <div className="min-h-screen bg-zinc-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">← 返回首页</Link>

        <h1 className="mt-6 text-3xl font-bold text-gray-900">隐私政策</h1>
        <p className="mt-2 text-sm text-gray-500">生效日期:{'{{EFFECTIVE_DATE}}'}</p>

        <div className="mt-8 space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">1. 我们收集的信息</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>账号信息</strong>:邮箱、加密后的密码、注册时间。</li>
              <li><strong>使用信息</strong>:文档生成次数、使用的 AI 模型、Token 消耗量等。</li>
              <li><strong>支付信息</strong>:订单号、金额、支付状态(支付通道相关的银行卡号等敏感信息由支付服务商保存,我们不存储)。</li>
              <li><strong>设备/环境信息</strong>:IP 地址、浏览器版本、操作系统(用于安全风控和限流)。</li>
              <li><strong>您上传的文档内容</strong>:仅用于提供本服务,不用于训练 AI 模型。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">2. 我们如何使用这些信息</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>提供文档处理、付费、用户中心等核心服务。</li>
              <li>识别异常登录、防止账号被盗用(基于 IP 限流)。</li>
              <li>发送账号通知邮件(验证码、续费提醒、重要安全提示)。</li>
              <li>在征得您同意后,发送产品更新与营销信息(您可随时取消订阅)。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">3. 第三方共享</h2>
            <p>我们仅在以下情况与第三方共享您的信息,并要求其遵守同等的保密义务:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>AI 模型提供方</strong>(Google Gemini / OpenAI 等):仅在生成文档时传输必要内容。</li>
              <li><strong>支付服务提供方</strong>(支付宝 / 微信支付 / Stripe):处理支付与退款。</li>
              <li><strong>邮件服务提供方</strong>(SMTP):投递账号相关邮件。</li>
              <li><strong>云基础设施</strong>(Supabase):数据库与存储。</li>
              <li><strong>法律强制要求</strong>:司法机关、监管机关的合法调查请求。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">4. Cookie 与本地存储</h2>
            <p>我们使用 localStorage 保存登录 token、语言偏好等。我们**不使用**第三方广告 Cookie,**不进行**跨站追踪。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">5. 数据保留与删除</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>账号有效期内:数据保留以提供服务。</li>
              <li>账号删除后:用户、文档、订单、使用记录立即从数据库永久删除。</li>
              <li>法律要求保留的财税记录(如订单)我们将保留法定年限,但与个人身份解除关联。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">6. 您的权利</h2>
            <p>您对您的个人信息享有以下权利:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>查询权</strong>:在用户中心查看个人资料、订单记录。</li>
              <li><strong>更正权</strong>:在用户中心修改邮箱、手机号。</li>
              <li><strong>删除权</strong>:在用户中心删除账号(GDPR 第 17 条、《个人信息保护法》第 47 条)。</li>
              <li><strong>数据导出权</strong>:发邮件至 <a href="mailto:{{CONTACT_EMAIL}}" className="text-indigo-600 underline">{'{{CONTACT_EMAIL}}'}</a> 申请导出您的全部数据。</li>
              <li><strong>撤回同意</strong>:可随时取消营销邮件订阅;撤回账号同意需通过删除账号实现。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">7. 未成年人保护</h2>
            <p>本服务不面向 14 周岁以下的未成年人。如您是未成年人的监护人并发现其在未经您同意的情况下使用本服务,请通过下方联系方式与我们联系,我们将立即删除相关账号。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">8. 政策变更</h2>
            <p>我们可能根据法律法规变化或服务调整修订本政策,届时将通过站内公告或邮件通知您。继续使用本服务即视为您接受修订后的政策。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">9. 联系我们</h2>
            <p>如对本政策、您的隐私权或数据保护有任何疑问,请通过 <a href="mailto:{{CONTACT_EMAIL}}" className="text-indigo-600 underline">{'{{CONTACT_EMAIL}}'}</a> 与我们联系。欧盟用户可联系数据保护官 <a href="mailto:{{DPO_EMAIL}}" className="text-indigo-600 underline">{'{{DPO_EMAIL}}'}</a>。</p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200 text-xs text-gray-400">
          <Link to="/terms" className="hover:text-gray-700">用户协议</Link> · <Link to="/" className="hover:text-gray-700">返回首页</Link>
        </div>
      </div>
    </div>
  );
}

export default Privacy;
