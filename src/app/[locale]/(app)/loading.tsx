export default function Loading() {
  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <div className="h-[28px] w-[220px] animate-pulse [border-radius:2px] bg-paper-soft" />
        <div className="h-[14px] w-[88px] animate-pulse [border-radius:2px] bg-paper-soft" />
      </div>
      <div className="mt-8 space-y-3">
        <div className="h-[14px] w-2/3 animate-pulse [border-radius:2px] bg-paper-soft" />
        <div className="h-[14px] w-1/2 animate-pulse [border-radius:2px] bg-paper-soft" />
        <div className="mt-6 h-[180px] w-full animate-pulse [border-radius:2px] bg-paper-soft" />
      </div>
    </div>
  );
}
