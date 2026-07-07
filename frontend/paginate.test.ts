// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { paginateIntoSheets, PAGE_USABLE_H } from './Home';

/**
 * jsdom 不做真实布局,offsetTop 恒为 0 —— 用 data-test-top 属性手工桩出每个顶层块的"位置",
 * 模拟浏览器真实渲染后的 offsetTop,从而在没有真实浏览器/登录权限的情况下,
 * 对 paginateIntoSheets 的分栏阈值放大逻辑做确定性回归验证。
 */
function stubOffsetTop() {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return parseInt(this.getAttribute('data-test-top') || '0', 10);
    },
  });
}

const block = (top: number, tag = 'p', cls = ''): string =>
  `<${tag} data-test-top="${top}"${cls ? ` class="${cls}"` : ''}>x</${tag}>`;

describe('paginateIntoSheets', () => {
  let container: HTMLElement;

  beforeEach(() => {
    stubOffsetTop();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('单栏:超过 PAGE_USABLE_H 才分下一页', () => {
    const html = [block(0), block(500), block(PAGE_USABLE_H + 50)].join('');
    expect(paginateIntoSheets(container, html, 1)).toBe(2);
  });

  it('单栏:内容都在阈值内 → 一页', () => {
    const html = [block(0), block(500), block(900)].join('');
    expect(paginateIntoSheets(container, html, 1)).toBe(1);
  });

  it('分栏(2栏):journal-split 之后按栏数放大阈值,同样内容比单栏多装一倍才分页', () => {
    // 篇首(author-info, top=0) + 分隔线(top=200) + 正文两块(top=200 / top=1400)
    // 相对 pageStart(=0) 的差值 1400:单栏阈值 1000 会提前分页,双栏阈值 2000 不会。
    const html = [
      block(0, 'div', 'author-info'),
      `<hr class="journal-split" data-test-top="200">`,
      block(200),
      block(1400),
    ].join('');
    expect(paginateIntoSheets(container, html, 1)).toBe(2); // 单栏:1400 > 1000 阈值,提前分页
    expect(paginateIntoSheets(container, html, 2)).toBe(1); // 双栏:1400 < 2000 阈值,仍在同一页
  });

  it('journal-split 之前的篇首内容不受栏数放大影响(仍按单栏阈值)', () => {
    // 篇首本身就超过 PAGE_USABLE_H(未到 split),不论 bodyColumns 传几都应提前分页。
    const html = [block(0, 'div', 'author-info'), block(PAGE_USABLE_H + 100, 'div', 'abstract-cn')].join('');
    expect(paginateIntoSheets(container, html, 1)).toBe(2);
    expect(paginateIntoSheets(container, html, 2)).toBe(2);
  });

  it('封面页(cover-page)始终独占一页,不受栏数放大影响', () => {
    const html = [
      `<div class="cover-page" data-test-top="0"><h1 data-test-top="0">标题</h1></div>`,
      block(0),
    ].join('');
    expect(paginateIntoSheets(container, html, 2)).toBe(2);
  });
});
