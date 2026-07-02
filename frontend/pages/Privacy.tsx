import React from 'react';
import { Link } from 'react-router-dom';

const PRODUCT_NAME = 'DocFlow';
const COMPANY_NAME = '北京昆仑九章科技有限公司';
const CONTACT_EMAIL = 'DocFlowAI@163.com';
const EFFECTIVE_DATE = '2026年7月1日';

export const privacySections = [
  {
    title: '1. 适用范围',
    paragraphs: [
      `本《隐私与保密条款》（以下简称“本条款”）适用于 ${COMPANY_NAME} 通过 ${PRODUCT_NAME} 向您提供的网站、客户端、智能排版、图片识别、Word 导出、会员支付、用户中心及相关服务。`,
      '本条款说明我们如何收集、使用、保存、共享和保护您的个人信息、账号信息、订单信息以及您上传或生成的文档内容。'
    ]
  },
  {
    title: '2. 我们收集的信息',
    paragraphs: [
      '为提供服务、保障安全、完成交易和履行法律义务，我们可能在必要范围内处理以下信息：'
    ],
    items: [
      '账号与登录信息：手机号、短信验证码状态、登录令牌、注册时间、登录时间、账号状态、会员等级等。',
      '文档与任务信息：您上传、粘贴或拖入的文字、Word、txt、md、图片、表格、公式、标题结构、排版要求、生成结果、导出的 Word 文件及处理状态。',
      '订单与会员信息：订单号、套餐类型、支付金额、支付渠道、支付状态、退款状态、会员有效期、额度消耗记录等。银行卡号、支付密码等敏感支付信息由支付机构处理，我们不保存。',
      '设备与日志信息：IP 地址、浏览器类型、操作系统、访问时间、页面操作、错误日志、接口调用记录、模型调用状态、文件大小、处理耗时等。',
      '沟通与反馈信息：您通过客服、邮件、用户中心、退款申请或问题反馈提交的联系方式、问题描述、截图、订单信息和处理记录。'
    ]
  },
  {
    title: '3. 我们如何使用信息',
    items: [
      '完成账号注册、登录验证、身份识别、会员权益发放和额度统计。',
      '解析、识别、重排、校验、导出您提交的文档、图片、表格和其他内容。',
      '调用 AI 模型、文档解析、图片识别、格式检查、Word 生成等能力完成您的排版任务。',
      '处理订单、支付、退款、发票或售后服务。',
      '排查故障、保障系统稳定、识别异常请求、防范欺诈、攻击、滥用和违规使用。',
      '根据法律法规、监管要求或司法机关要求进行必要的留存、审计和配合。'
    ]
  },
  {
    title: '4. 文档内容的保密承诺',
    paragraphs: [
      '我们理解您上传的文档、图片、表格、合同、论文、报告、方案或其他材料可能包含商业信息、研究成果、个人信息或内部资料。因此，我们对用户内容作出以下承诺：'
    ],
    items: [
      '除为完成您发起的识别、排版、校验、导出、保存、客服排障或法律合规目的外，我们不会主动查看、使用或处理您的非公开文档内容。',
      '未经您明确授权，我们不会将您的非公开文档公开展示、提供给其他用户、用于广告宣传，或作为公开案例披露。',
      '未经您明确授权，我们不会将您的非公开文档用于训练公开模型或向第三方出售。',
      '我们会通过权限控制、日志记录、必要最小化访问和安全管理制度，限制内部人员接触用户内容。',
      '如您主动要求我们协助排查问题，可能需要提供相关文件、截图或任务信息；我们会仅在处理该问题所需范围内使用。'
    ]
  },
  {
    title: '5. 您不应上传的内容',
    paragraphs: [
      '为了保护您和第三方权益，也为了满足法律法规要求，请不要将以下内容上传至本服务：'
    ],
    items: [
      '国家秘密、工作秘密、军事秘密、未公开监管资料或依法不得通过互联网服务处理的内容。',
      '未经授权的商业秘密、客户资料、第三方机密文件、内部招投标文件、未披露财务数据等。',
      '大量身份证件、银行账户、支付凭证、生物识别、精确定位、医疗健康、未成年人信息等敏感个人信息。',
      '侵犯他人知识产权、隐私权、名誉权、肖像权或其他合法权益的内容。',
      '法律法规禁止上传、传播、处理或生成的其他内容。'
    ]
  },
  {
    title: '6. 第三方服务与共享',
    paragraphs: [
      '为实现短信登录、AI 识别、文档生成、支付和基础设施运行，我们可能在必要范围内向第三方服务提供商传输必要信息。我们会要求相关第三方按照合同、隐私政策和法律法规承担保密与安全义务。'
    ],
    items: [
      '短信服务：可能使用腾讯云短信等服务发送登录验证码和安全通知。',
      'AI 与图片识别服务：可能使用 DeepSeek、火山引擎豆包视觉模型或其他经配置的模型服务处理您主动提交的文本、图片和排版任务。',
      '支付服务：可能使用微信支付、支付宝或其他支付机构处理付款、退款和交易状态同步。',
      '云服务与安全服务：可能使用服务器、数据库、对象存储、CDN、日志、安全防护等基础设施提供商保障服务运行。',
      '法律合规：在司法机关、行政机关、监管机构依法提出要求，或为维护我们、用户、公众的合法权益所必需时，我们可能依法披露必要信息。'
    ]
  },
  {
    title: '7. 存储、保留与删除',
    items: [
      '排版任务产生的输入、输出、图片、导出文件和历史记录，会在实现服务目的所需期间内保存；如产品提供历史文档功能，相关内容会在您的账号中保留，直到您主动删除或账号注销。',
      '订单、支付、退款、发票、争议处理和安全日志会根据法律法规、财税要求、风控需要和争议解决需要保留必要期限。',
      '您删除文档或注销账号后，我们会在合理时间内从业务系统删除或匿名化相关信息。因备份、日志、安全审计或法律要求暂时无法立即删除的，我们会限制访问并在备份更新周期内处理。',
      '如果您需要删除历史文档、注销账号或撤回授权，可通过产品内入口或联系邮箱提交请求。'
    ]
  },
  {
    title: '8. 安全保护措施',
    items: [
      '我们会采用访问控制、传输加密、密钥管理、权限隔离、日志审计、异常监控、备份恢复等合理安全措施保护您的信息。',
      '我们会尽量限制员工、承包商、服务商在必要范围内访问数据，并要求其遵守保密义务。',
      '互联网环境并非绝对安全。请您妥善保管账号、验证码、设备和导出文件，不要将敏感文件上传到不可信网络或转发给无关人员。',
      '如发生个人信息安全事件，我们将按照法律法规要求采取补救措施，并通过页面通知、邮件、短信或其他合理方式告知受影响用户。'
    ]
  },
  {
    title: '9. Cookie、本地存储与偏好设置',
    paragraphs: [
      '我们可能使用 Cookie、localStorage 或类似技术保存登录状态、语言、主题、界面偏好、风控标识和必要的服务状态。您可以通过浏览器设置清除或限制这些信息，但可能导致登录状态失效或部分功能不可用。',
      '除非另行明确告知并取得必要授权，我们不会使用第三方广告 Cookie 对您进行跨站广告追踪。'
    ]
  },
  {
    title: '10. 您的个人信息权利',
    paragraphs: [
      '根据适用法律法规，您可以就个人信息向我们提出以下请求：'
    ],
    items: [
      '查询、复制、更正或补充您的账号信息、订单信息和可见历史记录。',
      '删除您主动上传或保存的文档、历史记录，或在符合法律条件时请求删除个人信息。',
      '撤回已作出的授权或同意，但撤回不影响此前基于授权已进行的信息处理。',
      '注销账号。账号注销后，您将无法继续使用该账号及其会员权益、历史文档和订单功能。',
      '对我们的个人信息处理规则进行咨询、投诉或举报。'
    ]
  },
  {
    title: '11. 未成年人信息保护',
    paragraphs: [
      '本服务主要面向成年人及组织用户。未成年人使用本服务前，应取得监护人同意。若我们发现未在监护人同意下处理未成年人个人信息，会依法尽快删除或采取其他保护措施。监护人如发现相关情况，可联系我们处理。'
    ]
  },
  {
    title: '12. 跨境处理',
    paragraphs: [
      '我们优先选择在中国境内可用的云服务、短信服务、支付服务和 AI 服务。若未来因模型能力、基础设施或业务需要发生个人信息跨境处理，我们会按照适用法律法规履行告知、同意、评估、认证、合同或备案等义务。'
    ]
  },
  {
    title: '13. 条款更新',
    paragraphs: [
      '我们可能根据法律法规、监管要求、产品功能、第三方服务或经营安排更新本条款。发生重大变更时，我们会通过页面公告、弹窗、站内信、邮件或其他合理方式提示您。您继续使用本服务的，视为接受更新后的条款。'
    ]
  },
  {
    title: '14. 联系我们',
    paragraphs: [
      `如您对隐私、保密、文档删除、账号注销、订单记录或数据安全有任何问题，请通过邮箱 ${CONTACT_EMAIL} 联系我们。为保护账号安全，我们可能需要您提供必要信息以核验身份和请求真实性。`
    ]
  }
];

