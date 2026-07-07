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

const REGISTRATION_EVENT_TYPES = new Set(["ref_verify_ok", "ref_credit_skipped"]);

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

function makeWarning(code, label, severity, evidence, description) {
  return {
    code,
    label,
    severity,
    evidence,
    ...(description ? { description } : {}),
  };
}

function maxCount(hashMap, field = "total") {
  let top = null;
  for (const [key, counts] of hashMap.entries()) {
    const count = Number(counts?.[field]) || 0;
    if (!top || count > top.count) top = { key, count };
  }
  return top;
}

// Points awarded to the two dynamic hash-match warnings, keyed by the severity
// computed from which of UA/FP/IP signals coincided.
const DYNAMIC_SEVERITY_POINTS = {
  critical: 100,
  high: 65,
  medium: 40,
};

// Compare which of the three technical fingerprints coincide between two events.
function matchedHashSignals(a, b) {
  return {
    ua: Boolean(a.uaHash && b.uaHash && a.uaHash === b.uaHash),
    fp: Boolean(a.fingerprintHash && b.fingerprintHash && a.fingerprintHash === b.fingerprintHash),
    ip: Boolean(a.ipHash && b.ipHash && a.ipHash === b.ipHash),
  };
}

// Risk severity from coinciding signals:
//   critical -> UA and FP matched (almost certainly the same device)
//   high     -> IP matched together with UA or FP
//   medium   -> only UA or only FP matched
//   null     -> only IP matched, or nothing matched (not recorded)
function severityFromSignals({ ua, fp, ip }) {
  if (ua && fp) return "critical";
  if ((ua && ip) || (fp && ip)) return "high";
  if (ua || fp) return "medium";
  return null;
}

function eventHappenedBeforeOrAt(candidate, event) {
  const candidateAt = Date.parse(candidate.at || "");
  const eventAt = Date.parse(event.at || "");
  return Number.isFinite(candidateAt) && Number.isFinite(eventAt) && candidateAt <= eventAt;
}

// Scenario 1: a referral link opened from a *different* logged-in account
// (ref_click with otherUserUuidPrefix), followed by a registration that shares
// technical signals. One entry per (other account, registered user) pair.
function buildOtherAccountMatches(candidates, registrationEvents) {
  const byPair = new Map();

  for (const candidate of candidates) {
    for (const event of registrationEvents) {
      if (!eventHappenedBeforeOrAt(candidate, event)) continue;
      const signals = matchedHashSignals(candidate, event);
      if (!severityFromSignals(signals)) continue;

      const key = `${candidate.otherUserUuidPrefix}|${event.referredUuidPrefix || ""}`;
      const current = byPair.get(key) || {
        otherUserUuidPrefix: candidate.otherUserUuidPrefix,
        referredUuidPrefix: event.referredUuidPrefix || "",
        referredEmailHash: event.referredEmailHash || "",
        signals: { ua: false, fp: false, ip: false },
        uaHash: undefined,
        fingerprintHash: undefined,
        ipHash: undefined,
      };
      if (signals.ua) {
        current.signals.ua = true;
        current.uaHash = candidate.uaHash || event.uaHash;
      }
      if (signals.fp) {
        current.signals.fp = true;
        current.fingerprintHash = candidate.fingerprintHash || event.fingerprintHash;
      }
      if (signals.ip) {
        current.signals.ip = true;
        current.ipHash = candidate.ipHash || event.ipHash;
      }
      byPair.set(key, current);
    }
  }

  return [...byPair.values()].map((entry) => ({
    ...entry,
    severity: severityFromSignals(entry.signals),
  }));
}

// Keep only the latest registration event per referred user so a registration is
// never compared with itself and the pairwise cost stays bounded.
function dedupeRegistrationsByIdentity(registrationEvents) {
  const byIdentity = new Map();
  for (const event of registrationEvents) {
    const identity = event.referredUuidPrefix || "";
    if (!identity) continue;
    const existing = byIdentity.get(identity);
    if (!existing || Date.parse(event.at || "") > Date.parse(existing.at || "")) {
      byIdentity.set(identity, event);
    }
  }
  return [...byIdentity.values()];
}

// Cap the pairwise comparison to avoid O(n^2) blow-ups on abnormally large
// referrers. 500 unique identities => ~125k comparisons worst case.
const DUPLICATE_REGISTRATION_COMPARE_LIMIT = 500;

