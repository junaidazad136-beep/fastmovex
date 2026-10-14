import { ListingSkeleton } from '@/components/ui/Skeletons';

/** Shown the moment a brand is tapped, while its products load. */
export default function Loading() {
  return <ListingSkeleton banner />;
}
