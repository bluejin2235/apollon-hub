type KakaoMaps = {
  load: (cb: () => void) => void;
};

type KakaoWindow = Window & {
  kakao?: {
    maps: KakaoMaps;
  };
};

/** `kakao.maps.load` 콜백까지 최대 대기 */
const MAPS_LOAD_CALLBACK_MS = 30000;
/** 외부 스크립트 로드 후 `window.kakao.maps.load` 노출까지 폴링 */
const MAPS_SCRIPT_READY_MAX_MS = 30000;
const SCRIPT_ATTACH_INTERVAL_MS = 50;
const SCRIPT_ATTACH_TRIES = Math.ceil(MAPS_SCRIPT_READY_MAX_MS / SCRIPT_ATTACH_INTERVAL_MS);

function getKakao(): KakaoWindow["kakao"] {
  return (window as KakaoWindow).kakao;
}

function invokeWhenMapsReady(resolve: () => void, reject: (e: Error) => void) {
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
}

function waitUntilTryAttach(tryAttach: () => boolean, reject: (e: Error) => void): void {
  let tries = 0;
  const tick = () => {
    if (tryAttach()) {
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
}

/**
 * 카카오맵 JS SDK 준비 대기 — 스크립트는 `app/restaurants/layout.tsx`의 next/script(afterInteractive, autoload=false)로 로드한 뒤
 * 여기서 `kakao.maps.load` 콜백으로 초기화가 끝날 때까지 기다립니다.
 * 키: 카카오 [JavaScript 키] `NEXT_PUBLIC_KAKAO_MAP_KEY`.
 */
export function loadKakaoMapsSdk(): Promise<void> {
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim() ?? "";
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("window 없음"));
      return;
    }
    if (!key) {
      reject(new Error("카카오 앱 키가 비어 있습니다(.env.local NEXT_PUBLIC_KAKAO_MAP_KEY)"));
      return;
    }

    const tryAttach = () => {
      if (getKakao()?.maps?.load) {
        invokeWhenMapsReady(resolve, reject);
        return true;
      }
      return false;
    };

    if (tryAttach()) {
      return;
    }

    waitUntilTryAttach(tryAttach, reject);
  });
}

/** services.Geocoder 가 붙을 때까지 대기 */
export function waitForKakaoGeocoder(maxMs = 30000): Promise<boolean> {
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
