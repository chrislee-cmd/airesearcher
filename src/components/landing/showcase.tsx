'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PANEL_ORDER, SIDEBAR_GROUPS, TOOL_COST_DOTS, type PanelKey, type Panels } from './panels';

type ShowcaseLabels = {
  meta: string;
  title: ReactNode;
  subtitle: string;
  freeTrial: string;
  freeTrialTime: string;
  groups: { design: string; conduct: string; analysis: string };
  tools: Record<PanelKey, string>;
  sideFoot: string;
  wsMeta: string;
  wsEmpty: string;
  wsReset: string;
  wsToReport: string;
  footMeta: string;
  tip: string;
  tipMeta: string;
  fallbackNext: string;
};

type WsItem = { key: PanelKey; isNew: boolean };

type GenState = Record<string, boolean>;

type VerbatimStatus = {
  visible: boolean;
  file: string;
  pct: number;
};

const noop = () => {};

export function Showcase({ panels, labels, generatingText }: { panels: Panels; labels: ShowcaseLabels; generatingText: string }) {
  const [active, setActive] = useState<PanelKey>('desk');
  const [visited, setVisited] = useState<PanelKey[]>(['desk']);
  const [activeTab, setActiveTab] = useState<Record<PanelKey, number>>(() =>
    PANEL_ORDER.reduce((acc, k) => ({ ...acc, [k]: 0 }), {} as Record<PanelKey, number>)
  );
  const [wsFlash, setWsFlash] = useState(false);
  const [wsPop, setWsPop] = useState(false);
  const [newKey, setNewKey] = useState<PanelKey | null>(null);
  const [genLoading, setGenLoading] = useState<GenState>({});
  const [verbatim, setVerbatim] = useState<VerbatimStatus>({ visible: false, file: 'interview-03.m4a', pct: 0 });
  const [dropOver, setDropOver] = useState(false);

  const wbRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  const addToWorkspace = useCallback((key: PanelKey, animate = false) => {
    setVisited((prev) => {
      if (prev.includes(key)) return prev;
      if (animate) {
        setWsFlash(true);
        setWsPop(true);
        setNewKey(key);
        setTimeout(() => setWsFlash(false), 800);
        setTimeout(() => setWsPop(false), 500);
        setTimeout(() => setNewKey(null), 900);
      }
      return [...prev, key];
    });
  }, []);

  const show = useCallback((key: PanelKey) => {
    setActive(key);
    if (!panels[key]?.manualAdd) addToWorkspace(key);
    if (stageRef.current) stageRef.current.scrollTop = 0;
  }, [panels, addToWorkspace]);

  const onReset = () => {
    setVisited([]);
    setActiveTab(PANEL_ORDER.reduce((acc, k) => ({ ...acc, [k]: 0 }), {} as Record<PanelKey, number>));
    show('desk');
  };

  // Keyboard navigation (← / →) when section is in viewport
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const node = wbRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const cur = PANEL_ORDER.indexOf(active);
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        show(PANEL_ORDER[(cur + 1) % PANEL_ORDER.length]);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        show(PANEL_ORDER[(cur - 1 + PANEL_ORDER.length) % PANEL_ORDER.length]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, show]);

  // Click handlers wired up via event delegation for buttons inside panel JSX
  // (gen-btn and verbatim dropzone)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const runVerbatim = (filename?: string) => {
      setVerbatim({ visible: true, file: filename ?? 'interview-03.m4a', pct: 0 });
      let p = 0;
      const id = setInterval(() => {
        p += 12 + Math.random() * 8;
        if (p >= 100) {
          p = 100;
          clearInterval(id);
          setActiveTab((prev) => ({ ...prev, verbatim: 1 }));
        }
        setVerbatim((prev) => ({ ...prev, pct: Math.round(p) }));
      }, 220);
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const gen = target.closest<HTMLButtonElement>('[data-genkey]');
      if (gen) {
        const key = gen.dataset.genkey as PanelKey | undefined;
        if (!key) return;
        setGenLoading((prev) => ({ ...prev, [key]: true }));
        setTimeout(() => {
          setActiveTab((prev) => ({ ...prev, [key]: 1 }));
          setGenLoading((prev) => ({ ...prev, [key]: false }));
          addToWorkspace(key, true);
        }, 1600);
        return;
      }
      const demo = target.closest<HTMLButtonElement>('[data-vbdemo]');
      if (demo) {
        runVerbatim();
      }
    };

    const onDrop = (e: DragEvent) => {
      const dz = (e.target as HTMLElement).closest('[data-vbdrop]');
      if (!dz) return;
      e.preventDefault();
      setDropOver(false);
      const file = e.dataTransfer?.files?.[0];
      runVerbatim(file?.name);
    };
    const onDragOver = (e: DragEvent) => {
      const dz = (e.target as HTMLElement).closest('[data-vbdrop]');
      if (!dz) return;
      e.preventDefault();
      setDropOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      const dz = (e.target as HTMLElement).closest('[data-vbdrop]');
      if (!dz) return;
      e.preventDefault();
      setDropOver(false);
    };

    stage.addEventListener('click', onClick);
    stage.addEventListener('drop', onDrop);
    stage.addEventListener('dragover', onDragOver);
    stage.addEventListener('dragleave', onDragLeave);
    stage.addEventListener('dragenter', onDragOver);
    return () => {
      stage.removeEventListener('click', onClick);
      stage.removeEventListener('drop', onDrop);
      stage.removeEventListener('dragover', onDragOver);
      stage.removeEventListener('dragleave', onDragLeave);
      stage.removeEventListener('dragenter', onDragOver);
    };
  }, [addToWorkspace]);

  // Sync loading class + spinner + button text onto the rendered gen-btn nodes,
  // and sync the verbatim status/percent + dropzone .over state. These nodes live
  // inside the pre-built panel JSX (server-rendered), so we mutate them imperatively.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.querySelectorAll<HTMLButtonElement>('[data-genkey]').forEach((btn) => {
      const k = btn.dataset.genkey;
      if (!k) return;
      const loading = !!genLoading[k];
      btn.classList.toggle('loading', loading);
      btn.disabled = loading;
      const spinner = btn.querySelector<HTMLSpanElement>('.spinner');
      if (spinner) spinner.style.display = loading ? 'block' : 'none';
      const txt = btn.querySelector<HTMLSpanElement>('[data-genbtn-text]');
      if (txt && loading) txt.textContent = generatingText;
    });
  }, [genLoading, generatingText]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const status = stage.querySelector<HTMLElement>('[data-vbstatus]');
    if (status) {
      if (verbatim.visible) status.removeAttribute('hidden');
      else status.setAttribute('hidden', '');
    }
    const file = stage.querySelector<HTMLElement>('[data-vbfile]');
    if (file) file.textContent = verbatim.file;
    const pct = stage.querySelector<HTMLElement>('[data-vbpct]');
    if (pct) pct.textContent = `${verbatim.pct}%`;
    const dz = stage.querySelector<HTMLElement>('[data-vbdrop]');
    if (dz) dz.classList.toggle('over', dropOver);
  }, [verbatim, dropOver]);

  const currentPanel = panels[active];
  const nextLabel = currentPanel?.next?.label ?? labels.fallbackNext;
  const progressDots = useMemo(() => {
    const total = 4;
    const n = Math.min(visited.length, total);
    return Array.from({ length: total }, (_, i) => {
      if (i < n - 1) return 'done';
      if (i === n - 1) return 'now';
      return '';
    });
  }, [visited]);

  return (
    <section id="showcase">
      <div className="container">
        <div className="sec-head reveal in">
          <span className="meta">{labels.meta}</span>
          <h2>{labels.title}</h2>
          <p>{labels.subtitle}</p>
        </div>

        <div className="wb3 reveal in" ref={wbRef}>
          <header className="wb-top">
            <div className="wb-brand"><span className="dot"></span> research-mochi.app</div>
            <div className="wb-bread">{currentPanel.crumb}</div>
            <div className="wb-credits"><span className="meta">{labels.freeTrial}</span> <strong>{labels.freeTrialTime}</strong></div>
          </header>

          <aside className="wb-side">
            {SIDEBAR_GROUPS.map((g) => (
              <div key={g.group}>
                <div className="group">{labels.groups[g.group]}</div>
                {g.keys.map((k) => {
                  const cls = ['item'];
                  if (active === k) cls.push('active');
                  if (visited.includes(k)) cls.push('visited');
                  return (
                    <button
                      key={k}
                      type="button"
                      className={cls.join(' ')}
                      onClick={() => show(k)}
                    >
                      <span className="pip"></span> {labels.tools[k]} <span className="cr">{TOOL_COST_DOTS[k]}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="wb-side-foot">
              <span className="pulse"></span> {labels.sideFoot}
            </div>
          </aside>

          <main className="wb-stage" ref={stageRef}>
            {PANEL_ORDER.map((k) => {
              const p = panels[k];
              const tabIdx = activeTab[k] ?? 0;
              return (
                <div key={k} className={`stage-panel${active === k ? ' show' : ''}`}>
                  <div className="panel-head">
                    <div>
                      <div className="crumb">{p.crumb}</div>
                      <h3>{p.title}</h3>
                    </div>
                    <span className="cost-badge">● {p.cost}</span>
                  </div>
                  <div className="tabs">
                    {p.tabs.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`tab${i === tabIdx ? ' on' : ''}`}
                        onClick={() => setActiveTab((prev) => ({ ...prev, [k]: i }))}
                      >
                        <span className="num">{t.num}</span> {t.label}
                      </button>
                    ))}
                  </div>
                  {p.tabs.map((t, i) => (
                    <div key={i} className={`tab-pane${i === tabIdx ? ' on' : ''}`}>{t.body}</div>
                  ))}
                </div>
              );
            })}
          </main>

          <aside className={`wb-ws${wsFlash ? ' flash' : ''}`}>
            <div className="ws-head">
              <span className="meta">{labels.wsMeta}</span>
              <span className={`ws-count${wsPop ? ' pop' : ''}`}>{visited.length}</span>
            </div>
            {visited.length === 0 ? (
              <div className="ws-empty">{labels.wsEmpty}</div>
            ) : null}
            <ul className="ws-list">
              {visited.map((k) => {
                const ws = panels[k]?.ws;
                if (!ws) return null;
                return (
                  <li key={k} className={newKey === k ? 'ws-new' : ''}>
                    <span className="who">{ws.who}</span>
                    <span className="ttl">{ws.ttl}</span>
                    <span className="sub">{ws.sub}</span>
                  </li>
                );
              })}
            </ul>
            <div className="ws-foot">
              <button type="button" className="btn-ws" onClick={onReset}>{labels.wsReset}</button>
              <button type="button" className="btn-ws primary" onClick={() => show('report')}>{labels.wsToReport}</button>
            </div>
          </aside>

          <footer className="wb-foot">
            <div className="wb-prog">
              <span className={`dot${progressDots[0] ? ' ' + progressDots[0] : ''}`}></span>
              <span className={`line${visited.length > 1 ? ' done' : ''}`}></span>
              <span className={`dot${progressDots[1] ? ' ' + progressDots[1] : ''}`}></span>
              <span className={`line${visited.length > 2 ? ' done' : ''}`}></span>
              <span className={`dot${progressDots[2] ? ' ' + progressDots[2] : ''}`}></span>
              <span className={`line${visited.length > 3 ? ' done' : ''}`}></span>
              <span className={`dot${progressDots[3] ? ' ' + progressDots[3] : ''}`}></span>
            </div>
            <div className="wb-next">
              <span className="meta">{labels.footMeta}</span>
              <span>{nextLabel}</span>
            </div>
          </footer>
        </div>

        <div className="wb-hint reveal in">
          <span className="meta">{labels.tipMeta}</span>
          <span>{labels.tip}</span>
        </div>
      </div>
    </section>
  );
}

// silence the unused import warning if tree-shaken
void noop;
