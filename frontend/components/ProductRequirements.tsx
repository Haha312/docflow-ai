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

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('help.section_quick_start', '快速开始')}</h3>
            <div className="grid grid-cols-3 gap-4">
              {[
                { step: '1', title: t('help.qs_1_title', '上传文档'), desc: t('help.qs_1_desc', '支持 .docx, .txt, .md 格式') },
                { step: '2', title: t('help.qs_2_title', '选择模板'), desc: t('help.qs_2_desc', '报告、期刊、公文等预设') },
                { step: '3', title: t('help.qs_3_title', '一键生成'), desc: t('help.qs_3_desc', 'AI 自动识别结构并排版') }
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

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('help.section_core_features', '核心功能')}</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: '⚡', title: t('help.cf_1_title', 'AI 结构化识别'), desc: t('help.cf_1_desc', '自动识别标题、段落、列表，重构文档骨架') },
                { icon: '📄', title: t('help.cf_2_title', '多格式导出'), desc: t('help.cf_2_desc', '一键下载标准 .docx Word 文档') },
                { icon: '🎨', title: t('help.cf_3_title', '自定义参数'), desc: t('help.cf_3_desc', '自由调整字体、字号、行距等排版参数') },
                { icon: '🔒', title: t('help.cf_4_title', '安全处理'), desc: t('help.cf_4_desc', '加密传输，处理后不永久保留数据') }
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

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('help.section_faq', '常见问题')}</h3>
            <div className="space-y-3">
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h4 className="font-medium text-gray-900 text-sm">{t('help.faq_1_title', '如何获得更多额度？')}</h4>
                <p className="text-xs text-gray-500 mt-1">
                  {t('help.faq_1_desc', '免费用户每日享有一定额度。点击右上角头像升级套餐解锁更多额度和高级模型。')}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <h4 className="font-medium text-gray-900 text-sm">{t('help.faq_2_title', '支持哪些文档类型？')}</h4>
                <p className="text-xs text-gray-500 mt-1">
                  {t('help.faq_2_desc', '目前支持 .docx (Word)、.txt (纯文本)、.md (Markdown) 格式，最大 200MB。')}
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
            {t('help.get_started', '开始使用')}
          </button>
        </div>
      </div>
    </div>
  );
};
