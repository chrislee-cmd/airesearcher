/* eslint-disable react/no-unescaped-entities -- English prose-only landing
   copy. Apostrophes and quotation marks are intentional editorial text, not
   risky JSX ambiguity. Rule stays enforced everywhere else. */
import type { Panels } from './panels';

const TRANSCRIPT_BODY = (
  <div className="qcard" style={{ padding: '6px 16px' }}>
    <div className="transcript-line"><span className="t">00:00:12</span><span className="who">MOD</span><span className="body">Did you buy any skincare products in the last week?</span></div>
    <div className="transcript-line"><span className="t">00:00:18</span><span className="who">P03</span><span className="body">Yeah, a serum. A friend swore by it.</span></div>
    <div className="transcript-line"><span className="t">00:00:24</span><span className="who">MOD</span><span className="body">How much does a friend's recommendation factor into your decision?</span></div>
    <div className="transcript-line"><span className="t">00:00:29</span><span className="who">P03</span><span className="body">Honestly, almost everything. I tune out ads. Even reviews — unless they're from a friend, I don't trust them.</span></div>
    <div className="transcript-line"><span className="t">00:00:41</span><span className="who">P03</span><span className="body">I don't decide standing in front of a mirror. It's the five minutes before work, scrolling reviews on my phone — that's when I decide.</span></div>
    <div className="transcript-line"><span className="t">00:00:58</span><span className="who">MOD</span><span className="body">Has there been a product you saw in an ad and thought "I really have to buy this"?</span></div>
    <div className="transcript-line"><span className="t">00:01:04</span><span className="who">P03</span><span className="body">Recently, once. And even then it was because a friend messaged me asking "did you see this?".</span></div>
  </div>
);

