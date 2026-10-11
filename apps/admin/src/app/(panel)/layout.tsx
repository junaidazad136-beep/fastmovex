import { Shell } from '@/components/layout/Shell';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
