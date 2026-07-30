import { describe, it, expect } from 'vitest';
import {
    buildNormIndex,
    tokenizeSourceBlocks,
    restoreMissingContent,
    freezeTables,
    unfreezeTables,
    restoreListCaptions,
    stripTocBlock,
} from '../restoreContent';

describe('restoreListCaptions — 列表形态题注还原(mammoth 丢编号回归)', () => {
    it('图片后的单项 ol → 还原为带编号的图题段', () => {
        const html = '<p>__IMG_0__</p><ol><li><strong>特高压工程技术路线图</strong></li></ol><p>正文继续。</p>';
        const r = restoreListCaptions(html);
        expect(r.figures).toBe(1);
        expect(r.text).toContain('<p>图1 特高压工程技术路线图</p>');
        expect(r.text).not.toContain('<ol>');
    });

    it('表格前的单项 ol → 还原为带编号的表题段;编号从既有最大号续', () => {
        const html = '<ol><li>质量维度对照表</li></ol><table><tr><td>a</td></tr></table>';
        const r = restoreListCaptions(html, 0, 1); // 源文已有 表1
        expect(r.tables).toBe(1);
        expect(r.text).toContain('<p>表2 质量维度对照表</p>');
    });

    it('普通单项列表(不邻图/表)不动;整句列表项不动;多项列表不动', () => {
        const html = [
            '<p>要求如下。</p><ol><li>完成数据标准体系建设。</li></ol>',
            '<p>__IMG_1__</p><ol><li>这一项是完整句子所以带句号。</li></ol>',
            '<ol><li>甲</li><li>乙</li></ol><table><tr><td>x</td></tr></table>',
        ].join('');
        const r = restoreListCaptions(html);
        expect(r.figures + r.tables).toBe(0);
    });
});

describe('stripTocBlock — 纯文本目录剔除', () => {
    it('「目录」段 + 连续带页码行 → 整块删除', () => {
        const html = [
            '<p>摘要内容在此保留不动。</p>',
            '<p>目录</p>',
            '<p>1前言 1</p>',
            '<p>1.1研究背景 1</p>',
            '<p>1.2研究目的与意义 3</p>',
            '<p>摘要 I</p>',
            '<h1>前言</h1><p>正文开始了这里不是目录。</p>',
        ].join('');
        const out = stripTocBlock(html);
        expect(out).not.toContain('<p>目录</p>');
        expect(out).not.toContain('研究背景 1');
        expect(out).toContain('<h1>前言</h1>');
        expect(out).toContain('摘要内容在此保留不动');
    });

    it('目录行不足 3 行 → 不动(避免误删)', () => {
        const html = '<p>目录</p><p>1前言 1</p><h1>前言</h1>';
        expect(stripTocBlock(html)).toBe(html);
    });

    it('无目录段 → 原样返回', () => {
        const html = '<p>正文而已。</p>';
        expect(stripTocBlock(html)).toBe(html);
    });
});

describe('buildNormIndex', () => {
    it('归一化规则与索引映射:去标签/空白,折标点,小写化', () => {
        const { norm, map } = buildNormIndex('<p>甲， 乙。</p>');
        expect(norm).toBe('甲,乙.');
        // map 指回原始下标:甲 在 '<p>' 之后
        expect(map[0]).toBe(3);
        expect(norm.length).toBe(map.length);
    });

    it('实体解码与占位符保留', () => {
        const { norm } = buildNormIndex('<p>A&amp;B&nbsp;__IMG_3__</p>');
        expect(norm).toBe('a&b__img_3__');
    });
});

describe('tokenizeSourceBlocks', () => {
    const src = `
        <h1>方案标题</h1>
        <p>第一段正文内容,足够长可以对账。</p>
        <p>__IMG_0__</p>
        <p>图3-1 总体架构</p>
        <table><tr><td>a</td><td>b</td></tr></table>
        <ul><li>条目一</li><li>条目二</li></ul>`;

    it('按类型正确分块', () => {
        const blocks = tokenizeSourceBlocks(src);
        expect(blocks.map((b) => b.type)).toEqual([
            'heading', 'paragraph', 'image', 'caption', 'table', 'list',
        ]);
        expect(blocks[0].level).toBe(1);
        expect(blocks[2].imageToken).toBe('__IMG_0__');
        expect(blocks[3].captionKind).toBe('图');
    });

    it('嵌套列表整体算一个块', () => {
        const blocks = tokenizeSourceBlocks('<ul><li>外<ul><li>内</li></ul></li></ul><p>后续段落足够长参与对账</p>');
        expect(blocks.map((b) => b.type)).toEqual(['list', 'paragraph']);
    });

    it('图片占位符与图题同段 → 拆成图片块 + 图题块(真实 Word 文档常见形态)', () => {
        const blocks = tokenizeSourceBlocks('<p>__IMG_28__图4-20成果评分细则定制样例图</p>');
        expect(blocks.map((b) => b.type)).toEqual(['image', 'caption']);
        expect(blocks[0].imageToken).toBe('__IMG_28__');
        expect(blocks[1].key).toContain('图4-20');
    });

    it('STRUCTURE_DATA 尾巴不参与分块', () => {
        const blocks = tokenizeSourceBlocks('<p>正文段落内容足够长参与对账</p>\n<!-- STRUCTURE_DATA -->\n[{"level":1,"text":"x"}]');
        expect(blocks).toHaveLength(1);
    });
});

