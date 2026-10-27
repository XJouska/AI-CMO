import type { RenderCtx } from '../context'
import { contentOr } from '../helpers'
import './template-content.css'

const rows = [
  { icon: 'minor-time.svg', title: '时长控制', text: '拟人化互动时长不连续使用超过2小时' },
  { icon: 'minor-content.svg', title: '内容精选', text: '展示更安全的优质内容，守护未成年人的健康成长' },
]

export function TemplateContentView({ ctx }: { ctx: RenderCtx }) {
  return <section className={`yb-minor-content ${ctx.className}`}>
    <div className="yb-minor-intro">
      <img alt="" src="/figma-assets/20744-28847.svg" width={108} height={108} />
      <h2>{contentOr(ctx.children, '未成年人模式未开启')}</h2>
    </div>
    <div className="yb-minor-benefits">
      {rows.map(row => <div className="yb-minor-benefit" key={row.icon}>
        <img alt="" src={`/figma-assets/${row.icon}`} width={32} height={32} />
        <div><h3>{row.title}</h3><p>{row.text}</p></div>
      </div>)}
    </div>
  </section>
}

export function IPadGuidelinesView({ ctx }: { ctx: RenderCtx }) {
  return <p className={ctx.className} data-reference-only>iPad 适配规则为 Figma 参考文档，不是 React 组件。</p>
}
