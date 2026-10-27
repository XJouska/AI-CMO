// 运行：node --test apps/web/src/api/sse-parser.test.ts（Node 22.18+ 默认支持类型擦除）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SseParser } from './sse-parser.ts'

test('单个事件', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data: hello\n\n'), [{ event: 'message', data: 'hello' }])
})

test('事件名、id、retry', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('event: delta\nid: 7\nretry: 3000\ndata: {"t":"a"}\n\n'), [
    { event: 'delta', data: '{"t":"a"}', id: '7', retry: 3000 },
  ])
})

test('多行 data 用换行拼接', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data: a\ndata: b\n\n'), [{ event: 'message', data: 'a\nb' }])
})

test('跨分块拆分', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('da'), [])
  assert.deepEqual(p.push('ta: hel'), [])
  assert.deepEqual(p.push('lo\n'), [])
  assert.deepEqual(p.push('\n'), [{ event: 'message', data: 'hello' }])
})

test('CRLF 被拆在两个分块之间', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data: x\r'), [])
  assert.deepEqual(p.push('\n\r\n'), [{ event: 'message', data: 'x' }])
})

test('单独的 CR 作为换行', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data: x\r\r'), [{ event: 'message', data: 'x' }])
})

test('注释行（心跳）被忽略', () => {
  const p = new SseParser()
  assert.deepEqual(p.push(': ping\n\n'), [])
  assert.deepEqual(p.push(': ping\ndata: y\n\n'), [{ event: 'message', data: 'y' }])
})

test('只去掉值开头的一个空格', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data:  two\ndata:none\n\n'), [{ event: 'message', data: ' two\nnone' }])
})

test('没有 data 的事件不派发，且不影响下一个事件的类型', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('event: x\n\ndata: z\n\n'), [{ event: 'message', data: 'z' }])
})

test('空 data 字段也会派发', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data\n\n'), [{ event: 'message', data: '' }])
})

test('一个分块里有多个事件', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data: 1\n\ndata: 2\n\n'), [
    { event: 'message', data: '1' },
    { event: 'message', data: '2' },
  ])
})

test('流结束时丢弃不完整的事件', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data: partial\n'), [])
  assert.deepEqual(p.end(), [])
  assert.deepEqual(p.push('data: next\n\n'), [{ event: 'message', data: 'next' }])
})

test('非法 retry 被忽略', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('retry: abc\ndata: q\n\n'), [{ event: 'message', data: 'q' }])
})