describe('restoreMissingContent — 基本行为', () => {
    it('内容完整 → 原样返回,零问题', () => {
        const source = '<p>为进一步加强安全生产管理,现将有关事项通知如下。</p><p>各部门须于本月二十日前完成自查并上报结果。</p>';
        const output = '<h1 class="doc-title">通知</h1><p>为进一步加强安全生产管理,现将有关事项通知如下。</p><p>各部门须于本月二十日前完成自查并上报结果。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.text).toBe(output);
        expect(r.issues).toEqual([]);
    });

    it('标点/空白差异视为存在,不重复补回', () => {
        const source = '<p>为进一步加强安全生产管理，现将有关事项通知如下。</p>';
        const output = '<p>为进一步加强安全生产管理, 现将有关事项通知如下.</p>';
        const r = restoreMissingContent(source, output);
        expect(r.issues).toEqual([]);
    });

    it('整段丢失 → 按原位补回(插在前一段之后、后一段之前)', () => {
        const source = [
            '<p>第一段内容在成稿中完整保留了下来。</p>',
            '<p>第二段被模型整段丢掉了需要补回来。</p>',
            '<p>第三段内容同样完整保留了下来没丢。</p>',
        ].join('');
        const output = '<p>第一段内容在成稿中完整保留了下来。</p><p>第三段内容同样完整保留了下来没丢。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.text).toContain('第二段被模型整段丢掉了需要补回来');
        const i1 = r.text.indexOf('第一段');
        const i2 = r.text.indexOf('第二段');
        const i3 = r.text.indexOf('第三段');
        expect(i1).toBeLessThan(i2);
        expect(i2).toBeLessThan(i3);
        expect(r.issues.map((x) => x.type)).toContain('content_restored');
        expect(r.restoredCounts.paragraph).toBe(1);
    });
});

describe('restoreMissingContent — 图片与图题', () => {
    it('图片占位符 + 图题连续丢失 → 按原文顺序成组补回,图题转为 caption div', () => {
        const source = [
            '<p>上文段落内容足够长在成稿中保留了。</p>',
            '<p>__IMG_5__</p>',
            '<p>图4-24 一张图出图案例图</p>',
            '<p>下文段落内容足够长在成稿中保留了。</p>',
        ].join('');
        const output = '<p>上文段落内容足够长在成稿中保留了。</p><p>下文段落内容足够长在成稿中保留了。</p>';
        const r = restoreMissingContent(source, output);
        const iUp = r.text.indexOf('上文段落');
        const iImg = r.text.indexOf('__IMG_5__');
        const iCap = r.text.indexOf('图4-24');
        const iDown = r.text.indexOf('下文段落');
        expect(iUp).toBeLessThan(iImg);
        expect(iImg).toBeLessThan(iCap);
        expect(iCap).toBeLessThan(iDown);
        expect(r.text).toContain('<div class="figure-caption">图4-24 一张图出图案例图</div>');
        expect(r.restoredCounts.image).toBe(1);
        expect(r.restoredCounts.caption).toBe(1);
    });

    it('表题丢失 → 转为 table-caption div', () => {
        const source = '<p>前文段落内容足够长且保留在成稿里。</p><p>表6-1 一期工作内容报价表</p>';
        const output = '<p>前文段落内容足够长且保留在成稿里。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.text).toContain('<div class="table-caption">表6-1 一期工作内容报价表</div>');
    });

    it('图+题同段整体丢失 → 图片补成独立段,图题补成 caption div', () => {
        const source = '<p>上文段落内容足够长在成稿中保留了。</p><p>__IMG_28__图4-20成果评分细则定制样例图</p>';
        const output = '<p>上文段落内容足够长在成稿中保留了。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.text).toContain('<p>__IMG_28__</p>');
        expect(r.text).toContain('<div class="figure-caption">图4-20成果评分细则定制样例图</div>');
        expect(r.text.indexOf('__IMG_28__')).toBeLessThan(r.text.indexOf('图4-20'));
    });

    it('图片存在时游标推进到图片之后(后续图题补在图片后面)', () => {
        const source = '<p>__IMG_2__</p><p>图1-1 架构图</p>';
        const output = '<p>__IMG_2__</p><p>其它内容</p>';
        const r = restoreMissingContent(source, output);
        expect(r.text.indexOf('__IMG_2__')).toBeLessThan(r.text.indexOf('图1-1'));
    });
});

