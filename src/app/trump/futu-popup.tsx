'use client';

import { useState, useEffect } from 'react';
import futuAd from './futu_ad.jpg';

const DISMISS_KEY = 'futu_ad_dismissed_v1';

export function FutuAdPopup() {
  const [visible, setVisible] = useState(false);

  // Hermes 2026-08-14: standard SSR hydration pattern. We can't read
  // localStorage on the server, so we defer the visibility check until
  // after mount to avoid a hydration mismatch (server always renders
  // hidden; client may flip to visible on mount).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(DISMISS_KEY);
      if (!dismissed) setVisible(true);
    } catch {
      setVisible(true); // localStorage blocked → show anyway
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!visible) return null;

  const close = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Comparetiger 獨家 Futu 開戶優惠"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        // Allow the wrapper to scroll on very small phones
        overflowY: 'auto',
      }}
      onClick={close}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '420px',
          background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
          borderRadius: '14px',
          padding: '18px',
          textAlign: 'center',
          color: '#fff',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={close}
          aria-label="關閉廣告"
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.3)',
            color: '#fff',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer',
            lineHeight: '28px',
            // Big enough tap target for mobile (user is on ≤375px iPhone)
            minWidth: '44px',
            minHeight: '44px',
          }}
        >
          ×
        </button>

        <img
          src={futuAd.src}
          alt="富途牛牛優惠"
          style={{
            borderRadius: '8px',
            marginBottom: '12px',
            display: 'block',
            marginLeft: 'auto',
            marginRight: 'auto',
            width: '80%',
            maxWidth: '320px',
          }}
        />

        <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '10px' }}>
          🎁 Comparetiger 獨家 富途開戶即賺 $1,800 現金券！
        </div>

        <div style={{ fontSize: '13px', color: '#ddd', marginBottom: '8px' }}>
          用兌換碼【<span style={{ color: '#f39c12', fontWeight: 'bold' }}>COMPARE</span>】開戶
          ，享一世免佣 + 高達 HK$1,800 現金券
        </div>

        <div style={{ fontSize: '12px', color: '#999', marginBottom: '14px' }}>
          📲 步驟：下載富途牛牛 APP → 活動中心 → 兌換中心 → 輸入【COMPARE】
        </div>

        <button
          onClick={close}
          style={{
            background: '#f39c12',
            color: '#1a1a2e',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 28px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          知道了
        </button>
      </div>
    </div>
  );
}
