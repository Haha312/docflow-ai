import React from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ProductRequirements: React.FC<Props> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-zinc-100">
        {/* Header */}
        <div className="bg-zinc-50 px-8 py-5 border-b border-zinc-200 flex justify-between items-center sticky top-0">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">产品使用说明</h2>
            <p className="text-sm text-zinc-500">DocFlow 智排 AI - 您的智能排版助手</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-800 transition-colors p-1 rounded-full hover:bg-zinc-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-8 space-y-10">

          <section>
            <h3 className="text-lg font-bold text-indigo-600 border-b border-indigo-100 pb-2 mb-4">1. 快速开始</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-100 flex flex-col items-center text-center">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold mb-3">1</div>
                <h4 className="font-semibold text-zinc-800 mb-2">导入文档</h4>
                <p className="text-zinc-500 text-sm">
                  将您的草稿 (.txt, .docx, .md) 拖入左侧区域，或点击上传。
                </p>
              </div>
              <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-100 flex flex-col items-center text-center">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold mb-3">2</div>
                <h4 className="font-semibold text-zinc-800 mb-2">选择预设</h4>
                <p className="text-zinc-500 text-sm">
                  从“报告”、“学术期刊”、“公文”等预设中选择最适合您的风格。
                </p>
              </div>
              <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-100 flex flex-col items-center text-center">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold mb-3">3</div>
                <h4 className="font-semibold text-zinc-800 mb-2">一键重排</h4>
                <p className="text-zinc-500 text-sm">
                  点击“开始智能重排”，AI 将自动识别结构并生成精美的排版结果。
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-bold text-indigo-600 border-b border-indigo-100 pb-2 mb-4">2. 核心功能</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-zinc-200 rounded-xl p-4 hover:border-indigo-200 transition-colors">
                <h4 className="font-semibold text-zinc-800 flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  AI 结构化识别
                </h4>
                <p className="text-zinc-600 text-sm mt-1 leading-relaxed">
                  不仅仅是调整字体。AI 会理解您的文档语义，自动识别标题、段落、列表和引用，重构文档骨架。
                </p>
              </div>
              <div className="border border-zinc-200 rounded-xl p-4 hover:border-indigo-200 transition-colors">
                <h4 className="font-semibold text-zinc-800 flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                  多格式导出
                </h4>
                <p className="text-zinc-600 text-sm mt-1 leading-relaxed">
                  所见即所得。处理完成后，您可以一键下载标准的 .docx Word 文档，完美保留所有样式。
                </p>
              </div>
              <div className="border border-zinc-200 rounded-xl p-4 hover:border-indigo-200 transition-colors md:col-span-2 bg-amber-50/50">
                <h4 className="font-semibold text-zinc-800 flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                  自定义排版参数
                </h4>
                <p className="text-zinc-600 text-sm mt-1 leading-relaxed">
                  <span className="text-amber-600 font-medium">💡 温馨提示：</span>您可以根据自己的需求，在选择预设后点击"排版参数"按钮，自由调整字体、字号、行距、段距等排版参数，打造专属的文档风格。
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-bold text-indigo-600 border-b border-indigo-100 pb-2 mb-4">3. 常见问题</h3>
            <div className="space-y-4">
              <div className="bg-indigo-50/50 p-4 rounded-xl">
                <h4 className="font-bold text-zinc-800 text-sm mb-1">Q: 我的文档数据安全吗？</h4>
                <p className="text-zinc-600 text-xs">
                  安全。我们使用加密传输处理您的文档。处理完成后，您的原始文件和生成结果不会在服务器上永久保留。
                </p>
              </div>
              <div className="bg-indigo-50/50 p-4 rounded-xl">
                <h4 className="font-bold text-zinc-800 text-sm mb-1">Q: 如何获得更多生成额度？</h4>
                <p className="text-zinc-600 text-xs">
                  免费用户每日享有一定额度。您可以点击界面右上角的“升级 Pro”解锁更多额度和高级模型 (Gemini 3 Pro Preview)。
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="bg-zinc-50 px-8 py-5 border-t border-zinc-200 text-right">
          <button onClick={onClose} className="px-6 py-2.5 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 font-medium transition-all shadow-lg shadow-zinc-200">
            开始使用
          </button>
        </div>
      </div>
    </div>
  );
};
