type Props = {
  size?: number;
  label?: string;
};

export function MochiLoader({ size = 56, label }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/landing/logo.png"
        alt=""
        width={size}
        height={size}
        className="mochi-sway"
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
      {label && (
        <span className="text-[11.5px] font-medium uppercase tracking-[.12em] text-mute-soft">
          {label}
        </span>
      )}
    </div>
  );
}
