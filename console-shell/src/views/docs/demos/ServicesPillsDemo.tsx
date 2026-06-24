import { GitBranch, Rocket, Database, Check } from 'lucide-react';
import { Card, Badge } from '@/components/ui';

/**
 * A static projection of the Services panel cards and their connection pills.
 * It mirrors ServicesPanel.tsx::ConnectionCard / ConnectionBadge: the same
 * card chrome, the same Connected / Checking / Not connected badge states, so
 * the reader sees the three states a real card moves through.
 */
type DemoConn = 'connected' | 'checking' | 'disconnected';

const SERVICES: { id: string; name: string; blurb: string; icon: typeof GitBranch; state: DemoConn; detail?: string }[] = [
    { id: 'github', name: 'GitHub', blurb: 'Repo state, Workboard issues, gh CLI auth.', icon: GitBranch, state: 'connected', detail: 'Connected as octocat' },
    { id: 'vercel', name: 'Vercel', blurb: 'Deploy status, projects, env vars.', icon: Rocket, state: 'checking' },
    { id: 'supabase', name: 'Supabase', blurb: 'Auth + Postgres status, project URL.', icon: Database, state: 'disconnected' },
];

export function ServicesPillsDemo() {
    return (
        <div className="grid w-full max-w-[640px] grid-cols-1 gap-4 sm:grid-cols-3">
            {SERVICES.map((s) => (
                <Card key={s.id} className="flex h-full flex-col gap-2.5 p-4 shadow-none">
                    <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary">
                            <s.icon className="h-3.5 w-3.5 text-foreground" />
                        </div>
                        <h3 className="text-card-title text-foreground">{s.name}</h3>
                        <ConnPill state={s.state} />
                    </div>
                    <p className="text-small leading-relaxed text-muted-foreground">{s.blurb}</p>
                    {s.detail && (
                        <p className="text-small text-muted-foreground">{s.detail}</p>
                    )}
                </Card>
            ))}
        </div>
    );
}

function ConnPill({ state }: { state: DemoConn }) {
    if (state === 'connected') {
        return (
            <Badge variant="success" className="ml-auto rounded-md">
                <Check className="h-2.5 w-2.5" />
                Connected
            </Badge>
        );
    }
    if (state === 'checking') {
        return (
            <Badge variant="secondary" className="ml-auto rounded-md text-muted-foreground">
                Checking…
            </Badge>
        );
    }
    return (
        <Badge variant="secondary" className="ml-auto rounded-md">
            Not connected
        </Badge>
    );
}
