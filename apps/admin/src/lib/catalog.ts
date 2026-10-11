'use client';

import { useMemo } from 'react';
import type { Brand } from './api/types';
import { useSession } from './state/session';
import { useApi } from './use-api';

interface AdminCategory { id: string; name: string; nameAr: string; parentId: string | null; depth: number; path: string; sortOrder: number; isActive: boolean }
interface PublicCategory { id: string; name: string; nameAr: string; sortOrder: number; children?: PublicCategory[] }

export interface CategoryOption { id: string; label: string; depth: number; isActive: boolean }

/**
 * Categories for pickers and filters, as an indented list in menu order.
 * Staff who manage categories also see hidden ones; everyone else gets the public tree.
 */
export function useCategoryOptions(): CategoryOption[] | undefined {
  const { can } = useSession();
  const full = can('categories.manage');
  const admin = useApi<AdminCategory[]>(full ? '/admin/categories' : null);
  const pub = useApi<PublicCategory[]>(full ? null : '/categories');
  return useMemo(() => {
    if (full) {
      if (!admin.data) return undefined;
      const byParent = new Map<string | null, AdminCategory[]>();
      for (const c of admin.data) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
      const out: CategoryOption[] = [];
      const walk = (parent: string | null, depth: number) => {
        for (const c of (byParent.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
          out.push({ id: c.id, label: c.name, depth, isActive: c.isActive });
          walk(c.id, depth + 1);
        }
      };
      walk(null, 0);
      return out;
    }
    if (!pub.data) return undefined;
    const out: CategoryOption[] = [];
    const walk = (list: PublicCategory[], depth: number) => {
      for (const c of list) {
        out.push({ id: c.id, label: c.name, depth, isActive: true });
        if (c.children?.length) walk(c.children, depth + 1);
      }
    };
    walk(pub.data, 0);
    return out;
  }, [full, admin.data, pub.data]);
}

export function categoryOptionLabel(o: CategoryOption): string {
  return `${'   '.repeat(o.depth)}${o.depth ? '└ ' : ''}${o.label}${o.isActive ? '' : ' (hidden)'}`;
}

export function useBrands(q = '') {
  return useApi<Brand[]>(`/brands${q ? `?q=${encodeURIComponent(q)}` : ''}`);
}
