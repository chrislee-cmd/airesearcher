import type { Panels } from './panels';

const TRANSCRIPT_BODY = (
  <div className="qcard" style={{ padding: '6px 16px' }}>
    <div className="transcript-line"><span className="t">00:00:12</span><span className="who">MOD</span><span className="body">최근 일주일 동안 새로 산 스킨케어 제품 있어요?</span></div>
    <div className="transcript-line"><span className="t">00:00:18</span><span className="who">P03</span><span className="body">앰플 하나 샀어요. 친구가 너무 좋다고 해서.</span></div>
    <div className="transcript-line"><span className="t">00:00:24</span><span className="who">MOD</span><span className="body">친구 추천이 결정에 어느 정도 영향을 주나요?</span></div>
    <div className="transcript-line"><span className="t">00:00:29</span><span className="who">P03</span><span className="body">사실 거의 다요. 광고는 잘 안 봐요. 후기도 친구가 쓴 게 아니면 잘 안 믿어요.</span></div>
    <div className="transcript-line"><span className="t">00:00:41</span><span className="who">P03</span><span className="body">저는 거울 앞에서 결정하지 않아요. 출근 전 5분, 스마트폰으로 후기 보면서 그 순간에 결정해요.</span></div>
    <div className="transcript-line"><span className="t">00:00:58</span><span className="who">MOD</span><span className="body">광고로 알게 된 제품 중에 ‘이건 진짜 사야겠다’ 싶었던 적은요?</span></div>
    <div className="transcript-line"><span className="t">00:01:04</span><span className="who">P03</span><span className="body">최근에 한 번 있었어요. 그것도 결국 친구가 ‘너 그거 봤어?’라고 물어본 거였어요.</span></div>
  </div>
);

