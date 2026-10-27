// 安全 Markdown：把文本解析成块级 AST，再映射到正式 Markdown 组件变体。
// 不解析 HTML，所有内容都作为 React 文本子节点渲染；链接只允许 http / https，并显示域名。

export type InlineNode = { type: 'text'; text: string } | { type: 'strong'; text: string } | { type: 'link'; text: string; href: string; host: string }

export type MdBlock =
  | { type: 'heading'; level: 3 | 4; inline: InlineNode[] }
  | { type: 'paragraph'; inline: InlineNode[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; inline: InlineNode[] }
  | { type: 'divider' }
  | { type: 'table'; header: string[]; rows: string[][] }

const LINK_RE = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2048})\)/g
const STRONG_RE = /\*\*([^*\n]{1,500})\*\*/g

export function safeHref(raw: string): { href: string; host: string } | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return { href: url.toString(), host: url.hostname }
  } catch {
    return null
  }
}

/** 行内解析：**加粗** 与 [文字](链接)。不安全的链接降级为纯文本。 */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  const tokens: { start: number; end: number; node: InlineNode }[] = []
  for (const match of text.matchAll(LINK_RE)) {
    const safe = safeHref(match[2])
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      node: safe ? { type: 'link', text: match[1], href: safe.href, host: safe.host } : { type: 'text', text: match[1] },
    })
  }
  for (const match of text.matchAll(STRONG_RE)) {
    const overlaps = tokens.some((t) => match.index < t.end && match.index + match[0].length > t.start)
    if (!overlaps) tokens.push({ start: match.index, end: match.index + match[0].length, node: { type: 'strong', text: match[1] } })
  }
  tokens.sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const token of tokens) {
    if (token.start > cursor) nodes.push({ type: 'text', text: text.slice(cursor, token.start) })
    nodes.push(token.node)
    cursor = token.end
  }
  if (cursor < text.length) nodes.push({ type: 'text', text: text.slice(cursor) })
  return mergeText(nodes)
}

function mergeText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    const last = out.at(-1)
    if (node.type === 'text' && last?.type === 'text') last.text += node.text
    else if (node.type !== 'text' || node.text) out.push({ ...node })
  }
  return out
}

/** 列表项只保留纯文本（正式 Markdown 列表组件只接受字符串）：去掉加粗标记，链接显示为「文字（域名）」。 */
export function inlineToPlain(nodes: InlineNode[]): string {
  return nodes.map((n) => (n.type === 'link' ? `${n.text}（${n.host}）` : n.text)).join('')
}

const UL_RE = /^\s*[-*•]\s+(.*)$/
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/
const TABLE_SEP_RE = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/

function tableCells(line: string): string[] {
  return TABLE_ROW_RE.exec(line)![1].split('|').map((cell) => inlineToPlain(parseInline(cell.trim())))
}
const OL_RE = /^\s*\d{1,3}[.)、]\s+(.*)$/

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let paragraph: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  let table: { type: 'table'; header: string[]; rows: string[][] } | null = null

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join('\n')) })
    paragraph = []
  }
  const flushList = () => {
    if (list) blocks.push({ type: list.type, items: list.items })
    list = null
  }
  const flushTable = () => {
    if (table) blocks.push(table)
    table = null
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    // 表格：表头行 + 分隔行（| --- |）开始，后续 | 行为数据行。单元格只保留纯文本。
    if (table && TABLE_ROW_RE.test(line)) {
      table.rows.push(tableCells(line).slice(0, table.header.length))
      continue
    }
    flushTable()
    if (TABLE_ROW_RE.test(line) && TABLE_SEP_RE.test(lines[i + 1] ?? '')) {
      flushParagraph()
      flushList()
      table = { type: 'table', header: tableCells(line), rows: [] }
      i++
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const ul = UL_RE.exec(line)
    const ol = OL_RE.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', level: heading[1].length <= 3 ? 3 : 4, inline: parseInline(heading[2].trim()) })
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'divider' })
    } else if (line.startsWith('>')) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'quote', inline: parseInline(line.replace(/^>\s?/, '')) })
    } else if (ul || ol) {
      flushParagraph()
      const type = ul ? 'ul' : 'ol'
      const text = inlineToPlain(parseInline((ul ?? ol)![1].trim()))
      if (list && list.type !== type) flushList()
      if (!list) list = { type, items: [] }
      list.items.push(text)
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  }
  flushParagraph()
  flushList()
  flushTable()
  return blocks
}
