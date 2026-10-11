import { Badge, type Tone } from '@/components/ui';

const TONE: Record<string, Tone> = { VIP: 'amber', RISKY: 'red', WHOLESALE: 'blue', CORPORATE: 'blue', INFLUENCER: 'green' };
export const tagLabel = (t: string) => t.replace(/_/g, ' ');

/** Customer tags as small badges (VIP gold, Risky red, Wholesale blue, the rest grey). Staff only. */
export function TagBadges({ tags, className }: { tags: string[] | null | undefined; className?: string }) {
  if (!tags?.length) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className ?? ''}`} data-testid="customer-tags">
      {tags.map((t) => <Badge key={t} tone={TONE[t] ?? 'gray'}>{tagLabel(t)}</Badge>)}
    </span>
  );
}
