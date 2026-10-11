import {
  Baby, Car, CookingPot, Cookie, Cpu, Dumbbell, Footprints, Gamepad2, Gift, HeartPulse, Laptop, PawPrint, PenLine, Plane,
  Shapes, Shirt, ShoppingBag, ShoppingBasket, Smartphone, Sofa, Sparkles, SprayCan, Wrench, type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';

/** Icons for the launch categories. Categories added later by admins use their uploaded icon, or a neutral shape. */
const ICONS: Record<string, LucideIcon> = {
  electronics: Cpu, 'phones-accessories': Smartphone, computers: Laptop, gaming: Gamepad2, fashion: Shirt, shoes: Footprints,
  bags: ShoppingBag, beauty: Sparkles, perfumes: SprayCan, 'health-personal-care': HeartPulse, 'home-kitchen': CookingPot,
  furniture: Sofa, groceries: ShoppingBasket, 'food-snacks': Cookie, 'baby-kids': Baby, 'sports-fitness': Dumbbell,
  automotive: Car, tools: Wrench, 'pet-supplies': PawPrint, 'office-stationery': PenLine, travel: Plane, gifts: Gift,
};

export function CategoryIcon({ slug, iconUrl, className = 'size-7' }: { slug: string; iconUrl?: string | null; className?: string }) {
  if (iconUrl) return <Image src={iconUrl} alt="" width={40} height={40} className="size-10 object-contain" />;
  const I = ICONS[slug] ?? Shapes;
  return <I className={className} strokeWidth={1.6} aria-hidden />;
}
