// 任务进度：标题（进行中 / 完成）+ 步骤列表。用于 AI 整理档案、生成官网、助手的工具调用。
import { Check, CircleDashed, Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '@/ui'

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | string

export function StepProgress({ title, running, steps, className }: { title: ReactNode; running: boolean; steps: { key: string; label: ReactNode; status: StepStatus }[]; className?: string }) {
  return (
    <div className={cx('step-progress', className)} data-running={running || undefined}>
      <div className="step-progress__title">
        {running ? <Loader2 aria-hidden className="ui-spin" size={16} /> : <Check aria-hidden size={16} />}
        <span>{title}</span>
      </div>
      {steps.length ? (
        <ol className="step-progress__list">
          {steps.map((step) => (
            <li className={cx('step-progress__item', `is-${step.status}`)} key={step.key}>
              <StepIcon status={step.status} />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <Check aria-label="已完成" role="img" size={14} />
  if (status === 'running') return <Loader2 aria-label="进行中" className="ui-spin" role="img" size={14} />
  if (status === 'failed') return <X aria-label="失败" role="img" size={14} />
  return <CircleDashed aria-label="等待中" role="img" size={14} />
}
