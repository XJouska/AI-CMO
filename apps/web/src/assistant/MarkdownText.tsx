// 回答渲染：安全 Markdown AST → 自有排版组件。所有文本都是 React 文本子节点，不注入 HTML。
import { Fragment } from 'react'
import { BulletList, Divider, Heading, NumberList, Quote, Text } from '@/ui'
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
    <div className="md">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <Heading key={index} level={block.level === 3 ? 3 : 4}>
                <Inline nodes={block.inline} />
              </Heading>
            )
          case 'paragraph':
            return (
              <Text key={index}>
                <Inline nodes={block.inline} />
              </Text>
            )
          case 'ul':
            return <BulletList items={block.items} key={index} />
          case 'ol':
            return <NumberList items={block.items} key={index} />
          case 'quote':
            return (
              <Quote key={index}>
                <Inline nodes={block.inline} />
              </Quote>
            )
          case 'divider':
            return <Divider key={index} />
          case 'table':
            return (
              <div className="md-table" key={index}>
                <table>
                  {block.header.length ? (
                    <thead>
                      <tr>
                        {block.header.map((cell, c) => (
                          <th key={c}>{cell}</th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
