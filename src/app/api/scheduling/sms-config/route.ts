import { NextResponse } from 'next/server';
import { getSchedulingAccess } from '@/lib/scheduling/access';
import { isSolapiConfigured } from '@/lib/sms/solapi';

// GET — 문자 알림(Solapi)이 이 배포에서 설정됐는지 여부. 채팅 컴포저가 이 값으로
// "📱 문자 알림" 체크박스의 노출을 결정한다(미설정이면 미노출 — 회귀 0). 스케줄링
// 게이트와 동일한 접근 통제(비인가는 404, 라우트 unobservable). 설정 여부만
// 노출하고 자격/발신번호 값은 절대 반환하지 않는다.
export async function GET() {
  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(
    { configured: isSolapiConfigured() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
