import { ListingSkeleton } from '@/components/ui/Skeletons';

/** Shown the moment a store is tapped, while its page loads. */
export default function Loading() {
  return <ListingSkeleton banner />;
}