export const panelsKo: Panels = {
  desk: {
    crumb: '/ko/desk · BEAUTY UX 2026Q2',
    title: '데스크 리서치',
    cost: '25 크레딧',
    ws: { who: 'DESK', ttl: '2025–2026 한국 스킨케어 트렌드', sub: '24 sources · 9 charts · DB-backed' },
    next: { key: 'screener', label: '심사설문 생성기로 참여 조건 설정 →' },
    tabs: [
      {
        label: '프롬프트', num: '01', body: (
          <>
            <div className="input"><span className="lbl">TOPIC</span><span className="v">2025–2026 한국 20–40대 여성 스킨케어 트렌드, 후기 의존도 중심으로 <span className="typed"></span></span></div>
            <div className="pillrow"><span className="pill amore">DB-backed job</span><span className="pill">realtime</span><span className="pill">sources: 24</span><span className="pill">ko</span></div>
            <p style={{ marginTop: '18px', fontSize: '13px', color: 'var(--mute)', lineHeight: 1.7 }}>자동 큐레이션이 시작되면 새로고침해도 잡이 살아남습니다. 평균 소요 2–4분.</p>
            <div style={{ marginTop: '18px', padding: '14px 16px', border: '1px solid var(--line)', borderRadius: '4px', background: 'var(--paper-soft)', fontSize: '12px', color: 'var(--mute)', display: 'flex', gap: '14px', alignItems: 'center' }}>
              <span className="pulse"></span><span>현재 단계: <strong style={{ color: 'var(--ink)' }}>크롤링 중 · 14/24</strong> · 약 90초 남음</span>
            </div>
          </>
        )
      },
      {
        label: '출처 24', num: '02', body: (
          <div className="desk-list">
            <div className="desk-row"><span className="ttl">‘피부 친구’ 마케팅 — 2026 Q1 리뷰 비중 분석</span><span className="src">openSurvey · 2026-03</span></div>
            <div className="desk-row"><span className="ttl">앰플 카테고리 1년 매출 +47%, 객단가 −12%</span><span className="src">euromonitor · 2026-02</span></div>
            <div className="desk-row"><span className="ttl">SNS 광고 회의감, “친구 한 명”이 광고 100건을 이긴다</span><span className="src">매일경제 · 2026-04</span></div>
            <div className="desk-row"><span className="ttl">루틴 콘텐츠 평균 시청 길이 9분 22초</span><span className="src">YouTube Trends · 2026-04</span></div>
            <div className="desk-row"><span className="ttl">한국 클린뷰티 라벨 신뢰도 — 2026 소비자 인식</span><span className="src meta-tag">consumer.kr · live</span></div>
            <div className="desk-row"><span className="ttl">20대 여성 인앱 결제 — 첫 인지 → 구매까지 평균 36시간</span><span className="src">app annie · 2026-01</span></div>
            <div className="desk-row"><span className="ttl">‘민감성 피부’ 검색량 YoY +28%</span><span className="src">naver datalab · 2026-03</span></div>
          </div>
        )
      },
      {
        label: '요약', num: '03', body: (
          <div className="report">
            <h5>핵심 발견 5가지</h5>
            <div className="toc">
              <span><em>01.</em> 결정 순간은 ‘저녁 거울’이 아닌 ‘출근 전 5분’으로 이동했다</span>
              <span><em>02.</em> ‘피부 친구’가 광고 100건을 이긴다 — 친구 추천이 광고 대비 3.7×</span>
              <span><em>03.</em> 앰플 카테고리는 매출 ↑ 객단가 ↓ — 트라이얼 사이즈 수요</span>
              <span><em>04.</em> 클린뷰티 라벨 신뢰도는 25–34세에서 가장 낮음</span>
              <span><em>05.</em> 루틴 콘텐츠 평균 시청 9분 22초 — 광고로 노출시키기에는 너무 길다</span>
            </div>
          </div>
        )
      }
    ]
  },

  screener: {
    crumb: '/ko/screener · BEAUTY UX 2026Q2',
    title: '심사설문 생성기',
    cost: '5 크레딧',
    manualAdd: true,
    ws: { who: 'SCREENER', ttl: 'Beauty UX — 참여자 심사설문 v1', sub: '5 질문 · 3 탈락 기준 · auto-gen' },
    next: { key: 'guideline', label: '가이드라인 생성기로 질문 구성 →' },
    tabs: [
      {
        label: '인풋', num: '01', body: (
          <>
            <div className="input"><span className="lbl">TOPIC</span><span className="v">한국 20–40대 여성 스킨케어 구매 결정 연구 <span className="typed"></span></span></div>
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '10px', letterSpacing: '.22em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>참여 조건</div>
              <div style={{ border: '1px solid var(--line)', borderRadius: '4px', padding: '12px 14px', fontSize: '12.5px', color: 'var(--ink2)', background: '#fff', lineHeight: 1.7 }}>
                스킨케어 제품을 월 1회 이상 구매 · 20–42세 여성 · 최근 6개월 내 새 제품 구매 경험
              </div>
            </div>
            <div className="pillrow"><span className="pill amore">탈락 기준 자동 설정</span><span className="pill">답변 분기 포함</span><span className="pill">ko</span></div>
            <button className="gen-btn" data-genkey="screener" type="button">
              <span className="spinner"></span>
              <span data-genbtn-text="screener">설문 생성하기</span>
            </button>
          </>
        )
      },
      {
        label: '설문 항목', num: '02', body: (
          <>
            <div className="pillrow" style={{ marginTop: 0 }}><span className="pill amore">5 질문 생성됨</span><span className="pill">3 탈락 조건</span></div>
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: '#fff', fontSize: '12.5px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>Q1 · 스크리너</div>
                <p style={{ color: 'var(--ink2)', lineHeight: 1.6 }}>최근 6개월 안에 스킨케어 제품(세럼·로션·선크림 포함)을 새로 구매하신 적이 있나요?</p>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '4px 10px', border: '1px solid var(--amore)', borderRadius: '4px', fontSize: '11px', color: 'var(--amore)' }}>예, 있어요 → 계속</span>
                  <span style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '11px', color: 'var(--mute)' }}>아니요 → 탈락</span>
                </div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: '#fff', fontSize: '12.5px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>Q2 · 연령 확인</div>
                <p style={{ color: 'var(--ink2)', lineHeight: 1.6 }}>현재 연령대를 알려주세요.</p>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '4px 10px', border: '1px solid var(--amore)', borderRadius: '4px', fontSize: '11px', color: 'var(--amore)' }}>20대 / 30대 / 40대 초반 → 계속</span>
                  <span style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '11px', color: 'var(--mute)' }}>그 외 → 탈락</span>
                </div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: 'var(--paper-soft)', fontSize: '12px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--mute)', fontWeight: 600, marginBottom: '4px' }}>Q3–5 · 구매 패턴 / 신뢰 채널 / 리추얼 여부</div>
                <p style={{ color: 'var(--mute)' }}>3개 항목 자동 생성됨 — 탈락 기준 없음, 세그멘테이션 전용</p>
              </div>
            </div>
          </>
        )
      }
    ]
  },

  guideline: {
    crumb: '/ko/guideline · BEAUTY UX 2026Q2',
    title: '가이드라인 생성기',
    cost: '5 크레딧',
    manualAdd: true,
    ws: { who: 'GUIDELINE', ttl: '인터뷰 가이드라인 v1', sub: '4 섹션 · 18 질문 · 45min' },
    next: { key: 'moderator', label: 'AI 모더레이터로 인터뷰 스크립트 다듬기 →' },
    tabs: [
      {
        label: '인풋', num: '01', body: (
          <>
            <div className="input"><span className="lbl">GOAL</span><span className="v">20–30대 여성의 스킨케어 구매 결정 메커니즘 파악 <span className="typed"></span></span></div>
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '10px', letterSpacing: '.22em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>핵심 가설</div>
              <div style={{ border: '1px solid var(--line)', borderRadius: '4px', padding: '12px 14px', fontSize: '12.5px', color: 'var(--ink2)', background: '#fff', lineHeight: 1.7 }}>
                친구 추천이 광고보다 구매 결정에 3배 이상 영향을 미친다
              </div>
            </div>
            <div className="pillrow"><span className="pill amore">섹션 자동 분류</span><span className="pill">45min 최적화</span><span className="pill">probe 자동 추가</span></div>
            <button className="gen-btn" data-genkey="guideline" type="button">
              <span className="spinner"></span>
              <span data-genbtn-text="guideline">가이드라인 생성하기</span>
            </button>
          </>
        )
      },
      {
        label: '가이드라인', num: '02', body: (
          <>
            <div className="pillrow" style={{ marginTop: 0 }}><span className="pill amore">4 섹션 · 18 질문</span><span className="pill">45min</span></div>
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: '#fff' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--amore)', fontWeight: 600, marginBottom: '8px' }}>SECTION 01 · 워밍업 (5min)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
                  <p style={{ color: 'var(--ink2)' }}>1. 최근에 산 스킨케어 제품 중 가장 기억에 남는 게 있다면요?</p>
                  <p style={{ color: 'var(--mute)', paddingLeft: '12px', borderLeft: '2px solid var(--amore-bg)', fontSize: '12px' }}>Probe: 어떤 계기로 알게 됐는지도 들려주세요.</p>
                </div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: '#fff' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>SECTION 02 · 결정의 순간 (15min)</div>
                <div style={{ fontSize: '12px', color: 'var(--mute)' }}>5 질문 + 6 probe 자동 생성됨</div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: 'var(--paper-soft)' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--mute)', fontWeight: 600, marginBottom: '4px' }}>SECTION 03–04 · 신뢰 채널 / 리추얼 (25min)</div>
                <div style={{ fontSize: '12px', color: 'var(--mute)' }}>11 질문 자동 생성됨</div>
              </div>
            </div>
          </>
        )
      }
    ]
  },

  moderator: {
    crumb: '/ko/moderator · BEAUTY UX',
    title: 'AI 모더레이터',
    cost: '1 크레딧',
    ws: { who: 'MODERATOR', ttl: '인터뷰 스크립트 v1', sub: '30min · 3 sections · 11 probes' },
    next: { key: 'verbatim', label: '전사록 생성기로 인터뷰 옮기기 →' },
    tabs: [
      {
        label: '가설', num: '01', body: (
          <>
            <div className="input"><span className="lbl">HYPOTHESIS</span><span className="v">20–30대는 친구 추천이 광고보다 결정에 크게 작용한다 <span className="typed"></span></span></div>
            <div className="pillrow"><span className="pill amore">probe questions</span><span className="pill">3 sections</span><span className="pill">30min</span></div>
            <p style={{ marginTop: '18px', fontSize: '13px', color: 'var(--mute)' }}>가설을 입력하면 오프닝 → 본 질문 → 심화 probe 까지 자동 구성됩니다.</p>
          </>
        )
      },
      {
        label: '스크립트', num: '02', body: (
          <>
            <div className="qcard">
              <div className="who"><span>오프닝 — 워밍업 (5min)</span><span className="tag">SCRIPT</span></div>
              <p>최근 일주일 동안 새로 산 스킨케어 제품이 있다면 어떤 거예요? 어떤 계기로 사게 됐는지부터 들려주세요.</p>
            </div>
            <div className="qcard">
              <div className="who"><span>본 질문 — 결정의 순간 (15min)</span><span className="tag">PROBE</span></div>
              <p>“친구 추천”이라고 하셨는데, 같은 친구가 추천했지만 사지 않은 제품도 있었나요? 그땐 무엇이 달랐나요?</p>
            </div>
            <div className="qcard">
              <div className="who"><span>심화 — 신뢰 vs. 광고 (10min)</span><span className="tag">PROBE</span></div>
              <p>광고로 알게 된 제품 중 “이건 진짜 사야겠다”고 느낀 적이 있다면, 그건 어떤 광고였나요?</p>
            </div>
          </>
        )
      },
      {
        label: '추가 probe', num: '03', body: (
          <ul style={{ listStyle: 'none', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12.5px' }}>친구 추천 ≠ 광고. 그 차이를 말로 표현해 본다면?</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12.5px' }}>최근 “이건 안 사야겠다”고 결정한 순간은 어떤 거였나요?</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12.5px' }}>스킨케어 결정과 화장품 결정은 어떻게 다른가요?</li>
          </ul>
        )
      }
    ]
  },

  verbatim: {
    crumb: '/ko/quotes · 2026-05-04',
    title: '전사록 생성기',
    cost: '25 크레딧',
    ws: { who: 'VERBATIM', ttl: 'P03 · interview-03.m4a', sub: '드래그 → 즉시 변환 · 7 lines' },
    next: { key: 'interview', label: '인터뷰 결과 생성기로 9개 인터뷰 매트릭스화 →' },
    tabs: [
      {
        label: '드래그하기', num: '01', body: (
          <>
            <div className="dropzone" data-vbdrop="1">
              <div className="dz-icon">↓</div>
              <div className="dz-title">음성 · 영상 파일을 끌어다 놓으세요</div>
              <div className="dz-sub">mp3 · m4a · wav · mp4 · mov · webm — 그게 전부예요</div>
              <div className="dz-row">
                <span className="pill amore">drag → 즉시 변환</span>
                <span className="pill">최대 25MB</span>
                <span className="pill">한국어 · 영어 · 30+ 언어</span>
              </div>
              <button className="btn dz-btn" data-vbdemo="1" type="button">데모로 변환해보기</button>
            </div>
            <div className="dz-status" data-vbstatus="1" hidden>
              <span className="pulse"></span>
              <span><strong data-vbfile="1">interview-03.m4a</strong> · <span data-vbpct="1">0%</span> 전사 중</span>
            </div>
          </>
        )
      },
      { label: '전사록', num: '02', body: TRANSCRIPT_BODY },
      {
        label: '다음 도구', num: '03', body: (
          <>
            <p style={{ marginTop: '8px', fontSize: '13px', color: 'var(--mute)', lineHeight: 1.7 }}>전사록은 워크스페이스에 자동 등록됩니다. 같은 산출물을 다음 도구의 입력으로 끌어다 넣으세요.</p>
            <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span className="pill amore">→ 인터뷰 결과 생성기</span>
              <span className="pill">→ Affinity Bubble</span>
              <span className="pill">→ 전체 리포트</span>
            </div>
          </>
        )
      }
    ]
  },

  interview: {
    crumb: '/ko/interviews · MAY-INSIGHTS',
    title: '인터뷰 결과 생성기',
    cost: '10 크레딧',
    ws: { who: 'INTERVIEW', ttl: '문항별 답변 매트릭스', sub: '9 transcripts · 14 questions · CSV/XLSX' },
    next: { key: 'quant', label: '정량조사 분석으로 가설 검증 →' },
    tabs: [
      {
        label: '1단계 — 변환', num: '01', body: (
          <>
            <div className="input"><span className="lbl">SOURCES</span><span className="v">9 transcripts · workspace.linked</span></div>
            <div className="pillrow"><span className="pill amore">.md 자동 변환</span><span className="pill">9/9 done</span></div>
            <ul style={{ listStyle: 'none', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}><span>P01 · interview-01.md</span><span style={{ color: 'var(--amore)', fontWeight: 600 }}>변환 완료</span></li>
              <li style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}><span>P03 · interview-03.md</span><span style={{ color: 'var(--amore)', fontWeight: 600 }}>변환 완료</span></li>
              <li style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}><span>P05 · interview-05.md</span><span style={{ color: 'var(--amore)', fontWeight: 600 }}>변환 완료</span></li>
              <li style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}><span>P07 · interview-07.md</span><span style={{ color: 'var(--amore)', fontWeight: 600 }}>변환 완료</span></li>
            </ul>
          </>
        )
      },
      {
        label: '2단계 — 매트릭스', num: '02', body: (
          <div className="matrix">
            <table>
              <thead><tr><th>참가자</th><th>결정 순간</th><th>주된 신뢰원</th><th>리추얼?</th><th>VOC 인용</th></tr></thead>
              <tbody>
                <tr><td>P01 · 27</td><td>저녁 클렌징 직후</td><td className="mark">유튜브 후기</td><td>O</td><td>“루틴이 무너지면 하루가 무너져요”</td></tr>
                <tr><td>P03 · 32</td><td>출근 전 5분</td><td className="mark">친구 추천</td><td>O</td><td>“거울 앞에서 결정 안 해요”</td></tr>
                <tr><td>P05 · 35</td><td>주말 마트 매대</td><td>매장 리뷰 카드</td><td>—</td><td>“가성비가 우선이에요”</td></tr>
                <tr><td>P07 · 29</td><td>SNS 광고 직후</td><td className="mark">친구 추천</td><td>O</td><td>“브랜드보다 피부 친구”</td></tr>
                <tr><td>P11 · 41</td><td>아침 거울 앞</td><td>브랜드 신뢰</td><td>O</td><td>“의식 같은 거예요”</td></tr>
              </tbody>
            </table>
          </div>
        )
      },
      {
        label: '내보내기', num: '03', body: (
          <>
            <div className="pillrow"><span className="pill amore">CSV · 14 rows</span><span className="pill amore">XLSX · sheet × 3</span><span className="pill">workspace.shared (org)</span></div>
            <p style={{ marginTop: '14px', fontSize: '13px', color: 'var(--mute)', lineHeight: 1.7 }}>팀의 다른 멤버는 같은 워크스페이스에서 즉시 열 수 있습니다. 권한은 organization · shared 두 단계로 관리됩니다.</p>
          </>
        )
      }
    ]
  },

  report: {
    crumb: '/ko/reports · BEAUTY UX 2026Q2',
    title: '전체 리포트 생성기',
    cost: '50 크레딧 · 가장 인기',
    ws: { who: 'REPORT', ttl: 'Beauty UX 2026 Q2', sub: 'editorial · 12 artifacts · 28 pages' },
    next: { key: 'affinity', label: 'Affinity Bubble로 발화 군집 시각화 →' },
    tabs: [
      {
        label: '구성', num: '01', body: (
          <div className="report">
            <h5>Beauty UX 2026 Q2 — Decisions, Rituals, Trust</h5>
            <div className="toc">
              <span><em>00.</em> Executive Summary</span>
              <span><em>01.</em> 결정 순간의 지형도 — 출근 전 5분</span>
              <span><em>02.</em> ‘피부 친구’ 모델 — 친구가 광고를 이긴다</span>
              <span><em>03.</em> 리추얼로서의 스킨케어</span>
              <span><em>04.</em> 정량 검증: n=312, 신뢰원 × 연령대</span>
              <span><em>05.</em> 권고안 4가지</span>
            </div>
            <div className="progress"><span></span></div>
            <div className="meta" style={{ marginTop: '10px', color: 'var(--mute)' }}>composing · 78% · 14s remaining</div>
          </div>
        )
      },
      {
        label: '연결된 산출물', num: '02', body: (
          <ul style={{ listStyle: 'none', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Desk</strong> · 2025–2026 한국 스킨케어 트렌드</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Verbatim ×9</strong> · P01 ~ P15 인터뷰 전사록</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Interview</strong> · 14문항 매트릭스</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Quant</strong> · n=312 cross-tab</li>
          </ul>
        )
      },
      {
        label: '미리보기', num: '03', body: (
          <div className="qcard">
            <div className="who"><span>01. 결정 순간의 지형도</span><span className="tag">PAGE 04</span></div>
            <p>2026년 한국 20–30대 여성 9인을 대상으로 한 인터뷰에서, 스킨케어 결정의 80%는 <strong>출근 전 5분 안에</strong> 일어난다. 거울 앞 의례가 아니라, 스마트폰 위 후기 스크롤이 결정 채널이 되었다.</p>
          </div>
        )
      }
    ]
  },

  quant: {
    crumb: '/ko/quant · SURVEY-2026Q2',
    title: '정량조사 분석',
    cost: '15 크레딧',
    ws: { who: 'QUANT', ttl: 'survey.csv · n=312', sub: '결정의 단서 × 연령대 cross-tab' },
    next: { key: 'report', label: '전체 리포트 생성기로 마무리 →' },
    tabs: [
      {
        label: 'CSV', num: '01', body: (
          <>
            <div className="input"><span className="lbl">FILE</span><span className="v">survey-2026q2.csv · 312 rows · 26 cols</span></div>
            <div className="pillrow"><span className="pill amore">client-side</span><span className="pill">no upload</span><span className="pill">interactive</span></div>
          </>
        )
      },
      {
        label: 'cross-tab', num: '02', body: (
          <div className="crosstab">
            <div className="cell"><div className="lbl">친구 추천 — 20대</div><div className="bar"><span style={{ width: '78%' }}></span></div><div className="pct">78%</div></div>
            <div className="cell"><div className="lbl">친구 추천 — 30대</div><div className="bar"><span style={{ width: '64%' }}></span></div><div className="pct">64%</div></div>
            <div className="cell"><div className="lbl">유튜브 후기 — 20대</div><div className="bar"><span style={{ width: '52%' }}></span></div><div className="pct">52%</div></div>
            <div className="cell"><div className="lbl">유튜브 후기 — 30대</div><div className="bar"><span style={{ width: '39%' }}></span></div><div className="pct">39%</div></div>
            <div className="cell"><div className="lbl">브랜드 신뢰 — 20대</div><div className="bar"><span style={{ width: '21%' }}></span></div><div className="pct">21%</div></div>
            <div className="cell"><div className="lbl">브랜드 신뢰 — 30대</div><div className="bar"><span style={{ width: '34%' }}></span></div><div className="pct">34%</div></div>
          </div>
        )
      },
      {
        label: '해석', num: '03', body: (
          <div className="qcard">
            <p>친구 추천은 모든 연령대에서 가장 강한 결정 단서이지만, 20대(78%)에서 30대(64%)보다 14p 높게 작용한다. 광고 회의감이 가장 강한 연령대도 20대.</p>
          </div>
        )
      }
    ]
  },

  affinity: {
    crumb: '/ko/affinity-bubble · BUBBLE MAP',
    title: 'Affinity Bubble',
    cost: '외부 솔루션',
    ws: { who: 'AFFINITY', ttl: '5 clusters · 312 utterances', sub: 'auto-labeled · partner offering' },
    next: { key: 'report', label: '전체 리포트로 통합 →' },
    tabs: [
      {
        label: '버블 맵', num: '01', body: (
          <div className="bubbles">
            <div className="bubble" style={{ width: '120px', height: '120px', left: '6%', top: '18%' }}>친구 추천 · 41</div>
            <div className="bubble muted" style={{ width: '88px', height: '88px', left: '30%', top: '55%', animationDelay: '.3s' }}>유튜브 후기 · 27</div>
            <div className="bubble" style={{ width: '96px', height: '96px', left: '50%', top: '14%', animationDelay: '.6s' }}>아침 리추얼 · 31</div>
            <div className="bubble muted" style={{ width: '74px', height: '74px', left: '70%', top: '48%', animationDelay: '.9s' }}>광고 회의 · 18</div>
            <div className="bubble muted" style={{ width: '60px', height: '60px', left: '84%', top: '8%', animationDelay: '1.1s' }}>매장 충동 · 12</div>
          </div>
        )
      },
      {
        label: '클러스터 라벨', num: '02', body: (
          <ul style={{ listStyle: 'none', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong style={{ color: 'var(--amore)' }}>친구 추천 (41)</strong> — “피부 친구”, “언니가 추천”, “직장 동료가 잘 쓴다고”</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>유튜브 후기 (27)</strong> — “솔직 후기”, “민낯 비교”, “2주 사용기”</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong style={{ color: 'var(--amore)' }}>아침 리추얼 (31)</strong> — “출근 전 5분”, “손이 기억하는 순서”, “안 하면 어색”</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>광고 회의 (18)</strong> — “자극적”, “과장”, “결국 친구 한 명을 못 이긴다”</li>
          </ul>
        )
      }
    ]
  }
};
