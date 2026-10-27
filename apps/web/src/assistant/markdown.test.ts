import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inlineToPlain, parseInline, parseMarkdown, safeHref } from './markdown.ts'

describe('安全 Markdown', () => {
  it('解析标题、段落、列表、引用、分割线', () => {
    const blocks = parseMarkdown('### 档案情况\n目前完整度 **30%**\n\n- 英文介绍\n- 产品图片\n1. 第一步\n2. 第二步\n> 提示\n---\n# 大标题')
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['heading', 'paragraph', 'ul', 'ol', 'quote', 'divider', 'heading'],
    )
    assert.deepEqual(blocks[2], { type: 'ul', items: ['英文介绍', '产品图片'] })
    assert.deepEqual(blocks[1], {
      type: 'paragraph',
      inline: [
        { type: 'text', text: '目前完整度 ' },
        { type: 'strong', text: '30%' },
      ],
    })
  })

  it('解析表格（周报）：单元格只保留纯文本', () => {
    const blocks = parseMarkdown('### 周报\n\n| 指标 | 本周 |\n| --- | --- |\n| 新增商机 | **3** |\n| 官网 | [链接](https://a.example) |\n\n1. 建议')
    assert.deepEqual(blocks.map((b) => b.type), ['heading', 'table', 'ol'])
    assert.deepEqual(blocks[1], { type: 'table', header: ['指标', '本周'], rows: [['新增商机', '3'], ['官网', '链接（a.example）']] })
  })

  it('没有分隔行的 | 文本按段落处理', () => {
    assert.deepEqual(parseMarkdown('| a | b |').map((b) => b.type), ['paragraph'])
  })

  it('HTML 标签按纯文本保留，不会被解析', () => {
    const blocks = parseMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>')
    assert.deepEqual(blocks, [{ type: 'paragraph', inline: [{ type: 'text', text: '<script>alert(1)</script><img src=x onerror=alert(1)>' }] }])
  })

  it('链接只允许 http / https，其余降级为文本', () => {
    assert.deepEqual(parseInline('看 [官网](https://demo.example/a?b=1) 和 [危险](javascript:alert) 与 [数据](data:text/html,x)'), [
      { type: 'text', text: '看 ' },
      { type: 'link', text: '官网', href: 'https://demo.example/a?b=1', host: 'demo.example' },
      { type: 'text', text: ' 和 危险 与 数据' },
    ])
    assert.equal(safeHref('https://user:pw@a.com'), null)
    assert.equal(safeHref('not a url'), null)
  })

  it('列表项转为纯文本，链接显示域名', () => {
    assert.deepEqual(parseMarkdown('- **ISO 9001** 认证\n- 参考 [TED](https://ted.europa.eu/x)'), [
      { type: 'ul', items: ['ISO 9001 认证', '参考 TED（ted.europa.eu）'] },
    ])
    assert.equal(inlineToPlain([{ type: 'strong', text: 'a' }]), 'a')
  })

  it('不完整的加粗（流式输出中）保持原样', () => {
    assert.deepEqual(parseInline('完整度 **30'), [{ type: 'text', text: '完整度 **30' }])
  })
})

describe('链接中的括号', () => {
  it('带括号的危险链接不会成为链接', () => {
    const nodes = parseInline('[x](javascript:alert(1))')
    assert.ok(nodes.every((n) => n.type !== 'link'))
  })
})