export const panelsEn: Panels = {
  desk: {
    crumb: '/en/desk · BEAUTY UX 2026Q2',
    title: 'Desk Research',
    cost: '25 credits',
    ws: { who: 'DESK', ttl: '2025–2026 Korea skincare trends', sub: '24 sources · 9 charts · DB-backed' },
    next: { key: 'screener', label: 'Set participant criteria in the Screener Builder →' },
    tabs: [
      {
        label: 'Prompt', num: '01', body: (
          <>
            <div className="input"><span className="lbl">TOPIC</span><span className="v">2025–2026 Korean women's skincare trends (20s–40s), focusing on review reliance <span className="typed"></span></span></div>
            <div className="pillrow"><span className="pill amore">DB-backed job</span><span className="pill">realtime</span><span className="pill">sources: 24</span><span className="pill">ko</span></div>
            <p style={{ marginTop: '18px', fontSize: '13px', color: 'var(--mute)', lineHeight: 1.7 }}>Once curation starts, the job survives page refreshes. Avg. 2–4 min.</p>
            <div style={{ marginTop: '18px', padding: '14px 16px', border: '1px solid var(--line)', borderRadius: '4px', background: 'var(--paper-soft)', fontSize: '12px', color: 'var(--mute)', display: 'flex', gap: '14px', alignItems: 'center' }}>
              <span className="pulse"></span><span>Current stage: <strong style={{ color: 'var(--ink)' }}>Crawling · 14/24</strong> · ~90s left</span>
            </div>
          </>
        )
      },
      {
        label: 'Sources 24', num: '02', body: (
          <div className="desk-list">
            <div className="desk-row"><span className="ttl">"Skin friends" marketing — review share analysis, 2026 Q1</span><span className="src">openSurvey · 2026-03</span></div>
            <div className="desk-row"><span className="ttl">Ampoule category: revenue +47%, avg. ticket −12% YoY</span><span className="src">euromonitor · 2026-02</span></div>
            <div className="desk-row"><span className="ttl">Ad fatigue on social: "one friend" beats 100 ads</span><span className="src">Maeil Business · 2026-04</span></div>
            <div className="desk-row"><span className="ttl">Routine content avg. watch time: 9 min 22 sec</span><span className="src">YouTube Trends · 2026-04</span></div>
            <div className="desk-row"><span className="ttl">Korean clean-beauty label trust — 2026 consumer perception</span><span className="src meta-tag">consumer.kr · live</span></div>
            <div className="desk-row"><span className="ttl">Women in their 20s: avg. 36 hrs from first awareness to in-app purchase</span><span className="src">app annie · 2026-01</span></div>
            <div className="desk-row"><span className="ttl">"Sensitive skin" search volume YoY +28%</span><span className="src">naver datalab · 2026-03</span></div>
          </div>
        )
      },
      {
        label: 'Summary', num: '03', body: (
          <div className="report">
            <h5>Five key findings</h5>
            <div className="toc">
              <span><em>01.</em> The decision moment moved from "evening mirror" to "five minutes before work"</span>
              <span><em>02.</em> "Skin friends" beat 100 ads — friend recs are 3.7× more influential</span>
              <span><em>03.</em> Ampoule category: revenue ↑, ticket ↓ — appetite for trial sizes</span>
              <span><em>04.</em> Clean-beauty label trust is lowest among 25–34</span>
              <span><em>05.</em> Routine content avg. 9:22 — too long for an ad slot</span>
            </div>
          </div>
        )
      }
    ]
  },

  screener: {
    crumb: '/en/screener · BEAUTY UX 2026Q2',
    title: 'Screener Builder',
    cost: '5 credits',
    manualAdd: true,
    ws: { who: 'SCREENER', ttl: 'Beauty UX — participant screener v1', sub: '5 questions · 3 disqualifiers · auto-gen' },
    next: { key: 'guideline', label: 'Compose questions in the Guideline Builder →' },
    tabs: [
      {
        label: 'Input', num: '01', body: (
          <>
            <div className="input"><span className="lbl">TOPIC</span><span className="v">Korean women's skincare buying decisions (20s–40s) <span className="typed"></span></span></div>
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '10px', letterSpacing: '.22em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>Participant criteria</div>
              <div style={{ border: '1px solid var(--line)', borderRadius: '4px', padding: '12px 14px', fontSize: '12.5px', color: 'var(--ink2)', background: '#fff', lineHeight: 1.7 }}>
                Buys skincare ≥ 1×/month · Women 20–42 · Purchased a new product in the last 6 months
              </div>
            </div>
            <div className="pillrow"><span className="pill amore">Auto-set disqualifiers</span><span className="pill">Branching logic</span><span className="pill">en</span></div>
            <button className="gen-btn" data-genkey="screener" type="button">
              <span className="spinner"></span>
              <span data-genbtn-text="screener">Generate screener</span>
            </button>
          </>
        )
      },
      {
        label: 'Questions', num: '02', body: (
          <>
            <div className="pillrow" style={{ marginTop: 0 }}><span className="pill amore">5 questions generated</span><span className="pill">3 disqualifiers</span></div>
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: '#fff', fontSize: '12.5px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>Q1 · Screener</div>
                <p style={{ color: 'var(--ink2)', lineHeight: 1.6 }}>Have you bought a new skincare product (serum, lotion, sunscreen) in the last 6 months?</p>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '4px 10px', border: '1px solid var(--amore)', borderRadius: '4px', fontSize: '11px', color: 'var(--amore)' }}>Yes → continue</span>
                  <span style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '11px', color: 'var(--mute)' }}>No → disqualify</span>
                </div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: '#fff', fontSize: '12.5px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>Q2 · Age</div>
                <p style={{ color: 'var(--ink2)', lineHeight: 1.6 }}>What's your age range?</p>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '4px 10px', border: '1px solid var(--amore)', borderRadius: '4px', fontSize: '11px', color: 'var(--amore)' }}>20s / 30s / early 40s → continue</span>
                  <span style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '11px', color: 'var(--mute)' }}>Other → disqualify</span>
                </div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: 'var(--paper-soft)', fontSize: '12px' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--mute)', fontWeight: 600, marginBottom: '4px' }}>Q3–5 · Purchase patterns / trust channels / ritual habits</div>
                <p style={{ color: 'var(--mute)' }}>3 items auto-generated — no disqualifier, segmentation only</p>
              </div>
            </div>
          </>
        )
      }
    ]
  },

  guideline: {
    crumb: '/en/guideline · BEAUTY UX 2026Q2',
    title: 'Guideline Builder',
    cost: '5 credits',
    manualAdd: true,
    ws: { who: 'GUIDELINE', ttl: 'Interview guideline v1', sub: '4 sections · 18 questions · 45 min' },
    next: { key: 'moderator', label: 'Polish the script in the AI Moderator →' },
    tabs: [
      {
        label: 'Input', num: '01', body: (
          <>
            <div className="input"><span className="lbl">GOAL</span><span className="v">Map skincare buying decisions for women in their 20s–30s <span className="typed"></span></span></div>
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '10px', letterSpacing: '.22em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>Core hypothesis</div>
              <div style={{ border: '1px solid var(--line)', borderRadius: '4px', padding: '12px 14px', fontSize: '12.5px', color: 'var(--ink2)', background: '#fff', lineHeight: 1.7 }}>
                Friend recommendations influence buying decisions 3× more than ads
              </div>
            </div>
            <div className="pillrow"><span className="pill amore">Auto-section</span><span className="pill">45 min optimized</span><span className="pill">Auto-probes</span></div>
            <button className="gen-btn" data-genkey="guideline" type="button">
              <span className="spinner"></span>
              <span data-genbtn-text="guideline">Generate guideline</span>
            </button>
          </>
        )
      },
      {
        label: 'Guideline', num: '02', body: (
          <>
            <div className="pillrow" style={{ marginTop: 0 }}><span className="pill amore">4 sections · 18 questions</span><span className="pill">45 min</span></div>
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: '#fff' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--amore)', fontWeight: 600, marginBottom: '8px' }}>SECTION 01 · Warm-up (5 min)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
                  <p style={{ color: 'var(--ink2)' }}>1. Of the skincare products you've bought recently, which one stands out?</p>
                  <p style={{ color: 'var(--mute)', paddingLeft: '12px', borderLeft: '2px solid var(--amore-bg)', fontSize: '12px' }}>Probe: How did you first hear about it?</p>
                </div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: '#fff' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--amore)', fontWeight: 600, marginBottom: '6px' }}>SECTION 02 · The decision moment (15 min)</div>
                <div style={{ fontSize: '12px', color: 'var(--mute)' }}>5 questions + 6 probes auto-generated</div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: '4px', background: 'var(--paper-soft)' }}>
                <div style={{ fontSize: '10px', letterSpacing: '.18em', color: 'var(--mute)', fontWeight: 600, marginBottom: '4px' }}>SECTION 03–04 · Trust channels / rituals (25 min)</div>
                <div style={{ fontSize: '12px', color: 'var(--mute)' }}>11 questions auto-generated</div>
              </div>
            </div>
          </>
        )
      }
    ]
  },

  moderator: {
    crumb: '/en/moderator · BEAUTY UX',
    title: 'AI Moderator',
    cost: '1 credit',
    ws: { who: 'MODERATOR', ttl: 'Interview script v1', sub: '30 min · 3 sections · 11 probes' },
    next: { key: 'verbatim', label: 'Move the interview into the Transcript Generator →' },
    tabs: [
      {
        label: 'Hypothesis', num: '01', body: (
          <>
            <div className="input"><span className="lbl">HYPOTHESIS</span><span className="v">For women 20–30, friend recs outweigh ads in buying decisions <span className="typed"></span></span></div>
            <div className="pillrow"><span className="pill amore">probe questions</span><span className="pill">3 sections</span><span className="pill">30 min</span></div>
            <p style={{ marginTop: '18px', fontSize: '13px', color: 'var(--mute)' }}>Drop in a hypothesis and we'll structure opening, core questions, and follow-up probes for you.</p>
          </>
        )
      },
      {
        label: 'Script', num: '02', body: (
          <>
            <div className="qcard">
              <div className="who"><span>Opening — Warm-up (5 min)</span><span className="tag">SCRIPT</span></div>
              <p>Tell me about a skincare product you've bought in the last week — and how you first came across it.</p>
            </div>
            <div className="qcard">
              <div className="who"><span>Core — The decision moment (15 min)</span><span className="tag">PROBE</span></div>
              <p>You mentioned "friend recommendation". Has there ever been a product that same friend recommended that you didn't buy? What was different that time?</p>
            </div>
            <div className="qcard">
              <div className="who"><span>Deep dive — Trust vs. ads (10 min)</span><span className="tag">PROBE</span></div>
              <p>If there's been a product you saw in an ad and felt "I really need to buy this", what kind of ad was it?</p>
            </div>
          </>
        )
      },
      {
        label: 'Extra probes', num: '03', body: (
          <ul style={{ listStyle: 'none', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12.5px' }}>Friend rec ≠ ad. How would you put the difference into words?</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12.5px' }}>What was the last moment you decided "I'm not going to buy this"?</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12.5px' }}>How are skincare decisions different from makeup decisions?</li>
          </ul>
        )
      }
    ]
  },

  verbatim: {
    crumb: '/en/quotes · 2026-05-04',
    title: 'Transcript Generator',
    cost: '25 credits',
    ws: { who: 'VERBATIM', ttl: 'P03 · interview-03.m4a', sub: 'Drag → instant transcription · 7 lines' },
    next: { key: 'interview', label: 'Turn 9 interviews into a matrix in the Interview Analyzer →' },
    tabs: [
      {
        label: 'Drop a file', num: '01', body: (
          <>
            <div className="dropzone" data-vbdrop="1">
              <div className="dz-icon">↓</div>
              <div className="dz-title">Drag an audio or video file here</div>
              <div className="dz-sub">mp3 · m4a · wav · mp4 · mov · webm — that's all you need</div>
              <div className="dz-row">
                <span className="pill amore">drag → instant transcription</span>
                <span className="pill">up to 25MB</span>
                <span className="pill">Korean / English auto-detect</span>
              </div>
              <button className="btn dz-btn" data-vbdemo="1" type="button">Try with a demo file</button>
            </div>
            <div className="dz-status" data-vbstatus="1" hidden>
              <span className="pulse"></span>
              <span><strong data-vbfile="1">interview-03.m4a</strong> · <span data-vbpct="1">0%</span> transcribing</span>
            </div>
          </>
        )
      },
      { label: 'Transcript', num: '02', body: TRANSCRIPT_BODY },
      {
        label: 'Next tool', num: '03', body: (
          <>
            <p style={{ marginTop: '8px', fontSize: '13px', color: 'var(--mute)', lineHeight: 1.7 }}>The transcript lands in your workspace automatically. Drag the same artifact into the next tool.</p>
            <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span className="pill amore">→ Interview Analyzer</span>
              <span className="pill">→ Affinity Bubble</span>
              <span className="pill">→ Full Report</span>
            </div>
          </>
        )
      }
    ]
  },

  interview: {
    crumb: '/en/interviews · MAY-INSIGHTS',
    title: 'Interview Analyzer',
    cost: '10 credits',
    ws: { who: 'INTERVIEW', ttl: 'Answers-by-question matrix', sub: '9 transcripts · 14 questions · CSV/XLSX' },
    next: { key: 'quant', label: 'Validate hypotheses in the Quant Analyzer →' },
    tabs: [
      {
        label: 'Step 1 — Convert', num: '01', body: (
          <>
            <div className="input"><span className="lbl">SOURCES</span><span className="v">9 transcripts · workspace.linked</span></div>
            <div className="pillrow"><span className="pill amore">.md auto-conversion</span><span className="pill">9/9 done</span></div>
            <ul style={{ listStyle: 'none', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}><span>P01 · interview-01.md</span><span style={{ color: 'var(--amore)', fontWeight: 600 }}>converted</span></li>
              <li style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}><span>P03 · interview-03.md</span><span style={{ color: 'var(--amore)', fontWeight: 600 }}>converted</span></li>
              <li style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}><span>P05 · interview-05.md</span><span style={{ color: 'var(--amore)', fontWeight: 600 }}>converted</span></li>
              <li style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}><span>P07 · interview-07.md</span><span style={{ color: 'var(--amore)', fontWeight: 600 }}>converted</span></li>
            </ul>
          </>
        )
      },
      {
        label: 'Step 2 — Matrix', num: '02', body: (
          <div className="matrix">
            <table>
              <thead><tr><th>Participant</th><th>Decision moment</th><th>Main trust source</th><th>Ritual?</th><th>VOC quote</th></tr></thead>
              <tbody>
                <tr><td>P01 · 27</td><td>After evening cleanse</td><td className="mark">YouTube reviews</td><td>Y</td><td>"If my routine breaks, my day breaks"</td></tr>
                <tr><td>P03 · 32</td><td>5 min before work</td><td className="mark">Friend rec</td><td>Y</td><td>"I don't decide in front of a mirror"</td></tr>
                <tr><td>P05 · 35</td><td>Weekend store aisle</td><td>In-store review cards</td><td>—</td><td>"Value for money first"</td></tr>
                <tr><td>P07 · 29</td><td>Right after a social ad</td><td className="mark">Friend rec</td><td>Y</td><td>"Skin-friend over brand"</td></tr>
                <tr><td>P11 · 41</td><td>Morning, at the mirror</td><td>Brand trust</td><td>Y</td><td>"It's a kind of ritual"</td></tr>
              </tbody>
            </table>
          </div>
        )
      },
      {
        label: 'Export', num: '03', body: (
          <>
            <div className="pillrow"><span className="pill amore">CSV · 14 rows</span><span className="pill amore">XLSX · 3 sheets</span><span className="pill">workspace.shared (org)</span></div>
            <p style={{ marginTop: '14px', fontSize: '13px', color: 'var(--mute)', lineHeight: 1.7 }}>Anyone on your team can open this from the same workspace instantly. Permissions live at two levels: organization and shared.</p>
          </>
        )
      }
    ]
  },

  report: {
    crumb: '/en/reports · BEAUTY UX 2026Q2',
    title: 'Full Report Generator',
    cost: '50 credits · most popular',
    ws: { who: 'REPORT', ttl: 'Beauty UX 2026 Q2', sub: 'editorial · 12 artifacts · 28 pages' },
    next: { key: 'affinity', label: 'Visualize utterance clusters with Affinity Bubble →' },
    tabs: [
      {
        label: 'Structure', num: '01', body: (
          <div className="report">
            <h5>Beauty UX 2026 Q2 — Decisions, Rituals, Trust</h5>
            <div className="toc">
              <span><em>00.</em> Executive Summary</span>
              <span><em>01.</em> Topography of the decision moment — five minutes before work</span>
              <span><em>02.</em> The "skin-friend" model — friends beat ads</span>
              <span><em>03.</em> Skincare as ritual</span>
              <span><em>04.</em> Quant validation: n=312, trust source × age</span>
              <span><em>05.</em> Four recommendations</span>
            </div>
            <div className="progress"><span></span></div>
            <div className="meta" style={{ marginTop: '10px', color: 'var(--mute)' }}>composing · 78% · 14s remaining</div>
          </div>
        )
      },
      {
        label: 'Linked artifacts', num: '02', body: (
          <ul style={{ listStyle: 'none', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Desk</strong> · 2025–2026 Korea skincare trends</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Verbatim ×9</strong> · P01–P15 interview transcripts</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Interview</strong> · 14-question matrix</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Quant</strong> · n=312 cross-tab</li>
          </ul>
        )
      },
      {
        label: 'Preview', num: '03', body: (
          <div className="qcard">
            <div className="who"><span>01. Topography of the decision moment</span><span className="tag">PAGE 04</span></div>
            <p>Across 9 interviews with Korean women in their 20s–30s in 2026, 80% of skincare decisions happen <strong>in the five minutes before leaving for work</strong>. The decision channel isn't a mirror ritual — it's scrolling reviews on a phone.</p>
          </div>
        )
      }
    ]
  },

  quant: {
    crumb: '/en/quant · SURVEY-2026Q2',
    title: 'Quant Analyzer',
    cost: '15 credits',
    ws: { who: 'QUANT', ttl: 'survey.csv · n=312', sub: 'Decision cue × age cross-tab' },
    next: { key: 'report', label: 'Wrap up in the Full Report Generator →' },
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
            <div className="cell"><div className="lbl">Friend rec — 20s</div><div className="bar"><span style={{ width: '78%' }}></span></div><div className="pct">78%</div></div>
            <div className="cell"><div className="lbl">Friend rec — 30s</div><div className="bar"><span style={{ width: '64%' }}></span></div><div className="pct">64%</div></div>
            <div className="cell"><div className="lbl">YouTube reviews — 20s</div><div className="bar"><span style={{ width: '52%' }}></span></div><div className="pct">52%</div></div>
            <div className="cell"><div className="lbl">YouTube reviews — 30s</div><div className="bar"><span style={{ width: '39%' }}></span></div><div className="pct">39%</div></div>
            <div className="cell"><div className="lbl">Brand trust — 20s</div><div className="bar"><span style={{ width: '21%' }}></span></div><div className="pct">21%</div></div>
            <div className="cell"><div className="lbl">Brand trust — 30s</div><div className="bar"><span style={{ width: '34%' }}></span></div><div className="pct">34%</div></div>
          </div>
        )
      },
      {
        label: 'Reading', num: '03', body: (
          <div className="qcard">
            <p>Friend recommendation is the strongest decision cue across every age group, and it lands 14pp higher among 20s (78%) than 30s (64%). Ad skepticism is also highest among 20s.</p>
          </div>
        )
      }
    ]
  },

  affinity: {
    crumb: '/en/affinity-bubble · BUBBLE MAP',
    title: 'Affinity Bubble',
    cost: 'partner tool',
    ws: { who: 'AFFINITY', ttl: '5 clusters · 312 utterances', sub: 'auto-labeled · partner offering' },
    next: { key: 'report', label: 'Merge into the Full Report →' },
    tabs: [
      {
        label: 'Bubble map', num: '01', body: (
          <div className="bubbles">
            <div className="bubble" style={{ width: '120px', height: '120px', left: '6%', top: '18%' }}>Friend rec · 41</div>
            <div className="bubble muted" style={{ width: '88px', height: '88px', left: '30%', top: '55%', animationDelay: '.3s' }}>YouTube reviews · 27</div>
            <div className="bubble" style={{ width: '96px', height: '96px', left: '50%', top: '14%', animationDelay: '.6s' }}>Morning ritual · 31</div>
            <div className="bubble muted" style={{ width: '74px', height: '74px', left: '70%', top: '48%', animationDelay: '.9s' }}>Ad fatigue · 18</div>
            <div className="bubble muted" style={{ width: '60px', height: '60px', left: '84%', top: '8%', animationDelay: '1.1s' }}>Store impulse · 12</div>
          </div>
        )
      },
      {
        label: 'Cluster labels', num: '02', body: (
          <ul style={{ listStyle: 'none', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong style={{ color: 'var(--amore)' }}>Friend rec (41)</strong> — "skin friend", "my sister told me", "my coworker swears by it"</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>YouTube reviews (27)</strong> — "honest review", "bare-face comparison", "2-week trial"</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong style={{ color: 'var(--amore)' }}>Morning ritual (31)</strong> — "five minutes before work", "the order my hands know", "feels off without it"</li>
            <li style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '4px', fontSize: '12px' }}><strong>Ad fatigue (18)</strong> — "intrusive", "over-promised", "one friend still beats it"</li>
          </ul>
        )
      }
    ]
  }
};