describe('restoreMissingContent — 标题', () => {
    it('标题丢失 → 补回,且源级别 +1(章节从 h2 起)', () => {
        const source = '<h2>网络配置</h2><p>网络方面的正文内容足够长被保留了。</p>';
        const output = '<p>网络方面的正文内容足够长被保留了。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.text).toContain('<h3>网络配置</h3>');
        expect(r.restoredCounts.heading).toBe(1);
    });

    it('标题文本出现在图表题里 ≠ 标题存在(必须看标题标签)', () => {
        // 「网络配置」出现在 表5-6 的表题文本里,但 <hN> 标签层面没有这个标题 → 仍应补回
        const source = '<h3>网络配置</h3><p>本节说明网络拓扑与带宽要求等内容。</p>';
        const output = '<div class="table-caption">表5-6 网络配置表</div><p>本节说明网络拓扑与带宽要求等内容。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.restoredCounts.heading).toBe(1);
    });

    it('标题存在(编号前缀不同也算)→ 不补', () => {
        const source = '<h2>5.2 网络配置</h2><p>正文内容足够长而且保留在成稿中了。</p>';
        const output = '<h2>二、网络配置</h2><p>正文内容足够长而且保留在成稿中了。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.restoredCounts.heading).toBeUndefined();
    });
});

describe('restoreMissingContent — 表格', () => {
    it('成稿表格缺单元格 → 整表替换回原文版本', () => {
        const source = `<table>
            <tr><th>项目</th><th>部门</th><th>时限</th></tr>
            <tr><td>设备安全</td><td>生产部</td><td>7月20日</td></tr>
            <tr><td>消防设施</td><td>后勤部</td><td>7月25日</td></tr>
        </table>`;
        const output = `<p>前文</p><table>
            <tr><th>项目</th><th>部门</th><th>时限</th></tr>
            <tr><td>设备安全</td><td>生产部</td><td>7月20日</td></tr>
            <tr><td>消防设施</td><td>后勤部</td></tr>
        </table><p>后文</p>`;
        const r = restoreMissingContent(source, output);
        expect(r.issues.map((x) => x.type)).toContain('table_restored');
        expect((r.text.match(/7月25日/g) ?? []).length).toBe(1); // 换回了完整版,且没双份
        expect(r.text.indexOf('前文')).toBeLessThan(r.text.indexOf('设备安全'));
        expect(r.text.indexOf('设备安全')).toBeLessThan(r.text.indexOf('后文'));
    });

    it('整表丢失且无任何匹配 → 原位补回', () => {
        const source = '<p>表格前面的段落内容足够长被保留。</p><table><tr><td>甲数据内容</td><td>乙数据内容</td></tr></table><p>表格后面的段落内容足够长被保留。</p>';
        const output = '<p>表格前面的段落内容足够长被保留。</p><p>表格后面的段落内容足够长被保留。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.text).toContain('甲数据内容');
        expect(r.text.indexOf('前面的段落')).toBeLessThan(r.text.indexOf('甲数据内容'));
        expect(r.text.indexOf('甲数据内容')).toBeLessThan(r.text.indexOf('后面的段落'));
    });

    it('AI 改写过的不完整表(部分单元格变了但过半相同)→ 相似度配对后整表替换,不双份', () => {
        const source = `<table>
            <tr><th>内容</th><th>支持情况</th><th>推荐值</th><th>备注</th></tr>
            <tr><td>存储形式</td><td>本地硬盘</td><td>网络共享盘</td><td>本地硬盘优先</td></tr>
            <tr><td>支持协议</td><td>CIFS</td><td>NFS</td><td>iSCSI</td></tr>
        </table>`;
        // AI 版:丢了最后一行的两个格,且个别措辞被改写
        const output = `<table>
            <tr><th>内容</th><th>支持情况</th><th>推荐值</th><th>备注</th></tr>
            <tr><td>存储形式</td><td>本地硬盘</td><td>网络共享盘</td><td>建议本地硬盘</td></tr>
            <tr><td>支持协议</td><td>CIFS</td></tr>
        </table>`;
        const r = restoreMissingContent(source, output);
        expect(r.issues.map((x) => x.type)).toContain('table_restored');
        expect((r.text.match(/<table/gi) ?? []).length).toBe(1); // 替换而非并存
        expect(r.text).toContain('iSCSI'); // 完整版回来了
    });

    it('两张同类配置表(共享表头)不互相错配:各自保留,不替换不重复', () => {
        const server = `<table>
            <tr><th>内容</th><th>支持情况</th><th>推荐值</th><th>备注</th></tr>
            <tr><td>操作系统</td><td>WindowsServer</td><td>WindowsServer2016</td><td>服务器端专用</td></tr>
            <tr><td>数据库</td><td>SQLServer</td><td>SQLServer2019</td><td>企业版</td></tr>
        </table>`;
        const client = `<table>
            <tr><th>内容</th><th>支持情况</th><th>推荐值</th><th>备注</th></tr>
            <tr><td>操作系统</td><td>Windows7</td><td>Windows10</td><td>客户端专用</td></tr>
            <tr><td>显卡</td><td>集成显卡</td><td>独立显卡</td><td>高端优先</td></tr>
        </table>`;
        const source = server + client;
        const output = server + client; // 两张都完整存在
        const r = restoreMissingContent(source, output);
        expect(r.issues).toEqual([]);
        expect((r.text.match(/<table/gi) ?? []).length).toBe(2);
    });

    it('锚点落在表格内部 → 补回内容插到表格之后而非表格里', () => {
        const source = [
            '<table><tr><td>表格里的锚点文本内容足够长</td></tr></table>',
            '<p>紧跟在表格后面的段落被丢了要补回。</p>',
        ].join('');
        const output = '<table><tr><td>表格里的锚点文本内容足够长</td></tr></table>';
        const r = restoreMissingContent(source, output);
        const tableEnd = r.text.indexOf('</table>');
        const restored = r.text.indexOf('紧跟在表格后面');
        expect(restored).toBeGreaterThan(tableEnd);
    });
});