// Scenario 2: two *different* registrations of the same referrer that share
// technical signals (typical self-farming with multiple accounts).
function buildDuplicateRegistrationMatches(registrationEvents) {
  const unique = dedupeRegistrationsByIdentity(registrationEvents)
    .sort((a, b) => Date.parse(a.at || "") - Date.parse(b.at || ""))
    .slice(0, DUPLICATE_REGISTRATION_COMPARE_LIMIT);

  const byPair = new Map();
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const a = unique[i];
      const b = unique[j];
      const signals = matchedHashSignals(a, b);
      const severity = severityFromSignals(signals);
      if (!severity) continue;

      const prefixA = a.referredUuidPrefix || "";
      const prefixB = b.referredUuidPrefix || "";
      byPair.set(`${prefixA}|${prefixB}`, {
        referredUuidPrefixA: prefixA,
        referredUuidPrefixB: prefixB,
        referredEmailHashA: a.referredEmailHash || "",
        referredEmailHashB: b.referredEmailHash || "",
        severity,
        signals,
        uaHash: signals.ua ? a.uaHash || b.uaHash : undefined,
        fingerprintHash: signals.fp ? a.fingerprintHash || b.fingerprintHash : undefined,
        ipHash: signals.ip ? a.ipHash || b.ipHash : undefined,
      });
    }
  }
  return [...byPair.values()];
}

// Per-registration risk signals for the admin points history. For every unique
// registration of the referrer, union the UA/FP/IP signals it shares with the
// referrer's other registrations and with clicks made from other logged-in
// accounts. Keyed by referredEmailHash so the RMW points history (which only
// exposes the referred user's email) can be matched against Redis events.
export function buildRegistrationRiskSignals(events, referrerUuid) {
  const uuid = typeof referrerUuid === "string" ? referrerUuid.trim() : "";
  const registrationEvents = [];
  const candidates = [];

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if ((typeof event.referrerUuid === "string" ? event.referrerUuid.trim() : "") !== uuid) continue;
    const isSelfReferral = Boolean(event.selfReferral) || event.type === "ref_self_referral";
    if (
      event.otherUserUuidPrefix &&
      !isSelfReferral &&
      event.otherUserUuidPrefix !== uuid.slice(0, 8)
    ) {
      candidates.push(event);
    }
    if (REGISTRATION_EVENT_TYPES.has(event.type) && !isSelfReferral && event.referredUuidPrefix) {
      registrationEvents.push(event);
    }
  }

  const unique = dedupeRegistrationsByIdentity(registrationEvents)
    .sort((a, b) => Date.parse(a.at || "") - Date.parse(b.at || ""))
    .slice(0, DUPLICATE_REGISTRATION_COMPARE_LIMIT);

  const result = {};

  for (let i = 0; i < unique.length; i += 1) {
    const registration = unique[i];
    const entry = {
      signals: { ua: false, fp: false, ip: false },
      severity: null,
      duplicateRegistrations: 0,
      otherAccounts: 0,
    };
    // Union of signals for the chips, but severity is the worst single pair so
    // two unrelated weak matches never add up to a stronger level.
    let severity = "none";
    const mergeMatch = (signals, pairSeverity) => {
      entry.signals.ua = entry.signals.ua || signals.ua;
      entry.signals.fp = entry.signals.fp || signals.fp;
      entry.signals.ip = entry.signals.ip || signals.ip;
      severity = severityMax(severity, pairSeverity);
    };

    for (let j = 0; j < unique.length; j += 1) {
      if (i === j) continue;
      const signals = matchedHashSignals(registration, unique[j]);
      const pairSeverity = severityFromSignals(signals);
      if (!pairSeverity) continue;
      mergeMatch(signals, pairSeverity);
      entry.duplicateRegistrations += 1;
    }

    const matchedAccounts = new Set();
    for (const candidate of candidates) {
      if (!eventHappenedBeforeOrAt(candidate, registration)) continue;
      const signals = matchedHashSignals(candidate, registration);
      const pairSeverity = severityFromSignals(signals);
      if (!pairSeverity) continue;
      mergeMatch(signals, pairSeverity);
      matchedAccounts.add(candidate.otherUserUuidPrefix);
    }
    entry.otherAccounts = matchedAccounts.size;

    entry.severity = severity === "none" ? null : severity;
    if (registration.referredEmailHash) {
      result[registration.referredEmailHash] = entry;
    }
  }

  return result;
}

function groupMatchesBySeverity(matches) {
  const bySeverity = { critical: [], high: [], medium: [] };
  for (const match of matches) {
    if (bySeverity[match.severity]) bySeverity[match.severity].push(match);
  }
  return bySeverity;
}

