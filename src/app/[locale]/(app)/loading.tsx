import { MochiLoader } from '@/components/ui/mochi-loader';

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <MochiLoader size={64} label="불러오는 중" />
    </div>
  );
}
