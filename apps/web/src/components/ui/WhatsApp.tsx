'use client';

import { MessageCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { useShop } from '@/lib/state/shop';

/** A plain chat bubble in WhatsApp green (we link to WhatsApp; we do not use its logo). */
export function WhatsAppIcon({ className = 'size-5' }: { className?: string }) {
  return <MessageCircle className={className} aria-hidden />;
}

/** wa.me link with a prefilled message; `number` is digits only (e.g. 97444001234). */
export function waLink(number: string, text?: string) {
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/**
 * Floating "Chat on WhatsApp" button, when the store has a WhatsApp number. Sits above the phone tab bar.
 * Not on product, cart and checkout pages: they have their own WhatsApp link, and nothing should cover the price or buttons.
 */
export function WhatsAppChat() {
  const t = useT();
  const { market } = useShop();
  const pathname = usePathname() ?? '';
  const number = market.whatsapp?.chat;
  if (!number || /^\/(en|ar)\/(p\/|cart|checkout)/.test(pathname)) return null;
  return (
    <a
      href={waLink(number, t('whatsapp.hello'))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('whatsapp.chat')}
      title={t('whatsapp.chat')}
      className="no-print fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] end-4 z-30 flex size-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[var(--shadow-pop)] transition hover:scale-105 lg:bottom-6 lg:end-6"
      data-testid="whatsapp-chat"
    >
      <WhatsAppIcon className="size-7" />
    </a>
  );
}

/** Inline link: "Ask on WhatsApp" with a message about this product or order. */
export function WhatsAppAsk({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { market } = useShop();
  const number = market.whatsapp?.chat;
  if (!number) return null;
  return (
    <a href={waLink(number, text)} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-sm font-medium text-[#075E54] hover:underline ${className}`} data-testid="whatsapp-ask">
      <WhatsAppIcon className="size-4" />{label}
    </a>
  );
}
