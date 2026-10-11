'use client';

import { ExternalLink, Plus } from 'lucide-react';
import Link from 'next/link';
import { useConfig } from '@/components/layout/Providers';
import { Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Table } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

export interface AdminPage {
  id: string;
  slug: string;
  title: string;
  titleAr: string;
  body: string;
  bodyAr: string;
  isPublished: boolean;
  showInFooter: boolean;
  sortOrder: number;
  updatedAt: string;
}

export function PagesList() {
  const { storefrontUrl } = useConfig();
  const pages = useApi<AdminPage[]>('/admin/pages');
  return (
    <>
      <PageHeader
        title="Pages"
        description="Text pages of the website: About, Privacy, Terms and any others. Published pages marked “In footer” are linked at the bottom of every page."
        actions={<Link href="/pages/new" className="btn-primary"><Plus className="size-4" aria-hidden /> New page</Link>}
      />
      <Card bodyClassName="p-0">
        {pages.error ? <ErrorState error={pages.error} onRetry={pages.reload} /> : (
          <Table>
            <thead><tr><th className="th">Page</th><th className="th">Web address</th><th className="th">Status</th><th className="th">Updated</th><th className="th w-10"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {!pages.data ? <SkeletonRows cols={5} rows={3} /> : null}
              {pages.data?.map((p) => (
                <tr key={p.id} className="relative hover:bg-ink-25">
                  <td className="td">
                    <Link href={`/pages/${p.id}`} className="font-medium after:absolute after:inset-0 hover:text-brand-700">{p.title}</Link>
                    <p dir="rtl" lang="ar" className="text-start text-xs text-ink-500">{p.titleAr}</p>
                  </td>
                  <td className="td text-ink-600">/{p.slug}</td>
                  <td className="td">
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={p.isPublished ? 'green' : 'gray'}>{p.isPublished ? 'Published' : 'Draft'}</Badge>
                      {p.isPublished && p.showInFooter ? <Badge>In footer</Badge> : null}
                    </span>
                  </td>
                  <td className="td text-ink-600">{formatDateTime(p.updatedAt)}</td>
                  <td className="td">
                    {p.isPublished ? (
                      <a href={`${storefrontUrl}/en/${p.slug}`} target="_blank" rel="noopener noreferrer" className="relative z-10 rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-800" aria-label={`View ${p.title} on the website`}>
                        <ExternalLink className="size-4" aria-hidden />
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pages.data?.length === 0 ? <EmptyState title="No pages yet" /> : null}
      </Card>
    </>
  );
}