export function Privacy() {
  return (
    <main className="legal-page bg-[var(--df-bg)] px-4 py-10 text-[var(--df-text)] sm:px-6 lg:px-8">
      <article className="mx-auto max-w-4xl">
        <Link
          to="/"
          className="inline-flex items-center rounded-full border border-[var(--df-border)] bg-[var(--df-soft)] px-4 py-2 text-sm text-[var(--df-text-muted)] transition hover:bg-[var(--df-soft-2)] hover:text-[var(--df-text)]"
        >
          返回首页
        </Link>

        <header className="mt-8 border-b border-[var(--df-border)] pb-8">
          <p className="text-sm font-medium text-[var(--df-text-muted)]">{COMPANY_NAME}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-[var(--df-text)] sm:text-4xl">
            {PRODUCT_NAME} 隐私与保密条款
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--df-text-muted)]">
            生效日期：{EFFECTIVE_DATE}。本条款说明我们如何处理您的个人信息、订单信息、上传文档、图片识别内容和导出结果。
          </p>
        </header>

        <div className="mt-8 space-y-8 text-sm leading-7 text-[var(--df-text-muted)]">
          {privacySections.map((section) => (
            <section key={section.title} className="rounded-[8px] border border-[var(--df-border)] bg-[var(--df-surface)] p-6">
              <h2 className="text-lg font-semibold text-[var(--df-text)]">{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-3">
                  {paragraph}
                </p>
              ))}
              {section.items && (
                <ul className="mt-3 list-disc space-y-2 pl-5">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <footer className="mt-10 flex flex-wrap items-center gap-3 border-t border-[var(--df-border)] pt-6 text-sm text-[var(--df-text-muted)]">
          <Link to="/terms" className="hover:text-[var(--df-text)]">
            用户协议
          </Link>
          <span>·</span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[var(--df-text)]">
            {CONTACT_EMAIL}
          </a>
        </footer>
      </article>
    </main>
  );
}

export default Privacy;
