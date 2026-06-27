import { normalize } from './common/ledger.mjs';
import { ACTIVE_STATUSES } from './decision.mjs';

// Multi-stage funnel (cf. plan §9): candidates from the inverted index → IDF-weighted scoring of ONLY
// those candidates → adaptive top-1/top-3 → enrich just the winners. No linear scan of the corpus.

function idfOf(model) {
  const N = Math.max(1, model.N);
  return (t) => Math.log(1 + N / ((model.df.get(t) || 0) + 0.5));
}

/**
 * @returns {{query, matched, shown, cards}} — `cards[0]` carries the full decision; the rest are summaries.
 */
export function recall(model, query, { top, domain, statuses = ACTIVE_STATUSES, all = false } = {}) {
  const terms = normalize(query).terms;
  const idf = idfOf(model);

  // stage 1 — gather candidate ids from postings (terms present in the query only)
  const cand = new Set();
  for (const t of terms) for (const id of (model.postings.get(t) || [])) cand.add(id);

  // stage 2 — score candidates by idf-weighted overlap, after status/domain prefilter
  const qset = new Set(terms);
  let qself = 0; for (const t of qset) qself += idf(t) ** 2;
  const scored = [];
  for (const id of cand) {
    const d = model.byId.get(id);
    if (!d) continue;
    if (!all && !statuses.includes(d.status)) continue;
    if (domain && d.domain !== domain) continue;
    const dterms = new Set(model.terms.get(id) || []);
    let dot = 0, dself = 0;
    for (const t of dterms) { const w = idf(t); dself += w * w; if (qset.has(t)) dot += w * w; }
    if (dot <= 0) continue;
    const score = dot / (Math.min(qself, dself) || 1);
    scored.push({ d, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.d.id).localeCompare(String(b.d.id)));

  // stage 3 — adaptive ranking: a dominant #1 (≥2× the #2) → top-1, else top-3
  let n = top;
  if (n == null) n = (scored.length <= 1 || scored[0]?.score >= 2 * (scored[1]?.score || 0)) ? 1 : 3;
  const sel = scored.slice(0, n);

  const cards = sel.map(({ d, score }, i) => i === 0 ? fullCard(d, score) : summaryCard(d, score));
  return { query, matched: scored.length, shown: cards.length, cards };
}

const round = (s) => Math.round(s * 100) / 100;
function summaryCard(d, score) {
  return { score: round(score), id: d.id, type: d.type, status: d.status, domain: d.domain,
    title: d.title, decision: d.decision, tags: d.tags || [] };
}
function fullCard(d, score) {
  return {
    score: round(score), id: d.id, type: d.type, status: d.status, domain: d.domain, date: d.date,
    title: d.title, context: d.context, decision: d.decision, rationale: d.rationale,
    consequences: d.consequences || [], alternatives: d.alternatives || [], tags: d.tags || [],
    ...(d.supersedes ? { supersedes: d.supersedes } : {}),
    ...(d.conflicts_with && d.conflicts_with.length ? { conflicts_with: d.conflicts_with } : {}),
    ...(d.evidence && d.evidence.length ? { evidence: d.evidence } : {}),
    ...(d.confidence ? { confidence: d.confidence } : {}),
  };
}
