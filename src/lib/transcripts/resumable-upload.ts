import * as tus from 'tus-js-client';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/client';

// ─── Supabase resumable(TUS) 업로드 ─────────────────────────────────────────
// 대용량 영상 업로드가 단일 PUT 로는 전송 도중 끊기면(ERR_CONNECTION_RESET /
// ERR_HTTP2_PING_FAILED) 전체가 리셋됐다. resumable 업로드는 파일을 6MB 청크로
// 쪼개 올리고, 네트워크 끊김 시 자동 재시도 + 마지막 완료 청크부터 이어받기를
// 해 대용량 파일도 견딘다(Supabase 권장 방식).
//
// 서명 URL(createSignedUploadUrl) 대신 사용자 세션 토큰(Authorization: Bearer)
// 으로 올린다. objectKey 가 `<userId>/<ts>-<file>` 라 storage.objects 의
// RLS(audio_user_insert: foldername[1] = auth.uid()) 를 통과한다 — 별도 마이그
// 불필요.

const BUCKET = 'audio-uploads';
// Supabase resumable 업로드는 청크 크기가 정확히 6MB 여야 한다(마지막 청크 제외).
const CHUNK_SIZE = 6 * 1024 * 1024;

export async function uploadResumable({
  file,
  objectKey,
  contentType,
  onProgress,
}: {
  file: File;
  objectKey: string;
  contentType?: string;
  onProgress?: (pct: number) => void;
}): Promise<void> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error('no_session');

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      // 끊김에 견디도록 지수 백오프 재시도. 각 청크는 마지막 성공 지점부터 재개.
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK_SIZE,
      metadata: {
        bucketName: BUCKET,
        objectName: objectKey,
        contentType: contentType || 'application/octet-stream',
        cacheControl: '3600',
      },
      onError: (err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      onProgress: (bytesUploaded, bytesTotal) => {
        if (bytesTotal > 0) {
          onProgress?.(Math.round((bytesUploaded / bytesTotal) * 100));
        }
      },
      onSuccess: () => resolve(),
    });

    // 같은 파일의 중단된 이전 업로드가 있으면 이어받기, 없으면 새로 시작.
    upload
      .findPreviousUploads()
      .then((prev) => {
        if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}
