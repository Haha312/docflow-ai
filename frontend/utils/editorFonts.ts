/**
 * 富文本编辑器的字体/字号选项。
 *
 * 只列 Word 里确实存在的中文字体和国标字号 —— 编辑器里选了什么,导出的 .docx 里
 * 就得是什么。字号用「中文字号(pt)」双写:用户按中文字号思考,导出按 pt 落地。
 */

export interface EditorFontOption {
    label: string;
    /** 直接写进 style.fontFamily,导出侧 cleanFontName 取第一个族名 */
    value: string;
}

export const EDITOR_FONTS: EditorFontOption[] = [
    { label: '宋体', value: '"SimSun", serif' },
    { label: '黑体', value: '"SimHei", sans-serif' },
    { label: '楷体', value: '"KaiTi", serif' },
    { label: '仿宋', value: '"FangSong", serif' },
    { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
    { label: '方正小标宋', value: '"FZXiaoBiaoSong-B05S", "SimSun", serif' },
    { label: 'Times New Roman', value: '"Times New Roman", serif' },
    { label: 'Arial', value: 'Arial, sans-serif' },
];

export const EDITOR_FONT_SIZES: EditorFontOption[] = [
    { label: '初号 44pt', value: '44pt' },
    { label: '小初 36pt', value: '36pt' },
    { label: '一号 26pt', value: '26pt' },
    { label: '小一 24pt', value: '24pt' },
    { label: '二号 22pt', value: '22pt' },
    { label: '小二 18pt', value: '18pt' },
    { label: '三号 16pt', value: '16pt' },
    { label: '小三 15pt', value: '15pt' },
    { label: '四号 14pt', value: '14pt' },
    { label: '小四 12pt', value: '12pt' },
    { label: '五号 10.5pt', value: '10.5pt' },
    { label: '小五 9pt', value: '9pt' },
    { label: '六号 7.5pt', value: '7.5pt' },
];
