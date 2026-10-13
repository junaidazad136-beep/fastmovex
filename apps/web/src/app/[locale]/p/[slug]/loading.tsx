/** Shown the moment a product is tapped, while its page loads: the same shape as the page, so nothing jumps. */
export default function ProductLoading() {
  return (
    <div className="container-page pb-6 pt-3 md:pt-6" aria-busy="true" data-testid="product-loading">
      <div className="mb-4 max-md:hidden"><div className="skeleton h-4 w-64" /></div>
      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-12">
        <div className="lg:col-start-2 lg:row-start-1">
          <div className="flex items-center gap-2.5">
            <div className="skeleton size-9 rounded-full" />
            <div className="space-y-1.5"><div className="skeleton h-3.5 w-28" /><div className="skeleton h-3 w-16" /></div>
            <div className="skeleton ms-auto h-3.5 w-24" />
          </div>
          <div className="mt-3 space-y-2"><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-4/5" /><div className="skeleton h-3.5 w-40" /></div>
        </div>
        <div className="-mx-4 mt-3 sm:-mx-6 md:mx-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:mt-0">
          <div className="skeleton aspect-square w-full rounded-none md:rounded-2xl" />
        </div>
        <div className="lg:col-start-2 lg:row-start-2">
          <div className="mt-4 flex gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-36 w-[104px] rounded-xl" />)}</div>
          <div className="skeleton mt-4 h-24 w-full rounded-2xl" />
          <div className="skeleton mt-4 h-40 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
