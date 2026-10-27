// 回答渲染：安全 Markdown AST → 正式 Markdown 组件变体。所有文本都是 React 文本子节点。
import { Markdown, SettingsFullWidthItem } from '@yb/generated/components'
import { Fragment } from 'react'
import { parseMarkdown, type InlineNode } from './markdown'

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'strong') return <strong key={index}>{node.text}</strong>
        if (node.type === 'link') {
          return (
            <a href={node.href} key={index} referrerPolicy="no-referrer" rel="noopener noreferrer nofollow" target="_blank">
              {node.text}（{node.host}）
            </a>
          )
        }
        return <Fragment key={index}>{node.text}</Fragment>
      })}
    </>
  )
}

export function MarkdownText({ text }: { text: string }) {
  const blocks = parseMarkdown(text)
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <Markdown key={index} variant={block.level === 3 ? 'Others+H3' : 'Others+H4'}>
                <Inline nodes={block.inline} />
              </Markdown>
            )
          case 'paragraph':
            return (
              <Markdown key={index} variant="Body">
                <p>
                  <Inline nodes={block.inline} />
                </p>
              </Markdown>
            )
          case 'ul':
            return <Markdown items={block.items} key={index} variant="UL" />
          case 'ol':
            return <Markdown items={block.items} key={index} variant="OL" />
          case 'quote':
            return (
              <Markdown key={index} quoteText={<Inline nodes={block.inline} />} variant="Quote" />
            )
          case 'divider':
            return <Markdown key={index} variant="Divider" />
          case 'table':
            // 正式 Table 变体表头写死（GAP-014）：用正式列表行逐行展示「第一列 → 其余列」
            return (
              <div className="md-table" key={index}>
                {block.rows.map((row, r) => (
                  <SettingsFullWidthItem key={r} trailing={row.slice(1).join(' · ') || ' '} trailingKind="none" type="单行列表-常规">
                    {row[0] ?? ''}
                  </SettingsFullWidthItem>
                ))}
              </div>
            )
          default:
            return null
        }
      })}
    </>
  )
}
