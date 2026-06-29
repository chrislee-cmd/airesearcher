import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalShell } from '@/components/legal-shell';
import { COMPANY } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Acceptable Use Policy · Research-Canvas',
  description: 'Research-Canvas 이용정책 / Acceptable Use Policy',
};

const EFFECTIVE_DATE = '2026-05-31';

export default async function UsePolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const Body = locale === 'ko' ? KoPolicy : EnPolicy;
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

function KoPolicy() {
  return (
    <>
      <H1>이용정책 (Acceptable Use Policy)</H1>
      <Meta>시행일자 · {EFFECTIVE_DATE}</Meta>

      <P>
        본 이용정책은 {COMPANY.nameKo}이 운영하는 {COMPANY.serviceName} 서비스(이하 “서비스”)를
        이용할 때 적용되는 행위 규범입니다. 본 정책은 이용약관의 일부로 간주되며, 본 정책을 위반할
        경우 회사는 사전 통지 없이 계정 정지·콘텐츠 삭제·환불 거절 등의 조치를 취할 수 있습니다.
      </P>

      <H2>1. 허용되는 사용 범위</H2>
      <UL>
        <li>UX 리서치, 시장 조사, 학술 연구 등 합법적인 리서치 워크플로우 자동화</li>
        <li>본인 또는 권한을 가진 제3자의 인터뷰·문서·데이터에 대한 전사·요약·분석</li>
        <li>리서치 결과의 정리·시각화·리포트 작성</li>
      </UL>

      <H2>2. 금지되는 콘텐츠 생성·요청·업로드</H2>
      <P>
        이용자는 다음에 해당하는 콘텐츠를 서비스를 통해 생성하거나 요청하거나 업로드할 수 없습니다.
      </P>
      <UL>
        <li><strong>NSFW·성적으로 노골적이거나 암시적인 콘텐츠</strong> (텍스트, 이미지, 오디오, 비디오 일체)</li>
        <li>아동 성착취물 (CSAM) 또는 미성년자 성적 묘사</li>
        <li>혐오 발언, 차별, 특정 집단·개인에 대한 괴롭힘·위협</li>
        <li>폭력·자해·자살을 미화하거나 조장하는 콘텐츠</li>
        <li>타인 사칭, 딥페이크, 얼굴 합성, 음성 도용</li>
        <li>불법 약물·무기·테러·범죄 행위를 모의·조장하는 내용</li>
        <li>저작권·상표권·초상권·개인정보 등 제3자 권리를 침해하는 콘텐츠</li>
        <li>맬웨어, 스팸, 피싱, 사기 등 시스템·이용자에게 해를 끼치는 행위</li>
      </UL>

      <H2>3. 기술적 남용 금지</H2>
      <UL>
        <li>서비스의 보안·접근 통제·요금 차감·할당량 제한을 우회하거나 회피하는 행위</li>
        <li>자동화된 도구로 비정상적 부하를 유발하거나 다른 이용자의 서비스 이용을 방해하는 행위</li>
        <li>리버스 엔지니어링·소스 코드 추출·API 무단 사용·계정 공유 판매</li>
      </UL>

      <H2>4. 데이터 책임</H2>
      <P>
        이용자는 서비스에 업로드하는 모든 콘텐츠(인터뷰 녹음, 전사, 문서 등)에 대해 적법한 권원
        및 동의를 보유해야 하며, 개인정보가 포함된 경우 관련 법령(GDPR, 개인정보보호법 등)을
        준수할 책임이 있습니다.
      </P>

      <H2>5. AI 결과물의 검토 의무</H2>
      <P>
        AI가 생성한 결과물에는 환각(hallucination)·오류·편향이 포함될 수 있습니다. 이용자는
        결과물을 의사결정·외부 공개·법적 절차에 활용하기 전에 반드시 사실관계를 검증해야 합니다.
      </P>

      <H2>6. 신고 및 위반 시 조치</H2>
      <UL>
        <li>본 정책 위반이 의심되는 사용을 발견한 경우 {COMPANY.email} 로 신고할 수 있습니다.</li>
        <li>회사는 위반 사항에 대해 자체 조사 후 경고, 콘텐츠 삭제, 계정 일시 정지·영구 정지,
            환불 거절, 관련 기관 신고 등의 조치를 취할 수 있습니다.</li>
        <li>중대 위반의 경우 사전 통지 없이 즉시 계정이 정지될 수 있습니다.</li>
      </UL>

      <H2>7. 정책 변경</H2>
      <P>
        본 정책은 서비스의 발전과 법령 변화에 따라 개정될 수 있으며, 중대 변경 시 사전에
        공지합니다.
      </P>

      <H2>8. 문의</H2>
      <P>본 정책 관련 문의: {COMPANY.email}</P>
    </>
  );
}

