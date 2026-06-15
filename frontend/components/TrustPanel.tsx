import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IntegrityReport, IntegritySeverity } from '../types';

// 合规检查单行结果(与 utils/compliance.ts 的 CheckResult 对齐;阶段2 接入)
export interface ComplianceCheckResult {
  id: string;
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
}

interface TrustPanelProps {
  integrityReport: IntegrityReport | null;
  complianceResults?: ComplianceCheckResult[];
  complianceStandardName?: string;
}

const severityStyles: Record<IntegritySeverity, { dot: string; text: string }> = {
  info: { dot: 'bg-gray-300', text: 'text-gray-500' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-600' },
  critical: { dot: 'bg-red-500', text: 'text-red-600' },
};

/**
 * 信任层面板:生成结束后给用户"敢直接交"的凭证。
 * - 完整性 tab:输入/输出结构对比 + 期间触发的丢失/截断/跳过事件
 * - 格式合规 tab(阶段2):对照命名标准的逐项 ✓/⚠ 清单
 * 仅在有数据时渲染;无 integrityReport 且无 complianceResults → 返回 null。
 */
export const TrustPanel: React.FC<TrustPanelProps> = ({ integrityReport, complianceResults, complianceStandardName }) => {
  const { t } = useTranslation();
  const hasIntegrity = !!integrityReport;
  const hasCompliance = !!complianceResults && complianceResults.length > 0;
  const [tab, setTab] = useState<'integrity' | 'compliance'>(hasIntegrity ? 'integrity' : 'compliance');
  const [collapsed, setCollapsed] = useState(false);

  if (!hasIntegrity && !hasCompliance) return null;

  // 当前激活 tab 在数据可用范围内兜底
  const activeTab = tab === 'compliance' && !hasCompliance ? 'integrity' : tab === 'integrity' && !hasIntegrity ? 'compliance' : tab;

  // ── 完整性总体判断 ──
  const rep = integrityReport;
  const inputHadHeadings = (rep?.input.headings ?? 0) > 0;
  const headingsOk = !inputHadHeadings || (rep?.headingsMatched ?? true);
  const charOk = rep ? rep.charRetentionPct >= 90 && rep.charRetentionPct <= 135 : true;
  const issueCount = (rep?.issues ?? []).filter(i => i.severity !== 'info').length;
  const hasCriticalOrWarn = issueCount > 0;
  const integrityGood = rep ? !rep.truncated && headingsOk && charOk && !hasCriticalOrWarn : false;

  // 完整性 banner 文案:好 → 简洁断言(具体数字在下方表里);异常 → 指出具体原因,不空指"下方"
  let integrityBannerText = '';
  if (rep) {
    if (integrityGood) {
      integrityBannerText = t('home.integrity_ok', '内容完整,未检测到丢失')
        + (inputHadHeadings ? t('home.integrity_headings', '(标题 {{o}}/{{i}})', { o: rep.output.headings, i: rep.input.headings }) : '');
    } else if (rep.truncated || issueCount > 0) {
      integrityBannerText = t('home.integrity_warn_issues', '检测到 {{n}} 处需确认项(见下方),建议核对成稿', { n: Math.max(issueCount, rep.truncated ? 1 : 0) });
    } else if (!charOk) {
      integrityBannerText = t('home.integrity_warn_chars', '成稿字符量与原文差异较大(原文 {{i}} → 成稿 {{o}}),请核对是否有遗漏', { i: rep.input.charCount, o: rep.output.charCount });
    } else if (!headingsOk) {
      integrityBannerText = t('home.integrity_warn_headings', '成稿标题数少于原文({{o}}/{{i}}),请核对是否漏节', { o: rep.output.headings, i: rep.input.headings });
    } else {
      integrityBannerText = t('home.integrity_warn_generic', '请核对成稿内容');
    }
  }

  // ── 合规总体判断 ──
  const compliancePassCount = (complianceResults ?? []).filter(c => c.pass).length;
  const complianceTotal = (complianceResults ?? []).length;
  const complianceGood = hasCompliance && compliancePassCount === complianceTotal;

  const Banner: React.FC<{ good: boolean; children: React.ReactNode }> = ({ good, children }) => (
    <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      <span className="flex-shrink-0">{good ? '✓' : '⚠'}</span>
      <span className="leading-relaxed">{children}</span>
    </div>
  );

  return (
    <div className="w-full bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* tab 头 + 折叠 */}
      <div className="flex items-center justify-between border-b border-gray-100 px-2">
        <div className="flex items-center gap-1 py-1.5">
          {hasIntegrity && (
            <button
              onClick={() => setTab('integrity')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${activeTab === 'integrity' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >{t('home.trust_tab_integrity', '内容完整性')}</button>
          )}
          {hasCompliance && (
            <button
              onClick={() => setTab('compliance')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${activeTab === 'compliance' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >{t('home.trust_tab_compliance', '格式合规')}</button>
          )}
        </div>
        <button onClick={() => setCollapsed(c => !c)} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="toggle">
          <svg className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-2.5">
          {/* ───── 完整性 tab ───── */}
          {activeTab === 'integrity' && rep && (
            <>
              <Banner good={integrityGood}>{integrityBannerText}</Banner>

              {/* 计数对照表 */}
              <div className="text-xs text-gray-600">
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1">
                  <div className="text-gray-400">{t('home.integrity_metric', '指标')}</div>
                  <div className="text-gray-400 text-right">{t('home.integrity_input', '原文')}</div>
                  <div className="text-gray-400 text-right">{t('home.integrity_output', '成稿')}</div>

                  <div>{t('home.integrity_chars', '字符数')}</div>
                  <div className="text-right tabular-nums">{rep.input.charCount.toLocaleString()}</div>
                  <div className="text-right tabular-nums">{rep.output.charCount.toLocaleString()}</div>

                  {inputHadHeadings && (<>
                    <div>{t('home.integrity_headings_row', '标题')}</div>
                    <div className="text-right tabular-nums">{rep.input.headings}</div>
                    <div className={`text-right tabular-nums ${rep.headingsMatched ? '' : 'text-amber-600'}`}>{rep.output.headings}</div>
                  </>)}

                  {rep.input.paragraphs > 0 && (<>
                    <div>{t('home.integrity_paragraphs', '段落')}</div>
                    <div className="text-right tabular-nums">{rep.input.paragraphs}</div>
                    <div className="text-right tabular-nums">{rep.output.paragraphs}</div>
                  </>)}

                  {(rep.input.images > 0 || rep.output.images > 0) && (<>
                    <div>{t('home.integrity_images', '图片')}</div>
                    <div className="text-right tabular-nums">{rep.input.images}</div>
                    <div className={`text-right tabular-nums ${rep.output.images < rep.input.images ? 'text-amber-600' : ''}`}>{rep.output.images}</div>
                  </>)}
                </div>
              </div>

              {/* 事件列表 */}
              {rep.issues.length > 0 && (
                <ul className="space-y-1 pt-1 border-t border-gray-100">
                  {rep.issues.map((iss, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs">
                      <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${severityStyles[iss.severity].dot}`} />
                      <span className={severityStyles[iss.severity].text}>{iss.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* ───── 格式合规 tab(阶段2 接入数据) ───── */}
          {activeTab === 'compliance' && hasCompliance && (
            <>
              <Banner good={complianceGood}>
                {complianceGood
                  ? t('home.compliance_ok', '符合《{{name}}》:{{n}} 项全部达标', { name: complianceStandardName, n: complianceTotal })
                  : t('home.compliance_warn', '《{{name}}》:{{pass}}/{{total}} 项达标,{{n}} 项偏离', { name: complianceStandardName, pass: compliancePassCount, total: complianceTotal, n: complianceTotal - compliancePassCount })}
              </Banner>
              <ul className="space-y-1">
                {complianceResults!.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <span className={c.pass ? 'text-emerald-500' : 'text-amber-500'}>{c.pass ? '✓' : '⚠'}</span>
                      {c.label}
                    </span>
                    <span className={`tabular-nums ${c.pass ? 'text-gray-400' : 'text-amber-600'}`}>
                      {c.actual}{c.pass ? '' : ` → ${c.expected}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};
