import { Skeleton } from '@/components/ui/skeleton';

// 리크루팅 응답 spreadsheet 의 "빈 상태" 골격 — 아직 응답이 0건일 때
// 실제로 그려질 표의 shape(헤더 row + 응답 row 격자)을 흐릿하게 미리
// 보여줘 "여기에 곧 응답 표가 그려진다"는 시각적 힌트를 준다. 순수
// 표현용(비상호작용)이라 opacity-40 + pointer-events-none 로 둔다.
export function RecruitingEmptySkeleton() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none w-full select-none p-4 opacity-40"
    >
      <table className="w-full border-collapse text-xs-soft">
        <thead>
          <tr>
            {Array.from({ length: 5 }).map((_, i) => (
              <th key={i} className="border border-line-soft p-2">
                <Skeleton variant="text" className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: 5 }).map((_, c) => (
                <td key={c} className="border border-line-soft p-2">
                  <Skeleton variant="text" className="h-3 w-full" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
