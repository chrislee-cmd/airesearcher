import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalShell } from '@/components/legal-shell';
import { COMPANY, companyInfoLinesKo, companyInfoLinesEn } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Terms of Service · Research-mochi',
  description: 'Research-mochi 이용약관 / Terms of Service',
};

const EFFECTIVE_DATE = '2026-05-23';

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Terms text only exists in `ko` and `en`. Non-Korean locales — ja
  // and any future addition — see the English version until a localized
  // legal copy is added and reviewed.
  const Body = locale === 'ko' ? KoTerms : EnTerms;
  return (
    <LegalShell locale={locale}>
      <Body />
    </LegalShell>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-2 text-[26px] font-bold tracking-[-0.02em] text-ink-2">{children}</h1>;
}
function Meta({ children }: { children: React.ReactNode }) {
  return <p className="mb-10 text-[12px] text-mute-soft">{children}</p>;
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 mb-3 text-[16px] font-semibold tracking-[-0.01em] text-ink-2">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-mute">{children}</p>;
}
function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 list-disc space-y-1 pl-5 text-mute marker:text-mute-soft">{children}</ul>;
}

function KoTerms() {
  return (
    <>
      <H1>이용약관</H1>
      <Meta>시행일자 · {EFFECTIVE_DATE}</Meta>

      <H2>제1조 (목적)</H2>
      <P>
        본 약관은 {COMPANY.nameKo}(이하 “회사”)이 제공하는 {COMPANY.serviceName} 서비스(이하 “서비스”)의 이용과 관련하여
        회사와 이용자 간의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.
      </P>

      <H2>제2조 (정의)</H2>
      <UL>
        <li>“서비스”는 회사가 운영하는 웹사이트 및 모든 부가 기능을 의미합니다.</li>
        <li>“이용자”는 본 약관에 따라 서비스에 접속하여 이를 이용하는 회원 및 비회원을 말합니다.</li>
        <li>“크레딧”은 회사가 제공하는 유료 기능을 이용하기 위해 충전·사용하는 가상의 단위입니다.</li>
      </UL>

      <H2>제3조 (약관의 게시 및 변경)</H2>
      <P>회사는 본 약관을 서비스 초기 화면 또는 연결화면을 통해 게시합니다. 회사는 관련 법령을 위배하지 않는 범위에서 본 약관을 개정할 수 있으며, 약관이 변경되는 경우 변경된 약관의 적용일자 및 변경 사유를 명시하여 시행일 7일 전(이용자에게 불리한 변경의 경우 30일 전)부터 시행일 전일까지 공지합니다.</P>

      <H2>제4조 (서비스의 제공 및 변경)</H2>
      <UL>
        <li>회사는 인터뷰 전사, 데스크 리서치, 리포트 생성, 정량 분석 등 AI 기반 리서치 도구를 제공합니다.</li>
        <li>회사는 운영상·기술상의 필요에 따라 제공 중인 서비스의 일부 또는 전부를 변경할 수 있으며, 사전에 공지합니다.</li>
      </UL>

      <H2>제5조 (회원가입 및 계정)</H2>
      <P>이용자는 회사가 정한 절차에 따라 회원가입을 신청하며, 회사는 이를 승낙함으로써 회원자격을 부여합니다. 이용자는 자신의 계정 정보를 안전하게 관리할 책임이 있으며, 본인 계정의 모든 활동에 대해 책임을 집니다.</P>

      <H2>제6조 (크레딧 및 결제)</H2>
      <UL>
        <li>유료 기능은 크레딧을 차감하여 이용합니다. 기능별 크레딧 비용은 서비스 내 가격 페이지에 게시됩니다.</li>
        <li>크레딧 결제는 결제 처리사 <strong>Creem</strong>을 통해 이루어지며, 이용자의 결제 정보는 회사가 직접 저장하지 않습니다.</li>
        <li>구매한 크레딧의 유효기간 및 환불 정책은 별도 안내에 따릅니다.</li>
      </UL>

      <H2>제7조 (환불 정책)</H2>
      <UL>
        <li>이용자는 결제일로부터 7일 이내, 그리고 구매한 크레딧을 한 번도 사용하지 않은 경우에 한하여 전액 환불을 요청할 수 있습니다.</li>
        <li>일부라도 사용된 크레딧 또는 결제 후 7일이 지난 경우, 환불은 「전자상거래 등에서의 소비자보호에 관한 법률」 및 회사의 환불 기준에 따릅니다.</li>
        <li>환불 요청은 {COMPANY.email} 로 접수하며, 영업일 기준 7일 이내에 처리됩니다.</li>
      </UL>

      <H2>제8조 (이용자의 의무)</H2>
      <UL>
        <li>이용자는 타인의 정보를 도용하거나 허위 정보를 제공해서는 안 됩니다.</li>
        <li>이용자는 서비스를 이용하여 법령 또는 본 약관이 금지하거나 공서양속에 반하는 행위를 해서는 안 됩니다.</li>
        <li>이용자는 서비스를 통해 <strong>음란물·성적으로 노골적이거나 암시적인 콘텐츠</strong>, 아동 성착취물, 혐오·차별·폭력 조장 콘텐츠, 딥페이크·얼굴 합성·음성 도용물, 기타 위법하거나 해로운 콘텐츠를 생성·요청·업로드해서는 안 됩니다. 상세한 금지 행위는 <a href="/ko/use-policy" className="underline">이용정책(Acceptable Use Policy)</a>에 따릅니다.</li>
        <li>이용자가 서비스에 업로드한 콘텐츠(인터뷰 녹음, 전사, 문서 등)의 저작권 및 적법성에 대한 책임은 이용자에게 있습니다.</li>
      </UL>

      <H2>제9조 (서비스의 중단)</H2>
      <P>회사는 시스템 점검·교체, 통신 장애, 천재지변 등 불가항력적 사유가 있는 경우 서비스의 제공을 일시 중단할 수 있습니다. 회사는 사전 공지가 가능한 경우 이를 공지합니다.</P>

      <H2>제10조 (면책조항)</H2>
      <UL>
        <li>회사는 천재지변, 불가항력적 사유, 이용자의 귀책사유로 인한 서비스 이용 장애에 대해 책임을 지지 않습니다.</li>
        <li>AI가 생성한 결과물은 참고용이며, 회사는 해당 결과의 정확성·완전성을 보장하지 않습니다. 이용자는 의사결정에 활용하기 전 별도의 검토를 거쳐야 합니다.</li>
      </UL>

      <H2>제11조 (준거법 및 관할)</H2>
      <P>본 약관은 대한민국 법령에 따라 해석되며, 본 서비스와 관련한 분쟁이 발생할 경우 민사소송법상의 관할법원에 제소합니다.</P>

      <H2>제12조 (제3자 AI 서비스 및 비제휴)</H2>
      <P>
        {COMPANY.serviceName}은 OpenAI, Anthropic, Deepgram 등 제3자가 제공하는 AI 모델 및 API를
        기반으로 자체 인터페이스를 제공하는 독립 제품(independent wrapper)입니다. 회사는 위
        제3자와 어떠한 제휴·후원·승인 관계도 갖지 않으며, 해당 제공자들의 상표·로고는 각 권리자에게
        귀속됩니다. 제3자 AI의 가용성·정책 변경·서비스 중단으로 인한 서비스 영향에 대해 회사는
        합리적인 범위 내에서만 책임을 부담합니다.
      </P>

      <H2>제13조 (사업자 정보 및 문의처)</H2>
      <ul className="mb-3 list-none space-y-1 text-mute">
        {companyInfoLinesKo().map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}

function EnTerms() {
  return (
    <>
      <H1>Terms of Service</H1>
      <Meta>Effective · {EFFECTIVE_DATE}</Meta>

      <H2>1. Acceptance of Terms</H2>
      <P>
        These Terms govern your access to and use of the {COMPANY.serviceName} service (the &ldquo;Service&rdquo;) operated by
        {' '}{COMPANY.nameEn} (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). By creating an account or using
        the Service, you agree to be bound by these Terms.
      </P>

      <H2>2. Definitions</H2>
      <UL>
        <li>&ldquo;Service&rdquo; means the Research-mochi website and all associated features.</li>
        <li>&ldquo;User&rdquo; means any individual accessing or using the Service.</li>
        <li>&ldquo;Credits&rdquo; are virtual units used to access paid features of the Service.</li>
      </UL>

      <H2>3. Changes to the Terms</H2>
      <P>We may revise these Terms from time to time. Material changes will be announced at least 7 days (or 30 days for changes unfavorable to users) before the effective date through in-product notices.</P>

      <H2>4. The Service</H2>
      <UL>
        <li>The Service provides AI-assisted research tooling including interview transcription, desk research, report generation, and quantitative analysis.</li>
        <li>We may modify, suspend, or discontinue parts of the Service at our discretion, with prior notice where reasonably practicable.</li>
      </UL>

      <H2>5. Accounts</H2>
      <P>You are responsible for safeguarding your account credentials and for all activity that occurs under your account. You must provide accurate information and notify us promptly of any unauthorized access.</P>

      <H2>6. Credits and Payments</H2>
      <UL>
        <li>Paid features consume Credits. Per-feature Credit costs are displayed within the Service.</li>
        <li>Credit purchases are processed by our payment partner <strong>Creem</strong>. We do not store full payment card details on our servers.</li>
        <li>Credit validity and refund eligibility follow the policies set out below and any notices posted on the pricing page.</li>
      </UL>

      <H2>7. Refund Policy</H2>
      <UL>
        <li>You may request a full refund within 7 days of purchase, provided that none of the purchased Credits have been consumed.</li>
        <li>Partial usage or requests made after 7 days are governed by applicable consumer protection law and our case-by-case review.</li>
        <li>Send refund requests to {COMPANY.email}. We aim to process eligible refunds within 7 business days.</li>
      </UL>

      <H2>8. User Obligations</H2>
      <UL>
        <li>You will not impersonate others, submit false information, or attempt to gain unauthorized access to the Service.</li>
        <li>You will not use the Service for any unlawful purpose or in violation of these Terms.</li>
        <li>You will not generate, request, or upload <strong>NSFW, sexually explicit or suggestive content</strong>, child sexual abuse material, hate / discriminatory / violence-glorifying content, deepfakes or face-swap / voice-cloning of real people, or other unlawful or harmful material. Detailed prohibitions are set out in the <a href="/en/use-policy" className="underline">Acceptable Use Policy</a>.</li>
        <li>You are solely responsible for the lawfulness and ownership of any content (audio, transcripts, documents, etc.) that you upload to the Service.</li>
      </UL>

      <H2>9. Service Availability</H2>
      <P>The Service is provided on an &ldquo;as available&rdquo; basis. We may suspend the Service for maintenance, upgrades, or due to events outside our reasonable control.</P>

      <H2>10. Disclaimers and Limitation of Liability</H2>
      <UL>
        <li>AI-generated outputs are provided for reference only; we do not warrant their accuracy, completeness, or fitness for any particular purpose.</li>
        <li>To the maximum extent permitted by law, our aggregate liability arising from or related to the Service is limited to the fees paid by you in the 3 months preceding the event giving rise to the claim.</li>
      </UL>

      <H2>11. Governing Law</H2>
      <P>These Terms are governed by the laws of the Republic of Korea. Disputes shall be brought before the courts having jurisdiction under the Korean Civil Procedure Act.</P>

      <H2>12. Third-Party AI Providers and Non-Affiliation</H2>
      <P>
        {COMPANY.serviceName} is an independent product (an &ldquo;independent wrapper&rdquo;) that
        provides a custom interface to third-party AI models and APIs, including those operated
        by OpenAI, Anthropic, and Deepgram. We are not affiliated with, endorsed by, or
        sponsored by these providers; their trademarks and logos remain the property of their
        respective owners. Our responsibility for Service availability or changes caused by
        upstream provider outages or policy changes is limited to what is commercially reasonable.
      </P>

      <H2>13. Business Information &amp; Contact</H2>
      <ul className="mb-3 list-none space-y-1 text-mute">
        {companyInfoLinesEn().map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}
