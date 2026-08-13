import React, { useLayoutEffect, useRef, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * 预览区「只读分页态 ↔ 编辑态」切换时内容重复的回归。
 *
 * 现场:用户点「编辑」,预览里出现两份内容。
 * 原因不在业务逻辑,在 React 的复用规则 —— 两个分支的根都是 <div>、位置也相同,
 * React 判定是同一个元素,于是复用同一个 DOM 节点、只改属性和它自己那套子节点。
 * 但纸张内容是我们用 innerHTML 直接写进去的,不在 React 的虚拟树里 ——
 * 复用时这些节点原地不动,再叠上编辑态的子节点,页面上就是两份。
 *
 * 这条测试同时钉住「不给 key 会重复」和「给了 key 就不会」,防止以后有人顺手删掉 key。
 */

const Preview: React.FC<{ editing: boolean; withKey: boolean }> = ({ editing, withKey }) => {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        // 模拟 Home 的做法:内容一律用 innerHTML 直接写入,绕开 React 协调
        if (ref.current) ref.current.innerHTML = editing ? '<p>可编辑内容</p>' : '<div class="a4-page">第一页</div>';
    }, [editing]);

    return !editing ? (
        <div {...(withKey ? { key: 'readonly' } : {})} ref={ref} />
    ) : (
        <div {...(withKey ? { key: 'editing' } : {})} className="paper">
            <div ref={ref} contentEditable suppressContentEditableWarning />
        </div>
    );
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

const draw = (editing: boolean, withKey: boolean) =>
    act(() => { root.render(<Preview editing={editing} withKey={withKey} />); });

const count = (needle: string) => (host.innerHTML.match(new RegExp(needle, 'g')) ?? []).length;

describe('预览区分支切换', () => {
    it('不给 key:切到编辑态后旧纸张残留 → 内容重复(线上现象)', () => {
        draw(false, false);
        expect(count('第一页')).toBe(1);
        draw(true, false);
        expect(host.querySelectorAll('.a4-page').length, '旧纸张本应被清掉').toBeGreaterThan(0);
    });

    it('给了 key:切到编辑态后旧纸张彻底消失,只剩一份内容', () => {
        draw(false, true);
        expect(count('第一页')).toBe(1);
        draw(true, true);
        expect(host.querySelectorAll('.a4-page').length).toBe(0);
        expect(count('可编辑内容')).toBe(1);
    });

    it('给了 key:退出编辑态不会把编辑态节点带回只读态', () => {
        draw(true, true);
        draw(false, true);
        expect(host.querySelectorAll('[contenteditable]').length).toBe(0);
        expect(count('第一页')).toBe(1);
    });
});
