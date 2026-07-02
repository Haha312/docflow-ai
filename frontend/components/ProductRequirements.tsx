import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ProductRequirements: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const steps = [
    {
      step: '1',
      title: t('help.step_upload_title', '上传或粘贴'),
      desc: t('help.step_upload_desc', '支持 Word、txt、md、图片，也可以直接 Ctrl+V 粘贴文字或截图。')
    },
    {
      step: '2',
      title: t('help.step_style_title', '选择排版标准'),
      desc: t('help.step_style_desc', '选择报告/论文、机关公文、工作汇报/方案、会议纪要等模板，需要更细时再进入自定义。')
    },
    {
      step: '3',
      title: t('help.step_export_title', '生成并下载'),
      desc: t('help.step_export_desc', '系统完成识别、排版和检查后，直接下载可编辑的 Word 文档。')
    }
  ];

  const notes = [
    {
      title: t('help.note_formats_title', '支持内容'),
      desc: t('help.note_formats_desc', '.docx / .txt / .md / 图片；旧版 .doc 建议先另存为 .docx。')
    },
    {
      title: t('help.note_long_title', '长文档'),
      desc: t('help.note_long_desc', '长文档会分段处理并做完整性检查，生成时间会更久。')
    },
    {
      title: t('help.note_privacy_title', '隐私'),
      desc: t('help.note_privacy_desc', '文档仅用于本次排版处理，不在页面中公开展示给其他用户。')
    }
  ];

  return (
    <div className="prism-modal help-modal fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="help-modal-backdrop absolute inset-0"
        onClick={onClose}
        aria-label={t('common.close', '关闭')}
      />

      <div className="help-panel relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-2xl">
        <div className="help-header flex items-start justify-between gap-6 px-6 py-5">
          <div>
            <h2 className="help-title text-lg font-medium">{t('help.title', '使用帮助')}</h2>
            <p className="help-subtitle mt-1 text-sm">{t('help.subtitle', '上传文档，选择标准，生成 Word。')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="help-close flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
            aria-label={t('common.close', '关闭')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="help-body space-y-5 px-6 py-5">
          <div className="space-y-3">
            {steps.map((item) => (
              <div key={item.step} className="flex gap-3">
                <div className="help-step-index mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                  {item.step}
                </div>
                <div>
                  <h3 className="help-step-title text-sm font-medium">{item.title}</h3>
                  <p className="help-step-desc mt-0.5 text-sm leading-6">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="help-notes rounded-xl px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {notes.map((item) => (
                <div key={item.title}>
                  <div className="help-note-title text-xs font-medium">{item.title}</div>
                  <p className="help-note-desc mt-1 text-xs leading-5">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="help-footer px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="help-primary prism-primary w-full rounded-full py-3 text-sm font-medium transition-colors"
          >
            {t('help.get_started', '知道了')}
          </button>
        </div>
      </div>
    </div>
  );
};
