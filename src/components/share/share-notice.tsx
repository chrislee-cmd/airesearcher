import { getTranslations } from 'next-intl/server';

// 데이터 노출 0 안내 화면 — 무효/만료/폐기 토큰용. 초대·리소스 정보는 전혀
// 담지 않는다(제목·설명 문구만). 가입 유도도 없다(결정 2).

export type ShareNoticeVariant = 'invalid' | 'expired' | 'revoked';

export async function ShareNotice({ variant }: { variant: ShareNoticeVariant }) {
  const t = await getTranslations('ShareViewer');
  const title = t(`${variant}Title`);
  const body = t(`${variant}Body`);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[420px] text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-mute-soft">
          {t('eyebrow')}
        </span>
        <h1 className="mt-2 text-2xl font-bold tracking-[-0.01em] text-ink">
          {title}
        </h1>
        <p className="mt-3 text-md leading-[1.7] text-mute">{body}</p>
      </div>
    </main>
  );
}
