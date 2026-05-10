type KakaoMaps = {
  load: (cb: () => void) => void;
};

type KakaoWindow = Window & {
  kakao?: {
    maps: KakaoMaps;
  };
};

/** `kakao.maps.load` 콜백까지 최대 대기 (느린 네트워크·디바이스 대비) */
const MAPS_LOAD_CALLBACK_MS = 45000;
/** 외부 스크립트 로드 후 `window.kakao.maps.load` 노출까지 폴링 */
const MAPS_SCRIPT_READY_MAX_MS = 60000;
const SCRIPT_ATTACH_INTERVAL_MS = 50;
const SCRIPT_ATTACH_TRIES = Math.ceil(MAPS_SCRIPT_READY_MAX_MS / SCRIPT_ATTACH_INTERVAL_MS);

/** 준비 시간 초과·초기화 실패 시 전체 흐름 재시도 */
const LOAD_SDK_MAX_ATTEMPTS = 3;
/** 재시도 간격 기본(ms), 시도마다 배수 증가 */
const LOAD_SDK_RETRY_BASE_MS = 1000;

function getKakao(): KakaoWindow["kakao"] {
  return (window as KakaoWindow).kakao;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function invokeWhenMapsReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    const kakao = getKakao();
    if (!kakao?.maps?.load) {
      reject(new Error("카카오맵 스크립트 로드 실패(window.kakao.maps.load 없음)"));
      return;
    }
    const timeout = window.setTimeout(() => {
      reject(
        new Error(
          "카카오맵 초기화 시간 초과 — JavaScript 키 사용 여부, 카카오디벨로퍼스 [내 애플리케이션] > [플랫폼] Web 도메인(localhost:포트 포함) 등록을 확인하세요."
        )
      );
    }, MAPS_LOAD_CALLBACK_MS);
    try {
      kakao.maps.load(() => {
        window.clearTimeout(timeout);
        resolve();
      });
    } catch (e) {
      window.clearTimeout(timeout);
      reject(e instanceof Error ? e : new Error("카카오맵 초기화 실패"));
    }
  });
}

/**
 * `window.kakao.maps.load`가 생길 때까지 폴링한 뒤 `maps.load` 콜백까지 대기
 */
function waitUntilTryAttach(): Promise<void> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      if (getKakao()?.maps?.load) {
        invokeWhenMapsReady().then(resolve).catch(reject);
        return;
      }
      tries += 1;
      if (tries < SCRIPT_ATTACH_TRIES) {
        window.setTimeout(tick, SCRIPT_ATTACH_INTERVAL_MS);
        return;
      }
      reject(new Error("카카오맵 스크립트 로드 실패(window.kakao.maps 준비 시간 초과)"));
    };
    tick();
  });
}

/**
 * 카카오맵 JS SDK 준비 대기 — 스크립트는 `app/restaurants/layout.tsx`의 next/script(afterInteractive, autoload=false)로 로드한 뒤
 * 여기서 `kakao.maps.load` 콜백으로 초기화가 끝날 때까지 기다립니다.
 * 키: 카카오 [JavaScript 키] `NEXT_PUBLIC_KAKAO_MAP_KEY`.
 */
export async function loadKakaoMapsSdk(): Promise<void> {
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim() ?? "";
  if (typeof window === "undefined") {
    throw new Error("window 없음");
  }
  if (!key) {
    throw new Error("카카오 앱 키가 비어 있습니다(.env.local NEXT_PUBLIC_KAKAO_MAP_KEY)");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= LOAD_SDK_MAX_ATTEMPTS; attempt++) {
    try {
      if (getKakao()?.maps?.load) {
        await invokeWhenMapsReady();
        return;
      }
      await waitUntilTryAttach();
      return;
    } catch (e) {
      lastError = e;
      if (attempt < LOAD_SDK_MAX_ATTEMPTS) {
        await sleep(LOAD_SDK_RETRY_BASE_MS * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** services.Geocoder 가 붙을 때까지 대기 */
export function waitForKakaoGeocoder(maxMs = 45000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const services = (getKakao()?.maps as { services?: { Geocoder?: new () => unknown } } | undefined)?.services;
      if (services && typeof services.Geocoder === "function") {
        resolve(true);
        return;
      }
      if (Date.now() - start >= maxMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}
