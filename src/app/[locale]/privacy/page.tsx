import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalShell } from '@/components/legal-shell';
import { COMPANY, companyInfoLinesKo, companyInfoLinesEn } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Privacy Policy · Research-Canvas',
  description: 'Research-Canvas 개인정보처리방침 / Privacy Policy',
};

const EFFECTIVE_DATE = '2026-05-23';

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Privacy text only exists in `ko` and `en`. Non-Korean locales — ja
  // and any future addition — see the English version until a localized
  // legal copy is added and reviewed.
  const Body = locale === 'ko' ? KoPrivacy : EnPrivacy;
  return (
    <LegalShell locale={locale}>
      <Body />
    </LegalShell>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-2 text-display font-bold tracking-[-0.02em] text-ink-2">{children}</h1>;
}
function Meta({ children }: { children: React.ReactNode }) {
  return <p className="mb-10 text-md text-mute-soft">{children}</p>;
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 mb-3 text-2xl font-semibold tracking-[-0.01em] text-ink-2">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-mute">{children}</p>;
}
function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 list-disc space-y-1 pl-5 text-mute marker:text-mute-soft">{children}</ul>;
}

function KoPrivacy() {
  return (
    <>
      <H1>개인정보처리방침</H1>
      <Meta>시행일자 · {EFFECTIVE_DATE}</Meta>

      <P>
        {COMPANY.nameKo}(이하 “회사”)은 이용자의 개인정보를 중요시하며, 「개인정보 보호법」, 「정보통신망 이용촉진
        및 정보보호 등에 관한 법률」 등 관련 법령을 준수합니다. 회사는 본 방침을 통해 이용자의 개인정보가 어떠한
        용도와 방식으로 이용되고 있으며, 개인정보 보호를 위해 어떠한 조치가 취해지고 있는지 안내합니다.
      </P>

      <H2>1. 수집하는 개인정보 항목</H2>
      <UL>
        <li>회원가입 시: 이메일 주소, 이름(또는 표시명), Google OAuth 식별자(해당 시), 비밀번호 해시</li>
        <li>유료 결제 시: 결제 처리사 Lemon Squeezy 측에서 카드정보를 수집·처리하며, 회사는 결제 결과(거래 ID, 금액, 결제 상태)만 수신·저장</li>
        <li>서비스 이용 과정에서 자동 생성: 접속 로그, IP 주소, 디바이스/브라우저 정보, 쿠키, 이용 기록</li>
        <li>이용자가 직접 업로드한 콘텐츠: 인터뷰 녹음·전사본, 설문 데이터, 리서치 문서 등</li>
      </UL>

      <H2>2. 개인정보의 수집 및 이용 목적</H2>
      <UL>
        <li>회원 식별·인증 및 서비스 제공</li>
        <li>크레딧 결제·정산, 환불 처리</li>
        <li>AI 분석·전사·리포트 생성 등 서비스 기능 수행</li>
        <li>서비스 개선을 위한 통계 분석, 부정이용 방지</li>
        <li>고객 문의 응대 및 공지사항 전달</li>
      </UL>

      <H2>3. 개인정보의 보유 및 이용 기간</H2>
      <UL>
        <li>회원 정보: 회원 탈퇴 시 지체 없이 파기. 단, 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관(예: 전자상거래법 — 계약·청약철회 5년, 결제 기록 5년).</li>
        <li>이용자 업로드 콘텐츠: 이용자가 직접 삭제하거나 회원 탈퇴 시 30일 내 파기.</li>
        <li>접속 로그: 통신비밀보호법에 따라 3개월간 보관 후 파기.</li>
      </UL>

      <H2>4. 개인정보의 제3자 제공 및 처리위탁</H2>
      <P>회사는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 다만, 서비스 운영을 위해 다음의 처리위탁이 이루어지고 있습니다.</P>
      <UL>
        <li><strong>Lemon Squeezy</strong> — 결제 처리(카드 인증, 결제 승인, 환불)</li>
        <li><strong>Supabase</strong> — 데이터베이스·인증·파일 스토리지 호스팅</li>
        <li><strong>Vercel</strong> — 웹 애플리케이션 호스팅 및 로그</li>
        <li><strong>OpenAI / Anthropic</strong> — AI 모델 추론(전사·요약·분석 입력 및 출력)</li>
        <li><strong>Google</strong> — 리크루팅 폼 발행 및 응답 저장(Google Forms / Drive)</li>
        <li><strong>Mixpanel</strong> — 서비스 이용 통계 분석</li>
      </UL>
      <P>위 수탁사들은 회사와의 계약에 따라 개인정보의 안전한 처리 및 비밀유지 의무를 부담합니다.</P>
      <P>
        이용자가 서비스 내 리크루팅 기능으로 발행한 설문의 응답(전화번호·이름·기타 응답 내용)은 회사가 운영하는
        단일 Google 계정의 Google Drive에 통합 저장되며, 서비스 운영자만 접근할 수 있습니다. 응답자는 Google Forms의
        표준 방식으로 데이터를 제공합니다.
      </P>

      <H2>5. 이용자의 권리</H2>
      <UL>
        <li>이용자는 언제든지 자신의 개인정보를 열람·정정·삭제·처리정지 요청할 수 있습니다.</li>
        <li>요청은 {COMPANY.email} 로 접수하며, 본인 확인 후 지체 없이 처리합니다.</li>
        <li>회원 탈퇴는 서비스 내 [설정] 메뉴 또는 위 이메일을 통해 신청할 수 있습니다.</li>
      </UL>

      <H2>6. 쿠키의 운영</H2>
      <P>회사는 이용자 인증 및 서비스 개선을 위해 쿠키(cookie)를 사용합니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으며, 이 경우 일부 서비스 이용에 제한이 있을 수 있습니다.</P>

      <H2>7. 개인정보의 안전성 확보 조치</H2>
      <UL>
        <li>전송 구간 암호화(HTTPS/TLS), 저장 데이터 암호화</li>
        <li>접근 권한 최소화 및 접근 통제 시스템 운영</li>
        <li>개인정보 처리 시스템에 대한 접속 기록 보관·점검</li>
      </UL>

      <H2>8. 개인정보보호 책임자</H2>
      <P>
        책임자: {COMPANY.privacyOfficer}<br />
        이메일: <a href={`mailto:${COMPANY.email}`} className="text-amore underline-offset-2 hover:underline">{COMPANY.email}</a>
      </P>

      <H2>9. 사업자 정보</H2>
      <ul className="mb-3 list-none space-y-1 text-mute">
        {companyInfoLinesKo().map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <H2>10. 방침의 변경</H2>
      <P>본 방침은 법령·정책 또는 보안기술의 변경에 따라 내용의 추가, 삭제 및 수정이 있을 수 있으며, 변경 시 시행일 7일 전부터 서비스 내 공지를 통해 안내합니다.</P>
    </>
  );
}

function EnPrivacy() {
  return (
    <>
      <H1>Privacy Policy</H1>
      <Meta>Effective · {EFFECTIVE_DATE}</Meta>

      <P>
        {COMPANY.nameEn} (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) respects your privacy. This policy
        explains what information we collect, how we use it, who we share it with, and the rights you have over your
        data.
      </P>

      <H2>1. Information We Collect</H2>
      <UL>
        <li>Account information — email, display name, Google OAuth identifier (if used), and a hashed password.</li>
        <li>Payment information — handled directly by our payment processor Lemon Squeezy. We receive and retain only transaction metadata (transaction ID, amount, status); we do not store full card details.</li>
        <li>Usage data — access logs, IP address, device and browser information, cookies, and product interactions.</li>
        <li>User content — recordings, transcripts, survey data, research documents, and other files you upload.</li>
      </UL>

      <H2>2. How We Use Information</H2>
      <UL>
        <li>To authenticate users and provide the Service.</li>
        <li>To process credit purchases, settlements, and refunds.</li>
        <li>To run AI inference (transcription, summarization, analysis) on your behalf.</li>
        <li>To improve the Service and prevent abuse.</li>
        <li>To respond to support inquiries and send service notices.</li>
      </UL>

      <H2>3. Retention</H2>
      <UL>
        <li>Account data is deleted promptly upon account termination, except where retention is required by law (e.g., e-commerce records — 5 years).</li>
        <li>User-uploaded content is deleted within 30 days of account termination or upon user request.</li>
        <li>Access logs are retained for 3 months in accordance with applicable communications law.</li>
      </UL>

      <H2>4. Sharing and Processors</H2>
      <P>We do not sell personal data. We share data only with the following subprocessors, each bound by a written agreement:</P>
      <UL>
        <li><strong>Lemon Squeezy</strong> — payment processing</li>
        <li><strong>Supabase</strong> — database, authentication, and file storage</li>
        <li><strong>Vercel</strong> — application hosting and logs</li>
        <li><strong>OpenAI / Anthropic</strong> — AI model inference (inputs and outputs)</li>
        <li><strong>Google</strong> — recruiting form publishing and response storage (Google Forms / Drive)</li>
        <li><strong>Mixpanel</strong> — product analytics</li>
      </UL>
      <P>
        Responses to recruiting surveys you publish through the Service (phone numbers, names, and other answer
        content) are stored together in the Google Drive of a single Google account operated by us, accessible only to
        the Service operator. Respondents submit their data through Google Forms&rsquo; standard flow.
      </P>

      <H2>5. Your Rights</H2>
      <UL>
        <li>You may request access, correction, deletion, or restriction of your personal data at any time.</li>
        <li>Send requests to {COMPANY.email}. We will verify your identity and respond without undue delay.</li>
        <li>You may close your account through the in-product Settings menu or by emailing us.</li>
      </UL>

      <H2>6. Cookies</H2>
      <P>We use cookies for authentication and product improvement. You may disable cookies in your browser settings; some features may not function without them.</P>

      <H2>7. Security</H2>
      <UL>
        <li>Encryption in transit (HTTPS/TLS) and at rest for stored data.</li>
        <li>Principle of least privilege for internal access; access logging and review.</li>
      </UL>

      <H2>8. Data Protection Contact</H2>
      <P>
        Officer: {COMPANY.privacyOfficer}<br />
        Email: <a href={`mailto:${COMPANY.email}`} className="text-amore underline-offset-2 hover:underline">{COMPANY.email}</a>
      </P>

      <H2>9. Business Information</H2>
      <ul className="mb-3 list-none space-y-1 text-mute">
        {companyInfoLinesEn().map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <H2>10. Changes to This Policy</H2>
      <P>We may update this Policy from time to time. Material changes will be announced at least 7 days in advance through in-product notices.</P>
    </>
  );
}