function dynamicSeverityDescription(severity) {
  if (severity === "critical") {
    return "Совпали User-Agent и fingerprint — почти наверняка одно и то же устройство.";
  }
  if (severity === "high") {
    return "Совпал IP вместе с User-Agent или fingerprint.";
  }
  return "Совпал User-Agent или fingerprint (без подтверждающего IP).";
}

function groupWarningsBySeverity(warnings) {
  const result = { critical: [], high: [], medium: [] };
  for (const warning of warnings) {
    if (result[warning.severity]) result[warning.severity].push(warning);
  }
  return result;
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
  const repeatedAuthIp = maxCount(group.ipCounts, "authEvents");
  const repeatedAuthFingerprint = maxCount(group.fingerprintCounts, "authEvents");
  const repeatedUa = maxCount(group.uaCounts, "total");
  const repeatedFingerprint = maxCount(group.fingerprintCounts, "total");

  const addWarning = (warning, points) => {
    warnings.push(warning);
    riskLevel = severityMax(riskLevel, warning.severity);
    score += points;
  };

  // Scenario 1: link opened from another account, then a registration that
  // shares technical signals. One warning per reached severity level so the UI
  // can split them into the Critical/High/Medium spoilers.
  const otherAccountBySeverity = groupMatchesBySeverity(group.otherAccountMatches);
  for (const severity of ["critical", "high", "medium"]) {
    const matches = otherAccountBySeverity[severity];
    if (matches.length === 0) continue;
    addWarning(
      makeWarning(
        "other_account_click_before_registration",
        "Регистрация после открытия ссылки из браузера/ПК другого аккаунта",
        severity,
        {
          matchLevel: severity,
          accounts: new Set(matches.map((match) => match.otherUserUuidPrefix)).size,
          registrations: matches.length,
          matches: matches.slice(0, 20).map((match) => ({
            otherUserUuidPrefix: match.otherUserUuidPrefix,
            referredUuidPrefix: match.referredUuidPrefix,
            referredEmailHash: match.referredEmailHash,
            signals: match.signals,
            uaHash: match.uaHash,
            fingerprintHash: match.fingerprintHash,
            ipHash: match.ipHash,
          })),
        },
        dynamicSeverityDescription(severity),
      ),
      DYNAMIC_SEVERITY_POINTS[severity],
    );
  }

  // Scenario 2: two different registrations of the same referrer sharing
  // technical signals (multi-account self-farming).
  const duplicateRegBySeverity = groupMatchesBySeverity(group.duplicateRegistrationMatches);
  for (const severity of ["critical", "high", "medium"]) {
    const matches = duplicateRegBySeverity[severity];
    if (matches.length === 0) continue;
    addWarning(
      makeWarning(
        "duplicate_registration_signals",
        "Несколько регистраций с одинаковыми техническими отпечатками",
        severity,
        {
          matchLevel: severity,
          pairs: matches.length,
          matches: matches.slice(0, 20).map((match) => ({
            referredUuidPrefixA: match.referredUuidPrefixA,
            referredUuidPrefixB: match.referredUuidPrefixB,
            referredEmailHashA: match.referredEmailHashA,
            referredEmailHashB: match.referredEmailHashB,
            signals: match.signals,
            uaHash: match.uaHash,
            fingerprintHash: match.fingerprintHash,
            ipHash: match.ipHash,
          })),
        },
        dynamicSeverityDescription(severity),
      ),
      DYNAMIC_SEVERITY_POINTS[severity],
    );
  }

  if (counts.verifies >= 5 && counts.checkouts === 0) {
    addWarning(
      makeWarning("verifies_without_checkout", "Много регистраций без оплат", "medium", {
        verifies: counts.verifies,
        checkouts: counts.checkouts,
      }),
      70,
    );
  }

  if (repeatedAuthIp && repeatedAuthIp.count >= 4) {
    addWarning(
      makeWarning("repeated_auth_ip", "Один IP hash часто используется при кодах/регистрациях", "medium", {
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
        "medium",
        {
          fingerprintHash: repeatedAuthFingerprint.key,
          events: repeatedAuthFingerprint.count,
        },
      ),
      55,
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
      makeWarning(
        "repeated_user_agent_no_checkout",
        "Много действий с одного браузера без оплат",
        "medium",
        {
          uaHash: repeatedUa.key,
          events: repeatedUa.count,
          checkouts: counts.checkouts,
        },
        "Один и тот же User-Agent hash встретился в 5+ реферальных событиях, при этом у реферера нет ни одной оплаты.",
      ),
      30,
    );
  }

  if (counts.checkouts === 0 && repeatedFingerprint && repeatedFingerprint.count >= 5) {
    addWarning(
      makeWarning(
        "repeated_fingerprint_no_checkout",
        "Много действий с одного устройства без оплат",
        "medium",
        {
          fingerprintHash: repeatedFingerprint.key,
          events: repeatedFingerprint.count,
          checkouts: counts.checkouts,
        },
        "Один и тот же fingerprint hash встретился в 5+ реферальных событиях, при этом у реферера нет ни одной оплаты.",
      ),
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
    const isSelfReferral = Boolean(event.selfReferral) || event.type === "ref_self_referral";
    if (isSelfReferral) totals.selfReferrals += 1;
    // Self-referrals also carry otherUserUuidPrefix (the user's own prefix); they are benign
    // and rejected by the reward logic, so only count interactions from a *different* account.
    if (event.otherUserUuidPrefix && !isSelfReferral) totals.multiAccountDetections += 1;

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
        uniqueIps: new Set(),
        uniqueUserAgents: new Set(),
        uniqueFingerprints: new Set(),
        uniqueReferredEmails: new Set(),
        uniqueReferredUsers: new Set(),
        browserAccountCandidates: [],
        registrationEvents: [],
        otherAccountMatches: [],
        duplicateRegistrationMatches: [],
        events: [],
        lastSeen: null,
      };
      groups.set(referrerUuid, group);
    }

    if (countKey) group.counts[countKey] += 1;
    if (
      event.otherUserUuidPrefix &&
      !isSelfReferral &&
      event.otherUserUuidPrefix !== referrerUuid.slice(0, 8)
    ) {
      group.browserAccountCandidates.push({
        otherUserUuidPrefix: event.otherUserUuidPrefix,
        at: event.at,
        ipHash: event.ipHash,
        uaHash: event.uaHash,
        fingerprintHash: event.fingerprintHash,
      });
    }
    if (REGISTRATION_EVENT_TYPES.has(event.type) && !isSelfReferral && event.referredUuidPrefix) {
      group.registrationEvents.push(event);
    }
    if (event.ipHash) group.uniqueIps.add(event.ipHash);
    if (event.uaHash) group.uniqueUserAgents.add(event.uaHash);
    if (event.fingerprintHash) group.uniqueFingerprints.add(event.fingerprintHash);
    if (event.referredEmailHash) group.uniqueReferredEmails.add(event.referredEmailHash);
    if (event.referredUuidPrefix) group.uniqueReferredUsers.add(event.referredUuidPrefix);
    addEventCount(group.ipCounts, event.ipHash, event);
    addEventCount(group.uaCounts, event.uaHash, event);
    addEventCount(group.fingerprintCounts, event.fingerprintHash, event);

    const compact = compactEvent(event);
    if (group.events.length < 25) group.events.push(compact);
    if (!group.lastSeen || Date.parse(event.at) > Date.parse(group.lastSeen)) {
      group.lastSeen = event.at;
    }
  }

  for (const group of groups.values()) {
    group.otherAccountMatches = buildOtherAccountMatches(
      group.browserAccountCandidates,
      group.registrationEvents,
    );
    group.duplicateRegistrationMatches = buildDuplicateRegistrationMatches(group.registrationEvents);
  }
  totals.multiAccountDetections = [...groups.values()].reduce(
    (sum, group) => sum + group.otherAccountMatches.length,
    0,
  );

  const referrers = [...groups.values()].map((group) => {
    const risk = scoreReferrer(group);
    return {
      referrerUuid: group.referrerUuid,
      riskLevel: risk.riskLevel,
      riskScore: risk.score,
      warnings: risk.warnings,
      warningsBySeverity: groupWarningsBySeverity(risk.warnings),
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

export function buildReferralRiskForReferrer(events, referrerUuid, opts = {}) {
  const uuid = typeof referrerUuid === "string" ? referrerUuid.trim() : "";
  const summary = buildReferralSummary(events, {
    ...opts,
    topLimit: 1,
    recentEventLimit: 25,
  });
  const referrer = summary.referrers.find((item) => item.referrerUuid === uuid);

  if (referrer) {
    return {
      referrerUuid: uuid,
      riskLevel: referrer.riskLevel,
      riskScore: referrer.riskScore,
      warnings: referrer.warnings,
      counts: referrer.counts,
      lastSeen: referrer.lastSeen,
    };
  }

  return {
    referrerUuid: uuid,
    riskLevel: "none",
    riskScore: 0,
    warnings: [],
    counts: emptyCounts(),
    lastSeen: null,
  };
}
