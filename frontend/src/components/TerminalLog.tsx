import { useRef, useEffect, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react';

interface TerminalLogProps { messages: string[]; thinkingMessages: string[]; }

export default function TerminalLog({ messages, thinkingMessages }: TerminalLogProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const allMessages = [
    ...thinkingMessages.map(m => ({ type: 'think' as const, text: m })),
    ...messages.map(m => ({ type: 'detail' as const, text: m })),
  ];

  useEffect(() => { if (expanded) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [allMessages.length, expanded]);

  if (allMessages.length === 0) return null;

  return (
    <div className="terminal-log">
      <button className="terminal-log-header" onClick={() => setExpanded(!expanded)}>
        <div className="terminal-log-header-left">
          <Terminal size={13} />
          <span>AI CMO Terminal</span>
          <span className="terminal-running-badge">Running</span>
        </div>
        <div className="terminal-log-header-right">
          <span className="terminal-count">{allMessages.length}</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>
      {expanded && (
        <div className="terminal-log-body">
          {allMessages.slice(-20).map((msg, i) => (
            <div key={i} className={`terminal-line ${msg.type === 'think' ? 'terminal-think' : ''}`}>
              <span className="terminal-prefix">{msg.type === 'think' ? '>' : '$'}</span>
              <span className="terminal-text">{msg.text}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