describe('restoreMissingContent — 防误伤', () => {
    it('内容被挪位(在游标之前出现过)→ 不重复补', () => {
        const source = '<p>甲段内容足够长参与顺序对账流程。</p><p>乙段内容足够长参与顺序对账流程。</p>';
        // 成稿把乙段挪到了甲段前面
        const output = '<p>乙段内容足够长参与顺序对账流程。</p><p>甲段内容足够长参与顺序对账流程。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.issues).toEqual([]);
        expect((r.text.match(/乙段内容/g) ?? []).length).toBe(1);
    });

    it('长段落轻度改写(首尾命中)→ 视为存在', () => {
        const longText = '这是一个非常长的段落开头部分保持原样,中间的一些措辞被模型轻微调整过了但意思没变,结尾部分同样保持了原样没有任何变化。';
        const source = `<p>${longText}</p>`;
        const output = `<p>这是一个非常长的段落开头部分保持原样,中间内容被改写了,结尾部分同样保持了原样没有任何变化。</p>`;
        const r = restoreMissingContent(source, output);
        expect(r.issues).toEqual([]);
    });

    it('成稿几乎为空(生成失败)→ 不做逐块补回', () => {
        const source = Array.from({ length: 30 }, (_, i) => `<p>第${i}段内容都足够长参与对账流程判断。</p>`).join('');
        const output = '<p>只有一点点</p>';
        const r = restoreMissingContent(source, output);
        expect(r.text).toBe(output);
        expect(r.issues).toEqual([]);
    });
});

