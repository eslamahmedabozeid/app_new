/**
 * School orders API (production).
 * Base: https://backend.greenolasa.com/api/v1/school-orders
 *
 * Checkout creates the order AND HyperPay session in one POST.
 * Status is polled separately; never treat URL params as paid.
 *
 * Localhost: resolveBase() uses /__school-orders (dev-server.mjs proxy → same production API).
 * Override: window.SCHOOL_ORDERS_API_BASE
 */
(function (global) {
  "use strict";

  var DEFAULT_BASE =
    "https://backend.greenolasa.com/api/v1/school-orders";

  /** Backend cart dedupe window (ms). Align frontend cache with this. */
  var DEDUPE_TTL_MS = 25 * 60 * 1000;

  function resolveBase() {
    if (global.SCHOOL_ORDERS_API_BASE)
      return String(global.SCHOOL_ORDERS_API_BASE).replace(/\/$/, "");
    try {
      var host = global.location && global.location.hostname;
      if (
        host &&
        /^(localhost|127\.0\.0\.1)$/i.test(host) &&
        /^https?:$/i.test(global.location.protocol)
      ) {
        /* Same-origin proxy (dev-server.mjs) — browser CORS Origin stays local. */
        return "/__school-orders";
      }
      /* Vercel git deploys: /api/school-orders (checkout + status). */
      if (host && /\.vercel\.app$/i.test(host)) return "/api/school-orders";
    } catch (e) {}
    return DEFAULT_BASE;
  }

  function pickMsg(json, lang) {
    if (!json || typeof json !== "object") return null;
    if (lang === "en") {
      if (json.error_en) return String(json.error_en);
    } else if (json.error_ar) return String(json.error_ar);
    if (Array.isArray(json.message)) return json.message.join("; ");
    if (
      typeof json.message === "string" &&
      json.message &&
      !/^response-messages\./.test(json.message)
    )
      return json.message;
    if (json.error && typeof json.error === "string") return json.error;
    return null;
  }

  function apiError(res, json, lang) {
    var code =
      (json && (json.code != null ? json.code : null)) ||
      (res && res.status === 404 ? "ORDER_NOT_FOUND" : "SERVER");
    if (typeof code === "number") code = String(code);
    return {
      code: code,
      msg: pickMsg(json, lang) || "Request failed",
      status: res && res.status,
      detail: json,
    };
  }

  function unwrapData(json) {
    if (json && json.data != null && typeof json.data === "object") return json.data;
    return json;
  }

  async function request(pathWithQuery, opts, lang) {
    opts = opts || {};
    lang = lang || "ar";
    var base = resolveBase();
    var url =
      base +
      (pathWithQuery.charAt(0) === "/" ? pathWithQuery : "/" + pathWithQuery);
    var res;
    var json = null;
    try {
      res = await fetch(url, {
        method: opts.method || "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(opts.headers || {}),
        },
        body: opts.body != null ? opts.body : undefined,
      });
      json = await res.json().catch(function () {
        return null;
      });
    } catch (e) {
      throw {
        code: "NET",
        msg: "Network error",
        detail: String(e && e.message ? e.message : e),
      };
    }
    if (!res.ok) throw apiError(res, json, lang);
    return unwrapData(json);
  }

  /** POST /checkout — order + HyperPay session. Do not send client totals. */
  async function checkout(payload, lang) {
    var body = Object.assign({}, payload || {});
    delete body.total;
    delete body.vat;
    delete body.amount;
    delete body.currency;
    delete body._provisional;
    return request(
      "/checkout",
      { method: "POST", body: JSON.stringify(body) },
      lang
    );
  }

  /** GET /status?order=&lang= */
  async function status(orderNo, lang) {
    var q =
      "/status?order=" +
      encodeURIComponent(orderNo) +
      "&lang=" +
      encodeURIComponent(lang || "ar");
    return request(q, { method: "GET" }, lang);
  }

  function normalizeStatus(data) {
    data = data || {};
    var kids = Array.isArray(data.kids) ? data.kids : [];
    var meals = 0;
    var daySet = {};
    var first = null;
    kids.forEach(function (k) {
      (k.lines || []).forEach(function (ln) {
        meals += Number(ln.qty) || 0;
        if (ln.date) {
          daySet[ln.date] = true;
          if (!first || ln.date < first) first = ln.date;
        }
      });
    });
    return {
      order_no: data.order_no,
      status: data.status,
      school_id: data.school_id || null,
      branch_name: data.branch_name || null,
      school_name_ar: data.school_name_ar || data.school_id || null,
      school_name_en: data.school_name_en || data.school_id || null,
      branch_name_ar: data.branch_name_ar || data.branch_name || null,
      branch_name_en: data.branch_name_en || data.branch_name || null,
      total: data.total,
      vat: data.vat,
      currency: data.currency || null,
      paid_at: data.paid_at,
      created_at: data.created_at,
      meals: data.meals != null ? data.meals : meals,
      days: data.days != null ? data.days : Object.keys(daySet).length,
      first_delivery_date: data.first_delivery_date || first,
      kids: kids,
      _raw: data,
    };
  }

  function orderFromCheckout(data, extras) {
    data = data || {};
    extras = extras || {};
    return {
      order_no: data.order_no,
      order_id: data.order_id != null ? data.order_id : null,
      total: data.total,
      vat: data.vat,
      currency: data.currency || null,
      paymentUrl: data.paymentUrl || null,
      checkoutId: data.checkoutId || null,
      supportedBrands: data.supportedBrands || null,
      payment_method: extras.payment_method || null,
      sig: extras.sig || null,
      at: Date.now(),
    };
  }

  global.SchoolOrdersApi = {
    DEFAULT_BASE: DEFAULT_BASE,
    DEDUPE_TTL_MS: DEDUPE_TTL_MS,
    resolveBase: resolveBase,
    checkout: checkout,
    status: status,
    normalizeStatus: normalizeStatus,
    orderFromCheckout: orderFromCheckout,
    unwrapData: unwrapData,
  };
})(typeof window !== "undefined" ? window : globalThis);
