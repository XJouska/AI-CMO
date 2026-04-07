import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, ChevronUp, ChevronDown, Circle } from 'lucide-react';
import api from '../api';

interface LogEntry {
  timestamp: string;
  message: string;
  type: string;
}

export default function TerminalPanel() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (expanded && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, expanded]);

  const fetchLogs = async () => {
    try {
      const { data } = await api.get('/api/v1/terminal/recent');
      setLogs(data.logs || []);
    } catch { /* ignore */ }
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-header" onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Terminal size={14} />
          <span>{t('terminal.title')}</span>
          {logs.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Circle size={6} fill="#4ade80" color="#4ade80" />
              <span style={{ fontSize: '0.7rem', color: '#4ade80' }}>{t('terminal.running')}</span>
            </span>
          )}
        </div>
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </div>
      {expanded && (
        <div className="terminal-body">
          {logs.length === 0 ? (
            <div className="terminal-line" style={{ color: 'var(--text-muted)' }}>{t('terminal.noLogs')}</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="terminal-line">
                <span className="timestamp">[{log.timestamp}]</span>
                {log.message}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
