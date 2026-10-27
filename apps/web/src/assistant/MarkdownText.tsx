// 回答渲染：安全 Markdown AST → 正式 Markdown 组件变体。所有文本都是 React 文本子节点。
import { Markdown } from '@yb/generated/components'
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
          default:
            return null
        }
      })}
    </>
  )
}
