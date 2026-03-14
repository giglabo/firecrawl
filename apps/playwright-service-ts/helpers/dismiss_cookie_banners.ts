/**
 * Returns a JS string to be executed via page.evaluate() that dismisses
 * cookie consent banners using three phases: known selectors, button text
 * matching, and CSS fallback hiding.
 */
export function getCookieDismissScript(): string {
  return `
(function() {
  try {
    var result = { dismissed: false, method: 'none' };

    // Phase 1: Click known consent buttons by CSS selector
    var knownSelectors = [
      // Google
      '#L2AGLb',
      'button[jsname="b3VHJd"]',
      'form[action*="consent.google"] button',
      // OneTrust
      '#onetrust-accept-btn-handler',
      '.onetrust-close-btn-handler',
      // Cookiebot
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      // TrustArc
      '.trustarc-agree-btn',
      '#truste-consent-button',
      // Quantcast
      '.qc-cmp2-summary-buttons button[mode="primary"]',
      // Didomi
      '#didomi-notice-agree-button',
      // Klaro
      '.klaro .cm-btn-accept',
      // Osano
      '.osano-cm-accept-all',
      // Generic CookieConsent
      '.cc-compliance .cc-btn',
      '.cc-dismiss',
      // Fundingchoices
      '.fc-cta-consent',
    ];

    for (var i = 0; i < knownSelectors.length; i++) {
      var el = document.querySelector(knownSelectors[i]);
      if (el && el.offsetParent !== null) {
        el.click();
        result = { dismissed: true, method: 'selector:' + knownSelectors[i] };
        break;
      }
    }

    // Phase 2: Click by button text (fallback, multilingual)
    if (!result.dismissed) {
      var textPatterns = [
        // EN
        'accept all', 'accept cookies', 'i agree', 'agree', 'allow all', 'got it',
        // DE
        'alle akzeptieren', 'zustimmen', 'alle cookies akzeptieren',
        // FR
        'tout accepter', 'accepter',
        // ES
        'aceptar todo', 'aceptar',
        // IT
        'accetta tutto', 'accetta',
        // NL
        'alles accepteren',
        // PT
        'aceitar todos',
      ];

      var candidates = document.querySelectorAll('button, a[role="button"], [role="button"]');
      for (var j = 0; j < candidates.length; j++) {
        var text = (candidates[j].textContent || '').trim().toLowerCase();
        for (var k = 0; k < textPatterns.length; k++) {
          if (text === textPatterns[k] || text.includes(textPatterns[k])) {
            candidates[j].click();
            result = { dismissed: true, method: 'text:' + textPatterns[k] };
            break;
          }
        }
        if (result.dismissed) break;
      }
    }

    // Phase 3: CSS fallback — hide remaining overlays
    var hideSelectors = [
      '#onetrust-consent-sdk',
      '#CybotCookiebotDialog',
      '.cc-window',
      '[class*="cookie-banner"]',
      '[class*="cookie-consent"]',
      '[id*="cookie-banner"]',
      '[id*="cookie-consent"]',
      '[class*="gdpr"]',
      '.fc-consent-root',
    ];

    for (var h = 0; h < hideSelectors.length; h++) {
      var els = document.querySelectorAll(hideSelectors[h]);
      for (var e = 0; e < els.length; e++) {
        els[e].style.display = 'none';
        if (!result.dismissed) {
          result = { dismissed: true, method: 'css-hide:' + hideSelectors[h] };
        }
      }
    }

    // Remove overflow:hidden from html/body (often set by consent modals)
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    return result;
  } catch (e) {
    return { dismissed: false, method: 'error: ' + (e && e.message ? e.message : String(e)) };
  }
})();
`;
}
