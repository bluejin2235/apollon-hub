// components/luna/LunaSettingsHome.tsx
'use client';

import React from 'react';

type MenuSlug = 'brain' | 'memory' | 'talk' | 'study' | 'teach';

interface LunaSettingsHomeProps {
  onSelect: (slug: MenuSlug) => void;
  stats?: {
    promptCount?: number;
    memoryCount?: number;
    connectorConnected?: number;
    connectorTotal?: number;
    nextStudyAt?: string;
    teachPending?: number;
  };
}

const PURPLE = '#534AB7';

export default function LunaSettingsHome({ onSelect, stats = {} }: LunaSettingsHomeProps) {
  const {
    promptCount = 0,
    memoryCount = 0,
    connectorConnected = 0,
    connectorTotal = 4,
    nextStudyAt = '매일 03:00',
    teachPending = 0,
  } = stats;

  const menus: {
    slug: MenuSlug;
    name: string;
    desc: string;
    badge: string;
    badgeAccent?: boolean;
  }[] = [
    { slug: 'brain', name: '두뇌', desc: '판단력 — 프롬프트, 관점, 버전', badge: `프롬프트 ${promptCount}개` },
    { slug: 'memory', name: '기억', desc: '아는 것 — 조직·개인·Work서버', badge: `${memoryCount.toLocaleString()}건 연결` },
    { slug: 'talk', name: '대화', desc: '말하기 — 말투, 커넥터', badge: `커넥터 ${connectorConnected}/${connectorTotal} 연결` },
    { slug: 'study', name: '학습', desc: '배우기 — 예습·복습·정리', badge: nextStudyAt },
    { slug: 'teach', name: '교정', desc: '가르치기 — 팀 피드백, 승인', badge: teachPending > 0 ? `대기 ${teachPending}건` : '준비 중', badgeAccent: teachPending > 0 },
  ];

  const icon = (slug: MenuSlug) => {
    const cls = 'w-5 h-5';
    switch (slug) {
      case 'brain': return <svg className={cls} fill="none" stroke="#854F0B" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.674M12 3a6 6 0 016 6c0 2.22-1.21 4.16-3 5.2V17a1 1 0 01-1 1h-4a1 1 0 01-1-1v-2.8c-1.79-1.04-3-2.98-3-5.2a6 6 0 016-6z"/></svg>;
      case 'memory': return <svg className={cls} fill="none" stroke={PURPLE} strokeWidth="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/></svg>;
      case 'talk': return <svg className={cls} fill="none" stroke="#0F6E56" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8m-8 4h5m6.5-4a8.5 8.5 0 11-17 0 8.5 8.5 0 0117 0zM12 21l-2-2"/></svg>;
      case 'study': return <svg className={cls} fill="none" stroke={PURPLE} strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>;
      case 'teach': return <svg className={cls} fill="none" stroke="#993C1D" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"/></svg>;
    }
  };

  const Card = ({ m, className = '' }: { m: (typeof menus)[number]; className?: string }) => {
    const isBrain = m.slug === 'brain';
    const isTeach = m.slug === 'teach';
    return (
      <button
        onClick={() => onSelect(m.slug)}
        className={`text-left rounded-xl p-3 transition hover:shadow-md ${
          isBrain
            ? 'bg-amber-50 border border-amber-600'
            : isTeach
            ? 'bg-white border-2 border-indigo-400'
            : 'bg-white border border-gray-200'
        } ${className}`}
      >
        <div className="flex items-center gap-1.5">
          {icon(m.slug)}
          <span className={`text-sm font-medium ${isBrain ? 'text-amber-900' : 'text-gray-900'}`}>{m.name}</span>
          {m.badgeAccent && (
            <span className="ml-auto text-[11px] bg-orange-50 text-orange-800 px-2 py-px rounded-lg">
              {m.badge}
            </span>
          )}
        </div>
        <p className={`mt-1 text-xs ${isBrain ? 'text-amber-800' : 'text-gray-500'}`}>{m.desc}</p>
        {!m.badgeAccent && (
          <span className="inline-block mt-2 text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg">{m.badge}</span>
        )}
      </button>
    );
  };

  const byId = Object.fromEntries(menus.map((m) => [m.slug, m])) as Record<MenuSlug, (typeof menus)[number]>;

  return (
    <div className="bg-gray-50 rounded-xl p-4 md:p-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-indigo-50" style={{ backgroundColor: PURPLE }}>
          L
        </div>
        <div>
          <p className="text-base font-medium text-gray-900">LUNA 설정</p>
          <p className="text-[13px] text-gray-500">아폴론 AI 동료의 성장을 관리합니다</p>
        </div>
      </div>

      <div className="md:hidden mt-4 flex flex-col gap-3">
        {menus.map((m) => (
          <Card key={m.slug} m={m} />
        ))}
      </div>

      <div className="hidden md:block relative mx-auto mt-2" style={{ width: 648, height: 600 }}>
        <svg width="648" height="600" viewBox="0 0 648 600" className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <defs>
            <marker id="luna-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          <path d="M130 250 Q150 160 235 105" fill="none" stroke="#7F77DD" strokeWidth="1.5" markerEnd="url(#luna-arrow)" />
          <path d="M500 360 Q324 430 148 362" fill="none" stroke="#1D9E75" strokeWidth="1.5" markerEnd="url(#luna-arrow)" />
          <path d="M545 365 Q490 450 420 490" fill="none" stroke="#D85A30" strokeWidth="1.5" markerEnd="url(#luna-arrow)" />
          <path d="M228 490 Q150 450 115 368" fill="none" stroke="#D85A30" strokeWidth="1.5" markerEnd="url(#luna-arrow)" />
          <line x1="324" y1="240" x2="324" y2="128" stroke="#BA7517" strokeWidth="2" markerStart="url(#luna-arrow)" markerEnd="url(#luna-arrow)" />
          <line x1="410" y1="300" x2="472" y2="300" stroke="#BA7517" strokeWidth="2" markerStart="url(#luna-arrow)" markerEnd="url(#luna-arrow)" />
          <line x1="238" y1="300" x2="176" y2="300" stroke="#BA7517" strokeWidth="2" markerStart="url(#luna-arrow)" markerEnd="url(#luna-arrow)" />
          <text x="150" y="165" fontSize="12" fill="#9CA3AF">정제 저장</text>
          <text x="480" y="165" fontSize="12" fill="#9CA3AF">기억 참조</text>
          <text x="288" y="435" fontSize="12" fill="#9CA3AF">관측(성공+실패)</text>
          <text x="510" y="445" fontSize="12" fill="#9CA3AF">팀 평가</text>
          <text x="88" y="445" fontSize="12" fill="#9CA3AF">교정 반영</text>
        </svg>

        <div className="absolute" style={{ left: 239, top: 20, width: 170 }}><Card m={byId.memory} className="w-full" /></div>
        <div className="absolute" style={{ left: 243, top: 245, width: 162 }}><Card m={byId.brain} className="w-full" /></div>
        <div className="absolute" style={{ left: 478, top: 250, width: 160 }}><Card m={byId.talk} className="w-full" /></div>
        <div className="absolute" style={{ left: 10, top: 250, width: 160 }}><Card m={byId.study} className="w-full" /></div>
        <div className="absolute" style={{ left: 239, top: 475, width: 170 }}><Card m={byId.teach} className="w-full" /></div>
      </div>
    </div>
  );
}
