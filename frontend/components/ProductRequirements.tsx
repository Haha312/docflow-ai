import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ProductRequirements: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative z-10 bg-white w-full max-w-3xl mx-4 max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{t('help.title', '使用说明')}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{t('help.subtitle', 'DocFlow AI 智能排版助手')}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-8 space-y-8 bg-gray-50">

          {/* Quick Start */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('help.section_quick_start', '三步完成排版')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  step: '1',
                  title: t('help.qs_1_title', '粘贴或上传'),
                  desc: t('help.qs_1_desc', '直接粘贴文字，或拖入 .docx / .txt / .md 文件（单文件最大 100MB）')
                },
                {
                  step: '2',
                  title: t('help.qs_2_title', '选择模板'),
                  desc: t('help.qs_2_desc', '5 种专业预设（论文、期刊、公文等），支持完全自定义')
                },
                {
                  step: '3',
                  title: t('help.qs_3_title', '开始生成'),
                  desc: t('help.qs_3_desc', '点击「开始排版」，生成完成后可预览、对比原文并下载')
                }
              ].map(item => (
                <div key={item.step} className="bg-white p-4 rounded-xl border border-gray-200">
                  <div className="w-6 h-6 bg-gray-900 text-white rounded-md flex items-center justify-center text-xs font-bold mb-3">
                    {item.step}
                  </div>
                  <h4 className="font-medium text-gray-900 text-sm">{item.title}</h4>
                  <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Core Features */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('help.section_core_features', '核心功能')}</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  icon: '⚡',
                  title: t('help.cf_1_title', 'AI 结构识别'),
                  desc: t('help.cf_1_desc', '自动识别标题层级、段落、列表、图表与数学公式，精准重构文档骨架')
                },
                {
                  icon: '🔍',
                  title: t('help.cf_2_title', '内容完整性核对'),
                  desc: t('help.cf_2_desc', '生成后并排对比原文与结果，自动标注内容是否完整（无丢失、截断），确保只改格式、不改文字')
                },
                {
                  icon: '🎨',
                  title: t('help.cf_3_title', '自定义排版样式'),
                  desc: t('help.cf_3_desc', '点击模板右上角「自定义」，调整字体、字号、行距、缩进等 20+ 参数')
                },
                {
                  icon: '📄',
                  title: t('help.cf_4_title', '.docx 一键导出'),
                  desc: t('help.cf_4_desc', '生成完成后点击右上角「下载 .docx」，导出标准 Word 文档，可直接编辑')
                },
                {
                  icon: '✅',
                  title: t('help.cf_5_title', '格式合规检查'),
                  desc: t('help.cf_5_desc', '按《GB/T 9704》党政机关公文、毕业论文等标准，自动核对字体、字号、行距、页边距是否达标')
                }
              ].map(item => (
                <div key={item.title} className="bg-white p-4 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">{item.icon}</span>
                    <h4 className="font-medium text-gray-900 text-sm">{item.title}</h4>
                  </div>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('help.section_faq', '常见问题')}</h3>
            <div className="space-y-3">
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h4 className="font-medium text-gray-900 text-sm">{t('help.faq_1_title', '如何获得更多生成额度？')}</h4>
                <p className="text-xs text-gray-500 mt-1">
                  {t('help.faq_1_desc', '注册即享初始免费额度。额度用尽后，点击右上角头像选择「升级套餐」，解锁 Plus / Pro / Ultra 更多次数与高级模型。')}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h4 className="font-medium text-gray-900 text-sm">{t('help.faq_2_title', '支持哪些文档格式和大小？')}</h4>
                <p className="text-xs text-gray-500 mt-1">
                  {t('help.faq_2_desc', '支持 .docx（Word）、.txt（纯文本）、.md（Markdown）格式，单文件最大 100MB。暂不支持旧版 .doc 格式，请另存为 .docx 后上传。')}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h4 className="font-medium text-gray-900 text-sm">{t('help.faq_3_title', '文档中的数学公式会保留吗？')}</h4>
                <p className="text-xs text-gray-500 mt-1">
                  {t('help.faq_3_desc', '支持 LaTeX 格式的数学公式（$...$ 行内，$$...$$ 独立块）。上传 .docx 时会自动提取 Word 公式并转换为 LaTeX，排版后在导出的 Word 中正常显示。')}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h4 className="font-medium text-gray-900 text-sm">{t('help.faq_4_title', '生成结果不满意怎么办？')}</h4>
                <p className="text-xs text-gray-500 mt-1">
                  {t('help.faq_4_desc', '可以点击「自定义」调整字体、行距等排版参数后重新生成；也可以先下载 .docx，在 Word 中手动微调。建议对长文档使用高质量模型（Gemini Pro）以获得最佳结构识别效果。')}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h4 className="font-medium text-gray-900 text-sm">{t('help.faq_5_title', '我的文档会被保存吗？')}</h4>
                <p className="text-xs text-gray-500 mt-1">
                  {t('help.faq_5_desc', '不会。文档仅在生成时临时处理，结果只返回给你下载，服务器不保存任何文档内容，请放心。')}
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="px-8 py-4 border-t border-gray-100 bg-white">
          <button
            onClick={onClose}
            className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            {t('help.get_started', '知道了，开始使用')}
          </button>
        </div>
      </div>
    </div>
  );
};
