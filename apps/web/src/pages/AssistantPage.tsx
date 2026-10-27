import { useState } from 'react'
import { InternalNavBarTitle, Markdown, NavBar } from '@yb/generated/components'
import { TabPage } from '@/components/local/TabPage'
import { useToast } from '@/feedback/toast'
import { t } from '@/i18n'

export function AssistantPage() {
  const toast = useToast()
  const [draft, setDraft] = useState('')

  return (
    <TabPage
      input={{
        onChange: setDraft,
        onSend: () => {
          if (!draft.trim()) return
          toast.show(t.assistant.sendComingSoon)
          setDraft('')
        },
        onStop: () => {},
        placeholder: t.assistant.inputPlaceholder,
        state: 'idle',
        value: draft,
      }}
      nav={
        <NavBar
          barType="Agent"
          middleSlot={<InternalNavBarTitle dualTitle="False">{t.app.name}</InternalNavBarTitle>}
          onAction={(action) => {
            if (action === 'back') toast.show(t.assistant.historyComingSoon)
          }}
          primaryBg
          rightButton={false}
        />
      }
      surface="primary"
    >
      <div className="assistant-welcome">
        <Markdown variant="H3">{t.assistant.welcomeTitle}</Markdown>
        <Markdown variant="Body">
          <p>{t.assistant.welcomeBody}</p>
        </Markdown>
        <Markdown items={[...t.assistant.welcomeItems]} variant="UL" />
      </div>
    </TabPage>
  )
}