function EnPolicy() {
  return (
    <>
      <H1>Acceptable Use Policy</H1>
      <Meta>Effective · {EFFECTIVE_DATE}</Meta>

      <P>
        This Acceptable Use Policy (&ldquo;AUP&rdquo;) governs the use of the {COMPANY.serviceName} service
        operated by {COMPANY.nameEn} (the &ldquo;Service&rdquo;). It forms part of our Terms of Service.
        Violations may result in content removal, account suspension or termination, refund denial,
        and reporting to relevant authorities, in each case without prior notice.
      </P>

      <H2>1. Permitted Use</H2>
      <UL>
        <li>Lawful UX research, market research, and academic research workflows</li>
        <li>Transcription, summarization, and analysis of interviews, documents, and data that you own or are authorized to process</li>
        <li>Organizing, visualizing, and reporting research findings</li>
      </UL>

      <H2>2. Prohibited Content</H2>
      <P>
        You may not generate, request, upload, or otherwise process the following through the Service,
        regardless of format (text, image, audio, or video):
      </P>
      <UL>
        <li><strong>NSFW, sexually explicit, or sexually suggestive content</strong></li>
        <li>Child sexual abuse material (CSAM) or sexualized depictions of minors</li>
        <li>Hate speech, discriminatory content, or harassment / threats targeting individuals or groups</li>
        <li>Content that glorifies or promotes violence, self-harm, or suicide</li>
        <li>Impersonation, deepfakes, face-swap, or voice-cloning of real people without consent</li>
        <li>Material that facilitates illegal drugs, weapons, terrorism, or other criminal activity</li>
        <li>Content infringing copyright, trademark, publicity rights, or personal data of third parties</li>
        <li>Malware, spam, phishing, fraud, or other content harmful to systems or users</li>
      </UL>

      <H2>3. No Technical Abuse</H2>
      <UL>
        <li>No circumventing security, access controls, billing, or quota limits</li>
        <li>No automated overload or interference with other users&rsquo; access</li>
        <li>No reverse engineering, source-code extraction, unauthorized API use, or account resale</li>
      </UL>

      <H2>4. Data Responsibility</H2>
      <P>
        You represent that you have all rights and consents necessary to upload any content
        (interview recordings, transcripts, documents, etc.) to the Service. Where personal data
        is involved, you are responsible for compliance with applicable laws (GDPR, PIPA, etc.).
      </P>

      <H2>5. Review of AI Outputs</H2>
      <P>
        AI-generated outputs may contain hallucinations, errors, or bias. You must verify
        accuracy before relying on outputs for decisions, public disclosure, or legal processes.
      </P>

      <H2>6. Reporting and Enforcement</H2>
      <UL>
        <li>Suspected violations may be reported to {COMPANY.email}.</li>
        <li>We may investigate and take action including warnings, content removal, temporary or
            permanent account suspension, refund denial, and reporting to authorities.</li>
        <li>Severe violations may result in immediate suspension without prior notice.</li>
      </UL>

      <H2>7. Changes to this Policy</H2>
      <P>
        We may update this Policy as the Service evolves or laws change. Material updates will
        be announced in advance.
      </P>

      <H2>8. Contact</H2>
      <P>Questions about this Policy: {COMPANY.email}</P>
    </>
  );
}