describe('restoreMissingContent — 大幅前跳旁证', () => {
    it('封面公司名匹配到文末落款 → 拒绝毒跳,后续补回仍锚在正文原位', () => {
        // 真实文档回归:封面「公司名」段落在成稿里只剩文末落款一份,单调游标在
        // 第 2 个块就被拽到结尾,之后 24 处补回全部堆在文末。
        // 旁证只在跳幅超过 JUMP_WINDOW(1500 归一化字符)时启动,文档要足够长
        const filler = (n: number) => `<p>第${n}段正文内容足够长可以参与顺序对账流程判断推进,再加一些字符把段落体积撑起来以便触发旁证窗口。</p>`;
        const fillers = Array.from({ length: 50 }, (_, i) => filler(i + 1));
        const source = [
            '<p>北京某某科技股份有限公司</p>', // 封面
            fillers[0], fillers[1],
            '<p>图1-1 总体架构图</p>',        // 会丢失的图题
            ...fillers.slice(2),
        ].join('');
        const output = [
            fillers[0], fillers[1],
            // 图题被丢
            ...fillers.slice(2),
            '<p class="doc-signature">北京某某科技股份有限公司</p>', // 落款
        ].join('');
        const r = restoreMissingContent(source, output);
        expect(r.restoredCounts.caption).toBe(1);
        // 补回位置必须在第 2 段之后、第 3 段之前,而不是文末落款处
        const capIdx = r.text.indexOf('图1-1');
        expect(capIdx).toBeGreaterThan(r.text.indexOf('第2段'));
        expect(capIdx).toBeLessThan(r.text.indexOf('第3段'));
    });
});

describe('restoreMissingContent — 图题元素级存在性', () => {
    it('图题文本仅出现在图目录(li)里 → 仍判缺失并补回为 caption div', () => {
        // 真实文档回归:被 reconcileCaptionsToSource 误删的图题,其文本还留在目录/
        // 正文引用里 —— 全文搜文本会误判「还在」,必须只认图题形态的元素。
        const source = '<p>正文段落内容足够长参与顺序对账流程。</p><p>图4-20 成果评分细则定制样例图</p>';
        const output = '<ul><li>图4-20 成果评分细则定制样例图</li></ul><p>正文段落内容足够长参与顺序对账流程。</p>';
        const r = restoreMissingContent(source, output);
        expect(r.restoredCounts.caption).toBe(1);
        expect(r.text).toContain('<div class="figure-caption">');
    });

    it('图题存在但已被统一重编号 → 按去编号的题文匹配,不重复补', () => {
        const source = '<p>图4-21 数据接入流程图</p>';
        const output = '<div class="figure-caption">图4-20 数据接入流程图</div>';
        const r = restoreMissingContent(source, output);
        expect(r.restoredCounts.caption).toBeUndefined();
    });
});

describe('freezeTables / unfreezeTables — 表格不进 AI', () => {
    const table = '<table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></table>';
    const src = `<p>表格之前的说明文字。</p>${table}<p>表格之后的说明文字。</p>`;

    it('冻结:整表换成 <p>__TBL_N__</p> 占位符,map 保留原表', () => {
        const { text, map } = freezeTables(src);
        expect(text).toContain('<p>__TBL_0__</p>');
        expect(text).not.toContain('<table');
        expect(map['__TBL_0__']).toBe(table);
    });

    it('往返:冻结→解冻恢复原表', () => {
        const { text, map } = freezeTables(src);
        expect(unfreezeTables(text, map)).toContain(table);
    });

    it('嵌套表整体冻结为一个占位符', () => {
        const nested = `<table><tr><td>外${table}</td></tr></table>`;
        const { text, map } = freezeTables(`<p>前文说明。</p>${nested}`);
        expect(Object.keys(map)).toEqual(['__TBL_0__']);
        expect(map['__TBL_0__']).toBe(nested);
        expect(text).not.toContain('<table');
    });

    it('AI 重复吐出的占位符 → 只还原第一处', () => {
        const { map } = freezeTables(src);
        const out = '<p>前。</p><p>__TBL_0__</p><p>中。</p><p>__TBL_0__</p>';
        const restored = unfreezeTables(out, map);
        expect((restored.match(/<table/g) ?? []).length).toBe(1);
    });

    it('AI 编造的占位符编号 → 原样保留不替换', () => {
        const { map } = freezeTables(src);
        const restored = unfreezeTables('<p>__TBL_99__</p>', map);
        expect(restored).toContain('__TBL_99__');
    });

    it('裸占位符(未带 p 包裹)也能还原', () => {
        const { map } = freezeTables(src);
        expect(unfreezeTables('前文__TBL_0__后文', map)).toContain(table);
    });

    it('AI 弄丢的占位符 → 解冻不兜底,restoreMissingContent 按原位补回整表', () => {
        const { map } = freezeTables(src);
        const aiOut = '<p>表格之前的说明文字。</p><p>表格之后的说明文字。</p>'; // 占位符被丢
        const unfrozen = unfreezeTables(aiOut, map);
        expect(unfrozen).not.toContain('<table');
        const r = restoreMissingContent(src, unfrozen);
        expect(r.restoredCounts.table).toBe(1);
        expect(r.text).toContain('<td>甲</td>');
    });
});
