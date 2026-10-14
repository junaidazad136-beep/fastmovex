/**
 * Grey placeholders shown the moment a page is tapped, while it loads: the same shape as the real page, so the
 * shopper sees the new page start at once and nothing jumps when it arrives.
 */

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-100 bg-white">
      <div className="skeleton aspect-square rounded-none" />
      <div className="space-y-1.5 p-2.5">
        <div className="skeleton h-3.5 w-full" />
        <div className="skeleton h-3.5 w-3/4" />
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton !mt-2.5 h-5 w-1/2" />
        <div className="skeleton !mt-2 h-9 w-full" />
      </div>
    </div>
  );
}

/** Category, search, offers, brand and store pages: title, filter and sort buttons, a grid of product cards. */
export function ListingSkeleton({ banner = false, testId = 'listing-loading' }: { banner?: boolean; testId?: string }) {
  return (
    <div className="container-page py-6" aria-busy="true" data-testid={testId}>
      {banner ? (
        <div className="mb-5 flex items-center gap-3">
          <div className="skeleton size-14 shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2"><div className="skeleton h-5 w-44" /><div className="skeleton h-3.5 w-28" /></div>
        </div>
      ) : (
        <div className="mb-3 space-y-2"><div className="skeleton h-6 w-48" /></div>
      )}
      <div className="mb-4 flex gap-2 overflow-hidden">
        {[72, 96, 84, 64, 90].map((w, i) => <div key={i} className="skeleton h-8 shrink-0 rounded-full" style={{ width: w }} />)}
      </div>
      <div className="mb-4 flex gap-2">
        <div className="skeleton h-10 flex-1 rounded-xl lg:max-w-40" />
        <div className="skeleton h-10 flex-1 rounded-xl lg:max-w-48" />
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => <li key={i} className={i >= 4 ? 'max-sm:hidden' : ''}><CardSkeleton /></li>)}
      </ul>
    </div>
  );
}

/** All categories: the title and the two-across category tiles. */
export function CategoriesSkeleton() {
  return (
    <div className="container-page py-5 sm:py-7" aria-busy="true" data-testid="categories-loading">
      <div className="skeleton mb-4 h-6 w-44 sm:mb-5" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => <li key={i}><div className="skeleton aspect-[2/1] rounded-2xl" /></li>)}
      </ul>
    </div>
  );
}

/** The cart: lines with a picture, title and quantity, and the order summary. */
export function CartSkeleton() {
  return (
    <div className="container-page py-6" aria-busy="true" data-testid="cart-loading">
      <div className="skeleton h-7 w-40" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="card divide-y divide-ink-100 px-4 sm:px-5">
          <div className="py-3"><div className="skeleton h-4 w-36" /></div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3 py-4">
              <div className="skeleton size-20 shrink-0 rounded-xl sm:size-24" />
              <div className="flex-1 space-y-2">
                <div className="flex justify-between gap-3"><div className="skeleton h-4 w-3/5" /><div className="skeleton h-4 w-16" /></div>
                <div className="skeleton h-3.5 w-2/5" />
                <div className="skeleton !mt-3 h-8 w-28 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
        <div className="card space-y-3 p-5">
          <div className="skeleton h-5 w-32" />
          <div className="skeleton h-10 w-full rounded-xl" />
          {[0, 1, 2].map((i) => <div key={i} className="flex justify-between"><div className="skeleton h-4 w-24" /><div className="skeleton h-4 w-16" /></div>)}
          <div className="skeleton !mt-5 h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/** Text pages (help, policies, contact): a title and paragraphs. */
export function TextPageSkeleton() {
  return (
    <div className="container-page max-w-3xl py-6" aria-busy="true" data-testid="page-loading">
      <div className="skeleton h-7 w-56" />
      <div className="mt-3 skeleton h-4 w-4/5" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-14 w-full rounded-xl" />)}
      </div>
    </div>
  );
}
