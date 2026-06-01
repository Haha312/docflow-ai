import React from 'react';
import { Link } from 'react-router-dom';

/**
 * 用户协议页面。
 *
 * ⚠️ 本页文案为**占位模板**,上线前必须由法务/运营完成 review,并替换:
 *   - {{COMPANY_NAME}}    — 公司主体名称
 *   - {{CONTACT_EMAIL}}   — 客服/法务联系邮箱
 *   - {{EFFECTIVE_DATE}}  — 协议生效日期
 *   - {{JURISDICTION}}    — 适用法律管辖
 *
 * 适用法律建议:中国大陆运营建议适用《中华人民共和国民法典》、
 * 《电子商务法》、《消费者权益保护法》;海外可考虑 Delaware 法。
 */
export function Terms() {
  return (
    <div className="min-h-screen bg-zinc-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 红色 banner — 提醒未完成 */}
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-semibold text-red-700">
            ⚠️ 本页文案为占位模板,上线前请由法务/运营完成 review,替换所有 <code>{'{{...}}'}</code> 占位符。
          </p>
        </div>

        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">← 返回首页</Link>

        <h1 className="mt-6 text-3xl font-bold text-gray-900">用户协议</h1>
        <p className="mt-2 text-sm text-gray-500">生效日期:{'{{EFFECTIVE_DATE}}'}</p>

        <div className="mt-8 space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">1. 协议范围</h2>
            <p>本协议为您与 <strong>{'{{COMPANY_NAME}}'}</strong>(以下简称"我们")之间就使用 DocFlow AI 服务(以下简称"本服务")订立的法律协议。注册或使用本服务即视为您已阅读、理解并同意本协议全部内容。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">2. 服务内容</h2>
            <p>本服务为您提供基于人工智能的文档结构识别、排版重构、格式导出等功能。我们保留随时调整服务内容、收费标准的权利,届时将通过站内公告或邮件通知您。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">3. 账号注册与使用</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>您需提供有效邮箱完成注册,并对账号密码安全负责。</li>
              <li>禁止将账号转让、出租或与他人共享;违者我们有权封禁账号。</li>
              <li>您承诺不利用本服务进行违法、侵权或违反公序良俗的活动。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">4. 知识产权</h2>
            <p>本服务的软件、界面设计、商标、文档模板等均为我们或合法授权方所有。您上传的文档内容版权归您所有;您授权我们在提供服务过程中处理、传输、存储该内容,但不会用于训练 AI 模型或第三方共享(法律强制要求除外)。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">5. 付费与退款</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>付费会员一经购买立即生效,可在用户中心查看到期日期。</li>
              <li>您有权在用户中心申请退款,我们将在 1-3 个工作日内将款项原路退回。</li>
              <li>退款后会员立即降级为免费版,本月剩余额度作废。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">6. 免责</h2>
            <p>本服务依据 AI 模型自动生成内容,我们不对生成结果的准确性、完整性、适用性提供任何明示或暗示的保证。在法律允许的最大范围内,我们对您因使用本服务而产生的任何间接、附带或后果性损失不承担责任。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">7. 协议终止</h2>
            <p>您可随时在用户中心删除账号以终止本协议。账号删除后,您的所有数据将被永久删除且无法恢复。我们也保留在您违反本协议时单方面终止服务的权利。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">8. 适用法律</h2>
            <p>本协议的订立、履行、解释及争议解决均适用 <strong>{'{{JURISDICTION}}'}</strong>。如发生争议,双方应友好协商;协商不成的,任何一方均可向 <strong>{'{{COMPANY_NAME}}'}</strong> 所在地有管辖权的人民法院提起诉讼。</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">9. 联系我们</h2>
            <p>如对本协议有任何疑问,请通过 <a href="mailto:{{CONTACT_EMAIL}}" className="text-indigo-600 underline">{'{{CONTACT_EMAIL}}'}</a> 与我们联系。</p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200 text-xs text-gray-400">
          <Link to="/privacy" className="hover:text-gray-700">隐私政策</Link> · <Link to="/" className="hover:text-gray-700">返回首页</Link>
        </div>
      </div>
    </div>
  );
}

export default Terms;
