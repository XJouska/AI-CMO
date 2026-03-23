import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Loader, Bot, User, Sparkles } from 'lucide-react';
import { API_URL } from '../api';

interface Message { role: 'user' | 'assistant'; content: string; }
interface AIChatPanelProps { conversationId?: string; }

export default function AIChatPanel({ conversationId }: AIChatPanelProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsStreaming(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/v1/ai-chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: userMsg, conversation_id: conversationId }),
      });
      if (!res.ok) throw new Error('Chat failed');
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No body');
      const decoder = new TextDecoder();
      let buffer = '', assistantMsg = '';
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          let et = '', ed = '';
          for (const line of trimmed.split('\n')) {
            if (line.startsWith('event:')) et = line.slice(6).trim();
            else if (line.startsWith('data:')) ed = line.slice(5).trim();
          }
          if (et === 'content' && ed) {
            assistantMsg += ed;
            setMessages(prev => { const c = [...prev]; c[c.length-1] = { role: 'assistant', content: assistantMsg }; return c; });
          }
        }
      }
    } catch {
      setMessages(prev => { const c = [...prev]; if (c.length && c[c.length-1].role === 'assistant') c[c.length-1] = { role: 'assistant', content: 'Sorry, something went wrong.' }; return c; });
    } finally { setIsStreaming(false); }
  };

  if (!expanded) return (
    <button className="ai-chat-fab" onClick={() => setExpanded(true)}>
      <Sparkles size={18} /><span>AI Chat</span>
    </button>
  );

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <div className="ai-chat-header-left"><Bot size={16} /><span>AI CMO Assistant</span></div>
        <button className="btn-icon" onClick={() => setExpanded(false)}>&#215;</button>
      </div>
      <div className="ai-chat-messages">
        {messages.length === 0 && (
          <div className="ai-chat-welcome"><Bot size={24} style={{ color: 'var(--primary)' }} /><p>{t('landing.featureChatDesc')}</p></div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-chat-msg ai-chat-msg-${msg.role}`}>
            <div className="ai-chat-msg-icon">{msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}</div>
            <div className="ai-chat-msg-content">{msg.content || '...'}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="ai-chat-input" onSubmit={e => { e.preventDefault(); handleSend(); }}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask your AI CMO..." disabled={isStreaming} />
        <button type="submit" className="btn-icon" disabled={!input.trim() || isStreaming}>
          {isStreaming ? <Loader size={16} className="spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}
