// Export 렌더러 등록 배럴 — 이 모듈을 import 하면 4기능 렌더러가 레지스트리에
// 부수효과로 등록된다. 단일 진입점 라우트가 이 배럴을 한 번 import 한다.
//
// 새 기능/포맷 렌더러 추가 = 여기 import 한 줄 + 렌더러 파일. 라우트는 무변경
// (registry.getRenderer 위임).

import './transcript';
import './desk';
import './recruiting';
import './ut';
