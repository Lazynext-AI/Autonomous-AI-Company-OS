export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-56 bg-card rounded-lg mb-3" />
      <div className="h-4 w-80 bg-card rounded mb-8" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-card border border-border rounded-[14px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="h-64 bg-card border border-border rounded-[14px]" />
        <div className="h-64 bg-card border border-border rounded-[14px]" />
      </div>
    </div>
  );
}
