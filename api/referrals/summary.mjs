const RISK_ORDER = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const EVENT_TO_COUNT = {
  ref_click: "clicks",
  ref_send_code: "codes",
  ref_verify_ok: "verifies",
  ref_checkout_by_referred: "checkouts",
  ref_credit_skipped: "creditSkipped",
  ref_self_referral: "selfReferrals",
};

function emptyCounts() {
  return {
    clicks: 0,
    codes: 0,
    verifies: 0,
    checkouts: 0,
    creditSkipped: 0,
    selfReferrals: 0,
  };
}

function increment(obj, key, amount = 1) {
  if (!key) return;
  obj[key] = (obj[key] || 0) + amount;
}

function addToSet(map, key, value) {
  if (!key || !value) return;
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function addEventCount(map, key, event) {
  if (!key) return;
  const current = map.get(key) || { total: 0, authEvents: 0 };
  current.total += 1;
  if (event.type === "ref_send_code" || event.type === "ref_verify_ok") {
    current.authEvents += 1;
  }
  map.set(key, current);
}

function sortedCounters(obj, limit = 10) {
  return Object.entries(obj)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function severityMax(current, next) {
  return RISK_ORDER[next] > RISK_ORDER[current] ? next : current;
}

function makeWarning(code, label, severity, evidence) {
  return { code, label, severity, evidence };
}

function maxRepeatedIdentity(identityMap) {
  let top = null;
  for (const [key, set] of identityMap.entries()) {
    if (!top || set.size > top.identityCount) {
      top = { key, identityCount: set.size };
    }
  }
  return top;
}

function maxCount(hashMap, field = "total") {
  let top = null;
  for (const [key, counts] of hashMap.entries()) {
    const count = Number(counts?.[field]) || 0;
    if (!top || count > top.count) top = { key, count };
  }
  return top;
}

function compactEvent(event) {
  return {
    id: event.id,
    type: event.type,
    at: event.at,
    referrerUuid: event.referrerUuid || "",
    referredEmailHash: event.referredEmailHash,
    referredUuidPrefix: event.referredUuidPrefix,
    ipHash: event.ipHash,
    uaHash: event.uaHash,
    fingerprintHash: event.fingerprintHash,
    otherUserUuidPrefix: event.otherUserUuidPrefix,
    selfReferral: Boolean(event.selfReferral),
    path: event.path,
    refererUrl: event.refererUrl,
    reason: event.reason,
    tariffKey: event.tariffKey,
  };
}

function dateKey(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildDailyRegistrationStats(events, { since, until, suspiciousReferrerUuids }) {
  const byDay = new Map();
  let firstRegistrationDay = null;

  for (const event of events) {
    if (event.type !== "ref_verify_ok") continue;
    const day = dateKey(event.at);
    if (!day) continue;
    if (!firstRegistrationDay || day < firstRegistrationDay) firstRegistrationDay = day;

    const current = byDay.get(day) || { date: day, registrations: 0, suspicious: 0 };
    current.registrations += 1;
    if (suspiciousReferrerUuids.has(event.referrerUuid)) current.suspicious += 1;
    byDay.set(day, current);
  }

  const startDay = since ? since.toISOString().slice(0, 10) : firstRegistrationDay;
  const endDay = until.toISOString().slice(0, 10);
  if (!startDay) return [];

  const result = [];
  const cursor = new Date(`${startDay}T00:00:00.000Z`);
  const end = new Date(`${endDay}T00:00:00.000Z`);
  while (cursor <= end) {
    const day = cursor.toISOString().slice(0, 10);
    result.push(byDay.get(day) || { date: day, registrations: 0, suspicious: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function scoreReferrer(group) {
  const warnings = [];
  let riskLevel = "none";
  let score = 0;
  const counts = group.counts;
  const codeRate = counts.clicks > 0 ? counts.codes / counts.clicks : null;
  const verifyRate = counts.codes > 0 ? counts.verifies / counts.codes : null;
  const ipIdentity = maxRepeatedIdentity(group.ipIdentities);
  const fingerprintIdentity = maxRepeatedIdentity(group.fingerprintIdentities);
  const repeatedAuthIp = maxCount(group.ipCounts, "authEvents");
  const repeatedAuthFingerprint = maxCount(group.fingerprintCounts, "authEvents");
  const repeatedUa = maxCount(group.uaCounts, "total");
  const repeatedFingerprint = maxCount(group.fingerprintCounts, "total");

  const addWarning = (warning, points) => {
    warnings.push(warning);
    riskLevel = severityMax(riskLevel, warning.severity);
    score += points;
  };

  if (counts.selfReferrals > 0 || group.hasSelfReferral) {
    addWarning(
      makeWarning("self_referral", "Есть попытка self-referral", "critical", {
        selfReferrals: counts.selfReferrals,
      }),
      100,
    );
  }

  if (ipIdentity && ipIdentity.identityCount > 1) {
    addWarning(
      makeWarning("shared_ip_identities", "Один IP hash связан с несколькими рефералами", "critical", {
        ipHash: ipIdentity.key,
        identities: ipIdentity.identityCount,
      }),
      90,
    );
  }

  if (fingerprintIdentity && fingerprintIdentity.identityCount > 1) {
    addWarning(
      makeWarning(
        "shared_fingerprint_identities",
        "Один fingerprint hash связан с несколькими рефералами",
        "critical",
        {
          fingerprintHash: fingerprintIdentity.key,
          identities: fingerprintIdentity.identityCount,
        },
      ),
      90,
    );
  }

  if (counts.verifies >= 5 && counts.checkouts === 0) {
    addWarning(
      makeWarning("verifies_without_checkout", "Много регистраций без checkout", "high", {
        verifies: counts.verifies,
        checkouts: counts.checkouts,
      }),
      70,
    );
  }

  if (counts.codes >= 10 && verifyRate !== null && verifyRate < 0.2) {
    addWarning(
      makeWarning("low_verify_rate", "Много кодов с низкой конверсией в регистрацию", "high", {
        codes: counts.codes,
        verifies: counts.verifies,
        verifyRate,
      }),
      60,
    );
  }

  if (repeatedAuthIp && repeatedAuthIp.count >= 3) {
    addWarning(
      makeWarning("repeated_auth_ip", "Один IP hash часто используется при кодах/регистрациях", "high", {
        ipHash: repeatedAuthIp.key,
        events: repeatedAuthIp.count,
      }),
      55,
    );
  }

  if (repeatedAuthFingerprint && repeatedAuthFingerprint.count >= 3) {
    addWarning(
      makeWarning(
        "repeated_auth_fingerprint",
        "Один fingerprint hash часто используется при кодах/регистрациях",
        "high",
        {
          fingerprintHash: repeatedAuthFingerprint.key,
          events: repeatedAuthFingerprint.count,
        },
      ),
      55,
    );
  }

  if (counts.clicks >= 20 && codeRate !== null && codeRate < 0.1) {
    addWarning(
      makeWarning("low_code_rate", "Много переходов с низкой конверсией в отправку кода", "medium", {
        clicks: counts.clicks,
        codes: counts.codes,
        codeRate,
      }),
      35,
    );
  }

  if (counts.creditSkipped >= 2) {
    addWarning(
      makeWarning("credit_skipped", "Несколько пропущенных реферальных начислений", "medium", {
        creditSkipped: counts.creditSkipped,
      }),
      35,
    );
  }

  if (counts.checkouts === 0 && repeatedUa && repeatedUa.count >= 5) {
    addWarning(
      makeWarning("repeated_user_agent_no_checkout", "Повтор User-Agent hash без checkout", "medium", {
        uaHash: repeatedUa.key,
        events: repeatedUa.count,
      }),
      30,
    );
  }

  if (counts.checkouts === 0 && repeatedFingerprint && repeatedFingerprint.count >= 5) {
    addWarning(
      makeWarning("repeated_fingerprint_no_checkout", "Повтор fingerprint hash без checkout", "medium", {
        fingerprintHash: repeatedFingerprint.key,
        events: repeatedFingerprint.count,
      }),
      30,
    );
  }

  if (score === 0 && group.events.length > 0) {
    riskLevel = "low";
    score = 5;
  }

  return { riskLevel, score, warnings };
}

export function buildReferralSummary(events, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const days = opts.days === null ? null : Number(opts.days);
  const since =
    days && Number.isFinite(days) && days > 0
      ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      : null;
  const topLimit = Number.isInteger(opts.topLimit) && opts.topLimit > 0 ? opts.topLimit : 10;
  const recentEventLimit =
    Number.isInteger(opts.recentEventLimit) && opts.recentEventLimit > 0 ? opts.recentEventLimit : 100;

  const filtered = events
    .filter((event) => {
      if (!event || typeof event !== "object") return false;
      if (!since) return true;
      const at = Date.parse(event.at);
      return Number.isFinite(at) && at >= since.getTime();
    })
    .sort((a, b) => Date.parse(b.at || "") - Date.parse(a.at || ""));

  const groups = new Map();
  const totals = {
    events: filtered.length,
    referrers: 0,
    suspiciousReferrers: 0,
    criticalHighWarnings: 0,
    selfReferrals: 0,
    multiAccountDetections: 0,
  };
  const funnel = emptyCounts();
  const ipCounts = {};
  const uaCounts = {};
  const fingerprintCounts = {};

  for (const event of filtered) {
    const countKey = EVENT_TO_COUNT[event.type];
    if (countKey) funnel[countKey] += 1;
    if (event.ipHash) increment(ipCounts, event.ipHash);
    if (event.uaHash) increment(uaCounts, event.uaHash);
    if (event.fingerprintHash) increment(fingerprintCounts, event.fingerprintHash);
    if (event.selfReferral || event.type === "ref_self_referral") totals.selfReferrals += 1;
    if (event.otherUserUuidPrefix) totals.multiAccountDetections += 1;

    const referrerUuid = typeof event.referrerUuid === "string" ? event.referrerUuid.trim() : "";
    if (!referrerUuid) continue;

    let group = groups.get(referrerUuid);
    if (!group) {
      group = {
        referrerUuid,
        counts: emptyCounts(),
        ipCounts: new Map(),
        uaCounts: new Map(),
        fingerprintCounts: new Map(),
        ipIdentities: new Map(),
        fingerprintIdentities: new Map(),
        uniqueIps: new Set(),
        uniqueUserAgents: new Set(),
        uniqueFingerprints: new Set(),
        uniqueReferredEmails: new Set(),
        uniqueReferredUsers: new Set(),
        events: [],
        lastSeen: null,
        hasSelfReferral: false,
      };
      groups.set(referrerUuid, group);
    }

    if (countKey) group.counts[countKey] += 1;
    if (event.selfReferral || event.type === "ref_self_referral") group.hasSelfReferral = true;
    if (event.ipHash) group.uniqueIps.add(event.ipHash);
    if (event.uaHash) group.uniqueUserAgents.add(event.uaHash);
    if (event.fingerprintHash) group.uniqueFingerprints.add(event.fingerprintHash);
    if (event.referredEmailHash) group.uniqueReferredEmails.add(event.referredEmailHash);
    if (event.referredUuidPrefix) group.uniqueReferredUsers.add(event.referredUuidPrefix);
    addEventCount(group.ipCounts, event.ipHash, event);
    addEventCount(group.uaCounts, event.uaHash, event);
    addEventCount(group.fingerprintCounts, event.fingerprintHash, event);

    const identity = event.referredUuidPrefix || "";
    addToSet(group.ipIdentities, event.ipHash, identity);
    addToSet(group.fingerprintIdentities, event.fingerprintHash, identity);

    const compact = compactEvent(event);
    if (group.events.length < 25) group.events.push(compact);
    if (!group.lastSeen || Date.parse(event.at) > Date.parse(group.lastSeen)) {
      group.lastSeen = event.at;
    }
  }

  const referrers = [...groups.values()].map((group) => {
    const risk = scoreReferrer(group);
    return {
      referrerUuid: group.referrerUuid,
      riskLevel: risk.riskLevel,
      riskScore: risk.score,
      warnings: risk.warnings,
      counts: group.counts,
      unique: {
        ipHashes: group.uniqueIps.size,
        userAgentHashes: group.uniqueUserAgents.size,
        fingerprintHashes: group.uniqueFingerprints.size,
        referredEmailHashes: group.uniqueReferredEmails.size,
        referredUuidPrefixes: group.uniqueReferredUsers.size,
      },
      lastSeen: group.lastSeen,
      events: group.events,
    };
  });

  referrers.sort(
    (a, b) =>
      RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel] ||
      b.riskScore - a.riskScore ||
      Date.parse(b.lastSeen || "") - Date.parse(a.lastSeen || ""),
  );

  totals.referrers = referrers.length;
  totals.suspiciousReferrers = referrers.filter((r) => RISK_ORDER[r.riskLevel] >= RISK_ORDER.medium).length;
  totals.criticalHighWarnings = referrers.reduce(
    (sum, referrer) =>
      sum + referrer.warnings.filter((w) => w.severity === "critical" || w.severity === "high").length,
    0,
  );

  const riskSummary = {
    critical: referrers.filter((r) => r.riskLevel === "critical").length,
    high: referrers.filter((r) => r.riskLevel === "high").length,
    medium: referrers.filter((r) => r.riskLevel === "medium").length,
    low: referrers.filter((r) => r.riskLevel === "low").length,
    none: referrers.filter((r) => r.riskLevel === "none").length,
  };

  const suspiciousReferrerUuids = new Set(
    referrers
      .filter((referrer) => RISK_ORDER[referrer.riskLevel] >= RISK_ORDER.medium)
      .map((referrer) => referrer.referrerUuid),
  );
  const dailyRegistrations = buildDailyRegistrationStats(filtered, {
    since,
    until: now,
    suspiciousReferrerUuids,
  });

  return {
    generatedAt: now.toISOString(),
    window: {
      days: since ? days : null,
      since: since ? since.toISOString() : null,
      until: now.toISOString(),
    },
    totals,
    funnel,
    riskSummary,
    referrers,
    topIps: sortedCounters(ipCounts, topLimit),
    topUserAgents: sortedCounters(uaCounts, topLimit),
    topFingerprints: sortedCounters(fingerprintCounts, topLimit),
    dailyRegistrations,
    events: filtered.slice(0, recentEventLimit).map(compactEvent),
  };
}
