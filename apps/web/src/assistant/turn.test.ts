// 消费前后端共享的协议样例 contracts/sse-assistant.json。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { SseParser } from '../api/sse-parser.ts'
import { emptyAssistant, fromStored, plainText, reduceEvent, type AssistantMessage, type SseEventLike } from './turn.ts'

const contract = JSON.parse(readFileSync(new URL('../../../../contracts/sse-assistant.json', import.meta.url), 'utf8'))

function run(events: SseEventLike[]): AssistantMessage {
  return events.reduce(reduceEvent, emptyAssistant())
}

/** 按后端的编码方式（event + 单行 JSON data）序列化，再用前端解析器解析，确认两端格式一致。 */
function roundTrip(events: { event: string; data: unknown }[]): SseEventLike[] {
  const wire = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')
  const parser = new SseParser()
  const out: SseEventLike[] = []
  // 模拟网络分片：每 7 个字符一片
  for (let i = 0; i < wire.length; i += 7) out.push(...parser.push(wire.slice(i, i + 7)))
  parser.end()
  return out.map((e) => ({ event: e.event, data: e.data }))
}

describe('SSE 协议样例（contracts/sse-assistant.json）', () => {
  it('完成态：进度、卡片、正文、追问', () => {
    const message = run(roundTrip(contract.samples.completedWithTool))
    assert.equal(message.id, 'm1')
    assert.equal(message.state, 'completed')
    assert.deepEqual(message.progress, [{ step: 1, label: '查询档案完整度', status: 'done', summary: '完整度 30%' }])
    assert.equal(message.blocks[0].semanticRole, 'card')
    assert.equal(plainText(message), '### 档案情况\n目前完整度 **30%**，建议先补充：\n- 英文公司介绍\n- 产品图片')
    assert.deepEqual(message.followups, ['帮我补充英文公司介绍', '帮我找海外采购商'])
    assert.equal(message.error, null)
  })

  it('需要确认：确认卡片在前，正文在后，没有追问', () => {
    const message = run(roundTrip(contract.samples.needsConfirmation))
    const card = message.blocks[0]
    assert.ok(card.semanticRole === 'card' && card.card_type === 'confirm')
    assert.equal(card.payload.tool_run_id, 'r1')
    assert.deepEqual(message.followups, [])
  })

  it('失败：保留已生成内容，标记可重试', () => {
    const message = run(roundTrip(contract.samples.failedAfterPartial))
    assert.equal(message.state, 'error')
    assert.equal(plainText(message), '正在为你整理')
    assert.deepEqual(message.error, { code: 'llm_failed', message: 'AI 暂时没有响应，请稍后重试', retryable: true })
  })

  it('未知卡片类型照常进入消息，由渲染层降级为文本', () => {
    const message = run(roundTrip(contract.samples.unknownCard))
    assert.ok(message.blocks[0].semanticRole === 'card' && message.blocks[0].card_type === 'future_card')
  })

  it('所有样例事件名都在协议定义中', () => {
    for (const sample of Object.values(contract.samples) as { event: string }[][]) {
      for (const e of sample) assert.ok(e.event in contract.schemas, e.event)
    }
  })
})

describe('状态机细节', () => {
  it('停止生成为 cancelled，未知事件被忽略，坏 JSON 不抛错', () => {
    let m = emptyAssistant('x')
    m = reduceEvent(m, { event: 'block.delta', data: '{"block_index":0,"text":"a"}' })
    m = reduceEvent(m, { event: 'mystery', data: '{}' })
    m = reduceEvent(m, { event: 'block.delta', data: 'not json' })
    m = reduceEvent(m, { event: 'error', data: { code: 'cancelled', message: '已停止生成', retryable: true } })
    assert.equal(m.state, 'cancelled')
    assert.equal(plainText(m), 'a')
  })

  it('块索引跳跃时用空正文补齐，不覆盖已有块', () => {
    let m = emptyAssistant()
    m = reduceEvent(m, { event: 'block.delta', data: { block_index: 2, text: 'c' } })
    assert.equal(m.blocks.length, 3)
    m = reduceEvent(m, { event: 'block.card', data: { block_index: 0, card_type: 'confirm', payload: {} } })
    assert.equal(m.blocks[0].semanticRole, 'card')
    assert.equal(plainText(m), 'c')
  })

  it('从后端保存的消息恢复', () => {
    const m = fromStored({
      id: 'a',
      role: 'assistant',
      state: 'error',
      error_code: 'llm_failed',
      feedback: 'like',
      blocks: [
        { semanticRole: 'card', card_type: 'confirm', payload: { tool_run_id: 'r' } },
        { semanticRole: 'body', content: 'hi' },
        { semanticRole: 'followUp', items: ['x'] },
      ],
    })
    assert.equal(m.state, 'error')
    assert.equal(m.feedback, 'like')
    assert.deepEqual(m.followups, ['x'])
    assert.equal(m.blocks.length, 2)
    assert.equal(fromStored({ id: 'u', role: 'user', state: 'weird', error_code: '', feedback: '', blocks: [{ semanticRole: 'prompt', content: 'q' }] }).state, 'completed')
  })
})
