import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';

const COLORS: Record<string, string> = {
  reddit: '#FF4500', youtube: '#FF0000', twitter: '#1DA1F2', quora: '#B92B27',
  producthunt: '#DA552F', hackernews: '#FF6600', linkedin: '#0077B5',
  tiktok: '#FF0050', instagram: '#E1306C', facebook: '#1877F2',
};

interface Props { platformResults: Record<string, number>; }

export default function PlatformBreakdown({ platformResults }: Props) {
  const data = Object.entries(platformResults).map(([name, count]) => ({
    name, count, fill: COLORS[name.toLowerCase()] || '#6366f1',
  }));
  if (data.length === 0) return null;

  return (
    <div className="platform-breakdown fadein">
      <div style={{ height: 180 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={90}
              tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
            <Tooltip contentStyle={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 8, color: 'var(--text-primary)'
            }} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
              {data.map((entry, i) => (<Cell key={i} fill={entry.fill} />))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
