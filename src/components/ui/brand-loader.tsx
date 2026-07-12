type Props = {
  size?: number;
  label?: string;
};

export function BrandLoader({ size = 56, label }: Props) {
  return (
    <div className="flex flex-col items-center gap-4" data-ds-primitive="BrandLoader">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/branding/icons/03_ICON_FULL_COLOR.svg"
        alt=""
        width={size}
        height={size}
        className="brand-sway"
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
      {label && (
        <span className="text-sm font-medium uppercase tracking-[.12em] text-mute-soft">
          {label}
        </span>
      )}
    </div>
  );
}
